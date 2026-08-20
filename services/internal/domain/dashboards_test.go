package domain_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestCreateDashboard_LandsOnTheStreamWithDefaultTiles(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	row, version, err := svc.CreateDashboard(ctx, p, domain.CreateDashboardInput{
		Name: "Delivery",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if version == 0 {
		t.Fatal("a dashboard must land on the sync stream")
	}
	if row.Name != "Delivery" || row.OwnerID != nil || row.TeamID != nil {
		t.Fatalf("dashboard = %#v", row)
	}

	tiles, err := db.Queries().ListDashboardTiles(ctx, row.ID)
	if err != nil {
		t.Fatalf("tiles: %v", err)
	}
	if len(tiles) != 2 {
		t.Fatalf("got %d tiles, want the two default Insights tiles", len(tiles))
	}
	if tiles[0].Measure != model.DashboardMeasureCount || tiles[1].Measure != model.DashboardMeasureEffort {
		t.Fatalf("measures = %q, %q", tiles[0].Measure, tiles[1].Measure)
	}
}

func TestCreateDashboard_RefusesAnEmptyName(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	_, _, err := svc.CreateDashboard(ctx, p, domain.CreateDashboardInput{Name: "   "})
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("got %v, want validation", err)
	}
}

func TestCreateDashboard_PersonalIsScopedToTheOwner(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	row, _, err := svc.CreateDashboard(ctx, p, domain.CreateDashboardInput{
		Name: "Mine", Private: true,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if row.OwnerID == nil || *row.OwnerID != p.UserID {
		t.Fatalf("owner = %#v", row.OwnerID)
	}

	otherID := f.NewUser(t, "other", "member", true)
	other := f.PrincipalFor(otherID, authz.RoleMember, f.TeamID)
	_, _, err = svc.UpdateDashboard(ctx, other, domain.UpdateDashboardInput{
		ID: row.ID, Name: ptr("Hijacked"),
	})
	if platform.CodeOf(err) != platform.CodeNotFound {
		t.Fatalf("got %v, want not found — a personal dashboard is invisible to everybody else", err)
	}
}

func TestCreateDashboard_GuestsAreRefused(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	guestID := f.NewUser(t, "guest", "guest", false)
	guest := f.PrincipalFor(guestID, authz.RoleGuest, f.TeamID)

	_, _, err := svc.CreateDashboard(ctx, guest, domain.CreateDashboardInput{Name: "Ops"})
	if platform.CodeOf(err) != platform.CodeForbidden {
		t.Fatalf("got %v, want forbidden", err)
	}
}

func TestCreateDashboardTile_ReusesInsightMeasures(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	dash, _, err := svc.CreateDashboard(ctx, p, domain.CreateDashboardInput{Name: "Cycle health"})
	if err != nil {
		t.Fatalf("dashboard: %v", err)
	}

	tile, version, err := svc.CreateDashboardTile(ctx, p, domain.CreateDashboardTileInput{
		DashboardID: dash.ID,
		Title:       "Lead time",
		Measure:     model.DashboardMeasureLeadTime,
		Slice:       model.DashboardSliceTeam,
		Display:     model.DashboardDisplayMetric,
		Filter:      json.RawMessage(`{"field":"priority","op":"eq","values":["1"]}`),
	})
	if err != nil {
		t.Fatalf("tile: %v", err)
	}
	if version == 0 {
		t.Fatal("a tile must land on the sync stream")
	}
	if tile.Measure != model.DashboardMeasureLeadTime || tile.Display != model.DashboardDisplayMetric {
		t.Fatalf("tile = %#v", tile)
	}
}

func TestCreateDashboardTile_RefusesAnUnknownMeasure(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	dash, _, err := svc.CreateDashboard(ctx, p, domain.CreateDashboardInput{Name: "Ops"})
	if err != nil {
		t.Fatalf("dashboard: %v", err)
	}
	_, _, err = svc.CreateDashboardTile(ctx, p, domain.CreateDashboardTileInput{
		DashboardID: dash.ID, Measure: "velocity",
	})
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("got %v, want validation", err)
	}
}

func TestDeleteDashboard_SoftDeletesTheRow(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	dash, _, err := svc.CreateDashboard(ctx, p, domain.CreateDashboardInput{Name: "Gone"})
	if err != nil {
		t.Fatalf("dashboard: %v", err)
	}
	if _, err := svc.DeleteDashboard(ctx, p, dash.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	row, err := db.Queries().GetDashboard(ctx, dash.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if row.DeletedAt == nil {
		t.Fatal("deleted dashboard still looks live")
	}
}
