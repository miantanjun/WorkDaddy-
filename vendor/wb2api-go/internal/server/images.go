// images.go OpenAI Images API 兼容端点：
//
//	POST /v1/images/generations   文生图（JSON）
//	POST /v1/images/edits         图生图（JSON 或 multipart/form-data）
//
// 上游是 `{chatBase}/v2/images/{generations,edits}`（与 Python 版同源）。
//
// 三条与 chat 不同的计费/安全红线（照抄 Python 版实测结论，不要"优化"掉）：
//
//  1. **5xx 与传输错误绝不重试**。上游可能已经出图并扣费，重试 = 双倍付费。
//     只对「明确的账号/配额拒绝」换号重试（session_dead / hard_credit /
//     soft_rate / model_blocked / account_fault）。
//  2. **出图立即 Pool.Release**。后续 base64 下载/编码走公网 CDN，不再占用
//     上游推理名额；不释放会让并发生图把账号的在途额度卡死。
//  3. 出站强制 `response_format=url`。上游对 b64_json 实际返回的也是签名 URL
//     （腾讯云 COS），让上游直接吐 base64 会放大响应体且不会被遵守；
//     客户端要 base64 时由网关下载后转码，且**只允许 myqcloud 域名**（防 SSRF）。
package server

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
	"github.com/linguo2625469/workbuddy2api-panel/internal/usage"
)

const (
	// imagesBodyLimit 请求体上限 32MiB（含 multipart 开销）。
	// 单张图片另有 20MiB 上限，两者都是 Python 版的实测口径。
	imagesBodyLimit = 32 << 20
	// imagesImageLimit 单张输入图片上限 20MiB（解码后的字节数）。
	imagesImageLimit = 20 << 20
	// imagesMemoryLimit multipart 解析的内存阈值：超出落临时文件，由 RemoveAll 清理。
	imagesMemoryLimit = 8 << 20
	// imagesMaxN 单请求最多张数（上游还会按模型再限）。
	imagesMaxN = 10
	// imagesFetchLimit b64 转换时下载图片的上限。
	imagesFetchLimit = 20 << 20
)

// imageAllowedFields 出站参数白名单。任何未列出的字段直接 400：
// 上游对多余字段的反应是 11128「不是官方客户端」，比报错更伤（可能连带冷却）。
var imageAllowedFields = map[string]bool{
	"model": true, "prompt": true, "n": true, "size": true,
	"response_format": true, "quality": true, "style": true, "user": true,
	"image": true, "image_url": true, "image_data": true,
}

// imageRequest 归一化后的生图请求。
type imageRequest struct {
	Model          string
	Prompt         string
	N              int
	ResponseFormat string
	// Optional 只含 size/quality/style/user 四个可选字符串参数。
	Optional map[string]string
	// ImageField 图片来源字段名（image / image_url / image_data），空 = 无输入图。
	ImageField string
	// ImageValue 已是 base64 文本（image / image_data）或 HTTPS URL（image_url）。
	ImageValue string
}

// imageRequestError 参数错误（400 类），与上游故障区分开。
type imageRequestError struct {
	status int
	code   string
	msg    string
}

func (e *imageRequestError) Error() string { return e.msg }

func imageBadRequest(code, msg string) *imageRequestError {
	return &imageRequestError{status: http.StatusBadRequest, code: code, msg: msg}
}

// imageResult 已校验的上游结果。
type imageResult struct {
	Created int64            `json:"created"`
	Data    []map[string]any `json:"data"`
	Usage   map[string]any   `json:"usage,omitempty"`
}

