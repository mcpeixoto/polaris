//go:build !ee

package platform

// Edition names the build. The community half.
//
// Split by build tag rather than read from an env var, because the answer is a property of
// the binary and not of its configuration: a core build cannot become an enterprise one by
// setting a variable, and a deployment that believed otherwise would report a licence it
// does not have. scripts/lint-editions.sh checks the same claim from the other side, by
// reading the linked packages of the built binaries.
const Edition = "core"
