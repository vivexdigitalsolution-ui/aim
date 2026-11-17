<template>
  <div>
    <h1>Upgrade your plan</h1>
    <p class="sub">You are on the <b>{{ profile?.tier || 'free' }}</b> plan. Margin tools show what an auction car can earn you in Malaysia before you bid.</p>
    <div class="grid plans">
      <div v-for="t in tiers" :key="t.key" class="card" :class="{ cur: (profile?.tier || 'free') === t.key }">
        <div class="row"><h2>{{ t.name }}</h2><span v-if="(profile?.tier || 'free') === t.key" class="chip ac">your plan</span></div>
        <ul>
          <li v-for="f in t.features" :key="f">{{ f }}</li>
        </ul>
      </div>
    </div>
    <p class="muted small" style="margin-top: 14px">To change plan, contact the team. Plans are set by staff; payment inside the app comes later.</p>
  </div>
</template>

<script setup lang="ts">
const { profile } = useAuth()
const tiers = [
  { key: 'free', name: 'Free', features: ['Find by feature: search every open car by what is on it', 'Auction listings and photos'] },
  { key: 'member', name: 'Member', features: ['Everything in Free', 'Today for you: cars ranked by room to bid', 'Margin analysis: max bid and profit for your target margin', 'Malaysian market price range by catalog variant'] },
  { key: 'partner', name: 'Partner', features: ['Everything in Member', 'Bid orders and bid tracking', 'Your own buy list and alerts', 'Pre-sold sourcing requests'] },
]
</script>

<style scoped>
.plans { grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
.cur { border-color: var(--ac); }
ul { margin: 10px 0 0; padding-left: 18px; color: var(--mu); display: grid; gap: 6px; }
@media (max-width: 760px) { .plans { grid-template-columns: 1fr; } }
</style>
