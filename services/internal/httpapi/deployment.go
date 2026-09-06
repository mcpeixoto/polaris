package httpapi

import (
	"net/http"

	"github.com/peixotolabs/polaris/services/internal/platform"
)

// deploymentHandlers answers what posture this install is running in.
type deploymentHandlers struct {
	cfg      platform.Config
	revision string
}

// posture reports the configuration a deployment's behaviour actually depends on.
//
// It exists because the deploy pipeline could not see any of this. The job that ships a
// commit sends one sha to a forced command and then checks that /healthz returns 200 and
// that the edge routes a list of paths to the api — nothing reads a single configuration
// value. So production ran POLARIS_DEFAULT_PLAN=self_hosted for months while serving a
// pricing page that sells three cloud plans: every workspace anybody created on the cloud
// was minted unlimited, no check went red, and the only way to find out was to read the env
// file on the box. A deploy that is green on a stack configured as something else is not a
// verified deploy.
//
// Anonymous, because the check that matters runs before anybody has an account, and because
// none of these are secrets: registrationMode is already observable by trying to register,
// billingEnabled is already served verbatim by GET /billing/config, and defaultPlan is
// visible in the first workspace a caller creates. What must never appear here is anything
// whose value is a credential — no keys, no ids, no hostnames. The rule for adding a field
// is that a stranger reading it learns what this server will do, never how to be it.
func (h *deploymentHandlers) posture(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"env":              h.cfg.Env,
		"registrationMode": h.cfg.RegistrationMode,
		"defaultPlan":      h.cfg.DefaultPlan,
		"billingEnabled":   h.cfg.BillingEnabled(),
		"edition":          platform.Edition,
		"revision":         h.revision,
	})
}
