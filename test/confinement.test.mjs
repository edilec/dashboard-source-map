/**
 * Path confinement for declared inputs.
 *
 * Rejecting "../" and absolute paths is not confinement: a symlink planted
 * inside a declared root was followed out of the tree in another tool here, and
 * out-of-root content was echoed into its report. The REAL path is resolved and
 * compared against the REAL root.
 *
 * A guard that refuses everything is worse than none, so the allowed cases are
 * pinned beside the refused ones.
 */

import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import { dashboard, map, ruleIds, temporary, tree, writeJson } from './support.mjs'

test('a dashboard directory that is a symbolic link out of the root is refused', (t) => {
  const directory = temporary(t)
  const root = join(directory, 'root')
  tree(root)
  const outside = join(directory, 'outside')
  mkdirSync(outside, { recursive: true })
  writeFileSync(join(outside, 'secret.json'), '{"format":"edilec.dashboard/v1"}\n', 'utf8')
  symlinkSync(outside, join(root, 'escape'))

  const result = map(root, ['--dashboards', 'escape'])
  assert.equal(result.status, 2)
  assert.deepEqual(ruleIds(result.report), ['no-dashboard-read'])
  assert.match(result.report.findings[0].message, /resolves outside the declared root/)
  assert.ok(!result.stdout.includes('secret.json'))
})

test('a model export that is a symbolic link out of the root is refused', (t) => {
  const directory = temporary(t)
  const root = join(directory, 'root')
  tree(root, { models: null })
  writeJson(root, 'dashboards/revenue.json', dashboard())
  const outside = join(directory, 'outside-models.json')
  writeFileSync(outside, '{"format":"edilec.model-export/v1","models":[]}\n', 'utf8')
  symlinkSync(outside, join(root, 'models.json'))

  const result = map(root)
  assert.equal(result.status, 2)
  assert.ok(ruleIds(result.report).includes('models-unreadable'))
  assert.match(
    result.report.findings.find((finding) => finding.ruleId === 'models-unreadable').message,
    /resolves outside the declared root/,
  )
  assert.ok(!ruleIds(result.report).includes('model-missing'), 'an unreadable index makes no claim about a tile')
})

test('ALLOWED: a symbolic link that stays inside the root is followed', (t) => {
  const directory = temporary(t)
  tree(directory, { models: null })
  writeJson(directory, 'real-models.json', {
    format: 'edilec.model-export/v1',
    models: [
      { id: 'finance.arr_monthly', freshness: { observedAt: '2026-09-19T02:10:00Z', source: 'load-log' } },
      { id: 'finance.churn_monthly', freshness: { observedAt: '2026-09-19T02:12:00Z', source: 'load-log' } },
    ],
  })
  symlinkSync(join(directory, 'real-models.json'), join(directory, 'models.json'))
  const result = map(directory)
  assert.equal(result.status, 0, 'a link inside the root is an ordinary file')
  assert.deepEqual(ruleIds(result.report), ['source-map-complete'])
})

test('ALLOWED: a dashboard directory nested deeper in the root is read', (t) => {
  const directory = temporary(t)
  tree(directory, { dashboards: {} })
  writeJson(directory, 'exports/boards/revenue.json', dashboard())
  const result = map(directory, ['--dashboards', 'exports/boards'])
  assert.equal(result.status, 0)
  assert.deepEqual(ruleIds(result.report), ['source-map-complete'])
})

test('a dashboard file that is a symbolic link out of the root is refused, and the map does not name it', (t) => {
  const directory = temporary(t)
  const root = join(directory, 'root')
  tree(root)
  const outside = join(directory, 'outside')
  mkdirSync(outside, { recursive: true })
  writeFileSync(
    join(outside, 'OUT.json'),
    `${JSON.stringify({
      format: 'edilec.dashboard/v1',
      dashboardId: 'OUT-OF-ROOT-DASHBOARD',
      tiles: [{ id: 'leaked-tile', queryId: 'q-out' }],
      queries: [{ id: 'q-out', modelIds: ['finance.churn_monthly'] }],
    })}\n`,
    'utf8',
  )
  symlinkSync(join(outside, 'OUT.json'), join(root, 'dashboards', 'planted.json'))

  const out = join(directory, 'map.json')
  const result = map(root, ['--out', out])
  assert.equal(result.status, 2, 'out-of-root content is not evidence about this root')
  assert.equal(result.report.status, 'incomplete')
  assert.ok(ruleIds(result.report).includes('path-outside-root'))
  assert.ok(!result.stdout.includes('OUT-OF-ROOT-DASHBOARD'), 'nothing from outside the root reaches the report')

  const written = JSON.parse(readFileSync(out, 'utf8'))
  assert.deepEqual(
    written.dashboards.map((entry) => entry.dashboardId),
    ['revenue-weekly'],
    'the map lists only dashboards it was allowed to read',
  )
  assert.deepEqual(written.unreadable, [{ file: 'dashboards/planted.json', reason: 'outside-root' }])
  const churn = written.models.find((model) => model.id === 'finance.churn_monthly')
  assert.deepEqual(churn.usedByTiles, ['revenue-weekly/tile-churn'], 'no lineage edge is built from outside the root')
})

test('ALLOWED: a dashboard file that is a symbolic link INSIDE the root is read', (t) => {
  const directory = temporary(t)
  tree(directory)
  writeJson(directory, 'elsewhere/second.json', dashboard({
    dashboardId: 'revenue-monthly',
    tiles: [{ id: 'tile-arr', queryId: 'q-arr' }],
    queries: [{ id: 'q-arr', modelIds: ['finance.arr_monthly'] }],
  }))
  symlinkSync(join(directory, 'elsewhere', 'second.json'), join(directory, 'dashboards', 'linked.json'))
  const result = map(directory)
  assert.equal(result.status, 0, 'a link that stays inside the root is an ordinary file')
  assert.deepEqual(ruleIds(result.report), ['source-map-complete'])
  assert.equal(result.report.summary.dashboards, 2)
})
