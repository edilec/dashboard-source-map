/**
 * Declared bounds, enforced BEFORE the work rather than after it.
 *
 * A tool that dies of heap exhaustion at a size its own documentation calls
 * legal has already happened in this catalog: exit 134, empty stdout, outside
 * the documented exit contract. So the directory listing is bounded before any
 * file is opened, every document's size comes from `stat` before its bytes are
 * read, and every count is checked against the parsed document before the map
 * is built.
 *
 * Every bound here is tested from BOTH sides: that it refuses at N+1 and that
 * it stays silent at exactly N.
 */
export const LIMITS = Object.freeze({
  /** Bytes of any single JSON document. */
  maxDocumentBytes: 1048576,
  /** Entries the dashboard directory may hold, counted from the listing. */
  maxDirectoryEntries: 1000,
  /** Dashboard export files read in one run. */
  maxDashboardFiles: 200,
  /** Tiles in one dashboard export. */
  maxTiles: 500,
  /** Queries in one dashboard export. */
  maxQueries: 500,
  /** Models in one model export. */
  maxModels: 5000,
  /** Model references, and unresolved-source notes, on one query. */
  maxQueryReferences: 100,
  /** Upstream ids on one model. */
  maxUpstreamIds: 100,
  /** Former ids one model may claim. */
  maxPreviousIds: 20,
  /** Characters of an identifier: dashboard, tile, query, model, transformation. */
  maxIdentifierChars: 200,
  /** Characters of free text: a title, a description, a reason, a freshness label. */
  maxTextChars: 300,
  /** Findings emitted before the report says it stopped counting. */
  maxFindings: 500,
})

/** The names a caller may override on the command line, and their bound keys. */
export const OVERRIDABLE = Object.freeze({
  '--max-document-bytes': 'maxDocumentBytes',
  '--max-directory-entries': 'maxDirectoryEntries',
  '--max-dashboard-files': 'maxDashboardFiles',
  '--max-tiles': 'maxTiles',
  '--max-queries': 'maxQueries',
  '--max-models': 'maxModels',
  '--max-query-references': 'maxQueryReferences',
  '--max-upstream-ids': 'maxUpstreamIds',
  '--max-previous-ids': 'maxPreviousIds',
  '--max-findings': 'maxFindings',
})
