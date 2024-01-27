/**
 * The acceptance criteria, item by item:
 *
 *   "A renamed model makes impacted tiles visible"
 *   "unsupported dashboard formats are reported without guessed lineage"
 *
 * The good case is first, deliberately. A finding raised on correct input is
 * the worst defect a checker can have: a miss leaves you where you were, a
 * false positive sends somebody to fix what was already right, and after that
 * nobody reads the output.
 */

import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  dashboard, freshness, map, modelExport, runJson, ruleIds, temporary, tree, uniqueRuleIds, writeJson,
} from './support.mjs'

test('THE GOOD CASE: a complete pair of exports resolves with nothing to report', (t) => {
  const directory = temporary(t)
  tree(directory)
  const result = map(directory)
  assert.equal(result.status, 0)
  assert.equal(result.report.status, 'pass')
  assert.equal(result.report.summary.errors, 0)
  assert.equal(result.report.summary.warnings, 0)
  assert.deepEqual(ruleIds(result.report), ['source-map-complete'])
  assert.equal(result.report.summary.tiles, 2)
  assert.equal(result.report.summary.broken, 0)
  assert.equal(result.report.summary.unresolvedTiles, 0)
})

test('ACCEPTANCE: a recorded rename resolves, and every impacted tile is named', (t) => {
  const directory = temporary(t)
  tree(directory, {
    models: modelExport([
      {
        id: 'finance.arr_by_month',
        previousIds: ['finance.arr_monthly'],
        transformation: { id: 'arr-rollup', version: '2.2.0' },
        freshness: freshness(),
      },
      { id: 'finance.churn_monthly', transformation: { id: 'churn-rollup', version: '1.4.2' }, freshness: freshness() },
    ]),
  })
  const result = map(directory, ['--out', join(directory, 'map.json')])
  assert.equal(result.status, 0, 'a recorded rename still resolves')
  assert.deepEqual(uniqueRuleIds(result.report), ['model-renamed'])
  const renamed = result.report.findings.find((finding) => finding.ruleId === 'model-renamed')
  assert.equal(renamed.severity, 'warning')
  assert.equal(renamed.location.file, 'dashboards/revenue.json')
  assert.equal(renamed.location.pointer, '/tiles/tile-arr', 'the IMPACTED TILE is named, not just the model')
  assert.match(renamed.message, /former id of "finance\.arr_by_month"/)
  assert.match(renamed.suggestion, /update the query behind "tile-arr"/)

  const written = JSON.parse(readFileSync(join(directory, 'map.json'), 'utf8'))
  const tile = written.dashboards[0].tiles.find((entry) => entry.id === 'tile-arr')
  assert.equal(tile.lineage, 'resolved')
  assert.deepEqual(tile.models.map((entry) => [entry.requestedId, entry.resolvedId, entry.via]), [
    ['finance.arr_monthly', 'finance.arr_by_month', 'previousId'],
  ])
})

test('ACCEPTANCE: a rename nobody recorded is a broken link, and the impacted tile is named', (t) => {
  const directory = temporary(t)
  tree(directory, {
    models: modelExport([
      { id: 'finance.arr_by_month', transformation: { id: 'arr-rollup', version: '2.2.0' }, freshness: freshness() },
      { id: 'finance.churn_monthly', transformation: { id: 'churn-rollup', version: '1.4.2' }, freshness: freshness() },
    ]),
  })
  const result = map(directory)
  assert.equal(result.status, 1)
  assert.equal(result.report.status, 'fail')
  const missing = result.report.findings.find((finding) => finding.ruleId === 'model-missing')
  assert.equal(missing.severity, 'error')
  assert.equal(missing.location.file, 'dashboards/revenue.json')
  assert.equal(missing.location.pointer, '/tiles/tile-arr')
  assert.match(missing.message, /no model with that id and no model claiming it as a former id/)
  assert.equal(result.report.summary.broken, 1)
  // The tile that was not impacted is not reported.
  assert.equal(result.report.findings.filter((finding) => finding.location.pointer === '/tiles/tile-churn').length, 0)
})