// parseImageResult 从上游信封里取出真正的结果体。
//
// 上游两种形态都要认（Python 版 `_result` 同口径）：
//
//	{code:0, data:{created, data:[{url}], usage:{...}}}   ← 业务信封
//	{created, data:[{url}], usage:{...}}                  ← 直出
//
// 判定成功的最低条件是 data 是**非空数组**且每项带 url 或 b64_json。
// 形状不认识时返回 false：此时可能已经扣过费，调用方必须按「已计费失败」处理，
// 不能重试。
func parseImageResult(raw []byte) (*imageResult, bool) {
	var top map[string]any
	if err := json.Unmarshal(raw, &top); err != nil {
		return nil, false
	}
	if c, ok := top["code"]; ok {
		switch v := c.(type) {
		case float64:
			if v != 0 {
				return nil, false
			}
		case string:
			if v != "" && v != "0" {
				return nil, false
			}
		}
	}
	body := top
	if inner, ok := top["data"].(map[string]any); ok {
		body = inner
	}
	rows, ok := body["data"].([]any)
	if !ok || len(rows) == 0 {
		return nil, false
	}
	out := &imageResult{}
	if c, ok := body["created"].(float64); ok {
		out.Created = int64(c)
	}
	if out.Created == 0 {
		out.Created = time.Now().Unix()
	}
	if u, ok := body["usage"].(map[string]any); ok {
		out.Usage = u
	}
	for _, r := range rows {
		row, ok := r.(map[string]any)
		if !ok {
			return nil, false
		}
		_, hasURL := row["url"].(string)
		_, hasB64 := row["b64_json"].(string)
		if !hasURL && !hasB64 {
			return nil, false
		}
		kept := make(map[string]any, 3)
		for _, k := range []string{"url", "b64_json", "revised_prompt"} {
			if v, ok := row[k]; ok {
				kept[k] = v
			}
		}
		out.Data = append(out.Data, kept)
	}
	return out, true
}

// buildImageBody 组装最终出站 JSON。
//
// model 必须传**裸模型名**：上游生图对 `cn:` 前缀不做剥离，实测会回
// `14401 Create image failed ... route config not found`（chat 路径的
// prepareBody 有重写，生图走的是独立端点，没经那层）。
func buildImageBody(in *imageRequest, model string) ([]byte, error) {
	out := map[string]any{
		"model":           model,
		"prompt":          in.Prompt,
		"n":               in.N,
		"response_format": "url", // 红线：强制 URL，客户端要 b64 由网关转
	}
	for k, v := range in.Optional {
		if v != "" {
			out[k] = v
		}
	}
	if in.ImageField != "" {
		// 上游 edits 的图片字段是**数组**形态（单图也要包一层）。
		out[in.ImageField] = []string{in.ImageValue}
	}
	return json.Marshal(out)
}

// normalizeImageValue 校验并归一化图片来源：URL 只收 HTTPS；base64 去 data: 前缀后
// 严格解码一次（确保后面出站的是干净的 base64，而不是带前缀的 data URI）。
func normalizeImageValue(field, value string) (string, *imageRequestError) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", imageBadRequest("invalid_image_request", "输入图片不能为空")
	}
	if field == "image_url" {
		u, err := url.Parse(value)
		if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil {
			return "", imageBadRequest("invalid_image_request", "image_url 必须是 HTTPS 图片地址")
		}
		return value, nil
	}
	enc := value
	if strings.HasPrefix(enc, "data:image/") {
		if i := strings.IndexByte(enc, ','); i >= 0 {
			enc = enc[i+1:]
		}
	}
	decoded, err := base64.StdEncoding.DecodeString(enc)
	if err != nil || len(decoded) == 0 {
		return "", imageBadRequest("invalid_image_request", "图片数据必须是有效的 base64")
	}
	if len(decoded) > imagesImageLimit {
		return "", &imageRequestError{status: http.StatusRequestEntityTooLarge, code: "invalid_image_request", msg: "图片不能超过 20 MiB"}
	}
	return enc, nil
}

