#!/usr/bin/env bash
#
# Tests for ci-gate.sh.
#
# The gate decides whether a pull request can merge, so its logic is tested like
# anything else. Every case here is one that could plausibly make the gate pass
# when it should not, which is the failure mode that matters: a red gate that
# should be green is noticed within minutes, a green gate that should be red is
# noticed when a regression reaches a buyer.
#
# No dependencies beyond jq, which the runner already has.

set -uo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
GATE="$HERE/ci-gate.sh"

passed=0
failed=0

# needs_json, conditional, expected (green|red), description
check () {
  local needs_json=$1 conditional=$2 expected=$3 description=$4
  local output status actual

  output=$(NEEDS_JSON="$needs_json" CONDITIONAL_JOBS="$conditional" bash "$GATE" 2>&1)
  status=$?

  if [ "$status" -eq 0 ]; then actual=green; else actual=red; fi

  if [ "$actual" = "$expected" ]; then
    printf '  ok   %s\n' "$description"
    passed=$((passed + 1))
  else
    printf '  FAIL %s\n' "$description"
    printf '       expected %s, got %s\n' "$expected" "$actual"
    printf '       %s\n' "$output"
    failed=$((failed + 1))
  fi
}

# Shorthand for building a needs context.
needs () { # job:result job:result ...
  local out="{}" pair job result
  for pair in "$@"; do
    job=${pair%%:*}
    result=${pair#*:}
    out=$(echo "$out" | jq --arg j "$job" --arg r "$result" '. + {($j): {result: $r, outputs: {}}}')
  done
  echo "$out"
}

echo "CI gate behaviour"

# The two states that are allowed to pass.
check "$(needs static:success e2e:success)" "e2e=true" green \
  "green when everything ran and passed"
check "$(needs static:success e2e:skipped)" "e2e=false" green \
  "green when Playwright was deliberately skipped by the path filter"

# The case the whole design exists for.
check "$(needs static:success e2e:skipped)" "e2e=true" red \
  "RED when Playwright was required but was skipped anyway"

# A decision that did not survive the expression that produced it.
check "$(needs static:success e2e:skipped)" "e2e=" red \
  "RED when the decision is an empty string"
check "$(needs static:success e2e:skipped)" "" red \
  "RED when no decision was declared at all"
check "$(needs static:success e2e:skipped)" "e2e=maybe" red \
  "RED when the decision is not a value the gate understands"
check "$(needs static:success e2e:skipped)" "e2e=yes" red \
  "RED when the decision is some other truthy-looking string"
check "$(needs static:success e2e:skipped)" "e2e=TRUE" red \
  "RED when the decision is the right word in the wrong case"

# Ordinary failures still fail.
check "$(needs static:success e2e:failure)" "e2e=true" red \
  "RED when Playwright ran and failed"
check "$(needs static:success e2e:cancelled)" "e2e=true" red \
  "RED when Playwright ran and was cancelled"
check "$(needs static:success e2e:success)" "e2e=false" red \
  "RED when Playwright ran despite not being required"
check "$(needs static:success e2e:failure)" "e2e=false" red \
  "RED when Playwright was not required but ran and failed"
check "$(needs static:failure e2e:success)" "e2e=true" red \
  "RED when the static job failed"
check "$(needs static:cancelled e2e:success)" "e2e=true" red \
  "RED when the static job was cancelled"
check "$(needs static:skipped e2e:success)" "e2e=true" red \
  "RED when the static job was skipped"
check "$(needs static:success e2e:'')" "e2e=true" red \
  "RED when a job reports no result at all"

# The gate must not pass when it cannot see anything.
check "" "e2e=true" red \
  "RED when no job results arrived"
check "{}" "e2e=true" red \
  "RED when the gate depends on no jobs at all"
check "not json" "e2e=true" red \
  "RED when the results are not JSON"
check "[]" "e2e=true" red \
  "RED when the results are JSON but not an object"

# A stale declaration must not look like it is exempting something.
check "$(needs static:success e2e:success)" "playwright=true" red \
  "RED when a conditional declaration names a job that does not exist"

# Adding a job must tighten the gate, never loosen it. These are the cases that
# matter for the Postgres job the schema task will need.
check "$(needs static:success e2e:success database:success)" "e2e=true" green \
  "green when an added database job succeeded"
check "$(needs static:success e2e:success database:failure)" "e2e=true" red \
  "RED when an added database job failed, without the gate being taught about it"
check "$(needs static:success e2e:success database:skipped)" "e2e=true" red \
  "RED when an added database job was skipped and was not declared conditional"
check "$(needs static:success e2e:success database:cancelled)" "e2e=true" red \
  "RED when an added database job was cancelled"
check "$(needs static:success e2e:skipped database:skipped)" "e2e=false
database=false" green \
  "green when both conditional jobs were correctly skipped"
check "$(needs static:success e2e:skipped database:skipped)" "e2e=false
database=true" red \
  "RED when the database job was required but skipped"

echo ""
if [ "$failed" -eq 0 ]; then
  echo "$passed passed, 0 failed"
  echo "The gate cannot be made green by a skipped job, and a job added to needs is enforced by default."
  exit 0
fi

echo "$passed passed, $failed failed"
exit 1
