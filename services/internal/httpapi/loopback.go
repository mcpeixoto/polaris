package httpapi

import (
	"net"
	"net/http"
	"net/netip"
	"strings"
)

// requestIsLoopback is the second gate on POST /auth/dev-session.
//
// Host must be localhost / 127.0.0.1 / [::1] (with or without a port), AND the TCP
// peer must itself be loopback. The Host check is what the browser typed; the
// peer check is what stops a request that merely *claims* Host: localhost — a
// production API, a Docker self-host behind Caddy, a process published on a LAN
// address — from minting a session. X-Forwarded-For and X-Forwarded-Host are
// ignored on purpose: they are caller-controlled the moment this port is
// reachable without a trusted proxy in front, which is exactly the local-dev
// configuration this endpoint exists for.
func requestIsLoopback(r *http.Request) bool {
	return isLoopbackHostname(hostnameOf(r.Host)) && isLoopbackRemoteAddr(r.RemoteAddr)
}

func hostnameOf(hostport string) string {
	hostport = strings.TrimSpace(hostport)
	if hostport == "" {
		return ""
	}
	host, _, err := net.SplitHostPort(hostport)
	if err != nil {
		return strings.Trim(hostport, "[]")
	}
	return host
}

func isLoopbackHostname(host string) bool {
	host = strings.ToLower(strings.TrimSuffix(strings.TrimSpace(host), "."))
	if host == "localhost" {
		return true
	}
	addr, err := netip.ParseAddr(host)
	return err == nil && addr.IsLoopback()
}

func isLoopbackRemoteAddr(remoteAddr string) bool {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	addr, err := netip.ParseAddr(host)
	return err == nil && addr.IsLoopback()
}
