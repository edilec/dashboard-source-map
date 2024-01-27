/**
 * The destination guard.
 *
 * Fifteen tools in this catalog destroyed a file they were never asked to
 * touch, and eight of them exited 0 reporting success. The three holes are
 * independent -- guarding one or two is what every one of those tools had
 * already done -- so there is a test per hole AND a test per allowed case,
 * because a guard that refuses everything passes a data-loss test while making
 * the tool useless.
 *
 * The input set is every path this tool STATS OR LISTS, not only the ones it
 * opens. A lane planner elsewhere in this catalog destroyed a source file it
 * had merely named: both its guards were individually correct, and the file was
 * not in the set. The README file sitting in the dashboard directory, which is
 * listed and never opened, is in the set here, and there is a test for it.
 *
 * Hole 2 (a symbolically linked parent directory) is NOT a defect here and is
 * not guarded: `--out` takes an ordinary path and this tool declares no
 * confinement root for it, exactly as `cp` and shell redirection do. Refusing
 * every symlinked ancestor would refuse every run under the macOS temporary
 * directory, since /var is a link to /private/var. The behaviour is pinned
 * below, and the help text and README say the same thing.
 */

import { existsSync, linkSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import { runCli, temporary, tree, write } from './support.mjs'

function prepared(t) {
  const directory = temporary(t)
  const root = join(directory, 'root')
  tree(root)
  return { directory, root }
}

function attemptWrite(root, out, extra = []) {
  return runCli(['--root', root, '--out', out, '--quiet', ...extra])
}

test('HOLE 1: a symbolic link at the destination is refused on sight', (t) => {
  const { directory, root } = prepared(t)
  const victim = join(directory, 'somebody-elses-notes.txt')
  writeFileSync(victim, 'keep me\n', 'utf8')
  const out = join(directory, 'map.json')
  symlinkSync(victim, out)

  const result = attemptWrite(root, out)
  assert.equal(result.status, 2)
  assert.equal(result.stdout, '', 'a refused destination is a configuration error, and it reports nothing')
  assert.match(result.stderr, /symbolic link/)
  assert.equal(readFileSync(victim, 'utf8'), 'keep me\n')
})

test('HOLE 3: a hard link to a dashboard export this run read is refused', (t) => {
  const { directory, root } = prepared(t)
  const out = join(directory, 'map.json')
  linkSync(join(root, 'dashboards/revenue.json'), out)

  const result = attemptWrite(root, out)
  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /inode/)
  assert.match(readFileSync(join(root, 'dashboards/revenue.json'), 'utf8'), /edilec\.dashboard\/v1/)
})

test('HOLE 3: a hard link to the model export is refused', (t) => {
  const { directory, root } = prepared(t)
  const out = join(directory, 'map.json')
  linkSync(join(root, 'models.json'), out)

  const result = attemptWrite(root, out)
  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /inode/)
  assert.match(readFileSync(join(root, 'models.json'), 'utf8'), /edilec\.model-export\/v1/)
})

test('HOLE 3: a hard link to a file this run LISTED but never opened is refused', (t) => {
  // The .md file in the dashboard directory is listed, reported as skipped, and
  // never read. Every path the tool reasons about belongs in the input set.
  const { directory, root } = prepared(t)
  write(root, 'dashboards/NOTES.md', 'how these exports are produced\n')
  const out = join(directory, 'map.json')
  linkSync(join(root, 'dashboards/NOTES.md'), out)

  const result = attemptWrite(root, out)
  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /inode/)
  assert.equal(readFileSync(join(root, 'dashboards/NOTES.md'), 'utf8'), 'how these exports are produced\n')
})

test('HOLE 3: a hard link to a dashboard whose format this tool refused is still refused', (t) => {
  const { directory, root } = prepared(t)
  write(root, 'dashboards/legacy.json', `${JSON.stringify({ format: 'looker.lookml/1' })}\n`)
  const out = join(directory, 'map.json')
  linkSync(join(root, 'dashboards/legacy.json'), out)

  const result = attemptWrite(root, out)
  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /inode/)
  assert.match(readFileSync(join(root, 'dashboards/legacy.json'), 'utf8'), /looker\.lookml/)
})

test('a destination that is a directory is refused', (t) => {
  const { directory, root } = prepared(t)
  const out = join(directory, 'somewhere')
  mkdirSync(out)
  const result = attemptWrite(root, out)
  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /not a regular file/)
})

test('a destination in a directory that does not exist is refused, and nothing is created', (t) => {
  const { directory, root } = prepared(t)
  const out = join(directory, 'missing', 'map.json')
  const result = attemptWrite(root, out)
  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /directory that does not exist/)
  assert.equal(existsSync(join(directory, 'missing')), false, 'the tool never creates a directory')
})

test('ALLOWED: a fresh path in an existing directory is written', (t) => {
  const { directory, root } = prepared(t)
  const out = join(directory, 'map.json')
  const result = attemptWrite(root, out)
  assert.equal(result.status, 0)
  assert.ok(result.stdout.startsWith('{'))
  assert.match(readFileSync(out, 'utf8'), /"edilec\.source-map\/v1"/)
})

test('ALLOWED: an existing regular file that is not an input is overwritten', (t) => {
  const { directory, root } = prepared(t)
  const out = join(directory, 'map.json')
  writeFileSync(out, 'an older map\n', 'utf8')
  const result = attemptWrite(root, out)
  assert.equal(result.status, 0)
  assert.match(readFileSync(out, 'utf8'), /"edilec\.source-map\/v1"/)
})

test('ALLOWED and DOCUMENTED: a symbolically linked parent directory is followed', (t) => {
  const { directory, root } = prepared(t)
  const real = join(directory, 'real-output-dir')
  mkdirSync(real)
  symlinkSync(real, join(directory, 'link-to-output-dir'))

  const result = attemptWrite(root, join(directory, 'link-to-output-dir', 'map.json'))
  assert.equal(result.status, 0, 'this tool declares no confinement root for --out')
  assert.match(readFileSync(join(real, 'map.json'), 'utf8'), /"edilec\.source-map\/v1"/)
})

test('without --out nothing is written at all', (t) => {
  const { root } = prepared(t)
  const before = readFileSync(join(root, 'models.json'), 'utf8')
  const result = runCli(['--root', root, '--quiet'])
  assert.equal(result.status, 0)
  assert.equal(readFileSync(join(root, 'models.json'), 'utf8'), before)
  assert.equal(existsSync(join(root, 'map.json')), false)
})

test('the help text says the destination is unconfined rather than claiming a confinement', () => {
  const help = runCli(['--help'])
  assert.equal(help.status, 0)
  assert.match(help.stdout, /NOT\s+confined to --root/)
  assert.match(help.stdout, /symbolically linked parent directory is followed/)
})
