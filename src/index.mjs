/**
 * dashboard-source-map -- read dashboard and model exports and say, for every
 * tile, which query it runs, which models that query reads, which
 * transformation produced each model, and what is known about each model's
 * freshness. Broken links are the point of the output, not a side effect.
 *
 * The tool opens no socket, resolves no host, reads no environment variable and
 * reads no clock. Every input is a document somebody exported.
 */

export const TOOL_ID = 'dashboard-source-map'

export { LIMITS, OVERRIDABLE } from './limits.mjs'
export { MAX_DEPTH, canonicalDocument, canonicalJson } from './canonical.mjs'
export { listDashboardDirectory, readJsonDocument, resolveInside, resolveRoot } from './documents.mjs'
export { LINEAGE, buildSourceMap } from './map.mjs'
export { buildModelIndex, resolveModel } from './models.mjs'
export { INCOMPLETE_RULES, RULE_SEVERITY, marksIncomplete, severityOf } from './rules.mjs'
export { ReportBuilder, SCHEMA_VERSION, exitCodeFor, formatReport, serializeReport } from './report.mjs'
export {
  DASHBOARD_FORMAT,
  MODEL_FORMAT,
  SOURCE_MAP_SCHEMA,
  SUPPORTED_DASHBOARD_FORMATS,
  SUPPORTED_MODEL_FORMATS,
  compileDashboard,
  compileModelExport,
  declaredFormat,
} from './schema.mjs'
export {
  EXCERPT_LIMIT,
  byCodeUnit,
  controlCodePoints,
  decodeUtf8,
  excerpt,
  isPlainObject,
  renderable,
  sanitise,
  typeName,
} from './text.mjs'
export { UNPARSEABLE, parseFailureDetail } from './parse-failure.mjs'
export { DestinationError, assertWritableDestination } from './write-guard.mjs'
