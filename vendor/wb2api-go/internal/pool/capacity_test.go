package pool

import (
	"testing"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
)

// newCapPool 构造容量测试池：确定性随机源 + 指定积分，账号 realm 默认 cn。
func newCapPool(auths ...*auth.Auth) *Pool {
	p := New("")
	p.SetRandomSource(func(n int64) int64 { return 0 })
	for _, a := range auths {
		p.Add(a)
		p.SetCredits(a.UID, 1000, 0)
	}
	return p
}

func capAuth(uid string) *auth.Auth {
	return &auth.Auth{UID: uid, AccessToken: "at-" + uid, ExpiresAt: 9999999999}
}

// rowOf 从视图里取某模型行。
func rowOf(rows []ModelCapacityRow, model string) (ModelCapacityRow, bool) {
	for _, r := range rows {
		if r.Model == model {
			return r, true
		}
	}
	return ModelCapacityRow{}, false
}

// TestCapacityIdle 全部号都能服务 → idle，且不该给出任何 blocked_by。
func TestCapacityIdle(t *testing.T) {
	p := newCapPool(capAuth("u1"), capAuth("u2"))
	rows := p.ModelCapacityView([]string{"glm-5.2"}, "cn")
	r, ok := rowOf(rows, "glm-5.2")
	if !ok {
		t.Fatal("缺少模型行")
	}
	if r.State != CapacityIdle {
		t.Fatalf("state=%s want idle", r.State)
	}
	if r.Total != 2 || r.Servable != 2 {
		t.Fatalf("total/servable=%d/%d want 2/2", r.Total, r.Servable)
	}
	if r.BlockedBy != "" {
		t.Fatalf("空闲不应有 blocked_by：%q", r.BlockedBy)
	}
}

// TestCapacityPartialModelLock 一个号对该模型 6004 冷却 → busy + model_lock，
// 且 Total 不受影响（锁号仍在分母里：它是"可选/总数"的一半信息）。
func TestCapacityPartialModelLock(t *testing.T) {
	p := newCapPool(capAuth("u1"), capAuth("u2"))
	p.CooldownSoftForModel("u1", time.Minute, time.Now().Add(5*time.Minute), "glm-5.2", "6004 model rate limit")
	r, _ := rowOf(p.ModelCapacityView([]string{"glm-5.2"}, "cn"), "glm-5.2")
	if r.State != CapacityBusy {
		t.Fatalf("state=%s want busy", r.State)
	}
	if r.Locked != 1 || r.Servable != 1 || r.Total != 2 {
		t.Fatalf("locked/servable/total=%d/%d/%d want 1/1/2", r.Locked, r.Servable, r.Total)
	}
	if r.BlockedBy != BlockedModelLock {
		t.Fatalf("blocked_by=%q want model_lock", r.BlockedBy)
	}
	if r.UnlockAt == nil {
		t.Fatal("拥堵时应有最早恢复时刻")
	}
}

// TestCapacityAllLocked 全部号对该模型冷却 → unavailable + model_lock。
func TestCapacityAllLocked(t *testing.T) {
	p := newCapPool(capAuth("u1"), capAuth("u2"))
	until := time.Now().Add(3 * time.Minute)
	p.CooldownSoftForModel("u1", time.Minute, until, "glm-5.2", "6004")
	p.CooldownSoftForModel("u2", time.Minute, until.Add(time.Minute), "glm-5.2", "6004")
	r, _ := rowOf(p.ModelCapacityView([]string{"glm-5.2"}, "cn"), "glm-5.2")
	if r.State != CapacityUnavailable {
		t.Fatalf("state=%s want unavailable", r.State)
	}
	if r.BlockedBy != BlockedModelLock {
		t.Fatalf("blocked_by=%q want model_lock", r.BlockedBy)
	}
	// 最早恢复 = 两个解锁时刻里更早的那个（u1）
	if r.UnlockAt == nil || r.UnlockAt.Sub(until).Abs() > time.Second {
		t.Fatalf("unlock_at=%v 应取最早解锁（约 %v）", r.UnlockAt, until)
	}
}

