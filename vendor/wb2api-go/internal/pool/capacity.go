// capacity.go 模型容量视图（面板「容量与调度」板块的数据源）。
//
// 存在理由：现有观测是分裂的——
//   - /status 的 model_locks 只列出「已经被锁」的模型（ModelLockView 的
//     "有未过期限流" 过滤），空闲模型在清单里根本不出现；
//   - 账号池视图回答的是「哪个号不能用」，回答不了「哪个模型此刻还能用、为什么
//     不能用、是拥堵还是彻底没号」。
//
// 本视图把两件事补齐：全量模型的三态容量（idle / busy / unavailable）与**判定
// 依据**（模型锁 / 账号冷却 / 在途打满 / 无号）。与选号口径严格一致（同一个
// healthyForModel + inFlightFull），不引入第二套健康定义——否则面板说可用、
// 实际选不到号，运维只会更困惑。
package pool

import (
	"sort"
	"time"
)

// 容量三态。
const (
	// CapacityIdle 空闲：该域参与选号的账号全部能服务这个模型。
	CapacityIdle = "idle"
	// CapacityBusy 拥堵：还有号能服务，但已有号被挡（模型锁 / 账号冷却 / 在途满）。
	CapacityBusy = "busy"
	// CapacityUnavailable 不可用：此刻没有任何号能服务这个模型。
	CapacityUnavailable = "unavailable"
)

// 拥堵/不可用的主导原因（BlockedBy）。前端按它给出「该怎么办」的一句话。
const (
	BlockedModelLock     = "model_lock"     // 6004/11102 模型级冷却 → 换模型或等解锁
	BlockedAccountCooling = "account_cooling" // 账号级 429 / 熔断 / 连败降权 → 等号恢复
	BlockedInFlight      = "in_flight"      // 在途打满 → 并发降下来就好
	BlockedNoAccount     = "no_account"     // 该域没有参与选号的账号
)

// ModelCapacityRow 单模型在一个域内的容量快照。
type ModelCapacityRow struct {
	Model string `json:"model"`
	Realm string `json:"realm"`
	// Total 该域参与选号的账号数（disabled / paused 不计，与选号口径一致）。
	Total int `json:"total"`
	// Servable 此刻真能服务该模型的账号数（healthyForModel 且未在途占满）。
	Servable int `json:"servable"`
	// Locked 被该模型自身的冷却挡住（6004 限额 / 11102 无此模型）。
	Locked int `json:"locked"`
	// Cooling 被账号级状态挡住（429 冷却 / 熔断 / 连败降权），与模型无关。
	Cooling int `json:"cooling"`
	// InFlightFull 因为该账号在途已满而暂时不可用（不是故障，是并发上限）。
	InFlightFull int `json:"in_flight_full"`
	// InFlight 该域此刻的总在途请求数（运维看并发水位）。
	InFlight int `json:"in_flight"`
	// State idle / busy / unavailable。
	State string `json:"state"`
	// BlockedBy 主导原因（idle 时为空）。
	BlockedBy string `json:"blocked_by,omitempty"`
	// UnlockAt 最早解锁时刻：被挡的号里第一个恢复的时间（拥堵时＝何时值得重试）。
	// 用指针而不是 time.Time：time.Time 的零值不受 omitempty 约束，会序列化成
	// "0001-01-01T00:00:00Z"，前端就显示出一个荒唐的「01/01 08:05」。
	UnlockAt *time.Time `json:"unlock_at,omitempty"`
	// Reason 上游原文/冷却原因（取最早解锁号的 reason）。
	Reason string `json:"reason,omitempty"`
}

// SchedulingView 当前选号调度参数（面板「调度」小节）。
type SchedulingView struct {
	Domestic          string `json:"domestic"`
	International     string `json:"international"`
	MaxInFlight       int    `json:"max_in_flight"`
	MaxInFlightGlobal int    `json:"max_in_flight_global"`
	CreditFloor       int64  `json:"credit_floor"`
	CrossDomain       bool   `json:"cross_domain_fallback"`
	PreferExpiring    bool   `json:"prefer_expiring"`
}

// SchedulingView 快照当前调度参数（只读，持 RLock）。
func (p *Pool) SchedulingView() SchedulingView {
	p.mu.RLock()
	defer p.mu.RUnlock()
	dom := p.strategies.Domestic
	if dom == "" {
		dom = WeightedRandom // 零值 = 未设置，按默认策略展示（不是"没有策略"）
	}
	intl := p.strategies.International
	if intl == "" {
		intl = WeightedRandom
	}
	return SchedulingView{
		Domestic:          dom,
		International:     intl,
		MaxInFlight:       p.maxInFlight,
		MaxInFlightGlobal: p.maxInFlightGlobal,
		CreditFloor:       p.creditFloor,
		CrossDomain:       p.crossDomainFallback,
		PreferExpiring:    p.preferExpiring,
	}
}

