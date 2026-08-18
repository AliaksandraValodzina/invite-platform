#!/usr/bin/env bash
#
# Tests for the CI gate.
#
# The gate is the only check branch protection trusts, so "it looks right" is
# not good enough. Every combination that could make it pass by accident is
# asserted here, and the cases that must be RED outnumber the ones that must be
# green on purpose.
#
# Runs in the static job. No dependencies, so it costs nothing.

set -uo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
gate="$here/ci-gate.sh"

passed=0
failed=0

# expect_gate <expected exit> <description> <changes> <static> <e2e result> <e2e decision>
expect_gate () {
  local expected=$1 description=$2 changes=$3 static=$4 e2e_result=$5 e2e_decision=$6
  local output actual

  output=$(CHANGES_RESULT="$changes" STATIC_RESULT="$static" \
           E2E_RESULT="$e2e_result" E2E_DECISION="$e2e_decision" \
           bash "$gate" 2>&1)
  actual=$?

  if [ "$actual" -eq "$expected" ]; then
    printf '  ok   %s\n' "$description"
    passed=$((passed + 1))
  else
    printf '  FAIL %s\n         expected exit %s, got %s\n%s\n' \
      "$description" "$expected" "$actual" "$(printf '%s\n' "$output" | sed 's/^/         /')"
    failed=$((failed + 1))
  fi
}

echo "CI gate behaviour"

# The two ways a pull request is legitimately green.
expect_gate 0 "green when everything ran and passed" \
  success success success true
expect_gate 0 "green when Playwright was deliberately skipped by the path filter" \
  success success skipped false

# The accident this gate exists to prevent. If someone renames the `e2e` output,
# or mistypes it in the `if:` expression, the expression yields an empty string,
# Playwright is skipped forever, and a results-only gate stays green.
expect_gate 1 "RED when Playwright was required but was skipped anyway" \
  success success skipped true
expect_gate 1 "RED when the changes job emitted no decision at all" \
  success success skipped ""
expect_gate 1 "RED when the decision is not a value the gate understands" \
  success success skipped "True"
expect_gate 1 "RED when the decision is some other truthy-looking string" \
  success success skipped "yes"

# Ordinary failures still have to be caught.
expect_gate 1 "RED when Playwright ran and failed" \
  success success failure true
expect_gate 1 "RED when Playwright ran despite not being required" \
  success success failure false
expect_gate 1 "RED when Playwright ran and was cancelled" \
  success success cancelled true
expect_gate 1 "RED when the static job failed" \
  success failure skipped false
expect_gate 1 "RED when the static job was cancelled" \
  success cancelled skipped false
expect_gate 1 "RED when the static job was skipped" \
  success skipped skipped false
expect_gate 1 "RED when the changes job failed" \
  failure success skipped ""
expect_gate 1 "RED when the changes job was cancelled" \
  cancelled success skipped ""

# A gate that receives nothing at all must not pass.
expect_gate 1 "RED when no job results arrived" \
  "" "" "" ""

printf '\n%s passed, %s failed\n' "$passed" "$failed"
[ "$failed" -eq 0 ] || exit 1
echo "The gate cannot be made green by a skipped job."
