package panel

import (
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
)

// 「容量与调度」板块的前端守卫。
//
// 这页的价值全在「面板说的状态 = 真实选号结果」这一条上，所以守卫钉三件事：
//  1. 视图真的挂上了（导航项 + section + app.js 路由），而不是只有后端接口；
//  2. 三态文案与后端常量一一对应（前端自己造词会让面板和日志对不上）；
//  3. 没有引入外链资源（CSP 只允许 self，图标字体一律内联 SVG）。
func panelAppJS(t *testing.T) string {
	t.Helper()
	p := newTestPanel()
	rec := httptest.NewRecorder()
	p.ServeHTTP(rec, httptest.NewRequest("GET", "/panel/app.js", nil))
	if rec.Code != 200 {
		t.Fatalf("GET /panel/app.js = %d", rec.Code)
	}
	return rec.Body.String()
}

func TestPanelCapacityViewWired(t *testing.T) {
	body := panelIndexHTML(t)

	if !strings.Contains(body, `data-view="capacity"`) {
		t.Fatal("导航缺少「容量与调度」项")
	}
	idx := strings.Index(body, `id="view-capacity"`)
	if idx < 0 {
		t.Fatal("缺少 #view-capacity 视图")
	}
	// 非默认视图必须带 hidden：否则冷加载会先闪一屏容量表再跳回总览。
	tagStart := strings.LastIndex(body[:idx], "<section")
	tagEnd := strings.Index(body[idx:], ">")
	if tagStart < 0 || tagEnd < 0 {
		t.Fatal("视图标签解析失败")
	}
	if !strings.Contains(body[tagStart:idx+tagEnd+1], "hidden") {
		t.Error("#view-capacity 初始应带 hidden（只有总览是默认落地页）")
	}
	for _, id := range []string{"capIdle", "capBusy", "capDown", "capTotal", "capBody", "capSched", "capRefresh"} {
		if !strings.Contains(body, `id="`+id+`"`) {
			t.Errorf("缺少渲染锚点 #%s", id)
		}
	}

	js := panelAppJS(t)
	for _, fn := range []string{"loadCapacity", "renderCapacity", "capTime"} {
		if !strings.Contains(js, "function "+fn) && !strings.Contains(js, "async function "+fn) {
			t.Errorf("app.js 缺少 %s", fn)
		}
	}
	if !strings.Contains(js, "capacity: '容量与调度'") {
		t.Error("TITLES 缺少 capacity（页面标题会显示 undefined）")
	}
	if !strings.Contains(js, "if (v === 'capacity') loadCapacity();") {
		t.Error("go() 未接 capacity 视图（点进去不会加载数据）")
	}
}

// 三态文案必须与后端常量语义一致：idle=空闲 / busy=拥堵 / unavailable=不可用。
func TestPanelCapacityStateVocabulary(t *testing.T) {
	js := panelAppJS(t)
	re := regexp.MustCompile(`CAP_STATE = \{[^}]*\}`)
	m := re.FindString(js)
	if m == "" {
		t.Fatal("app.js 缺少 CAP_STATE 映射")
	}
	for _, want := range []string{`idle: ['空闲'`, `busy: ['拥堵'`, `unavailable: ['不可用'`} {
		if !strings.Contains(m, want) {
			t.Errorf("CAP_STATE 缺少 %s（实际 %s）", want, m)
		}
	}
	// 判定依据文案：四种原因都要有可读解释，否则表格出现英文键名（model_lock）。
	for _, key := range []string{"model_lock:", "account_cooling:", "in_flight:", "no_account:"} {
		if !strings.Contains(js, key) {
			t.Errorf("CAP_BLOCK 缺少 %s 的中文解释", key)
		}
	}
}

// 面板 CSP：script-src/style-src 'self' 且无 font-src ⇒ 任何外链都会静默失效。
func TestPanelCapacityNoExternalResources(t *testing.T) {
	body := panelIndexHTML(t)
	// 只看新视图那一段，避免把别处（本来就没有的）外链误判成本板块的问题。
	start := strings.Index(body, `id="view-capacity"`)
	end := strings.Index(body[start:], "</section>")
	if start < 0 || end < 0 {
		t.Fatal("找不到 #view-capacity 段落")
	}
	seg := body[start : start+end]
	for _, bad := range []string{"http://", "https://", "//cdn", "unpkg", "jsdelivr", "@import"} {
		if strings.Contains(seg, bad) {
			t.Errorf("容量视图引用了外链资源 %q（CSP 会拦掉）", bad)
		}
	}
}

// 未装配账号池时必须给 503 而不是 panic（面板是运维入口，崩了连自诊断都没了）。
func TestPanelCapacityWithoutPoolIs503(t *testing.T) {
	p := New(Config{Version: "test", APIKey: ""})
	rec := httptest.NewRecorder()
	p.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/panel/api/capacity", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d want 503", rec.Code)
	}
}
