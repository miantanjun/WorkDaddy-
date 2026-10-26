package panel

import (
	"testing"

	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
)

// 探测模型的选择规则：优先上游标记的默认模型，其次列表第一个，空列表返回空。
// 这条规则决定了健康检查第三步打的是哪个模型 —— 选错会打到贵模型或多模态模型上。

func TestProbeModelPrefersDefault(t *testing.T) {
	models := []upstream.ModelInfo{
		{ID: "cheap"},
		{ID: "auto", IsDefault: true},
		{ID: "expensive"},
	}
	if got := probeModel(models); got != "auto" {
		t.Fatalf("期望选中 IsDefault 的 auto，实际 %q", got)
	}
}

func TestProbeModelFallsBackToFirst(t *testing.T) {
	models := []upstream.ModelInfo{{ID: "first"}, {ID: "second"}}
	if got := probeModel(models); got != "first" {
		t.Fatalf("没有默认模型时应取第一个，实际 %q", got)
	}
}

func TestProbeModelEmptyList(t *testing.T) {
	if got := probeModel(nil); got != "" {
		t.Fatalf("空列表应返回空串，实际 %q", got)
	}
	if got := probeModel([]upstream.ModelInfo{}); got != "" {
		t.Fatalf("空切片应返回空串，实际 %q", got)
	}
}

func TestProbeModelSkipsEmptyID(t *testing.T) {
	// 上游偶尔给出 ID 为空的占位项：默认项 ID 为空时必须继续往下找，不能直接返回空。
	models := []upstream.ModelInfo{
		{ID: "", IsDefault: true},
		{ID: "real"},
	}
	if got := probeModel(models); got != "real" {
		t.Fatalf("默认项 ID 为空时应回落到 %q，实际 %q", "real", got)
	}
}