// decodeImageRequest 解析 JSON / multipart 请求并做全部参数校验。
// w 只用于 MaxBytesReader 在超限时回写 413（传 nil 也能工作，但错误提示会退化成读取失败）。
func decodeImageRequest(w http.ResponseWriter, r *http.Request, edit bool) (*imageRequest, *imageRequestError) {
	limited := http.MaxBytesReader(w, r.Body, imagesBodyLimit)
	defer limited.Close()
	fields := map[string]any{}
	multipart := strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "multipart/form-data")

	if multipart {
		if !edit {
			return nil, imageBadRequest("invalid_image_request", "文生图请使用 application/json")
		}
		r.Body = limited
		if err := r.ParseMultipartForm(imagesMemoryLimit); err != nil {
			return nil, &imageRequestError{status: http.StatusRequestEntityTooLarge, code: "invalid_image_upload", msg: "图片请求过大或上传格式错误"}
		}
		defer func() { _ = r.MultipartForm.RemoveAll() }()
		for k, vs := range r.MultipartForm.Value {
			if len(vs) != 1 {
				return nil, imageBadRequest("invalid_image_request", "字段不可重复： "+k)
			}
			fields[k] = vs[0]
		}
		for k, fhs := range r.MultipartForm.File {
			if len(fhs) != 1 {
				return nil, imageBadRequest("invalid_image_request", "字段不可重复： "+k)
			}
			if k != "image" {
				return nil, imageBadRequest("invalid_image_request", "只有 image 字段支持文件上传")
			}
			f, err := fhs[0].Open()
			if err != nil {
				return nil, imageBadRequest("invalid_image_upload", "无法读取上传文件")
			}
			data, rerr := io.ReadAll(io.LimitReader(f, imagesImageLimit+1))
			f.Close()
			if rerr != nil || len(data) == 0 || len(data) > imagesImageLimit {
				return nil, &imageRequestError{status: http.StatusRequestEntityTooLarge, code: "invalid_image_upload", msg: "图片不能为空，且不能超过 20 MiB"}
			}
			fields[k] = base64.StdEncoding.EncodeToString(data)
		}
	} else {
		raw, err := io.ReadAll(limited)
		if err != nil {
			return nil, &imageRequestError{status: http.StatusRequestEntityTooLarge, code: "invalid_image_request", msg: "请求体过大或读取失败"}
		}
		if len(raw) == 0 {
			return nil, imageBadRequest("invalid_image_request", "请求体不能为空")
		}
		if err := json.Unmarshal(raw, &fields); err != nil {
			return nil, imageBadRequest("invalid_image_request", "请求体必须是 JSON 对象")
		}
	}

	for k := range fields {
		if !imageAllowedFields[k] {
			return nil, imageBadRequest("invalid_image_request", "不支持的参数： "+k)
		}
	}

	in := &imageRequest{Optional: map[string]string{}}
	if s, ok := fields["model"].(string); ok {
		in.Model = strings.TrimSpace(s)
	}
	if in.Model == "" || in.Model == "auto" {
		return nil, imageBadRequest("invalid_image_request", "请指定已启用的生图模型，例如 hunyuan-image-alpha")
	}
	if s, ok := fields["prompt"].(string); ok {
		in.Prompt = strings.TrimSpace(s)
	}
	if in.Prompt == "" {
		return nil, imageBadRequest("invalid_image_request", "prompt 必须为非空字符串")
	}

	in.N = 1
	if v, ok := fields["n"]; ok {
		num, ok := toInt(v)
		if !ok || num < 1 || num > imagesMaxN {
			return nil, imageBadRequest("invalid_image_request", fmt.Sprintf("n 必须是 1 到 %d 的整数", imagesMaxN))
		}
		in.N = num
	}

	in.ResponseFormat = "url"
	if s, ok := fields["response_format"].(string); ok && s != "" {
		if s != "url" && s != "b64_json" {
			return nil, imageBadRequest("invalid_image_request", "response_format 仅支持 url 或 b64_json")
		}
		in.ResponseFormat = s
	}

	for _, k := range []string{"size", "quality", "style", "user"} {
		if v, ok := fields[k]; ok {
			s, ok := v.(string)
			if !ok {
				return nil, imageBadRequest("invalid_image_request", k+" 必须是字符串")
			}
			in.Optional[k] = s
		}
	}

	sources := []string{}
	for _, k := range []string{"image", "image_data", "image_url"} {
		if _, ok := fields[k]; ok {
			sources = append(sources, k)
		}
	}
	if edit {
		if len(sources) != 1 {
			return nil, imageBadRequest("invalid_image_request", "图生图需要且只能提供 image、image_data 或 image_url 中的一项")
		}
	} else if len(sources) != 0 {
		return nil, imageBadRequest("invalid_image_request", "文生图不接受 image 参数；图生图请用 /v1/images/edits")
	}
	if len(sources) == 1 {
		in.ImageField = sources[0]
		v, verr := normalizeImageValue(in.ImageField, fmt.Sprint(fields[in.ImageField]))
		if verr != nil {
			return nil, verr
		}
		in.ImageValue = v
	}
	return in, nil
}

