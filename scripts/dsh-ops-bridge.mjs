#!/usr/bin/env node
/**
 * dsh-ops-worker MCP bridge for WorkBuddy.
 *
 * ⚠️ 本文件由 WorkDaddy 随包分发（scripts/dsh-ops-bridge.mjs），安装时原样复制到
 *    %APPDATA%\WorkDaddy\dsh-ops\worker-mcp.mjs 并由 mcp.json 以 node 启动。
 *    上游：T-Auto/dsh-ops（MIT AND Apache-2.0）。桥本身零第三方依赖。
 *
 * 把 dsh-ops 的原生 Rust worker（dsh-ops-worker.exe，DSH 0.3.0 插件自带）
 * 包装成一个零依赖的 MCP stdio server。worker 本身是一个独立的
 * stdin->stdout JSON 进程（协议见 native/src/main.rs），与 DSH/cordis
 * 宿主完全解耦，因此只需在本桥内复刻 lib/file/worker.js 的请求构造逻辑。
 *
 * 工具（前缀由 MCP server 名提供，调用形态 mcp__dsh-ops__<tool>）：
 *   grep / glob / inspect_local_file / replace   —— Rust 文件工具（有界输出、分页）
 *   batch / result                               —— PTC 安全批处理与有界结果引用
 *
 * 协议：newline-delimited JSON-RPC 2.0 over stdio（MCP 2025-03-26）。
 * 无第三方依赖，node >= 18 可直接运行。
 */
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WORKER = path.join(HERE, 'bin', 'dsh-ops-worker.exe')
const SERVER_NAME = 'dsh-ops'
const SERVER_VERSION = '0.3.0-wb1'

/** root：可用 DSH_OPS_ROOT 覆盖，否则取 MCP server 启动时的 cwd。 */
function resolveRoot() {
  const env = process.env.DSH_OPS_ROOT
  if (env && path.isAbsolute(env)) return env
  return process.cwd()
}

/** 与 dsh-ops lib/file/worker.js 对齐的路径解析：path 缺省时取 root 本身。 */
function resolveTarget(raw, root) {
  if (raw === undefined || raw === null || raw === '') return root
  if (typeof raw !== 'string' || raw.includes('\0')) return undefined
  return path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(root, raw)
}

const string = { type: 'string' }
const integer = { type: 'integer', minimum: 0 }
const bounded = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false })

/** 工具参数 schema 与 dsh-ops lib/file/contract.js、lib/ptc/contract.js 一致。 */
const TOOLS = [
  {
    name: 'grep',
    description:
      'Rust regex 内容检索（ripgrep 引擎，无环视）。有界输出 + 分页（nextOffset）。path 为绝对目录路径（省略时用 root）。outputMode: files_with_matches|content|count|summary。适合在大目录里替代逐文件读取。',
    inputSchema: bounded(
      {
        path: string,
        pattern: string,
        glob: { type: 'array', items: string },
        outputMode: { type: 'string', enum: ['files_with_matches', 'content', 'count', 'summary'] },
        caseInsensitive: { type: 'boolean' },
        lineNumbers: { type: 'boolean' },
        beforeContext: { ...integer, maximum: 32 },
        afterContext: { ...integer, maximum: 32 },
        multiline: { type: 'boolean' },
        offset: integer,
        limit: { ...integer, minimum: 1, maximum: 10000 },
      },
      ['pattern'],
    ),
    readOnly: true,
  },
  {
    name: 'glob',
    description:
      '按 glob 模式列文件（不遍历符号链接/隐藏文件/.git）。path 为绝对目录路径（省略时用 root）。pattern 如 ["**/*.rs","!target/**"]，前导 ! 排除。outputMode: paths|details；sort: path|modified。有界输出 + 分页。',
    inputSchema: bounded(
      {
        path: string,
        pattern: { type: 'array', minItems: 1, items: string },
        outputMode: { type: 'string', enum: ['paths', 'details'] },
        sort: { type: 'string', enum: ['path', 'modified'] },
        offset: integer,
        limit: { ...integer, minimum: 1, maximum: 10000 },
      },
      ['pattern'],
    ),
    readOnly: true,
  },
  {
    name: 'inspect_local_file',
    description:
      '有界读取单个文件：UTF-8 文本按行（offset/limit 分页）或 hex 视图。目录会被拒绝，列目录用 glob。path 为绝对文件路径。',
    inputSchema: bounded({
      path: string,
      offset: { ...integer, minimum: 1 },
      limit: { ...integer, minimum: 1, maximum: 10000 },
      encoding: { type: 'string', enum: ['utf-8'] },
      view: { type: 'string', enum: ['text', 'hex'] },
    }),
    readOnly: true,
  },
  {
    name: 'replace',
    description:
      '跨文件确定性替换（Rust regex）。dryRun=true 只观测不写入；真实写入带 revision 校验与原子替换。path 为绝对路径（须在 root 或系统临时目录内）。',
    inputSchema: bounded(
      {
        path: string,
        pattern: string,
        replacement: string,
        glob: { type: 'array', items: string },
        maxReplacements: { ...integer, minimum: 1, maximum: 100000 },
        dryRun: { type: 'boolean' },
      },
      ['pattern', 'replacement'],
    ),
    readOnly: false,
  },
  {
    name: 'batch',
    description:
      'PTC 安全批处理：copy/move/remove 的预检（plan）与执行（resume/run）。action=plan 生成无副作用审计计划，之后必须用 action=resume + 同一个 id 执行该计划。operations 用相对 root 的路径，无覆盖、无符号链接穿越。危险操作，执行前向用户确认。',
    inputSchema: bounded(
      {
        root: string,
        action: { type: 'string', enum: ['plan', 'run', 'resume'] },
        operations: {
          type: 'array',
          maxItems: 512,
          items: bounded({ op: { type: 'string', enum: ['copy', 'move', 'remove'] }, path: string, to: string }, ['op', 'path']),
        },
        operationsRef: string,
        protect: { type: 'array', maxItems: 128, items: string },
        id: string,
      },
      ['action'],
    ),
    readOnly: false,
  },
  {
    name: 'result',
    description:
      'PTC 有界结果引用：put 存入对象行；page 按 equals/fields 过滤分页读取（offset/limit/maxBytes 预算）；release 释放。24h 过期。用于把大批量结果暂存在 worker 侧、按需取页，避免一次性塞满上下文。',
    inputSchema: bounded(
      {
        action: { type: 'string', enum: ['put', 'page', 'release'] },
        root: string,
        id: string,
        items: { type: 'array', maxItems: 10000, items: { type: 'object' } },
        offset: integer,
        limit: { ...integer, minimum: 1, maximum: 512 },
        maxBytes: { ...integer, minimum: 512, maximum: 65536 },
        fields: { type: 'array', maxItems: 32, items: string },
        equals: { type: 'object' },
      },
      ['action'],
    ),
    readOnly: false,
  },
]

