// Car features: every feature of a car must be findable (JBL audio + GR body kit in a Vellfire, without opening sheets one by one).
// Two layers:
//   1. Claude reads the sheet and returns a list of features (FEATURE_SCHEMA), each with the printed words that show it. Whether a part is
//      original or not is NOT recorded: a sheet rarely says, and a wrong label is worse than none. Buyers only need to know the car has it.
//   2. normalizeFeatures() maps each one onto the catalog below so "JBL 14SP", "ＪＢＬ", "ジェービーエル" are all the key `jbl`.
//      textFeatures() is the free fallback: the same catalog matched on the sheet text with no AI.
// A feature the catalog does not know is kept as a free tag (key `x:<slug>`), so nothing Claude read is lost.

export type FeatureSource = 'factory' | 'dealer_option' | 'aftermarket' | 'unknown'
export interface Feature { key: string; label: string; group: string; source: FeatureSource; evidence?: string }
interface Def { key: string; label: string; group: string; re: RegExp }

const D = (key: string, label: string, group: string, re: RegExp): Def => ({ key, label, group, re })
export const CATALOG: Def[] = [
  D('jbl', 'JBL audio', 'Audio', /\bJBL\b|ジェービーエル/i),
  D('mark_levinson', 'Mark Levinson', 'Audio', /MARK\s*LEVINSON|マークレビンソン/i),
  D('burmester', 'Burmester', 'Audio', /BURMESTER|ブルメスター/i),
  D('bose', 'Bose audio', 'Audio', /\bBOSE\b|ボーズ/i),
  D('bang_olufsen', 'Bang & Olufsen', 'Audio', /BANG\s*(&|AND)?\s*OLUFSEN|B\s*&\s*O\b/i),
  D('harman_kardon', 'Harman Kardon', 'Audio', /HARMAN\s*KARDON|ハーマンカードン/i),
  D('rear_entertainment', 'Rear entertainment', 'Audio', /REAR\s*(SEAT\s*)?(ENTERTAINMENT|MONITOR|DISPLAY)|フリップダウン|後席モニター|リアモニター/i),
  D('sunroof', 'Sunroof', 'Roof', /SUN\s*ROOF|MOON\s*ROOF|(?<![A-Z]\/)S\/R\b|サンルーフ|ムーンルーフ/i),
  D('panoramic_roof', 'Panoramic roof', 'Roof', /PANORAMIC\s*(SUN\s*)?(ROOF|GLASS)|パノラマ(ルーフ|サンルーフ)|GLASS\s*ROOF/i),
  D('gr_kit', 'GR body kit', 'Body kit', /\bGR\s*(AERO|KIT|BODY|PARTS|STYLE|BUMPER)|TRD\s*GR|GRパーツ|GRエアロ/i),
  D('gr_sport', 'GR Sport grade', 'Grade', /\bGR\s*SPORT\b|GRスポーツ/i),
  D('modellista', 'Modellista kit', 'Body kit', /MODELLISTA|モデリスタ/i),
  D('trd_kit', 'TRD kit', 'Body kit', /\bTRD\b(?!\s*GR)|ＴＲＤ/i),
  D('nismo_kit', 'NISMO parts', 'Body kit', /NISMO|ニスモ/i),
  D('mugen', 'Mugen parts', 'Body kit', /MUGEN|無限/i),
  D('amg_package', 'AMG package', 'Body kit', /AMG\s*(LINE|PACKAGE|SPORT)/i),
  D('m_sport', 'M Sport package', 'Body kit', /\bM[\s-]?SPORT\b|Mスポーツ/i),
  D('s_line', 'S line package', 'Body kit', /\bS[\s-]?LINE\b|Sライン/i),
  D('aero_kit', 'Aero kit (other)', 'Body kit', /AERO\s*(KIT|PARTS|BUMPER)|エアロ/i),
  D('leather', 'Leather seats', 'Interior', /LEATHER|本革|革シート|レザー/i),
  D('alcantara', 'Alcantara', 'Interior', /ALCANTARA|アルカンターラ/i),
  D('heated_seats', 'Heated seats', 'Interior', /HEATED\s*SEAT|SEAT\s*HEATER|シートヒーター/i),
  D('ventilated_seats', 'Ventilated seats', 'Interior', /VENTILATED|COOLED\s*SEAT|ベンチレーション|シートエアコン/i),
  D('captain_seats', 'Captain seats', 'Interior', /CAPTAIN|キャプテンシート|エグゼクティブラウンジ/i),
  D('power_sliding_doors', 'Power sliding doors', 'Convenience', /POWER\s*SLID|ELECTRIC\s*SLID|(両側|左側|右側)?(電動|パワー|P)スライド|パワスラ|(?<![A-Z])PSD(?![A-Z])|(両側|左側|右側)PSD/i),
  D('power_tailgate', 'Power tailgate', 'Convenience', /POWER\s*(BACK|TAIL|LIFT)\s*(DOOR|GATE)|電動(バック|テール)ゲート|パワー(バックドア|テールゲート|リフトゲート)/i),
  D('surround_camera', '360° camera', 'Safety', /(360|SURROUND|AROUND\s*VIEW|PANORAMIC\s*VIEW)\s*(°|DEGREE)?\s*(CAMERA|MONITOR|VIEW)|全方位|パノラミックビュー/i),
  D('adaptive_cruise', 'Adaptive cruise control', 'Safety', /ADAPTIVE\s*CRUISE|ACC\b|レーダークルーズ|全車速/i),
  D('head_up_display', 'Head-up display', 'Safety', /HEAD[\s-]*UP|HUD\b|ヘッドアップ/i),
  D('safety_package', 'Safety package', 'Safety', /SAFETY\s*(SUPPORT|SENSE|PACKAGE|PLUS)|セーフティ/i),
  D('4wd', '4WD / AWD', 'Drive', /\b4WD\b|\bAWD\b|四駆|4輪駆動/i),
  D('air_suspension', 'Air suspension', 'Chassis', /AIR\s*SUS|AIR\s*SUSPENSION|エアサス/i),
  D('coilovers', 'Coilovers / lowered', 'Chassis', /COILOVER|COIL\s*OVER|LOWERED|車高調|ローダウン/i),
  D('aftermarket_wheels', 'Alloy wheels', 'Wheels', /AFTERMARKET\s*WHEEL|ALLOY\s*WHEELS?\s*\(?(NON|AFTER)|社外(アルミ|ホイール)|社外\s*\d+\s*(インチ|inch)/i),
  D('sport_exhaust', 'Sports exhaust', 'Exhaust', /AKRAPOVI[CČ]|アクラポ|FUJITSUBO|フジツボ|(SPORTS?|AFTERMARKET)\s*(EXHAUST|MUFFLER)|(社外|スポーツ)\s*(マフラー(?!カッター)|エキゾースト)|(HKS|BLITZ|TRD|MUGEN|無限|NISMO|ニスモ|SPOON|スプーン|MODELLISTA|モデリスタ)[^、,・\/\n]{0,15}(マフラー(?!カッター)|エキゾースト|EXHAUST|MUFFLER)/i),
  D('large_display', 'Large display / navi', 'Infotainment', /(?<![\d.])(9|1[0-4])(\.\d)?\s*(INCH|")\s*(DISPLAY|NAVI|MONITOR)|(?<![\d.])(9|1[0-4])(\.\d)?インチ(?!\s*(AW|アルミ|ホイール))/i),
  D('android_carplay', 'CarPlay / Android Auto', 'Infotainment', /CARPLAY|ANDROID\s*AUTO/i),
]

export const FEATURE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['features'],
  properties: {
    features: {
      type: 'array',
      description: 'Every notable feature, option, package, modification or equipment item shown on the sheet or in the text. One item per feature. Nothing that is not shown.',
      items: {
        type: 'object', additionalProperties: false, required: ['name', 'evidence'],
        properties: {
          name: { type: 'string', description: 'the feature in English, short, naming what the printed words show (e.g. "JBL 14 speaker audio", "GR aero kit", "sunroof"). Never the words aftermarket, genuine or original' },
          evidence: { type: 'string', description: 'the exact words from the sheet or text (Japanese or English) that show it, max 12 words' },
        },
      },
    },
  },
} as const

export const FEATURE_SYSTEM = `You list the features of ONE used Japanese car from its auction sheet and listing text, so a buyer can search for them (for example an audio brand, a body kit, a sunroof).
Rules:
- Only features that are shown on the sheet or in the text. If it is not printed there, the car does not have it: never add a feature because the model "usually has it", and never guess an audio or kit brand that is not printed. A feature without its printed words (evidence) is discarded.
- Do not say or judge whether a part is original, a maker option or aftermarket. Only say what the car has.
- The name must be the same thing the evidence words name. A brand name does not tell what the part is: "HKS" before a suspension word is suspension, not an exhaust; a camber arm is not a spoiler. If you are not sure what the printed words name, leave the feature out.
- Only this car: use only what is written on its auction sheet and its listing text. Never list a feature because of how the car looks in a photo.
- Keep the evidence words exactly as printed. English names only. Do not mention any company, auction house or website name.`

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40)

/** Takes out claims about whether a part is original: "Aftermarket 19-inch wheels" -> "19-inch wheels". */
export function plainText(text: string): string {
  const out = String(text || '').replace(/\(?\b(after[\s-]?market|non[\s-]?(genuine|original|factory|oem))\b\)?[ \t-]*/gi, '').replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([,.;:)])/g, '$1').trim()
  return out && out !== text ? out.charAt(0).toUpperCase() + out.slice(1) : out
}

