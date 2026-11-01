// chat_image.go 把「生图模型被当成对话模型选中」这种情况接住。
//
// 背景（2026-10-28 实测）：WorkBuddy 桌面客户端没有生图入口，选中 `cn:hunyuan-image-alpha`
// 后走的是 `POST /v1/chat/completions` + `stream:true`，上游对话端点直接回
//
//	400 {"code":11103,"msg":"Backend [hunyuan-stream] is not supported"}
//
// 网关还会把它当可重试错误连换 7 个号，全是白跑（每次 4~5s，最后 503 甩给用户）。
//
// 这里的做法：**在 chat 入站处识别生图模型，改走真正的生图链路**，再把图片以
// markdown 贴回对话。于是「在对话里选生图模型」从「一定失败」变成「真的能出图」，
// 而且复用 /v1/images/* 的选号/租约/计费记录，两条入口口径一致。
//
// 有意不做的事：
//   - 不伪造 token 用量。生图是「按张计费」，硬编造 prompt/completion token 只会
//     污染用量统计；usage 里只透传上游真给的字段。
//   - 不在失败时假装成功。stream 模式下 HTTP 200 一旦发出就改不了状态码，所以错误
//     以正文形式回给对话（用户能在气泡里看到原因），non-stream 仍回真正的 4xx/5xx。
package server

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
)

const (
	// chatImageMaxPrompt 单轮提示词上限。生图 prompt 过长对上游没帮助，反而挤占
	// 请求体；超长直接截断而不是报错——用户不该因为对话历史长而画不出图。
	chatImageMaxPrompt = 4000
)

// isImageGenModel 判断该模型是不是「只能生图、不能对话」。
// 数据源与 /v1/models 的 image 区段同一个（upstream.ModelInfo.ImageGen）。
//
// ⚠️ 只读缓存快照（cachedModelsSnapshot），不在请求线程上发起 FetchModels：
// 那会给每个对话请求平白加一次上游调用（首启/缓存空时），实测直接把
// 「一次 chat = 一次上游调用」的计数打乱。目录由三处预热：启动期
// WarmModelCatalog、/v1/models 的懒触发、面板模型页。
//
// 为什么不改成「按名字猜」：猜错的代价比猜不出来更大——把对话模型误送进生图链路，
// 用户会收到一张图而不是回答，属于静默错答；猜不出来最多退回原有的失败路径（503
// 附上游原因），用户看得见。所以只认目录，不认名字。
//
// 缓存冷（进程刚起或上次拉取失败进了 5min 负缓存）时这里 fail-open 到原路径。
func (h *Handler) isImageGenModel(bareModel string) bool {
	if h.cfg.Upstream == nil {
		return false
	}
	for _, mi := range cachedModelsSnapshot() {
		if mi.ID == bareModel {
			return mi.ImageGen
		}
	}
	return false
}

