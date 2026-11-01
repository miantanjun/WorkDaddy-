package server

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
)

// imageCall 一次上游调用快照（断言出站路径与 body 用）。
type imageCall struct {
	Path string
	Body map[string]any
}

// newImageUpstream 构造生图假上游：按调用序记录 path/body，由 fn 决定响应。
// 生图 handler 走 Client.HTTP（有总时长），所以这里只需覆写 HTTP.Transport。
func newImageUpstream(t *testing.T, fn func(c imageCall) (int, string)) (*upstream.Client, *[]imageCall) {
	t.Helper()
	calls := &[]imageCall{}
	c := &upstream.Client{
		HTTP: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			raw, _ := io.ReadAll(r.Body)
			body := map[string]any{}
			_ = json.Unmarshal(raw, &body)
			call := imageCall{Path: r.URL.Path, Body: body}
			*calls = append(*calls, call)
			status, resp := fn(call)
			return &http.Response{
				StatusCode: status,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       io.NopCloser(strings.NewReader(resp)),
			}, nil
		})},
		ChatBaseCN:    "https://fake.example",
		BillingBaseCN: "https://fake.example",
	}
	return c, calls
}

const imageOKBody = `{"code":0,"data":{"created":1753600000,"data":[{"url":"https://img.example/a.png","revised_prompt":"rp"}],"usage":{"credit":12.5,"input_tokens":0,"output_tokens":1,"total_tokens":1}}}`

func postImage(t *testing.T, h *Handler, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rec, req)
	return rec
}

// TestImagesGenerationsForcesURLFormat 文生图成功路径：
//   - 出站路径必须是 /v2/images/generations；
//   - 出站 response_format 必须是 url（客户端要 b64 由网关转，不让上游忽略）；
//   - 响应保留 data[].url 与 usage。
func TestImagesGenerationsForcesURLFormat(t *testing.T) {
	up, calls := newImageUpstream(t, func(imageCall) (int, string) { return 200, imageOKBody })
	h := NewHandler(Config{
		Pool:     testPoolWith(&auth.Auth{UID: "u1", AccessToken: "at1", ExpiresAt: 9999999999}),
		Upstream: up,
	})
	rec := postImage(t, h, "/v1/images/generations",
		`{"model":"cn:hunyuan-image-alpha","prompt":"一只猫","response_format":"b64_json"}`)
	if rec.Code != 200 {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if len(*calls) != 1 {
		t.Fatalf("upstream calls=%d want 1", len(*calls))
	}
	if (*calls)[0].Path != "/v2/images/generations" {
		t.Fatalf("path=%s", (*calls)[0].Path)
	}
	if got := (*calls)[0].Body["model"]; got != "hunyuan-image-alpha" {
		t.Fatalf("出站 model=%v，必须剥掉 cn: 前缀（上游生图不认前缀，会 14401 route not found）", got)
	}
	if got := (*calls)[0].Body["response_format"]; got != "url" {
		t.Fatalf("出站 response_format=%v，必须强制 url", got)
	}
	if _, ok := (*calls)[0].Body["image_data"]; ok {
		t.Fatal("文生图不应携带 image_data")
	}
	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bad json: %v", err)
	}
	rows, _ := resp["data"].([]any)
	if len(rows) != 1 {
		t.Fatalf("data rows=%v", resp["data"])
	}
	if u, _ := rows[0].(map[string]any)["url"].(string); u == "" {
		t.Fatal("响应丢了 url")
	}
	if _, ok := resp["usage"]; !ok {
		t.Fatal("响应丢了 usage（无法核对计费）")
	}
}