// A feature outside the catalog keeps Claude's own name. For the parts that were seen named wrongly, the printed words must name that part too.
const PARTS: [RegExp, RegExp][] = [
  [/spoiler|\bwing\b/i, /SPOILER|WING|スポイラ|(リア|リヤ|フロント|ルーフ|トランク)スポ(?!ーツ)|ウイング|ウィング|エアロ/i],
  [/exhaust|muffler/i, /EXHAUST|MUFFLER|マフラー|エキゾースト/i],
  // "20AW" is how a sheet writes 20-inch alloy wheels; "wheel drive" and a steering wheel are not road wheels
  [/(?<!steering )\bwheels?\b(?![ -]?drive)/i, /WHEEL|TIRE|TYRE|(?<![A-Z])AW(?![A-Z])|アルミ|ホイー?ル|タイヤ|スペア|インチ|INCH|RAYS|レイズ|ENKEI|エンケイ|BBS|WORK|WEDS|TE37|RPF/i],
  [/camera/i, /CAMERA|カメラ|モニター|VIEW|ビュー|ドラレコ|レコーダー/i],
]
/** Do the printed words name the same kind of part as the feature's name? */
export const namesSamePart = (name: string, evidence: string): boolean =>
  PARTS.every(([part, proof]) => !part.test(name) || proof.test(String(evidence || '').normalize('NFKC')))

