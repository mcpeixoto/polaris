# polaris-runner

Polls Polaris for issues delegated to this agent and runs them with a local coding CLI.

```
polaris-runner --url https://polaris.example.com --preset claude --workdir ~/src/app
```

The token must belong to an app user, not a person: the runner works issues delegated to that agent, and the server refuses a personal key. Pass `--token`, or set `POLARIS_RUNNER_TOKEN` so it does not land in the shell history.

## Getting a token

1. In Polaris, open **Settings → OAuth applications** and create an application. Its name and icon are what people see in the Delegate picker.
2. As a workspace admin, open `/oauth/authorize?client_id=<id>&redirect_uri=<uri>&response_type=code&scope=read,write&actor=app` and approve. This creates the app user and adds it to the teams you choose.
3. Exchange the returned code at `POST /oauth/token` with `grant_type=authorization_code`, the same `redirect_uri`, and the application's `client_id` and `client_secret`. The `access_token` in the answer is the runner's token.

Delegate an issue to the app, and the runner picks it up about two minutes later.

## Flags

| Flag | Meaning |
| --- | --- |
| `--url` | Polaris base URL |
| `--token` | Bearer token. Defaults to `POLARIS_RUNNER_TOKEN` |
| `--preset` | `claude`, `codex`, or `opencode` |
| `--workdir` | Directory the agent runs in |
| `--once` | Claim once and exit. Exit 0 if nothing is due |
| `--poll` | Wait between empty claims. Default `5s` |
| `--max-turns` | Turn cap, passed through when the preset supports it |
| `--unsafe-auto-approve` | Append the preset's permission-skip flag |

The runner itself does not commit, push, or merge. The CLI it starts can do whatever that CLI's own permission settings allow in `--workdir`, so give it a checkout you are happy for it to change. SIGINT and SIGTERM stop the child and mark the run failed (`runner stopped`).

## Presets

| Preset | Command | Prompt | Resume |
| --- | --- | --- | --- |
| `claude` | `claude -p --output-format stream-json --verbose` | stdin | `--resume` |
| `codex` | `codex exec --json -` | stdin | `resume` |
| `opencode` | `opencode run --format json` | argument | `--session` |

Binary names default to `claude`, `codex`, and `opencode` on `PATH`. Override them with `POLARIS_RUNNER_CLAUDE_BIN`, `POLARIS_RUNNER_CODEX_BIN`, and `POLARIS_RUNNER_OPENCODE_BIN`.

Permission prompts are left to the CLI. `--unsafe-auto-approve` adds `claude --dangerously-skip-permissions` or `codex --full-auto`. OpenCode has no such flag.

`--max-turns` is passed to Claude as `--max-turns`. Codex and OpenCode do not take it.
