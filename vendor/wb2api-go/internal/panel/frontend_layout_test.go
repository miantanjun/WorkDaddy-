package panel

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// ── 为什么需要这组守卫 ──────────────────────────────────────────────────
// 2026-11-03 重写设计系统后，页面不报错但「静默变形」：账号表按钮竖着堆、
// 积分构成变成一列空行、缓存环中心数字被盖住、配置页输入框缩成一小截、
// 手机端主内容被挤进 190px 的第一列。这些都是单条 CSS 声明的丢失造成的，
// 而它们都有明确的「正确形态」，所以逐条锁死。

// cssRule 取出某个选择器的声明体（只取第一条匹配，够用）。
func cssRule(t *testing.T, css, sel string) string {
	t.Helper()
	rx := regexp.MustCompile(regexp.QuoteMeta(sel) + `\s*\{([^}]*)\}`)
	m := rx.FindStringSubmatch(css)
	if m == nil {
		t.Fatalf("找不到规则 %s", sel)
	}
	return m[1]
}

func cssOf(t *testing.T) string {
	t.Helper()
	html := panelIndexHTML(t)
	a := strings.Index(html, "<style>")
	b := strings.Index(html, "</style>")
	if a < 0 || b < 0 {
		t.Fatal("index.html 里没找到 <style> 块")
	}
	return html[a+7 : b]
}

// 账号表的操作列：必须横排，否则 6 个按钮在一个窄 td 里竖着堆，行高被撑到 160px。
func TestActsCellIsHorizontal(t *testing.T) {
	body := cssRule(t, cssOf(t), ".acts")
	if !strings.Contains(body, "flex") {
		t.Fatalf(".acts 必须是 flex（否则按钮竖排、行高翻 3 倍）：%s", body)
	}
	if strings.Contains(body, "column") {
		t.Fatalf(".acts 不能是 flex-direction:column：%s", body)
	}
}

// 缓存命中率环：旧实现的 ::after 实心圆会盖住中心数字，必须禁用。
func TestDonutInnerTextNotCovered(t *testing.T) {
	css := cssOf(t)
	if !strings.Contains(css, ".donut::after") {
		return // 直接删掉也可以
	}
	body := cssRule(t, css, ".donut::after")
	if strings.Contains(body, "background") && !strings.Contains(body, "content: none") {
		t.Fatalf(".donut::after 有背景色却没禁用 —— 会盖住中心的命中率数字：%s", body)
	}
}

// 积分到期分布：行必须是 3 列网格（天数 / 轨道 / 剩余积分），轨道内的段是 flex 撑开的。
func TestExpiryRowUsesGrid(t *testing.T) {
	body := cssRule(t, cssOf(t), ".pk-expiry-row")
	if !strings.Contains(body, "grid") || !strings.Contains(body, "grid-template-columns") {
		t.Fatalf(".pk-expiry-row 必须是 grid + 3 列，否则条形图塌成一列空行：%s", body)
	}
}

// 用量构成条：子元素用百分比宽度，容器必须是块级 flex 且有确定高度。
func TestUsageMixBar(t *testing.T) {
	body := cssRule(t, cssOf(t), ".us-mix")
	if !strings.Contains(body, "display: flex") {
		t.Fatalf(".us-mix 必须是 display:flex（inline-flex 会让 %% 宽度退回 0）：%s", body)
	}
	if !strings.Contains(body, "height") {
		t.Fatalf(".us-mix 缺 height：%s", body)
	}
}

// 表单输入框：配置页是竖排字段，输入框必须占满整列。
func TestFormInputFullWidth(t *testing.T) {
	css := cssOf(t)
	rx := regexp.MustCompile(`(?m)^input, select, textarea \{[^}]*width: 100%`)
	if !rx.MatchString(css) {
		t.Fatal("input/select/textarea 缺 width:100% —— 配置页输入框会缩成内容宽")
	}
}

// 手机端：侧栏变成 fixed 抽屉后，主网格必须单列，否则内容被塞进第一列。
func TestMobileShellSingleColumn(t *testing.T) {
	mc := readPanelFile(t, "mobile.css")
	if !strings.Contains(mc, ".shell { grid-template-columns: 1fr; }") {
		t.Fatal("mobile.css 缺 `.shell { grid-template-columns: 1fr; }` —— 手机端主内容会被挤在 sidebar 那 190px 里")
	}
}

// readPanelFile 读同目录的前端静态文件（mobile.css 等）。
func readPanelFile(t *testing.T, name string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(".", name))
	if err != nil {
		t.Fatalf("读不到 %s: %v", name, err)
	}
	return string(b)
}

// 卡片标题里的长说明不许 nowrap。
//
// 实测（2026-11-03，无头 Edge + 几何量化）：4 个页面里有多处 .box > header h3
// 带 white-space:nowrap，而 h3 内嵌了最长 60+ 汉字的 .hint 说明，导致
// scrollWidth 超 clientWidth 100~130px。1400px 宽时只是压到旁边空白的 .grow，
// 视觉上看不出来；视口收到 900px 时右侧的 .more 下钻链接会被文字**糊住**
// （实测重叠 104px），文字还会被 .box 的 overflow:hidden 从右侧切掉。
//
// 判据：h3 与 .hint 都必须是 white-space:normal（.hint 有 max-width:62ch，本就该折行）。
func TestCardHeaderHintWraps(t *testing.T) {
	// ⚠️ 必须先剥 CSS 注释再断言：上面那段说明文字里就写着 "white-space:nowrap"，
	// 不剥会把解释当成违规（本守卫第一版就是这么误报的）。
	css := regexp.MustCompile(`(?s)/\*.*?\*/`).ReplaceAllString(cssOf(t), "")
	for _, sel := range []string{".box > header h3", ".box > header .hint"} {
		body := cssRule(t, css, sel)
		if strings.Contains(body, "nowrap") {
			t.Errorf("%s 里有 white-space:nowrap —— 长说明会横向溢出并压住右侧下钻链接", sel)
		}
	}
}
