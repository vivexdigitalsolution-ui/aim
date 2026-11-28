'use strict'

/**
 * lib/asnet/photos.js — which pictures one ASNET car has.
 *
 * The list only gives the cover's link (…/<car number>f.jpg). Every other picture has the same car number with another ending,
 * and the picture server answers "not found" for an ending that does not exist. Seen on real cars (28 Nov 2026):
 *   o                 the auction sheet
 *   f                 the cover
 *   one letter a..z   older cars, often all their pictures (r and i are NOT always rear / interior)
 *   s16, s17 … s43    more pictures; the numbers do not start at 1
 *   sp1, sp2 …        the newer naming
 * So every letter is asked for, and the numbers 20 at a time until 20 in a row do not exist.
 * ASNET sometimes lists the same shot twice (f and z): the second copy is left out.
 */

const LETTERS = [...new Set(['f', 'r', 'i', ...'zyxwvutsrqpnmlkjhgedcba'])]      // 'o' is the sheet
const SERIES = ['s', 'sp']
const BLOCK = 20, LAST = 100, AT_ONCE = 6
const SAME_SHOT = 6      // mean difference of two small copies, 0..255. Seen: the same shot twice 1.2, the closest two different shots 31

/** runs fn over the items a few at a time and keeps their order; waits for all of them before reporting a failure */
async function inGroups(items, fn, size = AT_ONCE) {
  const out = []
  for (let i = 0; i < items.length; i += size) {
    const done = await Promise.allSettled(items.slice(i, i + size).map(fn))
    const bad = done.find((d) => d.status === 'rejected')
    if (bad) throw bad.reason
    out.push(...done.map((d) => d.value))
  }
  return out
}

/**
 * @param {(ending:string) => Promise<Buffer|null>} get   null = that picture does not exist; it throws when it cannot tell
 * @returns {Promise<{ending:string, data:Buffer}[]>} the car's pictures in order, without the sheet
 */
async function findPhotos(get) {
  const ask = async (endings) => (await inGroups(endings, async (ending) => ({ ending, data: await get(ending) }))).filter((p) => p.data)
  const found = await ask(LETTERS)
  for (const prefix of SERIES) {
    for (let from = 1; from <= LAST; from += BLOCK) {
      const hits = await ask(Array.from({ length: BLOCK }, (_, k) => prefix + (from + k)))
      if (!hits.length) break
      found.push(...hits)
    }
  }
  return found
}

const difference = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]); return d / a.length }

/**
 * Leaves out a picture that looks the same as one already kept.
 * @param {(data:Buffer) => Promise<Buffer>} small   a small copy of fixed size, as plain pixel bytes
 */
async function withoutRepeats(photos, small) {
  const marks = await inGroups(photos, (p) => small(p.data))
  const kept = []
  photos.forEach((p, i) => {
    if (!kept.some((k) => marks[k].length === marks[i].length && difference(marks[k], marks[i]) < SAME_SHOT)) kept.push(i)
  })
  return kept.map((i) => photos[i])
}

module.exports = { findPhotos, withoutRepeats, inGroups }