test('ACCEPTANCE: an unsupported format is reported BY NAME and contributes no lineage', (t) => {
  const directory = temporary(t)
  tree(directory, {
    dashboards: {
      'revenue.json': dashboard(),
      // A structurally identical document declaring a format this tool cannot
      // read. Everything needed to "guess" an edge is present.
      'legacy.json': {
        ...dashboard({ dashboardId: 'marketing-legacy' }),
        format: 'looker.lookml/1',
        tiles: [{ id: 'tile-spend', title: 'Spend', queryId: 'q-spend' }],
        queries: [{ id: 'q-spend', modelIds: ['marketing.spend_monthly'] }],
      },
    },
    models: modelExport([
      { id: 'finance.arr_monthly', transformation: { id: 'arr-rollup', version: '2.1.0' }, freshness: freshness() },
      { id: 'finance.churn_monthly', transformation: { id: 'churn-rollup', version: '1.4.2' }, freshness: freshness() },
      { id: 'marketing.spend_monthly', transformation: { id: 'spend-rollup', version: '1.0.0' }, freshness: freshness() },
    ]),
  })
  const result = map(directory, ['--out', join(directory, 'map.json')])
  assert.equal(result.status, 2)
  assert.equal(result.report.status, 'incomplete')

  const unsupported = result.report.findings.find((finding) => finding.ruleId === 'dashboard-format-unsupported')
  assert.equal(unsupported.severity, 'error')
  assert.equal(unsupported.location.file, 'dashboards/legacy.json')
  assert.match(unsupported.message, /"looker\.lookml\/1"/, 'reported by the format it declares')
  assert.match(unsupported.message, /No tile, query or model edge is taken from it/)

  // NO GUESSED LINEAGE. The model that only the unsupported export reaches is
  // reported as reached by nothing, and the map holds no tile from that file.
  const written = JSON.parse(readFileSync(join(directory, 'map.json'), 'utf8'))
  assert.deepEqual(written.dashboards.map((entry) => entry.dashboardId), ['revenue-weekly'])
  const spend = written.models.find((entry) => entry.id === 'marketing.spend_monthly')
  assert.deepEqual(spend.usedByTiles, [], 'an edge from an unreadable format is an invented edge')
  assert.deepEqual(written.unsupported, [
    { declaredFormat: 'looker.lookml/1', file: 'dashboards/legacy.json', reason: 'unsupported-format' },
  ])
  assert.ok(ruleIds(result.report).includes('model-unused'))
  // And the dashboards it COULD read are still mapped.
  assert.equal(written.dashboards[0].tiles.length, 2)
})

test('ACCEPTANCE: a dashboard declaring no format at all is treated the same way', (t) => {
  const directory = temporary(t)
  const undeclared = dashboard({ dashboardId: 'no-format' })
  delete undeclared.format
  tree(directory, { dashboards: { 'revenue.json': dashboard(), 'mystery.json': undeclared } })
  const result = map(directory, ['--out', join(directory, 'map.json')])
  assert.equal(result.status, 2)
  assert.equal(result.report.status, 'incomplete')
  const finding = result.report.findings.find((entry) => entry.ruleId === 'dashboard-format-undeclared')
  assert.equal(finding.location.file, 'dashboards/mystery.json')
  assert.match(finding.message, /no lineage is read from it/)
  const written = JSON.parse(readFileSync(join(directory, 'map.json'), 'utf8'))
  assert.deepEqual(written.dashboards.map((entry) => entry.dashboardId), ['revenue-weekly'])
  assert.deepEqual(written.unsupported, [{ declaredFormat: null, file: 'dashboards/mystery.json', reason: 'undeclared-format' }])
})

test('a supported format whose structure is invalid also contributes no lineage', (t) => {
  const directory = temporary(t)
  tree(directory, {
    dashboards: {
      'revenue.json': dashboard(),
      'malformed.json': { format: 'edilec.dashboard/v1', dashboardId: 'malformed', tiles: 'not an array', queries: [] },
    },
  })
  const result = map(directory, ['--out', join(directory, 'map.json')])
  assert.equal(result.status, 2)
  assert.ok(ruleIds(result.report).includes('dashboard-invalid'))
  const written = JSON.parse(readFileSync(join(directory, 'map.json'), 'utf8'))
  assert.deepEqual(written.dashboards.map((entry) => entry.dashboardId), ['revenue-weekly'])
})

