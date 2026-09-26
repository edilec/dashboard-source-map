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

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { renderable, sanitise } from '../src/index.mjs'
import { dashboard, freshness, map, modelExport, runCli, temporary, tree, uniqueRuleIds } from './support.mjs'

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

/**
 * THE WRITTEN MAP IS EMITTED BYTES TOO.
 *
 * The header above says the guarantee is asserted on the emitted bytes, and for
 * a long while these bodies read only stdout and stderr. The artefact a
 * consumer of this tool actually keeps is the file named by `--out`, it is
 * serialised with `JSON.stringify`, and `JSON.stringify` escapes neither the C1
 * range nor U+2028/U+2029 nor any bidi control. Two fields reached it raw: the
 * `declaredFormat` of an unsupported export, and every `file` path, which comes
 * from the directory listing and had never been validated.
 */

const CLASS_CODES = [
  0x00, 0x01, 0x09, 0x0a, 0x1f, 0x7f, 0x85, 0x9b, 0x200e, 0x200f, 0x202a, 0x202e, 0x2066, 0x2069,
  0x2028, 0x2029,
]

function classCharactersIn(text) {
  return [...new Set([...text].filter((character) => CLASS_CODES.includes(character.codePointAt(0))))]
    .map((character) => character.codePointAt(0))
    .sort((left, right) => left - right)
}

function everyString(value, found = []) {
  if (typeof value === 'string') found.push(value)
  else if (Array.isArray(value)) for (const item of value) everyString(item, found)
  else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      found.push(key)
      everyString(item, found)
    }
  }
  return found
}

test('the written map carries no character of the class, in a path or in a declared format', (t) => {
  const directory = temporary(t)
  const nel = String.fromCharCode(0x85)
  const override = String.fromCharCode(0x202e)
  const separator = String.fromCharCode(0x2028)
  tree(directory, {
    dashboards: {
      'revenue.json': dashboard(),
      'unsupported.json': { ...dashboard(), format: `looker${nel}lookml/1${override}${separator}` },
      [`hidden${override}${nel}.json`]: dashboard({ dashboardId: 'planted' }),
      [`notes${override}.md`]: null,
    },
  })
  writeFileSync(join(directory, 'dashboards', `notes${override}.md`), 'not a dashboard', 'utf8')

  const out = join(directory, 'map.json')
  const result = map(directory, ['--out', out])
  assert.equal(result.status, 2)
  assert.equal(result.report.status, 'incomplete')

  const written = readFileSync(out, 'utf8')
  // The document's own indentation newlines are the only U+000A that belongs
  // here, so the scan runs over the string values rather than the whole file.
  assert.deepEqual(classCharactersIn(written.replaceAll('\n', '')), [], 'raw bytes of the written map')
  for (const value of everyString(JSON.parse(written))) {
    assert.equal(sanitise(value), value, `a string in the written map: ${JSON.stringify(value)}`)
  }

  // The companion to the absence: what IS in the map, and why.
  const parsed = JSON.parse(written)
  assert.deepEqual(parsed.unreadable, [
    { file: 'dashboards/hidden.json', reason: 'unrenderable-name' },
    { file: 'dashboards/notes.md', reason: 'unrenderable-name' },
  ])
  assert.deepEqual(parsed.unsupported, [
    { file: 'dashboards/unsupported.json', declaredFormat: 'lookerlookml/1', reason: 'unsupported-format' },
  ])
  assert.deepEqual(parsed.dashboards.map((entry) => entry.file), ['dashboards/revenue.json'])
  assert.deepEqual(uniqueRuleIds(result.report), ['dashboard-format-unsupported', 'path-unrenderable'])
})

for (const { label, code } of CLASSES) {
  test(`${label} arriving through a FILE NAME is refused, named by its code point, and never written`, (t) => {
    const directory = temporary(t)
    const character = String.fromCharCode(code)
    tree(directory, { dashboards: { 'revenue.json': dashboard() } })
    writeFileSync(
      join(directory, 'dashboards', `planted${character}.json`),
      `${JSON.stringify(dashboard({ dashboardId: 'planted' }))}\n`,
      'utf8',
    )

    const out = join(directory, 'map.json')
    const result = map(directory, ['--out', out])
    assert.equal(result.status, 2)
    assert.equal(result.report.status, 'incomplete')
    const finding = result.report.findings.find((entry) => entry.ruleId === 'path-unrenderable')
    assert.equal(finding.location.file, 'dashboards/planted.json')
    const point = `U+${code.toString(16).toUpperCase().padStart(4, '0')}`
    assert.match(finding.message, new RegExp(`carries ${point.replace('+', '\\+')} in its name`))

    const written = readFileSync(out, 'utf8')
    assert.deepEqual(classCharactersIn(written.replaceAll('\n', '')), [])
    assert.deepEqual(JSON.parse(written).unreadable, [
      { file: 'dashboards/planted.json', reason: 'unrenderable-name' },
    ])
    // The planted file contributed nothing: its dashboard id is nowhere.
    assert.ok(!written.includes('planted"'), 'no lineage is taken from a file that cannot be named')
  })
}

test('a file name of ordinary non-ASCII characters is mapped, not refused', (t) => {
  const directory = temporary(t)
  tree(directory, { dashboards: { 'revenus-été-🙂.json': dashboard() } })
  const out = join(directory, 'map.json')
  const result = map(directory, ['--out', out])
  assert.equal(result.status, 0, result.stdout)
  assert.deepEqual(uniqueRuleIds(result.report), ['source-map-complete'])
  assert.deepEqual(
    JSON.parse(readFileSync(out, 'utf8')).dashboards.map((entry) => entry.file),
    ['dashboards/revenus-été-🙂.json'],
  )
})

for (const flag of ['--dashboards', '--models']) {
  test(`${flag} carrying a character of the class is a configuration error, not a stripped path`, (t) => {
    const directory = temporary(t)
    tree(directory)
    const result = runCli(['--root', directory, flag, `dash${String.fromCharCode(0x202e)}boards`, '--quiet'])
    assert.equal(result.status, 2)
    assert.equal(result.stdout, '', 'a configuration error reports nothing on stdout')
    assert.match(result.stderr, new RegExp(`option "${flag}" carries U\\+202E`))
  })
}
