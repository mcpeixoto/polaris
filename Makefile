.DEFAULT_GOAL := help
SHELL := /bin/bash

GO      ?= go
PNPM    ?= pnpm
SVC     := services

# Local configuration, if there is any.
#
# `-include` rather than `include`: a fresh clone has no .env and must still be able to run
# `make help`, `make test` and everything else that needs no secrets. Copy .env.example to
# .env for the ones that do.
#
# This exists because the api and sync processes were once started by hand with the secrets
# exported into somebody's shell, which worked until that shell was gone — and then the
# stack could not be restarted at all, because nothing in the repository said what the
# values had been. Configuration that lives only in a terminal session is configuration
# nobody else has.
-include .env
export

DB_URL  ?= $(if $(DATABASE_URL),$(DATABASE_URL),postgres://polaris:polaris@localhost:55432/polaris?sslmode=disable)

.PHONY: help
help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-18s\033[0m %s\n",$$1,$$2}'

# ---------------------------------------------------------------- environment

.PHONY: up
up: ## Start local infra (postgres, valkey, minio, meilisearch)
	docker compose -f compose.dev.yml up -d --wait

.PHONY: down
down: ## Stop local infra
	docker compose -f compose.dev.yml down

.PHONY: nuke
nuke: ## Stop local infra AND delete its volumes
	docker compose -f compose.dev.yml down -v

.PHONY: install
install: ## Install all dependencies
	cd $(SVC) && $(GO) mod download
	$(PNPM) install

# ---------------------------------------------------------------- code generation

.PHONY: generate
generate: sqlc gqlgen codegen ## Regenerate everything from the contracts

.PHONY: sqlc
sqlc: ## Generate typed Go from SQL
	cd $(SVC) && $(GO) tool sqlc generate

.PHONY: gqlgen
gqlgen: ## Generate Go GraphQL types + resolver stubs
	cd $(SVC) && $(GO) tool gqlgen generate --config ../schema/gqlgen.yml

.PHONY: codegen
codegen: ## Generate TS types from schema.graphql
	$(PNPM) -C web codegen

# ---------------------------------------------------------------- database

.PHONY: migrate
migrate: ## Apply all pending migrations
	cd $(SVC) && $(GO) run ./cmd/polarisctl migrate up --database "$(DB_URL)"

.PHONY: migrate-status
migrate-status: ## Show migration state
	cd $(SVC) && $(GO) run ./cmd/polarisctl migrate status --database "$(DB_URL)"

.PHONY: seed
seed: ## Seed a realistic workspace (3 teams, 2k issues)
	cd $(SVC) && $(GO) run ./cmd/polarisctl seed --scale=large --database "$(DB_URL)"

# ---------------------------------------------------------------- run

.PHONY: api
api: ## Run the GraphQL API
	cd $(SVC) && $(GO) run ./cmd/api

.PHONY: sync
sync: ## Run the sync hub
	cd $(SVC) && $(GO) run ./cmd/sync

.PHONY: worker
worker: ## Run the job worker
	cd $(SVC) && $(GO) run ./cmd/worker

.PHONY: web
web: ## Run the Vite dev server
	$(PNPM) -C web dev

.PHONY: desktop
desktop: ## Run Electron against the Vite dev server
	$(PNPM) -C desktop dev


# Keep-alive local stack. Daemonized (setsid) so other agents' SIGTERM of their
# own session cannot take Vite/API/sync/worker down. Supervisors respawn on crash; a
# 10s watchdog restarts Vite if :5173 dies. Do NOT SIGTERM these PIDs during
# migrate — restart API by replacing the binary (`make stack` while keep-alive
# is running). Teardown: `make dev-down`.
#
# The worker is in the list because the inbox is: nothing but cmd/worker fans out
# notifications, so a stack without it shows an empty inbox forever and the e2e
# inbox specs fail here while passing in CI, which does start it.
.PHONY: dev
dev: ## Keep-alive Vite :5173 + API :8088 + sync :8089 + worker (survives agent restarts)
	@bash scripts/dev-up.sh

.PHONY: dev-down
dev-down: ## Stop the keep-alive stack (does not stop Docker)
	@bash scripts/dev-down.sh

# ---------------------------------------------------------------- quality

# `build-web` is in here, and it earns its place.
#
# A missing CSS module import passes typecheck, passes ESLint and passes every one of the
# unit tests, because `*.module.css` is ambient-typed and vitest is configured with
# `css: false`. The only thing that notices is the bundler. That state — four green gates on
# a tree that cannot build — reached this repository once, and this line is why it will not
# reach it twice.
.PHONY: check
check: fmt-check lint test build-web check-ee ## Everything CI runs

# The enterprise half of what CI runs. Separate target, folded into `check`, so that
# `make check-ee` is available on its own while nobody can run the full check and miss it.
#
# `build-web` earns its place above for a reason that applies twice over here: the enterprise
# bundle is the one the cloud serves, and it is the one no other gate compiles.
.PHONY: check-ee
check-ee: lint-editions test-go-ee test-web-ee build-web-ee ## Everything CI runs for the ee edition
	$(PNPM) -C web typecheck:ee

.PHONY: build-web-ee
build-web-ee: ## Prove the enterprise client actually bundles
	POLARIS_EDITION=ee $(PNPM) --filter @polaris/web build

.PHONY: build-web
build-web: ## Prove the client actually bundles
	$(PNPM) --filter @polaris/web build

.PHONY: fmt
fmt: ## Format all code
	cd $(SVC) && $(GO) fmt ./...
	npx prettier --write "web/src/**/*.{ts,tsx,css}" "web/e2e/**/*.ts" "web/*.{ts,json}" "ee/web/**/*.{ts,tsx,css}" "desktop/src/**/*.{ts,cts}"

.PHONY: fmt-check
fmt-check: ## Fail if anything is unformatted
	@cd $(SVC) && out=$$($(GO) fmt ./...) && [ -z "$$out" ] || { echo "unformatted: $$out"; exit 1; }
	@npx prettier --check "web/src/**/*.{ts,tsx,css}" "web/e2e/**/*.ts" "web/*.{ts,json}" "ee/web/**/*.{ts,tsx,css}" "desktop/src/**/*.{ts,cts}"

.PHONY: lint
lint: lint-go lint-compose lint-desktop lint-editions lint-images lint-imports lint-ios-graphql lint-keymap lint-routes lint-tokens lint-web ## All linters

.PHONY: lint-go
lint-go:
	cd $(SVC) && $(GO) vet ./...
	cd $(SVC) && $(GO) vet -tags ee ./...
	cd ee && $(GO) vet -tags ee ./...

.PHONY: lint-editions
lint-editions: ## Enforce that the community build does not CONTAIN the enterprise code
	@bash scripts/lint-editions.sh

.PHONY: lint-compose
lint-compose: ## Enforce that an opt-in compose service cannot break commands for people who did not enable it
	@bash scripts/lint-compose.sh

.PHONY: lint-desktop
lint-desktop: ## Enforce that a desktop artefact shipping two architectures names which one it is
	@bash scripts/lint-desktop.sh

.PHONY: lint-images
lint-images: ## Enforce that every binary a compose service asks for exists and is reachable
	@bash scripts/lint-images.sh

.PHONY: lint-imports
lint-imports: ## Enforce the package rule: only domain/ may import store/
	@bash scripts/lint-imports.sh

.PHONY: lint-ios-graphql
lint-ios-graphql: ## Enforce that the iOS client's hand-written GraphQL matches the schema
	@node scripts/lint-ios-graphql.mjs

.PHONY: lint-keymap
lint-keymap: ## Enforce that keyboard handling lives in the keymap registry
	@bash scripts/lint-keymap.sh

.PHONY: lint-routes
lint-routes: ## Enforce that the reverse proxy routes each path to the server that registers it
	@bash scripts/lint-routes.sh

.PHONY: lint-tokens
lint-tokens: ## Enforce that colours come from the design tokens, and that every token exists
	@bash scripts/lint-tokens.sh

.PHONY: lint-web
lint-web:
	$(PNPM) -r lint

.PHONY: test
test: test-go test-web ## All tests

.PHONY: test-go
test-go:
	cd $(SVC) && $(GO) test ./... -race -count=1

# The enterprise edition is a second artefact, not a variant, so it gets its own run.
# `go test ./...` does not cross a module boundary, which is why ee/ is invoked separately:
# building services with -tags ee compiles the commercial module but runs none of its tests.
.PHONY: test-go-ee
test-go-ee: ## Test the enterprise edition
	cd $(SVC) && $(GO) test -tags ee ./... -race -count=1
	cd ee && $(GO) test -tags ee ./... -count=1

.PHONY: test-web
test-web:
	$(PNPM) -r test

.PHONY: test-web-ee
test-web-ee: ## Run the client suite resolved against the commercial modules
	$(PNPM) -C web test:ee

.PHONY: e2e
e2e: ## Playwright end-to-end suite
	$(PNPM) -C web e2e

# Built and then run, rather than `go run`, because `go run` is not the process that ends up
# holding the port. It compiles to the build cache and execs the result, so the pid recorded
# by `$$!` is a parent that can die while the listener keeps running — and then `stack-stop`
# prints "stopped" while the OLD BINARY is still serving. Every request after that answers
# from code that is no longer in the tree, and the next `make stack` fails with "address
# already in use" having already told you it succeeded.
#
# That cost somebody an hour of this project's life, twice: the symptom is a fix that
# demonstrably does not work, which sends you back into code that was right all along.
#
# Building first also means a compile error stops `make stack` instead of landing quietly at
# the top of a log file nobody opens until the healthz loop has spun for a while.
.PHONY: stack
stack: ## Rebuild api/sync/worker and start them; leaves Vite alone if keep-alive owns it
	@$(MAKE) up
	@cd $(SVC) && $(GO) run ./cmd/polarisctl migrate up --database "$(DB_URL)"
	@echo "building api, sync and worker…"
	@cd $(SVC) && $(GO) build -o /tmp/polaris-api ./cmd/api
	@cd $(SVC) && $(GO) build -o /tmp/polaris-sync ./cmd/sync
	@cd $(SVC) && $(GO) build -o /tmp/polaris-worker ./cmd/worker
	@if bash scripts/dev-up.sh keepalive-running; then \
	  echo "keep-alive is running — respawning api/sync/worker children only (Vite is not touched)"; \
	  bash scripts/dev-up.sh respawn-services; \
	else \
	  echo "starting api, sync and worker…"; \
	  DATABASE_URL="$(DB_URL)" /tmp/polaris-api    > /tmp/polaris-api.log    2>&1 & echo $$! > /tmp/polaris-api.pid; \
	  DATABASE_URL="$(DB_URL)" /tmp/polaris-sync   > /tmp/polaris-sync.log   2>&1 & echo $$! > /tmp/polaris-sync.pid; \
	  DATABASE_URL="$(DB_URL)" /tmp/polaris-worker > /tmp/polaris-worker.log 2>&1 & echo $$! > /tmp/polaris-worker.pid; \
	fi
	@until curl -sf http://127.0.0.1:8088/healthz >/dev/null; do sleep 1; done
	@echo "api :8088  sync :8089  worker (no port)  — Vite left running if make dev is up"

# Verifies rather than announces. "stopped" while something is still listening is the
# statement that made the bug above so expensive.
.PHONY: stack-stop
stack-stop: ## Stop the background api, sync and worker processes (no-op if make dev owns them)
	@if bash scripts/dev-up.sh keepalive-running; then \
	  echo "keep-alive (make dev) owns api/sync/worker/Vite — not stopping."; \
	  echo "  Restart API without killing Vite: make stack"; \
	  echo "  Tear the keep-alive stack down:     make dev-down"; \
	else \
	  wpid="$$(cat /tmp/polaris-worker.pid 2>/dev/null)"; \
	  kill $$(cat /tmp/polaris-api.pid 2>/dev/null) 2>/dev/null || true; \
	  kill $$(cat /tmp/polaris-sync.pid 2>/dev/null) 2>/dev/null || true; \
	  kill $$wpid 2>/dev/null || true; \
	  rm -f /tmp/polaris-api.pid /tmp/polaris-sync.pid /tmp/polaris-worker.pid; \
	  for i in 1 2 3 4 5 6 7 8 9 10; do \
	    lsof -ti :8088 -ti :8089 >/dev/null 2>&1 || break; \
	    sleep 0.2; \
	  done; \
	  held="$$(lsof -ti :8088 2>/dev/null; lsof -ti :8089 2>/dev/null | tr '\n' ' ')"; \
	  if [ -n "$$held" ]; then \
	    echo "NOT stopped — still listening on :8088/:8089 as pid(s): $$held"; \
	    echo "  These are almost certainly a previous build. Kill them before starting again,"; \
	    echo "  or the stack you test will not be the code you just wrote."; \
	    exit 1; \
	  fi; \
	  if [ -n "$$wpid" ] && kill -0 "$$wpid" 2>/dev/null; then \
	    echo "NOT stopped — worker pid $$wpid is still running (it holds no port, so"; \
	    echo "  nothing above would have caught it). Kill it before starting again."; \
	    exit 1; \
	  fi; \
	  echo "stopped"; \
	fi