test('FLAGSHIP: an ambiguous rename is never reported as a missing model', (t) => {
  const directory = temporary(t)
  tree(directory, {
    models: modelExport([
      {
        id: 'finance.arr_by_month',
        previousIds: ['finance.arr_monthly'],
        transformation: { id: 'arr-rollup', version: '2.2.0' },
        freshness: freshness(),
      },
      {
        id: 'finance.arr_v2',
        previousIds: ['finance.arr_monthly'],
        transformation: { id: 'arr-rollup', version: '3.0.0' },
        freshness: freshness(),
      },
      { id: 'finance.churn_monthly', transformation: { id: 'churn-rollup', version: '1.4.2' }, freshness: freshness() },
    ]),
  })
  const result = map(directory, ['--out', join(directory, 'map.json')])
  assert.equal(result.status, 2, 'an index that cannot answer makes the run incomplete')
  assert.equal(result.report.status, 'incomplete')
  assert.ok(
    !ruleIds(result.report).includes('model-missing'),
    'dropping the ambiguous entry and then saying nothing provides the id is the defect this guards',
  )
  const tileFinding = result.report.findings.find(
    (finding) => finding.ruleId === 'rename-ambiguous' && finding.location.pointer === '/tiles/tile-arr',
  )
  assert.ok(tileFinding !== undefined, 'the impacted tile is named')
  assert.match(tileFinding.message, /claimed as a former id by "finance\.arr_by_month" and "finance\.arr_v2"/)
  const written = JSON.parse(readFileSync(join(directory, 'map.json'), 'utf8'))
  const tile = written.dashboards[0].tiles.find((entry) => entry.id === 'tile-arr')
  assert.equal(tile.lineage, 'unresolved', 'not resolved, and not broken either')
  assert.deepEqual(tile.models, [])
  assert.equal(tile.unresolved[0].reason, 'rename-ambiguous')
})

test('a former id that is also a live model id is ambiguous, not resolved to either', (t) => {
  const directory = temporary(t)
  tree(directory, {
    models: modelExport([
      { id: 'finance.arr_monthly', transformation: { id: 'arr-rollup', version: '2.1.0' }, freshness: freshness() },
      {
        id: 'finance.arr_by_month',
        previousIds: ['finance.arr_monthly'],
        transformation: { id: 'arr-rollup', version: '2.2.0' },
        freshness: freshness(),
      },
      { id: 'finance.churn_monthly', transformation: { id: 'churn-rollup', version: '1.4.2' }, freshness: freshness() },
    ]),
  })
  const result = map(directory)
  assert.equal(result.status, 2)
  assert.ok(ruleIds(result.report).includes('rename-ambiguous'))
  assert.ok(!ruleIds(result.report).includes('model-renamed'), 'a live id must not silently win the collision')
})

test('WITHOUT A MODEL EXPORT, no tile is called broken', (t) => {
  const directory = temporary(t)
  tree(directory, { models: null })
  const result = map(directory, ['--out', join(directory, 'map.json')])
  assert.equal(result.status, 2)
  assert.equal(result.report.status, 'incomplete')
  assert.deepEqual(uniqueRuleIds(result.report), ['models-unreadable'])
  assert.ok(
    !ruleIds(result.report).includes('model-missing'),
    'reporting every tile as broken because the index failed to load is a finding raised on correct input',
  )
  const written = JSON.parse(readFileSync(join(directory, 'map.json'), 'utf8'))
  for (const tile of written.dashboards[0].tiles) {
    assert.equal(tile.lineage, 'unresolved')
    assert.deepEqual(tile.unresolved, [{ reason: 'model-export-unavailable' }])
    assert.deepEqual(tile.models, [])
  }
  assert.deepEqual(written.models, [])
})

test('a tile naming a query the dashboard does not declare is a broken link', (t) => {
  const directory = temporary(t)
  tree(directory, {
    dashboards: {
      'revenue.json': dashboard({
        tiles: [{ id: 'tile-arr', title: 'ARR', queryId: 'q-gone' }],
      }),
    },
  })
  const result = map(directory, ['--out', join(directory, 'map.json')])
  assert.equal(result.status, 1)
  const finding = result.report.findings.find((entry) => entry.ruleId === 'query-missing')
  assert.equal(finding.location.pointer, '/tiles/tile-arr')
  assert.match(finding.message, /declares no such query/)
  const written = JSON.parse(readFileSync(join(directory, 'map.json'), 'utf8'))
  assert.equal(written.dashboards[0].tiles[0].lineage, 'broken')
})

