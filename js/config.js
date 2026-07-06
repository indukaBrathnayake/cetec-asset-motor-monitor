/* ============================================================
   CETEC Asset Motor Monitor — Configuration
   ============================================================ */

const CONFIG = {
  // ---------- DATA SOURCE ----------
  // "demo"     : built-in simulator (no hardware / no cloud needed).
  //              Use this while the frequency-capture device is under
  //              construction, and for GitHub Pages demos.
  // "firebase" : live data from Firebase Realtime Database, pushed by
  //              the ESP32 units over site WiFi.
  DATA_SOURCE: "demo",

  // ---------- FIREBASE (cloud storage) ----------
  // Create a free project at https://console.firebase.google.com
  // Enable: Realtime Database + Authentication (Email/Password).
  // Paste your web-app config below, then set DATA_SOURCE to "firebase".
  FIREBASE: {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
    projectId: "YOUR_PROJECT",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "000000000000",
    appId: "YOUR_APP_ID",
  },

  // ---------- TELEGRAM ----------
  // Public bot link shown to users in the top bar (safe to publish):
  TELEGRAM_BOT_URL: "https://t.me/AssetMotorMonitor_bot",

  // SECURITY: never put the bot TOKEN in this repo. Outbound alerts
  // should be sent server-side (Firebase Cloud Function). See README.

  // ---------- ALERTING ----------
  VIBRATION_WARN: 4.5,   // mm/s — ISO 10816 Zone C boundary (typical)
  VIBRATION_ALERT: 7.1,  // mm/s — ISO 10816 Zone D boundary (typical)
  OFFLINE_TIMEOUT_MS: 15000, // no packet for 15 s => pump marked OFFLINE
  CHART_POINTS: 30,

  // ---------- MAP ----------
  MAP_CENTER: [7.2525, 80.5925], // Peradeniya
  MAP_ZOOM: 13,

  // ---------- DEMO AUTH (admin.html, demo mode only) ----------
  // Replace with Firebase Authentication in production. These exist
  // only so the admin panel can be tested before the backend is live.
  DEMO_USERS: {
    "admin":  { password: "admin123",  role: "admin"  },
    "master": { password: "master123", role: "master" },
  },
};
