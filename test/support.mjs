import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const BIN = join(ROOT, 'bin', 'dashboard-source-map.mjs')

/** Run the real CLI in a child process. Nothing here stubs the entry point. */
export function runCli(args, options = {}) {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd: options.cwd ?? ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env ?? {}) },
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

export function runJson(args, options = {}) {
  const result = runCli(args, options)
  return { ...result, report: result.stdout === '' ? null : JSON.parse(result.stdout) }
}

export function ruleIds(report) {
  return report.findings.map((finding) => finding.ruleId)
}

export function uniqueRuleIds(report) {
  return [...new Set(ruleIds(report))].sort()
}

export function temporary(t) {
  const directory = mkdtempSync(join(tmpdir(), 'dashboard-source-map-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

export function write(directory, relativePath, contents) {
  const target = join(directory, relativePath)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, contents, 'utf8')
  return target
}

export function writeJson(directory, relativePath, value) {
  return write(directory, relativePath, `${JSON.stringify(value, null, 2)}\n`)
}

/** One dashboard with two tiles, both resolving. */
export function dashboard(overrides = {}) {
  return {
    format: 'edilec.dashboard/v1',
    dashboardId: 'revenue-weekly',
    title: 'Revenue, weekly',
    tiles: [
      { id: 'tile-arr', title: 'ARR', queryId: 'q-arr' },
      { id: 'tile-churn', title: 'Churn rate', queryId: 'q-churn' },
    ],
    queries: [
      { id: 'q-arr', description: 'Monthly ARR', modelIds: ['finance.arr_monthly'] },
      { id: 'q-churn', description: 'Monthly churn', modelIds: ['finance.churn_monthly'] },
    ],
    ...overrides,
  }
}

export function freshness(observedAt = '2026-09-19T02:10:00Z') {
  return { observedAt, source: 'load-log' }
}

export function modelExport(models = null) {
  return {
    format: 'edilec.model-export/v1',
    models: models ?? [
      {
        id: 'finance.arr_monthly',
        transformation: { id: 'arr-rollup', version: '2.1.0' },
        freshness: freshness(),
      },
      {
        id: 'finance.churn_monthly',
        transformation: { id: 'churn-rollup', version: '1.4.2' },
        freshness: freshness('2026-09-19T02:12:00Z'),
      },
    ],
  }
}

/** A complete, resolvable tree. */
export function tree(directory, { dashboards = { 'revenue.json': dashboard() }, models = modelExport() } = {}) {
  for (const [name, value] of Object.entries(dashboards)) writeJson(directory, `dashboards/${name}`, value)
  if (models !== null) writeJson(directory, 'models.json', models)
  return directory
}

export function map(directory, args = []) {
  return runJson(['--root', directory, '--quiet', ...args])
}
