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

fail=0
while IFS= read -r file; do
  if grep -qE "$(echo "$ALLOWED" | paste -sd'|' -)" <<<"$file"; then
    continue
  fi
  hits=$(strip_comments <"$file" \
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