// TestImagesEditsWrapsImageArray 图生图：图片字段必须是数组形态（上游契约）。
func TestImagesEditsWrapsImageArray(t *testing.T) {
	up, calls := newImageUpstream(t, func(imageCall) (int, string) { return 200, imageOKBody })
	h := NewHandler(Config{
		Pool:     testPoolWith(&auth.Auth{UID: "u1", AccessToken: "at1", ExpiresAt: 9999999999}),
		Upstream: up,
	})
	// "aGVsbG8=" = hello
	rec := postImage(t, h, "/v1/images/edits",
		`{"model":"hunyuan-image-alpha","prompt":"改一下","image_data":"data:image/png;base64,aGVsbG8="}`)
	if rec.Code != 200 {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if (*calls)[0].Path != "/v2/images/edits" {
		t.Fatalf("path=%s", (*calls)[0].Path)
	}
	arr, ok := (*calls)[0].Body["image_data"].([]any)
	if !ok || len(arr) != 1 {
		t.Fatalf("image_data 必须是单元素数组，实际=%v", (*calls)[0].Body["image_data"])
	}
	if arr[0] != "aGVsbG8=" {
		t.Fatalf("data: 前缀未剥离：%v", arr[0])
	}
}

// TestImagesNoRetryOnServerError 红线：5xx 绝不换号重试（可能已计费，重试=双倍付费）。
func TestImagesNoRetryOnServerError(t *testing.T) {
	up, calls := newImageUpstream(t, func(imageCall) (int, string) {
		return 500, `{"error":"boom"}`
	})
	h := NewHandler(Config{
		Pool: testPoolWith(
			&auth.Auth{UID: "u1", AccessToken: "at1", ExpiresAt: 9999999999},
			&auth.Auth{UID: "u2", AccessToken: "at2", ExpiresAt: 9999999999},
		),
		Upstream: up,
	})
	rec := postImage(t, h, "/v1/images/generations", `{"model":"hunyuan-image-alpha","prompt":"x"}`)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status=%d want 502", rec.Code)
	}
	if len(*calls) != 1 {
		t.Fatalf("5xx 后上游被调用 %d 次，必须只调 1 次", len(*calls))
	}
}

