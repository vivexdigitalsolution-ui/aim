// Link a Japan auction lot to the CarzNexus vehicle catalog (brand > model > model code > variant), by ids only.
// The same ids are what CarzNexus listings will carry (brand_id / model_id / variant_id), so the two sides meet on ids, never on names.
// No guessing: a link is made only when the chassis code AND (for a variant) the grade words say so. Otherwise: model level, or none.

export interface CatalogVariant { brand_id: string; model_id: string; model?: string | null; model_code: string | null; variant_id: string; variant: string; variant_ja?: string | null }
export interface CatalogAlias { variant_id: string; name: string }          // vehicle_variants_lookup: other spellings of a grade ("2.5S Type Gold 3")
export type LinkLevel = 'variant' | 'model' | 'none'
export interface CatalogLink { brandId: string | null; modelId: string | null; variantId: string | null; level: LinkLevel; how: string }

/** "3BA-AGH30W" / "agh30w" -> AGH30W : the chassis code without the emission prefix. */
export const baseCode = (code: string | null | undefined): string => String(code || '').toUpperCase().replace(/^[0-9A-Z]{2,4}-/, '').replace(/[^A-Z0-9]/g, '')

const ROMAN: Record<string, string> = { 'Ⅰ': 'I', 'Ⅱ': 'II', 'Ⅲ': 'III', 'Ⅳ': 'IV', 'Ⅴ': 'V' }
/** Words and numbers as tokens: "2.5S Type Gold Ⅲ" -> [2,5,S,TYPE,GOLD,III]; letters and digits split, so "2.5SC" never contains "2.5S". */
export function tokens(s: string | null | undefined): string[] {
  const t = String(s || '').replace(/[ⅠⅡⅢⅣⅤ]/g, (c) => ' ' + ROMAN[c] + ' ').toUpperCase()
  return t.match(/[0-9]+|[A-Z]+/g) || []
}
const contains = (hay: string[], needle: string[]): boolean => {
  if (!needle.length || needle.length > hay.length) return false
  for (let i = 0; i + needle.length <= hay.length; i++) if (needle.every((w, j) => hay[i + j] === w)) return true
  return false
}

export function linkLot(catalog: CatalogVariant[], aliases: CatalogAlias[], lot: { model_code?: string | null; model?: string | null }): CatalogLink {
  const none = (how: string): CatalogLink => ({ brandId: null, modelId: null, variantId: null, level: 'none', how })
  const code = baseCode(lot.model_code)
  if (!code) return none('no chassis code')
  let rows = catalog.filter((c) => baseCode(c.model_code) === code)
  if (!rows.length) return none('chassis code ' + code + ' not in the catalog')
  let models = new Set(rows.map((r) => r.model_id))
  if (models.size > 1) {
    // sister cars share a chassis code (Noah / Voxy, Alphard / Vellfire): the lot's own model name says which one
    const text0 = tokens(lot.model)
    const named = [...models].map((id) => ({ id, t: tokens(rows.find((r) => r.model_id === id)!.model) })).filter((m) => contains(text0, m.t))
    const best = Math.max(0, ...named.map((m) => m.t.length))
    const top = named.filter((m) => m.t.length === best)
    if (top.length !== 1) return none('chassis code ' + code + ' belongs to several catalog models and the name does not say which')
    rows = rows.filter((r) => r.model_id === top[0]!.id)
    models = new Set([top[0]!.id])
  }
  const brandId = rows[0]!.brand_id, modelId = rows[0]!.model_id
  const text = tokens(lot.model)
  // every name a variant of this code goes by: its own names plus the lookup spellings
  const names: { variantId: string; t: string[]; direct: boolean }[] = []
  const ids = new Set(rows.map((r) => r.variant_id))
  for (const r of rows) for (const n of [r.variant, r.variant_ja]) if (n) names.push({ variantId: r.variant_id, t: tokens(n), direct: true })
  for (const a of aliases) if (ids.has(a.variant_id)) names.push({ variantId: a.variant_id, t: tokens(a.name), direct: false })
  const hits = names.filter((n) => contains(text, n.t))
  if (hits.length) {
    const best = Math.max(...hits.map((h) => h.t.length))
    // at the same length a variant's OWN name beats an alternate spelling (the lookup table can point one spelling, e.g. "Z", at several variants)
    const tied = hits.filter((h) => h.t.length === best)
    const top = new Set((tied.some((h) => h.direct) ? tied.filter((h) => h.direct) : tied).map((h) => h.variantId))
    if (top.size === 1) return { brandId, modelId, variantId: [...top][0]!, level: 'variant', how: 'chassis code + grade words' }
    return { brandId, modelId, variantId: null, level: 'model', how: 'several variants fit the grade words' }
  }
  return { brandId, modelId, variantId: null, level: 'model', how: 'chassis code known, grade not in the catalog' }
}
