// Phone / browser notifications through Google FCM. One token per device is stored with fcm_register; the sender (services/scraper/lib/fcm.js) reads them.
//   Browser:      Firebase web messaging + public/firebase-messaging-sw.js (the page is passed the Firebase settings in the worker's address)
//   Android app:  @capacitor/push-notifications, which hands over the FCM token of the phone
// Needs the Firebase web settings in the app's .env (NUXT_PUBLIC_FIREBASE_*). Without them the toggle says "not set up yet".
import { Capacitor } from '@capacitor/core'

export type FcmState = 'unsupported' | 'not_configured' | 'needs_install' | 'blocked' | 'off' | 'on'
const KEY = 'fcm-token'

export function useFcm() {
  const db = useDb()
  const config = useRuntimeConfig()
  const state = useState<FcmState>('fcm-state', () => 'off')
  const fb = computed(() => config.public.firebase as Record<string, string>)
  const native = () => import.meta.client && Capacitor.isNativePlatform()
  const configured = () => native() || !!(fb.value?.apiKey && fb.value?.projectId && fb.value?.messagingSenderId && fb.value?.appId && fb.value?.vapidKey)
  const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true
  const saved = () => { try { return localStorage.getItem(KEY) } catch { return null } }
  const remember = (t: string | null) => { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY) } catch { /* private mode */ } }

  async function refresh() {
    if (!import.meta.client) return
    if (native()) {
      const { PushNotifications } = await import('@capacitor/push-notifications')
      const p = await PushNotifications.checkPermissions()
      state.value = p.receive === 'denied' ? 'blocked' : p.receive === 'granted' && saved() ? 'on' : 'off'
      return
    }
    if (!('serviceWorker' in navigator) || !('Notification' in window)) { state.value = isIos() && !standalone() ? 'needs_install' : 'unsupported'; return }
    if (!configured()) { state.value = 'not_configured'; return }
    if (Notification.permission === 'denied') { state.value = 'blocked'; return }
    state.value = Notification.permission === 'granted' && saved() ? 'on' : 'off'
  }

  async function webToken(): Promise<string> {
    const { initializeApp, getApps } = await import('firebase/app')
    const { getMessaging, getToken, isSupported } = await import('firebase/messaging')
    if (!(await isSupported())) { state.value = 'unsupported'; throw new Error('This browser cannot receive notifications.') }
    const { vapidKey, ...cfg } = fb.value
    const app = getApps()[0] || initializeApp(cfg)
    const q = new URLSearchParams(cfg as Record<string, string>).toString()
    const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js?' + q)
    await navigator.serviceWorker.ready
    const token = await getToken(getMessaging(app), { vapidKey, serviceWorkerRegistration: reg })
    if (!token) throw new Error('No notification token was given. Try again.')
    return token
  }

  async function nativeToken(): Promise<string> {
    const { PushNotifications } = await import('@capacitor/push-notifications')
    const perm = await PushNotifications.requestPermissions()
    if (perm.receive !== 'granted') { state.value = perm.receive === 'denied' ? 'blocked' : 'off'; throw new Error('Notifications were not allowed. You can allow them in the phone settings.') }
    return await new Promise<string>((resolve, reject) => {
      PushNotifications.addListener('registration', (t) => resolve(t.value))
      PushNotifications.addListener('registrationError', (e) => reject(new Error(e.error)))
      PushNotifications.register()
    })
  }

  async function enable() {
    if (!configured()) throw new Error('Phone notifications are not set up for this app yet.')
    if (!native()) {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') { state.value = perm === 'denied' ? 'blocked' : 'off'; throw new Error('Notifications were not allowed. You can allow them in your browser settings.') }
    }
    const token = native() ? await nativeToken() : await webToken()
    const { error } = await db.rpc('fcm_register', { p_token: token, p_platform: native() ? 'android' : 'web' })
    if (error) throw error
    remember(token); state.value = 'on'
  }

  async function disable() {
    const t = saved()
    if (t) await db.rpc('fcm_unregister', { p_token: t })
    remember(null); state.value = 'off'
  }

  return { state, refresh, enable, disable }
}
