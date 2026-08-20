package platform

import "testing"

func TestGitLabTokenOK(t *testing.T) {
	t.Parallel()
	const secret = "glsec_abc"
	if !GitLabTokenOK(secret, secret) {
		t.Fatal("the matching token must verify")
	}
	if GitLabTokenOK(secret, "glsec_other") {
		t.Fatal("a different token must be refused")
	}
	if GitLabTokenOK(secret, "") {
		t.Fatal("a missing header must be refused")
	}
	if GitLabTokenOK("", secret) {
		t.Fatal("an empty stored secret must be refused")
	}
}
