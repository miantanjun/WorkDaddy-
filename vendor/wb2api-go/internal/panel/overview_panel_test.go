package panel

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// 总览页（#overview）的守卫用例。
//
// 背景：这一页是照上游作者的设计稿（KeyBuddy 仪表盘）重画的，那份稿子是纯静态的
// ——0 处 fetch、数字全写死、外链 unpkg 图标字体、结尾一段内联 <script>。直接贴进来
// 在本项目的严格 CSP 下会三重失效（脚本被拦、图标被拦、字体被拦）。所以这组用例
// 钉住的正是"抄设计稿时最容易一起抄进来的四样东西"：
//  1. 外链资源（CDN 图标/字体）——离线或挂代理时整页掉图标；
//  2. 内联 <script>——CSP script-src 'self' 直接拦死（另有 TestIndexHTMLNoInlineScript 兜底）；
//  3. 默认落地页与骨架的可见状态不一致——冷加载会先闪一下账号表；
//  4. 空数据/边界数据把渲染打崩（0 账号、model_locks=null、企业版不限量 credits_total=-1）。

func panelIndexHTML(t *testing.T) string {
	t.Helper()
	p := newTestPanel()
	rec := httptest.NewRecorder()
	p.ServeHTTP(rec, httptest.NewRequest("GET", "/panel/", nil))
	if rec.Code != 200 {
		t.Fatalf("GET /panel/ = %d", rec.Code)
	}
	return rec.Body.String()
}

// TestPanelOverviewIsDefaultLanding 总览必须是默认落地页：导航首项高亮、骨架默认可见、
// 账号池默认隐藏。
//
// 为什么需要：go() 由 setTimeout(0) 兜底调用，冷加载时浏览器会先按 HTML 原始状态
// 画一帧。若骨架里 overview 带 hidden 而 accounts 不带，用户会先看到账号表再跳到总览，
// 表现为"页面闪一下"——功能没错但很廉价，而且没人会为它写 bug 单。
func TestPanelOverviewIsDefaultLanding(t *testing.T) {
	body := panelIndexHTML(t)

	// 导航首项 = 总览，且带 on（初始高亮）
	navIdx := strings.Index(body, `data-view="overview"`)
	if navIdx < 0 {
		t.Fatal(`导航缺少 data-view="overview"`)
	}
	navTagEnd := strings.Index(body[navIdx:], ">")
	navTag := body[navIdx : navIdx+navTagEnd+1]
	if !strings.Contains(navTag, `class="on"`) {
		t.Errorf("总览导航项初始应带 class=\"on\"：%s", navTag)
	}
	// 账号池不能再抢高亮
	accIdx := strings.Index(body, `data-view="accounts"`)
	if accIdx < 0 {
		t.Fatal(`导航缺少 data-view="accounts"`)
	}
	accTagEnd := strings.Index(body[accIdx:], ">")
	if strings.Contains(body[accIdx:accIdx+accTagEnd+1], `class="on"`) {
		t.Error("账号池导航项不该带 class=\"on\"（默认已改为总览）")
	}

	// 骨架可见性：overview 不带 hidden，accounts 带 hidden
	ovSec := strings.Index(body, `id="view-overview"`)
	if ovSec < 0 {
		t.Fatal(`缺少 id="view-overview"`)
	}
	ovLine := body[ovSec : ovSec+strings.Index(body[ovSec:], ">")]
	if strings.Contains(ovLine, "hidden") {
		t.Errorf("总览骨架不该带 hidden（默认落地页）：%s", ovLine)
	}
	accSec := strings.Index(body, `id="view-accounts"`)
	if accSec < 0 {
		t.Fatal(`缺少 id="view-accounts"`)
	}
	accLine := body[accSec : accSec+strings.Index(body[accSec:], ">")]
	if !strings.Contains(accLine, "hidden") {
		t.Errorf("账号池骨架应带 hidden（默认已改为总览）：%s", accLine)
	}
}

