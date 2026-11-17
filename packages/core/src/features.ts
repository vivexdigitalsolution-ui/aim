// Car features: every feature of a car must be findable (JBL audio + GR body kit in a Vellfire, without opening sheets one by one).
// Two layers:
//   1. Claude reads the sheet and returns a list of features (FEATURE_SCHEMA), each with where it came from (factory / dealer option / aftermarket).
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
  D('sunroof', 'Sunroof', 'Roof', /SUN\s*ROOF|MOON\s*ROOF|S\/R\b|サンルーフ|ムーンルーフ/i),
  D('panoramic_roof', 'Panoramic roof', 'Roof', /PANORAMIC|パノラマ(ルーフ|サンルーフ)|GLASS\s*ROOF/i),
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
  D('power_sliding_doors', 'Power sliding doors', 'Convenience', /POWER\s*SLID|ELECTRIC\s*SLID|両側(電動|パワー)スライド|パワースライド/i),
  D('power_tailgate', 'Power tailgate', 'Convenience', /POWER\s*(BACK|TAIL|LIFT)\s*(DOOR|GATE)|電動(バック|テール)ゲート|パワーバックドア/i),
  D('surround_camera', '360° camera', 'Safety', /(360|SURROUND|AROUND\s*VIEW|PANORAMIC\s*VIEW)\s*(°|DEGREE)?\s*(CAMERA|MONITOR|VIEW)|全方位|パノラミックビュー/i),
  D('adaptive_cruise', 'Adaptive cruise control', 'Safety', /ADAPTIVE\s*CRUISE|ACC\b|レーダークルーズ|全車速/i),
  D('head_up_display', 'Head-up display', 'Safety', /HEAD[\s-]*UP|HUD\b|ヘッドアップ/i),
  D('safety_package', 'Safety package', 'Safety', /SAFETY\s*(SUPPORT|SENSE|PACKAGE|PLUS)|セーフティ/i),
  D('4wd', '4WD / AWD', 'Drive', /\b4WD\b|\bAWD\b|四駆|4輪駆動/i),
  D('air_suspension', 'Air suspension', 'Chassis', /AIR\s*SUS|AIR\s*SUSPENSION|エアサス/i),
  D('coilovers', 'Coilovers / lowered', 'Chassis', /COILOVER|COIL\s*OVER|LOWERED|車高調|ローダウン/i),
  D('aftermarket_wheels', 'Aftermarket wheels', 'Wheels', /AFTERMARKET\s*WHEEL|ALLOY\s*WHEELS?\s*\(?(NON|AFTER)|社外(アルミ|ホイール)|社外\s*\d+\s*(インチ|inch)/i),
  D('aftermarket_exhaust', 'Aftermarket exhaust', 'Exhaust', /AFTERMARKET\s*EXHAUST|SPORTS?\s*EXHAUST|社外(マフラー|エキゾースト)|MUFFLER/i),
  D('sport_exhaust', 'Sport exhaust', 'Exhaust', /\bAKRAPOVIC\b|\bHKS\b|\bFUJITSUBO\b|\bBLITZ\b|アクラポ/i),
  D('large_display', 'Large display / navi', 'Infotainment', /(9|10|11|12|14)\s*(INCH|")\s*(DISPLAY|NAVI|MONITOR)|(9|10|11|12)インチ/i),
  D('android_carplay', 'CarPlay / Android Auto', 'Infotainment', /CARPLAY|ANDROID\s*AUTO/i),
]

export const FEATURE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['features'],
  properties: {
    features: {
      type: 'array',
      description: 'Every notable feature, option, package, modification or equipment item shown on the sheet or in the text. One item per feature. Nothing that is not shown.',
      items: {
        type: 'object', additionalProperties: false, required: ['name', 'source', 'evidence'],
        properties: {
          name: { type: 'string', description: 'the feature in English, short (e.g. "JBL 14 speaker audio", "GR aero kit", "sunroof")' },
          source: { type: 'string', enum: ['factory', 'dealer_option', 'aftermarket', 'unknown'], description: 'factory = standard or maker option on this grade; dealer_option = dealer-fit option; aftermarket = non-maker part (社外); unknown = the sheet does not say' },
          evidence: { type: 'string', description: 'the exact words from the sheet or text (Japanese or English) that show it, max 12 words' },
        },
      },
    },
  },
} as const

export const FEATURE_SYSTEM = `You list the features of ONE used Japanese car from its auction sheet and listing text, so a buyer can search for them (for example JBL audio, a GR body kit, a sunroof).
Rules:
- Only features that are shown on the sheet or in the text. Never add a feature because the model "usually has it".
- source: aftermarket for non-maker parts (社外, "aftermarket", a named tuner brand); factory for equipment standard on the grade or a maker option; dealer_option for dealer-fit items; unknown when the sheet does not say.
- Keep the evidence words exactly as printed. English names only. Do not mention any company, auction house or website name.`

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40)

/** Map Claude's list onto the catalog. A catalog match on the name or the evidence gives the catalog key; anything else is kept as a free tag. */
export function normalizeFeatures(list: { name: string; source?: FeatureSource; evidence?: string }[]): Feature[] {
  const out = new Map<string, Feature>()
  for (const f of list || []) {
    const hay = `${f.name || ''} ${f.evidence || ''}`
    const hits = CATALOG.filter((d) => d.re.test(hay))
    const source = f.source || 'unknown'
    if (hits.length) hits.forEach((h) => { if (!out.has(h.key)) out.set(h.key, { key: h.key, label: h.label, group: h.group, source, evidence: f.evidence }) })
    else if (f.name && slug(f.name)) { const k = 'x:' + slug(f.name); if (!out.has(k)) out.set(k, { key: k, label: f.name, group: 'Other', source, evidence: f.evidence }) }
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
