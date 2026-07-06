# Pre-Deployment Test Checklist

The frequency-capture device is still under construction, so testing is
split into three stages. Stage 1 needs nothing but a browser; Stage 2
needs one bare ESP32 dev board; Stage 3 needs the real sensor.

---

## Stage 1 — Full site check in DEMO mode (no hardware)

Setup: `js/config.js` → `DATA_SOURCE: "demo"` (default), or append
`?demo=1` to any URL. Open `index.html`.

### Dashboard (`index.html`)
- [ ] "DEMO MODE — simulated sensor data" banner is visible at the bottom of the map.
- [ ] KPI ribbon shows pump totals and updates as statuses change.
- [ ] Site Navigator drawer opens/closes with the ☰ button.
- [ ] Clicking a site expands its pump list, flies the map to the site, and filters the right-hand pump cards.
- [ ] Clicking a pump (drawer, card, or map marker) selects it, zooms the map, and starts the live chart.
- [ ] Live chart updates ~every second; detail grid shows vibration, frequency, condition, last-packet time.
- [ ] Within a few minutes at least one simulated pump degrades: badge turns **WARN** (amber) then **ALERT** (red), map marker recolors, screen edge flashes red on ALERT.
- [ ] Fault Log modal lists the WARN/ALERT events; "Export CSV" downloads the report.
- [ ] "Telegram Alerts" button opens https://t.me/AssetMotorMonitor_bot in a new tab.
- [ ] Theme toggle switches Night Ops ↔ light; choice persists after reload.
- [ ] "View All Sites" fits all pumps on the map.
- [ ] Resize to phone width: drawer becomes an overlay, layout stacks vertically.

### Admin (`admin.html`)
- [ ] Wrong password → "Invalid credentials."
- [ ] `admin / admin123` signs in; Master Controls section is **hidden**.
- [ ] `master / master123` signs in; Master Controls section is **visible**, role pill shows MASTER.
- [ ] Add a site (name + click map) → appears in list and in the dashboard drawer.
- [ ] Add a pump assigned to that site → appears on dashboard; simulator starts streaming to it.
- [ ] Edit a pump's name/position → dashboard reflects the change.
- [ ] Delete a site → its pumps are removed too (confirmation shown).
- [ ] Master: "Reset All" requires typing `RESET`; "Clear Fault Logs" empties the log modal; "Export Configuration" downloads JSON.
- [ ] Dashboard (`index.html`) has **no** edit, delete, add, or reset controls anywhere.

---

## Stage 2 — Pipeline check with a bare ESP32 (no sensor)

Setup: configure Firebase per README; set `DATA_SOURCE: "firebase"`.
Flash `firmware/esp32_wifi_sender/` with `SIMULATE_SENSOR 1`, your WiFi
credentials, Firebase host/auth, and a pump ID created in the admin panel.

- [ ] Serial monitor shows `WiFi OK` and `HTTP 200` for each push.
- [ ] Firebase console shows `/telemetry/{pumpId}/latest` updating every ~2 s.
- [ ] Dashboard pump goes from OFFLINE to OK within seconds and charts the synthetic data.
- [ ] Power off the ESP32 → pump card turns **OFFLINE** after ~15 s (`OFFLINE_TIMEOUT_MS`).
- [ ] Lower `VIB_ALERT` in the firmware temporarily to force ALERT → dashboard flashes, log records the event, (if configured) the Telegram Cloud Function sends a message.

---

## Stage 3 — Real sensor integration

- [ ] Set `SIMULATE_SENSOR 0`, implement `readVibrationRMS()` / `readDominantFreq()` against the finished frequency-capture front-end.
- [ ] Bench-verify readings against a calibrated vibration meter.
- [ ] Confirm WARN/ALERT thresholds against ISO 10816 class for each pump size.
- [ ] 24-hour soak test: no WiFi drop-related crashes (auto-reconnect works), no memory leaks.
