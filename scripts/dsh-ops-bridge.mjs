#!/usr/bin/env node
/**
 * dsh-ops-worker MCP bridge for WorkBuddy —— 精简版（v2，对应 dsh-ops 0.4.4）。
 *
 * 只暴露原生工具**真正做不到**的四个能力：
 *   read_files  一次读 1~32 个文件区间（原生 Read 一次只能一个文件）
 *   read_docx   直接读 DOCX 主体段落（不用起 python/office skill）
 *   read_table  直接读 CSV/TSV 单元格（引号/换行/转义由 worker 处理）
 *   result      结果超预算时按 ref:// 句柄分页取回
 *
 * 刻意**不**暴露：glob / grep / inspect_local_file / replace / write_file /
 * edit_file / copy / move / remove / diff / stat / batch —— 宿主的 Grep/Glob/
 * Read/Edit/Write 更强，并列暴露只会增加选择歧义。
 *
 * 也刻意**不**暴露 read_pdf —— 上游只支持 classic-xref + 标准 Type1 字体
 * （Helvetica/Courier/Times，Standard/WinAnsi）。实测真实发票、提单、PI 全部
 * 报 UNSUPPORTED_DOCUMENT / DOCUMENT_PARSE_ERROR，不可用。PDF 请走 pdf skill。
 *
 * worker 是 stdin->stdout 一次性 JSON 进程（native/src/main.rs），与 DSH/cordis
 * 宿主完全解耦；本桥沿用其 v0 裸协议（envelope.rs 有显式 v0 分支，非回退）。
 * 协议：newline-delimited JSON-RPC 2.0 over stdio（MCP 2025-03-26）。
 * 零第三方依赖，node >= 18 可直接运行。
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
const SERVER_VERSION = '0.4.4-wb2'

/** 单次调用的输出窗口。worker 侧硬上限是 128 KiB（envelope::MAX_OUTPUT_BYTES），
 *  这里留出余量即可；超预算的结果 worker 会自行截断或发 ref:// 句柄。 */
const OUT_LIMIT = 2 * 1024 * 1024
const CALL_TIMEOUT_MS = 120000
const REQ_LIMIT = 2 * 1024 * 1024

/** root：可用 DSH_OPS_ROOT 覆盖，否则取 MCP server 启动时的 cwd。 */
function resolveRoot() {
  const env = process.env.DSH_OPS_ROOT
  if (env && path.isAbsolute(env)) return env
  return process.cwd()
}

/** 路径解析：相对路径按 root 展开。文档类工具在 worker 侧**只认绝对路径**
 *  （否则报 "Expected one absolute, bounded host-resolved path"）。 */
function resolveTarget(raw, root) {
  if (raw === undefined || raw === null || raw === '') return root
  if (typeof raw !== 'string' || raw.includes('\0')) return undefined
  return path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(root, raw)
}

const string = { type: 'string' }
const integer = { type: 'integer', minimum: 0 }
const bounded = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false })

/** 工具参数 schema 与 0.4.4 的 lib/capabilities/{file,documents,result}.js 对齐。 */
const TOOLS = [
  {
    name: 'read_files',
    description:
      '一次读取 1~32 个文件的指定文本区间（UTF-8，按行）。原生 Read 一次只能读一个文件，这个能一次拿多份并返回每份的 complete/error。分页用 nextOffset 续行、nextIndex 续未读文件。适合同时看多个文件的头部/片段（如同时比对多份源码或配置）。',
    inputSchema: bounded(
      {
        files: {
          type: 'array',
          minItems: 1,
          maxItems: 32,
          items: bounded(
            {
              path: { ...string, description: '文件绝对路径。' },
              offset: { type: 'integer', minimum: 1, description: '起始行（1 基），默认 1。' },
              limit: { type: 'integer', minimum: 1, maximum: 10000, description: '行数，默认 200。' },
            },
            ['path'],
          ),
        },
      },
      ['files'],
    ),
    readOnly: true,
  },
  {
    name: 'read_docx',
    description:
      '读取 DOCX 正文段落（含表格的 table/row/cell 坐标），保留 Unicode 原文。范围为「正文主体」——不含页眉页脚、脚注、批注、版式。适合快速扫合同/保函/条款正文。仅支持 .docx（二进制 .doc 不支持）。段落分页：offset 1 基，limit 默认 200、上限 1000。',
    inputSchema: bounded(
      {
        path: { ...string, description: 'DOCX 绝对路径。' },
        offset: { type: 'integer', minimum: 1, description: '起始段落（1 基），默认 1。' },
        limit: { type: 'integer', minimum: 1, maximum: 1000, description: '段落数，默认 200。' },
      },
      ['path'],
    ),
    readOnly: true,
  },
  {
    name: 'read_table',
    description:
      '读取 CSV/TSV 的单元格（词法字符串，不做类型推断、不算公式）。正确处理引号内逗号、跨行记录、"" 转义。支持 UTF-8/UTF-16LE/UTF-16BE（严格解码，冲突 BOM 直接报错）。适合核对对账表、发票明细、PI 行项。数据行分页：offset 1 基（表头不计），limit 默认 200、上限 1000。',
    inputSchema: bounded(
      {
        path: { ...string, description: 'CSV/TSV 绝对路径。' },
        format: { type: 'string', enum: ['csv', 'tsv'], description: '省略时按扩展名推断（.tsv → tsv，其余 csv）。' },
        encoding: { type: 'string', enum: ['utf-8', 'utf-16le', 'utf-16be'], description: '默认 utf-8。' },
        header: { type: 'boolean', description: '首行是否为列名，默认 true。' },
        offset: { type: 'integer', minimum: 1, description: '起始数据行（1 基，表头不计），默认 1。' },
        limit: { type: 'integer', minimum: 1, maximum: 1000, description: '数据行数，默认 200。' },
      },
      ['path'],
    ),
    readOnly: true,
  },
  {
    name: 'result',
    description:
      '对某次调用返回的 ref:// 结果句柄做分页或释放。**只能 page/release**（Native 侧没有 put —— 句柄由 worker 在结果超输出预算时自动产生）。分页默认 offset=0 / limit=64 / maxBytes=16384；只有整页都展示完才可跟 nextOffset。equals 先过滤再投影；references 会随会话过期。仅当某次调用返回了 reference.refId 时才需要它。',
    inputSchema: bounded(
      {
        action: { type: 'string', enum: ['page', 'release'] },
        id: { ...string, description: '原样使用返回的 reference.refId（形如 ref://session/tool/uuid）。' },
        root: { ...string, description: '与该 handle 绑定的绝对根；省略用当前 root。' },
        offset: integer,
        limit: { type: 'integer', minimum: 1, maximum: 512, description: '默认 64。' },
        maxBytes: { type: 'integer', minimum: 512, maximum: 65536, description: '默认 16384。' },
        fields: { type: 'array', maxItems: 32, items: string, description: '最多 32 个顶层字段名。' },
        equals: { type: 'object', description: '最多 16 个顶层精确值过滤（投影与分页之前生效）。' },
      },
      ['action', 'id'],
    ),
    readOnly: true,
  },
]

