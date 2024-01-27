/**
 * The command-line surface, and the two shapes of exit 2.
 *
 * A configuration error means the run never had a subject, so stdout is EMPTY
 * and the message goes to stderr. An export that could not be read means the
 * run had a subject and failed to obtain evidence about it, so stdout carries a
 * report with status "incomplete". A consumer piping stdout has to handle both,
 * which is why both are pinned here rather than described.
 */

import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import { map, runCli, temporary, tree } from './support.mjs'

const USAGE = [
  { label: 'no options at all', args: [] },
  { label: 'a missing --root', args: ['--models', 'models.json'] },
  { label: 'an unknown option', args: ['--root', '.', '--verbose'] },
  { label: 'a repeated option', args: ['--root', '.', '--models', 'a.json', '--models', 'b.json'] },
  { label: 'an option with no value', args: ['--root'] },
  { label: 'a non-numeric bound', args: ['--root', '.', '--max-tiles', 'lots'] },
  { label: 'a bound of zero', args: ['--root', '.', '--max-tiles', '0'] },
  { label: 'a negative bound', args: ['--root', '.', '--max-tiles', '-4'] },
]

for (const { label, args } of USAGE) {
  test(`${label} is a configuration error: exit 2 with EMPTY stdout`, () => {
    const result = runCli(args)
    assert.equal(result.status, 2)
    assert.equal(result.stdout, '', 'a run that never had a subject reports nothing')
    assert.match(result.stderr, /^dashboard-source-map: /)
  })
}

test('an absolute --dashboards is a configuration error, not an unreadable input', () => {
  const result = runCli(['--root', '.', '--dashboards', '/etc'])
  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /relative to --root/)
})

test('a --dashboards containing ".." is a configuration error', () => {
  const result = runCli(['--root', '.', '--dashboards', '../elsewhere'])
  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /".." segment/)
})

test('a --root that does not exist is a configuration error, not an incomplete report', () => {
  const result = runCli(['--root', '/no/such/root/here'])
  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /--root could not be resolved/)
})

test('a dashboard directory that does not exist IS an incomplete report on stdout', (t) => {
  const directory = temporary(t)
  tree(directory)
  const result = map(directory, ['--dashboards', 'nowhere'])
  assert.equal(result.status, 2)
  assert.notEqual(result.stdout, '', 'the run had a subject; the consumer needs to know which input')
  assert.equal(result.report.status, 'incomplete')
  assert.equal(result.report.findings[0].ruleId, 'no-dashboard-read')
})

test('--help explains the tool and exits 0', () => {
  const result = runCli(['--help'])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /dashboard-source-map/)
  assert.match(result.stdout, /NO GUESSED LINEAGE/)
  assert.match(result.stdout, /A RENAME IS VISIBLE/)
  assert.match(result.stdout, /FRESHNESS IS REPORTED, NEVER JUDGED/)
  assert.match(result.stdout, /Exit codes:/)
})

test('--version prints a version and exits 0', () => {
  const result = runCli(['--version'])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /^\d+\.\d+\.\d+\n$/)
})

test('stdout is JSON and nothing else; the human summary goes to stderr', (t) => {
  const directory = temporary(t)
  tree(directory)
  const result = runCli(['--root', directory])
  assert.equal(result.status, 0)
  const report = JSON.parse(result.stdout)
  assert.equal(report.tool, 'dashboard-source-map')
  assert.equal(report.schemaVersion, '1')
  assert.match(result.stderr, /^dashboard-source-map: source map for dashboards/)
  assert.match(result.stderr, /status pass/)
})

test('the stderr headline says when a map was written, and the report does not', (t) => {
  const directory = temporary(t)
  tree(directory)
  const result = runCli(['--root', directory, '--out', join(directory, 'map.json')])
  assert.equal(result.status, 0)
  assert.match(result.stderr, /written to the path named by --out/)
  const report = JSON.parse(result.stdout)
  assert.deepEqual(report.findings.map((finding) => finding.ruleId), ['source-map-complete'])
})

test('--quiet silences the human summary and leaves stdout untouched', (t) => {
  const directory = temporary(t)
  tree(directory)
  const loud = runCli(['--root', directory])
  const quiet = runCli(['--root', directory, '--quiet'])
  assert.equal(quiet.stderr, '')
  assert.equal(quiet.stdout, loud.stdout)
})

test('running twice over identical inputs produces byte-identical stdout', (t) => {
  const directory = temporary(t)
  tree(directory)
  const first = map(directory)
  const second = map(directory)
  assert.equal(second.stdout, first.stdout)
})

test('every finding carries the fields the report contract defines and no others', (t) => {
  const directory = temporary(t)
  tree(directory)
  const result = map(directory)
  const allowed = ['evidence', 'location', 'message', 'ruleId', 'severity', 'suggestion']
  for (const finding of result.report.findings) {
    for (const key of Object.keys(finding)) assert.ok(allowed.includes(key), `unexpected finding key ${key}`)
    assert.ok(['error', 'warning', 'info'].includes(finding.severity))
    assert.equal(typeof finding.location.file, 'string')
    assert.ok(!finding.location.file.startsWith('/'), 'a location is never an absolute host path')
  }
  assert.deepEqual(Object.keys(result.report).sort(), ['findings', 'schemaVersion', 'status', 'summary', 'tool'])
})