// TestImagesRetriesOnHardCredit 明确账号级拒绝（402 余额不足）才换号重试。
func TestImagesRetriesOnHardCredit(t *testing.T) {
	n := 0
	up, calls := newImageUpstream(t, func(imageCall) (int, string) {
		n++
		if n == 1 {
			return 402, `{"error":{"message":"credit exhausted"}}`
		}
		return 200, imageOKBody
	})
	h := NewHandler(Config{
		Pool: testPoolWith(
			&auth.Auth{UID: "u1", AccessToken: "at1", ExpiresAt: 9999999999},
			&auth.Auth{UID: "u2", AccessToken: "at2", ExpiresAt: 9999999999},
		),
		Upstream: up,
		MaxRotate: 3,
	})
	rec := postImage(t, h, "/v1/images/generations", `{"model":"hunyuan-image-alpha","prompt":"x"}`)
	if rec.Code != 200 {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if len(*calls) != 2 {
		t.Fatalf("calls=%d want 2（一个 402 + 一个成功）", len(*calls))
	}
}

// TestImagesB64UnsafeHostDegrades b64 转换失败时**降级返回 URL**，绝不报错让用户重画：
// 图已出、已计费，URL 仍然可用。
func TestImagesB64UnsafeHostDegrades(t *testing.T) {
	up, calls := newImageUpstream(t, func(imageCall) (int, string) { return 200, imageOKBody })
	h := NewHandler(Config{
		Pool:     testPoolWith(&auth.Auth{UID: "u1", AccessToken: "at1", ExpiresAt: 9999999999}),
		Upstream: up,
	})
	rec := postImage(t, h, "/v1/images/generations",
		`{"model":"hunyuan-image-alpha","prompt":"x","response_format":"b64_json"}`)
	if rec.Code != 200 {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if len(*calls) != 1 {
		t.Fatalf("calls=%d，b64 转换失败不得重试", len(*calls))
	}
	var resp map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	w, _ := resp["warning"].(map[string]any)
	if w == nil || w["code"] != "image_conversion_failed" {
		t.Fatalf("缺少降级告警：%s", rec.Body.String())
	}
	rows, _ := resp["data"].([]any)
	if len(rows) != 1 || rows[0].(map[string]any)["url"] == nil {
		t.Fatal("降级响应必须保留 url")
	}
}

// TestImagesRejectsBadParams 参数校验：未知字段 / n 越界 / 图片来源数量 / 非 HTTPS URL。
func TestImagesRejectsBadParams(t *testing.T) {
	cases := []struct {
		name string
		path string
		body string
	}{
		{"未知字段", "/v1/images/generations", `{"model":"m","prompt":"x","foo":1}`},
		{"n 越界", "/v1/images/generations", `{"model":"m","prompt":"x","n":11}`},
		{"n 非整数", "/v1/images/generations", `{"model":"m","prompt":"x","n":1.5}`},
		{"prompt 空", "/v1/images/generations", `{"model":"m","prompt":"  "}`},
		{"model 为 auto", "/v1/images/generations", `{"model":"auto","prompt":"x"}`},
		{"文生图带图", "/v1/images/generations", `{"model":"m","prompt":"x","image_data":"aGVsbG8="}`},
		{"图生图无图", "/v1/images/edits", `{"model":"m","prompt":"x"}`},
		{"图生图两张图", "/v1/images/edits", `{"model":"m","prompt":"x","image_data":"aGVsbG8=","image_url":"https://a/b.png"}`},
		{"image_url 非 https", "/v1/images/edits", `{"model":"m","prompt":"x","image_url":"http://a/b.png"}`},
		{"response_format 非法", "/v1/images/generations", `{"model":"m","prompt":"x","response_format":"png"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// 参数错误必须在**打上游之前**拦截，因此假上游一旦被调用即失败。
			up, calls := newImageUpstream(t, func(imageCall) (int, string) {
				t.Fatal("参数错误不应触达上游")
				return 200, imageOKBody
			})
			h := NewHandler(Config{
				Pool:     testPoolWith(&auth.Auth{UID: "u1", AccessToken: "at1", ExpiresAt: 9999999999}),
				Upstream: up,
			})
			rec := postImage(t, h, tc.path, tc.body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status=%d want 400 body=%s", rec.Code, rec.Body.String())
			}
			if len(*calls) != 0 {
				t.Fatalf("上游被调用 %d 次", len(*calls))
			}
			if !bytes.Contains(rec.Body.Bytes(), []byte(`"error"`)) {
				t.Fatalf("错误体不是 OpenAI 形态：%s", rec.Body.String())
			}
		})
	}
}

// TestParseImageResult 两种信封形态都认；形状不认识时返回 false（调用方按「已计费」处理）。
func TestParseImageResult(t *testing.T) {
	okCases := []string{
		`{"code":0,"data":{"created":1,"data":[{"url":"https://x/a"}],"usage":{"credit":1}}}`,
		`{"created":1,"data":[{"url":"https://x/a"}]}`,
		`{"code":"0","data":{"data":[{"b64_json":"AAA"}]}}`,
	}
	for _, raw := range okCases {
		if _, ok := parseImageResult([]byte(raw)); !ok {
			t.Fatalf("应识别为成功：%s", raw)
		}
	}
	badCases := []string{
		`{"code":11102,"data":{"data":[{"url":"x"}]}}`,
		`{"code":0,"data":{"data":[]}}`,
		`{"code":0,"data":{"data":[{"nope":1}]}}`,
		`not json`,
	}
	for _, raw := range badCases {
		if _, ok := parseImageResult([]byte(raw)); ok {
			t.Fatalf("不应识别为成功：%s", raw)
		}
	}
}

// TestImagesHiddenModelRejected 黑名单模型在占号前就被拒（与 /v1/models 过滤对称）。
func TestImagesHiddenModelRejected(t *testing.T) {
	up, calls := newImageUpstream(t, func(imageCall) (int, string) { return 200, imageOKBody })
	h := NewHandler(Config{
		Pool:         testPoolWith(&auth.Auth{UID: "u1", AccessToken: "at1", ExpiresAt: 9999999999}),
		Upstream:     up,
		ModelsHidden: []string{"hunyuan-image-alpha"},
	})
	rec := postImage(t, h, "/v1/images/generations", `{"model":"hunyuan-image-alpha","prompt":"x"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want 400", rec.Code)
	}
	if len(*calls) != 0 {
		t.Fatal("隐藏模型不应触达上游")
	}
}
