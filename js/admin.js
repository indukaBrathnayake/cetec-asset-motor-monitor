/* ============================================================
   CETEC Asset Motor Monitor — Administration
   • Login gate (demo credentials OR Firebase Auth)
   • Roles: admin  = manage sites & pumps
            master = admin + critical operations (reset, purge)
   ============================================================ */

"use strict";

const $ = (id) => document.getElementById(id);
const isDemo = DataService === DemoService;

let role = null;
let sites = {}, pumps = {};
let sitePicker, pumpPicker, siteMarker, pumpMarker;
let siteLatLng = null, pumpLatLng = null;
let editingSiteId = null, editingPumpId = null;

/* ---------------- AUTH ---------------- */
// Firebase counts as "not configured" while placeholder values remain.
const firebaseConfigured =
  CONFIG.FIREBASE && CONFIG.FIREBASE.apiKey && CONFIG.FIREBASE.apiKey !== "YOUR_API_KEY";
// Fall back to demo login if Firebase mode is selected but not configured,
// or if the Firebase SDK failed to load — the admin panel is never bricked.
const useDemoLogin = isDemo || !firebaseConfigured || !window.firebase;

window.addEventListener("DOMContentLoaded", () => {
  // 1) Attach the submit handler FIRST so a backend error can never
  //    leave the Sign In button dead (previous bug: an exception during
  //    Firebase init stopped the script before the handler was attached,
  //    so submitting just reloaded the page).
  $("loginForm").addEventListener("submit", onLoginSubmit);

  // 2) Then initialise the backend, safely.
  if (useDemoLogin) {
    $("demoHint").innerHTML =
      (isDemo ? "DEMO MODE" : "\u26a0 Firebase not configured \u2014 using demo login") +
      " \u2014 test credentials: <code>admin / admin123</code> " +
      "or <code>master / master123</code>. Replace with Firebase " +
      "Authentication before deployment (see README).";
  } else {
    try {
      DataService.init(); // initialise Firebase app for auth
    } catch (err) {
      console.error("Firebase init failed:", err);
      $("loginErr").textContent =
        "Cloud connection failed \u2014 check CONFIG.FIREBASE in js/config.js.";
    }
  }
});

async function onLoginSubmit(e) {
  e.preventDefault();
  const user = $("loginUser").value.trim().toLowerCase();
  const pass = $("loginPass").value;
  $("loginErr").textContent = "";

  if (useDemoLogin) {
    const u = CONFIG.DEMO_USERS[user];
    if (u && u.password === pass) enterConsole(u.role);
    else $("loginErr").textContent = "Invalid username or password.";
    return;
  }

  // Firebase Auth (email/password) + role lookup at /roles/{uid}
  try {
    const cred = await firebase.auth().signInWithEmailAndPassword(user, pass);
    const snap = await firebase.database().ref("roles/" + cred.user.uid).get();
    const r = snap.val();
    if (r === "admin" || r === "master") enterConsole(r);
    else {
      $("loginErr").textContent = "This account has no administrator role.";
      firebase.auth().signOut();
    }
  } catch (err) {
    $("loginErr").textContent = "Sign-in failed: " + (err.message || err);
  }
}

function enterConsole(r) {
  role = r;
  $("loginView").hidden = true;
  $("adminView").hidden = false;
  $("rolePill").textContent = r.toUpperCase();
  $("rolePill").classList.toggle("master", r === "master");
  $("masterZone").hidden = r !== "master";

  // If Firebase isn't configured yet, manage demo data instead so the
  // console remains usable end-to-end.
  const svc = useDemoLogin ? DemoService : DataService;
  if (useDemoLogin) svc.init();
  svc.onSites((s) => { sites = s || {}; renderSites(); fillSiteSelect(); renderPumps(); });
  svc.onPumps((p) => { pumps = p || {}; renderPumps(); });
  window.__svc = svc; // used by CRUD handlers below
}

function signOut() {
  if (!useDemoLogin && window.firebase) firebase.auth().signOut();
  location.reload();
}

/* ---------------- RENDER LISTS ---------------- */
function renderSites() {
  const el = $("siteList");
  el.innerHTML = "";
  Object.entries(sites).forEach(([id, s]) => {
    const row = document.createElement("div");
    row.className = "list-item";
    const count = Object.values(pumps).filter((p) => p.siteId === id).length;
    row.innerHTML = `
      <div class="grow"><b>${s.name}</b>
        <small>${s.lat.toFixed(4)}, ${s.lng.toFixed(4)} • ${count} pump(s)</small></div>
      <button class="mini-btn" onclick="openSiteForm('${id}')">✎ Edit</button>
      <button class="mini-btn del" onclick="deleteSite('${id}')">🗑</button>`;
    el.appendChild(row);
  });
  if (!Object.keys(sites).length)
    el.innerHTML = `<p style="font-size:12.5px;color:var(--text-dim)">No sites yet.</p>`;
}

function renderPumps() {
  const el = $("pumpList");
  el.innerHTML = "";
  Object.entries(pumps).forEach(([id, p]) => {
    const row = document.createElement("div");
    row.className = "list-item";
    row.innerHTML = `
      <div class="grow"><b>${p.name}</b>
        <small>${sites[p.siteId]?.name || "⚠ unassigned"} • ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}</small></div>
      <button class="mini-btn" onclick="openPumpForm('${id}')">✎ Edit</button>
      <button class="mini-btn del" onclick="deletePump('${id}')">🗑</button>`;
    el.appendChild(row);
  });
  if (!Object.keys(pumps).length)
    el.innerHTML = `<p style="font-size:12.5px;color:var(--text-dim)">No pumps yet.</p>`;
}

