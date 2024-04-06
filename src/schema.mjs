/**
 * The documented shape of a dashboard export and of a model export.
 *
 * The format is read FIRST and on its own. A file whose declared format this
 * tool does not support is reported as unsupported and is never compiled,
 * because compiling it would mean reading a structure this tool guessed at.
 * "It happens to have a `tiles` array" is not the same claim as "this is an
 * export of the format I understand", and only the second one supports a
 * lineage edge.
 *
 * Every key set is an allow-list, and a key the schema does not name is refused
 * rather than ignored: a typo in `queryId` must not silently become a tile with
 * no source.
 *
 * Strings are REFUSED rather than sanitised. Sanitising an identifier would
 * change what it refers to -- two model ids differing only by a bidi mark would
 * collide -- so a field whose rendered form differs from the form it was given
 * is rejected with its pointer. Nothing is silently altered, which closes the
 * gap between "is this present and usable" and "what will be rendered" by
 * construction.
 */

import { LIMITS } from './limits.mjs'
import { controlCodePoints, excerpt, isPlainObject, sanitise, typeName } from './text.mjs'

export const DASHBOARD_FORMAT = 'edilec.dashboard/v1'
export const MODEL_FORMAT = 'edilec.model-export/v1'
export const SOURCE_MAP_SCHEMA = 'edilec.source-map/v1'

/** Exactly what this tool can read. Anything else is unsupported, by name. */
export const SUPPORTED_DASHBOARD_FORMATS = Object.freeze([DASHBOARD_FORMAT])
export const SUPPORTED_MODEL_FORMATS = Object.freeze([MODEL_FORMAT])

const DASHBOARD_KEYS = Object.freeze(['dashboardId', 'format', 'queries', 'tiles', 'title'])
const DASHBOARD_REQUIRED = Object.freeze(['dashboardId', 'format', 'queries', 'tiles'])
const TILE_KEYS = Object.freeze(['id', 'queryId', 'title'])
const TILE_REQUIRED = Object.freeze(['id', 'queryId'])
const QUERY_KEYS = Object.freeze(['description', 'id', 'modelIds', 'unresolvedSources'])
const QUERY_REQUIRED = Object.freeze(['id'])
const UNRESOLVED_KEYS = Object.freeze(['reason'])

const MODEL_DOCUMENT_KEYS = Object.freeze(['format', 'models'])
const MODEL_KEYS = Object.freeze(['freshness', 'id', 'previousIds', 'transformation', 'upstreamIds'])
const MODEL_REQUIRED = Object.freeze(['id'])
const TRANSFORMATION_KEYS = Object.freeze(['id', 'version'])
const FRESHNESS_KEYS = Object.freeze(['observedAt', 'source'])

class Problems {
  constructor() {
    this.list = []
  }

  add(pointer, message) {
    this.list.push({ pointer, message })
  }

  get ok() {
    return this.list.length === 0
  }
}

function checkKeys(value, allowed, required, pointer, problems) {
  if (!isPlainObject(value)) {
    problems.add(pointer, `must be an object, not ${typeName(value)}`)
    return false
  }
  for (const key of Object.keys(value).sort()) {
    // A key is document text, and the pointer built from it is rendered with
    // the control class stripped. `ti<U+202E><U+0085>tle` renders as `title`,
    // so the report would read "/tiles/0/title is not a key this schema
    // defines" about a key this schema does define -- the `kWh -> kWh` finding
    // again, a sentence that reads as false and cannot be acted on. The key is
    // named by its code points instead, on the object that carries it.
    const points = controlCodePoints(key)
    if (points.length > 0) {
      problems.add(
        pointer,
        `has a key carrying ${points.join(', ')}, which this report strips before rendering, so the key cannot be `
        + 'named here; no key this schema defines contains one',
      )
      continue
    }
    if (!allowed.includes(key)) {
      problems.add(`${pointer}/${key}`, `is not a key this schema defines; allowed keys are ${allowed.join(', ')}`)
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) problems.add(`${pointer}/${key}`, 'is required and is missing')
  }
  return true
}

