package webhookout

import (
	"net"
	"strings"
	"testing"
)

func TestValidateHTTPSURL_RefusesTheShapesThatAreAnSSRF(t *testing.T) {
	t.Parallel()
	cases := []struct {
		url  string
		want string
	}{
		{"http://example.com/hooks", "https"},
		{"https://localhost/hooks", "private"},
		{"https://127.0.0.1/hooks", "private"},
		{"https://10.0.0.4/hooks", "private"},
		{"https://192.168.1.9/hooks", "private"},
		{"https://169.254.169.254/latest", "private"},
		{"https://user:pass@example.com/hooks", "credentials"},
		{"ftp://example.com/hooks", "https"},
		{"", "required"},
	}
	for _, tc := range cases {
		err := ValidateHTTPSURL(tc.url)
		if err == nil {
			t.Errorf("%q: accepted, want a refusal mentioning %q", tc.url, tc.want)
			continue
		}
		if !strings.Contains(strings.ToLower(err.Error()), tc.want) {
			t.Errorf("%q: error %q, want it to mention %q", tc.url, err.Error(), tc.want)
		}
	}
}

func TestValidateHTTPSURL_AcceptsAPublicHTTPSEndpoint(t *testing.T) {
	t.Parallel()
	if err := ValidateHTTPSURL("https://hooks.example.com/polaris"); err != nil {
		t.Fatal(err)
	}
}

func TestForbiddenIP(t *testing.T) {
	t.Parallel()
	forbidden := []string{
		"127.0.0.1", "::1", "10.1.2.3", "172.16.0.1", "172.31.255.255",
		"192.168.0.1", "169.254.1.1", "0.0.0.0", "224.0.0.1", "100.64.0.1",
		"fc00::1", "fe80::1",
	}
	for _, s := range forbidden {
		ip := net.ParseIP(s)
		if ip == nil {
			t.Fatalf("parse %s", s)
		}
		if !ForbiddenIP(ip) {
			t.Errorf("%s must be forbidden", s)
		}
	}
	if ForbiddenIP(net.ParseIP("8.8.8.8")) {
		t.Error("8.8.8.8 is public")
	}
	if ForbiddenIP(net.ParseIP("1.1.1.1")) {
		t.Error("1.1.1.1 is public")
	}
}
