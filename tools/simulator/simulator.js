/* ============================================================
 * CETEC — Cloud Telemetry Simulator
 * ============================================================
 * Pushes realistic synthetic pump telemetry to Firebase Realtime
 * Database, exactly like a fleet of real ESP32 nodes would.
 * Designed to run unattended (GitHub Actions / any server) so the
 * dashboard can be reliability-tested 24/7 with no hardware.
 *
 * Behaviours simulated:
 *   • normal running with sensor noise
 *   • slow degradation episodes → WARN → ALERT, then "repair"
 *   • random per-pump dropouts (tests OFFLINE detection)
 *   • occasional full "site power cut" (all pumps silent 60–120 s)
 *
 * Usage:
 *   FIREBASE_HOST=your-project-default-rtdb.firebaseio.com \
 *   FIREBASE_AUTH=your_db_secret \
 *   node simulator.js [runMinutes]
 *
 * runMinutes (default 25) — the script exits after this long, so a
 * scheduled runner (cron every 30 min) keeps it effectively endless.
 * ============================================================ */

"use strict";

const HOST = process.env.FIREBASE_HOST;
const AUTH = process.env.FIREBASE_AUTH;
const RUN_MINUTES = parseFloat(process.argv[2] || "25");
const SEND_EVERY_MS = 2000;

const VIB_WARN = 4.5;
const VIB_ALERT = 7.1;

if (!HOST || !AUTH) {
  console.error("Set FIREBASE_HOST and FIREBASE_AUTH environment variables.");
  process.exit(1);
}

// Pump IDs must match those created in the admin panel.
const PUMPS = ["p01", "p02", "p03", "p04", "p05"];
const FAULTS = ["Bearing Wear", "Misalignment", "Imbalance", "Cavitation", "Looseness"];

const state = {};
PUMPS.forEach((id) => {
  state[id] = {
    base: 1.2 + Math.random() * 1.5,
    drift: 0,
    degrading: false,
    droppedUntil: 0,
    fault: FAULTS[Math.floor(Math.random() * FAULTS.length)],
  };
});
let powerCutUntil = 0;

function classify(v, fault) {
  if (v >= VIB_ALERT) return { sev: "ALERT", fault };
  if (v >= VIB_WARN) return { sev: "WARN", fault: fault + " (early)" };
  return { sev: "OK", fault: "Normal" };
}

async function push(pumpId, body) {
  const url = `https://${HOST}/telemetry/${pumpId}/latest.json?auth=${AUTH}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.status;
}

async function tick() {
  const now = Date.now();

  // Occasionally simulate a site-wide power cut (all pumps silent)
  if (now > powerCutUntil && Math.random() < 0.001) {
    powerCutUntil = now + (60 + Math.random() * 60) * 1000;
    console.log(`⚡ SIMULATED POWER CUT until ${new Date(powerCutUntil).toISOString()}`);
  }
  if (now < powerCutUntil) return;

  for (const id of PUMPS) {
    const s = state[id];

    // Random single-pump dropout (WiFi glitch) — tests OFFLINE badge
    if (now < s.droppedUntil) continue;
    if (Math.random() < 0.0015) {
      s.droppedUntil = now + (20 + Math.random() * 40) * 1000;
      console.log(`  ✂ ${id} dropout for ${(s.droppedUntil - now) / 1000 | 0}s`);
      continue;
    }

    // Degradation episodes
    if (Math.random() < 0.002) s.degrading = !s.degrading;
    if (s.degrading) s.drift = Math.min(s.drift + 0.02, 8);
    else if (s.drift > 0) s.drift = Math.max(s.drift - 0.06, 0);

    const v = Math.max(0.1, s.base + s.drift + (Math.random() - 0.5) * 0.6);
    const freq = 48 + Math.random() * 4;
    const { sev, fault } = classify(v, s.fault);

    try {
      const code = await push(id, {
        v: +v.toFixed(2),
        freq: +freq.toFixed(1),
        fault, sev, ts: now,
      });
      if (code !== 200) console.error(`  ${id} HTTP ${code}`);
    } catch (e) {
      console.error(`  ${id} push failed:`, e.message);
    }
  }
}

console.log(`Simulator started — ${PUMPS.length} pumps, running ${RUN_MINUTES} min.`);
const timer = setInterval(tick, SEND_EVERY_MS);
setTimeout(() => {
  clearInterval(timer);
  console.log("Run window finished. (Scheduler will start the next run.)");
  process.exit(0);
}, RUN_MINUTES * 60 * 1000);