// ModelCapacityView 计算指定模型清单在给定域的容量行。
// models 为裸模型名（不含 cn:/global: 前缀）；空清单返回空切片（面板显示空态）。
// 结果按「不可用 → 拥堵 → 空闲」排序，同态内按模型名，保证面板顺序稳定。
func (p *Pool) ModelCapacityView(models []string, realm string) []ModelCapacityRow {
	if len(models) == 0 {
		return []ModelCapacityRow{}
	}
	p.mu.RLock()
	defer p.mu.RUnlock()
	now := time.Now()
	rows := make([]ModelCapacityRow, 0, len(models))
	for _, model := range models {
		row := ModelCapacityRow{Model: model, Realm: realm}
		for _, e := range p.byUID {
			if e.a.Realm() != realm {
				continue
			}
			// disabled / paused 不参与选号：把它们算进分母会让「1/1 空闲」变
			// 「1/3 拥堵」，与选号结论相反。
			if e.disabled || e.paused {
				continue
			}
			row.Total++
			row.InFlight += int(e.inFlight.Load())
			mc, cooled := e.modelCooldownActive(now, model)
			switch {
			case cooled:
				row.Locked++
				if row.UnlockAt == nil || mc.Until.Before(*row.UnlockAt) {
					at := mc.Until
					row.UnlockAt = &at
					row.Reason = mc.Reason
				}
			case !e.healthy(now):
				row.Cooling++
				if at := e.blockedUntil(now); !at.IsZero() && (row.UnlockAt == nil || at.Before(*row.UnlockAt)) {
					row.UnlockAt = &at
					if row.Reason == "" {
						row.Reason = e.reason
					}
				}
			case p.inFlightFull(e):
				row.InFlightFull++
			default:
				row.Servable++
			}
		}

		switch {
		case row.Total == 0:
			row.State = CapacityUnavailable
			row.BlockedBy = BlockedNoAccount
		case row.Servable == 0:
			row.State = CapacityUnavailable
			row.BlockedBy = capacityBlocker(row)
		case row.Servable == row.Total:
			row.State = CapacityIdle
		default:
			row.State = CapacityBusy
			row.BlockedBy = capacityBlocker(row)
		}
		rows = append(rows, row)
	}

	rank := func(s string) int {
		switch s {
		case CapacityUnavailable:
			return 0
		case CapacityBusy:
			return 1
		}
		return 2
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if ri, rj := rank(rows[i].State), rank(rows[j].State); ri != rj {
			return ri < rj
		}
		return rows[i].Model < rows[j].Model
	})
	return rows
}

// capacityBlocker 选主导原因：模型锁 > 账号冷却 > 在途满。
// 顺序有语义：模型锁最明确（要等上游重置），先告诉运维；在途满是最容易自己消掉的。
func capacityBlocker(row ModelCapacityRow) string {
	switch {
	case row.Locked > 0:
		return BlockedModelLock
	case row.Cooling > 0:
		return BlockedAccountCooling
	case row.InFlightFull > 0:
		return BlockedInFlight
	}
	return ""
}

// modelCooldownActive 报告该账号对该模型是否有**真正拦路由**的模型级冷却。
// AuditOnly 台账（无重置时间的 6004）不改变选号，此处必须同样忽略。
func (e *entry) modelCooldownActive(now time.Time, model string) (modelCooldown, bool) {
	if e.modelCooldowns == nil {
		return modelCooldown{}, false
	}
	mc, ok := e.modelCooldowns[model]
	if !ok || mc.AuditOnly || mc.Until.IsZero() || !now.Before(mc.Until) {
		return modelCooldown{}, false
	}
	return mc, true
}

// blockedUntil 账号级最早恢复时刻（冷却 / 熔断 / 降权三者取最早的非零未来值）。
// 三者是正交的闸门，任一未过都会让账号不健康；给运维一个「什么时候可能好」即可。
func (e *entry) blockedUntil(now time.Time) time.Time {
	var out time.Time
	for _, t := range []time.Time{e.until, e.breakerUntil, e.degradeUntil} {
		if t.IsZero() || !now.Before(t) {
			continue
		}
		if out.IsZero() || t.Before(out) {
			out = t
		}
	}
	return out
}
