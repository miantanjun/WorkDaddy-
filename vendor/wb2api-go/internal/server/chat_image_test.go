// chat_image_test.go 守卫「对话端点上的生图模型」这条兼容层。
//
// 背景：客户端没有生图入口，选中 cn:hunyuan-image-alpha 后仍发 /v1/chat/completions，
// 上游回 400/11103。这里的断言都是为了锁住「识别 → 转生图 → markdown 回话」这条链路。
package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
)

// seedModels 把一个模型目录塞进包级缓存，让 isImageGenModel 生效且不联网。
// t.Cleanup 里清空，避免污染其它套件（缓存是包级全局）。
func seedModels(t *testing.T, infos ...upstream.ModelInfo) {
	t.Helper()
	dynamicModelsCache.Lock()
	dynamicModelsCache.ids = infos
	dynamicModelsCache.fetched = time.Now()
	dynamicModelsCache.lastFail = time.Time{}
	dynamicModelsCache.Unlock()
	t.Cleanup(func() {
		dynamicModelsCache.Lock()
		dynamicModelsCache.ids = nil
		dynamicModelsCache.fetched = time.Time{}
		dynamicModelsCache.lastFail = time.Time{}
		dynamicModelsCache.Unlock()
	})
}

// newChatImageHandler 生图模型 + 假上游 + 单账号（断言换号次数用）。
func newChatImageHandler(t *testing.T, fn func(c imageCall) (int, string)) (*Handler, *[]imageCall) {
	t.Helper()
	seedModels(t,
		upstream.ModelInfo{ID: "hunyuan-image-alpha", ImageGen: true},
		upstream.ModelInfo{ID: "hunyuan-image-edit", ImageGen: true},
		upstream.ModelInfo{ID: "deepseek-v3", ImageGen: false},
	)
	up, calls := newImageUpstream(t, fn)
	h := NewHandler(Config{
		Pool:     testPoolWith(&auth.Auth{UID: "u1", AccessToken: "at1", ExpiresAt: 9999999999}),
		Upstream: up,
	})
	return h, calls
}

func postChat(t *testing.T, h *Handler, body string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rec, req)
	return rec
}

// sseContents 抽出所有 data 帧里的 choices[0].delta.content。
func sseContents(t *testing.T, raw string) []string {
	t.Helper()
	var out []string
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		payload := strings.TrimPrefix(line, "data: ")
		if payload == "[DONE]" {
			continue
		}
		var frame struct {
			Object  string `json:"object"`
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
		}
		if err := json.Unmarshal([]byte(payload), &frame); err != nil {
			t.Fatalf("SSE 帧不是合法 JSON: %s (%v)", payload, err)
		}
		if frame.Object != "chat.completion.chunk" {
			t.Fatalf("object=%q，流式帧必须是 chat.completion.chunk", frame.Object)
		}
		if len(frame.Choices) == 0 {
			t.Fatalf("帧缺 choices: %s", payload)
		}
		out = append(out, frame.Choices[0].Delta.Content)
	}
	return out
}

