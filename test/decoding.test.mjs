/**
 * STRICT DECODING, AND THE DOCUMENT THAT LEGALLY SAYS U+FFFD.
 *
 * `TextDecoder('utf-8', { fatal: true })` is the whole guard, and nothing in
 * this suite drove it: substituting `fatal: false` left every test green while
 * a dashboard export holding an undecodable byte became `status: "pass"`, exit
 * 0, `source-map-complete`, and a dashboard id silently rewritten with a
 * replacement character. That is contract defect class 1 -- an unknown reported
 * as a pass -- arriving through the decoder.
 *
 * The second test is the other side, and it is the reason the guard cannot be
 * "decode leniently, then look for U+FFFD in the result": a document may
 * legally contain U+FFFD, and such a document is read, mapped and exits 0.
 * A checker that refused it would be raising a finding on correct input.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import { decodeUtf8 } from '../src/index.mjs'
import { dashboard, map, ruleIds, temporary, tree, uniqueRuleIds } from './support.mjs'

const REPLACEMENT = String.fromCharCode(0xfffd)

test('an undecodable byte in a dashboard export is refused, never decoded into a lineage edge', (t) => {
  const directory = temporary(t)
  tree(directory, { dashboards: { 'revenue.json': dashboard() } })
  // 0x80 is a continuation byte with nothing to continue: not valid UTF-8 in
  // any position. It sits inside a JSON string, so a lenient decoder produces
  // a document that parses cleanly and names a dashboard nobody exported.
  const document = Buffer.concat([
    Buffer.from('{"format":"edilec.dashboard/v1","dashboardId":"reven', 'utf8'),
    Buffer.from([0x80]),
    Buffer.from('ue","tiles":[{"id":"t1","queryId":"q1"}],"queries":[{"id":"q1","modelIds":["finance.arr_monthly"]}]}', 'utf8'),
  ])
  writeFileSync(join(directory, 'dashboards', 'undecodable.json'), document)

  const out = join(directory, 'map.json')
  const result = map(directory, ['--out', out])
  assert.equal(result.status, 2)
  assert.equal(result.report.status, 'incomplete')
  const finding = result.report.findings.find((entry) => entry.ruleId === 'dashboard-unreadable')
  assert.equal(finding.location.file, 'dashboards/undecodable.json')
  assert.equal(finding.message, 'this dashboard export is not valid UTF-8')

  const written = JSON.parse(readFileSync(out, 'utf8'))
  assert.deepEqual(written.dashboards.map((entry) => entry.dashboardId), ['revenue-weekly'])
  assert.deepEqual(written.unreadable, [{ file: 'dashboards/undecodable.json', reason: 'unreadable' }])
  assert.ok(!result.stdout.includes(REPLACEMENT), 'no replacement character reaches the report')
  assert.ok(!readFileSync(out, 'utf8').includes(REPLACEMENT), 'no replacement character reaches the map')
})

test('a document that legally contains U+FFFD is read and mapped, not called undecodable', (t) => {
  const directory = temporary(t)
  tree(directory, {
    dashboards: {
      'revenue.json': dashboard({
        title: `Revenue ${REPLACEMENT} weekly`,
        tiles: [{ id: 'tile-arr', title: `ARR ${REPLACEMENT}`, queryId: 'q-arr' }],
        queries: [{ id: 'q-arr', modelIds: ['finance.arr_monthly'] }],
      }),
    },
  })
  const out = join(directory, 'map.json')
  const result = map(directory, ['--out', out])
  assert.equal(result.status, 0, result.stdout)
  assert.equal(result.report.status, 'pass')
  assert.deepEqual(uniqueRuleIds(result.report), ['model-unused', 'source-map-complete'])
  assert.ok(!ruleIds(result.report).includes('dashboard-unreadable'))
  const written = JSON.parse(readFileSync(out, 'utf8'))
  assert.equal(written.dashboards[0].title, `Revenue ${REPLACEMENT} weekly`)
  assert.equal(written.dashboards[0].tiles[0].title, `ARR ${REPLACEMENT}`)
})

test('decodeUtf8 answers from the decoder, never from the decoded text', () => {
  assert.equal(decodeUtf8(Uint8Array.from([0x80])).ok, false)
  assert.equal(decodeUtf8(Uint8Array.from([0xc3, 0x28])).ok, false)
  assert.equal(decodeUtf8(Uint8Array.from([0xed, 0xa0, 0x80])).ok, false, 'a surrogate encoded as UTF-8')
  // The same replacement character, arriving legally as U+FFFD (EF BF BD).
  const legal = decodeUtf8(Uint8Array.from([0xef, 0xbf, 0xbd]))
  assert.equal(legal.ok, true)
  assert.equal(legal.text, REPLACEMENT)
})