// TestCapacityAccountCooling 账号级 429（与模型无关）→ busy + account_cooling。
// 这条区分很重要：模型锁要等上游重置，账号冷却可以换个号立刻绕开。
func TestCapacityAccountCooling(t *testing.T) {
	p := newCapPool(capAuth("u1"), capAuth("u2"))
	p.CooldownSoftRate("u1", time.Minute, time.Now().Add(2*time.Minute), "429 rate limit")
	r, _ := rowOf(p.ModelCapacityView([]string{"glm-5.2"}, "cn"), "glm-5.2")
	if r.State != CapacityBusy {
		t.Fatalf("state=%s want busy", r.State)
	}
	if r.Cooling != 1 || r.Locked != 0 {
		t.Fatalf("cooling/locked=%d/%d want 1/0", r.Cooling, r.Locked)
	}
	if r.BlockedBy != BlockedAccountCooling {
		t.Fatalf("blocked_by=%q want account_cooling", r.BlockedBy)
	}
}

// TestCapacityInFlightFull 在途打满（并发上限）也是拥堵，但原因是在途而不是故障。
func TestCapacityInFlightFull(t *testing.T) {
	p := newCapPool(capAuth("u1"))
	p.SetMaxInFlight(1)
	if !p.Acquire("u1") {
		t.Fatal("首个租约应成功")
	}
	defer p.Release("u1")
	r, _ := rowOf(p.ModelCapacityView([]string{"glm-5.2"}, "cn"), "glm-5.2")
	if r.State != CapacityUnavailable {
		t.Fatalf("state=%s want unavailable（唯一号在途满，此刻确实没号可服务）", r.State)
	}
	if r.BlockedBy != BlockedInFlight {
		t.Fatalf("blocked_by=%q want in_flight", r.BlockedBy)
	}
	if r.InFlight != 1 {
		t.Fatalf("in_flight=%d want 1", r.InFlight)
	}
}

// TestCapacityIgnoresDisabledAndPaused 禁用/暂停号不参与选号，也不该污染分母。
func TestCapacityIgnoresDisabledAndPaused(t *testing.T) {
	p := newCapPool(capAuth("u1"), capAuth("u2"), capAuth("u3"))
	p.Disable("u2", "manual")
	p.Pause("u3")
	r, _ := rowOf(p.ModelCapacityView([]string{"glm-5.2"}, "cn"), "glm-5.2")
	if r.Total != 1 || r.Servable != 1 {
		t.Fatalf("total/servable=%d/%d want 1/1（禁用与暂停号不进分母）", r.Total, r.Servable)
	}
	if r.State != CapacityIdle {
		t.Fatalf("state=%s want idle", r.State)
	}
}

// TestCapacityNoAccount 池里没有该域账号 → unavailable + no_account（配置问题，不是故障）。
func TestCapacityNoAccount(t *testing.T) {
	p := newCapPool()
	r, _ := rowOf(p.ModelCapacityView([]string{"glm-5.2"}, "cn"), "glm-5.2")
	if r.State != CapacityUnavailable || r.BlockedBy != BlockedNoAccount {
		t.Fatalf("state/blocked_by=%s/%s want unavailable/no_account", r.State, r.BlockedBy)
	}
}

// TestCapacitySortOrder 排序：不可用 → 拥堵 → 空闲（面板第一屏就是问题模型）。
func TestCapacitySortOrder(t *testing.T) {
	p := newCapPool(capAuth("u1"), capAuth("u2"))
	p.CooldownSoftForModel("u1", time.Minute, time.Now().Add(time.Minute), "locked-model", "6004")
	rows := p.ModelCapacityView([]string{"idle-model", "locked-model"}, "cn")
	if len(rows) != 2 {
		t.Fatalf("rows=%d", len(rows))
	}
	if rows[0].Model != "locked-model" {
		t.Fatalf("首行应是异常模型，实际=%s", rows[0].Model)
	}
}

// TestSchedulingViewDefaults 调度参数零值必须归一成加权随机（不是"没有策略"），
// 否则面板会显示一片空白让人以为配置坏了。
func TestSchedulingViewDefaults(t *testing.T) {
	p := newCapPool()
	sv := p.SchedulingView()
	if sv.Domestic != WeightedRandom || sv.International != WeightedRandom {
		t.Fatalf("默认策略=%q/%q want weighted_random", sv.Domestic, sv.International)
	}
	if !sv.PreferExpiring {
		t.Fatal("最早到期优先默认应为开")
	}
}