// toInt 把 JSON 数字 / multipart 字符串统一转成 int（仅接受整数）。
func toInt(v any) (int, bool) {
	switch n := v.(type) {
	case float64:
		i := int(n)
		if float64(i) != n {
			return 0, false
		}
		return i, true
	case int:
		return n, true
	case string:
		var i int
		if _, err := fmt.Sscanf(strings.TrimSpace(n), "%d", &i); err != nil {
			return 0, false
		}
		return i, true
	}
	return 0, false
}

// imageUsageCredit 取上游真实扣费（usage.credit / credits）。缺失或非法时返回 nil：
// 宁可漏记一次，也不能把 0 当成「免费」写进成本账本（会污染选号权重）。
func imageUsageCredit(u map[string]any) (float64, bool) {
	if u == nil {
		return 0, false
	}
	for _, k := range []string{"credit", "credits"} {
		if v, ok := u[k].(float64); ok && v >= 0 && v < 1e12 {
			return v, true
		}
	}
	return 0, false
}

// imageUsageTokens 取 input/output/total tokens（可能缺失）。
func imageUsageTokens(u map[string]any) (in, out, total int64, hasIn, hasOut, hasTotal bool) {
	get := func(k string) (int64, bool) {
		if u == nil {
			return 0, false
		}
		if v, ok := u[k].(float64); ok && v >= 0 {
			return int64(v), true
		}
		return 0, false
	}
	in, hasIn = get("input_tokens")
	out, hasOut = get("output_tokens")
	total, hasTotal = get("total_tokens")
	return
}

// recordImageAttempt 把一次生图尝试写进用量记录器（成功与失败都记：
// 失败也消耗了上游连接与（可能的）计费，不记会让「重试放大」在面板里隐形）。
func (h *Handler) recordImageAttempt(uid, realm, model string, res *imageResult, started time.Time, ok bool) {
	if h.cfg.Usage == nil {
		return
	}
	latency := time.Since(started).Milliseconds()
	if latency < 1 {
		latency = 1
	}
	var credits float64
	var hasCredits bool
	var in, out, total int64
	var hasIn, hasOut, hasTotal bool
	if res != nil {
		credits, hasCredits = imageUsageCredit(res.Usage)
		in, out, total, hasIn, hasOut, hasTotal = imageUsageTokens(res.Usage)
	}
	h.cfg.Usage.Add(time.Now(), realm, uid, model, usage.Delta{
		PromptTokens:     in,
		HasPromptTokens:  hasIn,
		CompletionTokens: out,
		HasCompletion:    hasOut,
		TotalTokens:      total,
		HasTotal:         hasTotal,
		Credit:           credits,
		HasCredit:        hasCredits,
		LatencyMs:        latency,
		HasLatency:       true,
	}, ok)
	if ok && h.cfg.Pool != nil {
		h.cfg.Pool.NoteModelCost(uid, model, credits, int(in+out))
	}
}

