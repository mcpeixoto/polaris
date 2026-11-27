package linear

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/peixotolabs/polaris/services/internal/platform"
)

func testClient(url string) (*Client, *[]time.Duration) {
	c := NewClient(url, "lin_api_test", nil)
	var waits []time.Duration
	c.sleep = func(_ context.Context, d time.Duration) error {
		waits = append(waits, d)
		return nil
	}
	return c, &waits
}

func TestClient_PaginatesUntilLinearSaysThereIsNoNextPage(t *testing.T) {
	var mu sync.Mutex
	var afters []any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req gqlRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Errorf("decode request: %v", err)
		}
		mu.Lock()
		afters = append(afters, req.Variables["after"])
		mu.Unlock()
		if req.Variables["first"] != float64(pageSize) {
			t.Errorf("first = %v, want %d", req.Variables["first"], pageSize)
		}
		if req.Variables["after"] == nil {
			_, _ = io.WriteString(w, `{"data":{"teams":{"nodes":[{"id":"t1","key":"ENG","name":"Engineering"}],
				"pageInfo":{"hasNextPage":true,"endCursor":"c1"}}}}`)
			return
		}
		_, _ = io.WriteString(w, `{"data":{"teams":{"nodes":[{"id":"t2","key":"OPS","name":"Ops"}],
			"pageInfo":{"hasNextPage":false,"endCursor":"c2"}}}}`)
	}))
	defer srv.Close()

	c, _ := testClient(srv.URL)
	teams, err := paginate[Team](context.Background(), c, "teams", teamsQuery)
	if err != nil {
		t.Fatalf("paginate: %v", err)
	}
	if len(teams) != 2 || teams[0].ID != "t1" || teams[1].ID != "t2" {
		t.Fatalf("got %+v, want t1 then t2", teams)
	}
	if len(afters) != 2 || afters[0] != nil || afters[1] != "c1" {
		t.Errorf("cursors sent = %v, want [<nil> c1]", afters)
	}
}

func TestClient_WaitsOutARateLimitAndThenSucceeds(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		switch calls {
		case 1:
			w.Header().Set("Retry-After", "3")
			w.WriteHeader(http.StatusTooManyRequests)
		case 2:
			// Linear's other way of saying it: a 200 carrying a RATELIMITED error.
			_, _ = io.WriteString(w, `{"errors":[{"message":"slow down","extensions":{"code":"RATELIMITED"}}]}`)
		default:
			_, _ = io.WriteString(w, `{"data":{"viewer":{"id":"u1","name":"Ada","email":"ada@example.com",
				"organization":{"id":"o1","name":"Acme","urlKey":"acme"}}}}`)
		}
	}))
	defer srv.Close()

	c, waits := testClient(srv.URL)
	v, err := c.Viewer(context.Background())
	if err != nil {
		t.Fatalf("viewer: %v", err)
	}
	if v.ID != "u1" {
		t.Errorf("viewer = %+v", v)
	}
	if calls != 3 {
		t.Errorf("made %d requests, want 3", calls)
	}
	// The first wait is the one Linear asked for; the second had no header and backs off.
	if len(*waits) != 2 || (*waits)[0] != 3*time.Second || (*waits)[1] != 2*time.Second {
		t.Errorf("waits = %v, want [3s 2s]", *waits)
	}
}

func TestClient_GivesUpAfterFiveRateLimitedTries(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer srv.Close()

	c, waits := testClient(srv.URL)
	_, err := c.Viewer(context.Background())
	if platform.CodeOf(err) != platform.CodeRateLimited {
		t.Fatalf("err = %v, want a rate-limit error", err)
	}
	if calls != maxTries {
		t.Errorf("made %d requests, want %d", calls, maxTries)
	}
	want := []time.Duration{time.Second, 2 * time.Second, 4 * time.Second, 8 * time.Second}
	if len(*waits) != len(want) {
		t.Fatalf("waits = %v, want %v", *waits, want)
	}
	for i := range want {
		if (*waits)[i] != want[i] {
			t.Errorf("wait %d = %v, want %v", i, (*waits)[i], want[i])
		}
	}
}

func TestClient_SendsThePersonalKeyBareWithoutBearer(t *testing.T) {
	var got string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.Header.Get("Authorization")
		_, _ = io.WriteString(w, `{"data":{"viewer":{"id":"u1","name":"","email":"","organization":{"id":"o","name":"","urlKey":""}}}}`)
	}))
	defer srv.Close()

	c, _ := testClient(srv.URL)
	if _, err := c.Viewer(context.Background()); err != nil {
		t.Fatalf("viewer: %v", err)
	}
	if got != "lin_api_test" {
		t.Errorf("Authorization = %q, want the key exactly as given", got)
	}
}

func TestClient_ARejectedKeyIsAValidationErrorOnTheKey(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, `{"errors":[{"message":"Authentication required","extensions":{"code":"AUTHENTICATION_ERROR"}}]}`)
	}))
	defer srv.Close()

	c, _ := testClient(srv.URL)
	_, err := c.Viewer(context.Background())
	if !isFieldError(err, "apiKey") {
		t.Errorf("err = %v, want a validation error on apiKey", err)
	}
}

func TestRetryAfter_ReadsLinearsResetTimestamp(t *testing.T) {
	now := time.UnixMilli(1_700_000_000_000)
	h := http.Header{}
	h.Set("X-RateLimit-Requests-Reset", "1700000004000")
	if got := retryAfter(h, now); got != 4*time.Second {
		t.Errorf("retryAfter = %v, want 4s", got)
	}
}
