/**
 * What this tool does NOT do.
 *
 * Each of these is a guarantee the README makes, and a README that claims
 * something the code does not do is a defect, so each one is checked here.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import { ROOT, map, runCli, temporary, tree } from './support.mjs'

function sources() {
  const files = []
  for (const directory of ['src', 'bin']) {
    for (const name of readdirSync(join(ROOT, directory)).sort()) {
      if (name.endsWith('.mjs')) files.push(join(ROOT, directory, name))
    }
  }
  return files
}

test('no source module reaches for the network', () => {
  for (const file of sources()) {
    const text = readFileSync(file, 'utf8')
    for (const forbidden of ['node:net', 'node:http', 'node:https', 'node:dns', 'node:tls', 'node:dgram', 'fetch(']) {
      assert.ok(!text.includes(forbidden), `${file} mentions ${forbidden}`)
    }
  }
})

test('no source module reads a clock or the environment for data', () => {
  for (const file of sources()) {
    const text = readFileSync(file, 'utf8')
    assert.ok(!text.includes('Date.now'), `${file} reads a clock`)
    assert.ok(!text.includes('new Date'), `${file} reads a clock`)
    assert.ok(!text.includes('process.env.'), `${file} reads an environment variable`)
    assert.ok(!text.includes('process.hrtime'), `${file} reads a clock`)
  }
})

test('no source module parses SQL or reads query text', () => {
  for (const file of sources()) {
    const text = readFileSync(file, 'utf8')
    // The schema has no field for query text, so there is nothing to parse.
    assert.ok(!text.includes('queryText'), `${file} reads query text`)
    assert.ok(!text.includes('SELECT '), `${file} looks at SQL`)
  }
})

test('BEHAVIOUR: no clock reaches the output, so an unchanged export maps the same', (t) => {
  const directory = temporary(t)
  tree(directory)
  const first = runCli(['--root', directory, '--out', join(directory, 'a.json'), '--quiet'])
  const second = runCli(['--root', directory, '--out', join(directory, 'b.json'), '--quiet'])
  assert.equal(first.status, 0)
  assert.equal(second.status, 0)
  assert.equal(
    readFileSync(join(directory, 'b.json'), 'utf8'),
    readFileSync(join(directory, 'a.json'), 'utf8'),
    'a timestamp minted by the tool would make these differ',
  )
  assert.equal(second.stdout, first.stdout)
})

test('the observedAt label is copied verbatim and never parsed', (t) => {
  const directory = temporary(t)
  tree(directory, {
    models: {
      format: 'edilec.model-export/v1',
      models: [
        { id: 'finance.arr_monthly', freshness: { observedAt: 'after the Friday batch', source: 'the person who ran it' } },
        { id: 'finance.churn_monthly', freshness: { observedAt: 'after the Friday batch', source: 'the person who ran it' } },
      ],
    },
  })
  const result = map(directory, ['--out', join(directory, 'map.json')])
  assert.equal(result.status, 0, 'a label this tool cannot parse is not an error, because it never parses one')
  const written = JSON.parse(readFileSync(join(directory, 'map.json'), 'utf8'))
  assert.deepEqual(written.models[0].freshness, {
    observedAt: 'after the Friday batch',
    source: 'the person who ran it',
    state: 'declared',
  })
})

test('a run without --out changes nothing on disk', (t) => {
  const directory = temporary(t)
  tree(directory)
  const snapshot = () => readdirSync(join(directory, 'dashboards')).sort().map((name) => {
    const info = statSync(join(directory, 'dashboards', name))
    return `${name}:${info.size}:${info.mtimeMs}`
  })
  const before = snapshot()
  runCli(['--root', directory, '--quiet'])
  assert.deepEqual(snapshot(), before)
})

test('the package declares no dependencies of any kind', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  assert.equal(manifest.dependencies, undefined)
  assert.equal(manifest.devDependencies, undefined)
  assert.equal(manifest.peerDependencies, undefined)
  assert.equal(manifest.optionalDependencies, undefined)
})

test('TOOL_ID is exported and equals the directory name', async () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const { TOOL_ID } = await import('../src/index.mjs')
  assert.equal(TOOL_ID, 'dashboard-source-map')
  assert.equal(manifest.name, 'dashboard-source-map')
  assert.equal(ROOT.split('/').pop(), 'dashboard-source-map')
})
