/**
 * THE UNIQUENESS AND REQUIRED-KEY GUARDS, AND WHAT GOES WRONG WITHOUT THEM.
 *
 * Deleting the duplicate check in `uniqueIds`, the duplicate check in
 * `identifierList`, or the required-key loop in `checkKeys` left the whole
 * suite green. None of them is cosmetic:
 *
 * - the map keys `models[].usedByTiles` by `dashboardId/tileId`, so two tiles
 *   sharing an id collapse into one entry that cannot be resolved back to a
 *   tile -- the same collision that made two dashboard files claiming one id a
 *   defect;
 * - `queries.find` takes the first match, so two queries sharing an id map every
 *   tile behind the second one to the wrong source, silently;
 * - `live.set` takes the last, so two models sharing an id resolve every
 *   reference to whichever entry happened to come later in the document;
 * - a model claiming one former id twice would otherwise be reported as
 *   `rename-ambiguous` -- "claimed as a former id by X and X" -- which is a
 *   finding raised at error severity on a document whose only fault is a
 *   repeated entry, and it names no second claimant a reader could go and look
 *   at.
 *
 * Each test pins the exact pointers, so an adjacent check reporting the same
 * document for a different reason does not satisfy it.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import { dashboard, freshness, map, modelExport, ruleIds, temporary, tree } from './support.mjs'

/** Every problem of one rule, as the pair a reader would act on. */
function problems(report, ruleId) {
  return report.findings
    .filter((finding) => finding.ruleId === ruleId)
    .map((finding) => ({ pointer: finding.location.pointer, message: finding.message }))
}

test('two tiles in one export sharing an id are refused, not collapsed into one map entry', (t) => {
  const directory = temporary(t)
  tree(directory, {
    dashboards: {
      'revenue.json': dashboard(),
      'duplicate.json': dashboard({
        dashboardId: 'duplicate-tiles',
        tiles: [
          { id: 'tile-arr', queryId: 'q-arr' },
          { id: 'tile-arr', queryId: 'q-churn' },
        ],
      }),
    },
  })
  const out = join(directory, 'map.json')
  const result = map(directory, ['--out', out])
  assert.equal(result.status, 2)
  assert.deepEqual(problems(result.report, 'dashboard-invalid'), [
    { pointer: '/tiles/1/id', message: '/tiles/1/id repeats the tile id "tile-arr"' },
  ])
  const written = JSON.parse(readFileSync(out, 'utf8'))
  assert.deepEqual(written.dashboards.map((entry) => entry.dashboardId), ['revenue-weekly'])
  assert.deepEqual(
    written.models.map((model) => model.usedByTiles),
    [['revenue-weekly/tile-arr'], ['revenue-weekly/tile-churn']],
  )
})

test('two queries in one export sharing an id are refused, not resolved to whichever comes first', (t) => {
  const directory = temporary(t)
  tree(directory, {
    dashboards: {
      'duplicate.json': dashboard({
        tiles: [{ id: 'tile-arr', queryId: 'q-arr' }],
        queries: [
          { id: 'q-arr', modelIds: ['finance.arr_monthly'] },
          { id: 'q-arr', modelIds: ['finance.churn_monthly'] },
        ],
      }),
    },
  })
  const result = map(directory)
  assert.equal(result.status, 2)
  assert.deepEqual(problems(result.report, 'dashboard-invalid'), [
    { pointer: '/queries/1/id', message: '/queries/1/id repeats the query id "q-arr"' },
  ])
})

test('two models sharing an id are refused, and no tile is called broken over it', (t) => {
  const directory = temporary(t)
  tree(directory, {
    models: modelExport([
      { id: 'finance.arr_monthly', transformation: { id: 'v1', version: '1' }, freshness: freshness() },
      { id: 'finance.arr_monthly', transformation: { id: 'v2', version: '2' }, freshness: freshness() },
      { id: 'finance.churn_monthly', freshness: freshness() },
    ]),
  })
  const result = map(directory)
  assert.equal(result.status, 2)
  assert.deepEqual(problems(result.report, 'models-invalid'), [
    { pointer: '/models/1/id', message: '/models/1/id repeats the model id "finance.arr_monthly"' },
  ])
  assert.ok(!ruleIds(result.report).includes('model-missing'), 'an index that was never built claims nothing')
})