/** A string that is present, bounded, and identical to what will be rendered. */
function cleanString(raw, pointer, problems, limit) {
  if (typeof raw !== 'string') {
    problems.add(pointer, `must be a string, not ${typeName(raw)}`)
    return null
  }
  if (raw.length === 0) {
    problems.add(pointer, 'must not be empty')
    return null
  }
  if (raw.length > limit) {
    problems.add(pointer, `is ${raw.length} characters, over the limit of ${limit}`)
    return null
  }
  if (sanitise(raw) !== raw) {
    problems.add(pointer, 'contains a control, bidi or line-separator character, which would render as something else')
    return null
  }
  return raw
}

function boundedArray(value, pointer, problems, limit, label) {
  if (!Array.isArray(value)) {
    problems.add(pointer, `must be an array, not ${typeName(value)}`)
    return null
  }
  if (value.length > limit) {
    problems.add(pointer, `holds ${value.length} ${label}, over the limit of ${limit}`)
    return null
  }
  return value
}

function identifierList(raw, pointer, problems, limits, limit, label) {
  const list = boundedArray(raw ?? [], pointer, problems, limit, label)
  if (list === null) return []
  const values = list.map((value, index) => cleanString(value, `${pointer}/${index}`, problems, limits.maxIdentifierChars))
  const seen = new Set()
  values.forEach((value, index) => {
    if (value === null) return
    if (seen.has(value)) problems.add(`${pointer}/${index}`, `repeats "${excerpt(value, 80)}"`)
    seen.add(value)
  })
  return values.filter((value) => value !== null)
}

function uniqueIds(entries, pointer, problems, label) {
  const seen = new Set()
  entries.forEach((entry, index) => {
    if (entry.id === null) return
    if (seen.has(entry.id)) problems.add(`${pointer}/${index}/id`, `repeats the ${label} "${excerpt(entry.id, 80)}"`)
    seen.add(entry.id)
  })
}

/**
 * Read the declared format of a parsed document, and nothing else.
 *
 * Deliberately separate from compilation. A file this tool cannot read must be
 * reported by the format it declares, without any statement about its contents.
 */
export function declaredFormat(document) {
  if (!isPlainObject(document)) return { ok: false, reason: 'not-an-object', typeName: typeName(document) }
  const format = document.format
  if (typeof format !== 'string' || format.length === 0) {
    return { ok: false, reason: 'undeclared', typeName: typeName(format) }
  }
  return { ok: true, format }
}

