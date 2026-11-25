<template>
  <div>
    <h1>My buy list</h1>
    <p class="sub">Tell us what you want to buy. We pick the cars that fit and send them to you with the estimated margin on each. You can change this any time.</p>
    <div class="card" style="max-width: 760px">
      <BuyListForm v-if="user" :ap-id="user.id" @saved="bl = $event" />
    </div>
    <div v-if="count != null" class="card" style="max-width: 760px; margin-top: 14px">
      <b>{{ count }} open car{{ count === 1 ? '' : 's' }} fit your list right now.</b>
      <span class="muted small"> Margins use the usual auction price of each model, your own AP fee and RM 3,000 for preparation.</span>
      <div style="margin-top: 8px"><NuxtLink to="/today" class="btn ghost sm" style="display: inline-flex; align-items: center">See all cars</NuxtLink></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { matchesBuyList, type BuyList } from '@aim/core'

const { user } = useAuth()
const { load, lots, evaluate, fees } = useMarginBoard()
const { map: segMap, load: loadSegments } = useSegments()
const bl = ref<BuyList | null>(null), count = ref<number | null>(null)
const RECON = 0

async function recount() {
  if (!bl.value) return
  try {
    await Promise.all([load(), loadSegments()])
    const s ={ targetPct: bl.value.min_margin_pct, reconMyr: RECON, apFeeMyr: fees.value.apFeeMyr }
    count.value = lots.value.map((l) => evaluate(l, s)).filter((c) => c.atHistory && matchesBuyList(bl.value!, { brand: c.brand, model: c.model, year: c.mfg_year, landedMyr: c.atHistory.landedMyr + RECON, marginPct: c.atHistory.marginPct }, segMap.value).ok).length
  } catch { count.value = null }
}
watch(bl, recount)
</script>
