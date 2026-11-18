# Phone and browser notifications (Google FCM)

Notifications reach a dealer's phone or browser for: bid results, a car on the watchlist closing soon, and new cars that fit a saved preference.
Nothing breaks without this set up: the alerts simply stay inside the app.

## 1. Firebase project (once)
1. console.firebase.google.com > **Add project** (no Analytics needed).
2. **Project settings > General > Your apps > Web (`</>`)**. Register the app. Copy the settings into `apps/aim/.env` and `apps/lite/.env`
   (names are in each `.env.example`: `NUXT_PUBLIC_FIREBASE_*`).
3. **Project settings > Cloud Messaging > Web configuration > Web Push certificates > Generate key pair**. Copy it to `NUXT_PUBLIC_FIREBASE_VAPID_KEY`.
4. Rebuild and redeploy both apps (the settings are read when the app is built).

## 2. Sender (the scraper PC)
1. **Project settings > Service accounts > Generate new private key**. Save the JSON file somewhere private on the scraper PC (never in the repo).
2. In `services/scraper/.env`: `FCM_SERVICE_ACCOUNT=C:\path\to\that-file.json`.
3. `node alerts.js --only send --dry` shows how many phone notifications would go out. The daily job and the 15-minute alert job send them.

## 3. Android app
Add an Android app in the same Firebase project (package name from `capacitor.config.ts`), download `google-services.json` into `android/app/`, then build the APK.

## 4. A dealer turns it on
**My account > Notifications on this device > Turn on notifications**. On an iPhone the web app must first be added to the Home Screen.
Saved preferences have their own phone / email / app switches (**My preferences**).

## Database
Migrations 37 and 38 (device tokens are in `fcm_tokens`; a dead token is removed when Google says it is gone).
