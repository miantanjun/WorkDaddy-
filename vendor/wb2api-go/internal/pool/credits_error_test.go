package pool

import (
	"testing"
)

// 余额刷新失败留痕（B11）。
//
// 缺口原貌：RunBalanceRefreshNow 失败时只打一行 stdout，credits 保持上一次成功
// 刷新的旧值，面板照常显示「余额刷新 X 分钟前」——一个 token 已死的账号会长期
// 顶着几万旧积分，看起来完全正常。这组用例钉住「失败可观测、成功即清除」。
func TestCreditsErrorSurfacedAndCleared(t *testing.T) {
	p := newCapPool(capAuth("u1"))

	p.SetCreditsError("u1", "401 unauthorized: token revoked")
	st, ok := p.Status("u1")
	if !ok {
		t.Fatal("账号不在池里")
	}
	if st.CreditsError == "" || st.CreditsErrorAt.IsZero() {
		t.Fatalf("失败未透出：err=%q at=%v", st.CreditsError, st.CreditsErrorAt)
	}

	// 刷新成功 = 余额新鲜：错误必须被清掉，否则面板会一直挂着一个早就不成立的提示。
	p.SetCreditsSnapshot("u1", CreditsSnapshot{Remain: 1200, Total: 2000})
	st, _ = p.Status("u1")
	if st.CreditsError != "" || !st.CreditsErrorAt.IsZero() {
		t.Fatalf("成功刷新后错误未清除：%q / %v", st.CreditsError, st.CreditsErrorAt)
	}
	if st.Credits != 1200 {
		t.Fatalf("credits=%d want 1200", st.Credits)
	}
}

// 清空是幂等的：重复调用不产生状态变化（调用方可以无条件在成功路径调用）。
func TestSetCreditsErrorClearIsIdempotent(t *testing.T) {
	p := newCapPool(capAuth("u1"))
	p.SetCreditsError("u1", "")
	p.SetCreditsError("u1", "")
	st, _ := p.Status("u1")
	if st.CreditsError != "" {
		t.Fatalf("空 reason 不应写入错误：%q", st.CreditsError)
	}
}

// 未知账号静默忽略（面板删号与刷新任务并发时不 panic）。
func TestSetCreditsErrorUnknownUID(t *testing.T) {
	p := newCapPool()
	p.SetCreditsError("nope", "boom")
}
