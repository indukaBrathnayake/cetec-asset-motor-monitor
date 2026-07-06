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
window.addEventListener("DOMContentLoaded", () => {
  if (isDemo) {
    $("demoHint").innerHTML =
      "DEMO MODE — test credentials: <code>admin / admin123</code> " +
      "or <code>master / master123</code>. Replace with Firebase " +
      "Authentication before deployment (see README).";
  } else {
    DataService.init(); // initialize Firebase app for auth
  }

  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const user = $("loginUser").value.trim();
    const pass = $("loginPass").value;
    $("loginErr").textContent = "";

    if (isDemo) {
      const u = CONFIG.DEMO_USERS[user];
      if (u && u.password === pass) enterConsole(u.role);
      else $("loginErr").textContent = "Invalid credentials.";
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
  });
});

function enterConsole(r) {
  role = r;
  $("loginView").hidden = true;
  $("adminView").hidden = false;
  $("rolePill").textContent = r.toUpperCase();
  $("rolePill").classList.toggle("master", r === "master");
  $("masterZone").hidden = r !== "master";

  if (isDemo) DataService.init();
  DataService.onSites((s) => { sites = s || {}; renderSites(); fillSiteSelect(); renderPumps(); });
  DataService.onPumps((p) => { pumps = p || {}; renderPumps(); });
}

function signOut() {
  if (!isDemo && window.firebase) firebase.auth().signOut();
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
  if (editingSiteId) await DataService.updateSite(editingSiteId, data);
  else await DataService.addSite(data);
  closeModal("siteModal");
}

async function deleteSite(id) {
  if (!confirm(`Delete "${sites[id].name}" and ALL its pumps?`)) return;
  await DataService.deleteSite(id);
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
  if (editingPumpId) await DataService.updatePump(editingPumpId, data);
  else await DataService.addPump(data);
  closeModal("pumpModal");
}

async function deletePump(id) {
  if (!confirm(`Delete pump "${pumps[id].name}"?`)) return;
  await DataService.deletePump(id);
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
  for (const id of Object.keys(pumps)) await DataService.deletePump(id);
  for (const id of Object.keys(sites)) await DataService.deleteSite(id);
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
