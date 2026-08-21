package domain_test

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestCreateInitiative_NestsUnderTheParentItWasGiven(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	parent := mustInitiative(t, svc, p, "Company goals")
	child, _, err := svc.CreateInitiative(ctx, p, domain.CreateInitiativeInput{
		Name:               "Platform reliability",
		ParentInitiativeID: &parent.ID,
	})
	if err != nil {
		t.Fatalf("create nested: %v", err)
	}

	_, _, err = svc.AddInitiativeRelation(ctx, p, parent.ID, child.ID)
	if err == nil {
		t.Fatal("a nest created at create-time was accepted a second time")
	}
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("got %v, want validation for an existing nest", err)
	}
}

func TestAddInitiativeRelation_RefusesACycle(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	a := mustInitiative(t, svc, p, "A")
	b := mustInitiative(t, svc, p, "B")
	if _, _, err := svc.AddInitiativeRelation(ctx, p, a.ID, b.ID); err != nil {
		t.Fatalf("A→B: %v", err)
	}
	_, _, err := svc.AddInitiativeRelation(ctx, p, b.ID, a.ID)
	if err == nil {
		t.Fatal("a cycle was accepted")
	}
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("got %v, want validation", err)
	}
	if !strings.Contains(err.Error(), "cycle") {
		t.Fatalf("error %q does not mention a cycle", err)
	}
}

func TestAddInitiativeRelation_RefusesASixthLevel(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	prev := mustInitiative(t, svc, p, "L1")
	for n := 2; n <= domain.MaxInitiativeNesting; n++ {
		next := mustInitiative(t, svc, p, fmt.Sprintf("L%d", n))
		if _, _, err := svc.AddInitiativeRelation(ctx, p, prev.ID, next.ID); err != nil {
			t.Fatalf("nest L%d: %v", n, err)
		}
		prev = next
	}

	sixth := mustInitiative(t, svc, p, "L6")
	_, _, err := svc.AddInitiativeRelation(ctx, p, prev.ID, sixth.ID)
	if err == nil {
		t.Fatal("a sixth nesting level was accepted")
	}
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("got %v, want validation", err)
	}
	if !strings.Contains(err.Error(), "five") {
		t.Fatalf("error %q does not mention the five-level limit", err)
	}
}

func TestRemoveInitiativeRelation_DropsTheNest(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	parent := mustInitiative(t, svc, p, "Parent")
	child := mustInitiative(t, svc, p, "Child")
	if _, _, err := svc.AddInitiativeRelation(ctx, p, parent.ID, child.ID); err != nil {
		t.Fatalf("nest: %v", err)
	}
	if _, _, err := svc.RemoveInitiativeRelation(ctx, p, parent.ID, child.ID); err != nil {
		t.Fatalf("unnest: %v", err)
	}
	_, _, err := svc.RemoveInitiativeRelation(ctx, p, parent.ID, child.ID)
	if err == nil {
		t.Fatal("removing a missing nest succeeded")
	}
}
