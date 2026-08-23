// Package webhookout delivers signed outbound webhooks.
//
// The product's other half of "a customer-controlled URL" is a request-forgery primitive
// into the fleet's internal network. Every URL we POST to is therefore resolved, checked
// against private ranges *after* DNS, and dialed by the pinned address — not by the
// hostname the customer typed, which can be rebound between the check and the connect.
package webhookout

import (
	"fmt"
	"net"
	"net/url"
	"strings"
)

// ValidateHTTPSURL is the create-time check: scheme, no credentials, no literal private
// address. Delivery still re-resolves; this only stops an admin pasting
// http://169.254.169.254/ and having that row exist at all.
func ValidateHTTPSURL(raw string) error {
	u, err := parseHTTPURL(raw)
	if err != nil {
		return err
	}
	if u.Scheme != "https" {
		return fmt.Errorf("webhook URLs must be https")
	}
	return rejectHost(u.Hostname())
}

func parseHTTPURL(raw string) (*url.URL, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, fmt.Errorf("url is required")
	}
	if len(trimmed) > 2048 {
		return nil, fmt.Errorf("url is too long")
	}
	u, err := url.Parse(trimmed)
	if err != nil {
		return nil, fmt.Errorf("url is not valid")
	}
	if u.Scheme != "https" && u.Scheme != "http" {
		return nil, fmt.Errorf("webhook URLs must be https")
	}
	if u.Host == "" {
		return nil, fmt.Errorf("url is not valid")
	}
	if u.User != nil {
		return nil, fmt.Errorf("webhook URLs may not carry credentials")
	}
	return u, nil
}

func rejectHost(host string) error {
	host = strings.TrimSpace(strings.ToLower(host))
	if host == "" {
		return fmt.Errorf("url is not valid")
	}
	if host == "localhost" || strings.HasSuffix(host, ".localhost") ||
		host == "metadata.google.internal" || host == "metadata.google.com" {
		return fmt.Errorf("webhook URLs may not target a private or link-local host")
	}
	if ip := net.ParseIP(host); ip != nil {
		if ForbiddenIP(ip) {
			return fmt.Errorf("webhook URLs may not target a private or link-local host")
		}
		return nil
	}
	// Not an IP by Go's strict reading — but inet_aton is not strict, and getaddrinfo goes
	// through it. "127.1", "2130706433", "0x7f000001" and "017700000001" are all 127.0.0.1
	// to the C resolver and all sail past net.ParseIP, so the loopback check above never
	// sees them. Delivery still refuses them on the post-DNS pin, but a row that can only
	// ever fail should not be creatable: it queues deliveries and disables itself hours
	// later, which reads as "webhooks are broken" rather than "that URL was refused".
	if !hasHostname(host) {
		return fmt.Errorf("webhook URLs may not target a private or link-local host")
	}
	return nil
}

// hasHostname reports whether host looks like a DNS name rather than a numeric address in
// disguise. Every public hostname ends in an alphabetic top-level label (punycode ones
// begin "xn--"); none of inet_aton's numeric forms do.
func hasHostname(host string) bool {
	host = strings.TrimSuffix(host, ".")
	last := host
	if i := strings.LastIndex(host, "."); i >= 0 {
		last = host[i+1:]
	}
	if last == "" {
		return false
	}
	c := last[0]
	return c >= 'a' && c <= 'z'
}

// ForbiddenIP is true for loopback, link-local, RFC1918, unique-local IPv6, and the
// IPv4-mapped forms of those. Checked after DNS so a public hostname that resolves
// inside the fleet is refused the same as 10.0.0.1 typed into the URL.
func ForbiddenIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	if ip4 := ip.To4(); ip4 != nil {
		ip = ip4
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsMulticast() || ip.IsUnspecified() {
		return true
	}
	// 100.64.0.0/10 — shared address space, often the NAT in front of the box.
	if ip4 := ip.To4(); ip4 != nil {
		if ip4[0] == 100 && ip4[1] >= 64 && ip4[1] <= 127 {
			return true
		}
	}
	return false
}