// chatImageRequest 从 chat 请求体里提取生图参数。
//
// 只取**最后一条 user 消息**：会话历史里的旧图/旧提示词不该混进这一轮。
// 图片优先取 data URL（客户端把附件内联进 messages），其次 https URL。
func chatImageRequest(body []byte, model string) (*imageRequest, bool) {
	var req struct {
		Messages []struct {
			Role    string          `json:"role"`
			Content json.RawMessage `json:"content"`
		} `json:"messages"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		return nil, false
	}

	var prompt strings.Builder
	imageValue := ""
	imageField := ""
	for i := len(req.Messages) - 1; i >= 0; i-- {
		m := req.Messages[i]
		if m.Role != "user" {
			continue
		}
		// content 可能是字符串，也可能是 part 数组。
		var text string
		if err := json.Unmarshal(m.Content, &text); err == nil {
			prompt.WriteString(text)
			break
		}
		var parts []map[string]any
		if err := json.Unmarshal(m.Content, &parts); err != nil {
			break
		}
		for _, p := range parts {
			typ, _ := p["type"].(string)
			switch typ {
			case "text", "input_text":
				if s, ok := p["text"].(string); ok && s != "" {
					if prompt.Len() > 0 {
						prompt.WriteString("\n")
					}
					prompt.WriteString(s)
				}
			case "image_url", "input_image", "image":
				if imageValue != "" {
					continue // 只取第一张：上游 edits 单图语义
				}
				v := ""
				if u, ok := p["image_url"].(map[string]any); ok {
					v, _ = u["url"].(string)
				}
				if v == "" {
					v, _ = p["image_url"].(string)
				}
				if v == "" {
					v, _ = p["image"].(string)
				}
				if v == "" {
					continue
				}
				if strings.HasPrefix(v, "data:image/") {
					imageField = "image_data"
					imageValue, _ = normalizeImageValue("image_data", v)
					if imageValue == "" {
						imageField = ""
					}
				} else if strings.HasPrefix(strings.ToLower(v), "https://") {
					imageField = "image_url"
					imageValue, _ = normalizeImageValue("image_url", v)
					if imageValue == "" {
						imageField = ""
					}
				}
			}
		}
		break
	}

	p := strings.TrimSpace(prompt.String())
	if p == "" {
		return nil, false
	}
	// 超长按字符截断（不切坏 UTF-8）：这个长度只影响出图风格描述，不影响结果正确性。
	if r := []rune(p); len(r) > chatImageMaxPrompt {
		p = string(r[:chatImageMaxPrompt])
	}
	in := &imageRequest{
		Model:          model,
		Prompt:         p,
		N:              1,
		ResponseFormat: "url", // 红线：出站一律 url，markdown 直接用这个地址
		Optional:       map[string]string{},
		ImageField:     imageField,
		ImageValue:     imageValue,
	}
	return in, true
}

// imageMarkdown 把生图结果拼成对话正文。上游强制 url 形态，所以正常分支只会有 url；
// 万一上游只给 b64（未遵守 response_format），回退成 data URI，至少图能看见。
func imageMarkdown(res *imageResult) string {
	var b strings.Builder
	for _, row := range res.Data {
		if u, ok := row["url"].(string); ok && u != "" {
			if b.Len() > 0 {
				b.WriteString("\n\n")
			}
			b.WriteString("![生成图片](" + u + ")")
			continue
		}
		if b64, ok := row["b64_json"].(string); ok && b64 != "" {
			if b.Len() > 0 {
				b.WriteString("\n\n")
			}
			b.WriteString("![生成图片](data:image/png;base64," + b64 + ")")
		}
	}
	return b.String()
}

// chatImageUsage 只透传上游真给过的字段，不编造 token。
func chatImageUsage(res *imageResult) map[string]any {
	u := map[string]any{}
	if res.Usage != nil {
		for k, v := range res.Usage {
			u[k] = v
		}
	}
	return u
}

// chatImageBridge 处理「对话端点上的生图模型」。返回值是实际写出的 HTTP 状态码，
// 交给调用方的请求级统计打日志（stream 恒 200，non-stream 可能是 4xx/5xx）；
// 同时把实际用到的账号写进 st，流水行才不会只剩一个 "-"。
//
// stream=true 时先立刻发响应头 + 一个空的 role delta，把 TTFB 压到 0（真实出图要
// 10~20s，不先开流会被客户端当超时掐掉）；随后把结果作为一条 content delta 送出。
func (h *Handler) chatImageBridge(w http.ResponseWriter, r *http.Request, body []byte, stream bool, realm, bareModel string, st *chatStat) int {
	in, ok := chatImageRequest(body, bareModel)
	if !ok {
		writeOpenAIError(w, http.StatusBadRequest, "invalid_request",
			"生图模型需要一条包含文字提示词的用户消息（例如：画一只在壁炉边的猫）")
		return http.StatusBadRequest
	}
	edit := in.ImageField != ""
	// noteAcct 把出图（或最后尝试）的账号记进流水行。
	noteAcct := func(got imageGenResult) {
		if st != nil && got.uid != "" {
			st.uid, st.nick = got.uid, got.nick
		}
	}

	now := time.Now().Unix()
	id := "chatcmpl-img-" + strconv.FormatInt(now, 10) + "-" + strconv.FormatInt(time.Now().UnixNano()%100000, 10)

	if !stream {
		got := h.generateImage(r.Context(), in, edit, realm, bareModel, upstream.ExtractClientIP(r))
		noteAcct(got)
		if got.res == nil {
			writeOpenAIError(w, got.status, got.code, got.msg)
			return got.status
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"id":      id,
			"object":  "chat.completion",
			"created": now,
			"model":   bareModel,
			"choices": []any{map[string]any{
				"index":         0,
				"message":       map[string]any{"role": "assistant", "content": imageMarkdown(got.res)},
				"finish_reason": "stop",
			}},
			"usage": chatImageUsage(got.res),
		})
		return http.StatusOK
	}

	hdr := w.Header()
	hdr.Set("Content-Type", "text/event-stream; charset=utf-8")
	hdr.Set("Cache-Control", "no-cache")
	hdr.Set("Connection", "keep-alive")
	hdr.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher, _ := w.(http.Flusher)
	emit := func(payload any) {
		b, _ := json.Marshal(payload)
		_, _ = w.Write([]byte("data: "))
		_, _ = w.Write(b)
		_, _ = w.Write([]byte("\n\n"))
		if flusher != nil {
			flusher.Flush()
		}
	}
	chunk := func(delta map[string]any, finish any) map[string]any {
		return map[string]any{
			"id":      id,
			"object":  "chat.completion.chunk",
			"created": now,
			"model":   bareModel,
			"choices": []any{map[string]any{"index": 0, "delta": delta, "finish_reason": finish}},
		}
	}

	// 先开流：让客户端立刻看到 TTFB，避免 10~20s 的出图时间被当成超时。
	emit(chunk(map[string]any{"role": "assistant", "content": ""}, nil))

	got := h.generateImage(r.Context(), in, edit, realm, bareModel, upstream.ExtractClientIP(r))
	noteAcct(got)
	if got.res == nil {
		// 头已发（200 改不回来）：把原因作为正文回给对话，别让用户看到一个空气泡。
		emit(chunk(map[string]any{"content": "⚠️ " + got.msg}, nil))
	} else {
		emit(chunk(map[string]any{"content": imageMarkdown(got.res)}, nil))
	}
	emit(chunk(map[string]any{}, "stop"))
	_, _ = w.Write([]byte("data: [DONE]\n\n"))
	if flusher != nil {
		flusher.Flush()
	}
	return http.StatusOK
}
