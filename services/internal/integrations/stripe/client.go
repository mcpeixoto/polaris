package stripe

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// DefaultBaseURL is Stripe's API root. Overridden in tests, and nowhere else.
const DefaultBaseURL = "https://api.stripe.com"

// Client is a hand-rolled Stripe client covering the three calls this product makes.
//
// No SDK, because three form-encoded POSTs do not justify a dependency that pins its own
// API version, brings a transitive tree into a server that holds a database, and has to be
// upgraded on Stripe's schedule rather than ours. The requests are the documented wire
// format and the responses are decoded into the narrow structs in event.go.
type Client struct {
	secretKey string
	baseURL   string
	http      *http.Client
}

// NewClient returns a client, or nil when no secret key is configured.
//
// A nil client is the "billing is not set up" state and every caller checks for it. That is
// deliberate: a deployment without Stripe credentials is the normal self-hosted case, not an
// error, and it must not be able to half-work — no checkout, no portal, and the webhook
// endpoint refuses everything because the signing secret is empty too.
func NewClient(secretKey, baseURL string, timeout time.Duration) *Client {
	if strings.TrimSpace(secretKey) == "" {
		return nil
	}
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}
	return &Client{
		secretKey: secretKey,
		baseURL:   strings.TrimRight(baseURL, "/"),
		http:      &http.Client{Timeout: timeout},
	}
}

// CheckoutInput is one hosted-checkout session.
type CheckoutInput struct {
	WorkspaceID string
	// PriceID is the price the seats are bought at — monthly or annual, chosen by the caller.
	PriceID string
	// Seats is the quantity billed. The caller counts them; this package does not know what
	// a member is.
	Seats int
	// CustomerID reuses an existing Stripe customer when the workspace has one, so a second
	// purchase does not create a second customer holding half the history. Empty is fine.
	CustomerID string
	// CustomerEmail prefills the form when there is no customer yet. Ignored by Stripe when
	// CustomerID is set, and sending both is an error, so only one is ever written.
	CustomerEmail string
	SuccessURL    string
	CancelURL     string
	// AutomaticTax turns on Stripe Tax. Off unless the account has it enabled: Stripe
	// refuses the whole session when it is asked for and not configured, which would turn a
	// tax setting into a checkout outage.
	AutomaticTax bool
}

// CreateCheckoutSession opens a hosted checkout and returns its URL.
//
// The workspace id is written three times — as client_reference_id, in the session
// metadata, and in subscription_data.metadata. Only the last one matters afterwards: it is
// what puts the id on the subscription object, so every future customer.subscription.*
// event names its own workspace and the webhook needs no lookup table. The first two are
// what makes the session legible in the Stripe dashboard.
func (c *Client) CreateCheckoutSession(ctx context.Context, in CheckoutInput) (string, error) {
	form := url.Values{}
	form.Set("mode", "subscription")
	form.Set("line_items[0][price]", in.PriceID)
	form.Set("line_items[0][quantity]", strconv.Itoa(max(in.Seats, 1)))
	form.Set("success_url", in.SuccessURL)
	form.Set("cancel_url", in.CancelURL)
	form.Set("client_reference_id", in.WorkspaceID)
	form.Set("metadata["+WorkspaceMetadataKey+"]", in.WorkspaceID)
	form.Set("subscription_data[metadata]["+WorkspaceMetadataKey+"]", in.WorkspaceID)
	if in.CustomerID != "" {
		form.Set("customer", in.CustomerID)
	} else if in.CustomerEmail != "" {
		form.Set("customer_email", in.CustomerEmail)
	}
	if in.AutomaticTax {
		form.Set("automatic_tax[enabled]", "true")
	}

	var out struct {
		URL string `json:"url"`
	}
	if err := c.post(ctx, "/v1/checkout/sessions", form, &out); err != nil {
		return "", err
	}
	if out.URL == "" {
		return "", fmt.Errorf("stripe: checkout session came back with no url")
	}
	return out.URL, nil
}

// CreatePortalSession opens Stripe's billing portal for a customer and returns its URL.
//
// This is where a subscription is cancelled, a card is replaced and an invoice is read.
// Building any of that ourselves would mean holding card details, which is the one thing
// this integration exists to avoid.
func (c *Client) CreatePortalSession(ctx context.Context, customerID, returnURL string) (string, error) {
	form := url.Values{}
	form.Set("customer", customerID)
	form.Set("return_url", returnURL)

	var out struct {
		URL string `json:"url"`
	}
	if err := c.post(ctx, "/v1/billing_portal/sessions", form, &out); err != nil {
		return "", err
	}
	if out.URL == "" {
		return "", fmt.Errorf("stripe: portal session came back with no url")
	}
	return out.URL, nil
}

// GetSubscription fetches one subscription.
//
// checkout.session.completed names a subscription but does not carry its status, price or
// period end, so the webhook reads the subscription itself rather than entitling a workspace
// from a session object that cannot say what was bought.
func (c *Client) GetSubscription(ctx context.Context, id string) (Subscription, error) {
	var sub Subscription
	if err := c.get(ctx, "/v1/subscriptions/"+url.PathEscape(id), &sub); err != nil {
		return Subscription{}, err
	}
	return sub, nil
}

func (c *Client) post(ctx context.Context, path string, form url.Values, out any) error {
	req, err := http.NewRequestWithContext(
		ctx, http.MethodPost, c.baseURL+path, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	return c.do(req, out)
}

func (c *Client) get(ctx context.Context, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return err
	}
	return c.do(req, out)
}

// maxStripeBody caps what is read back from Stripe. Their responses are kilobytes; this is
// only here so a wrong base URL pointing at something enormous cannot exhaust the process.
const maxStripeBody = 1 << 20

func (c *Client) do(req *http.Request, out any) error {
	req.Header.Set("Authorization", "Bearer "+c.secretKey)

	res, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("stripe: %s %s: %w", req.Method, req.URL.Path, err)
	}
	defer func() { _ = res.Body.Close() }()

	body, err := io.ReadAll(io.LimitReader(res.Body, maxStripeBody))
	if err != nil {
		return fmt.Errorf("stripe: reading %s: %w", req.URL.Path, err)
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		// Stripe's error message is the useful half of a failed call ("No such price"), and
		// it names no card details or personal data. The secret key is never in it, and is
		// never logged from here.
		var wrapper struct {
			Error struct {
				Message string `json:"message"`
				Code    string `json:"code"`
			} `json:"error"`
		}
		_ = json.Unmarshal(body, &wrapper)
		message := wrapper.Error.Message
		if message == "" {
			message = http.StatusText(res.StatusCode)
		}
		return fmt.Errorf("stripe: %s %s: %d %s", req.Method, req.URL.Path, res.StatusCode, message)
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("stripe: decoding %s: %w", req.URL.Path, err)
	}
	return nil
}
