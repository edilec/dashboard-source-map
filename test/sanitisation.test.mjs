/**
 * The control-character class, tested by CLASS and through an IDENTIFIER.
 *
 * Four tools in this catalog stripped C0 and the line/paragraph separators and
 * let the C1 range through, so U+0085 (NEL) and U+009B (8-bit CSI) still forged
 * lines in a human report and U+202E still reversed displayed text. One
 * sanitised its evidence field carefully and let a page id containing a newline
 * forge whole lines.
 *
 * This tool REFUSES rather than strips, because stripping a character out of a
 * model id would change which model it names. Either way the guarantee is the
 * same and it is asserted on the emitted bytes.
 *
 * No literal control character appears in this file: every one is built from
 * its code point.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { renderable, sanitise } from '../src/index.mjs'
import { dashboard, freshness, map, modelExport, temporary, tree, uniqueRuleIds } from './support.mjs'

const CLASSES = [
  { label: 'C0 U+0001', code: 0x01 },
  { label: 'C0 newline U+000A', code: 0x0a },
  { label: 'C0 tab U+0009', code: 0x09 },
  { label: 'DEL U+007F', code: 0x7f },
  { label: 'C1 NEL U+0085', code: 0x85 },
  { label: 'C1 CSI U+009B', code: 0x9b },
  { label: 'line separator U+2028', code: 0x2028 },
  { label: 'paragraph separator U+2029', code: 0x2029 },
  { label: 'bidi mark U+200E', code: 0x200e },
  { label: 'bidi override U+202E', code: 0x202e },
  { label: 'bidi isolate U+2066', code: 0x2066 },
]

for (const { label, code } of CLASSES) {
  test(`${label} arriving through a DASHBOARD IDENTIFIER is refused and never reaches the output`, (t) => {
    const directory = temporary(t)
    const character = String.fromCharCode(code)
    tree(directory, { dashboards: { 'd.json': dashboard({ dashboardId: `revenue${character}weekly` }) } })

    const result = map(directory)
    assert.equal(result.status, 2)
    assert.equal(result.report.status, 'incomplete')
    assert.deepEqual(uniqueRuleIds(result.report), ['dashboard-invalid', 'no-dashboard-read'])
    const finding = result.report.findings.find((entry) => entry.ruleId === 'dashboard-invalid')
    assert.equal(finding.location.pointer, '/dashboardId')
    assert.match(finding.message, /control, bidi or line-separator character/)
    const forged = `revenue${character}weekly`
    assert.ok(!result.stdout.includes(forged), 'the identifier must not be reproduced on stdout')
    assert.ok(!result.stderr.includes(forged), 'the identifier must not be reproduced on stderr')
    if (code !== 0x0a) {
      assert.ok(!result.stdout.includes(character), 'the character must not reach stdout')
      assert.ok(!result.stderr.includes(character), 'the character must not reach stderr')
    }
  })

  test(`${label} is removed by sanitise()`, () => {
    assert.equal(sanitise(`a${String.fromCharCode(code)}b`), 'ab')
  })
}

test('a model id carrying a control character is refused with its own pointer', (t) => {
  const directory = temporary(t)
  tree(directory, {
    models: modelExport([
      { id: `finance${String.fromCharCode(0x202e)}arr`, freshness: freshness() },
    ]),
  })
  const result = map(directory)
  assert.equal(result.status, 2)
  const finding = result.report.findings.find((entry) => entry.ruleId === 'models-invalid')
  assert.equal(finding.location.pointer, '/models/0/id')
  assert.match(finding.message, /would render as something else/)
})

test('an unsupported format string carrying a control character is excerpted, not echoed', (t) => {
  const directory = temporary(t)
  const nel = String.fromCharCode(0x85)
  tree(directory, {
    dashboards: { 'd.json': { ...dashboard(), format: `looker${nel}lookml/1` } },
  })
  const result = map(directory)
  assert.equal(result.status, 2)
  const finding = result.report.findings.find((entry) => entry.ruleId === 'dashboard-format-unsupported')
  assert.match(finding.message, /"lookerlookml\/1"/, 'the control character is stripped from the excerpt')
  assert.ok(!result.stdout.includes(nel))
  assert.ok(!result.stderr.includes(nel))
})

test('renderable() answers about the RENDERED form, which trim() does not', () => {
  const onlyControls = `${String.fromCharCode(0x01)}${String.fromCharCode(0x200e)}`
  assert.equal(onlyControls.trim().length > 0, true, 'trim removes ECMAScript whitespace only')
  assert.equal(renderable(onlyControls), null)
  assert.equal(renderable('finance.arr'), 'finance.arr')
  assert.equal(renderable(''), null)
  assert.equal(renderable(7), null)
})

test('sanitise() refuses a non-string rather than calling String() on it', () => {
  assert.throws(() => sanitise({ toString: {} }), TypeError)
  assert.throws(() => sanitise(null), TypeError)
})

test('a dashboard whose format is an object is refused without stringifying it', (t) => {
  const directory = temporary(t)
  tree(directory, { dashboards: { 'd.json': { ...dashboard(), format: { toString: {} } } } })
  const result = map(directory)
  assert.equal(result.status, 2)
  const finding = result.report.findings.find((entry) => entry.ruleId === 'dashboard-format-undeclared')
  assert.match(finding.message, /declares no format/)
})
