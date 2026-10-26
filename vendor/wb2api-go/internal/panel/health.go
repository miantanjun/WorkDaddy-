package panel

// health.go 账号权威健康检查：积分 → 模型目录 → 一次最小真实对话。
//
// 语义与 Python 版 admin/account_health.py 一致：三步都过才算健康。
// ⚠️ 关键约束：**任一步失败只记录诊断，绝不改账号状态**（不禁用、不冷却、不熔断）——
// 一次接口异常不足以判定账号失效，误杀正常账号的代价远高于漏判。
//
// 真实对话会消耗极少量积分，因此：① 前两步不过就不做第三步；
// ② 支持 ?chat=0 显式跳过（只读探测）。

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
)

type healthStep struct {
	Name   string `json:"name"`
	OK     bool   `json:"ok"`
	MS     int64  `json:"ms"`
	Detail string `json:"detail,omitempty"`
	Error  string `json:"error,omitempty"`
}

// accountHealth 三步检查。query chat=0 可跳过真实对话。
func (p *Panel) accountHealth(w http.ResponseWriter, r *http.Request) {
	uid := r.PathValue("uid")
	a := p.cfg.Pool.AuthByUID(uid)
	if a == nil {
		writeErr(w, http.StatusNotFound, "account not found")
		return
	}

	steps := make([]healthStep, 0, 3)

	// 1) 积分：能读到额度说明鉴权链路通
	t0 := time.Now()
	_, total, remain, err := p.cfg.Upstream.CreditPackages(a)
	s1 := healthStep{Name: "credits", MS: time.Since(t0).Milliseconds()}
	if err != nil {
		s1.Error = truncateStr(err.Error(), 200)
	} else {
		s1.OK = true
		s1.Detail = fmt.Sprintf("total=%d remain=%d", total, remain)
	}
	steps = append(steps, s1)

	// 2) 模型目录：能拉到模型说明产品配置没坏
	t1 := time.Now()
	models, merr := p.cfg.Upstream.FetchModels(a)
	s2 := healthStep{Name: "models", MS: time.Since(t1).Milliseconds()}
	if merr != nil {
		s2.Error = truncateStr(merr.Error(), 200)
	} else if len(models) == 0 {
		s2.Error = "模型目录为空"
	} else {
		s2.OK = true
		s2.Detail = fmt.Sprintf("%d 个模型", len(models))
	}
	steps = append(steps, s2)

	// 3) 真实对话：前两步都过了才做（否则没必要烧积分）
	if r.URL.Query().Get("chat") != "0" && s1.OK && s2.OK {
		if model := probeModel(models); model != "" {
			t2 := time.Now()
			s3 := healthStep{Name: "chat"}
			body, _ := json.Marshal(map[string]any{
				"model":    model,
				"messages": []map[string]any{{"role": "user", "content": "hi"}},
				"stream":   true,
			})
			rc, status, respBody, cerr := p.cfg.Upstream.ChatStream(a, body, "", upstream.ChatMeta{})
			s3.MS = time.Since(t2).Milliseconds()
			switch {
			case cerr != nil:
				// 正常错误路径：ChatStream 已经把 body 读完并关掉，rc 必然是 nil
				s3.Error = truncateStr(cerr.Error(), 200)
			case rc == nil:
				// 防御：理论不存在（≥400 一定带 *Error），但 rc 为 nil 时 Close 会 panic
				s3.Error = fmt.Sprintf("上游未返回可读响应（http=%d）", status)
			default:
				if status >= 400 {
					s3.Error = fmt.Sprintf("http=%d %s", status, truncateStr(string(respBody), 160))
				} else {
					// 读干 SSE：上游对 chat 强制 flow，不读完会残留连接
					_, _ = io.Copy(io.Discard, io.LimitReader(rc, 1<<20))
					s3.OK = true
					s3.Detail = model
				}
				rc.Close()
			}
			steps = append(steps, s3)
		}
	}

	healthy := true
	failed := ""
	for _, st := range steps {
		if !st.OK {
			healthy = false
			if failed == "" {
				failed = st.Name
			}
		}
	}
	log.Printf("panel: health uid=%s healthy=%v steps=%d firstFail=%q", uid, healthy, len(steps), failed)
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"uid":     uid,
		"healthy": healthy,
		"steps":   steps,
		"at":      time.Now().Format(time.RFC3339),
	})
}

// probeModel 挑一个探测模型：优先上游标记的默认模型，否则取列表第一个**有 ID 的**。
// 不按上下文大小挑 —— 小上下文模型往往是最便宜的弱模型，探测意义不如「官方默认」。
//
// ⚠️ 两轮遍历是必要的：上游偶尔给出 ID 为空的占位项，如果只在第一轮找默认、然后直接取
// models[0]，默认项 ID 为空时就会退化成空串，第三步被静默跳过（健康检查永远少一步）。
func probeModel(models []upstream.ModelInfo) string {
	for _, m := range models {
		if m.IsDefault && m.ID != "" {
			return m.ID
		}
	}
	for _, m := range models {
		if m.ID != "" {
			return m.ID
		}
	}
	return ""
}
