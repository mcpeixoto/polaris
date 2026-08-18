package main

import (
	"context"
	"flag"
	"fmt"
	"net/http"
	"time"
)

// healthCmd asks a running process whether it is serving, for a container healthcheck.
//
// It exists because the images are distroless — no shell, no curl, no wget — so the only
// thing a HEALTHCHECK can run is a binary this repository ships. The api service's check was
// `polarisctl help`, which proves the filesystem is intact and the binary links, and nothing
// else: an API that had lost its database, or never bound its port, or was returning 500 to
// every request reported healthy. Docker's `depends_on: {condition: service_healthy}` reads
// that answer, and so does every dashboard on the host.
//
// The check is deliberately the same endpoint a load balancer would use rather than a
// deeper one. /healthz answers whether this process can serve; a check that also verified
// the database would take the API out of rotation for a failure the API cannot fix, and
// restart-looping a healthy process because Postgres is briefly gone turns a short outage
// into a long one.
func healthCmd(args []string) error {
	fs := flag.NewFlagSet("health", flag.ExitOnError)
	// 127.0.0.1 rather than localhost, on purpose. Several base images map `localhost` to
	// ::1 only, and a server bound to IPv4 is then unreachable by name from inside its own
	// container — which is exactly how the web service reported unhealthy for its whole life
	// while serving every request correctly.
	addr := fs.String("addr", "127.0.0.1:8088", "host:port to check")
	path := fs.String("path", "/healthz", "path to request")
	timeout := fs.Duration("timeout", 3*time.Second, "how long to wait")
	_ = fs.Parse(args)

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()

	url := fmt.Sprintf("http://%s%s", *addr, *path)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}

	// A client with no proxy and no redirect following: this is a loopback request to a
	// known address, and either of those would let an environment variable or a
	// misconfiguration turn "am I serving" into a question about somewhere else.
	client := &http.Client{
		Timeout: *timeout,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
		Transport: &http.Transport{Proxy: nil},
	}

	res, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("%s: %w", url, err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("%s returned %s", url, res.Status)
	}
	return nil
}
