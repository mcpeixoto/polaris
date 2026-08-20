package platform

import "crypto/subtle"

// GitLabTokenOK reports whether X-Gitlab-Token matches the stored webhook secret.
//
// GitLab uses a static token rather than an HMAC of the body. Empty values are a miss:
// a misconfigured install should refuse the request, not accept unsigned traffic.
func GitLabTokenOK(secret, header string) bool {
	if secret == "" || header == "" {
		return false
	}
	if len(secret) != len(header) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(secret), []byte(header)) == 1
}
