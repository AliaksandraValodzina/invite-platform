#!/usr/bin/env bash
#
# The single required status check.
#
# It exists because the Playwright job is deliberately skipped on pull requests
# that cannot change what it exercises, and a skipped job inside `needs` must
# not be able to make the gate pass by accident.
#
# The rule: the gate checks the DECISION, not only the results.
#
#   changes said e2e was required  -> e2e must have succeeded
#   changes said e2e was not needed -> e2e must actually have been skipped
#   changes said nothing usable     -> red, always
#
# That last branch is the one that matters. Without it, renaming the `e2e`
# output, or a typo in the `if:` expression that reads it, makes the expression
# evaluate to an empty string, Playwright is skipped on every pull request from
# then on, and the gate stays green while the browser suite silently never runs
# again. Enumerating `failure` and `cancelled` cannot catch that, because
# `skipped` is neither.
#
# Covered by ci-gate.test.sh, which asserts every combination that could make
# this pass by accident.

set -uo pipefail

fail=0

pass_note () { printf '  ok   %s\n' "$1"; }
fail_note () { printf '  FAIL %s\n' "$1"; fail=1; }

require_success () {
  local name=$1 result=${2:-}
  if [ "$result" = "success" ]; then
    pass_note "$name succeeded"
  else
    fail_note "$name: expected success, got '${result:-<empty>}'"
  fi
}

require_success "changes" "${CHANGES_RESULT:-}"
require_success "static" "${STATIC_RESULT:-}"

case "${E2E_DECISION:-}" in
  true)
    if [ "${E2E_RESULT:-}" = "success" ]; then
      pass_note "e2e was required and passed"
    else
      fail_note "e2e: changes said it was required, got '${E2E_RESULT:-<empty>}'"
    fi
    ;;
  false)
    if [ "${E2E_RESULT:-}" = "skipped" ]; then
      pass_note "e2e was deliberately skipped: no file it can exercise changed"
    else
      fail_note "e2e: changes said it was not required, so it should have been skipped, got '${E2E_RESULT:-<empty>}'"
    fi
    ;;
  *)
    fail_note "e2e: 'changes' did not emit a usable decision (got '${E2E_DECISION:-<empty>}'). Refusing to pass a gate that cannot tell whether Playwright should have run."
    ;;
esac

if [ "$fail" -ne 0 ]; then
  echo "CI gate: FAILED"
else
  echo "CI gate: passed"
fi

exit "$fail"
