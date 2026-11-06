package panel

import (
	"regexp"
	"strings"
	"testing"
)

// ── 为什么要这条守卫 ────────────────────────────────────────────────────
// 内联 SVG **不带 width/height 属性时会默认撑满父容器**。
// 2026-11-03 重写 CSS 时漏了 `.lk-ok svg` 这一条，结果总览页那个 16×16 的对勾图标
// 被拉成 971px，`<circle>` 在页面上变成直径近千像素的绿色圆环 ——
// 视觉上极像「缓存命中率 donut 炸了」，排查方向一开始完全跑偏。
//
// 两类宿主都必须有尺寸来源，缺一就会复发：
//   ① JS 常量里的图标 —— 自带 width/height 属性；
//   ② 靠 CSS 定尺寸的宿主（导航图标、空态大图标、图表）—— 必须有对应规则。

func TestInlineSvgMustHaveSize(t *testing.T) {
	js := panelAppJS(t)
	lines := strings.Split(js, "\n")
	var bad []string
	for i, ln := range lines {
		if !strings.Contains(ln, "<svg") {
			continue
		}
		// ⚠️ 先剥行注释：注释里也会写 `<svg>`（例如图表的注释），不剥会误报
		trimmed := strings.TrimSpace(ln)
		if strings.HasPrefix(trimmed, "//") || strings.HasPrefix(trimmed, "*") || strings.HasPrefix(trimmed, "/*") {
			continue
		}
		// 窗口取本行 + 后 3 行：图表 SVG 是字符串拼接，属性可能落下一行
		win := ln
		for k := 1; k <= 3 && i+k < len(lines); k++ {
			win += lines[i+k]
		}
		// 图表：靠 CSS（.uschart svg { width:100%; height:auto }）定尺寸，不需要自带属性
		if strings.Contains(win, `role="img"`) {
			continue
		}
		if !strings.Contains(win, "width=") || !strings.Contains(win, "height=") {
			s := strings.TrimSpace(ln)
			if len(s) > 100 {
				s = s[:100]
			}
			bad = append(bad, s)
		}
	}
	if len(bad) > 0 {
		t.Fatalf("以下内联 SVG 没有显式 width/height（会被撑满父容器变成巨大图标）：\n  %s",
			strings.Join(bad, "\n  "))
	}
}

func TestSvgHostCssRulesExist(t *testing.T) {
	html := panelIndexHTML(t)
	// 每条都要能匹配到「选择器 + 花括号 + 含 width/max-width 的声明」
	for _, sel := range []string{".nav a svg", ".lk-ok svg", ".uschart svg", ".tc-empty svg"} {
		rx := regexp.MustCompile(regexp.QuoteMeta(sel) + `\s*\{[^}]*(width|max-width)\s*:`)
		if !rx.MatchString(html) {
			t.Errorf("缺少图标尺寸规则 %s —— 该处的 SVG 会撑满父容器", sel)
		}
	}
}
