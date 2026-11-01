// project_rules.go 客户端项目规则（AGENTS.md / CLAUDE.md 等）在出站前的处理。
//
// 背景：DSH、Claude Code 这类客户端会把项目规则文件的内容以
// `<system-reminder># Instructions from: C:\Users\<用户名>\<项目>\AGENTS.md ...` 的
// 形态注入 system 消息。这段正文是用户自己的业务上下文，网关**不应删改**（删了模型
// 就丢了项目约定，等于把 agent 变傻），但标题行里的本地绝对路径没必要发给上游——
// 它既泄漏用户名与目录结构，又对模型毫无用处。
//
// 本文件只做一件事：把标题行的路径收敛成文件名（AGENTS.md），其余字节原样保留。
// 有意不做的事，以及为什么：
//   - **不提取正文单独存**：Go 版没有「运行时摘要 / 历史截断」这两条会伤害正文的
//     路径（那是 Python 版的功能），所以正文天然完整保留，无需搬一套搬运逻辑。
//     多份规则按消息顺序自然共存，也不存在被合并的风险。
//   - **不豁免脱敏**：规则正文里若含上游已确认拒收的固定身份句，脱敏仍要生效
//     （否则整条请求 11128，用户连报错都看不懂）。Python 版的结论也是"必要的
//     兼容归一继续执行，项目指令不整段删除"。
//   - **只动 system / developer 消息**：user 消息里粘贴的路径是用户内容，
//     改写它属于篡改输入。
package upstream

import (
	"log"
	"regexp"
	"strings"
)

// instructionsFromRe 规则标题行：「Instructions from: <路径>」。
//
// 只匹配行首（允许 markdown 标题 `#`、引用 `>`、列表 `-`/`*` 前缀），要求行内有
// 路径分隔符才改写——"Instructions from: the docs" 这类自然语言不能被误当路径。
var instructionsFromRe = regexp.MustCompile(`(?im)^([ \t>#*-]*Instructions from:[ \t]*)([^\r\n<]+?)([ \t]*)$`)

// StripProjectRulePaths 出站前处理请求体里的项目规则标题，返回改写的标题条数。
// 直接在 obj["messages"] 上原地修改（与同文件其它 normalizer 一致）。
func StripProjectRulePaths(obj map[string]any) int {
	msgs, ok := obj["messages"].([]any)
	if !ok || len(msgs) == 0 {
		return 0
	}
	n := 0
	for _, m := range msgs {
		msg, ok := m.(map[string]any)
		if !ok {
			continue
		}
		role, _ := msg["role"].(string)
		if !strings.EqualFold(role, "system") && !strings.EqualFold(role, "developer") {
			continue
		}
		switch c := msg["content"].(type) {
		case string:
			out, k := stripRulePathsInText(c)
			if k > 0 {
				msg["content"] = out
				n += k
			}
		case []any:
			// 多模态 content：只改 text part；图片等其它 part 不动。
			for _, p := range c {
				pm, ok := p.(map[string]any)
				if !ok {
					continue
				}
				t, ok := pm["text"].(string)
				if !ok {
					continue
				}
				out, k := stripRulePathsInText(t)
				if k > 0 {
					pm["text"] = out
					n += k
				}
			}
		}
	}
	if n > 0 {
		log.Printf("project rules: %d 条指令标题的本地路径已收敛为文件名（正文原样保留）", n)
	}
	return n
}

// stripRulePathsInText 改写单段文本里的规则标题行。
func stripRulePathsInText(s string) (string, int) {
	if !strings.Contains(s, "Instructions from:") {
		return s, 0
	}
	n := 0
	out := instructionsFromRe.ReplaceAllStringFunc(s, func(line string) string {
		m := instructionsFromRe.FindStringSubmatch(line)
		if m == nil {
			return line
		}
		raw := strings.TrimSpace(m[2])
		// 去掉可能的引号包裹（`"C:\x\AGENTS.md"` / `'~/p/CLAUDE.md'`）。
		p := strings.Trim(raw, "\"'`")
		if !strings.ContainsAny(p, `/\`) {
			return line // 不是路径：自然语言或已经是纯文件名
		}
		base := pathBase(p)
		if base == "" || base == p {
			return line
		}
		n++
		return m[1] + base + m[3]
	})
	return out, n
}

// pathBase 取 Windows / POSIX 两种分隔符下的最后一段。
func pathBase(p string) string {
	if i := strings.LastIndexAny(p, `/\`); i >= 0 && i+1 < len(p) {
		return p[i+1:]
	}
	return p
}
