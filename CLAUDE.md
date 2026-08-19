# Polaris — Project Instructions

Read `docs/05-infrastructure/11-self-hosting.md` before any infra or compose change.
That doc is checked against source — prefer it over older design docs when they conflict.

## Stack

Five containers: `Polaris_web`, `Polaris_api`, `Polaris_sync`, `Polaris_worker`,
`Polaris_db`. GraphQL API on `:8088`, sync hub on `:8089`, static web on `:8080`.

## Deploying to prod

Polaris is **`deploy: manual`** in the fleet registry (not tag-driven auto-deploy).

From registry `deploy_cmd`:

```bash
cd /root/Polaris && git fetch origin && git reset --hard origin/main \
  && GIT_SHA=$(git rev-parse --short HEAD) docker compose up -d --build
```

Or after a local commit on main: `./app.sh restart` (verify `app.sh` verbs for this repo).

Health: https://polaris.peixotolabs.com/healthz

## Before declaring done

Run repo tests/build. Never commit automatically unless the user asks.

## References

- `/root/AdminPanel/registry.yml` — Polaris entry + deploy_cmd
- `/root/SERVER_INFRA.md`, `/root/CLAUDE.md`
