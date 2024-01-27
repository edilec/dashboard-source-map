/**
 * Every declared bound, from BOTH sides.
 *
 * Across the last batch every documented limit was driven only from the N+1
 * side, so widening any comparison by one started refusing documents sitting
 * exactly on a legal limit with the whole suite green -- 20 silent mutations in
 * one tool and 17 in another. "Fires at N+1" and "silent at N" are two
 * assertions, and the second is the one users notice.
 *
 * The bounds are enforced BEFORE the work: the directory listing is counted
 * before a file is opened, each document's size comes from `stat` before its
 * bytes are read, and every count is checked against the parsed document before
 * the map is built.
 */

import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import { LIMITS } from '../src/index.mjs'
import {
  dashboard, freshness, map, modelExport, ruleIds, temporary, tree, uniqueRuleIds, write, writeJson,
} from './support.mjs'

function oneModel(id = 'finance.arr_monthly', extra = {}) {
  return { id, transformation: { id: 'arr-rollup', version: '2.1.0' }, freshness: freshness(), ...extra }
}

function tiles(count) {
  return {
    format: 'edilec.dashboard/v1',
    dashboardId: 'd',
    tiles: Array.from({ length: count }, (unused, index) => ({ id: `t-${index}`, queryId: 'q' })),
    queries: [{ id: 'q', modelIds: ['finance.arr_monthly'] }],
  }
}

test('maxDocumentBytes: a document of exactly the limit is read, one byte over is refused', (t) => {
  const directory = temporary(t)
  tree(directory, { dashboards: { 'revenue.json': dashboard() }, models: modelExport() })
  const size = statSync(join(directory, 'dashboards/revenue.json')).size

  const exact = map(directory, ['--max-document-bytes', String(size)])
  assert.equal(exact.status, 0, 'a document sitting exactly on the limit is legal')

  const over = map(directory, ['--max-document-bytes', String(size - 1)])
  assert.equal(over.status, 2)
  assert.ok(ruleIds(over.report).includes('models-unreadable') || ruleIds(over.report).includes('dashboard-unreadable'))
  assert.match(JSON.stringify(over.report.findings), new RegExp(`over the document limit of ${size - 1}`))
})

test('maxDirectoryEntries: exactly the limit is listed, one more is refused', (t) => {
  const directory = temporary(t)
  tree(directory)
  write(directory, 'dashboards/NOTES.md', 'notes\n')
  write(directory, 'dashboards/MORE.md', 'more\n')

  const exact = map(directory, ['--max-directory-entries', '3'])
  assert.equal(exact.status, 0, 'a directory sitting exactly on the limit is legal')
  assert.equal(exact.report.findings.filter((finding) => finding.ruleId === 'dashboard-file-skipped').length, 2)

  write(directory, 'dashboards/EVEN-MORE.md', 'more still\n')
  const over = map(directory, ['--max-directory-entries', '3'])
  assert.equal(over.status, 2)
  assert.deepEqual(uniqueRuleIds(over.report), ['no-dashboard-read'])
  assert.match(over.report.findings[0].message, /over the directory limit of 3/)
})

test('maxDashboardFiles: exactly the limit is read, one more is refused', (t) => {
  const directory = temporary(t)
  const dashboards = {}
  for (let index = 0; index < 3; index += 1) dashboards[`d${index}.json`] = dashboard({ dashboardId: `d-${index}` })
  tree(directory, { dashboards })

  const exact = map(directory, ['--max-dashboard-files', '3'])
  assert.equal(exact.status, 0)
  assert.equal(exact.report.summary.dashboards, 3)

  writeJson(directory, 'dashboards/d3.json', dashboard({ dashboardId: 'd-3' }))
  const over = map(directory, ['--max-dashboard-files', '3'])
  assert.equal(over.status, 2)
  assert.deepEqual(uniqueRuleIds(over.report), ['no-dashboard-read'])
  assert.match(over.report.findings[0].message, /over the dashboard file limit of 3/)
})

const COUNTS = [
  {
    flag: '--max-tiles',
    rule: 'dashboard-invalid',
    build: (count) => ({ dashboards: { 'd.json': tiles(count) }, models: modelExport([oneModel()]) }),
  },
  {
    flag: '--max-queries',
    rule: 'dashboard-invalid',
    build: (count) => ({
      dashboards: {
        'd.json': {
          format: 'edilec.dashboard/v1',
          dashboardId: 'd',
          tiles: [{ id: 't', queryId: 'q-0' }],
          queries: Array.from({ length: count }, (unused, index) => ({ id: `q-${index}`, modelIds: ['finance.arr_monthly'] })),
        },
      },
      models: modelExport([oneModel()]),
    }),
  },
  {
    flag: '--max-models',
    rule: 'models-invalid',
    build: (count) => ({
      dashboards: { 'd.json': tiles(1) },
      models: modelExport([
        oneModel(),
        ...Array.from({ length: count - 1 }, (unused, index) => oneModel(`extra.${index}`)),
      ]),
    }),
  },
  {
    flag: '--max-query-references',
    rule: 'dashboard-invalid',
    build: (count) => ({
      dashboards: {
        'd.json': {
          format: 'edilec.dashboard/v1',
          dashboardId: 'd',
          tiles: [{ id: 't', queryId: 'q' }],
          queries: [{
            id: 'q',
            modelIds: Array.from({ length: count }, (unused, index) => `m.${index}`),
          }],
        },
      },
      models: modelExport(Array.from({ length: 8 }, (unused, index) => oneModel(`m.${index}`))),
    }),
  },
  {
    flag: '--max-upstream-ids',
    rule: 'models-invalid',
    build: (count) => ({
      dashboards: { 'd.json': tiles(1) },
      models: modelExport([
        oneModel('finance.arr_monthly', {
          upstreamIds: Array.from({ length: count }, (unused, index) => `raw.${index}`),
        }),
        ...Array.from({ length: 8 }, (unused, index) => oneModel(`raw.${index}`)),
      ]),
    }),
  },
  {
    flag: '--max-previous-ids',
    rule: 'models-invalid',
    build: (count) => ({
      dashboards: { 'd.json': tiles(1) },
      models: modelExport([
        oneModel('finance.arr_monthly', {
          previousIds: Array.from({ length: count }, (unused, index) => `old.${index}`),
        }),
      ]),
    }),
  },
]

