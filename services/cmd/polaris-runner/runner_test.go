package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

// A delegated run has to come back as a finished run. The server requeues a claim
// that never finishes, so a runner that streamed a result and then exited without
// calling finish would run the same issue again on the next poll.
func TestOnce_FinishesDoneWithSessionAndTokens(t *testing.T) {
	stdin := filepath.Join(t.TempDir(), "stdin.txt")
	useFakeClaude(t, map[string]string{"POLARIS_FAKE_CLAUDE_STDIN": stdin})

	fake := newFakePolaris(t, http.StatusOK, claimBody(""), http.StatusNoContent)
	err := run([]string{
		"--url", fake.url,
		"--token", "test-token",
		"--preset", "claude",
		"--workdir", t.TempDir(),
		"--once",
	})
	if err != nil {
		t.Fatalf("run: %v", err)
	}

	got := fake.mustFinish(t)
	if got.Status != "done" || got.Error != "" {
		t.Fatalf("finish status %q error %q, want done", got.Status, got.Error)
	}
	if got.Summary != "fixed the login button" {
		t.Fatalf("summary %q", got.Summary)
	}
	if got.SessionRef != "ses_fake" {
		t.Fatalf("sessionRef %q", got.SessionRef)
	}
	if got.InputTokens != 120 || got.OutputTokens != 45 {
		t.Fatalf("tokens in=%d out=%d", got.InputTokens, got.OutputTokens)
	}

	var claim struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(fake.claimRequest(), &claim); err != nil {
		t.Fatalf("claim body: %v", err)
	}
	if claim.Version == "" {
		t.Fatal("claim did not send a version")
	}

	prompt, err := os.ReadFile(stdin)
	if err != nil {
		t.Fatalf("prompt was not passed on stdin: %v", err)
	}
	text := string(prompt)
	for _, want := range []string{
		"ENG-12",
		"Fix the login button",
		"The button does nothing.",
		"Ada",
		"Still broken on main.",
		"Commit nothing unless the issue asks",
		"short summary of what changed",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("prompt missing %q\n%s", want, text)
		}
	}
}

// The session comes back on the next claim. Without --resume the agent starts
// a second conversation and loses the workdir state the first one built up.
func TestResume_PassesResumeFlagToClaude(t *testing.T) {
	argv := filepath.Join(t.TempDir(), "argv.txt")
	useFakeClaude(t, map[string]string{"POLARIS_FAKE_CLAUDE_ARGV": argv})

	fake := newFakePolaris(t, http.StatusOK, claimBody("ses_resume"), http.StatusNoContent)
	if err := run([]string{
		"--url", fake.url,
		"--token", "test-token",
		"--preset", "claude",
		"--workdir", t.TempDir(),
		"--once",
	}); err != nil {
		t.Fatalf("run: %v", err)
	}

	got, err := os.ReadFile(argv)
	if err != nil {
		t.Fatalf("claude was not started: %v", err)
	}
	if !strings.Contains(string(got), "--resume\nses_resume\n") {
		t.Fatalf("args:\n%s", got)
	}
}

// 409 means the run was cancelled on the server. The child has to die, and the
// run has to be finished as a failure, or it stays claimed until the stale sweep
// and the agent keeps editing the workdir after a person took the issue back.
func TestHeartbeatConflict_KillsTheChildAndFinishesFailed(t *testing.T) {
	marker := filepath.Join(t.TempDir(), "marker.txt")
	useFakeClaude(t, map[string]string{
		"POLARIS_FAKE_CLAUDE_MARKER": marker,
		"POLARIS_FAKE_CLAUDE_HOLD":   "5",
	})

	fake := newFakePolaris(t, http.StatusOK, claimBody(""), http.StatusConflict)
	err := run([]string{
		"--url", fake.url,
		"--token", "test-token",
		"--preset", "claude",
		"--workdir", t.TempDir(),
		"--once",
	})
	if err == nil {
		t.Fatal("expected run to fail after a cancelled heartbeat")
	}

	got := fake.mustFinish(t)
	if got.Status != "failed" {
		t.Fatalf("finish status %q, want failed (%s)", got.Status, got.Error)
	}
	if fake.heartbeatCount() < 1 {
		t.Fatal("no heartbeat was sent")
	}
	switch strings.TrimSpace(readFile(t, marker)) {
	case "killed":
	default:
		t.Fatalf("child marker %q, want killed", readFile(t, marker))
	}
}

