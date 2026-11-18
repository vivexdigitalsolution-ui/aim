import type { SegmentMap } from '@aim/core'

/** The segments (SUV, MPV ...) and which cars belong to each. Loaded once; staff edit them on the Segments page. */
export function useSegments() {
  const db = useDb()
  const segments = useState<{ key: string; label: string; sort: number }[]>('segments', () => [])
  const map = useState<SegmentMap>('segment-map', () => ({}))
  const loaded = useState('segments-loaded', () => false)
  async function load(force = false) {
    if (loaded.value && !force) return
    const [s, m] = await Promise.all([db.from('segments').select('key,label,sort').order('sort'), db.from('segment_models').select('segment_key,brand,model')])
    if (s.error) throw s.error
    if (m.error) throw m.error
    segments.value = s.data || []
    const out: SegmentMap = {}
    for (const r of m.data || []) (out[r.segment_key] ||= []).push({ brand: r.brand, model: r.model || '' })
    map.value = out
    loaded.value = true
  }
  return { segments, map, load }
}
