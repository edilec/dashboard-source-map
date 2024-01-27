/**
 * Ordering, pinned behaviourally.
 *
 * A source grep for `.localeCompare(` is not a determinism test: substituting
 * `Intl.Collator` produces identical collation drift with different source
 * text, so the grep passes while ordering silently becomes machine-dependent.
 *
 * These inputs are chosen so that code-unit order and collation order genuinely
 * disagree -- `Z` before `a`, `a-b` before `a_b`, `README` before `assets` --
 * and they are driven through the real report path and the real written map.
 * Substituting a collator for `byCodeUnit` makes every one of these fail.
 *
 * Filesystem enumeration order is the other half: the directory listing is
 * sorted before anything is read, so the order files happen to come back in
 * never reaches the output.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import { byCodeUnit } from '../src/index.mjs'
import { dashboard, freshness, map, modelExport, temporary, tree, writeJson } from './support.mjs'

const NAMES = ['a_b', 'Z', 'assets', 'a-b', 'README', 'a']
// Bare: 'a' is a prefix of 'a-b', so it sorts first.
const BY_CODE_UNIT = ['README', 'Z', 'a', 'a-b', 'a_b', 'assets']
// With the extension the fourth character decides: '-' (0x2D) before '.' (0x2E).
const BY_CODE_UNIT_FILES = ['README.json', 'Z.json', 'a-b.json', 'a.json', 'a_b.json', 'assets.json']

test('findings are ordered by code unit, which is not the collated order', (t) => {
  const directory = temporary(t)
  tree(directory, { dashboards: {} })
  for (const name of NAMES) {
    writeJson(directory, `dashboards/${name}.json`, { ...dashboard({ dashboardId: name }), format: 'looker.lookml/1' })
  }
  const result = map(directory)
  assert.equal(result.status, 2)
  const files = result.report.findings
    .filter((finding) => finding.ruleId === 'dashboard-format-unsupported')
    .map((finding) => finding.location.file)
  assert.deepEqual(files, BY_CODE_UNIT_FILES.map((name) => `dashboards/${name}`))
  assert.notDeepEqual(files, [...files].sort((left, right) => left.localeCompare(right)))
})

test('tiles are written in code-unit order, whatever order the export declared them in', (t) => {
  const directory = temporary(t)
  tree(directory, {
    dashboards: {
      'd.json': dashboard({
        tiles: NAMES.map((name) => ({ id: name, queryId: 'q' })),
        queries: [{ id: 'q', modelIds: ['finance.arr_monthly'] }],
      }),
    },
    models: modelExport([
      { id: 'finance.arr_monthly', transformation: { id: 'arr-rollup', version: '2.1.0' }, freshness: freshness() },
    ]),
  })
  const result = map(directory, ['--out', join(directory, 'map.json')])
  assert.equal(result.status, 0)
  const written = JSON.parse(readFileSync(join(directory, 'map.json'), 'utf8'))
  assert.deepEqual(written.dashboards[0].tiles.map((tile) => tile.id), BY_CODE_UNIT)
  assert.deepEqual(written.models[0].usedByTiles, BY_CODE_UNIT.map((name) => `revenue-weekly/${name}`))
})

test('models and upstream ids are written in code-unit order', (t) => {
  const directory = temporary(t)
  tree(directory, {
    dashboards: { 'd.json': dashboard({ tiles: [{ id: 't', queryId: 'q' }], queries: [{ id: 'q', modelIds: ['m'] }] }) },
    models: modelExport([
      { id: 'm', upstreamIds: NAMES, transformation: { id: 'r', version: '1' }, freshness: freshness() },
      ...NAMES.map((name) => ({ id: name, freshness: freshness() })),
    ]),
  })
  const result = map(directory, ['--out', join(directory, 'map.json')])
  assert.equal(result.status, 0)
  const written = JSON.parse(readFileSync(join(directory, 'map.json'), 'utf8'))
  assert.deepEqual(written.models.map((model) => model.id), [...BY_CODE_UNIT, 'm'])
  assert.deepEqual(written.models.find((model) => model.id === 'm').upstreamIds, BY_CODE_UNIT)
})

test('byCodeUnit itself disagrees with a collator on exactly these values', () => {
  assert.equal(byCodeUnit('Z', 'a'), -1)
  assert.equal(byCodeUnit('a-b', 'a_b'), -1)
  assert.equal(byCodeUnit('README', 'assets'), -1)
  assert.equal('Z'.localeCompare('a') < 0, false, 'collation would put Z after a')
})
