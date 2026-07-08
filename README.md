# CETEC Asset Motor Monitor

IoT-based predictive maintenance dashboard for industrial pump clusters.
ESP32 sensor nodes stream vibration/frequency telemetry over **site WiFi**
to a **cloud database (Firebase Realtime Database)**; this web app shows
live pump health per site, with fault logging and Telegram alerting.

**Central Environmental Testing & Consultancy (Pvt) Ltd**

---

## Features

| Area | Details |
|---|---|
| **Monitoring dashboard** (`index.html`) | Read-only for site users. Live map, site navigator drawer, per-pump vibration chart, KPI ribbon (pumps / healthy / warnings / alerts), fault history + CSV export. |
| **Site navigator** | Left slide-out drawer listing every site and its pump cluster with live status LEDs. Selecting a site flies the map to it and filters the pump cards. |
| **Admin console** (`admin/ (append /admin/ to the site URL)`) | Login-gated. `admin` role: add/edit/delete sites and pumps (map-pick coordinates). `master` role: everything + critical operations (full reset, log purge, config export). |
| **Cloud data** | ESP32 → WiFi router → Firebase Realtime Database → dashboard (live listeners). No Bluetooth pairing required. |
| **Telegram** | "Telegram Alerts" button in the top bar links users to the alert bot: https://t.me/AssetMotorMonitor_bot |
| **Demo mode** | Built-in telemetry simulator so the whole site can be tested **before the frequency-capture hardware is finished**. |

---

## Project structure

```
pump-monitor/
├── index.html               # User monitoring dashboard (read-only)
├── admin/ (append /admin/ to the site URL)               # Admin / master console (login required)
├── css/style.css            # Design system (dark "Night Ops" + light theme)
├── js/
│   ├── config.js            # ← all settings live here
│   ├── data-service.js      # Demo simulator + Firebase backend
│   ├── app.js               # Dashboard logic
│   └── admin.js             # Admin logic (auth, CRUD, master controls)
├── firmware/
│   └── esp32_wifi_sender/   # ESP32 Arduino sketch (WiFi → Firebase)
├── docs/TESTING.md          # Full pre-deployment test checklist
└── README.md
```

---

## Quick start (no hardware, no cloud)

`js/config.js` ships with `DATA_SOURCE: "demo"`. Just open `index.html`
in a browser (or host it — see below). Simulated pumps stream data,
occasionally degrade into WARN/ALERT, and exercise every feature.

Demo admin logins (demo mode only — replace before production):

| Username | Password | Role |
|---|---|---|
| `admin` | `admin123` | Manage sites & pumps |
| `master` | `master123` | Admin + critical operations |

---

## Free hosting on GitHub (GitHub Pages)

Yes — GitHub gives you free static hosting, perfect for checking the site:

1. Push this folder to a GitHub repository.
2. Repo → **Settings → Pages**.
3. Source: **Deploy from a branch**, Branch: `main`, Folder: `/ (root)`. Save.
4. After ~1 minute your site is live at
   `https://<your-username>.github.io/<repo-name>/`

Because demo mode needs no backend, the GitHub Pages deployment is fully
functional out of the box. When Firebase is configured, the same Pages
site becomes the production dashboard (Firebase is called directly from
the browser, so no server is needed).

> Tip: `https://.../index.html?demo=1` forces simulator mode even after
> you switch `DATA_SOURCE` to `"firebase"` — handy for demos.

---

## Going live with Firebase (cloud storage)

1. Create a free project at https://console.firebase.google.com
2. **Build → Realtime Database** → create database.
3. **Build → Authentication** → enable *Email/Password*; create your
   admin and master accounts.
4. In the Realtime Database, add roles:
   ```json
   { "roles": { "<admin-uid>": "admin", "<master-uid>": "master" } }
   ```
5. Database **Rules** (reads public for monitoring, writes restricted):
   ```json
   {
     "rules": {
       "sites":     { ".read": true, ".write": "root.child('roles').child(auth.uid).exists()" },
       "pumps":     { ".read": true, ".write": "root.child('roles').child(auth.uid).exists()" },
       "telemetry": { ".read": true, ".write": true },
       "roles":     { ".read": "auth != null", ".write": false }
     }
   }
   ```
   (Harden `telemetry` writes later with per-device auth tokens.)
6. Project settings → your web app → copy the config into
   `CONFIG.FIREBASE` in `js/config.js`, and set `DATA_SOURCE: "firebase"`.
7. Flash `firmware/esp32_wifi_sender/` to each ESP32 with the site's
   WiFi credentials and the pump ID created in the admin panel.

### Database schema

```
/sites/{siteId}            { name, lat, lng }
/pumps/{pumpId}            { name, siteId, lat, lng }
/telemetry/{pumpId}/latest { v, freq, fault, sev, ts }
/roles/{uid}               "admin" | "master"
```

---

## Telegram alerts — do it server-side

The top-bar button only links users to the bot (safe). **Never put the
bot token in this repo or in browser JavaScript** — anyone can read it
and hijack the bot. (The token in the old V2.3 file was exposed this
way; revoke it in @BotFather with `/revoke`.)

Recommended: a Firebase Cloud Function that watches `/telemetry` and
calls the Telegram API with the token stored as a server secret:

```js
// functions/index.js (sketch)
exports.onTelemetry = functions.database
  .ref("/telemetry/{pumpId}/latest")
  .onWrite(async (change, ctx) => {
    const t = change.after.val();
    if (t.sev !== "ALERT") return;
    await fetch(`https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: process.env.TG_CHAT, parse_mode: "HTML",
        text: `🚨 <b>CETEC ALERT</b>\nPump: ${ctx.params.pumpId}\nFault: ${t.fault}` }),
    });
  });
```

---

## Testing before hardware is ready

See **`docs/TESTING.md`** for the full checklist. Summary:

1. **Demo mode** — verifies the entire UI, alerting logic, admin CRUD.
2. **`SIMULATE_SENSOR 1`** in the firmware — a bare ESP32 dev board
   streams synthetic data through the real WiFi → Firebase → dashboard
   chain, proving the pipeline end-to-end with zero sensor hardware.

---

## Future development roadmap

- [ ] **CNN-LSTM fault classification** — stream raw frequency spectra to
      the cloud; run the trained model (Cloud Function / small VM) and
      write classified faults back to `/telemetry`.
- [ ] **Historical trends** — persist time-series (Firestore/InfluxDB)
      and add per-pump trend charts + maintenance predictions (RUL).
- [ ] **Per-device auth** — unique Firebase tokens per ESP32; drop the
      open telemetry write rule.
- [ ] **Telegram Cloud Function** — server-side alerts with per-site
      subscriber groups.
- [ ] **PWA** — offline shell + push notifications on mobile.
- [ ] **User accounts** — viewer accounts per client company; scoped
      site visibility.
- [ ] **Reports** — scheduled PDF/CSV health reports emailed monthly.
- [ ] **FFT spectrum view** — full spectrum plot per pump, not just RMS.

---

## License

Internal project of Central Environmental Testing & Consultancy (Pvt) Ltd.
