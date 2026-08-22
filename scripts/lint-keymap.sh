#!/usr/bin/env bash
# Enforces the keyboard model from docs/07-milestones/00-milestone-0.md:
#
#   One registry. Every action is registered once as {id, title, keys, when, group, run},
#   and the command menu, the help overlay, the context menus and the key handler are all
#   VIEWS OVER THAT REGISTRY. No component owns a shortcut.
#
# The rule exists because a keyboard-first product accumulates hundreds of bindings, and
# the questions that matter — what does this key do here, is this chord already taken,
# what can I do right now — are answerable in O(1) against a registry and unanswerable
# against handlers scattered through a component tree.
set -euo pipefail

cd "$(dirname "$0")/.."

# The allowlist is deliberately explicit and short. Each entry either IS the registry, or
# owns an internal focus trap — and a trap cannot be expressed as a registered action,
# because its whole purpose is to intercept keys before the surrounding context sees them.
#
# If this list grows, the discipline has been lost. Adding to it should be argued for in
# review.
ALLOWED='^web/src/keys/
^web/src/editor/
^web/src/app/keymap\.tsx$
^web/src/components/Menu\.tsx$
^web/src/components/Modal\.tsx$
^web/src/app/CommandMenu\.tsx$'

# Comment and blank lines are stripped before matching, so prose that mentions onKeyDown —
# including the doc comments that explain this very rule — does not trip it.
strip_comments() {
  sed -E 's://.*$::; s:/\*.*\*/::; s:^[[:space:]]*\*.*$::'
}

# One line may opt out, by carrying `keymap-lint-allow: <reason>` and saying why:
#
#   onKeyDown={/* keymap-lint-allow: intercepts Enter before the enclosing form */ …}
#
# This exists for the handlers the registry genuinely cannot express — the same category
# the file allowlist above is for, at line rather than file granularity. An element that
# intercepts a key *before* the surrounding context sees it, or that supplies the
# activation a native control would have given it, is not a shortcut and does not belong
# in the command menu or the help overlay.
#
# It is deliberately noisy and greppable: `grep -rn keymap-lint-allow web/src` is the
# complete list, and each one carries its argument next to the code rather than in a
# review comment nobody can find later. A blanket per-file entry hides the next handler
# added to that file; this cannot.
# The pragma is matched on the line itself or on either side of it, because the formatter
# decides where a comment inside a JSX expression ends up: prettier moves
# `onKeyDown={/* … */ handler}` onto three lines as soon as it is long enough, which put
# the reason on the line after the one being flagged.
drop_allowed_lines() {
  awk '
    { line[NR] = $0 }
    END {
      for (i = 1; i <= NR; i++) {
        allow = 0
        for (j = i - 1; j <= i + 1; j++) {
          if (j >= 1 && j <= NR && line[j] ~ /keymap-lint-allow:[[:space:]]*[^[:space:]]/) allow = 1
        }
        print allow ? "" : line[i]
      }
    }
  '
}

fail=0
while IFS= read -r file; do
  if grep -qE "$(echo "$ALLOWED" | paste -sd'|' -)" <<<"$file"; then
    continue
  fi
  # drop_allowed_lines blanks opted-out lines rather than deleting them, so the line
  # numbers grep reports still match the file on disk.
  hits=$(drop_allowed_lines <"$file" | strip_comments \
    | grep -nE 'onKeyDown|onKeyUp|onKeyPress|addEventListener\(.[a-z]*key' || true)
  if [ -n "$hits" ]; then
    echo "$file:"
    echo "$hits" | sed 's/^/  /'
    fail=1
  fi
done < <(find web/src -name '*.ts' -o -name '*.tsx' | sort)

if [ $fail -ne 0 ]; then
  cat >&2 <<'MSG'

Keyboard handling belongs in the keymap registry.

Register an action instead:

  useActions([{ id: 'issue.archive', title: 'Archive issue', keys: ['e'],
                group: 'Issues', run: () => ... }])

It then works, appears in the command menu, appears in the help overlay, and is checked
for conflicts — none of which a local handler gets.
MSG
  exit 1
fi

echo "keymap discipline: ok"
