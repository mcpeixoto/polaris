# Polaris — Project Instructions

Read `docs/05-infrastructure/11-self-hosting.md` before any infra or compose change.
That doc is checked against source — prefer it over older design docs when they conflict.

## Stack

Five containers: `Polaris_web`, `Polaris_api`, `Polaris_sync`, `Polaris_worker`,
`Polaris_db`. GraphQL API on `:8088`, sync hub on `:8089`, static web on `:8080`.

## Deploying to prod

**A merge to `main` deploys itself.** The `deploy` job at the end of
`.github/workflows/ci.yml` runs after every other check passes, and only on a push to
`main` — never on a pull request, never on a tag. It ships the exact commit that run
validated rather than whatever `main` points at by then, so two merges a minute apart
cannot deploy the same tree twice and skip one.

Deploys run one at a time and are never cancelled mid-flight: `docker compose up --build`
interrupted halfway leaves the stack half-new. Afterwards the job polls
https://polaris.peixotolabs.com/healthz for up to five minutes, because
`docker compose up -d` returns as soon as containers exist and long before anything serves
a request.

It needs these repository secrets. Without them the job fails loudly rather than passing
without deploying:

| Secret | What it is |
|---|---|
| `DEPLOY_HOST` | The server's address |
| `DEPLOY_USER` | The SSH user (`root` on this fleet) |
| `DEPLOY_SSH_KEY` | Private key for that user |
| `DEPLOY_HOST_KEY` | The server's public host key, from `ssh-keyscan <host>`. Pinned so the job cannot be talked onto another machine |
| `DEPLOY_PORT` | Optional, defaults to `22` |
| `DEPLOY_PATH` | Optional, defaults to `/root/Polaris` |
| `DEPLOY_HEALTH_URL` | Optional, defaults to the healthz URL above |

The fleet registry at `/root/AdminPanel/registry.yml` still carries `deploy: manual` for
Polaris. That is now a description of a path nobody takes, not a constraint — worth
reconciling so the registry does not disagree with what actually happens.

To deploy by hand anyway — a rollback, or a server-side change with no commit behind it:

```bash
cd /root/Polaris && git fetch origin && git reset --hard origin/main \
  && GIT_SHA=$(git rev-parse --short HEAD) docker compose up -d --build
```

Or after a local commit on main: `./app.sh restart` (verify `app.sh` verbs for this repo).

Health: https://polaris.peixotolabs.com/healthz

## Before declaring done

Run repo tests/build. Never commit automatically unless the user asks.

Report results honestly. If a test fails, say so and quote the failure — do not
describe a run as green because most of it was. If a check was skipped, say it was
skipped. "Probably fine" is not a result.

## Git — ask first, always

These are irreversible or outward-facing. Stop and get an explicit yes in chat for
each one, every time. A yes for one of them is not a yes for the others, and approval
in an earlier session does not carry over.

- **Changing repository visibility.** `gh repo edit --visibility` needs an explicit,
  in-chat yes every single time, naming the repo. Going public is a one-way door: once
  out, code is forked, cached and indexed by people and crawlers it cannot be recalled
  from. Never flip visibility on Claude's own initiative, as a tidy-up, or because a
  task seems to imply it — only on a direct request. Before going public, scan the full
  history for secrets and say what was found.
- **Rewriting published history.** No `rebase`/`reset`/`commit --amend`/`filter-repo`/
  `filter-branch` on anything already pushed, and no `push --force` or
  `--force-with-lease` to a shared branch. Rewriting changes every downstream SHA and
  breaks existing clones, review links and CI records.
- **Deleting anything durable.** Branches, tags, remotes, stashes, worktrees, volumes.
  Look at what it holds before removing it.
- **`git clean -fd`, `reset --hard`, `checkout -- .`** — these silently destroy
  uncommitted work that exists nowhere else. Check `git status` first and say what
  would be lost.

Interactive flags (`rebase -i`, `add -i`) do not work in this environment.

## Secrets

`.gitignore` already blocks `.env`, `.env.*`, `*.pem`, `*.key` and `polaris.env`.
Do not weaken those rules, and do not `git add -f` past them.

Before any commit, check the staged diff for credentials — tokens, private keys,
connection strings with a real password, `POLARIS_JWT_SECRET`, `POSTGRES_PASSWORD`.
Config goes in `.env.example` as a placeholder, never a working value.

If a secret does reach a commit, treat it as leaked the moment it is pushed: say so
immediately and rotate the credential. Scrubbing history is damage control, not a fix
— it does not un-share what was already fetched.

## Test data

Seeding a local workspace to exercise a feature is fine. Say clearly what was created
and where, so it can be removed. Never write test data to a remote or production
database.

## References

- `/root/AdminPanel/registry.yml` — Polaris entry + deploy_cmd
- `/root/SERVER_INFRA.md`, `/root/CLAUDE.md`
