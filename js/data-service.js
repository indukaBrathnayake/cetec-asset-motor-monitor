/* ============================================================
   CETEC Asset Motor Monitor — Data Service
   One interface, two backends:
     • DemoService     — simulated pumps + telemetry (for testing)
     • FirebaseService — live cloud data pushed by ESP32 over WiFi
   Both expose:
     init(), onSites(cb), onPumps(cb), onTelemetry(cb),
     addSite(), updateSite(), deleteSite(),
     addPump(), updatePump(), deletePump()
   Telemetry packet: { pumpId, v, freq, fault, sev, ts }
   ============================================================ */

"use strict";

/* ------------------------------------------------------------------
   DEMO SERVICE — simulator for final site checks while the
   frequency-capture hardware is under construction.
   ------------------------------------------------------------------ */
const DemoService = (() => {
  const LS_SITES = "cetec_demo_sites";
  const LS_PUMPS = "cetec_demo_pumps";

  const DEFAULT_SITES = {
    s_peradeniya: { name: "Peradeniya Treatment Plant", lat: 7.2593, lng: 80.5977 },
    s_kandy:      { name: "Kandy Pumping Station",      lat: 7.2906, lng: 80.6337 },
    s_gampola:    { name: "Gampola Booster Site",       lat: 7.1644, lng: 80.5696 },
  };
  const DEFAULT_PUMPS = {
    p01: { name: "Intake Pump 01",   siteId: "s_peradeniya", lat: 7.2596, lng: 80.5975 },
    p02: { name: "Intake Pump 02",   siteId: "s_peradeniya", lat: 7.2590, lng: 80.5981 },
    p03: { name: "Transfer Pump A",  siteId: "s_kandy",      lat: 7.2908, lng: 80.6340 },
    p04: { name: "Transfer Pump B",  siteId: "s_kandy",      lat: 7.2903, lng: 80.6333 },
    p05: { name: "Booster Pump 01",  siteId: "s_gampola",    lat: 7.1647, lng: 80.5699 },
  };

  // Per-pump simulated condition profile
  const FAULTS = ["Bearing Wear", "Misalignment", "Imbalance", "Cavitation", "Looseness"];
  let sites = {}, pumps = {}, profiles = {};
  let siteCb = null, pumpCb = null, telemCb = null, timer = null;

  const clone = (o) => JSON.parse(JSON.stringify(o)); // works on all browsers
  const load = (k, d) => {
    try { return JSON.parse(localStorage.getItem(k)) || clone(d); }
    catch { return clone(d); }
  };
  const save = () => {
    localStorage.setItem(LS_SITES, JSON.stringify(sites));
    localStorage.setItem(LS_PUMPS, JSON.stringify(pumps));
  };
  const uid = (p) => p + "_" + Math.random().toString(36).slice(2, 8);

  function buildProfile(id) {
    // Each pump gets a baseline; one random pump degrades over time so
    // WARN/ALERT paths, Telegram flow and logging can all be tested.
    profiles[id] = profiles[id] || {
      base: 1.2 + Math.random() * 1.5,
      drift: 0,
      degrading: Math.random() < 0.25,
      fault: FAULTS[Math.floor(Math.random() * FAULTS.length)],
    };
  }

  function tick() {
    Object.keys(pumps).forEach((id) => {
      buildProfile(id);
      const p = profiles[id];
      if (p.degrading) p.drift = Math.min(p.drift + 0.015, 8);
      else if (p.drift > 0) p.drift = Math.max(p.drift - 0.05, 0);
      // Occasionally start/stop a degradation episode
      if (Math.random() < 0.002) p.degrading = !p.degrading;

      const v = Math.max(0.1, p.base + p.drift + (Math.random() - 0.5) * 0.6);
      let sev = "OK", fault = "Normal";
      if (v >= CONFIG.VIBRATION_ALERT) { sev = "ALERT"; fault = p.fault; }
      else if (v >= CONFIG.VIBRATION_WARN) { sev = "WARN"; fault = p.fault + " (early)"; }

      telemCb && telemCb({
        pumpId: id,
        v: +v.toFixed(2),
        freq: +(48 + Math.random() * 4).toFixed(1),
        fault, sev, ts: Date.now(),
      });
    });
  }

  return {
    label: "DEMO MODE — simulated sensor data",
    init() {
      sites = load(LS_SITES, DEFAULT_SITES);
      pumps = load(LS_PUMPS, DEFAULT_PUMPS);
      Object.keys(pumps).forEach(buildProfile);
      setTimeout(() => { siteCb && siteCb(sites); pumpCb && pumpCb(pumps); }, 0);
      clearInterval(timer);
      timer = setInterval(tick, 1200);
    },
    onSites(cb) { siteCb = cb; if (Object.keys(sites).length) cb(sites); },
    onPumps(cb) { pumpCb = cb; if (Object.keys(pumps).length) cb(pumps); },
    onTelemetry(cb) { telemCb = cb; },
    onConnection(cb) { cb(true); }, // simulator is always "connected"

    // ----- admin CRUD -----
    async addSite(d)        { sites[uid("s")] = d; save(); siteCb(sites); },
    async updateSite(id, d) { sites[id] = { ...sites[id], ...d }; save(); siteCb(sites); },
    async deleteSite(id) {
      Object.keys(pumps).forEach(pid => { if (pumps[pid].siteId === id) delete pumps[pid]; });
      delete sites[id]; save(); siteCb(sites); pumpCb(pumps);
    },
    async addPump(d)        { const id = uid("p"); pumps[id] = d; buildProfile(id); save(); pumpCb(pumps); },
    async updatePump(id, d) { pumps[id] = { ...pumps[id], ...d }; save(); pumpCb(pumps); },
    async deletePump(id)    { delete pumps[id]; delete profiles[id]; save(); pumpCb(pumps); },
  };
})();

