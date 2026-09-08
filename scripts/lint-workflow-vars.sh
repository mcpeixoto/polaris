#!/usr/bin/env bash
# A workflow step may not read an environment variable it was never given.
#
# `run:` blocks are shell, and shell is not checked by anything until it runs. A step whose
# `env:` says TAG while its script says "$SHA" is a perfectly valid YAML document, a
# perfectly valid workflow, and fails on the day it is needed — which for a release
# workflow means the release. That is not hypothetical: release.yml shipped with exactly
# that mismatch, an env: renamed without its body, and the first tag it ran on died on
# `SHA: unbound variable` before checking anything.
#
# So: every $VAR a run block reads must be in that step's env:, the job's or workflow's
# env:, assigned earlier in the same block, or one of the variables the runner defines.
# Anything else is a typo or a rename that stopped half way.
set -euo pipefail

cd "$(dirname "$0")/.."

python3 - "$@" <<'PY'
import re, sys, pathlib
try:
    import yaml
except ImportError:
    print("PyYAML not available — skipping (CI installs it)")
    sys.exit(0)

# Defined by the runner, or by conventions every job has.
RUNNER = {
    'GITHUB_REF', 'GITHUB_REF_NAME', 'GITHUB_REF_TYPE', 'GITHUB_SHA', 'GITHUB_ENV',
    'GITHUB_OUTPUT', 'GITHUB_PATH', 'GITHUB_TOKEN', 'GITHUB_WORKSPACE', 'GITHUB_REPOSITORY',
    'GITHUB_EVENT_NAME', 'GITHUB_RUN_ID', 'GITHUB_RUN_NUMBER', 'GITHUB_STEP_SUMMARY',
    'GITHUB_ACTOR', 'GITHUB_SERVER_URL', 'GITHUB_API_URL', 'GITHUB_HEAD_REF',
    'GITHUB_BASE_REF', 'GITHUB_EVENT_PATH', 'RUNNER_OS', 'RUNNER_TEMP', 'RUNNER_ARCH',
    'RUNNER_TOOL_CACHE', 'HOME', 'PATH', 'PWD', 'SHELL', 'USER', 'TMPDIR', 'CI',
}

fail = 0
for path in sorted(pathlib.Path('.github/workflows').glob('*.yml')):
    doc = yaml.safe_load(path.read_text())
    top_env = set(doc.get('env') or {})
    for job_name, job in (doc.get('jobs') or {}).items():
        job_env = top_env | set(job.get('env') or {})
        # Names an earlier step in this job wrote to $GITHUB_ENV, which is how a value is
        # deliberately handed from one step to the next. Accumulated as the steps are
        # walked in order, so a variable is only known to steps that come after the one
        # exporting it — a step reading it earlier is still the bug this catches.
        exported = set()
        for step in job.get('steps') or []:
            run = step.get('run')
            if not run:
                continue
            known = job_env | set(step.get('env') or {}) | RUNNER | exported
            # Anything the block assigns itself, including loop variables and read.
            known |= set(re.findall(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=', run, re.M))
            known |= set(re.findall(r'\bfor\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\b', run))
            known |= set(re.findall(r'\bread\s+(?:-r\s+)?([A-Za-z_][A-Za-z0-9_]*)', run))
            # Only SCREAMING_CASE reads: lowercase names are local shell variables and the
            # assignment scan above already covers the ones that matter.
            used = set(re.findall(r'\$\{?([A-Z][A-Z0-9_]{2,})\b', run))
            # ${VAR:-default} and ${VAR:=} supply their own fallback; not an error.
            defaulted = set(re.findall(r'\$\{([A-Z][A-Z0-9_]{2,}):[-=?]', run))
            missing = sorted(used - known - defaulted)
            exported |= set(re.findall(
                r'^\s*echo\s+"?([A-Z][A-Z0-9_]*)=.*>>\s*"?\$\{?GITHUB_ENV', run, re.M))

            if missing:
                name = step.get('name', '<unnamed>')
                print(f"FAIL: {path}: job `{job_name}`, step `{name}` reads {', '.join(missing)}")
                print(f"      but neither the step, the job nor the runner defines it.")
                fail = 1

# macOS runners ship bash 3.2, from 2007, because bash 4 is GPLv3 and Apple will not
# ship it. Every builtin below exists on the Linux runners and on any modern machine a
# step is tested on, and is a `command not found` on macOS — at the end of a build that
# has already signed and notarised correctly, which is where this was found.
BASH4 = {
    "mapfile": "read into the array with `while IFS= read -r x; do arr+=(\"$x\"); done < <(...)`",
    "readarray": "same as mapfile; not in bash 3.2",
    "declare -A": "associative arrays do not exist in bash 3.2",
    "${!": "indirect/name references are unreliable in bash 3.2",
}

for path in sorted(pathlib.Path('.github/workflows').glob('*.yml')):
    text = path.read_text()
    # Only where a macOS runner is possible. The Linux and Windows runners have bash 5.
    if "macos" not in text:
        continue
    doc = yaml.safe_load(text)
    for job_name, job in (doc.get('jobs') or {}).items():
        for step in job.get('steps') or []:
            # Comments are stripped first: the fix for this very check explains in prose
            # why mapfile is not used, and a substring match flagged the explanation.
            run = "\n".join(line for line in (step.get('run') or "").splitlines()
                            if not line.lstrip().startswith("#"))
            for bad, advice in BASH4.items():
                if bad in run:
                    name = step.get('name', '<unnamed>')
                    print(f"FAIL: {path}: job `{job_name}`, step `{name}` uses `{bad}`")
                    print(f"      macOS runners have bash 3.2. {advice}")
                    fail = 1

if not fail:
    print("workflow shell variables: ok")
sys.exit(fail)
PY