test('a model claiming one former id twice is refused, not reported as ambiguous between X and X', (t) => {
  const directory = temporary(t)
  tree(directory, {
    models: modelExport([
      {
        id: 'finance.arr_by_month',
        previousIds: ['finance.arr_monthly', 'finance.arr_monthly'],
        freshness: freshness(),
      },
      { id: 'finance.churn_monthly', freshness: freshness() },
    ]),
  })
  const result = map(directory)
  assert.equal(result.status, 2)
  assert.deepEqual(problems(result.report, 'models-invalid'), [
    { pointer: '/models/0/previousIds/1', message: '/models/0/previousIds/1 repeats "finance.arr_monthly"' },
  ])
  assert.ok(
    !ruleIds(result.report).includes('rename-ambiguous'),
    'one model claiming an id twice is one claimant, and there is no second model to name',
  )
})

test('a query naming one model twice is refused with the position of the repeat', (t) => {
  const directory = temporary(t)
  tree(directory, {
    dashboards: {
      'd.json': dashboard({
        tiles: [{ id: 'tile-arr', queryId: 'q-arr' }],
        queries: [{ id: 'q-arr', modelIds: ['finance.arr_monthly', 'finance.arr_monthly'] }],
      }),
    },
  })
  const result = map(directory)
  assert.equal(result.status, 2)
  assert.deepEqual(problems(result.report, 'dashboard-invalid'), [
    { pointer: '/queries/0/modelIds/1', message: '/queries/0/modelIds/1 repeats "finance.arr_monthly"' },
  ])
})

test('a missing required key is reported as missing, beside whatever the type check says', (t) => {
  const directory = temporary(t)
  const withoutTiles = dashboard({ dashboardId: 'no-tiles' })
  delete withoutTiles.tiles
  tree(directory, { dashboards: { 'd.json': withoutTiles } })
  const result = map(directory)
  assert.equal(result.status, 2)
  // Both, and in this order: the required-key loop runs before the type check,
  // and only the first of the two says which key the document forgot.
  assert.deepEqual(problems(result.report, 'dashboard-invalid'), [
    { pointer: '/tiles', message: '/tiles is required and is missing' },
    { pointer: '/tiles', message: '/tiles must be an array, not undefined' },
  ])
})

test('an undeclared key is refused rather than ignored, so a typo is never a silent omission', (t) => {
  const directory = temporary(t)
  tree(directory, {
    dashboards: {
      'd.json': dashboard({
        tiles: [{ id: 'tile-arr', querryId: 'q-arr' }],
        queries: [{ id: 'q-arr', modelIds: ['finance.arr_monthly'] }],
      }),
    },
  })
  const result = map(directory)
  assert.equal(result.status, 2)
  assert.deepEqual(problems(result.report, 'dashboard-invalid'), [
    {
      pointer: '/tiles/0/querryId',
      message: '/tiles/0/querryId is not a key this schema defines; allowed keys are id, queryId, title',
    },
    { pointer: '/tiles/0/queryId', message: '/tiles/0/queryId is required and is missing' },
    { pointer: '/tiles/0/queryId', message: '/tiles/0/queryId must be a string, not undefined' },
  ])
})

test('ids that are unique stay silent: one id may be a tile, a query and a model at once', (t) => {
  const directory = temporary(t)
  tree(directory, {
    dashboards: {
      'd.json': dashboard({
        tiles: [{ id: 'shared', queryId: 'shared' }],
        queries: [{ id: 'shared', modelIds: ['shared'] }],
      }),
    },
    models: modelExport([{ id: 'shared', freshness: freshness() }]),
  })
  const result = map(directory)
  assert.equal(result.status, 0, result.stdout)
  assert.deepEqual(ruleIds(result.report), ['source-map-complete'])
})
