// Package migrations embeds the SQL migration files into the binary.
//
// Embedding rather than shipping a directory means a container image cannot drift from
// the schema it was built against, and `polarisctl migrate` works identically on a
// developer laptop, in CI and on the VPS.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
