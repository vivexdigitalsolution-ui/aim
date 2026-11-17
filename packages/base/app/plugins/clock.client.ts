// One clock for every countdown on screen: updated every 30 seconds.
export default defineNuxtPlugin(() => {
  const now = useNow()
  setInterval(() => { now.value = Date.now() }, 30_000)
})
