/**
 * The parse-failure helper.
 *
 * V8 embeds raw input in its parse error message, so the message is untrusted
 * content and this helper is the only thing between a malformed document and
 * the report. The branch ORDER is the whole guard: a helper that looks for
 * `at position N` before recognising the quoting shape finds that text inside
 * the quoted span whenever the document itself contains it, and slices the
 * document straight back out.
 *
 * Nineteen of thirty-eight tools in this catalog shipped that bug. Every group
 * that wrote this test found it; the ones that applied the sketch verbatim did
 * not. The test is what finds it, not the review.
 *
 * A dashboard export is written by somebody else's tool, so a parse failure in
 * one can carry an internal query, a connection label or a customer name back
 * out in the error message. None of it is reproduced.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { UNPARSEABLE, parseFailureDetail } from '../src/parse-failure.mjs'
import { dashboard, map, temporary, tree, write, writeJson } from './support.mjs'

function failureFor(document) {
  try {
    JSON.parse(document)
  } catch (error) {
    return { message: error.message, detail: parseFailureDetail(error) }
  }
  throw new Error('that document parsed')
}

test('a document whose own text reads "at position 1" does not come back out', () => {
  const { message, detail } = failureFor('at position 1')
  assert.match(message, /"at position 1"/, 'V8 quotes the document, which is the trap')
  assert.equal(detail, "unexpected token 'a' at the start of the document")
  assert.ok(!detail.includes('at position 1'))
})

test('a document that is nothing but an internal label is never reproduced', () => {
  const { message, detail } = failureFor('an-internal-query-0000')
  assert.match(message, /an-interna/, 'V8 quotes the document, which is the trap')
  assert.equal(detail, "unexpected token 'a' at the start of the document")
  assert.ok(!detail.includes('internal'))
  assert.ok(!detail.includes('0000'))
})

test('a long document whose quoted window falls on a sensitive span is never reproduced', () => {
  const { message, detail } = failureFor('["dashboard-internal-note-3333", ZQXJVBMP7W]')
  assert.match(message, /te-3333/, 'the window is taken from the offence, not from the start')
  assert.equal(detail, "unexpected token 'Z' inside the document")
  assert.ok(!detail.includes('3333'))
  assert.ok(!detail.includes('internal'))
  assert.ok(!detail.includes('ZQXJVBMP7W'))
})

test('a quoted span containing a newline is still recognised (the s flag)', () => {
  const { message, detail } = failureFor('[\n"line one",\nZQXJVBMP7W\n]')
  assert.ok(message.includes('\n'), 'the quoted span really does carry a newline')
  assert.equal(detail, "unexpected token 'Z' inside the document")
  assert.ok(!detail.includes('line one'))
})

test('the safe positional form still yields its position', () => {
  const { message, detail } = failureFor('{"a": 1 "b": 2}')
  assert.match(message, /at position 8/)
  assert.equal(detail, "Expected ',' or '}' after property value in JSON at position 8 (line 1 column 9)")
})

test('"Unexpected end of JSON input" is kept verbatim: it quotes nothing', () => {
  const { message, detail } = failureFor('{"a":')
  assert.equal(message, 'Unexpected end of JSON input')
  assert.equal(detail, 'Unexpected end of JSON input')
})

test('the backstop refuses any message that still carries a double quote', () => {
  // A wording this helper has never been taught. Across 500,206 distinct V8
  // parse messages, a surviving double quote always meant a surviving snippet.
  const invented = { message: 'Some future wording about "an-internal-secret-4444" that nobody taught this helper' }
  assert.equal(parseFailureDetail(invented), UNPARSEABLE)
})

test('a message with no quote and no position falls back to the generic sentence', () => {
  assert.equal(parseFailureDetail({ message: 'something else entirely' }), UNPARSEABLE)
  assert.equal(parseFailureDetail(undefined), UNPARSEABLE)
})

test('the CLI reports an unparseable dashboard export without echoing it', (t) => {
  const directory = temporary(t)
  tree(directory)
  write(directory, 'dashboards/broken.json', '["an-internal-note-5555", ZQXJVBMP7W]')
  const result = map(directory)
  assert.equal(result.status, 2)
  assert.equal(result.report.status, 'incomplete')
  const finding = result.report.findings.find((entry) => entry.ruleId === 'dashboard-unreadable')
  assert.match(finding.message, /unexpected token 'Z' inside the document/)
  assert.ok(!result.stdout.includes('5555'))
  assert.ok(!result.stderr.includes('5555'))
})

test('the CLI reports an unparseable model export without echoing it', (t) => {
  const directory = temporary(t)
  tree(directory, { models: null })
  writeJson(directory, 'dashboards/revenue.json', dashboard())
  write(directory, 'models.json', 'at position 1')
  const result = map(directory)
  assert.equal(result.status, 2)
  const finding = result.report.findings.find((entry) => entry.ruleId === 'models-unreadable')
  assert.match(finding.message, /at the start of the document/)
  assert.ok(!finding.message.includes('at position 1'))
})