// --once with an empty queue is a successful poll, including from cron. Exiting
// non-zero there would page somebody because there was nothing to do.
func TestNothingDue_ExitsZeroWithoutRunningTheBinary(t *testing.T) {
	argv := filepath.Join(t.TempDir(), "argv.txt")
	useFakeClaude(t, map[string]string{"POLARIS_FAKE_CLAUDE_ARGV": argv})
	t.Setenv("POLARIS_RUNNER_TOKEN", "test-token")

	fake := newFakePolaris(t, http.StatusNoContent, nil, http.StatusNoContent)
	err := run([]string{
		"--url", fake.url,
		"--preset", "claude",
		"--workdir", t.TempDir(),
		"--once",
	})
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if _, err := os.Stat(argv); !os.IsNotExist(err) {
		t.Fatalf("claude was started, stat err=%v", err)
	}
	if fake.didFinish() {
		t.Fatal("finish was called with nothing claimed")
	}
}

func TestPresetLaunch_ResumeUnsafeAndMaxTurns(t *testing.T) {
	claude, err := lookupPreset("claude")
	if err != nil {
		t.Fatal(err)
	}
	got, err := claude.launch("ses_1", "prompt", 3, true)
	if err != nil {
		t.Fatal(err)
	}
	if got.bin != "claude" || got.promptVia != viaStdin {
		t.Fatalf("bin %q via %v", got.bin, got.promptVia)
	}
	want := []string{
		"-p", "--output-format", "stream-json", "--verbose",
		"--max-turns", "3", "--resume", "ses_1", "--dangerously-skip-permissions",
	}
	if !reflect.DeepEqual(got.args, want) {
		t.Fatalf("claude args %q", got.args)
	}

	codex, err := lookupPreset("codex")
	if err != nil {
		t.Fatal(err)
	}
	got, err = codex.launch("thr_1", "prompt", 0, true)
	if err != nil {
		t.Fatal(err)
	}
	want = []string{"exec", "--json", "resume", "thr_1", "--full-auto", "-"}
	if !reflect.DeepEqual(got.args, want) || got.promptVia != viaStdin {
		t.Fatalf("codex args %q via %v", got.args, got.promptVia)
	}

	opencode, err := lookupPreset("opencode")
	if err != nil {
		t.Fatal(err)
	}
	got, err = opencode.launch("ses_oc", "do the thing", 0, false)
	if err != nil {
		t.Fatal(err)
	}
	want = []string{"run", "--format", "json", "--session", "ses_oc", "do the thing"}
	if !reflect.DeepEqual(got.args, want) || got.promptVia != viaArg {
		t.Fatalf("opencode args %q via %v", got.args, got.promptVia)
	}
	if _, err := opencode.launch("", "x", 0, true); err == nil {
		t.Fatal("opencode accepted --unsafe-auto-approve with no flag to append")
	}
	if _, err := codex.launch("", "x", 4, false); err == nil {
		t.Fatal("codex accepted --max-turns")
	}

	t.Setenv("POLARIS_RUNNER_CODEX_BIN", "/opt/codex")
	got, err = codex.launch("", "prompt", 0, false)
	if err != nil {
		t.Fatal(err)
	}
	if got.bin != "/opt/codex" {
		t.Fatalf("bin %q", got.bin)
	}
	if !reflect.DeepEqual(got.args, []string{"exec", "--json", "-"}) {
		t.Fatalf("args %q", got.args)
	}
}

