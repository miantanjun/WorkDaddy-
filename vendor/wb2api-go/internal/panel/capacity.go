// capacity.go 面板「容量与调度」板块的后端接口。
//
// GET /panel/api/capacity 一次返回三块数据（前端一个请求渲染整页）：
//   - rows      每个模型在该域的容量三态（空闲 / 拥堵 / 不可用）+ 判定依据
//   - locks     现有模型级限流明细（pool.ModelLockView，含原因与解锁时刻）
//   - scheduling 当前调度参数（策略 / 在途上限 / 积分保底 / 跨域回退）
//
// 模型清单走 5 分钟缓存：本接口会被前端 15s 轮询，实时打上游目录是自伤
// （每次拉目录 = 2 个上游探测，还会把无号场景变成刷错误日志）。
package panel

import (
	"net/http"
	"sync"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
)

// capacityModelCache 模型清单缓存（容量板块专用，与 /panel/api/models 的实时
// 行为解耦：那个接口是「人点了就想看到最新」，本接口是「后台轮询」）。
var capacityModelCache struct {
	sync.Mutex
	cn        []string
	global    []string
	fetchedAt time.Time
	ok        bool
}

const capacityModelTTL = 5 * time.Minute

// capacityModelNames 返回两域的裸模型名清单（去掉非对话过滤后的全量，含生图模型）。
func (p *Panel) capacityModelNames() (cn, global []string, at time.Time) {
	capacityModelCache.Lock()
	defer capacityModelCache.Unlock()
	if capacityModelCache.ok && time.Since(capacityModelCache.fetchedAt) < capacityModelTTL {
		return capacityModelCache.cn, capacityModelCache.global, capacityModelCache.fetchedAt
	}
	cn = append([]string(nil), capacityModelCache.cn...) // 拉取失败时沿用旧清单
	if uids := p.cfg.Pool.AvailableUIDsForRealm("cn"); len(uids) > 0 {
		if acct := p.cfg.Pool.AuthByUID(uids[0]); acct != nil {
			if infos, err := p.cfg.Upstream.FetchModels(acct); err == nil && len(infos) > 0 {
				cn = make([]string, 0, len(infos))
				for _, mi := range infos {
					// auto 是「让上游自己选」的占位项，不是真模型：列进容量表
					// 只会虚增总数、并让人以为它也能单独被限流。
					if mi.ID == "auto" {
						continue
					}
					cn = append(cn, mi.ID)
				}
			}
		}
	}
	global = append([]string(nil), capacityModelCache.global...)
	if p.cfg.Upstream.GlobalEnabled {
		if uids := p.cfg.Pool.AvailableUIDsForRealm("global"); len(uids) > 0 {
			if acct := p.cfg.Pool.AuthByUID(uids[0]); acct != nil {
				if infos := p.cfg.Upstream.FetchGlobalModelInfos(acct); len(infos) > 0 {
					global = make([]string, 0, len(infos))
					for _, mi := range infos {
						if mi.ID == "auto" {
							continue
						}
						global = append(global, mi.ID)
					}
				}
			}
		}
	}
	if len(cn) > 0 || len(global) > 0 {
		capacityModelCache.cn, capacityModelCache.global = cn, global
		capacityModelCache.fetchedAt = time.Now()
		capacityModelCache.ok = true
	}
	at = capacityModelCache.fetchedAt
	return cn, global, at
}

// capacity GET /panel/api/capacity。
func (p *Panel) capacity(w http.ResponseWriter, r *http.Request) {
	// 未装配池（测试裸构造、或将来拆模块）时给明确 503，不要 nil panic：
	// 面板崩掉比一个功能不可用严重得多。
	if p.cfg.Pool == nil {
		writeErr(w, http.StatusServiceUnavailable, "pool not available")
		return
	}
	cn, global, at := p.capacityModelNames()
	rows := make([]pool.ModelCapacityRow, 0, len(cn)+len(global))
	rows = append(rows, p.cfg.Pool.ModelCapacityView(cn, "cn")...)
	if p.cfg.Upstream.GlobalEnabled {
		rows = append(rows, p.cfg.Pool.ModelCapacityView(global, "global")...)
	}
	counts := map[string]int{
		pool.CapacityIdle:        0,
		pool.CapacityBusy:        0,
		pool.CapacityUnavailable: 0,
	}
	for _, row := range rows {
		counts[row.State]++
	}
	resp := map[string]any{
		"rows":       rows,
		"locks":      p.cfg.Pool.ModelLockView(),
		"scheduling": p.cfg.Pool.SchedulingView(),
		"counts":     counts,
		"model_names": map[string]int{
			"cn":     len(cn),
			"global": len(global),
		},
	}
	if !at.IsZero() {
		resp["models_cached_at"] = at.UTC().Format(time.RFC3339)
	}
	writeJSON(w, http.StatusOK, resp)
}
