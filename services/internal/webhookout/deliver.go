package webhookout

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	// DeliveryTimeout is the documented consumer deadline: slower than this is a failed
	// attempt, not a hang the worker sits in.
	DeliveryTimeout = 5 * time.Second

	userAgent = "Polaris-Webhook"
)

// Destination is one POST. Secret is the HMAC key; Body is the exact bytes that will be
// signed — retries must pass the same slice or the consumer's verify will flap.
type Destination struct {
	URL        string
	Secret     string
	Event      string
	DeliveryID uuid.UUID
	Timestamp  time.Time
	Body       []byte
}

// Result is what the worker records: status 0 means the request never got a response.
type Result struct {
	Status     int
	Duration   time.Duration
	Snippet    string
	Err        error
}

// Sender is what domain.DeliverDueWebhooks needs. Production uses Deliverer; tests
// substitute a fake so they can assert the envelope without opening sockets.
type Sender interface {
	Send(ctx context.Context, dest Destination) Result
}

// Deliverer POSTs a signed body to a customer URL, with DNS re-checked and the resolved
// IP pinned for the connect. AllowPrivate is for tests that point at httptest.Server
// (loopback); production must leave it false.
type Deliverer struct {
	Timeout      time.Duration
	AllowPrivate bool
	LookupIP     func(ctx context.Context, host string) ([]net.IP, error)
	Transport    http.RoundTripper
}

func (d Deliverer) timeout() time.Duration {
	if d.Timeout > 0 {
		return d.Timeout
	}
	return DeliveryTimeout
}

func (d Deliverer) lookup(ctx context.Context, host string) ([]net.IP, error) {
	if d.LookupIP != nil {
		return d.LookupIP(ctx, host)
	}
	addrs, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, err
	}
	ips := make([]net.IP, 0, len(addrs))
	for _, a := range addrs {
		ips = append(ips, a.IP)
	}
	return ips, nil
}

// Send resolves, refuses private addresses, pins the first public IP, and POSTs.
func (d Deliverer) Send(ctx context.Context, dest Destination) Result {
	start := time.Now()
	u, err := parseHTTPURL(dest.URL)
	if err != nil {
		return Result{Duration: time.Since(start), Err: err}
	}
	if !d.AllowPrivate {
		if u.Scheme != "https" {
			return Result{Duration: time.Since(start), Err: fmt.Errorf("webhook URLs must be https")}
		}
		if err := rejectHost(u.Hostname()); err != nil {
			return Result{Duration: time.Since(start), Err: err}
		}
	}

	transport := d.Transport
	if transport == nil && d.AllowPrivate {
		// Tests. Loopback httptest servers cannot pass the pin, and must not teach
		// production a bypass: AllowPrivate is false in the worker.
		transport = http.DefaultTransport
	}
	if transport == nil {
		host := u.Hostname()
		ips, err := d.lookup(ctx, host)
		if err != nil {
			return Result{Duration: time.Since(start), Err: fmt.Errorf("resolve %s: %w", host, err)}
		}
		var pinned net.IP
		for _, ip := range ips {
			if ForbiddenIP(ip) {
				return Result{Duration: time.Since(start), Err: fmt.Errorf("webhook URLs may not target a private or link-local host")}
			}
			if pinned == nil {
				pinned = ip
			}
		}
		if pinned == nil {
			return Result{Duration: time.Since(start), Err: fmt.Errorf("resolve %s: no addresses", host)}
		}

		port := u.Port()
		if port == "" {
			if u.Scheme == "https" {
				port = "443"
			} else {
				port = "80"
			}
		}
		pinnedAddr := net.JoinHostPort(pinned.String(), port)
		dialer := &net.Dialer{Timeout: d.timeout()}
		transport = &http.Transport{
			DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
				return dialer.DialContext(ctx, network, pinnedAddr)
			},
			ForceAttemptHTTP2: false,
		}
	}

	reqCtx, cancel := context.WithTimeout(ctx, d.timeout())
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, dest.URL, bytes.NewReader(dest.Body))
	if err != nil {
		return Result{Duration: time.Since(start), Err: err}
	}
	ts := dest.Timestamp
	if ts.IsZero() {
		ts = time.Now()
	}
	sig := SignHex(dest.Secret, dest.Body)
	req.Header.Set("Accept-Charset", "utf-8")
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	req.Header.Set("Polaris-Delivery", dest.DeliveryID.String())
	req.Header.Set("Polaris-Event", dest.Event)
	req.Header.Set("Polaris-Signature", sig)
	req.Header.Set("Polaris-Timestamp", strconv.FormatInt(ts.UnixMilli(), 10))
	req.Header.Set("User-Agent", userAgent)
	req.Host = u.Host

	client := &http.Client{Transport: transport, Timeout: d.timeout()}
	resp, err := client.Do(req)
	if err != nil {
		return Result{Duration: time.Since(start), Err: err}
	}
	defer resp.Body.Close()
	snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
	return Result{
		Status:   resp.StatusCode,
		Duration: time.Since(start),
		Snippet:  strings.ToValidUTF8(string(snippet), ""),
	}
}
