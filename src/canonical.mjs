/**
 * One canonical serialisation for the source map written to disk.
 *
 * Object keys are ordered by UTF-16 code unit, so the bytes do not depend on
 * insertion order, on a hash map, or on the machine. A source map that is
 * regenerated on every run and committed beside the dashboards is only useful
 * if an unchanged export produces an unchanged file.
 */

import { EXCERPT_LIMIT, byCodeUnit, sanitise } from './text.mjs'

/** Deeper than any source map this tool builds; a guard against a cyclic value. */
export const MAX_DEPTH = 16

function encode(value, indent, depth, pad) {
  if (depth > MAX_DEPTH) throw new TypeError(`value nests deeper than ${MAX_DEPTH} levels`)
  if (value === null) return 'null'
  const kind = typeof value
  if (kind === 'boolean') return value ? 'true' : 'false'
  if (kind === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('a non-finite number has no canonical form')
    return JSON.stringify(value)
  }
  if (kind === 'string') return JSON.stringify(value)
  const nextPad = pad + ' '.repeat(indent)
  const open = indent === 0 ? '' : `\n${nextPad}`
  const close = indent === 0 ? '' : `\n${pad}`
  const join = indent === 0 ? ',' : `,\n${nextPad}`
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const parts = value.map((item) => encode(item, indent, depth + 1, nextPad))
    return `[${open}${parts.join(join)}${close}]`
  }
  if (kind === 'object') {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort(byCodeUnit)
    if (keys.length === 0) return '{}'
    const gap = indent === 0 ? ':' : ': '
    const parts = keys.map((key) => `${JSON.stringify(key)}${gap}${encode(value[key], indent, depth + 1, nextPad)}`)
    return `{${open}${parts.join(join)}${close}}`
  }
  throw new TypeError(`a value of type ${kind} has no canonical form`)
}

/** The compact canonical form. */
export function canonicalJson(value) {
  return encode(value, 0, 0, '')
}

/** The same ordering, indented, with a trailing newline. This is what gets written. */
export function canonicalDocument(value) {
  return `${encode(value, 2, 0, '')}\n`
}

/**
 * Why a value could not be serialised, in words a caller can act on.
 *
 * Serialising and writing are separate acts that fail for unrelated reasons,
 * and they were reported as one: a map too large for a single JavaScript string
 * came out of the CLI as `--out could not be written (unknown error)`, which
 * names the wrong act and leaves the reader with nothing to do. The only
 * reachable cause of that RangeError here is size, and the only way to reach it
 * is to raise the edge limit, so the flag is named.
 *
 * `error.message` is read with a type check rather than `String(error.message)`,
 * which throws for an object whose `toString` is not callable -- a diagnostic
 * path that throws is how a bad value becomes a stack trace.
 */
export function canonicalFailureDetail(error) {
  if (error instanceof RangeError) {
    return 'the map is larger than one JavaScript string can hold; lower --max-tile-model-edges and run again'
  }
  const message = typeof error?.message === 'string' ? error.message : 'unknown error'
  return sanitise(message).slice(0, EXCERPT_LIMIT)
}
