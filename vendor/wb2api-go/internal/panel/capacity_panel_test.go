package panel

import (
	"net/http"
	"net/http/httptest"
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
	js := panelAppJS(t)

	// 2026-11-03 第二轮重构：容量不再独占一页，**内容整块并进「模型与容量」页**。
	// 断言随之改成三条真正重要的：
	//   ① 渲染锚点还在（内容没丢）
	//   ② 进入该页时真的会加载（VIEW_LOADERS 里挂着 loadCapacity）
	//   ③ #view-capacity 这个独立 section 必须已经不存在（否则就是"藏入口"而不是"合并"）
	if strings.Contains(body, `id="view-capacity"`) {
		t.Error("仍存在独立的 #view-capacity section —— 应当是内容并入 #view-models，不是换入口")
	}
	for _, id := range []string{"capIdle", "capBusy", "capDown", "capTotal", "capBody", "capSched", "capRefresh"} {
		if !strings.Contains(body, `id="`+id+`"`) {
			t.Errorf("缺少渲染锚点 #%s", id)
		}
	}
	// 锚点必须落在 model 页里
	mi := strings.Index(body, `id="view-models"`)
	ci := strings.Index(body, `id="capBody"`)
	ni := strings.Index(body, `id="view-config"`)
	if mi < 0 || ci < 0 || ni < 0 {
		t.Fatal("找不到 view-models / capBody / view-config")
	}
	if !(mi < ci && ci < ni) {
		t.Error("#capBody 不在 #view-models 与 #view-config 之间 —— 容量区块没并进模型页")
	}

	for _, fn := range []string{"loadCapacity", "renderCapacity", "capTime"} {
		if !strings.Contains(js, "function "+fn) && !strings.Contains(js, "async function "+fn) {
			t.Errorf("app.js 缺少 %s", fn)
		}
	}
	if !strings.Contains(js, "loadCapacity()") {
		t.Error("go() 的 VIEW_LOADERS 未接 loadCapacity（进页面不会加载容量数据）")
	}
}

// 面板 CSP：script-src/style-src 'self' 且无 font-src ⇒ 任何外链都会静默失效。
func TestPanelCapacityNoExternalResources(t *testing.T) {
	body := panelIndexHTML(t)
	// 只看新视图那一段，避免把别处（本来就没有的）外链误判成本板块的问题。
	// 2026-11-03：容量内容已并入 #view-models，段落边界改为「从 sec-capacity 标题
	// 到下一个分区标题（sec-*）/ 下一个 section」之间。
	// ⚠️ 先判 start 再切 slice —— 原来的写法在 start=-1 时会 panic 而不是给出可读报错。
	start := strings.Index(body, `id="sec-capacity"`)
	if start < 0 {
		t.Fatal("找不到容量区块（#sec-capacity）")
	}
	rel := len(body)
	for _, cut := range []string{"sec-logs", `</section>`} {
		if k := strings.Index(body[start:], cut); k >= 0 && k < rel {
			rel = k
		}
	}
	seg := body[start : start+rel]
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
