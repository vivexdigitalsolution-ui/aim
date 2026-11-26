<template>
  <div class="about">
    <section class="hero" style="background-image: linear-gradient(120deg, rgba(14, 44, 84, .88), rgba(34, 104, 184, .66)), url('/paw-j/minato-mirai.webp')">
      <small>PUBLIC AUTO WORLD JAPAN</small>
      <h1>Your direct gateway to Japanese car auctions</h1>
      <p>PAW-J is a vehicle exporter that connects Malaysian dealers to thousands of quality cars at the major Japanese auctions, with every price shown in Ringgit.</p>
      <div class="cta">
        <NuxtLink v-if="user" to="/cars" class="btn yellow">Browse cars</NuxtLink>
        <NuxtLink v-else to="/login" class="btn yellow">Sign in or create an account</NuxtLink>
        <a href="https://www.paw-j.com" target="_blank" rel="noopener" class="btn ghost">Visit paw-j.com</a>
      </div>
    </section>

    <section class="card intro">
      <div class="sect">About PAW-J</div>
      <p>PAW-J is a vehicle exporter and your direct gateway to the Japanese car auctions. We connect global buyers, starting with a simple experience for Malaysia, to thousands of quality vehicles.</p>
      <p>You get far more than Japanese domestic (JDM) cars. The same platform opens the door to Continental and European luxury makes such as Mercedes-Benz, BMW, Porsche, Audi and Ferrari, next to the popular Japanese models.</p>
      <p>We built PAW-J to modernise car importing. It links the big Japanese auction houses with buyers overseas, with speed, clarity and trust.</p>
    </section>

    <h2 class="h2">What sets PAW-J apart</h2>
    <div class="feat">
      <div v-for="f in feats" :key="f.t" class="card f">
        <span class="fi"><RailIcon :name="f.icon" /></span>
        <b>{{ f.t }}</b>
        <p>{{ f.d }}</p>
      </div>
    </div>

    <div class="pics">
      <figure><img src="/paw-j/auction-venue.webp" alt="A Japanese vehicle auction venue" loading="lazy" /><figcaption>Live auctions across Japan, brought to your screen</figcaption></figure>
      <figure><img src="/paw-j/export-port.webp" alt="Vehicles lined up at an export port" loading="lazy" /><figcaption>Export handling from the Japanese port to yours</figcaption></figure>
    </div>

    <section class="card end">
      <div><b>Ready to start?</b><div class="muted">Open the marketplace, check the import cost in RM and place your bid order.</div></div>
      <NuxtLink :to="user ? '/cars' : '/login'" class="btn yellow">{{ user ? 'Browse cars' : 'Sign in' }}</NuxtLink>
    </section>
  </div>
</template>

<script setup lang="ts">
const { user } = useAuth()
useHead({ title: 'About PAW-J' })

const feats = [
  { icon: 'calc', t: 'Prices in Ringgit, no guesswork', d: 'Browse the Japanese auctions with live yen-to-Ringgit prices. The built-in import calculator estimates the full landed cost before you bid: duty, customs docket, port fees and AP charges.' },
  { icon: 'table', t: 'Transparent, genuine pricing', d: 'No hidden markups. You see the true auction starting price, the exact hammer price of past sales, and a clear tiered CIF rate table for ocean freight, insurance and handling in Japan.' },
  { icon: 'cars', t: 'JDM and Continental cars', d: 'A stock that is updated all the time, from Japanese and European makes at the major auctions, with official inspection grades, verified low mileage and closing alerts.' },
  { icon: 'users', t: 'Built for car dealers', d: 'Manage many bids with ease, work out your target profit margin on the spot, and grow your stock with an export partner that is expanding worldwide.' },
]
</script>

<style scoped>
.about { max-width: 980px; margin: 0 auto; display: grid; gap: 18px; padding-bottom: 24px; }
.hero { border-radius: var(--r); color: #fff; padding: 56px 40px; background-size: cover; background-position: center; }
.hero small { color: var(--yl); font-weight: 800; letter-spacing: 1.2px; }
.hero h1 { font-size: 34px; line-height: 1.15; margin: 8px 0 12px; max-width: 560px; }
.hero p { max-width: 560px; margin: 0 0 20px; opacity: .95; font-size: 15.5px; line-height: 1.55; }
.cta { display: flex; gap: 10px; flex-wrap: wrap; }
.btn.ghost { background: transparent; color: #fff; border: 1.5px solid rgba(255, 255, 255, .7); }
.intro { padding: 22px 26px; } .intro p { line-height: 1.7; margin: 10px 0 0; font-size: 15px; }
.h2 { font-size: 22px; margin: 6px 0 0; }
.feat { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.f { padding: 20px; display: grid; gap: 6px; align-content: start; } .f b { font-size: 16px; } .f p { margin: 0; color: var(--mu); line-height: 1.55; font-size: 14px; }
.fi { width: 44px; height: 44px; border-radius: 50%; background: var(--acbg); color: var(--ac); display: grid; place-items: center; } .fi svg { width: 22px; height: 22px; }
.pics { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
figure { margin: 0; border-radius: var(--r); overflow: hidden; background: #fff; border: 1px solid var(--line); }
figure img { display: block; width: 100%; aspect-ratio: 16 / 10; object-fit: cover; }
figcaption { padding: 10px 14px; font-size: 13px; color: var(--mu); }
.end { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 26px; flex-wrap: wrap; }
@media (max-width: 720px) { .hero { padding: 36px 22px; } .hero h1 { font-size: 26px; } .feat, .pics { grid-template-columns: 1fr; } }
</style>
