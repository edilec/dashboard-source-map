/**
 * Severity, pinned BEHAVIOURALLY.
 *
 * A frozen table asserted against a hand-written expected map in the tests is
 * defended by declarations agreeing with each other, and a coordinated edit of
 * all of them passes: one tool had 40 of 52 error rules survive exactly that
 * flip. Severity is not a label, it is the exit code -- so each class is driven
 * through the real CLI and the observable outcome is asserted.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import { RULE_SEVERITY, severityOf } from '../src/index.mjs'
import { dashboard, freshness, map, modelExport, ruleIds, temporary, tree } from './support.mjs'

test('an info-only report is status pass and exit 0', (t) => {
  const directory = temporary(t)
  tree(directory)
  const result = map(directory)
  assert.deepEqual(result.report.findings.map((finding) => finding.severity), ['info'])
  assert.equal(result.report.status, 'pass')
  assert.equal(result.status, 0)
})

test('a warning finding that is not missing evidence is still status pass and exit 0', (t) => {
  const directory = temporary(t)
  tree(directory, {
    models: modelExport([
      { id: 'finance.arr_by_month', previousIds: ['finance.arr_monthly'], freshness: freshness() },
      { id: 'finance.churn_monthly', freshness: freshness() },
    ]),
  })
  const result = map(directory)
  assert.equal(result.report.summary.warnings, 1)
  assert.equal(result.report.summary.errors, 0)
  assert.equal(result.report.status, 'pass')
  assert.equal(result.status, 0, 'a recorded rename is visible, not fatal')
})

test('an error finding with no missing evidence is status fail and exit 1', (t) => {
  const directory = temporary(t)
  tree(directory, {
    models: modelExport([{ id: 'finance.churn_monthly', freshness: freshness() }]),
  })
  const result = map(directory)
  assert.ok(ruleIds(result.report).includes('model-missing'))
  assert.equal(result.report.status, 'fail')
  assert.equal(result.status, 1, 'model-missing must be an error, which is an exit code')
})

test('a warning finding with missing evidence is status incomplete and exit 2', (t) => {
  const directory = temporary(t)
  tree(directory, {
    dashboards: {
      'd.json': dashboard({
        tiles: [{ id: 't', queryId: 'q' }],
        queries: [{ id: 'q', modelIds: ['finance.arr_monthly'], unresolvedSources: [{ reason: 'built at run time' }] }],
      }),
    },
  })
  const result = map(directory)
  assert.equal(result.report.summary.errors, 0, 'nothing here is an error')
  assert.equal(result.report.summary.warnings, 1)
  assert.equal(result.report.status, 'incomplete')
  assert.equal(result.status, 2, 'the incomplete flag is the only thing preventing exit 0 here')
})

test('incomplete outranks fail: a run with both exits 2', (t) => {
  const directory = temporary(t)
  tree(directory, {
    dashboards: {
      'good.json': dashboard(),
      'legacy.json': { ...dashboard({ dashboardId: 'legacy' }), format: 'looker.lookml/1' },
    },
    models: modelExport([{ id: 'finance.churn_monthly', freshness: freshness() }]),
  })
  const result = map(directory)
  assert.ok(ruleIds(result.report).includes('model-missing'))
  assert.ok(ruleIds(result.report).includes('dashboard-format-unsupported'))
  assert.ok(result.report.summary.errors >= 2)
  assert.equal(result.report.status, 'incomplete')
  assert.equal(result.status, 2)
})

test('every emitted finding takes its severity from the frozen table', (t) => {
  const directory = temporary(t)
  tree(directory, {
    dashboards: {
      'good.json': dashboard(),
      'legacy.json': { ...dashboard({ dashboardId: 'legacy' }), format: 'looker.lookml/1' },
    },
    models: modelExport([{ id: 'finance.arr_monthly' }, { id: 'finance.churn_monthly', freshness: freshness() }]),
  })
  const result = map(directory)
  for (const finding of result.report.findings) {
    assert.equal(finding.severity, severityOf(finding.ruleId))
  }
})

test('an unknown rule id throws rather than defaulting to a severity', () => {
  assert.throws(() => severityOf('no-such-rule'), /unknown ruleId/)
})

test('the README rule table and the frozen table agree in BOTH directions', () => {
  const readme = readFileSync(join(import.meta.dirname, '..', 'README.md'), 'utf8')
  const documented = new Map()
  for (const line of readme.split('\n')) {
    const match = /^\| `([a-z-]+)` \| (error|warning|info) \| /.exec(line)
    if (match !== null) documented.set(match[1], match[2])
  }
  assert.deepEqual([...documented.keys()].sort(), Object.keys(RULE_SEVERITY).sort())
  for (const [ruleId, severity] of documented) assert.equal(severity, RULE_SEVERITY[ruleId], ruleId)
})

test('the rule table is frozen', () => {
  assert.equal(Object.isFrozen(RULE_SEVERITY), true)
})
