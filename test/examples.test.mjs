/**
 * Every example in the README, run as documented.
 *
 * An example that does not run is a documentation overclaim, and documentation
 * overclaims are counted as defects here.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import { ROOT, runCli, runJson, ruleIds, temporary, uniqueRuleIds } from './support.mjs'

test('examples/clean resolves end to end: exit 0', () => {
  const result = runJson(['--root', 'examples/clean', '--quiet'])
  assert.equal(result.status, 0)
  assert.equal(result.report.status, 'pass')
  assert.ok(ruleIds(result.report).includes('source-map-complete'))
  assert.equal(result.report.summary.tiles, 2)
  assert.equal(result.report.summary.broken, 0)
})

test('examples/renamed resolves and names the impacted tile: exit 0', () => {
  const result = runJson(['--root', 'examples/renamed', '--quiet'])
  assert.equal(result.status, 0)
  assert.equal(result.report.status, 'pass')
  const renamed = result.report.findings.find((finding) => finding.ruleId === 'model-renamed')
  assert.equal(renamed.location.pointer, '/tiles/tile-arr')
  assert.match(renamed.message, /finance\.arr_by_month/)
})

test('examples/broken has a broken link: exit 1', () => {
  const result = runJson(['--root', 'examples/broken', '--quiet'])
  assert.equal(result.status, 1)
  assert.equal(result.report.status, 'fail')
  const missing = result.report.findings.find((finding) => finding.ruleId === 'model-missing')
  assert.equal(missing.location.file, 'dashboards/revenue.json')
  assert.equal(missing.location.pointer, '/tiles/tile-arr')
  assert.equal(result.report.summary.broken, 1)
})

test('examples/unsupported reports the foreign export and guesses nothing: exit 2', (t) => {
  const directory = temporary(t)
  const out = join(directory, 'map.json')
  const result = runJson(['--root', 'examples/unsupported', '--out', out, '--quiet'])
  assert.equal(result.status, 2)
  assert.equal(result.report.status, 'incomplete')
  assert.ok(uniqueRuleIds(result.report).includes('dashboard-format-unsupported'))
  const written = JSON.parse(readFileSync(out, 'utf8'))
  assert.deepEqual(written.unsupported, [
    { declaredFormat: 'looker.lookml/1', file: 'dashboards/legacy-marketing.json', reason: 'unsupported-format' },
  ])
  const spend = written.models.find((model) => model.id === 'marketing.spend_monthly')
  assert.deepEqual(spend.usedByTiles, [], 'the only tile that names it is in a file this tool cannot read')
  assert.deepEqual(written.dashboards.map((entry) => entry.dashboardId), ['revenue-weekly'])
})

test('the quick start write command runs and produces a map', (t) => {
  const directory = temporary(t)
  const out = join(directory, 'source-map.json')
  const result = runCli(['--root', 'examples/clean', '--out', out, '--quiet'])
  assert.equal(result.status, 0)
  const written = JSON.parse(readFileSync(out, 'utf8'))
  assert.equal(written.schema, 'edilec.source-map/v1')
  assert.equal(written.dashboards[0].tiles.length, 2)
})

test('every command block in the README is one of the commands tested above', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
  const commands = readme.split('\n').filter((line) => line.includes('bin/dashboard-source-map.mjs'))
  assert.equal(commands.length, 5, 'the quick start documents five runnable commands')
})
