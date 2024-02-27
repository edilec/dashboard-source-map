/**
 * Build the source map: every tile, the query behind it, the models behind the
 * query, the transformation behind each model, and what is known about each
 * model's freshness.
 *
 * Three refusals shape this module, and each of them exists because the
 * alternative is a confident lie:
 *
 * 1. A DASHBOARD WHOSE FORMAT THIS TOOL DOES NOT SUPPORT CONTRIBUTES NOTHING.
 *    It is not compiled, not scanned for anything that looks like a tile, and
 *    never produces an edge. "It happens to have a `tiles` array" is not the
 *    same claim as "this is an export of the format I understand", and only the
 *    second one supports a lineage edge. The file is listed by name, with the
 *    format it declared, and the run is incomplete.
 *
 * 2. WITHOUT A MODEL EXPORT, NO REFERENCE IS CALLED MISSING. `model-missing` is
 *    a positive claim -- nothing provides this id -- and a run that could not
 *    read the model export has no basis for it. Reporting every tile as broken
 *    because the index failed to load would be a finding raised on correct
 *    input, which is the worst defect a checker can have.
 *
 * 3. AN AMBIGUOUS RENAME IS NOT A MISSING MODEL. See `models.mjs`.
 */

import { LIMITS } from './limits.mjs'
import { buildModelIndex, resolveModel } from './models.mjs'
import { ReportBuilder, TOOL_ID } from './report.mjs'
import {
  SOURCE_MAP_SCHEMA,
  SUPPORTED_DASHBOARD_FORMATS,
  SUPPORTED_MODEL_FORMATS,
  compileDashboard,
  compileModelExport,
  declaredFormat,
} from './schema.mjs'
import { byCodeUnit, excerpt } from './text.mjs'
import { listDashboardDirectory, readJsonDocument, resolveInside } from './documents.mjs'

/** How much a tile's lineage is known. `broken` outranks `unresolved`. */
export const LINEAGE = Object.freeze(['resolved', 'unresolved', 'broken'])

function freshnessOf(model) {
  if (model.freshness === null) {
    // An explicit unknown, never an omission. A missing key in the map would
    // read as "this model has no freshness concern", which is a different and
    // unsupported claim.
    return { state: 'unknown', reason: 'no-evidence-declared' }
  }
  return { state: 'declared', observedAt: model.freshness.observedAt, source: model.freshness.source }
}

async function loadModels({ realRoot, modelsFile, limits, report, touched }) {
  const resolved = await resolveInside(realRoot, modelsFile)
  touched.push(...resolved.touched)
  if (!resolved.ok) {
    report.add('models-unreadable', { file: modelsFile, message: `the model export ${resolved.detail}` })
    return { available: false }
  }
  const document = await readJsonDocument(resolved.absolute, limits)
  if (!document.ok) {
    report.add('models-unreadable', { file: modelsFile, message: `the model export ${document.detail}` })
    return { available: false }
  }
  const format = declaredFormat(document.value)
  if (!format.ok) {
    report.add('models-invalid', {
      file: modelsFile,
      pointer: '/format',
      message: format.reason === 'not-an-object'
        ? `the model export is ${format.typeName}, not an object`
        : 'the model export declares no format, so this tool cannot know what it is reading',
    })
    return { available: false }
  }
  if (!SUPPORTED_MODEL_FORMATS.includes(format.format)) {
    report.add('models-invalid', {
      file: modelsFile,
      pointer: '/format',
      message:
        `the model export declares format "${excerpt(format.format, 80)}", which this tool does not support; `
        + `it reads ${SUPPORTED_MODEL_FORMATS.join(', ')}`,
    })
    return { available: false }
  }
  const compiled = compileModelExport(document.value, limits)
  if (!compiled.ok) {
    for (const problem of compiled.problems) {
      report.add('models-invalid', {
        file: modelsFile,
        pointer: problem.pointer === '' ? '/' : problem.pointer,
        message: `${problem.pointer === '' ? 'the document' : problem.pointer} ${problem.message}`,
      })
    }
    return { available: false }
  }
  const index = buildModelIndex(compiled.models)
  for (const former of [...index.ambiguous.keys()].sort(byCodeUnit)) {
    report.add('rename-ambiguous', {
      file: modelsFile,
      pointer: `/models/${former}`,
      message: `${index.ambiguous.get(former).detail}, so references to it are not resolved either way`,
      suggestion: 'leave exactly one model claiming each former id, and do not reuse a former id as a live id',
    })
  }
  return { available: true, models: compiled.models, index }
}