test('a query that declares an unresolved source makes the tile unresolved, not fine', (t) => {
  const directory = temporary(t)
  tree(directory, {
    dashboards: {
      'revenue.json': dashboard({
        tiles: [{ id: 'tile-arr', title: 'ARR', queryId: 'q-arr' }],
        queries: [{
          id: 'q-arr',
          modelIds: ['finance.arr_monthly'],
          unresolvedSources: [{ reason: 'the query builds its table name at run time' }],
        }],
      }),
    },
  })
  const result = map(directory, ['--out', join(directory, 'map.json')])
  assert.equal(result.status, 2)
  assert.equal(result.report.status, 'incomplete')
  assert.ok(ruleIds(result.report).includes('query-source-unresolved'))
  const written = JSON.parse(readFileSync(join(directory, 'map.json'), 'utf8'))
  const tile = written.dashboards[0].tiles[0]
  assert.equal(tile.lineage, 'unresolved')
  // The part that DID resolve is still recorded: an unresolved source does not
  // erase the models the query does name.
  assert.deepEqual(tile.models.map((entry) => entry.resolvedId), ['finance.arr_monthly'])
  assert.equal(tile.unresolved[0].reason, 'query-source-unresolved')
})

test('a model with no declared freshness is an explicit unknown, never an omission', (t) => {
  const directory = temporary(t)
  tree(directory, {
    models: modelExport([
      { id: 'finance.arr_monthly', transformation: { id: 'arr-rollup', version: '2.1.0' } },
      { id: 'finance.churn_monthly', transformation: { id: 'churn-rollup', version: '1.4.2' }, freshness: freshness() },
    ]),
  })
  const result = map(directory, ['--out', join(directory, 'map.json')])
  assert.equal(result.status, 0, 'a declared absence of freshness is not missing evidence; the export was read in full')
  assert.equal(result.report.status, 'pass')
  assert.ok(ruleIds(result.report).includes('freshness-evidence-absent'))
  const written = JSON.parse(readFileSync(join(directory, 'map.json'), 'utf8'))
  const model = written.models.find((entry) => entry.id === 'finance.arr_monthly')
  assert.deepEqual(model.freshness, { reason: 'no-evidence-declared', state: 'unknown' })
  const tile = written.dashboards[0].tiles.find((entry) => entry.id === 'tile-arr')
  assert.deepEqual(tile.models[0].freshness, { reason: 'no-evidence-declared', state: 'unknown' })
})

test('a model whose upstream nothing declares is a broken link', (t) => {
  const directory = temporary(t)
  tree(directory, {
    models: modelExport([
      {
        id: 'finance.arr_monthly',
        upstreamIds: ['raw.gone'],
        transformation: { id: 'arr-rollup', version: '2.1.0' },
        freshness: freshness(),
      },
      { id: 'finance.churn_monthly', transformation: { id: 'churn-rollup', version: '1.4.2' }, freshness: freshness() },
    ]),
  })
  const result = map(directory)
  assert.equal(result.status, 1)
  const finding = result.report.findings.find((entry) => entry.ruleId === 'upstream-missing')
  assert.equal(finding.location.file, 'models.json')
  assert.equal(finding.location.pointer, '/models/finance.arr_monthly')
})

test('a directory holding no dashboard this tool can read is not a green run', (t) => {
  const directory = temporary(t)
  tree(directory, { dashboards: {} })
  writeJson(directory, 'dashboards/.keep.json', { format: 'looker.lookml/1' })
  const result = map(directory)
  assert.equal(result.status, 2)
  assert.ok(ruleIds(result.report).includes('no-dashboard-read'))
  assert.equal(result.report.summary.dashboards, 0)
})

test('an empty dashboard directory is not a green run either', (t) => {
  const directory = temporary(t)
  tree(directory, { dashboards: {} })
  mkdirSync(join(directory, 'dashboards'), { recursive: true })
  const result = map(directory)
  assert.equal(result.status, 2)
  assert.deepEqual(uniqueRuleIds(result.report), ['no-dashboard-read'])
  assert.equal(result.report.summary.checked, 0)
})