// The claim route sends state as an object. A runner that only accepted a string
// would fail every real claim, and one that kept only the name would hide whether
// the issue is still open.
func TestDecodeClaim_StateObjectKeepsNameAndType(t *testing.T) {
	body := []byte(`{
		"run": {"id": "run_1", "sessionRef": null},
		"issue": {
			"id": "iss_1",
			"identifier": "ENG-1",
			"title": "T",
			"description": "",
			"url": "",
			"team": {"key": "ENG", "name": "Engineering"},
			"state": {"name": "In Progress", "type": "started"},
			"priority": 0,
			"comments": []
		}
	}`)
	cl, err := decodeClaim(body)
	if err != nil {
		t.Fatal(err)
	}
	if cl.issue.state != "In Progress (started)" {
		t.Fatalf("state %q", cl.issue.state)
	}
	prompt := buildPrompt(cl.issue)
	if !strings.Contains(prompt, "In Progress (started)") {
		t.Fatalf("prompt %s", prompt)
	}
}

func TestParseClaudeStream_ReadsSessionResultAndTokens(t *testing.T) {
	var o outcome
	lines := []string{
		`{"type":"system","subtype":"init","session_id":"ses_fake"}`,
		`{"type":"assistant","message":{"content":[{"type":"text","text":"working"}]}}`,
		`not json`,
		`{"type":"result","subtype":"success","is_error":false,"result":"fixed the login button","session_id":"ses_fake","usage":{"input_tokens":120,"output_tokens":45}}`,
	}
	for _, line := range lines {
		parseClaude([]byte(line), &o)
	}
	if o.session != "ses_fake" || o.text != "fixed the login button" || o.isError {
		t.Fatalf("outcome %+v", o)
	}
	if o.input != 120 || o.output != 45 {
		t.Fatalf("tokens %+v", o)
	}

	var bad outcome
	parseClaude([]byte(`{"type":"result","is_error":true,"result":"boom","usage":{"input_tokens":1,"output_tokens":2}}`), &bad)
	if !bad.isError || bad.text != "boom" || bad.input != 1 || bad.output != 2 {
		t.Fatalf("error outcome %+v", bad)
	}
}

func TestParseDefensive_KeepsTheFinalMessageAndIgnoresUnknownEvents(t *testing.T) {
	var o outcome
	lines := []string{
		`{"type":"thread.started","thread_id":"thr_9"}`,
		`{"type":"item.started","item":{"type":"command_execution","command":"rm -rf ."}}`,
		`{"type":"item.completed","item":{"type":"agent_message","text":"first"}}`,
		`{"type":"item.completed","item":{"type":"agent_message","text":"shipped the fix"}}`,
		`{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":4}}`,
		`{"type":"nope","whatever":true}`,
	}
	for _, line := range lines {
		parseDefensive([]byte(line), &o)
	}
	if o.session != "thr_9" || o.text != "shipped the fix" || o.input != 10 || o.output != 4 {
		t.Fatalf("codex outcome %+v", o)
	}

	var oc outcome
	for _, line := range []string{
		`{"type":"session.created","properties":{"sessionID":"ses_oc"}}`,
		`{"type":"text","sessionID":"ses_oc","part":{"type":"text","text":"partial"}}`,
		`{"type":"text","part":{"type":"text","text":"done now"},"tokens":{"input":8,"output":3}}`,
	} {
		parseDefensive([]byte(line), &oc)
	}
	if oc.session != "ses_oc" || oc.text != "done now" || oc.input != 8 || oc.output != 3 {
		t.Fatalf("opencode outcome %+v", oc)
	}
}

