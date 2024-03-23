#!/usr/bin/env node

/**
 * The command line surface.
 *
 * Two shapes of exit 2, as the report contract requires:
 *
 *   bad usage, unknown option, unusable destination -> EMPTY stdout, message on
 *   stderr. The run never had a subject, so there is nothing to report about.
 *
 *   an export that could not be read, decoded, parsed or recognised -> a report
 *   on stdout with status "incomplete". The run had a subject and failed to
 *   obtain evidence about it, and the consumer needs to know WHICH file.
 */

import { writeFile } from 'node:fs/promises'
import process from 'node:process'

import {
  DestinationError,
  LIMITS,
  OVERRIDABLE,
  SUPPORTED_DASHBOARD_FORMATS,
  SUPPORTED_MODEL_FORMATS,
  assertWritableDestination,
  buildSourceMap,
  canonicalDocument,
  canonicalFailureDetail,
  controlCodePoints,
  exitCodeFor,
  formatReport,
  resolveRoot,
  serializeReport,
} from '../src/index.mjs'

const VERSION = '0.1.0'

class ConfigError extends Error {}

const DEFAULT_DASHBOARDS = 'dashboards'
const DEFAULT_MODELS = 'models.json'

const HELP = `dashboard-source-map ${VERSION}

Read dashboard exports and a model export, and map every tile to the query
behind it, the models behind the query, the transformation behind each model,
and whatever freshness evidence the export declares. Broken links are the
output, not a side effect.

Nothing here opens a socket, resolves a host, reads an environment variable or
reads a clock. Every input is a document somebody exported.

NO GUESSED LINEAGE. This tool reads ${SUPPORTED_DASHBOARD_FORMATS.join(', ')} and
${SUPPORTED_MODEL_FORMATS.join(', ')}. A dashboard file declaring any other
format is reported BY THE FORMAT IT DECLARES and contributes no tile, no query
and no model edge -- it is not scanned for anything that happens to look like a
tile. A file that declares no format at all is reported the same way. Both make
the run incomplete and exit 2.

A RENAME IS VISIBLE. A model export may record a model's former ids. A tile
reading a former id still resolves, and every impacted tile is named in the
report. A tile reading an id no model claims is a broken link and exit 1. A
former id two models claim, or one that is also a live id, is reported as
ambiguous and is NEVER reported as missing -- an index that dropped it has no
basis for saying nothing provides it.

FRESHNESS IS REPORTED, NEVER JUDGED. A model with no declared freshness is
recorded as an explicit unknown, not omitted. This tool reads no clock, so it
says nothing about whether an observation is recent.

Usage:
  dashboard-source-map --root DIR [--dashboards DIR] [--models FILE]
                       [--out FILE] [--quiet] [limit options]
  dashboard-source-map --help | --version

Options:
  --root DIR              Directory holding the exports (required). A path that
                          resolves outside the real root is refused, symbolic
                          links included.
  --dashboards DIR        Dashboard export directory, relative to --root
                          (default ${DEFAULT_DASHBOARDS}). Only .json files are read;
                          anything else is listed and reported as skipped.
  --models FILE           Model export, relative to --root (default ${DEFAULT_MODELS}).
  --out FILE              Write the source map here. The destination is checked
                          first: a symbolic link there is refused, and a hard
                          link to any file this run resolved -- including one it
                          only listed -- is refused. The destination is NOT
                          confined to --root: it is an ordinary path and a
                          symbolically linked parent directory is followed,
                          exactly as it is for cp and shell redirection.
  --quiet                 Do not write the human summary to stderr.
  --max-document-bytes N      Bytes of one JSON document (default ${LIMITS.maxDocumentBytes}).
  --max-directory-entries N   Entries in the dashboard directory (default ${LIMITS.maxDirectoryEntries}).
  --max-dashboard-files N     JSON files read in one run (default ${LIMITS.maxDashboardFiles}).
  --max-tiles N               Tiles in one dashboard (default ${LIMITS.maxTiles}).
  --max-queries N             Queries in one dashboard (default ${LIMITS.maxQueries}).
  --max-models N              Models in one export (default ${LIMITS.maxModels}).
  --max-query-references N    Model references on one query (default ${LIMITS.maxQueryReferences}).
  --max-upstream-ids N        Upstream ids on one model (default ${LIMITS.maxUpstreamIds}).
  --max-previous-ids N        Former ids on one model (default ${LIMITS.maxPreviousIds}).
  --max-tile-model-edges N    Tile-to-model edges in one run (default ${LIMITS.maxTileModelEdges}).
                              This is the bound on the WORK: the per-document
                              limits above bound one file each, and their
                              product is ten million edges. At this default,
                              with every identifier and title at its limit, one
                              run measured 5.4 s, 1.21 GB peak RSS and a 189 MB
                              map.
  --max-findings N            Findings per report (default ${LIMITS.maxFindings}).

Exit codes:
  0  every tile read resolves end to end
  1  at least one link is broken
  2  invalid usage or an unusable destination (empty stdout), or evidence that
     could not be obtained (a report with status "incomplete")

stdout carries the JSON report and nothing else. stderr carries the human
summary. --help and --version print text and produce no report.
`

