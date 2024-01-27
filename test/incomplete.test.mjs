/**
 * One scenario per rule that marks a run incomplete, each pinning the EXIT CODE.
 *
 * Deleting a single `incomplete = true` elsewhere in this catalog turned exit 2
 * into exit 1 with the whole suite green, and where the accompanying finding is
 * not error severity that flag is the ONLY thing standing between the run and a
 * green exit 0. So each case asserts the exit code, and the warning-severity
 * case also asserts that `errors` is zero -- which is what makes the assertion
 * depend on the flag and nothing else.
 *
 * `freshness-evidence-absent` is deliberately absent from this list, and there
 * is a test below pinning that it does NOT make a run incomplete.
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import { INCOMPLETE_RULES } from '../src/index.mjs'
import { dashboard, freshness, map, modelExport, ruleIds, temporary, tree, write, writeJson } from './support.mjs'

function assertIncomplete(result, ruleId, { errorsExpected }) {
  assert.equal(result.report.status, 'incomplete', `${ruleId} must report incomplete`)
  assert.equal(result.status, 2, `${ruleId} must exit 2`)
  assert.ok(ruleIds(result.report).includes(ruleId), `${ruleId} was not raised`)
  if (!errorsExpected) {
    assert.equal(result.report.summary.errors, 0, `${ruleId}: the incomplete flag is the only thing preventing exit 0`)
  }
}

test('dashboard-unreadable', (t) => {
  const directory = temporary(t)
  tree(directory)
  write(directory, 'dashboards/broken.json', '{ not json')
  assertIncomplete(map(directory), 'dashboard-unreadable', { errorsExpected: true })
})

test('dashboard-format-undeclared', (t) => {
  const directory = temporary(t)
  const undeclared = dashboard({ dashboardId: 'mystery' })
  delete undeclared.format
  tree(directory, { dashboards: { 'good.json': dashboard(), 'mystery.json': undeclared } })
  assertIncomplete(map(directory), 'dashboard-format-undeclared', { errorsExpected: true })
})

test('dashboard-format-unsupported', (t) => {
  const directory = temporary(t)
  tree(directory, {
    dashboards: { 'good.json': dashboard(), 'legacy.json': { ...dashboard({ dashboardId: 'l' }), format: 'looker.lookml/1' } },
  })
  assertIncomplete(map(directory), 'dashboard-format-unsupported', { errorsExpected: true })
})

test('dashboard-invalid', (t) => {
  const directory = temporary(t)
  tree(directory, { dashboards: { 'good.json': dashboard(), 'bad.json': { ...dashboard({ dashboardId: 'b' }), tiles: 7 } } })
  assertIncomplete(map(directory), 'dashboard-invalid', { errorsExpected: true })
})

test('models-unreadable', (t) => {
  const directory = temporary(t)
  tree(directory, { models: null })
  assertIncomplete(map(directory), 'models-unreadable', { errorsExpected: true })
})

test('models-invalid', (t) => {
  const directory = temporary(t)
  tree(directory)
  writeJson(directory, 'models.json', { format: 'edilec.model-export/v1', models: [{ id: 7 }] })
  assertIncomplete(map(directory), 'models-invalid', { errorsExpected: true })
})

test('no-dashboard-read', (t) => {
  const directory = temporary(t)
  tree(directory, { dashboards: { 'legacy.json': { ...dashboard(), format: 'looker.lookml/1' } } })
  assertIncomplete(map(directory), 'no-dashboard-read', { errorsExpected: true })
})

test('rename-ambiguous', (t) => {
  const directory = temporary(t)
  tree(directory, {
    models: modelExport([
      { id: 'a', previousIds: ['finance.arr_monthly'], freshness: freshness() },
      { id: 'b', previousIds: ['finance.arr_monthly'], freshness: freshness() },
      { id: 'finance.churn_monthly', freshness: freshness() },
    ]),
  })
  assertIncomplete(map(directory), 'rename-ambiguous', { errorsExpected: true })
})

test('query-source-unresolved (warning only: the flag is the whole guard)', (t) => {
  const directory = temporary(t)
  tree(directory, {
    dashboards: {
      'd.json': dashboard({
        tiles: [{ id: 't', queryId: 'q' }],
        queries: [{ id: 'q', modelIds: ['finance.arr_monthly'], unresolvedSources: [{ reason: 'built at run time' }] }],
      }),
    },
  })
  assertIncomplete(map(directory), 'query-source-unresolved', { errorsExpected: false })
})

test('finding-limit-reached (warning only: the flag is the whole guard)', (t) => {
  const directory = temporary(t)
  tree(directory)
  for (let index = 0; index < 4; index += 1) write(directory, `dashboards/NOTE-${index}.md`, 'notes\n')
  assertIncomplete(map(directory, ['--max-findings', '2']), 'finding-limit-reached', { errorsExpected: false })
})

test('freshness-evidence-absent does NOT make a run incomplete', (t) => {
  const directory = temporary(t)
  tree(directory, {
    models: modelExport([{ id: 'finance.arr_monthly' }, { id: 'finance.churn_monthly', freshness: freshness() }]),
  })
  const result = map(directory)
  assert.ok(ruleIds(result.report).includes('freshness-evidence-absent'))
  assert.equal(result.report.status, 'pass')
  assert.equal(result.status, 0, 'a declared absence is not evidence this tool failed to obtain')
  assert.ok(!INCOMPLETE_RULES.includes('freshness-evidence-absent'))
})

test('every rule in INCOMPLETE_RULES has a scenario above', () => {
  assert.deepEqual([...INCOMPLETE_RULES].sort(), [
    'dashboard-format-undeclared', 'dashboard-format-unsupported', 'dashboard-invalid', 'dashboard-unreadable',
    'finding-limit-reached', 'models-invalid', 'models-unreadable', 'no-dashboard-read', 'query-source-unresolved',
    'rename-ambiguous',
  ])
})