/** 调用原生 worker：一次性 stdin JSON 进、stdout JSON 出（2 MiB 预算）。 */
function callWorker(tool, args, readOnly) {
  return new Promise((resolve, reject) => {
    const root = resolveRoot()
    const target = resolveTarget(args.path, root)
    if (!target) {
      resolve({ status: 'error', error: { code: 'INVALID_ARGUMENT', message: 'path must be a non-empty path.' } })
      return
    }
    const { __root, ...cleanArgs } = args
    const input = {
      root,
      scope: 'workbuddy',
      tool,
      args: { ...cleanArgs, path: target },
      read_only: readOnly,
    }
    if (!readOnly) input.write_roots = [root, os.tmpdir()]
    const payload = JSON.stringify(input)
    if (Buffer.byteLength(payload) > 2 * 1024 * 1024) {
      resolve({ status: 'error', error: { code: 'OUTPUT_LIMIT', message: 'Request exceeds 2 MiB.' } })
      return
    }
    const child = spawn(WORKER, [], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => child.kill(), 120000)
    child.stdout.on('data', (d) => {
      out += d
      if (out.length > 8 * 1024 * 1024) child.kill()
    })
    child.stderr.on('data', (d) => {
      err += d
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0 && !out) {
        resolve({ status: 'error', error: { code: 'RESULT_UNKNOWN', message: `worker exit ${code}: ${err.slice(0, 500)}` } })
        return
      }
      try {
        resolve(JSON.parse(out))
      } catch {
        resolve({ status: 'error', error: { code: 'RESULT_UNKNOWN', message: `invalid worker output: ${out.slice(0, 300)}` } })
      }
    })
    child.stdin.end(payload)
  })
}

/** JSON-RPC over stdio 主循环。 */
const rl = createInterface({ input: process.stdin, terminal: false })
rl.on('line', async (line) => {
  if (!line.trim()) return
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  const { id, method, params } = msg
  // 通知（无 id）不响应
  if (id === undefined || id === null) return
  try {
    let result
    switch (method) {
      case 'initialize':
        result = {
          protocolVersion: '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
          instructions:
            'Rust 原生文件工具（dsh-ops worker）：有界输出 + 分页。大目录检索优先用 grep/glob，避免逐文件读取；replace/batch 为写操作，执行前须向用户确认。',
        }
        break
      case 'ping':
        result = {}
        break
      case 'tools/list':
        result = {
          tools: TOOLS.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
            annotations: { readOnlyHint: !!t.readOnly, destructiveHint: !t.readOnly, openWorldHint: false },
          })),
        }
        break
      case 'tools/call': {
        const name = params?.name
        const tool = TOOLS.find((t) => t.name === name)
        if (!tool) throw new Error(`unknown tool: ${name}`)
        if (!fs.existsSync(WORKER)) throw new Error(`worker binary missing: ${WORKER}`)
        const value = await callWorker(name, params?.arguments ?? {}, tool.readOnly)
        const isError = value?.status === 'error'
        result = {
          content: [{ type: 'text', text: JSON.stringify(value) }],
          ...(isError ? { isError: true } : {}),
        }
        break
      }
      default:
        throw new Error(`method not found: ${method}`)
    }
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
  } catch (e) {
    process.stdout.write(
      JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message: String(e?.message ?? e) } }) + '\n',
    )
  }
})

process.stderr.write(`[dsh-ops-mcp] worker=${WORKER} root=${resolveRoot()}\n`)
