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
 * THIS TOOL SHIPPED THAT EXACT FAILURE ANYWAY, because every bound here was a
 * bound on one document and none was a bound on the run. The product of the
 * per-document bounds -- 200 files x 500 tiles x 100 model references -- is ten
 * million lineage edges, and each edge becomes an object in the map and several
 * hundred bytes of the written document. Measured at the documented maximum on
 * a 128 GB machine: `FATAL ERROR: Ineffective mark-compacts near heap limit`,
 * exit 134, empty stdout, 4.45 GB peak RSS, 460 s. A bound on each part is not
 * a bound on the whole, so `maxTileModelEdges` bounds the whole.
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
  /**
   * Tile-to-model lineage edges built across the WHOLE run.
   *
   * This is the bound on the work, and it is the one that decides how much
   * memory a legal run may use, because the map is held in full before it is
   * serialised. Measured at the documented maximum on the reference machine --
   * 200 exports of 668 KB, 100000 tiles, 100000 edges, 5000 models, every
   * identifier and title at its own limit -- exit 0 in 5.4 s at 1.21 GB peak
   * RSS, writing a 189 MB map. The same edge count with short identifiers cost
   * 514 MB and 48.7 MB of map, so what an edge costs depends on the length of
   * the strings around it.
   */
  maxTileModelEdges: 100000,
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
  '--max-tile-model-edges': 'maxTileModelEdges',
  '--max-findings': 'maxFindings',
})
