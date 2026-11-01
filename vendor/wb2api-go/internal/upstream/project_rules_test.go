package upstream

import (
	"encoding/json"
	"strings"
	"testing"
)

// 项目规则守卫：DSH / Claude Code 注入的 AGENTS.md 规则块，只允许收敛标题行里的
// 本地路径，正文必须逐字保留。
//
// 这组用例的"反面"比正面更重要：一旦哪天有人顺手给 system 消息加个摘要或截断，
// 用户的项目约定会被静默吞掉，表现为「AI 突然不遵守项目规范了」——这种 bug 没有
// 报错、极难定位，只能靠测试钉住。

func prepWithRules(t *testing.T, body string) map[string]any {
	t.Helper()
	out := PrepareBodyOptWithEffortsAndDefault([]byte(body), false, nil, nil)
	var obj map[string]any
	if err := json.Unmarshal(out, &obj); err != nil {
		t.Fatalf("prepare body: %v", err)
	}
	return obj
}

func firstSystemText(t *testing.T, obj map[string]any) string {
	t.Helper()
	msgs, _ := obj["messages"].([]any)
	if len(msgs) == 0 {
		t.Fatal("messages 为空")
	}
	msg, _ := msgs[0].(map[string]any)
	s, _ := msg["content"].(string)
	return s
}

// TestProjectRulesWindowsPathStripped Windows 绝对路径收敛为文件名，正文一字不动。
func TestProjectRulesWindowsPathStripped(t *testing.T) {
	rule := "<system-reminder>\n# Instructions from: C:\\Users\\Lyon\\proj\\AGENTS.md\n下次改代码前先跑回归。\n</system-reminder>"
	body := `{"model":"glm-5.2","messages":[{"role":"system","content":` + jsonStr(rule) + `},{"role":"user","content":"hi"}]}`
	obj := prepWithRules(t, body)
	got := firstSystemText(t, obj)

	if strings.Contains(got, `C:\Users\Lyon`) {
		t.Fatalf("本地路径泄漏到出站请求：%q", got)
	}
	if !strings.Contains(got, "Instructions from: AGENTS.md") {
		t.Fatalf("标题行未按预期收敛：%q", got)
	}
	if !strings.Contains(got, "下次改代码前先跑回归。") {
		t.Fatalf("规则正文被改动/丢弃：%q", got)
	}
}

// TestProjectRulesPosixPathStripped POSIX 路径同样处理。
func TestProjectRulesPosixPathStripped(t *testing.T) {
	rule := "Instructions from: /home/lyon/work/app/CLAUDE.md\n只改必要的文件。"
	body := `{"model":"glm-5.2","messages":[{"role":"system","content":` + jsonStr(rule) + `}]}`
	got := firstSystemText(t, prepWithRules(t, body))
	if strings.Contains(got, "/home/lyon/work/app") {
		t.Fatalf("POSIX 路径泄漏：%q", got)
	}
	if !strings.Contains(got, "Instructions from: CLAUDE.md") {
		t.Fatalf("标题行未收敛：%q", got)
	}
}

// TestProjectRulesNonPathUntouched 自然语言形式不能被误当路径改写。
func TestProjectRulesNonPathUntouched(t *testing.T) {
	rule := "Instructions from: the docs above\n正文"
	body := `{"model":"glm-5.2","messages":[{"role":"system","content":` + jsonStr(rule) + `}]}`
	got := firstSystemText(t, prepWithRules(t, body))
	if !strings.Contains(got, "Instructions from: the docs above") {
		t.Fatalf("非路径文本被误改：%q", got)
	}
}

// TestProjectRulesUserMessageUntouched 只动 system/developer；user 消息里的路径是
// 用户内容，改了等于篡改输入。
func TestProjectRulesUserMessageUntouched(t *testing.T) {
	body := `{"model":"glm-5.2","messages":[{"role":"user","content":"看下 C:\\Users\\Lyon\\a\\AGENTS.md Instructions from: C:\\x\\y\\Z.md"}]}`
	obj := prepWithRules(t, body)
	msgs, _ := obj["messages"].([]any)
	msg, _ := msgs[0].(map[string]any)
	if s, _ := msg["content"].(string); !strings.Contains(s, `C:\x\y\Z.md`) {
		t.Fatalf("user 内容被改写：%q", s)
	}
}

// TestProjectRulesMultipleKeptInOrder 多份规则同时存在：各自收敛、顺序不变、正文全在。
func TestProjectRulesMultipleKeptInOrder(t *testing.T) {
	rule := "Instructions from: C:\\p1\\AGENTS.md\n第一条规则\nInstructions from: C:\\p2\\SUB\\AGENTS.md\n第二条规则"
	body := `{"model":"glm-5.2","messages":[{"role":"system","content":` + jsonStr(rule) + `}]}`
	got := firstSystemText(t, prepWithRules(t, body))
	if strings.Count(got, "Instructions from: AGENTS.md") != 2 {
		t.Fatalf("两份标题未都收敛：%q", got)
	}
	i1 := strings.Index(got, "第一条规则")
	i2 := strings.Index(got, "第二条规则")
	if i1 < 0 || i2 < 0 || i1 > i2 {
		t.Fatalf("规则顺序被打乱：%q", got)
	}
}

// TestProjectRulesArrayContent 多模态 content 的 text part 也要处理。
func TestProjectRulesArrayContent(t *testing.T) {
	body := `{"model":"glm-5.2","messages":[{"role":"system","content":[{"type":"text","text":"Instructions from: D:/w/app/AGENTS.md\n规则正文"}]}]}`
	obj := prepWithRules(t, body)
	msgs, _ := obj["messages"].([]any)
	msg, _ := msgs[0].(map[string]any)
	parts, _ := msg["content"].([]any)
	if len(parts) != 1 {
		t.Fatalf("content parts=%d", len(parts))
	}
	text, _ := parts[0].(map[string]any)["text"].(string)
	if strings.Contains(text, "D:/w/app") || !strings.Contains(text, "规则正文") {
		t.Fatalf("数组 content 处理错误：%q", text)
	}
}

// TestStripProjectRulePathsCount 返回计数用于日志/观测（0 = 没动过）。
func TestStripProjectRulePathsCount(t *testing.T) {
	obj := map[string]any{"messages": []any{
		map[string]any{"role": "system", "content": "Instructions from: C:\\a\\AGENTS.md\nx"},
		map[string]any{"role": "developer", "content": "Instructions from: /b/CLAUDE.md\ny"},
	}}
	if n := StripProjectRulePaths(obj); n != 2 {
		t.Fatalf("count=%d want 2", n)
	}
	// 再跑一次应幂等：路径已收敛成文件名，不再计数。
	if n := StripProjectRulePaths(obj); n != 0 {
		t.Fatalf("二次处理 count=%d want 0（应幂等）", n)
	}
}

func jsonStr(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}
