/**
 * The canonical serialisation of the written map.
 *
 * A map that is regenerated on every run and committed beside the dashboards is
 * only useful if an unchanged export produces an unchanged file: otherwise every
 * run is a diff and nobody reads them.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import { MAX_DEPTH, canonicalDocument, canonicalJson } from '../src/index.mjs'
import { dashboard, map, temporary, tree } from './support.mjs'

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
