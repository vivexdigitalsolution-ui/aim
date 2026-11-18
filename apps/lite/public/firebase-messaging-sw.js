// Receives Google FCM notifications while the app is closed or in the background, and opens the right page when one is tapped.
// The Firebase settings arrive in this file's address (?apiKey=...&projectId=...), so no key is written into the file.
importScripts('https://www.gstatic.com/firebasejs/11.0.2/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/11.0.2/firebase-messaging-compat.js')

const q = new URL(self.location.href).searchParams
firebase.initializeApp({ apiKey: q.get('apiKey'), authDomain: q.get('authDomain') || undefined, projectId: q.get('projectId'), messagingSenderId: q.get('messagingSenderId'), appId: q.get('appId') })
const messaging = firebase.messaging()

// The sender sends a "data" message: { title, body, url }. We show it ourselves so the tap can open the right page.
messaging.onBackgroundMessage((payload) => {
  const d = payload.data || {}
  self.registration.showNotification(d.title || 'AIM', { body: d.body || '', tag: d.tag || undefined, data: { url: d.url || '/' } })
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin)
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of all) {
      if (new URL(c.url).origin === target.origin && 'focus' in c) { await c.focus(); if ('navigate' in c) { try { await c.navigate(target.href) } catch { /* fall through */ } } return }
    }
    await self.clients.openWindow(target.href)
  })())
})