/** Validate a parsed dashboard export whose format is already known to be supported. */
export function compileDashboard(document, limits = LIMITS) {
  const problems = new Problems()
  if (!checkKeys(document, DASHBOARD_KEYS, DASHBOARD_REQUIRED, '', problems)) {
    return { ok: false, problems: problems.list }
  }
  const dashboardId = cleanString(document.dashboardId, '/dashboardId', problems, limits.maxIdentifierChars)
  const title = document.title === undefined || document.title === null
    ? null
    : cleanString(document.title, '/title', problems, limits.maxTextChars)

  const tilesRaw = boundedArray(document.tiles, '/tiles', problems, limits.maxTiles, 'tiles')
  const tiles = (tilesRaw ?? []).map((entry, index) => {
    const at = `/tiles/${index}`
    if (!checkKeys(entry, TILE_KEYS, TILE_REQUIRED, at, problems)) return { id: null, title: null, queryId: null }
    return {
      id: cleanString(entry.id, `${at}/id`, problems, limits.maxIdentifierChars),
      title: entry.title === undefined || entry.title === null
        ? null
        : cleanString(entry.title, `${at}/title`, problems, limits.maxTextChars),
      queryId: cleanString(entry.queryId, `${at}/queryId`, problems, limits.maxIdentifierChars),
    }
  })
  uniqueIds(tiles, '/tiles', problems, 'tile id')

  const queriesRaw = boundedArray(document.queries, '/queries', problems, limits.maxQueries, 'queries')
  const queries = (queriesRaw ?? []).map((entry, index) => {
    const at = `/queries/${index}`
    if (!checkKeys(entry, QUERY_KEYS, QUERY_REQUIRED, at, problems)) {
      return { id: null, description: null, modelIds: [], unresolvedSources: [] }
    }
    const unresolvedRaw = boundedArray(
      entry.unresolvedSources ?? [], `${at}/unresolvedSources`, problems, limits.maxQueryReferences, 'unresolved sources',
    )
    const unresolvedSources = (unresolvedRaw ?? []).map((note, position) => {
      const where = `${at}/unresolvedSources/${position}`
      if (!checkKeys(note, UNRESOLVED_KEYS, UNRESOLVED_KEYS, where, problems)) return null
      return cleanString(note.reason, `${where}/reason`, problems, limits.maxTextChars)
    }).filter((reason) => reason !== null)
    const modelIds = identifierList(
      entry.modelIds, `${at}/modelIds`, problems, limits, limits.maxQueryReferences, 'model references',
    )
    // A query that declares neither a model reference nor an unresolved source
    // says nothing at all about what it reads. Recording the tile behind it as
    // "resolved, reads nothing" would assert something the export never said,
    // so the export is refused instead.
    if (modelIds.length === 0 && unresolvedSources.length === 0) {
      problems.add(
        at,
        'declares neither a model reference nor an unresolved source, so it says nothing about what it reads',
      )
    }
    return {
      id: cleanString(entry.id, `${at}/id`, problems, limits.maxIdentifierChars),
      description: entry.description === undefined || entry.description === null
        ? null
        : cleanString(entry.description, `${at}/description`, problems, limits.maxTextChars),
      modelIds,
      unresolvedSources,
    }
  })
  uniqueIds(queries, '/queries', problems, 'query id')

  if (!problems.ok) return { ok: false, problems: problems.list }
  return { ok: true, dashboard: { dashboardId, title, tiles, queries } }
}

/** Validate a parsed model export whose format is already known to be supported. */
export function compileModelExport(document, limits = LIMITS) {
  const problems = new Problems()
  if (!checkKeys(document, MODEL_DOCUMENT_KEYS, MODEL_DOCUMENT_KEYS, '', problems)) {
    return { ok: false, problems: problems.list }
  }
  const modelsRaw = boundedArray(document.models, '/models', problems, limits.maxModels, 'models')
  const models = (modelsRaw ?? []).map((entry, index) => {
    const at = `/models/${index}`
    if (!checkKeys(entry, MODEL_KEYS, MODEL_REQUIRED, at, problems)) {
      return { id: null, previousIds: [], upstreamIds: [], transformation: null, freshness: null }
    }
    let transformation = null
    if (entry.transformation !== undefined && entry.transformation !== null) {
      if (checkKeys(entry.transformation, TRANSFORMATION_KEYS, TRANSFORMATION_KEYS, `${at}/transformation`, problems)) {
        transformation = {
          id: cleanString(entry.transformation.id, `${at}/transformation/id`, problems, limits.maxIdentifierChars),
          version: cleanString(entry.transformation.version, `${at}/transformation/version`, problems, limits.maxTextChars),
        }
      }
    }
    let freshness = null
    if (entry.freshness !== undefined && entry.freshness !== null) {
      if (checkKeys(entry.freshness, FRESHNESS_KEYS, FRESHNESS_KEYS, `${at}/freshness`, problems)) {
        freshness = {
          observedAt: cleanString(entry.freshness.observedAt, `${at}/freshness/observedAt`, problems, limits.maxTextChars),
          source: cleanString(entry.freshness.source, `${at}/freshness/source`, problems, limits.maxTextChars),
        }
      }
    }
    return {
      id: cleanString(entry.id, `${at}/id`, problems, limits.maxIdentifierChars),
      previousIds: identifierList(entry.previousIds, `${at}/previousIds`, problems, limits, limits.maxPreviousIds, 'previous ids'),
      upstreamIds: identifierList(entry.upstreamIds, `${at}/upstreamIds`, problems, limits, limits.maxUpstreamIds, 'upstream ids'),
      transformation,
      freshness,
    }
  })
  uniqueIds(models, '/models', problems, 'model id')

  if (!problems.ok) return { ok: false, problems: problems.list }
  return { ok: true, models }
}