// TestChatImageStreamRoutesToImageEndpoint 核心链路：chat 入站的生图模型必须
//   - 走 /v2/images/generations（不是 /chat/completions）；
//   - 出站 model 是裸名（上游生图不认 cn: 前缀，14401 route not found）；
//   - 出站 response_format 强制 url；
//   - 流式正文里出现 markdown 图片。
func TestChatImageStreamRoutesToImageEndpoint(t *testing.T) {
	h, calls := newChatImageHandler(t, func(imageCall) (int, string) { return 200, imageOKBody })
	rec := postChat(t, h,
		`{"model":"cn:hunyuan-image-alpha","stream":true,"messages":[{"role":"user","content":"画一只壁炉边的猫"}]}`)
	if rec.Code != 200 {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if len(*calls) != 1 {
		t.Fatalf("upstream calls=%d want 1", len(*calls))
	}
	if (*calls)[0].Path != "/v2/images/generations" {
		t.Fatalf("path=%s，生图模型必须走生图端点", (*calls)[0].Path)
	}
	if got := (*calls)[0].Body["model"]; got != "hunyuan-image-alpha" {
		t.Fatalf("出站 model=%v，必须剥掉 cn: 前缀", got)
	}
	if got := (*calls)[0].Body["prompt"]; got != "画一只壁炉边的猫" {
		t.Fatalf("出站 prompt=%v", got)
	}
	if got := (*calls)[0].Body["response_format"]; got != "url" {
		t.Fatalf("出站 response_format=%v，必须强制 url", got)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "text/event-stream") && rec.Header().Get("Content-Type") == "" {
		t.Fatal("流式响应缺 Content-Type")
	}
	if !strings.Contains(body, "data: [DONE]") {
		t.Fatalf("缺 SSE 收尾帧: %s", body)
	}
	var joined string
	for _, c := range sseContents(t, body) {
		joined += c
	}
	if !strings.Contains(joined, "![生成图片](https://img.example/a.png)") {
		t.Fatalf("正文里没有 markdown 图片，实际=%q", joined)
	}
}

// TestChatImageStreamOpensEarly 出图要 10~20s，必须先发头 + 空 role delta，
// 否则客户端会当超时掐掉连接。
func TestChatImageStreamOpensEarly(t *testing.T) {
	h, _ := newChatImageHandler(t, func(imageCall) (int, string) { return 200, imageOKBody })
	rec := postChat(t, h,
		`{"model":"hunyuan-image-alpha","stream":true,"messages":[{"role":"user","content":"猫"}]}`)
	contents := sseContents(t, rec.Body.String())
	if len(contents) < 3 {
		t.Fatalf("帧数=%d，至少要有 开流/正文/收尾 三帧: %v", len(contents), contents)
	}
	if contents[0] != "" {
		t.Fatalf("首帧应是空 content 的开流帧，实际=%q", contents[0])
	}
}

// TestChatImageNonStreamReturnsCompletion non-stream 仍要给一条标准 chat.completion。
func TestChatImageNonStreamReturnsCompletion(t *testing.T) {
	h, _ := newChatImageHandler(t, func(imageCall) (int, string) { return 200, imageOKBody })
	rec := postChat(t, h,
		`{"model":"hunyuan-image-alpha","messages":[{"role":"user","content":"猫"}]}`)
	if rec.Code != 200 {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Object  string `json:"object"`
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
			FinishReason string `json:"finish_reason"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bad json: %v (%s)", err, rec.Body.String())
	}
	if resp.Object != "chat.completion" {
		t.Fatalf("object=%q", resp.Object)
	}
	if len(resp.Choices) != 1 {
		t.Fatalf("choices=%d", len(resp.Choices))
	}
	if !strings.Contains(resp.Choices[0].Message.Content, "https://img.example/a.png") {
		t.Fatalf("content=%q", resp.Choices[0].Message.Content)
	}
	if resp.Choices[0].FinishReason != "stop" {
		t.Fatalf("finish_reason=%q", resp.Choices[0].FinishReason)
	}
}

// TestChatImageUsesLastUserMessageOnly 历史里的旧提示词不能混进这一轮。
func TestChatImageUsesLastUserMessageOnly(t *testing.T) {
	h, calls := newChatImageHandler(t, func(imageCall) (int, string) { return 200, imageOKBody })
	postChat(t, h, `{"model":"hunyuan-image-alpha","stream":true,"messages":[
		{"role":"user","content":"第一轮：画一只狗"},
		{"role":"assistant","content":"![生成图片](https://img.example/old.png)"},
		{"role":"user","content":"再来一张：画一只猫"}]}`)
	if len(*calls) != 1 {
		t.Fatalf("upstream calls=%d want 1", len(*calls))
	}
	if got := (*calls)[0].Body["prompt"]; got != "再来一张：画一只猫" {
		t.Fatalf("prompt=%v，只该取最后一条 user 消息", got)
	}
}

// TestChatImagePartArrayTextAndImage part 数组形态：文字拼进 prompt，
// data URL 走图生图（edits）且剥掉 data: 前缀。
func TestChatImagePartArrayTextAndImage(t *testing.T) {
	h, calls := newChatImageHandler(t, func(imageCall) (int, string) { return 200, imageOKBody })
	postChat(t, h, `{"model":"hunyuan-image-alpha","stream":true,"messages":[
		{"role":"user","content":[
			{"type":"text","text":"把背景换成雪天"},
			{"type":"image_url","image_url":{"url":"data:image/png;base64,aGVsbG8="}}]}]}`)
	if len(*calls) != 1 {
		t.Fatalf("upstream calls=%d", len(*calls))
	}
	c := (*calls)[0]
	if c.Path != "/v2/images/edits" {
		t.Fatalf("path=%s，带输入图必须走 edits", c.Path)
	}
	if got := c.Body["prompt"]; got != "把背景换成雪天" {
		t.Fatalf("prompt=%v", got)
	}
	arr, ok := c.Body["image_data"].([]any)
	if !ok || len(arr) != 1 {
		t.Fatalf("image_data 必须是单元素数组，实际=%v", c.Body["image_data"])
	}
	if arr[0] != "aGVsbG8=" {
		t.Fatalf("data: 前缀未剥离：%v", arr[0])
	}
}

// TestChatImageNoPromptRejected 没有可用的 user 文字时明确报 400，
// 不要拿空 prompt 去打上游（那会白烧一次额度）。
func TestChatImageNoPromptRejected(t *testing.T) {
	h, calls := newChatImageHandler(t, func(imageCall) (int, string) { return 200, imageOKBody })
	rec := postChat(t, h, `{"model":"hunyuan-image-alpha","stream":true,"messages":[
		{"role":"system","content":"你是画师"}]}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if len(*calls) != 0 {
		t.Fatalf("空 prompt 不应打上游，实际 calls=%d", len(*calls))
	}
}

// TestChatImagePromptTruncatedOnRuneBoundary 超长 prompt 按字符截断，不切坏 UTF-8。
func TestChatImagePromptTruncatedOnRuneBoundary(t *testing.T) {
	h, calls := newChatImageHandler(t, func(imageCall) (int, string) { return 200, imageOKBody })
	long := strings.Repeat("猫", chatImageMaxPrompt+500)
	payload, _ := json.Marshal(map[string]any{
		"model":  "hunyuan-image-alpha",
		"stream": true,
		"messages": []any{
			map[string]any{"role": "user", "content": long},
		},
	})
	postChat(t, h, string(payload))
	if len(*calls) != 1 {
		t.Fatalf("upstream calls=%d", len(*calls))
	}
	got, _ := (*calls)[0].Body["prompt"].(string)
	if n := utf8.RuneCountInString(got); n != chatImageMaxPrompt {
		t.Fatalf("prompt 字符数=%d，应为 %d", n, chatImageMaxPrompt)
	}
	if !utf8.ValidString(got) {
		t.Fatal("截断切坏了 UTF-8")
	}
}

// TestChatImageStreamFailureReportedInBody 头已发（200）改不回来，失败原因必须以
// 正文回给对话，不能让用户看到空气泡。
func TestChatImageStreamFailureReportedInBody(t *testing.T) {
	h, calls := newChatImageHandler(t, func(imageCall) (int, string) {
		return 400, `{"code":14401,"msg":"route config not found"}`
	})
	rec := postChat(t, h,
		`{"model":"hunyuan-image-alpha","stream":true,"messages":[{"role":"user","content":"猫"}]}`)
	if rec.Code != 200 {
		t.Fatalf("流式一旦开流就是 200，实际=%d", rec.Code)
	}
	var joined string
	for _, c := range sseContents(t, rec.Body.String()) {
		joined += c
	}
	if !strings.Contains(joined, "⚠️") {
		t.Fatalf("失败原因没回给对话，实际=%q", joined)
	}
	if len(*calls) != 1 {
		t.Fatalf("upstream calls=%d，4xx 不该换号重试", len(*calls))
	}
}

// TestChatImageNonStreamFailureKeepsStatusCode non-stream 没开流，要回真状态码。
func TestChatImageNonStreamFailureKeepsStatusCode(t *testing.T) {
	h, _ := newChatImageHandler(t, func(imageCall) (int, string) {
		return 429, `{"code":11100,"msg":"rate limited"}`
	})
	rec := postChat(t, h,
		`{"model":"hunyuan-image-alpha","messages":[{"role":"user","content":"猫"}]}`)
	if rec.Code == 200 {
		t.Fatalf("非流式失败必须回真实状态码，实际 200 body=%s", rec.Body.String())
	}
}

// TestChatImageOnlyForImageModels 普通对话模型不能被误拦到生图链路。
func TestChatImageOnlyForImageModels(t *testing.T) {
	h, calls := newChatImageHandler(t, func(imageCall) (int, string) {
		return 200, `{"choices":[{"message":{"content":"hi"}}]}`
	})
	postChat(t, h,
		`{"model":"deepseek-v3","stream":false,"messages":[{"role":"user","content":"你好"}]}`)
	if len(*calls) != 1 {
		t.Fatalf("upstream calls=%d", len(*calls))
	}
	if (*calls)[0].Path == "/v2/images/generations" || (*calls)[0].Path == "/v2/images/edits" {
		t.Fatalf("普通对话模型被误转到生图端点：%s", (*calls)[0].Path)
	}
}

// TestChatImageDoesNotFetchCatalogOnRequestThread chat 热路径只读模型目录快照，
// 绝不在请求线程上发起 FetchModels——那是给每个对话请求平白加一次上游调用
// （早期实现踩过：cross_domain_fallback 的「一次 chat = 一次上游调用」计数被打乱）。
// 缓存冷时识别不出生图模型，fail-open 回普通 chat 路径，但调用数必须还是 1。
func TestChatImageDoesNotFetchCatalogOnRequestThread(t *testing.T) {
	seedModels(t) // 空目录 = 冷缓存
	up, calls := newImageUpstream(t, func(imageCall) (int, string) { return 200, imageOKBody })
	h := NewHandler(Config{
		Pool:     testPoolWith(&auth.Auth{UID: "u1", AccessToken: "at1", ExpiresAt: 9999999999}),
		Upstream: up,
	})
	postChat(t, h, `{"model":"hunyuan-image-alpha","messages":[{"role":"user","content":"猫"}]}`)
	if len(*calls) != 1 {
		t.Fatalf("upstream calls=%d，chat 热路径不该额外拉模型目录: %+v", len(*calls), *calls)
	}
}

// TestImageMarkdownFallsBackToDataURI 上游没遵守 response_format 只给 b64 时，
// 至少要让图能显示出来。
func TestImageMarkdownFallsBackToDataURI(t *testing.T) {
	md := imageMarkdown(&imageResult{Data: []map[string]any{{"b64_json": "QUJD"}}})
	if !strings.Contains(md, "data:image/png;base64,QUJD") {
		t.Fatalf("b64 回退失败：%q", md)
	}
}

// TestChatImageUsageNotFabricated 用量只透传上游真给过的字段，不编造 token。
func TestChatImageUsageNotFabricated(t *testing.T) {
	u := chatImageUsage(&imageResult{Usage: map[string]any{"credit": 12.5}})
	if _, ok := u["prompt_tokens"]; ok {
		t.Fatal("不该伪造 prompt_tokens")
	}
	if u["credit"] != 12.5 {
		t.Fatalf("上游真给的字段要透传：%v", u)
	}
	if got := chatImageUsage(&imageResult{}); len(got) != 0 {
		t.Fatalf("上游没给 usage 时应为空，实际=%v", got)
	}
}
