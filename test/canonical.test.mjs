/**
 * The canonical serialisation of the written map.
 *
 * A map that is regenerated on every run and committed beside the dashboards is
 * only useful if an unchanged export produces an unchanged file: otherwise every
 * run is a diff and nobody reads them.
 */

import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import test from 'node:test'
import assert from 'node:assert/strict'

import { MAX_DEPTH, canonicalDocument, canonicalFailureDetail, canonicalJson } from '../src/index.mjs'
import { ROOT, dashboard, map, runCli, temporary, tree } from './support.mjs'

test('object keys are ordered by code unit, not by insertion order', () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}')
  assert.equal(canonicalJson({ a_b: 1, Z: 2, 'a-b': 3 }), '{"Z":2,"a-b":3,"a_b":1}')
})

test('the indented form carries the same ordering and the same content', () => {
  const value = { b: [1, { d: 4, c: 3 }], a: 'x' }
  assert.equal(canonicalJson(JSON.parse(canonicalDocument(value))), canonicalJson(value))
  assert.match(canonicalDocument(value), /^\{\n {2}"a": "x",\n/)
})

test('a non-finite number has no canonical form', () => {
  assert.throws(() => canonicalJson({ a: Number.POSITIVE_INFINITY }), TypeError)
  assert.throws(() => canonicalJson({ a: Number.NaN }), TypeError)
})

test('nesting past the depth bound throws rather than recursing', () => {
  let value = 'leaf'
  for (let depth = 0; depth <= MAX_DEPTH; depth += 1) value = { nested: value }
  assert.throws(() => canonicalJson(value), new RegExp(`deeper than ${MAX_DEPTH}`))
})

test('declaration order in the export does not change the written map', (t) => {
  const forward = temporary(t)
  tree(forward, {
    dashboards: {
      'd.json': dashboard({
        tiles: [{ id: 'tile-arr', title: 'ARR', queryId: 'q-arr' }, { id: 'tile-churn', title: 'Churn rate', queryId: 'q-churn' }],
      }),
    },
  })
  const reversed = temporary(t)
  tree(reversed, {
    dashboards: {
      'd.json': dashboard({
        tiles: [{ id: 'tile-churn', title: 'Churn rate', queryId: 'q-churn' }, { id: 'tile-arr', title: 'ARR', queryId: 'q-arr' }],
      }),
    },
  })
  assert.equal(map(forward, ['--out', join(forward, 'map.json')]).status, 0)
  assert.equal(map(reversed, ['--out', join(reversed, 'map.json')]).status, 0)
  assert.equal(
    readFileSync(join(reversed, 'map.json'), 'utf8'),
    readFileSync(join(forward, 'map.json'), 'utf8'),
  )
})

test('the written map ends in a newline and parses as JSON', (t) => {
  const directory = temporary(t)
  tree(directory)
  assert.equal(map(directory, ['--out', join(directory, 'map.json')]).status, 0)
  const text = readFileSync(join(directory, 'map.json'), 'utf8')
  assert.equal(text.endsWith('\n'), true)
  assert.equal(typeof JSON.parse(text), 'object')
})

/**
 * SERIALISING AND WRITING FAIL FOR UNRELATED REASONS.
 *
 * Both calls sat inside one `try`, so a map too large for a single JavaScript
 * string -- reachable by raising `--max-tile-model-edges` -- was reported as
 * `--out could not be written (unknown error)`: the wrong act, and nothing the
 * reader can act on. Measured before the split, on a tree of two million edges:
 * exit 2, empty stdout, that exact sentence, after 131 s of work that had in
 * fact succeeded.
 *
 * The size case cannot be driven from a test suite -- it needs a map of half a
 * gigabyte -- so what is pinned here is the message for each cause, and the
 * write failure is driven end to end through the real CLI.
 */

test('a map larger than one string says so, and says which limit to lower', () => {
  const detail = canonicalFailureDetail(new RangeError('Invalid string length'))
  assert.equal(
    detail,
    'the map is larger than one JavaScript string can hold; lower --max-tile-model-edges and run again',
  )
})

test('any other serialisation failure reports its own cause, sanitised and bounded', () => {
  assert.equal(canonicalFailureDetail(new TypeError('a value of type function has no canonical form')),
    'a value of type function has no canonical form')
  assert.equal(
    canonicalFailureDetail(new TypeError(`forged${String.fromCharCode(0x0a)}ERROR line`)),
    'forgedERROR line',
  )
  assert.equal(canonicalFailureDetail(new TypeError('x'.repeat(300))).length, 160)
  // A diagnostic path that throws turns a bad value into a stack trace.
  assert.equal(canonicalFailureDetail({ message: { toString: {} } }), 'unknown error')
  assert.equal(canonicalFailureDetail(undefined), 'unknown error')
})

test('an unwritable destination is exit 2 with an empty stdout and the errno, not a stack trace', (t) => {
  if (process.getuid !== undefined && process.getuid() === 0) {
    t.skip('running as root: no destination is unwritable')
    return
  }
  const directory = temporary(t)
  const root = join(directory, 'root')
  tree(root)
  const out = join(directory, 'map.json')
  writeFileSync(out, 'not mine\n', 'utf8')
  chmodSync(out, 0o444)

  const result = runCli(['--root', root, '--out', out, '--quiet'])
  chmodSync(out, 0o644)
  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, 'dashboard-source-map: --out could not be written (EACCES)\n')
  assert.ok(!result.stderr.includes(ROOT), 'no absolute host path, and no stack trace')
  assert.equal(readFileSync(out, 'utf8'), 'not mine\n')
})