// fetchImageBase64 下载上游返回的签名 URL 并转 base64。
//
// 安全边界（防 SSRF，逐条对照 Python 版 _base64_image）：
//   - 只允许 https；
//   - 只允许 `*.myqcloud.com` 且 host 里必须出现 `.cos.`（腾讯云对象存储）；
//   - 不跟随重定向（防止 302 到内网）；
//   - 上限 20MiB。
//
// 失败时由调用方降级返回 URL（图已经出了、已经计费，不能因为转码失败让用户重画）。
func fetchImageBase64(parent context.Context, rawURL string) (string, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return "", err
	}
	host := u.Hostname()
	if u.Scheme != "https" || u.User != nil || (u.Port() != "" && u.Port() != "443") ||
		!strings.HasSuffix(host, ".myqcloud.com") || !strings.Contains(host, ".cos.") {
		return "", errors.New("上游图片地址不支持安全转换")
	}
	ctx, cancel := context.WithTimeout(parent, 30*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return "", err
	}
	client := &http.Client{
		Timeout:       30 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("下载图片失败：HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, imagesFetchLimit+1))
	if err != nil {
		return "", err
	}
	if len(data) == 0 {
		return "", errors.New("上游返回空图片")
	}
	if len(data) > imagesFetchLimit {
		return "", errors.New("上游图片超过 20 MiB")
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

// images 处理 /v1/images/{generations,edits}。
func (h *Handler) images(w http.ResponseWriter, r *http.Request) {
	edit := strings.HasSuffix(strings.TrimSuffix(r.URL.Path, "/"), "/edits")
	in, verr := decodeImageRequest(w, r, edit)
	if verr != nil {
		writeOpenAIError(w, verr.status, verr.code, verr.msg)
		return
	}
	realm, bareModel, _ := resolveModelDetail(in.Model)
	if _, hidden := h.loadLive().HiddenModels[realm+":"+bareModel]; hidden {
		writeOpenAIErrorHint(w, http.StatusBadRequest, "model_unavailable",
			"model is hidden by gateway configuration, try another model", "")
		return
	}

	got := h.generateImage(r.Context(), in, edit, realm, bareModel, upstream.ExtractClientIP(r))
	if got.res == nil {
		writeOpenAIError(w, got.status, got.code, got.msg)
		return
	}
	res := got.res

	if in.ResponseFormat == "b64_json" {
		for _, row := range res.Data {
			if _, has := row["b64_json"]; has {
				continue
			}
			u, _ := row["url"].(string)
			b64, ferr := fetchImageBase64(r.Context(), u)
			if ferr != nil {
				// 已出图已计费：保留 URL 让调用方直接用，别让人重画一张。
				payload := map[string]any{
					"warning": map[string]any{
						"message": "生图已完成，base64 转换失败；请使用 data 中的图片地址",
						"code":    "image_conversion_failed",
					},
					"created": res.Created,
					"data":    res.Data,
				}
				if res.Usage != nil {
					payload["usage"] = res.Usage
				}
				writeJSON(w, http.StatusOK, payload)
				return
			}
			row["b64_json"] = b64
			delete(row, "url")
		}
	}
	payload := map[string]any{"created": res.Created, "data": res.Data}
	if res.Usage != nil {
		payload["usage"] = res.Usage
	}
	writeJSON(w, http.StatusOK, payload)
}

// imageGenResult 一次生图轮转的结局：res 非 nil = 成功，否则按 status/code/msg 报错。
type imageGenResult struct {
	res    *imageResult
	status int
	code   string
	msg    string
	// uid/nick 是本次实际用到的账号（成功=出图账号，失败=最后尝试的账号）。
	// 只为日志：/v1/images/* 自己没有流水行，chat 兼容层那行若不带上，
	// 生图请求在日志里就只剩 "-"，事后查「哪个号画的/被拒的」无从下手。
	uid  string
	nick string
}

// generateImage 选号并调用上游生图（含换号轮转）。
//
// 调用方只负责**格式化**（/v1/images/* 用 OpenAI Images 形状，chat 兼容层用 markdown），
// 选号、租约、计费记录、失败分类全部收在这里 —— 两条入口必须走在途/冷却/负缓存
// 同一套口径上，否则「REST 能出图、chat 出不来」这种漂移又会出现。
//
// 三条红线保持不变：5xx/传输错误绝不重试；出图即 Release；上游只收裸模型名。
func (h *Handler) generateImage(ctx context.Context, in *imageRequest, edit bool, realm, bareModel, clientIP string) imageGenResult {
	outBody, err := buildImageBody(in, bareModel)
	if err != nil {
		return imageGenResult{status: http.StatusInternalServerError, code: "image_generation_failed", msg: "could not build request"}
	}

	tried := map[string]bool{}
	// 在途租约：与 chat 同款——成功选号即占名额，任何出口都释放（含 panic）。
	var heldUID string
	defer func() {
		if heldUID != "" {
			h.cfg.Pool.Release(heldUID)
		}
	}()
	releaseHeld := func() {
		if heldUID != "" {
			h.cfg.Pool.Release(heldUID)
			heldUID = ""
		}
	}

	maxRotate := h.cfg.MaxRotate
	if maxRotate <= 0 {
		maxRotate = 3
	}
	status := http.StatusServiceUnavailable
	code := "no_account"
	msg := "没有可用账号（全部在冷却、积分不足或达到在途上限）"
	var lastUID, lastNick string

	for attempt := 0; attempt < maxRotate; attempt++ {
		a := h.cfg.Pool.PickExcludingForRealm(tried, bareModel, realm)
		if a == nil {
			break
		}
		tried[a.UID] = true
		lastUID, lastNick = a.UID, a.Nickname
		if !h.cfg.Pool.Acquire(a.UID) {
			continue // 在途满了：换下一个号，不罚号
		}
		heldUID = a.UID
		started := time.Now()

		upStatus, raw, uerr := h.cfg.Upstream.Images(ctx, a, outBody, clientIP, edit)

		// 成功分支：上游 2xx 且形状可解析。
		if uerr == nil && upStatus < 400 {
			res, ok := parseImageResult(raw)
			if !ok {
				// 2xx 但结果不可解析：可能已扣费 ⇒ 不回退重试，直接如实报错。
				h.recordImageAttempt(a.UID, realm, bareModel, nil, started, false)
				releaseHeld()
				return imageGenResult{status: http.StatusBadGateway, code: "image_generation_failed",
					msg: "上游返回了无法识别的生图结果（可能已计费，未自动重试）", uid: a.UID, nick: a.Nickname}
			}
			h.cfg.Pool.NoteSuccess(a.UID)
			h.recordImageAttempt(a.UID, realm, bareModel, res, started, true)
			// 红线：出图即释放，后续转码不再占上游名额。
			releaseHeld()
			return imageGenResult{res: res, status: upStatus, uid: a.UID, nick: a.Nickname}
		}

		// 失败分支：只有「明确的账号/配额拒绝」才换号重试。
		h.recordImageAttempt(a.UID, realm, bareModel, nil, started, false)
		var ue *upstream.Error
		if errors.As(uerr, &ue) {
			retryable := upStatus < 500 && isImageRetryableKind(ue.Kind)
			if retryable {
				h.applyErrorPolicy(a.UID, ue.Kind, string(raw), bareModel, ue)
				releaseHeld()
				status = http.StatusServiceUnavailable
				code = "image_upstream_rejected"
				msg = "生图失败：上游拒绝了本次请求（已换号重试）"
				continue
			}
			// 5xx / 内容审核 / 参数错误：不罚号、不重试（可能已计费）。
			status = imageErrorStatus(upStatus, ue.Kind)
			code = ue.Kind.String()
			msg = "生图失败：" + ue.Msg
			releaseHeld()
			break
		}
		// 传输错误（超时 / 断连）：可能已出图，绝不重试。
		status = http.StatusBadGateway
		code = "transport"
		msg = "生图失败：上游连接中断（可能已计费，未自动重试）"
		releaseHeld()
		break
	}

	return imageGenResult{status: status, code: code, msg: msg, uid: lastUID, nick: lastNick}
}

// isImageRetryableKind 换号重试白名单（与 Python 版一致）：全部是「这个号不行，
// 换一个号就能过」的账号级判定。
func isImageRetryableKind(k upstream.ErrKind) bool {
	switch k {
	case upstream.ErrSessionDead, upstream.ErrHardCredit, upstream.ErrSoftRate,
		upstream.ErrModelBlocked, upstream.ErrAccountFault:
		return true
	}
	return false
}

// imageErrorStatus 把上游失败映射成客户端可识别的状态码。
func imageErrorStatus(upStatus int, kind upstream.ErrKind) int {
	switch {
	case kind == upstream.ErrUpstreamBusy:
		return http.StatusServiceUnavailable
	case kind == upstream.ErrSoftRate:
		return http.StatusTooManyRequests
	case kind == upstream.ErrBadParams, kind == upstream.ErrImageInvalid,
		kind == upstream.ErrPromptTooLong, kind == upstream.ErrContentBlocked:
		return http.StatusBadRequest
	case upStatus >= 500:
		return http.StatusBadGateway
	case upStatus >= 400:
		return upStatus
	}
	return http.StatusBadGateway
}
