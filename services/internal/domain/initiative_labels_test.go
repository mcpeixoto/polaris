package domain_test

import (
	"context"
	"strings"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestAddInitiativeLabel_AppliesAndRefusesASecondFromTheSameGroup(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	init := mustInitiative(t, svc, p, "Platform")
	group := mustInitiativeLabel(t, svc, p, domain.CreateInitiativeLabelInput{
		Name: "Team", IsGroup: true,
	})
	platformLbl := mustInitiativeLabel(t, svc, p, domain.CreateInitiativeLabelInput{
		Name: "Platform", ParentID: &group.ID,
	})
	growth := mustInitiativeLabel(t, svc, p, domain.CreateInitiativeLabelInput{
		Name: "Growth", ParentID: &group.ID,
	})

	if _, _, err := svc.AddInitiativeLabel(ctx, p, init.ID, platformLbl.ID); err != nil {
		t.Fatalf("apply Platform: %v", err)
	}
	_, _, err := svc.AddInitiativeLabel(ctx, p, init.ID, growth.ID)
	if err == nil {
		t.Fatal("an initiative accepted two labels from one group")
	}
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("got %v, want validation", err)
	}
	if !strings.Contains(err.Error(), "Team") {
		t.Fatalf("error %q does not name the group", err)
	}
}

func TestArchiveInitiativeLabel_RefusesWhileStillInUse(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	init := mustInitiative(t, svc, p, "Reliability")
	label := mustInitiativeLabel(t, svc, p, domain.CreateInitiativeLabelInput{Name: "Region"})
	if _, _, err := svc.AddInitiativeLabel(ctx, p, init.ID, label.ID); err != nil {
		t.Fatalf("apply: %v", err)
	}

	_, err := svc.ArchiveInitiativeLabel(ctx, p, label.ID, true)
	if err == nil {
		t.Fatal("a label still applied to an initiative was archived")
	}
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("got %v, want validation", err)
	}
	if !strings.Contains(err.Error(), "1 initiative") {
		t.Fatalf("error %q does not say how many initiatives still carry it", err)
	}

	if _, _, err := svc.RemoveInitiativeLabel(ctx, p, init.ID, label.ID); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if _, err := svc.ArchiveInitiativeLabel(ctx, p, label.ID, true); err != nil {
		t.Fatalf("archive after last application: %v", err)
	}
}

func mustInitiativeLabel(
	t *testing.T, svc *domain.Service, p *authz.Principal, in domain.CreateInitiativeLabelInput,
) model.InitiativeLabel {
	t.Helper()
	label, _, err := svc.CreateInitiativeLabel(context.Background(), p, in)
	if err != nil {
		t.Fatalf("create initiative label %q: %v", in.Name, err)
	}
	return label
}

func mustInitiative(
	t *testing.T, svc *domain.Service, p *authz.Principal, name string,
) model.Initiative {
	t.Helper()
	init, _, err := svc.CreateInitiative(context.Background(), p, domain.CreateInitiativeInput{Name: name})
	if err != nil {
		t.Fatalf("create initiative %q: %v", name, err)
	}
	return init
}
