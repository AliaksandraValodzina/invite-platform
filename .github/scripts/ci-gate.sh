#!/usr/bin/env bash
#
# The single required status check.
#
# Owned by .github/workflows/ci.yml. If you are adding a job to that workflow,
# read this file first: the gate is the thing that decides whether a pull
# request can merge, and it is designed so that adding a job cannot weaken it.
#
# Why it exists
# -------------
# The Playwright job is deliberately skipped on pull requests that cannot change
# what it exercises. A skipped job inside `needs` must not be able to make the
# gate pass by accident. Enumerating `failure` and `cancelled` cannot catch that,
# because `skipped` is neither.
#
# The rule
# --------
# Every job handed to the gate must have SUCCEEDED, with exactly one exception:
# a job explicitly declared conditional, which is checked against the decision
# that was made about it.
#
#   declared conditional, decision `true`   -> must have succeeded
#   declared conditional, decision `false`  -> must actually have been skipped
#   declared conditional, no usable decision -> red, always
#   not declared conditional                 -> must have succeeded, no exceptions
#   declared conditional but absent from needs -> red (the declaration is stale)
#
# Why it reads the whole `needs` context
# --------------------------------------
# The gate used to name changes, static and e2e one at a time. That is fail
# open by construction: the next job somebody adds to `needs`, for example the
# Postgres job the schema task will need, is enforced only if they also remember
# to edit this file. Reading `toJSON(needs)` inverts that. A new job is required
# to succeed the moment it is added to `needs`, and relaxing it takes a
# deliberate entry in CONDITIONAL_JOBS rather than an oversight.
#
# Inputs
# ------
#   NEEDS_JSON        the workflow's `toJSON(needs)`
#   CONDITIONAL_JOBS  newline separated `job=decision` lines, may be empty
#
# Covered by ci-gate.test.sh, which asserts every combination that could make
# this pass by accident. The static job runs those tests.

set -uo pipefail

fail=0

pass_note () { printf '  ok   %s\n' "$1"; }
fail_note () { printf '  FAIL %s\n' "$1"; fail=1; }

needs_json=${NEEDS_JSON:-}
conditional_raw=${CONDITIONAL_JOBS:-}

# A gate that cannot see the results refuses to pass. This covers the whole
# expression being mistyped, which yields an empty string rather than an error.
if [ -z "$needs_json" ]; then
  fail_note "no job results were handed to the gate (NEEDS_JSON was empty). Refusing to pass."
  echo "CI gate: FAILED"
  exit 1
fi

if ! echo "$needs_json" | jq -e 'type == "object"' >/dev/null 2>&1; then
  fail_note "job results were not a JSON object. Refusing to pass. Got: $needs_json"
  echo "CI gate: FAILED"
  exit 1
fi

job_names=$(echo "$needs_json" | jq -r 'keys[]')

if [ -z "$job_names" ]; then
  fail_note "the gate depends on no jobs at all, so it would pass unconditionally. Refusing to pass."
  echo "CI gate: FAILED"
  exit 1
fi

decision_for () { # job -> decision, empty when not declared conditional
  printf '%s\n' "$conditional_raw" | while IFS= read -r line; do
    [ -z "$line" ] && continue
    case "$line" in
      "$1="*) printf '%s' "${line#*=}"; return ;;
    esac
  done
}

is_declared () { # job -> 0 when the job has a CONDITIONAL_JOBS entry
  printf '%s\n' "$conditional_raw" | grep -qE "^$1=" 2>/dev/null
}

for job in $job_names; do
  result=$(echo "$needs_json" | jq -r --arg j "$job" '.[$j].result // ""')

  if ! is_declared "$job"; then
    # The default, and the safe one. Anything other than success is red,
    # including skipped, which is the state that used to slip through.
    if [ "$result" = "success" ]; then
      pass_note "$job succeeded"
    else
      fail_note "$job: expected success, got '${result:-<empty>}'"
    fi
    continue
  fi

  decision=$(decision_for "$job")

  case "$decision" in
    true)
      if [ "$result" = "success" ]; then
        pass_note "$job was required and passed"
      else
        fail_note "$job: it was required for this diff, got '${result:-<empty>}'"
      fi
      ;;
    false)
      if [ "$result" = "skipped" ]; then
        pass_note "$job was deliberately skipped: nothing it can exercise changed"
      else
        fail_note "$job: it was not required, so it should have been skipped, got '${result:-<empty>}'"
      fi
      ;;
    *)
      fail_note "$job: no usable decision (got '${decision:-<empty>}'). Refusing to pass a gate that cannot tell whether $job should have run."
      ;;
  esac
done

# A declaration naming a job that is not in `needs` is stale, usually because
# the job was renamed. Left unchecked it silently exempts nothing while looking
# like it exempts something, so it is an error in its own right.
if [ -n "$conditional_raw" ]; then
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    declared_job=${line%%=*}
    if ! echo "$job_names" | grep -qx "$declared_job"; then
      fail_note "'$declared_job' is declared conditional but is not one of the gate's needs. Stale declaration, or the job was renamed."
    fi
  done <<EOF
$conditional_raw
EOF
fi

if [ "$fail" -ne 0 ]; then
  echo "CI gate: FAILED"
else
  echo "CI gate: passed"
fi

exit "$fail"