func useFakeClaude(t *testing.T, env map[string]string) {
	t.Helper()
	script, err := filepath.Abs(filepath.Join("testdata", "fake-claude.sh"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(script, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("POLARIS_RUNNER_CLAUDE_BIN", script)
	for k, v := range env {
		t.Setenv(k, v)
	}
}

func claimBody(session string) []byte {
	body := map[string]any{
		"run": map[string]any{"id": "run_1", "sessionRef": nil},
		"issue": map[string]any{
			"id":          "iss_1",
			"identifier":  "ENG-12",
			"title":       "Fix the login button",
			"description": "The button does nothing.",
			"url":         "https://polaris.example/issue/ENG-12",
			"team":        map[string]any{"key": "ENG", "name": "Engineering"},
			"state":       "In Progress",
			"priority":    2,
			"comments": []any{
				map[string]any{
					"author":    "Ada",
					"body":      "Still broken on main.",
					"createdAt": "2026-11-01T10:00:00Z",
				},
			},
		},
	}
	if session != "" {
		body["run"].(map[string]any)["sessionRef"] = session
	}
	b, err := json.Marshal(body)
	if err != nil {
		panic(err)
	}
	return b
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

type finishPayload struct {
	Status       string `json:"status"`
	Summary      string `json:"summary"`
	Error        string `json:"error"`
	SessionRef   string `json:"sessionRef"`
	InputTokens  int    `json:"inputTokens"`
	OutputTokens int    `json:"outputTokens"`
}

type fakePolaris struct {
	url string

	claimStatus     int
	claimResp       []byte
	heartbeatStatus int

	mu         sync.Mutex
	claimReq   []byte
	finishReq  []byte
	finishOnce sync.Once
	finished   chan struct{}
	beats      int
}

func newFakePolaris(t *testing.T, claimStatus int, claimResp []byte, heartbeatStatus int) *fakePolaris {
	t.Helper()
	f := &fakePolaris{
		claimStatus:     claimStatus,
		claimResp:       claimResp,
		heartbeatStatus: heartbeatStatus,
		finished:        make(chan struct{}),
	}
	srv := httptest.NewServer(f.handler())
	t.Cleanup(srv.Close)
	f.url = srv.URL
	return f
}

func (f *fakePolaris) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /runner/v1/claim", f.claim)
	mux.HandleFunc("POST /runner/v1/runs/{id}/heartbeat", f.heartbeat)
	mux.HandleFunc("POST /runner/v1/runs/{id}/finish", f.finish)
	return mux
}

func (f *fakePolaris) authorised(w http.ResponseWriter, r *http.Request) bool {
	if r.Header.Get("Authorization") != "Bearer test-token" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return false
	}
	return true
}

func (f *fakePolaris) claim(w http.ResponseWriter, r *http.Request) {
	if !f.authorised(w, r) {
		return
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	f.mu.Lock()
	f.claimReq = body
	f.mu.Unlock()
	if f.claimStatus == http.StatusNoContent {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(f.claimStatus)
	_, _ = w.Write(f.claimResp)
}

func (f *fakePolaris) heartbeat(w http.ResponseWriter, r *http.Request) {
	if !f.authorised(w, r) {
		return
	}
	if r.PathValue("id") != "run_1" {
		http.NotFound(w, r)
		return
	}
	f.mu.Lock()
	f.beats++
	f.mu.Unlock()
	// Let the child reach its sleep before the cancel, so a pass means the
	// runner killed it rather than the script exiting on its own.
	if f.heartbeatStatus == http.StatusConflict {
		time.Sleep(200 * time.Millisecond)
	}
	w.WriteHeader(f.heartbeatStatus)
}

func (f *fakePolaris) finish(w http.ResponseWriter, r *http.Request) {
	if !f.authorised(w, r) {
		return
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	f.mu.Lock()
	f.finishReq = body
	f.mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
	f.finishOnce.Do(func() { close(f.finished) })
}

func (f *fakePolaris) claimRequest() []byte {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]byte(nil), f.claimReq...)
}

func (f *fakePolaris) heartbeatCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.beats
}

func (f *fakePolaris) didFinish() bool {
	select {
	case <-f.finished:
		return true
	default:
		return false
	}
}

func (f *fakePolaris) mustFinish(t *testing.T) finishPayload {
	t.Helper()
	select {
	case <-f.finished:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for finish")
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	var got finishPayload
	if err := json.Unmarshal(f.finishReq, &got); err != nil {
		t.Fatalf("finish body %s: %v", f.finishReq, err)
	}
	return got
}
