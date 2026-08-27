# One image, four entrypoints.
#
# api, sync, worker and polarisctl are built together and selected with `command:` in
# compose. Building them separately would triple the build time and, worse, allow the
# three running services to drift onto different revisions of the same GraphQL schema —
# which is exactly the failure the single-contract rule exists to prevent.

# Pinned to the patch, and it must be >= the `go` directive in services/go.mod — the
# toolchain in the image will not build a module that asks for a newer one, and the error
# only appears at image-build time, long after `go build` succeeded on a developer laptop
# that had a newer toolchain installed.
FROM golang:1.26.0-alpine AS build

# /src/services rather than /src, because there are two modules in this build now and the
# second one is reached by a relative path.
#
# services/go.mod carries `replace github.com/peixotolabs/polaris/ee => ../ee`, so the ee
# module's go.mod must exist one directory up from the main module — in EVERY build, not only
# the enterprise one. `go mod download` reads the whole module graph including replaced
# modules, and fails outright if the target is missing:
#
#   go: github.com/peixotolabs/polaris/ee@v0.0.0 (replaced by ../ee):
#       reading ../ee/go.mod: no such file or directory
#
# That failure lands on the community image, which contains none of that code. Copying the
# tree in costs a few kilobytes and is not the same thing as linking it: what decides whether
# any of it reaches the binary is the build tag below, and scripts/lint-editions.sh checks
# the answer against the linked binary rather than against this file.
WORKDIR /src/services

# Dependencies first: this layer is cached until go.mod or go.sum actually changes, which
# is what keeps an ordinary code change a ten-second build rather than a two-minute one.
# Both modules' manifests, for the reason above — and only the manifests, so that editing
# either module's source does not invalidate the download.
COPY services/go.mod services/go.sum ./
COPY ee/go.mod ee/go.sum /src/ee/
RUN go mod download

COPY services/ ./
COPY ee/ /src/ee/

ARG GIT_SHA=unknown

# Which edition to build. Defaults to the community one, so an unqualified `docker build`
# produces the AGPL image and nobody ships commercial code by forgetting a flag.
#
#   docker build -f services/Dockerfile .                             -> polaris
#   docker build -f services/Dockerfile --build-arg POLARIS_EDITION=ee \
#     --build-arg IMAGE_LICENSES="AGPL-3.0-only AND LicenseRef-Polaris-Enterprise" .
#                                                                     -> polaris-ee
#
# The same variable name the web build uses (web/edition.ts), so one release pipeline sets
# one thing for both halves of the product.
ARG POLARIS_EDITION=core

# CGO off so the result is a static binary that runs on distroless with no libc at all.
# -trimpath keeps the build reproducible by stripping the builder's absolute paths out of
# the binary; -s -w drops the symbol table and DWARF, which is most of the size.
RUN set -eu; \
    if [ "${POLARIS_EDITION}" = "ee" ]; then TAGS="ee"; else TAGS=""; fi; \
    CGO_ENABLED=0 GOOS=linux go build -trimpath -tags "${TAGS}" \
      -ldflags "-s -w -X main.revision=${GIT_SHA}" \
      -o /out/api ./cmd/api && \
    CGO_ENABLED=0 GOOS=linux go build -trimpath -tags "${TAGS}" \
      -ldflags "-s -w -X main.revision=${GIT_SHA}" \
      -o /out/sync ./cmd/sync && \
    CGO_ENABLED=0 GOOS=linux go build -trimpath -tags "${TAGS}" \
      -ldflags "-s -w -X main.revision=${GIT_SHA}" \
      -o /out/worker ./cmd/worker && \
    CGO_ENABLED=0 GOOS=linux go build -trimpath -tags "${TAGS}" \
      -ldflags "-s -w" \
      -o /out/polarisctl ./cmd/polarisctl

# distroless: no shell, no package manager, no busybox. A remote-code-execution bug in a
# Go dependency lands in a container with nothing to pivot with.
FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=build /out/ /usr/local/bin/

# Matches the uid the compose files use for volume ownership. Never root, and never the
# default 65532 either, so a mounted volume's ownership is explicit rather than inherited.
USER 10001:10001

ARG GIT_SHA=unknown

# The licence label is an argument because the two images are not under the same terms, and
# an image that says AGPL-3.0-only while containing ee/ is a false statement in the one place
# a compliance scanner reads. It defaults to the community answer, so the mistake it can make
# is understating what an enterprise image contains — which is recoverable — rather than
# offering commercial code under a licence that permits redistributing it.
ARG IMAGE_LICENSES="AGPL-3.0-only"
LABEL org.opencontainers.image.title="Polaris" \
      org.opencontainers.image.source="https://github.com/peixotolabs/polaris" \
      org.opencontainers.image.licenses="${IMAGE_LICENSES}" \
      org.opencontainers.image.revision="${GIT_SHA}"

# CMD, not ENTRYPOINT, and the difference was the whole stack.
#
# This image ships four binaries on purpose — api, sync, worker and polarisctl — so that the
# three services and the migration tool can never disagree about a schema version; see the
# comment at the top of cmd/api/main.go, which calls them "three entrypoints built from a
# single image". An ENTRYPOINT names one of them and makes the other three unreachable:
# Docker appends `command:` to an ENTRYPOINT rather than replacing it, so compose's
# `command: ["/usr/local/bin/sync"]` ran `api /usr/local/bin/sync`, which api ignores.
#
# Every service in docker-compose.yml therefore started the API. The migration service ran
# an API that never exits, so `service_completed_successfully` was never satisfied, and api,
# sync and worker never started at all — the stack deadlocked on a container doing the wrong
# job. `docker compose up` could not have produced a working Polaris on any machine.
#
# CMD is a default that `command:` replaces, which is what the compose file has always
# assumed. Running the image with no arguments still starts the API, so nothing that worked
# before stops working.
CMD ["/usr/local/bin/api"]