function fillSiteSelect() {
  const sel = $("pSite");
  sel.innerHTML = "";
  Object.entries(sites).forEach(([id, s]) => {
    const o = document.createElement("option");
    o.value = id; o.textContent = s.name;
    sel.appendChild(o);
  });
}

/* ---------------- SITE FORM ---------------- */
function openSiteForm(id = null) {
  editingSiteId = id;
  $("siteModalTitle").textContent = id ? "Edit Site" : "Add Site";
  $("sName").value = id ? sites[id].name : "";
  siteLatLng = id ? { lat: sites[id].lat, lng: sites[id].lng } : null;
  $("sCoords").textContent = siteLatLng
    ? `${siteLatLng.lat.toFixed(5)}, ${siteLatLng.lng.toFixed(5)}` : "Not set";
  $("siteModal").classList.add("open");

  setTimeout(() => {
    if (!sitePicker) {
      sitePicker = L.map("sitePickerMap").setView(CONFIG.MAP_CENTER, CONFIG.MAP_ZOOM);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(sitePicker);
      sitePicker.on("click", (e) => {
        siteLatLng = e.latlng;
        $("sCoords").textContent = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
        if (siteMarker) sitePicker.removeLayer(siteMarker);
        siteMarker = L.marker(e.latlng).addTo(sitePicker);
      });
    }
    sitePicker.invalidateSize();
    if (siteLatLng) {
      if (siteMarker) sitePicker.removeLayer(siteMarker);
      siteMarker = L.marker(siteLatLng).addTo(sitePicker);
      sitePicker.setView(siteLatLng, 15);
    }
  }, 120);
}

async function saveSite() {
  const name = $("sName").value.trim();
  if (!name) return alert("Enter a site name.");
  if (!siteLatLng) return alert("Click the map to set the site location.");
  const data = { name, lat: siteLatLng.lat, lng: siteLatLng.lng };
  if (editingSiteId) await window.__svc.updateSite(editingSiteId, data);
  else await window.__svc.addSite(data);
  closeModal("siteModal");
}

async function deleteSite(id) {
  if (!confirm(`Delete "${sites[id].name}" and ALL its pumps?`)) return;
  await window.__svc.deleteSite(id);
}

/* ---------------- PUMP FORM ---------------- */
function openPumpForm(id = null) {
  if (!Object.keys(sites).length) return alert("Add a site first.");
  editingPumpId = id;
  $("pumpModalTitle").textContent = id ? "Edit Pump" : "Add Pump";
  $("pName").value = id ? pumps[id].name : "";
  fillSiteSelect();
  if (id) $("pSite").value = pumps[id].siteId;
  pumpLatLng = id ? { lat: pumps[id].lat, lng: pumps[id].lng } : null;
  $("pCoords").textContent = pumpLatLng
    ? `${pumpLatLng.lat.toFixed(5)}, ${pumpLatLng.lng.toFixed(5)}` : "Not set";
  $("pumpModal").classList.add("open");

  setTimeout(() => {
    if (!pumpPicker) {
      pumpPicker = L.map("pumpPickerMap").setView(CONFIG.MAP_CENTER, CONFIG.MAP_ZOOM);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(pumpPicker);
      pumpPicker.on("click", (e) => {
        pumpLatLng = e.latlng;
        $("pCoords").textContent = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
        if (pumpMarker) pumpPicker.removeLayer(pumpMarker);
        pumpMarker = L.marker(e.latlng).addTo(pumpPicker);
      });
    }
    pumpPicker.invalidateSize();
    const focus = pumpLatLng ||
      { lat: sites[$("pSite").value]?.lat, lng: sites[$("pSite").value]?.lng };
    if (focus.lat) pumpPicker.setView(focus, 16);
    if (pumpLatLng) {
      if (pumpMarker) pumpPicker.removeLayer(pumpMarker);
      pumpMarker = L.marker(pumpLatLng).addTo(pumpPicker);
    }
  }, 120);
}

async function savePump() {
  const name = $("pName").value.trim();
  const siteId = $("pSite").value;
  if (!name) return alert("Enter a pump name.");
  if (!pumpLatLng) return alert("Click the map to set the pump position.");
  const data = { name, siteId, lat: pumpLatLng.lat, lng: pumpLatLng.lng };
  if (editingPumpId) await window.__svc.updatePump(editingPumpId, data);
  else await window.__svc.addPump(data);
  closeModal("pumpModal");
}

async function deletePump(id) {
  if (!confirm(`Delete pump "${pumps[id].name}"?`)) return;
  await window.__svc.deletePump(id);
}

/* ---------------- MASTER CONTROLS ---------------- */
function requireMaster() {
  if (role !== "master") { alert("Master administrator role required."); return false; }
  return true;
}

async function masterResetData() {
  if (!requireMaster()) return;
  if (!confirm("⚠ This permanently removes ALL sites and pumps. Continue?")) return;
  if (prompt('Type "RESET" to confirm:') !== "RESET") return;
  for (const id of Object.keys(pumps)) await window.__svc.deletePump(id);
  for (const id of Object.keys(sites)) await window.__svc.deleteSite(id);
  alert("System configuration cleared.");
}

function masterClearLogs() {
  if (!requireMaster()) return;
  if (!confirm("Clear all locally stored fault logs?")) return;
  localStorage.removeItem("cetec_logs");
  alert("Fault logs cleared.");
}

function exportConfig() {
  const blob = new Blob(
    [JSON.stringify({ sites, pumps, exported: new Date().toISOString() }, null, 2)],
    { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "cetec_config_backup.json";
  a.click();
}

/* ---------------- MISC ---------------- */
function closeModal(id) { $(id).classList.remove("open"); }