function reportQuerySources({ query, tile, report, file, unresolved }) {
  // A query's declared unresolvedSources are the export saying "this query
  // reads something I could not name". That declaration is self-contained: it
  // has nothing to do with the model index, so it survives a run that could not
  // read one. Dropping it left a consumer reading only model-export-unavailable
  // and concluding the tile would resolve once the model export was fixed.
  for (const reason of query.unresolvedSources) {
    unresolved.push({ reason: 'query-source-unresolved', detail: reason })
    report.add('query-source-unresolved', {
      file,
      pointer: `/tiles/${tile.id}`,
      message:
        `the query "${query.id}" behind tile "${tile.id}" declares a source it could not resolve (${reason}), `
        + 'so this tile\'s lineage is not complete',
      suggestion: 'resolve the source in the export, or accept that this tile has an unmapped dependency',
    })
  }
}

function mapTile({ tile, queries, models, report, file, dashboardId, usage }) {
  const unresolved = []
  const resolvedModels = []
  let broken = false

  const query = queries.find((entry) => entry.id === tile.queryId)
  if (query === undefined) {
    broken = true
    unresolved.push({ reason: 'query-missing', requestedId: tile.queryId })
    report.add('query-missing', {
      file,
      pointer: `/tiles/${tile.id}`,
      message: `tile "${tile.id}" names query "${tile.queryId}", and this dashboard declares no such query`,
      suggestion: 'the tile has no source until the query is restored or the reference is corrected',
    })
  }

  if (!models.available) {
    if (query !== undefined) reportQuerySources({ query, tile, report, file, unresolved })
    unresolved.push({ reason: 'model-export-unavailable' })
    return {
      tile: {
        id: tile.id,
        title: tile.title,
        queryId: tile.queryId,
        lineage: broken ? 'broken' : 'unresolved',
        models: [],
        unresolved,
      },
    }
  }

  if (query !== undefined) {
    reportQuerySources({ query, tile, report, file, unresolved })
    for (const requestedId of [...query.modelIds].sort(byCodeUnit)) {
      const outcome = resolveModel(models.index, requestedId)
      if (outcome.state === 'missing') {
        broken = true
        unresolved.push({ reason: 'model-missing', requestedId })
        report.add('model-missing', {
          file,
          pointer: `/tiles/${tile.id}`,
          message:
            `tile "${tile.id}" reads model "${requestedId}" through query "${query.id}", and the model export `
            + 'declares no model with that id and no model claiming it as a former id',
          suggestion: 'record the rename in the model export, or point the query at the model that replaced it',
        })
        continue
      }
      if (outcome.state === 'ambiguous') {
        unresolved.push({ reason: 'rename-ambiguous', requestedId, detail: outcome.detail })
        report.add('rename-ambiguous', {
          file,
          pointer: `/tiles/${tile.id}`,
          message:
            `tile "${tile.id}" reads model "${requestedId}" through query "${query.id}", and ${outcome.detail}`,
          suggestion: 'this tile is not reported as broken and not reported as fine; the export has to say which model it means',
        })
        continue
      }
      const model = outcome.model
      if (outcome.via === 'previousId') {
        report.add('model-renamed', {
          file,
          pointer: `/tiles/${tile.id}`,
          message:
            `tile "${tile.id}" reads model "${requestedId}", which the export records as a former id of `
            + `"${model.id}"; this tile is impacted by that rename`,
          suggestion: `update the query behind "${tile.id}" to name "${model.id}"`,
        })
      }
      const key = `${dashboardId}/${tile.id}`
      if (!usage.has(model.id)) usage.set(model.id, new Set())
      usage.get(model.id).add(key)
      resolvedModels.push({
        requestedId,
        resolvedId: model.id,
        via: outcome.via,
        transformation: model.transformation,
        upstreamIds: [...model.upstreamIds].sort(byCodeUnit),
        freshness: freshnessOf(model),
      })
    }
  }

  const lineage = broken ? 'broken' : unresolved.length > 0 ? 'unresolved' : 'resolved'
  return {
    tile: {
      id: tile.id,
      title: tile.title,
      queryId: tile.queryId,
      lineage,
      models: resolvedModels,
      unresolved,
    },
  }
}