const OPTIONS = new Set(['--root', '--dashboards', '--models', '--out'])

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true }
  if (argv.includes('--version')) return { version: true }
  const values = new Map()
  const limits = { ...LIMITS }
  let quiet = false
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--quiet') {
      quiet = true
      continue
    }
    if (!OPTIONS.has(token) && !Object.hasOwn(OVERRIDABLE, token)) {
      throw new ConfigError(`unknown option "${token}"`)
    }
    if (values.has(token)) throw new ConfigError(`option "${token}" was given more than once`)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new ConfigError(`option "${token}" needs a value`)
    index += 1
    if (Object.hasOwn(OVERRIDABLE, token)) {
      if (!/^[0-9]+$/.test(value)) throw new ConfigError(`option "${token}" needs a whole number, not "${value}"`)
      const parsed = Number(value)
      if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throw new ConfigError(`option "${token}" needs a whole number of at least 1`)
      }
      limits[OVERRIDABLE[token]] = parsed
      continue
    }
    values.set(token, value)
  }
  if (!values.has('--root')) throw new ConfigError('option "--root" is required')
  return { values, limits: Object.freeze(limits), quiet }
}

function relativeOption(values, flag, fallback) {
  const value = values.get(flag) ?? fallback
  if (value.startsWith('/')) throw new ConfigError(`option "${flag}" is relative to --root, and this path is absolute`)
  if (value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new ConfigError(`option "${flag}" must not contain an empty, "." or ".." segment`)
  }
  // This path is rendered into every finding and into every entry of the map.
  // A path that renders as something other than itself would name a file the
  // reader cannot find, so it is refused here rather than stripped later.
  const points = controlCodePoints(value)
  if (points.length > 0) {
    throw new ConfigError(`option "${flag}" carries ${points.join(', ')}, which cannot be rendered in a report`)
  }
  return value
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2))
  if (parsed.help) {
    process.stdout.write(HELP)
    return 0
  }
  if (parsed.version) {
    process.stdout.write(`${VERSION}\n`)
    return 0
  }
  const { values, limits, quiet } = parsed
  let realRoot
  try {
    realRoot = await resolveRoot(values.get('--root'))
  } catch {
    throw new ConfigError('--root could not be resolved; name a directory that exists')
  }
  const dashboardsDirectory = relativeOption(values, '--dashboards', DEFAULT_DASHBOARDS)
  const modelsFile = relativeOption(values, '--models', DEFAULT_MODELS)

  const result = await buildSourceMap({ realRoot, dashboardsDirectory, modelsFile, limits })

  let wrote = false
  if (values.has('--out') && result.map !== null) {
    const target = await assertWritableDestination(values.get('--out'), {
      inputs: result.touched,
      root: null,
      label: '--out',
    })
    // Serialising and writing fail for unrelated reasons and are reported
    // separately. Both were inside one try, so a map too large for a single
    // JavaScript string -- reachable by raising --max-tile-model-edges -- came
    // out as `--out could not be written (unknown error)`, which names the
    // wrong act and offers the reader nothing to do about it.
    let document
    try {
      document = canonicalDocument(result.map)
    } catch (error) {
      throw new ConfigError(`--out could not be serialised (${canonicalFailureDetail(error)})`)
    }
    try {
      await writeFile(target, document, 'utf8')
    } catch (error) {
      throw new ConfigError(`--out could not be written (${error.code ?? 'unknown error'})`)
    }
    wrote = true
  }

  // The written map is not reported as a finding. A finding pushed onto a
  // finished report would take neither its severity from the frozen table nor
  // its place in the ordering, and a report that says "written" before the
  // write has happened is a claim this tool has no business making.
  process.stdout.write(serializeReport(result.report))
  if (!quiet) {
    const headline = wrote
      ? `source map for ${dashboardsDirectory}, written to the path named by --out`
      : `source map for ${dashboardsDirectory}`
    process.stderr.write(formatReport(result.report, headline))
  }
  return exitCodeFor(result.report)
}

try {
  process.exitCode = await main()
} catch (error) {
  if (error instanceof ConfigError || error instanceof DestinationError) {
    process.stderr.write(`dashboard-source-map: ${error.message}\n`)
    process.exitCode = 2
  } else {
    throw error
  }
}