// TestPanelOverviewHasNoExternalResource 面板不得引用任何外部资源。
//
// 为什么需要：设计稿用了 unpkg 的 Boxicons。而本面板的 CSP 是
// style-src 'self' / default-src 'none'（无 font-src），外链 CSS 与图标字体都会被拦；
// 更现实的是这台机器常年挂代理，unpkg 一断整页面板就只剩文字。
// 断言方式：index.html 里出现任何 http(s):// 的外部 href/src 就算失败。
func TestPanelOverviewHasNoExternalResource(t *testing.T) {
	body := panelIndexHTML(t)
	for _, attr := range []string{"href=", "src="} {
		rest := body
		for {
			i := strings.Index(rest, attr)
			if i < 0 {
				break
			}
			rest = rest[i+len(attr):]
			// 取引号内的值，单双引号都要认
			if len(rest) == 0 {
				break
			}
			q := rest[0]
			if q != '"' && q != '\'' {
				continue
			}
			end := strings.IndexByte(rest[1:], q)
			if end < 0 {
				break
			}
			val := rest[1 : end+1]
			if strings.HasPrefix(val, "http://") || strings.HasPrefix(val, "https://") || strings.HasPrefix(val, "//") {
				t.Errorf("面板引用了外部资源（CSP 会拦、离线会掉）：%s%s", attr, val)
			}
		}
	}
	// Boxicons 的字面量也是设计稿带过来的，一并钉住
	if strings.Contains(body, "boxicons") {
		t.Error("面板不该引用 boxicons（设计稿的 CDN 图标库）")
	}
}

// dashHarness 在 node 里隔离求值 app.js 的「总览仪表盘」段落，并暴露 renderDashboard。
// 与 frontend_test.go 的其它 node 用例同款思路：只切一段、只喂它需要的符号，避免
// 把整个 app.js 的 DOM 依赖搬进测试。
const dashHarness = `const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync(process.argv[2], 'utf8');
const a = src.indexOf('/* ── 总览仪表盘');
const b = src.indexOf('async function loadOverview(');
if (a < 0 || b < 0 || b <= a) throw new Error('dashboard region not found');
const sinks = {};
function mk(id) {
  if (!sinks[id]) sinks[id] = {
    id, innerHTML: '', textContent: '', hidden: true, className: '', onclick: null,
    style: { setProperty() {}, width: '' },
    firstChild: { nodeValue: '' },
    addEventListener() {},
  };
  return sinks[id];
}
const ctx = {
  $: mk,
  esc: s => String(s == null ? '' : s),
  fmtTok: v => String(v == null ? 0 : v),
  fmtCredit: v => (v == null ? '—' : String(v)),
  fmtMs: ms => (ms ? ms + 'ms' : '—'),
  fmtRate: r => (r ? r + ' t/s' : '—'),
  fmtLocalDateTime: () => '2026-10-27 20:00',
  dur: s => s + 's',
  ago: () => '刚刚',
  parseAPITime: v => { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? t : 0; },
  toast: () => {},
  go: () => {},
  api: async () => ({ totals: {} }),
  location: { origin: 'http://127.0.0.1:7863' },
  history: { replaceState() {} },
  document: { querySelectorAll: () => [] },
  navigator: {},
  overviewData: null,
  Date, Math, Number, String, Map, Array, Object, JSON, isNaN, Promise,
};
vm.createContext(ctx);
vm.runInContext(src.slice(a, b) +
  '\nthis.renderDashboard = renderDashboard;' +
  '\nthis.renderDashUsage = renderDashUsage;' +
  '\nthis.setHours = h => { dashHours = h; };' +
  '\nthis.setUsage = (h, d) => { dashUsage.set(h, { at: Date.now(), data: d }); };', ctx);
const out = { sinks };
out.ov = ctx.renderDashboard;
out.usage = ctx.renderDashUsage;
out.setHours = ctx.setHours;
out.setUsage = ctx.setUsage;
out.dump = () => JSON.parse(JSON.stringify(sinks));
process.stdout.write(JSON.stringify({ ok: true }));
globalThis.__h = out;`

