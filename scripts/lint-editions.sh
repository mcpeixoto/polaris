#!/usr/bin/env bash
# Checks that the community build does not CONTAIN the enterprise code.
#
# ee/README.md makes a specific claim, and it is the claim the whole dual licence rests on:
#
#   "the community build does not *contain* this code — it is absent from the binary and
#    the bundle rather than present and disabled. A licence check that can be flipped by
#    editing a boolean is not a licence check."
#
# Nothing else in the build checks that. `go build ./...` compiles whatever the tags select
# and says nothing about what was left out; the tests run in one edition at a time; and the
# failure mode is silent in the direction that matters. One untagged file under ee/, or one
# import of ee/ from a file that forgot its `//go:build ee` line, and the AGPL image ships
# commercially licensed code — compiling, passing CI, and shipping to every self-hoster who
# pulls `ghcr.io/…/polaris`. That is a licensing incident discovered by a third party
# reading a binary, not a build failure.
#
# So the check reads the actual dependency graph of the actual binaries rather than trusting
# the tags to have been written correctly. `go list -deps` is the compiler's own answer to
# "what goes into this program".
#
# It checks both directions on purpose. A boundary that is never crossed in the ee build is
# not a boundary, it is a directory nobody imports — and that is the state this repository
# was in before the audit log: ee/ held two prose files and the build system it describes
# did not exist.
set -euo pipefail

cd "$(dirname "$0")/.."

# The module path of the commercial module. Its packages are the ones that must never
# appear in a core binary.
EE_MODULE="github.com/peixotolabs/polaris/ee"

# Every program built into the shipped image. See services/Dockerfile: one image, four
# entrypoints. Checking only ./cmd/api would leave the sync hub and the worker free to link
# ee code, and the worker is exactly where a background exporter would be written.
CMDS=(./cmd/api ./cmd/sync ./cmd/worker ./cmd/polarisctl)

fail=0

# 1. Every Go file under ee/ carries the tag.
#
# This is the rule that makes the other two hold. A file here without `//go:build ee` is
# compiled into whatever imports it, in every edition, and the tag on its neighbours is no
# protection at all.
#
# The tag must be in the first paragraph of the file to count, so the grep is bounded to the
# head rather than searching the whole file — `//go:build ee` in a comment halfway down is
# documentation, not a constraint, and matching it would make this check pass for a file the
# compiler treats as untagged.
while IFS= read -r f; do
  if ! head -n 10 "$f" | grep -qE '^//go:build .*\bee\b'; then
    echo "FAIL: $f is under ee/ and carries no '//go:build ee' constraint"
    echo "  Every Go file under ee/ is commercially licensed and must be excluded from the"
    echo "  core build by its own tag, not by its neighbours'."
    fail=1
  fi
done < <(find ee -name '*.go' -not -name '*_test.go' 2>/dev/null)

# 2. The core build links none of it.
for cmd in "${CMDS[@]}"; do
  hits=$( (cd services && go list -deps "$cmd") | grep "^${EE_MODULE}/" || true)
  if [ -n "$hits" ]; then
    echo "FAIL: the CORE build of ${cmd} links commercial code from ee/"
    echo "$hits" | sed 's/^/  /'
    echo "  An import of ee/ must live in a file tagged '//go:build ee'. This one does not,"
    echo "  so ghcr.io/…/polaris would ship it under the AGPL."
    fail=1
  fi
done

# 3. The ee build links some of it.
#
# Asserted once, over the union, rather than per binary: which entrypoint hosts which
# enterprise feature is a design decision that moves, and pinning it here would turn an
# ordinary refactor into a lint failure. That the tag reaches anything at all is the part
# that must not silently stop being true.
ee_linked=$( (cd services && go list -tags ee -deps "${CMDS[@]}") | grep "^${EE_MODULE}/" || true)
if [ -z "$ee_linked" ]; then
  echo "FAIL: the EE build links nothing from ee/"
  echo "  Either the '//go:build ee' import was removed, or the tag is spelled differently"
  echo "  than the files expect. Whichever it is, 'go build -tags ee' now produces the core"
  echo "  binary under an enterprise name — and every test of it passes."
  fail=1
fi

if [ $fail -eq 0 ]; then
  echo "edition-lint: ok — core links no ee/, ee links $(echo "$ee_linked" | wc -l | tr -d ' ') package(s)"
fi
exit $fail
