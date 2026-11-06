package panel

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// 信息架构守卫（2026-11-03 重构后新增）。
//
// 背景：重构前 9 个一级标签里，「积分」在 5 处各有一套呈现（总览 / 账号池 /
// 积分构成 / 用量 / 日志），其中缓存命中率还有**两套不同算法**（一处取后端
// cache_hit_rate 字段、一处自己 hit/(hit+miss)），同一个指标能读出两个数；
// 「用量」在 3 处重复（总览卡 / 用量页 / 日志页请求记录）。
//
// 这一组用例钉住的不是"现在长什么样"，而是**归属规则**：
//   · 每个视图只归一个分组，分组在导航里只出现一次
//   · 积分余额流水只存在于「用量与积分」页（不许再散回日志页）
//   · 网关插件不许再自建一级标签（要嵌进「模型」页）
//
// 为什么值得写：这类漂移是"加一个小卡片"式的渐进退化，单个 PR 看起来都合理，
// 三轮之后又回到五处重复。只有静态断言能拦住。

func htmlOf(t *testing.T) string {
	t.Helper()
	b, err := os.ReadFile("index.html")
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// I1 导航必须是**单层 4 项**，且不允许再有二级标签栏。
// 历史（这条守卫自己改过两次，值得记下来）：
//   · 2026-11-03 上午：9 个平铺标签 → 5 个分组 + 右侧 subnav
//   · 2026-11-03 中午：用户反馈「把菜单塞进右侧切换，还不如全放左侧」⇒
//     改成 4 页**内容真合并**、导航单层。subnav 必须彻底消失，
//     否则就会重现"多一次点击才看到同一个功能"的问题。
func TestNavIsSingleLevelWithFourPages(t *testing.T) {
	html := htmlOf(t)
	navPart := html
	if i := strings.Index(html, `id="navDrawer"`); i >= 0 {
		navPart = html[i:]
	}
	if j := strings.Index(navPart, `</nav>`); j >= 0 {
		navPart = navPart[:j]
	}
	views := regexp.MustCompile(`data-view="([a-z]+)"`).FindAllStringSubmatch(navPart, -1)
	if len(views) != 4 {
		names := make([]string, 0, len(views))
		for _, v := range views {
			names = append(names, v[1])
		}
		t.Fatalf("一级导航应为 4 项（总览与用量 / 账号与任务 / 模型与容量 / 系统与日志），实际 %d 项：%v", len(views), names)
	}
	want := map[string]bool{"overview": true, "accounts": true, "models": true, "config": true}
	for _, v := range views {
		if !want[v[1]] {
			t.Errorf("导航出现未预期的一级项 %q（只允许 overview/accounts/models/config）", v[1])
		}
	}

	// 二级标签栏必须不存在（HTML 与 JS 都不许再出现）
	if strings.Contains(html, `id="subnav"`) {
		t.Error("index.html 里还有 #subnav —— 导航已回到单层，二级标签栏必须删掉")
	}
	js := panelAppJS(t)
	if strings.Contains(js, "renderSubnav") {
		t.Error("app.js 里还有 renderSubnav —— 导航已回到单层")
	}
}

// I2 合并后只允许 4 个 section；被合并的内容必须**真的在这 4 页里面**。
// 反例（本轮要防的）：把 #view-usage 留着，只是在导航里指到 overview ——
// 那是"换入口"，用户切过去还是空白，等于没合并。
func TestOnlyFourSectionsAndMergedContentInside(t *testing.T) {
	html := htmlOf(t)
	sections := regexp.MustCompile(`<section class="view" id="view-([a-z]+)"`).FindAllStringSubmatch(html, -1)
	got := make([]string, 0, len(sections))
	for _, m := range sections {
		got = append(got, m[1])
	}
	if len(sections) != 4 {
		t.Fatalf("合并后应只有 4 个 section，实际 %d 个：%v（残留的旧 section 会让「合并」变成「换入口」）", len(sections), got)
	}
	want := []string{"overview", "accounts", "models", "config"}
	for i, w := range want {
		if i >= len(got) || got[i] != w {
			t.Fatalf("section 顺序应为 %v，实际 %v", want, got)
		}
	}

	// 被合并进来的区块，各自的锚点必须落在正确的宿主页里。
	type chk struct{ anchor, host, next string }
	for _, c := range []chk{
		// 用量 / 积分构成 → 总览
		{`id="sec-usage"`, `id="view-overview"`, `id="view-accounts"`},
		{`id="sec-packages"`, `id="view-overview"`, `id="view-accounts"`},
		{`id="creditBody"`, `id="view-overview"`, `id="view-accounts"`},
		// 任务中心 → 账号（账号页从 view-accounts 开始、到 view-models 结束）
		{`id="sec-tasks"`, `id="view-accounts"`, `id="view-models"`},
		// 容量与调度 → 模型
		{`id="sec-capacity"`, `id="view-models"`, `id="view-config"`},
		// 日志 → 系统（系统页是最后一页，边界用文件末尾的 </body>）
		{`id="sec-logs"`, `id="view-config"`, `</body>`},
	} {
		a := strings.Index(html, c.anchor)
		if a < 0 {
			t.Errorf("找不到锚点 %s（内容可能被删了）", c.anchor)
			continue
		}
		lo := strings.Index(html, c.host)
		hi := strings.Index(html, c.next)
		if lo < 0 || hi < 0 {
			t.Errorf("定位宿主页失败：%s / %s", c.host, c.next)
			continue
		}
		if !(lo < a && a <= hi) {
			t.Errorf("%s 不在 %s..%s 区间内 —— 被合并的内容没进对的页", c.anchor, c.host, c.next)
		}
	}
}

// I3 积分余额流水只能出现一次（合并后它属于「总览与用量」页）。
// 重构前它在日志页与用量页各有一份，同一个数能读出两个值。
func TestCreditHistoryAppearsOnce(t *testing.T) {
	html := htmlOf(t)
	if n := strings.Count(html, `id="creditBody"`); n != 1 {
		t.Fatalf("#creditBody 出现 %d 次（积分流水必须唯一，否则同一指标多个来源）", n)
	}
	// 必须在总览页里
	a := strings.Index(html, `id="creditBody"`)
	lo := strings.Index(html, `id="view-overview"`)
	hi := strings.Index(html, `id="view-accounts"`)
	if !(lo < a && a < hi) {
		t.Fatal("积分流水不在「总览与用量」页里")
	}
}

// I4 缓存命中率只能有一个算法来源：读后端字段，不许前端自己再算一遍。
// 重构前总览用 cache_hit_rate（后端算），用量页 KPI 用 hit/(hit+miss)（前端算），
// 同一时刻两页能显示不同百分比。
func TestCacheHitRateHasSingleSource(t *testing.T) {
	js := panelAppJS(t)
	// 允许兜底：后端没给 cache_hit_rate 时用 hit/(hit+miss) 补
	// —— 但必须收敛到同一个函数里，不许各写各的。
	calc := regexp.MustCompile(`cache_hit_rate`).FindAllString(js, -1)
	if len(calc) < 1 {
		t.Fatal("app.js 不再使用后端 cache_hit_rate 字段（前端在自算？）")
	}
	// 前端自算只许出现在一处：统计 `hit / (hit + miss)` 这种模式的次数
	selfCalc := regexp.MustCompile(`hit\s*\+\s*miss`).FindAllString(js, -1)
	if len(selfCalc) > 2 {
		t.Errorf("前端自算命中率的写法出现 %d 处（应集中到 1~2 处：一处算、一处提示），指标会打架", len(selfCalc))
	}
}

// I5 网关插件必须嵌进「模型」页，不许再自建一级标签。
// 这一条同时守住"面板标签数不再增长"和"相近功能不分散"。
func TestGatewayPluginDoesNotCreateTab(t *testing.T) {
	b, err := os.ReadFile("../../../scripts/side-gateway-ui.js")
	if err != nil {
		t.Skip("侧车网关插件不在本仓（已剥离），跳过")
	}
	src := string(b)
	// 剥注释：注释里提到 sideapi 是说明历史，不算违规
	src = regexp.MustCompile(`(?s)/\*.*?\*/`).ReplaceAllString(src, "")
	src = regexp.MustCompile(`(?m)^\s*//.*$`).ReplaceAllString(src, "")

	// 不许创建 tab 元素
	if strings.Contains(src, `className = 'wbs-tab'`) || strings.Contains(src, `className="wbs-tab"`) {
		t.Error("网关插件仍在自建 .wbs-tab —— 应改为嵌入「模型」页（用户反馈：相近功能不该分两处）")
	}
	// 必须以 models 页为宿主
	if !strings.Contains(src, "HOST_PANE = 'models'") {
		t.Error("网关插件未声明 HOST_PANE = 'models'（嵌入目标应是模型页）")
	}
	// 必须挂成宿主页的第一块（"总开关"先看到）
	if !strings.Contains(src, "insertBefore(card, host.firstChild)") {
		t.Error("网关卡片未插到模型页最前面（顺序应为：网关总开关 → 模型表）")
	}
}

// I6 卡片下钻链接必须真的能点：data-go 的目标视图必须存在。
func TestDrilldownLinksPointToRealViews(t *testing.T) {
	html := htmlOf(t)
	for _, m := range regexp.MustCompile(`data-go="([a-z]+)"`).FindAllStringSubmatch(html, -1) {
		if !strings.Contains(html, `id="view-`+m[1]+`"`) {
			t.Errorf("下钻链接 data-go=%q 指向不存在的视图", m[1])
		}
	}
	// 页内跳转（data-jump）必须指向真实存在的分区标题，否则点了没反应、
	// 而且不报错 —— 合并后这类链接是"内容就在下面"的唯一指路方式。
	for _, m := range regexp.MustCompile(`data-jump="([a-z-]+)"`).FindAllStringSubmatch(html, -1) {
		if !strings.Contains(html, `id="`+m[1]+`"`) {
			t.Errorf("页内跳转 data-jump=%q 找不到对应元素（点了不会有反应）", m[1])
		}
	}
	// 至少要有两个页内跳转：说明合并后的内容确实靠滚动衔接，而不是又跳页
	n := len(regexp.MustCompile(`data-jump="`).FindAllString(html, -1))
	if n < 2 {
		t.Errorf("页内跳转只有 %d 个 —— 合并后「明细 →」「容量与调度 →」应当是页内滚动", n)
	}
}

// I7 轮询分支必须用合并后的 4 个视图名。
//
// 反例（本轮真踩到）：合并导航时把 view 从 9 个砍到 4 个，但 refreshVisible()
// 里还留着旧的 'logs' / 'taskscenter' 分支。`view` 永远不可能等于这两个值，
// ⇒ 模型页与系统页的 5 秒自动刷新**从来没跑过**。页面不报错、不白屏，
// 只是数据停在打开那一刻 —— 这是最难发现的一类回归。
//
// 判据：refreshVisible 里出现的每个字符串字面量视图名，都必须是真实存在的
// section id；且 4 个视图都要有对应分支。
func TestPollingUsesOnlyExistingViews(t *testing.T) {
	js := panelAppJS(t)
	// 剥注释再断言：注释里会提到旧名字来说明历史
	js = regexp.MustCompile(`(?s)/\*.*?\*/`).ReplaceAllString(js, "")
	js = regexp.MustCompile(`(?m)^\s*//.*$`).ReplaceAllString(js, "")

	i := strings.Index(js, "function refreshVisible()")
	if i < 0 {
		t.Fatal("app.js 里找不到 refreshVisible()（轮询入口被删了？）")
	}
	body := js[i:]
	if j := strings.Index(body, "\n}"); j > 0 {
		body = body[:j]
	}

	real := map[string]bool{"overview": true, "accounts": true, "models": true, "config": true}
	seen := map[string]bool{}
	for _, m := range regexp.MustCompile(`view === '([a-z]+)'`).FindAllStringSubmatch(body, -1) {
		name := m[1]
		seen[name] = true
		if !real[name] {
			t.Errorf("refreshVisible() 里出现已不存在的视图 %q —— 该分支永远不会命中，这页的自动刷新是死的", name)
		}
	}
	for v := range real {
		if !seen[v] {
			t.Errorf("refreshVisible() 缺少 %q 分支 —— 这页进去后数据不会自动更新", v)
		}
	}
}

// I8 通过密钥门后必须**立即**重跑当前页的加载器。
//
// 反例（旧版就有，实测复现）：首屏 go() 在没密钥时已经跑过一遍，各块失败并留下
// 红字「用量读取失败：密钥无效或未填写」。原来 btnKey 只调 start()，而 start()
// 只补 loadOverview + loadCompensation + 5 秒轮询 —— 用量卡要等下一次轮询才恢复。
// 实测：填完密钥后 1.5s 仍是红字、6.5s 才正常。用户看到那 5 秒会以为密钥填错了。
//
// 判据：btnKey 的处理体里必须出现 VIEW_LOADERS[view] 的重跑。
func TestKeyGateRefreshesCurrentViewImmediately(t *testing.T) {
	js := panelAppJS(t)
	js = regexp.MustCompile(`(?s)/\*.*?\*/`).ReplaceAllString(js, "")
	js = regexp.MustCompile(`(?m)^\s*//.*$`).ReplaceAllString(js, "")

	i := strings.Index(js, "'btnKey').onclick")
	if i < 0 {
		i = strings.Index(js, `"btnKey").onclick`)
	}
	if i < 0 {
		t.Fatal("app.js 里找不到密钥门的 btnKey 处理逻辑")
	}
	body := js[i:]
	if j := strings.Index(body, "\n};"); j > 0 {
		body = body[:j]
	}
	if !strings.Contains(body, "VIEW_LOADERS") {
		t.Error("填完密钥后没有重跑当前页的 VIEW_LOADERS —— 首屏失败留下的「密钥无效」红字要等 5 秒轮询才消失")
	}
}