export async function buildSourceMap({ realRoot, dashboardsDirectory, modelsFile, limits = LIMITS }) {
  const report = new ReportBuilder(limits)
  const touched = []
  const models = await loadModels({ realRoot, modelsFile, limits, report, touched })

  const listing = await listDashboardDirectory(realRoot, dashboardsDirectory, limits)
  touched.push(...(listing.touched ?? []))
  if (!listing.ok) {
    report.add('no-dashboard-read', {
      file: dashboardsDirectory,
      message: `the dashboard directory ${listing.detail}`,
    })
    return {
      report: report.finish({ checked: 0, dashboards: 0, tiles: 0, broken: 0, unresolvedTiles: 0 }),
      map: null,
      touched,
    }
  }

  for (const entry of listing.skipped) {
    report.add('dashboard-file-skipped', {
      file: entry.file,
      message: 'this is not a .json file, so it was listed and not read',
    })
  }

  const dashboards = []
  const unreadable = []
  const unsupported = []
  const usage = new Map()
  const declaredBy = new Map()
  let tileCount = 0
  let brokenCount = 0
  let unresolvedCount = 0

  // A name that does not survive rendering is refused rather than listed under
  // a name that is not its name. The code points are named because the rendered
  // forms of two such entries can be identical: "this differs from what you
  // see" is the `kWh -> kWh` report again, and it tells the reader nothing.
  for (const entry of listing.unnameable) {
    unreadable.push({ file: entry.file, reason: entry.reason })
    report.add('path-unrenderable', {
      file: entry.file,
      message:
        `this directory entry carries ${entry.codePoints.join(', ')} in its name, which the report and the map `
        + 'strip before rendering, so the name shown here is not the name on disk and nothing in this map could '
        + 'name the file faithfully; it was not read',
      suggestion: 'rename the file to characters that render as themselves, and run again',
    })
  }

  for (const entry of listing.refused) {
    unreadable.push({ file: entry.file, reason: entry.reason })
    report.add('path-outside-root', {
      file: entry.file,
      message:
        `this dashboard export ${entry.detail}; no tile, query or model edge is taken from it, so the map `
        + 'does not name an in-root path for evidence that was read somewhere else',
      suggestion: 'name the real path with --dashboards, or move the export inside the root',
    })
  }

  for (const candidate of listing.files) {
    const document = await readJsonDocument(candidate.absolute, limits)
    if (!document.ok) {
      unreadable.push({ file: candidate.file, reason: 'unreadable' })
      report.add('dashboard-unreadable', { file: candidate.file, message: `this dashboard export ${document.detail}` })
      continue
    }
    const format = declaredFormat(document.value)
    // The map records what the FINDING says, not the raw bytes. `declaredFormat`
    // is document content: a format string carrying U+0085 or U+202E forges a
    // line or reverses one in any consumer that prints the map, and
    // `JSON.stringify` escapes neither.
    const renderedFormat = format.ok ? excerpt(format.format, 80) : null
    if (!format.ok) {
      unsupported.push({ file: candidate.file, declaredFormat: null, reason: 'undeclared-format' })
      report.add('dashboard-format-undeclared', {
        file: candidate.file,
        pointer: '/format',
        message: format.reason === 'not-an-object'
          ? `this dashboard export is ${format.typeName}, not an object, so no lineage is read from it`
          : 'this dashboard export declares no format, so no lineage is read from it',
        suggestion: `declare "format": "${SUPPORTED_DASHBOARD_FORMATS[0]}", or convert the export`,
      })
      continue
    }
    if (!SUPPORTED_DASHBOARD_FORMATS.includes(format.format)) {
      unsupported.push({ file: candidate.file, declaredFormat: renderedFormat, reason: 'unsupported-format' })
      report.add('dashboard-format-unsupported', {
        file: candidate.file,
        pointer: '/format',
        message:
          `this dashboard export declares format "${excerpt(format.format, 80)}", which this tool does not read; `
          + `it reads ${SUPPORTED_DASHBOARD_FORMATS.join(', ')}. No tile, query or model edge is taken from it`,
        suggestion: 'convert the export to a format this tool supports; nothing here guesses at an unknown one',
      })
      continue
    }
    const compiled = compileDashboard(document.value, limits)
    if (!compiled.ok) {
      unsupported.push({ file: candidate.file, declaredFormat: renderedFormat, reason: 'invalid-document' })
      for (const problem of compiled.problems) {
        report.add('dashboard-invalid', {
          file: candidate.file,
          pointer: problem.pointer === '' ? '/' : problem.pointer,
          message: `${problem.pointer === '' ? 'the document' : problem.pointer} ${problem.message}`,
        })
      }
      continue
    }

    const dashboard = compiled.dashboard
    // The map keys every tile by `dashboardId/tileId`, so two export files
    // claiming one dashboard id produce entries that cannot be resolved back to
    // a file and a usage count that under-reports. The second file is named and
    // contributes nothing rather than being merged into the first.
    const claimed = declaredBy.get(dashboard.dashboardId)
    if (claimed !== undefined) {
      unsupported.push({ file: candidate.file, declaredFormat: renderedFormat, reason: 'duplicate-dashboard-id' })
      report.add('dashboard-id-duplicated', {
        file: candidate.file,
        pointer: '/dashboardId',
        message:
          `this export declares dashboard id "${dashboard.dashboardId}", which "${claimed}" already declared; `
          + 'the map keys every tile by dashboard id, so no tile, query or model edge is taken from this file',
        suggestion: 'give each dashboard export its own dashboardId, or remove the duplicate export',
      })
      continue
    }
    declaredBy.set(dashboard.dashboardId, candidate.file)
    const tiles = []
    for (const tile of [...dashboard.tiles].sort((left, right) => byCodeUnit(left.id, right.id))) {
      const mapped = mapTile({
        tile,
        queries: dashboard.queries,
        models,
        report,
        file: candidate.file,
        dashboardId: dashboard.dashboardId,
        usage,
      })
      tiles.push(mapped.tile)
      tileCount += 1
      if (mapped.tile.lineage === 'broken') brokenCount += 1
      else if (mapped.tile.lineage === 'unresolved') unresolvedCount += 1
    }
    dashboards.push({ file: candidate.file, dashboardId: dashboard.dashboardId, title: dashboard.title, tiles })
  }

  if (dashboards.length === 0) {
    report.add('no-dashboard-read', {
      file: dashboardsDirectory,
      message:
        `no dashboard export in this directory could be read in a format this tool supports `
        + `(${listing.files.length} JSON file(s) were considered), so this map describes nothing`,
      suggestion: 'a map of no dashboards is not a green run; point --dashboards at exports this tool can read',
    })
  }

  const mappedModels = []
  if (models.available) {
    for (const model of [...models.models].sort((left, right) => byCodeUnit(left.id, right.id))) {
      const usedByTiles = [...(usage.get(model.id) ?? new Set())].sort(byCodeUnit)
      if (usedByTiles.length === 0 && dashboards.length > 0) {
        report.add('model-unused', {
          file: modelsFile,
          pointer: `/models/${model.id}`,
          message: `no tile in any dashboard read by this run reaches model "${model.id}"`,
        })
      }
      if (model.freshness === null && usedByTiles.length > 0) {
        report.add('freshness-evidence-absent', {
          file: modelsFile,
          pointer: `/models/${model.id}`,
          message:
            `model "${model.id}" is read by ${usedByTiles.length} tile(s) and the export declares no freshness `
            + 'evidence for it, so the map records its freshness as unknown',
          suggestion: 'add a freshness observation to the export; this tool reads no clock and cannot supply one',
        })
      }
      for (const upstreamId of model.upstreamIds) {
        if (!models.index.live.has(upstreamId) && !models.index.previous.has(upstreamId)) {
          report.add('upstream-missing', {
            file: modelsFile,
            pointer: `/models/${model.id}`,
            message: `model "${model.id}" declares upstream "${upstreamId}", and the export declares no such model`,
          })
        }
      }
      mappedModels.push({
        id: model.id,
        previousIds: [...model.previousIds].sort(byCodeUnit),
        transformation: model.transformation,
        upstreamIds: [...model.upstreamIds].sort(byCodeUnit),
        freshness: freshnessOf(model),
        usedByTiles,
      })
    }
  }

  const map = {
    schema: SOURCE_MAP_SCHEMA,
    tool: TOOL_ID,
    dashboards,
    unreadable,
    unsupported,
    skipped: listing.skipped,
    models: mappedModels,
  }

  const counts = {
    checked: listing.files.length,
    dashboards: dashboards.length,
    tiles: tileCount,
    broken: brokenCount,
    unresolvedTiles: unresolvedCount,
  }
  // Added through the same path as every other finding, so it takes its
  // severity from the frozen table and sorts with the rest. A finding appended
  // to a finished report is a finding outside both.
  //
  // The claim is about the MAP, so it is derived from the map. Deriving it from
  // finding severities alone was right only by accident: every unresolved
  // reason currently carries a non-info finding, so deleting a single
  // `report.add` was enough to make the completion claim fire beside
  // `unresolvedTiles: 2`. The counts below come from the tiles themselves and
  // say what the sentence says.
  const everyTileResolved = brokenCount === 0 && unresolvedCount === 0
  const clean = !report.incomplete
    && everyTileResolved
    && !report.findings.some((finding) => finding.severity !== 'info')
  if (clean && tileCount > 0) {
    report.add('source-map-complete', {
      file: dashboardsDirectory,
      message:
        `every one of ${tileCount} tile(s) across ${dashboards.length} dashboard(s) resolves to a query its `
        + 'dashboard declares, every model that query names resolves in the model export, and every model '
        + 'reached carries freshness evidence (a model may legitimately declare no transformation: a raw '
        + 'source is not produced by one)',
    })
  }
  return { report: report.finish(counts), map, touched }
}