/* ------------------------------------------------------------------
   FIREBASE SERVICE — live cloud backend.
   Expected Realtime Database structure (written by ESP32 via WiFi):

   /sites/{siteId}            { name, lat, lng }
   /pumps/{pumpId}            { name, siteId, lat, lng }
   /telemetry/{pumpId}/latest { v, freq, fault, sev, ts }
   /logs/{pushId}             { pumpId, fault, sev, ts }   (optional)
   /roles/{uid}               "admin" | "master"
   ------------------------------------------------------------------ */
const FirebaseService = (() => {
  let db = null;

  return {
    label: null, // no banner in live mode
    init() {
      if (!window.firebase) {
        alert("Firebase SDK failed to load. Check your network / CDN.");
        return;
      }
      firebase.initializeApp(CONFIG.FIREBASE);
      db = firebase.database();
    },
    onSites(cb) { db.ref("sites").on("value", s => cb(s.val() || {})); },
    onPumps(cb) { db.ref("pumps").on("value", s => cb(s.val() || {})); },
    onTelemetry(cb) {
      // If the ESP32's clock isn't NTP-synced, ts may be 0/missing —
      // stamp arrival time so offline detection still works correctly.
      const emit = (snap) => {
        const t = snap.child("latest").val();
        if (!t) return;
        if (!t.ts || t.ts < 946684800000) t.ts = Date.now();
        cb({ pumpId: snap.key, ...t });
      };
      db.ref("telemetry").on("child_changed", emit);
      db.ref("telemetry").on("child_added", emit);
    },
    // Live browser ↔ Firebase connection state (true/false).
    // NOTE: this is the DASHBOARD's link to the cloud — it stays true
    // even if every sensor loses power. Sensor health is judged per
    // pump via packet age (OFFLINE_TIMEOUT_MS).
    onConnection(cb) {
      db.ref(".info/connected").on("value", s => cb(!!s.val()));
    },

    // ----- admin CRUD (rules must restrict writes to admin/master) -----
    addSite(d)        { return db.ref("sites").push(d); },
    updateSite(id, d) { return db.ref("sites/" + id).update(d); },
    deleteSite(id)    { return db.ref("sites/" + id).remove(); },
    addPump(d)        { return db.ref("pumps").push(d); },
    updatePump(id, d) { return db.ref("pumps/" + id).update(d); },
    deletePump(id) {
      return Promise.all([
        db.ref("pumps/" + id).remove(),
        db.ref("telemetry/" + id).remove(),
      ]);
    },
  };
})();

/* Selected backend (URL override: ?demo=1 forces simulator) */
const DataService =
  new URLSearchParams(location.search).has("demo") || CONFIG.DATA_SOURCE === "demo"
    ? DemoService
    : FirebaseService;
