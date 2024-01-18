/**
 * The model index, and why a dropped entry is never a clean answer.
 *
 * A model export can name the same former id twice, or claim a former id that
 * another model still uses as its live id. Either way the index cannot say
 * which model a reference to that id means.
 *
 * The tempting shape is to drop the ambiguous entry while building the index
 * and let the lookup fall through. The lookup then answers "missing", which is
 * a POSITIVE claim -- no model provides this id -- made on evidence that was
 * thrown away a moment earlier. That exact shape shipped in this catalog: a
 * tool dropped values it could not evaluate out of the index it compared
 * against, then asserted that a literal matched nothing in the group and exited
 * 0, while three of the four candidates had been silently discarded.
 *
 * So ambiguity is recorded, not dropped, and `resolveModel` reports it as its
 * own state. An ambiguous id never becomes a missing id.
 */

import { byCodeUnit } from './text.mjs'

export function buildModelIndex(models) {
  const live = new Map()
  for (const model of models) live.set(model.id, model)
  const previous = new Map()
  for (const model of models) {
    for (const former of model.previousIds) {
      if (!previous.has(former)) previous.set(former, [])
      previous.get(former).push(model.id)
    }
  }
  const ambiguous = new Map()
  for (const [former, claimants] of previous) {
    const sorted = [...claimants].sort(byCodeUnit)
    if (live.has(former)) {
      ambiguous.set(former, {
        reason: 'still-live',
        claimants: sorted,
        detail:
          `"${former}" is claimed as a former id by ${sorted.map((id) => `"${id}"`).join(', ')} and is also a live `
          + 'model id, so a reference to it could mean either',
      })
    } else if (sorted.length > 1) {
      ambiguous.set(former, {
        reason: 'claimed-twice',
        claimants: sorted,
        detail: `"${former}" is claimed as a former id by ${sorted.map((id) => `"${id}"`).join(' and ')}`,
      })
    }
  }
  return { live, previous, ambiguous }
}

/**
 * Resolve one reference.
 *
 * Four answers, and they are not interchangeable: `resolved` by its live id,
 * `resolved` through a recorded rename, `ambiguous` when the index holds more
 * than one candidate, and `missing` when the index holds none. Only the last
 * one asserts that nothing provides the id.
 */
export function resolveModel(index, id) {
  const direct = index.live.get(id)
  if (direct !== undefined) return { state: 'resolved', model: direct, via: 'id' }
  const collision = index.ambiguous.get(id)
  if (collision !== undefined) return { state: 'ambiguous', ...collision }
  const claimants = index.previous.get(id)
  if (claimants !== undefined) {
    return { state: 'resolved', model: index.live.get(claimants[0]), via: 'previousId' }
  }
  return { state: 'missing' }
}