func runDash(t *testing.T, body string) (map[string]map[string]any, error) {
	t.Helper()
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node not installed; dashboard render tests skipped")
	}
	appJS, err := filepath.Abs("app.js")
	if err != nil {
		t.Fatal(err)
	}
	script := dashHarness + `
const h = globalThis.__h;
` + body + `
process.stdout.write('\n@@' + JSON.stringify(h.dump()));`
	f, err := os.CreateTemp(t.TempDir(), "dash-*.cjs")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteString(script); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	out, err := exec.Command(node, f.Name(), appJS).CombinedOutput()
	if err != nil {
		return nil, &dashErr{msg: string(out)}
	}
	i := strings.LastIndex(string(out), "@@")
	if i < 0 {
		return nil, &dashErr{msg: "no payload: " + string(out)}
	}
	var sinks map[string]map[string]any
	if err := json.Unmarshal([]byte(string(out)[i+2:]), &sinks); err != nil {
		return nil, err
	}
	return sinks, nil
}

type dashErr struct{ msg string }

func (e *dashErr) Error() string { return e.msg }

// TestDashboardRendersEmptyPool 空账号池 + model_locks=null 不得崩，且要给得出空态。
//
// 为什么需要：新装的网关就是 0 账号、model_locks 为 null（后端无锁时返回 nil）。
// 这里是整页最容易被除零和 null 打穿的地方：户均 = 剩余/账号数、占比 = n/总数、
// 命中率 = 命中/(命中+未命中)。
func TestDashboardRendersEmptyPool(t *testing.T) {
	sinks, err := runDash(t, `h.ov({ total: 0, healthy: 0, cooling: 0, paused: 0, disabled: 0,
  accounts: [], model_locks: null, version: '1.13.1-panel-wd3', uptime_sec: 0 });`)
	if err != nil {
		t.Fatalf("renderDashboard 抛错（空池）：%v", err)
	}
	if got := str(sinks, "ovCreditAvg"); got != "—" {
		t.Errorf("0 账号时户均应显示 —，实际 %q（除零未兜底）", got)
	}
	if got := str(sinks, "ovState"); got != "待添加账号" {
		t.Errorf("0 账号时状态应为「待添加账号」，实际 %q", got)
	}
	if got := str(sinks, "ovLocks"); !strings.Contains(got, "所有模型均可选") {
		t.Errorf("model_locks=null 时应给「所有模型均可选」空态，实际 %q", got)
	}
	if got := str(sinks, "ovDist"); !strings.Contains(got, "可用") {
		t.Errorf("账号分布应渲染四类状态，实际 %q", got)
	}
}

// TestDashboardModelLockStates 三种锁态必须各自可辨（整池不可用 / 没号可用 / 部分限流）。
//
// 为什么需要：后端 ModelLockRow.state 的三值语义不同——locked 要换模型、
// starved 等一下就好、partial 只是部分号被锁。若前端把它们染成同一个颜色/文案，
// 运维会对着"等一下就好"的模型去做无效操作。
func TestDashboardModelLockStates(t *testing.T) {
	sinks, err := runDash(t, `h.ov({ total: 3, healthy: 3, accounts: [], version: 'x', uptime_sec: 60,
  model_locks: [
    { model: 'kimi-k3.1-pro', realm: 'cn', total: 3, servable: 0, locked: 3, state: 'locked',
      unlock_at: '2099-01-01T00:00:00+08:00', fully_unlock_at: '2099-01-02T00:00:00+08:00', reason: '429 code 6004' },
    { model: 'glm-5.3', realm: 'cn', total: 3, servable: 0, locked: 0, state: 'starved',
      unlock_at: '', fully_unlock_at: '', reason: 'all in flight' },
    { model: 'deepseek-v4-pro', realm: 'global', total: 2, servable: 1, locked: 1, state: 'partial',
      unlock_at: '2099-01-03T00:00:00+08:00', fully_unlock_at: '2099-01-03T00:00:00+08:00' }
  ] });`)
	if err != nil {
		t.Fatalf("renderDashboard 抛错（锁态）：%v", err)
	}
	html := str(sinks, "ovLocks")
	for _, want := range []string{"整池不可用", "没号可用", "部分限流", "kimi-k3.1-pro", "国内版", "国际版"} {
		if !strings.Contains(html, want) {
			t.Errorf("模型额度缺 %q：%s", want, html)
		}
	}
	if got := str(sinks, "ovLockNote"); !strings.Contains(got, "2 个模型整池不可用") {
		t.Errorf("锁池汇总应为「2 个模型整池不可用」，实际 %q", got)
	}
}

