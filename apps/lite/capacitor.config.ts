import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.aim.lite',
  appName: 'Dealer PublicGo',
  webDir: '.output/public',     // output of `nuxt generate`
  android: { allowMixedContent: false },
}

export default config
