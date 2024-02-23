/**
 * One frozen ruleId -> severity table.
 *
 * Severity is not a label, it is the exit code: flipping one rule from `error`
 * to `info` turns a refusal into a green build. As a literal at many
 * construction sites it drifts silently, so every finding takes its severity
 * from here and an unknown rule throws.
 *
 * Asserting this table against a hand-written expected map in the tests is NOT
 * the guard -- three declarations can be edited together. `severity-exit.test.mjs`
 * drives real inputs through the real entry point and pins status and exit code.
 */
export const RULE_SEVERITY = Object.freeze({
  'dashboard-file-skipped': 'info',
  'dashboard-id-duplicated': 'error',
  'dashboard-format-undeclared': 'error',
  'dashboard-format-unsupported': 'error',
  'dashboard-invalid': 'error',
  'dashboard-unreadable': 'error',
  'finding-limit-reached': 'warning',
  'freshness-evidence-absent': 'warning',
  'model-missing': 'error',
  'model-renamed': 'warning',
  'model-unused': 'info',
  'models-invalid': 'error',
  'models-unreadable': 'error',
  'no-dashboard-read': 'error',
  'path-outside-root': 'error',
  'query-missing': 'error',
  'query-source-unresolved': 'warning',
  'rename-ambiguous': 'error',
  'source-map-complete': 'info',
  'upstream-missing': 'error',
})

/**
 * The rules that mean evidence was missing, unsupported or unobtainable.
 *
 * Every one of these sets `incomplete`, and for the warning-severity rules in
 * the list that flag is the ONLY thing standing between the run and a green
 * exit 0. Deleting one `incomplete = true` elsewhere in this catalog turned
 * exit 2 into exit 1 with the whole suite green, so each of these has a test
 * that pins the exit code rather than the finding.
 *
 * `freshness-evidence-absent` is deliberately NOT here, and the README says so:
 * an export that declares no freshness for a model was read completely, and the
 * map records that model's freshness as an explicit unknown rather than
 * omitting it or guessing. Nothing failed to be obtained.
 */
export const INCOMPLETE_RULES = Object.freeze([
  'dashboard-id-duplicated',
  'dashboard-format-undeclared',
  'dashboard-format-unsupported',
  'dashboard-invalid',
  'dashboard-unreadable',
  'finding-limit-reached',
  'models-invalid',
  'models-unreadable',
  'no-dashboard-read',
  'path-outside-root',
  'query-source-unresolved',
  'rename-ambiguous',
])

export function severityOf(ruleId) {
  const severity = RULE_SEVERITY[ruleId]
  if (severity === undefined) throw new Error(`unknown ruleId: ${ruleId}`)
  return severity
}

export function marksIncomplete(ruleId) {
  return INCOMPLETE_RULES.includes(ruleId)
}