// TestDashboardExcludesUnlimitedFromAverage 企业版不限量账号（credits_total=-1）不计入户均，
// 否则 3360/4 会被算成 3360/2 之类，数字虽小但会让人误判余额。
func TestDashboardExcludesUnlimitedFromAverage(t *testing.T) {
	sinks, err := runDash(t, `h.ov({ total: 3, healthy: 3, version: 'x', uptime_sec: 60, model_locks: [],
  accounts: [
    { credits: 1000, credits_total: 2000 },
    { credits: 500,  credits_total: 1000 },
    { credits: 0,    credits_total: -1 }
  ] });`)
	if err != nil {
		t.Fatalf("renderDashboard 抛错（不限量）：%v", err)
	}
	if got := str(sinks, "ovCreditAvg"); got != "750" {
		t.Errorf("户均应只按 2 个可计量账号算 =(1000+500)/2=750，实际 %q", got)
	}
	if got := str(sinks, "ovCredTotal"); !strings.Contains(got, "3,000") {
		t.Errorf("总额应为 2000+1000=3,000（不含 -1 的企业版），实际 %q", got)
	}
}

// TestDashUsageCacheHitRateWindow 用量窗口的聚合值要落到缓存环形图与四个 KPI 上，
// 且命中率分母为 0 时不得出现 NaN%。
func TestDashUsageCacheHitRateWindow(t *testing.T) {
	sinks, err := runDash(t, `h.setUsage(24, { totals: {
  requests: 100, errors: 2, prompt_tokens: 1000000, completion_tokens: 2000,
  credits: 12.5, cache_hit_tokens: 900000, cache_miss_tokens: 100000, cache_hit_rate: 90,
  avg_latency_ms: 1200, avg_tokens_per_second: 150 } });
h.setHours(24);
h.usage();`)
	if err != nil {
		t.Fatalf("renderDashUsage 抛错：%v", err)
	}
	if got := str(sinks, "ovHitPct"); got != "90%" {
		t.Errorf("命中率应显示 90%%，实际 %q", got)
	}
	if got := str(sinks, "ovReq"); got != "100" {
		t.Errorf("请求数应为 100，实际 %q", got)
	}

	sinks2, err := runDash(t, `h.setUsage(24, { totals: { requests: 0 } });
h.setHours(24);
h.usage();`)
	if err != nil {
		t.Fatalf("空窗口 renderDashUsage 抛错：%v", err)
	}
	if got := str(sinks2, "ovHitPct"); strings.Contains(got, "NaN") || got != "—" {
		t.Errorf("无 token 的窗口命中率应为 —（不得 NaN），实际 %q", got)
	}
}

func str(sinks map[string]map[string]any, id string) string {
	m := sinks[id]
	if m == nil {
		return ""
	}
	for _, k := range []string{"innerHTML", "textContent"} {
		if v, ok := m[k].(string); ok && v != "" {
			return v
		}
	}
	if fc, ok := m["firstChild"].(map[string]any); ok {
		if v, ok := fc["nodeValue"].(string); ok {
			return v
		}
	}
	return ""
}
