/**
 * Listing the dashboard directory and reading documents, under the declared
 * bounds and inside the declared root.
 *
 * Path confinement is not lexical. Rejecting "../" and absolute paths is what a
 * tool in this catalog did before a symlink planted inside its root was
 * followed out of the tree and out-of-root content was echoed into its report.
 * The REAL path is resolved and asserted to be inside the REAL root.
 *
 * Enumeration order never reaches the output: the listing is sorted by UTF-16
 * code unit before anything is read, so two machines with different filesystem
 * orderings produce the same report.
 */

import { open, readdir, realpath, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

import { LIMITS } from './limits.mjs'
import { parseFailureDetail } from './parse-failure.mjs'
import { byCodeUnit, decodeUtf8 } from './text.mjs'

export async function resolveRoot(root) {
  return realpath(resolve(root))
}

/** Read and parse one JSON document. Never returns the text on failure. */
export async function readJsonDocument(absolutePath, limits = LIMITS) {
  let info
  try {
    info = await stat(absolutePath)
  } catch (error) {
    return { ok: false, detail: `could not be opened (${error.code ?? 'unknown error'})` }
  }
  if (!info.isFile()) return { ok: false, detail: 'is not a regular file' }
  if (info.size > limits.maxDocumentBytes) {
    return { ok: false, detail: `is ${info.size} bytes, over the document limit of ${limits.maxDocumentBytes}` }
  }
  let bytes
  let handle
  try {
    handle = await open(absolutePath, 'r')
    bytes = await handle.readFile()
  } catch (error) {
    return { ok: false, detail: `could not be read (${error.code ?? 'unknown error'})` }
  } finally {
    await handle?.close()
  }
  if (bytes.byteLength > limits.maxDocumentBytes) {
    return { ok: false, detail: `is ${bytes.byteLength} bytes, over the document limit of ${limits.maxDocumentBytes}` }
  }
  const decoded = decodeUtf8(bytes)
  if (!decoded.ok) return { ok: false, detail: 'is not valid UTF-8' }
  try {
    return { ok: true, value: JSON.parse(decoded.text) }
  } catch (error) {
    return { ok: false, detail: parseFailureDetail(error) }
  }
}

/** Resolve one declared relative path inside the real root. */
export async function resolveInside(realRoot, relativePath) {
  const joined = resolve(realRoot, relativePath)
  let real
  try {
    real = await realpath(joined)
  } catch (error) {
    return { ok: false, reason: 'unreadable', detail: `could not be resolved (${error.code ?? 'unknown error'})`, touched: [joined] }
  }
  if (real !== realRoot && !real.startsWith(realRoot + sep)) {
    return {
      ok: false,
      reason: 'outside-root',
      detail: 'resolves outside the declared root, so its contents are not evidence about this root',
      touched: [joined, real],
    }
  }
  return { ok: true, absolute: real, touched: [joined, real] }
}

/**
 * List the dashboard directory.
 *
 * The bound on entries is applied to the LISTING, before a single file is
 * opened, so a directory far larger than the tool can handle is refused rather
 * than half-read. Every path listed is returned in `touched` whether or not it
 * is read, because every path this tool reasons about belongs in the set the
 * destination guard compares against.
 *
 * CONFINEMENT IS PER FILE, not per directory. Resolving the directory and then
 * reading whatever the listing hands back is the hole this tool shipped with: a
 * symbolic link planted among the exports was followed out of the declared root,
 * its content was compiled into the map, and the map named it by its IN-ROOT
 * path -- so nothing in the output revealed where the evidence came from. A map
 * that claims to be the lineage of everything under one root, while quietly
 * including content from outside it, is making a false claim about its own
 * provenance. Every entry's REAL path is resolved here and asserted to be inside
 * the REAL root before it is opened.
 */
export async function listDashboardDirectory(realRoot, relativeDirectory, limits = LIMITS) {
  const resolved = await resolveInside(realRoot, relativeDirectory)
  if (!resolved.ok) return { ok: false, reason: resolved.reason, detail: resolved.detail, touched: resolved.touched }
  let entries
  try {
    entries = await readdir(resolved.absolute, { withFileTypes: true })
  } catch (error) {
    return {
      ok: false,
      reason: 'unreadable',
      detail: `could not be listed (${error.code ?? 'unknown error'})`,
      touched: resolved.touched,
    }
  }
  if (entries.length > limits.maxDirectoryEntries) {
    return {
      ok: false,
      reason: 'too-many-entries',
      detail: `holds ${entries.length} entries, over the directory limit of ${limits.maxDirectoryEntries}`,
      touched: resolved.touched,
    }
  }
  const names = entries.map((entry) => entry.name).sort(byCodeUnit)
  const touched = [...resolved.touched]
  const files = []
  const skipped = []
  const refused = []
  for (const name of names) {
    const relative = `${relativeDirectory}/${name}`
    const joined = join(resolved.absolute, name)
    touched.push(joined)
    if (!name.endsWith('.json')) {
      skipped.push({ file: relative, reason: 'not-a-json-file' })
      continue
    }
    const inside = await resolveInside(realRoot, relative)
    touched.push(...inside.touched)
    if (!inside.ok && inside.reason === 'outside-root') {
      refused.push({ file: relative, reason: 'outside-root', detail: inside.detail })
      continue
    }
    // A path that could not be resolved at all is left to the read, which
    // reports why in the same words it uses for every other unreadable export.
    files.push({ file: relative, absolute: inside.ok ? inside.absolute : joined })
  }
  if (files.length > limits.maxDashboardFiles) {
    return {
      ok: false,
      reason: 'too-many-files',
      detail: `holds ${files.length} JSON files, over the dashboard file limit of ${limits.maxDashboardFiles}`,
      touched,
    }
  }
  return { ok: true, files, skipped, refused, touched }
}