/** Map Claude's list onto the catalog. A catalog match on the name or the evidence gives the catalog key; anything else is kept as a free tag. */
export function normalizeFeatures(list: { name: string; source?: FeatureSource; evidence?: string }[]): Feature[] {
  const out = new Map<string, Feature>()
  for (const f of list || []) {
    // The sheet is the truth: a feature counts only when the words printed on the sheet (the evidence) show it. A name with no printed proof is dropped.
    const ev = String(f.evidence || '').normalize('NFKC').trim(), source: FeatureSource = 'unknown'      // origin is not recorded
    const name = plainText(f.name || '')
    const hits = CATALOG.filter((d) => d.re.test(ev))
    if (!hits.length && (!ev || CATALOG.some((d) => d.re.test(String(f.name || '').normalize('NFKC'))))) continue      // no proof, or it names a known feature the printed words do not show (a JBL guess)
    if (hits.length) hits.forEach((h) => { if (!out.has(h.key)) out.set(h.key, { key: h.key, label: h.label, group: h.group, source, evidence: f.evidence }) })
    else if (name && slug(name) && namesSamePart(name, ev)) { const k = 'x:' + slug(name); if (!out.has(k)) out.set(k, { key: k, label: name, group: 'Other', source, evidence: f.evidence }) }
  }
  return [...out.values()]
}

/** The free fallback: catalog keys found in plain text (no AI). */
export function textFeatures(...texts: (string | null | undefined)[]): string[] {
  const hay = texts.filter(Boolean).join(' \n ')
  return CATALOG.filter((d) => d.re.test(hay)).map((d) => d.key)
}

/** Does a car (its feature keys) have ALL the wanted features? `aftermarket` can be excluded or required per search. */
export function hasAllFeatures(have: Feature[], wanted: string[], opts: { sources?: FeatureSource[] } = {}): boolean {
  return wanted.every((k) => have.some((f) => f.key === k && (!opts.sources || opts.sources.includes(f.source))))
}

/** Search a list of cars by features (all wanted must be present) and rank by how many extra catalog features they carry. */
export function searchByFeatures<T extends { features: Feature[] }>(cars: T[], wanted: string[], opts: { sources?: FeatureSource[] } = {}): T[] {
  return cars.filter((c) => hasAllFeatures(c.features, wanted, opts)).sort((a, b) => b.features.length - a.features.length)
}

export const featureLabel = (key: string): string => CATALOG.find((d) => d.key === key)?.label || key.replace(/^x:/, '').replace(/_/g, ' ')
