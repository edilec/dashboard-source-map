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

/**
 * THE BACKSTOP, PINNED BY A MESSAGE THAT REACHES IT.
 *
 * The test above named for the backstop passes without it: the wording it
 * invents matches none of the branches, so `describeParseFailure` returns the
 * generic sentence on its own and the backstop is never consulted. Deleting
 * `detail.includes('"') ? UNPARSEABLE : detail` left the whole suite green --
 * an absence assertion satisfied by a path it was not written to check.
 *
 * A message must reach the POSITION branch AND still carry a quote for the
 * backstop to be the thing that catches it.
 */
test('the backstop catches a leak the POSITION branch would otherwise let through', () => {
  const leaking = { message: 'Unexpected wording about "an-internal-secret-4444" in JSON at position 12' }
  const detail = parseFailureDetail(leaking)
  assert.equal(detail, UNPARSEABLE)
  assert.ok(!detail.includes('4444'), 'the quoted span reached the position branch and was refused after it')
  // Without the backstop this is what the branch above returns.
  assert.match(leaking.message, /at position 12$/, 'the position branch matches, so it is not the fallback answering')
})

/**
 * V8 QUOTES THE OFFENDING CHARACTER, WHATEVER IT IS.
 *
 * `Unexpected token '<char>', "..." is not valid JSON` carries the raw first
 * character of the document, so a dashboard export beginning with U+202E puts
 * a right-to-left override into the detail, into the finding message, and into
 * the human summary. The detail is built from the document; `ReportBuilder.add`
 * sanitising the message is the only thing that strips it, and removing that
 * one call was a silent mutation until this test.
 */
for (const code of [0x01, 0x85, 0x202e, 0x2028]) {
  const point = `U+${code.toString(16).toUpperCase().padStart(4, '0')}`
  test(`a document beginning with ${point} does not put it in the report`, (t) => {
    const character = String.fromCharCode(code)
    assert.ok(
      failureFor(`${character}nonsense`).detail.includes(character),
      'the helper passes the character through: V8 quotes it as the offending token, so it is document text',
    )
    const directory = temporary(t)
    tree(directory)
    write(directory, 'dashboards/broken.json', `${character}nonsense`)
    const result = map(directory)
    assert.equal(result.status, 2)
    const finding = result.report.findings.find((entry) => entry.ruleId === 'dashboard-unreadable')
    assert.match(finding.message, /this dashboard export unexpected token/)
    assert.ok(!finding.message.includes(character), 'the report is sanitised on the way out')
    assert.ok(!result.stdout.includes(character), 'and nothing reaches stdout')
    assert.ok(!result.stderr.includes(character), 'and nothing reaches the human summary')
  })
}
