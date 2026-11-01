// images.go 上游生图端点（/v2/images/generations 与 /v2/images/edits）。
//
// 为什么单列一个方法而不是复用 ChatStream：生图是**一次性计费**动作，语义与
// chat 的三处根本不同，混在一起会互相污染：
//   - 不支持 SSE，响应是普通 JSON（带 data[].url 与 usage.credit）；
//   - 5xx / 传输错误**绝不能重试**——上游可能已经出图并扣费，重试等于双倍付费；
//   - 出图后应立即释放账号在途名额（后续 base64 下载不再占用上游推理容量）。
//
// 头族与 chat 完全同款（ChatHeaders）：生图端点和 chat 同域同客户端，上游对
// 通道校验（11128）不分端点，头缺一个就会被判「不是官方客户端」。
package upstream

import (
	"bytes"
	"context"
	"io"
	"net/http"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
)

const (
	// imageGenerationsPath 文生图出站路径（与 Python 版 settings.BACKEND + /v2/images/... 一致）。
	imageGenerationsPath = "/v2/images/generations"
	// imageEditsPath 图生图出站路径。
	imageEditsPath = "/v2/images/edits"
	// imageRespLimit 生图响应上限：正常只有几个 URL（几百字节），8MB 是防御值
	// （某些模型会把 b64 直接塞回响应，留足余量又不至于被一个大包打爆内存）。
	imageRespLimit = 8 << 20
)

// Images 调用上游生图端点。body 必须已是**最终出站 JSON**（调用方负责字段白名单、
// 强制 response_format=url、edits 的图片数组包装）。
//
// 返回值语义与 ChatStream 对齐：>=400 时返回上游原文 + 已分类的 *Error
// （含 Retry-After），由调用方决定罚号策略；分类为 ErrNone 的 >=400 属防御分支，
// 返回 nil error 让调用方按原文兜底。
//
// ctx 为 nil 时回落 Background（测试便利）；请求 context 由调用方传入 r.Context()，
// 客户端断连会立即中断在途上游调用。
func (c *Client) Images(ctx context.Context, a *auth.Auth, body []byte, clientIP string, edit bool) (status int, respBody []byte, err error) {
	if ctx == nil {
		ctx = context.Background()
	}
	path := imageGenerationsPath
	if edit {
		path = imageEditsPath
	}
	req, rerr := http.NewRequestWithContext(ctx, http.MethodPost, c.chatBase(a)+path, bytes.NewReader(body))
	if rerr != nil {
		return 0, nil, rerr
	}
	req.Header.Set("Content-Type", "application/json")
	c.ChatHeaders(req, a, clientIP, ChatMeta{})

	// 用 HTTP（有总时长 120s）而不是 ChatHTTP（无总时长）：生图是短请求，
	// 挂一个硬上限比让 goroutine 永久占着在途名额安全。官方客户端同样的
	// 110s 量级（Python 版 httpx.Timeout(110, connect=10)）。
	resp, derr := c.HTTP.Do(req)
	if derr != nil {
		// 传输失败与 chat 同款处理：主动清空空闲连接池，避免下个请求捡到坏连接。
		roundTripCloseIdle(c.HTTP.Transport)
		return 0, nil, derr
	}
	defer resp.Body.Close()
	raw, rerr := io.ReadAll(io.LimitReader(resp.Body, imageRespLimit))
	if rerr != nil {
		return 0, nil, rerr
	}
	if resp.StatusCode >= 400 {
		kind := Classify(resp.StatusCode, string(raw))
		if kind == ErrNone {
			return resp.StatusCode, raw, nil
		}
		ue := &Error{Kind: kind, Status: resp.StatusCode, Msg: truncate(string(raw), 200)}
		if d, ok := ParseRetryAfter(resp.Header); ok {
			ue.RetryAfter = d
		}
		return resp.StatusCode, raw, ue
	}
	return resp.StatusCode, raw, nil
}
