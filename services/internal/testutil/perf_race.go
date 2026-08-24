//go:build race

package testutil

// raceScale is the slack a wall-clock budget gets in a race-instrumented binary.
//
// The Go documentation puts the race detector's cost at two to twenty times, and the
// measurements in perf.go put this particular workload — which is mostly Postgres round
// trips, so mostly uninstrumented — at the low end of that on a quiet machine and around
// three times on a loaded one. Five clears the worst run observed (6.09 s against a stated
// 2 s) with room for a CI runner that is slower per core, and is still far inside what the
// assertion exists to catch: a query moved back inside the per-issue loop is a hundredfold
// regression, not a threefold one.
const raceScale = 5
