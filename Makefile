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

# ---------------------------------------------------------------- quality

# `build-web` is in here, and it earns its place.
#
# A missing CSS module import passes typecheck, passes ESLint and passes every one of the
# unit tests, because `*.module.css` is ambient-typed and vitest is configured with
# `css: false`. The only thing that notices is the bundler. That state — four green gates on
# a tree that cannot build — reached this repository once, and this line is why it will not
# reach it twice.
.PHONY: check
check: fmt-check lint test build-web ## Everything CI runs

.PHONY: build-web
build-web: ## Prove the client actually bundles
	$(PNPM) --filter @polaris/web build

.PHONY: fmt
fmt: ## Format all code
	cd $(SVC) && $(GO) fmt ./...
	npx prettier --write "web/src/**/*.{ts,tsx,css}" "web/e2e/**/*.ts" "web/*.{ts,json}" "desktop/src/**/*.{ts,cts}"

.PHONY: fmt-check
fmt-check: ## Fail if anything is unformatted
	@cd $(SVC) && out=$$($(GO) fmt ./...) && [ -z "$$out" ] || { echo "unformatted: $$out"; exit 1; }
	@npx prettier --check "web/src/**/*.{ts,tsx,css}" "web/e2e/**/*.ts" "web/*.{ts,json}" "desktop/src/**/*.{ts,cts}"

.PHONY: lint
lint: lint-go lint-compose lint-desktop lint-images lint-imports lint-keymap lint-routes lint-tokens lint-web ## All linters

.PHONY: lint-go
lint-go:
	cd $(SVC) && $(GO) vet ./...

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

.PHONY: test-web
test-web:
	$(PNPM) -r test

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
stack: ## Start the full local stack (infra + api + sync) in the background
	@$(MAKE) up
	@cd $(SVC) && $(GO) run ./cmd/polarisctl migrate up --database "$(DB_URL)"
	@echo "building api and sync…"
	@cd $(SVC) && $(GO) build -o /tmp/polaris-api ./cmd/api
	@cd $(SVC) && $(GO) build -o /tmp/polaris-sync ./cmd/sync
	@echo "starting api and sync…"
	@DATABASE_URL="$(DB_URL)" /tmp/polaris-api  > /tmp/polaris-api.log  2>&1 & echo $$! > /tmp/polaris-api.pid
	@DATABASE_URL="$(DB_URL)" /tmp/polaris-sync > /tmp/polaris-sync.log 2>&1 & echo $$! > /tmp/polaris-sync.pid
	@until curl -sf http://127.0.0.1:8088/healthz >/dev/null; do sleep 1; done
	@echo "api :8088  sync :8089  — logs in /tmp/polaris-*.log"

# Verifies rather than announces. "stopped" while something is still listening is the
# statement that made the bug above so expensive.
.PHONY: stack-stop
stack-stop: ## Stop the background api and sync processes
	@kill $$(cat /tmp/polaris-api.pid 2>/dev/null) 2>/dev/null || true
	@kill $$(cat /tmp/polaris-sync.pid 2>/dev/null) 2>/dev/null || true
	@rm -f /tmp/polaris-api.pid /tmp/polaris-sync.pid
	@for i in 1 2 3 4 5 6 7 8 9 10; do \
	  lsof -ti :8088 -ti :8089 >/dev/null 2>&1 || break; \
	  sleep 0.2; \
	done
	@held="$$(lsof -ti :8088 2>/dev/null; lsof -ti :8089 2>/dev/null | tr '\\n' ' ')"; \
	if [ -n "$$held" ]; then \
	  echo "NOT stopped — still listening on :8088/:8089 as pid(s): $$held"; \
	  echo "  These are almost certainly a previous build. Kill them before starting again,"; \
	  echo "  or the stack you test will not be the code you just wrote."; \
	  exit 1; \
	fi; \
	echo "stopped"