/** 按工具把 args 里的路径规整为绝对路径（文档类工具在 worker 侧严格要求）。 */
function normalizeArgs(tool, args, root) {
  const out = { ...args }
  if (tool === 'read_files') {
    const files = Array.isArray(args.files) ? args.files : []
    out.files = files.map((f) => {
      const p = resolveTarget(f && f.path, root)
      return p ? { ...f, path: p } : f
    })
    return out
  }
  if (tool === 'read_docx' || tool === 'read_table') {
    const p = resolveTarget(args.path, root)
    if (p) out.path = p
    return out
  }
  if (tool === 'result') {
    const r = resolveTarget(args.root, root)
    if (r) out.root = r
    return out
  }
  return out
}

/** 调用原生 worker：一次性 stdin JSON 进、stdout JSON 出。 */
function callWorker(tool, args, readOnly) {
  return new Promise((resolve) => {
    const root = resolveRoot()
    const input = {
      root,
      scope: 'workbuddy',
      tool,
      args: normalizeArgs(tool, args, root),
      read_only: readOnly,
    }
    if (!readOnly) input.write_roots = [root, os.tmpdir()]
    const payload = JSON.stringify(input)
    if (Buffer.byteLength(payload) > REQ_LIMIT) {
      resolve({ status: 'error', error: { code: 'OUTPUT_LIMIT', message: 'Request exceeds 2 MiB.' } })
      return
    }
    if (!fs.existsSync(WORKER)) {
      resolve({ status: 'error', error: { code: 'WORKER_MISSING', message: `worker binary missing: ${WORKER}` } })
      return
    }
    const child = spawn(WORKER, [], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    let killed = false
    const timer = setTimeout(() => { killed = true; child.kill() }, CALL_TIMEOUT_MS)
    child.stdout.on('data', (d) => {
      out += d
      if (out.length > OUT_LIMIT) { killed = true; child.kill() }
    })
    child.stderr.on('data', (d) => { err += d })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ status: 'error', error: { code: 'RESULT_UNKNOWN', message: `worker spawn failed: ${String(e && e.message)}` } })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (killed) {
        // 超时或输出超窗：worker 可能已产生副作用，绝不能报成功。
        resolve({
          status: 'error',
          error: {
            code: 'RESULT_UNKNOWN',
            effectState: 'unknown',
            message: `worker stopped (${code === 124 ? 'timeout' : 'output/output-limit'}); effects unknown`,
          },
        })
        return
      }
      if (code !== 0 && !out.trim()) {
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
            'dsh-ops 原生文件读取（精简版）。只提供宿主做不到的四件事：read_files（一次多文件多区间）、' +
            'read_docx（DOCX 正文段落）、read_table（CSV/TSV 单元格）、result（ref:// 结果分页）。' +
            '日常单文件读、目录检索、改名/编辑请用宿主原生 Read/Grep/Glob/Edit。' +
            '注意：本服务不提供 PDF 读取（上游实现对真实发票/提单不适用），PDF 请用 pdf skill。',
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
        const value = await callWorker(name, params?.arguments ?? {}, tool.readOnly)
        const isError = value?.status === 'error' || value?.status === 'rejected'
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

process.stderr.write(`[dsh-ops-mcp] v${SERVER_VERSION} worker=${WORKER} root=${resolveRoot()}\n`)
