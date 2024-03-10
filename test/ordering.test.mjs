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

import { RULE_SEVERITY, byCodeUnit } from '../src/index.mjs'
import { dashboard, freshness, map, modelExport, temporary, tree, write, writeJson } from './support.mjs'

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

/**
 * The sort calls the three tests above do not reach.
 *
 * A sweep that gave every `byCodeUnit` call site a collator found five that
 * changed real output with the suite green: the directory listing, a query's
 * model references, a model's former ids, the claimants named in an ambiguity
 * message, and the pointer key of the finding comparator. Each one below drives
 * values whose collated order genuinely differs.
 */

test('the directory listing is ordered by code unit before anything is read', (t) => {
  const directory = temporary(t)
  tree(directory, { dashboards: {} })
  for (const name of NAMES) {
    writeJson(directory, `dashboards/${name}.json`, dashboard({
      dashboardId: name,
      tiles: [{ id: 't', queryId: 'q' }],
      queries: [{ id: 'q', modelIds: ['finance.arr_monthly'] }],
    }))
    write(directory, `dashboards/${name}.md`, 'notes\n')
  }
  const result = map(directory, ['--out', join(directory, 'map.json')])
  assert.equal(result.status, 0, result.stdout)
  const written = JSON.parse(readFileSync(join(directory, 'map.json'), 'utf8'))
  assert.deepEqual(
    written.dashboards.map((entry) => entry.file),
    BY_CODE_UNIT_FILES.map((name) => `dashboards/${name}`),
  )
  assert.deepEqual(
    written.skipped.map((entry) => entry.file),
    ['README', 'Z', 'a-b', 'a', 'a_b', 'assets'].map((name) => `dashboards/${name}.md`),
  )
})

test("a query's model references are resolved and written in code-unit order", (t) => {
  const directory = temporary(t)
  tree(directory, {
    dashboards: {
      'd.json': dashboard({
        tiles: [{ id: 't', queryId: 'q' }],
        queries: [{ id: 'q', modelIds: [...NAMES].reverse() }],
      }),
    },
    models: modelExport(NAMES.map((name) => ({ id: name, freshness: freshness() }))),
  })
  const result = map(directory, ['--out', join(directory, 'map.json')])
  assert.equal(result.status, 0, result.stdout)
  const written = JSON.parse(readFileSync(join(directory, 'map.json'), 'utf8'))
  assert.deepEqual(written.dashboards[0].tiles[0].models.map((model) => model.requestedId), BY_CODE_UNIT)
})

test("a model's former ids are written in code-unit order", (t) => {
  const directory = temporary(t)
  tree(directory, {
    dashboards: { 'd.json': dashboard({ tiles: [{ id: 't', queryId: 'q' }], queries: [{ id: 'q', modelIds: ['m'] }] }) },
    models: modelExport([{ id: 'm', previousIds: [...NAMES].reverse(), freshness: freshness() }]),
  })
  const result = map(directory, ['--out', join(directory, 'map.json')])
  assert.equal(result.status, 0, result.stdout)
  const written = JSON.parse(readFileSync(join(directory, 'map.json'), 'utf8'))
  assert.deepEqual(written.models[0].previousIds, BY_CODE_UNIT)
})

test('the claimants of an ambiguous former id are named in code-unit order', (t) => {
  const directory = temporary(t)
  tree(directory, {
    dashboards: { 'd.json': dashboard({ tiles: [{ id: 't', queryId: 'q' }], queries: [{ id: 'q', modelIds: ['a'] }] }) },
    models: modelExport([
      { id: 'a', previousIds: ['legacy'], freshness: freshness() },
      { id: 'Z', previousIds: ['legacy'], freshness: freshness() },
    ]),
  })
  const result = map(directory)
  assert.equal(result.status, 2)
  const finding = result.report.findings.find((entry) => entry.ruleId === 'rename-ambiguous')
  assert.equal(
    finding.message,
    '"legacy" is claimed as a former id by "Z" and "a", so references to it are not resolved either way',
  )
})

test('findings differing only in their pointer are ordered by code unit', (t) => {
  const directory = temporary(t)
  tree(directory, {
    dashboards: {
      'd.json': dashboard({
        tiles: NAMES.map((name) => ({ id: name, queryId: 'gone' })),
        queries: [{ id: 'q', modelIds: ['finance.arr_monthly'] }],
      }),
    },
  })
  const result = map(directory)
  assert.equal(result.status, 1)
  const pointers = result.report.findings
    .filter((finding) => finding.ruleId === 'query-missing')
    .map((finding) => finding.location.pointer)
  assert.deepEqual(pointers, BY_CODE_UNIT.map((name) => `/tiles/${name}`))
  assert.notDeepEqual(pointers, [...pointers].sort((left, right) => left.localeCompare(right)))
})

test('findings sharing a file, a pointer and a rule are ordered by message, not by declaration', (t) => {
  const directory = temporary(t)
  tree(directory, {
    dashboards: {
      'd.json': dashboard({
        tiles: [{ id: 't', queryId: 'q' }],
        queries: [{
          id: 'q',
          unresolvedSources: [
            { reason: 'zeta: the table name is built at run time' },
            { reason: 'alpha: the warehouse is chosen by a variable' },
          ],
        }],
      }),
    },
  })
  const result = map(directory)
  assert.equal(result.status, 2)
  const messages = result.report.findings
    .filter((finding) => finding.ruleId === 'query-source-unresolved')
    .map((finding) => finding.message)
  assert.equal(messages.length, 2)
  assert.match(messages[0], /alpha: the warehouse is chosen by a variable/)
  assert.match(messages[1], /zeta: the table name is built at run time/)
})

/**
 * The one ordering call site no input can discriminate, named rather than
 * claimed.
 *
 * `byCodeUnit(left.ruleId, right.ruleId)` decides the order of two findings
 * that share a file and a pointer. Substituting a collator there changes
 * nothing, and it is not because the site is unimportant: NO TWO RULE IDS IN
 * THE FROZEN TABLE ARE ORDERED DIFFERENTLY by code unit and by collation, so
 * there is no input to build a behavioural test out of. The same holds for the
 * summary keys the human summary orders.
 *
 * That is a property of today's id set, not of the comparator, so this test
 * fails the moment a rule id or a summary key is added that collation would
 * order differently -- at which point the pair it names is exactly the input a
 * behavioural test needs.
 */
test('no rule id or summary key can discriminate code-unit ordering from collation today', (t) => {
  const collator = new Intl.Collator('en')
  const disagreeing = (values) => {
    const pairs = []
    for (let index = 0; index < values.length; index += 1) {
      for (let other = index + 1; other < values.length; other += 1) {
        const [left, right] = [values[index], values[other]]
        if (Math.sign(byCodeUnit(left, right)) !== Math.sign(collator.compare(left, right))) {
          pairs.push([left, right])
        }
      }
    }
    return pairs
  }
  assert.deepEqual(
    disagreeing(Object.keys(RULE_SEVERITY)),
    [],
    'a rule id pair that collation orders differently: pin the finding order with it',
  )

  const directory = temporary(t)
  tree(directory)
  const result = map(directory)
  assert.deepEqual(
    disagreeing(Object.keys(result.report.summary)),
    [],
    'a summary key pair that collation orders differently: pin the human summary with it',
  )
  // The comparator these values cannot discriminate is still the one in use.
  assert.deepEqual(disagreeing(NAMES).length > 0, true, 'the NAMES above do discriminate')
})