for (const bound of COUNTS) {
  test(`${bound.flag}: exactly the limit is accepted and one over is refused`, (t) => {
    const directory = temporary(t)
    tree(directory, bound.build(3))
    const exact = map(directory, [bound.flag, '3'])
    assert.ok(
      exact.status === 0 || exact.status === 1,
      `${bound.flag} refused a document sitting exactly on the limit (status ${exact.status})`,
    )
    assert.ok(!uniqueRuleIds(exact.report).includes(bound.rule), `${bound.flag} raised ${bound.rule} at exactly the limit`)

    const overDirectory = temporary(t)
    tree(overDirectory, bound.build(4))
    const over = map(overDirectory, [bound.flag, '3'])
    assert.equal(over.status, 2)
    assert.equal(over.report.status, 'incomplete')
    assert.ok(uniqueRuleIds(over.report).includes(bound.rule))
    assert.match(JSON.stringify(over.report.findings), /over the limit of 3/)
  })
}

test('maxIdentifierChars: an identifier of exactly the limit is accepted, one over is refused', (t) => {
  const exact = temporary(t)
  tree(exact, {
    dashboards: { 'd.json': dashboard({ dashboardId: 'd'.repeat(LIMITS.maxIdentifierChars) }) },
  })
  assert.equal(map(exact).status, 0)

  const over = temporary(t)
  tree(over, {
    dashboards: { 'd.json': dashboard({ dashboardId: 'd'.repeat(LIMITS.maxIdentifierChars + 1) }) },
  })
  const result = map(over)
  assert.equal(result.status, 2)
  assert.deepEqual(uniqueRuleIds(result.report), ['dashboard-invalid', 'no-dashboard-read'])
  const invalid = result.report.findings.find((finding) => finding.ruleId === 'dashboard-invalid')
  assert.equal(invalid.location.pointer, '/dashboardId')
  assert.match(invalid.message, new RegExp(`over the limit of ${LIMITS.maxIdentifierChars}`))
})

test('maxTextChars: a title of exactly the limit is accepted, one over is refused', (t) => {
  const exact = temporary(t)
  tree(exact, { dashboards: { 'd.json': dashboard({ title: 'T'.repeat(LIMITS.maxTextChars) }) } })
  assert.equal(map(exact).status, 0)

  const over = temporary(t)
  tree(over, { dashboards: { 'd.json': dashboard({ title: 'T'.repeat(LIMITS.maxTextChars + 1) }) } })
  const result = map(over)
  assert.equal(result.status, 2)
  const invalid = result.report.findings.find((finding) => finding.ruleId === 'dashboard-invalid')
  assert.equal(invalid.location.pointer, '/title')
  assert.match(invalid.message, new RegExp(`over the limit of ${LIMITS.maxTextChars}`))
})

test('maxFindings: exactly the limit is reported in full, one more says the report is not complete', (t) => {
  const directory = temporary(t)
  tree(directory)
  for (let index = 0; index < 3; index += 1) write(directory, `dashboards/NOTE-${index}.md`, 'notes\n')

  // 3 skipped files plus the completion note = 4 findings.
  const exact = map(directory, ['--max-findings', '4'])
  assert.equal(exact.report.findings.length, 4)
  assert.equal(exact.status, 0)
  assert.ok(!ruleIds(exact.report).includes('finding-limit-reached'))

  write(directory, 'dashboards/NOTE-3.md', 'notes\n')
  const over = map(directory, ['--max-findings', '4'])
  assert.equal(over.status, 2)
  assert.equal(over.report.status, 'incomplete')
  assert.ok(ruleIds(over.report).includes('finding-limit-reached'))
  assert.match(
    over.report.findings.find((finding) => finding.ruleId === 'finding-limit-reached').message,
    /does not describe everything that was observed/,
  )
})

test('the documented defaults are the ones the tool actually uses', () => {
  assert.deepEqual(Object.keys(LIMITS).sort(), [
    'maxDashboardFiles', 'maxDirectoryEntries', 'maxDocumentBytes', 'maxFindings', 'maxIdentifierChars',
    'maxModels', 'maxPreviousIds', 'maxQueries', 'maxQueryReferences', 'maxTextChars', 'maxTiles', 'maxUpstreamIds',
  ])
  const readme = readFileSync(join(import.meta.dirname, '..', 'README.md'), 'utf8')
  for (const [key, value] of Object.entries(LIMITS)) {
    assert.ok(readme.includes(`${key}\` | ${value}`), `README does not document ${key} as ${value}`)
  }
})
