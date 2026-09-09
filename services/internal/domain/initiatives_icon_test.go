package domain_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func strPtr(s string) *string { return &s }

func TestCreateInitiative_IconAndColourRoundTrip(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	created, _, err := svc.CreateInitiative(ctx, p, domain.CreateInitiativeInput{
		Name:  "Decorated",
		Icon:  strPtr("🚀"),
		Color: strPtr("#4f46e5"),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if created.Icon == nil || *created.Icon != "🚀" {
		t.Fatalf("created icon = %v, want 🚀", created.Icon)
	}
	if created.Color != "#4f46e5" {
		t.Fatalf("created color = %q, want #4f46e5", created.Color)
	}

	got, err := svc.GetInitiative(ctx, p, created.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Icon == nil || *got.Icon != "🚀" {
		t.Fatalf("read-back icon = %v, want 🚀", got.Icon)
	}
	if got.Color != "#4f46e5" {
		t.Fatalf("read-back color = %q, want #4f46e5", got.Color)
	}
}

func TestCreateInitiative_DefaultsColourLikeAProject(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	created, _, err := svc.CreateInitiative(ctx, p, domain.CreateInitiativeInput{Name: "Plain"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if created.Color != "#6b7280" {
		t.Fatalf("default color = %q, want #6b7280", created.Color)
	}
	if created.Icon != nil {
		t.Fatalf("default icon = %q, want none", *created.Icon)
	}
}

func TestUpdateInitiative_SetsIconAndColourIndependently(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	created, _, err := svc.CreateInitiative(ctx, p, domain.CreateInitiativeInput{Name: "Plain"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	both, _, err := svc.UpdateInitiative(ctx, p, domain.UpdateInitiativeInput{
		ID:    created.ID,
		Icon:  strPtr("🎯"),
		Color: strPtr("#16a34a"),
	})
	if err != nil {
		t.Fatalf("update both: %v", err)
	}
	if both.Icon == nil || *both.Icon != "🎯" {
		t.Fatalf("icon = %v, want 🎯", both.Icon)
	}
	if both.Color != "#16a34a" {
		t.Fatalf("color = %q, want #16a34a", both.Color)
	}

	// Only the icon this time: the colour set above must survive, because the picker sends
	// one field at a time and a COALESCE that reset the other would flicker it back to grey.
	iconOnly, _, err := svc.UpdateInitiative(ctx, p, domain.UpdateInitiativeInput{
		ID:   created.ID,
		Icon: strPtr("icon:flag"),
	})
	if err != nil {
		t.Fatalf("update icon only: %v", err)
	}
	if iconOnly.Icon == nil || *iconOnly.Icon != "icon:flag" {
		t.Fatalf("icon = %v, want icon:flag", iconOnly.Icon)
	}
	if iconOnly.Color != "#16a34a" {
		t.Fatalf("color after icon-only update = %q, want #16a34a unchanged", iconOnly.Color)
	}

	got, err := svc.GetInitiative(ctx, p, created.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Icon == nil || *got.Icon != "icon:flag" || got.Color != "#16a34a" {
		t.Fatalf("read-back = (%v, %q), want (icon:flag, #16a34a)", got.Icon, got.Color)
	}
}

func TestUpdateInitiative_RejectsAnOverlongIcon(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	created, _, err := svc.CreateInitiative(ctx, p, domain.CreateInitiativeInput{Name: "Plain"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	_, _, err = svc.UpdateInitiative(ctx, p, domain.UpdateInitiativeInput{
		ID:   created.ID,
		Icon: strPtr(strings.Repeat("x", 65)),
	})
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("got %v, want validation", err)
	}
	var pe *platform.Error
	if !errors.As(err, &pe) || pe.Field != "icon" {
		t.Fatalf("validation field = %q, want icon", fieldOf(err))
	}
}

func TestUpdateInitiative_RejectsANonHexColour(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	created, _, err := svc.CreateInitiative(ctx, p, domain.CreateInitiativeInput{Name: "Plain"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	_, _, err = svc.UpdateInitiative(ctx, p, domain.UpdateInitiativeInput{
		ID:    created.ID,
		Color: strPtr("blue"),
	})
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("got %v, want validation", err)
	}
	var pe *platform.Error
	if !errors.As(err, &pe) || pe.Field != "color" {
		t.Fatalf("validation field = %q, want color", fieldOf(err))
	}
}

func fieldOf(err error) string {
	var pe *platform.Error
	if errors.As(err, &pe) {
		return pe.Field
	}
	return ""
}
