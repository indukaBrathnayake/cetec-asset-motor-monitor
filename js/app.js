/* ============================================================
   CETEC Asset Motor Monitor — Dashboard (read-only)
   Users monitor sites & pumps here. All editing lives at /admin/ (unlisted).
   ============================================================ */

"use strict";

let sites = {};      // { siteId: {name, lat, lng} }
let pumps = {};      // { pumpId: {name, siteId, lat, lng, ...runtime} }
let markers = {};    // pumpId -> Leaflet marker
let selectedSite = null;
let selectedPump = null;
let faultLogs = JSON.parse(localStorage.getItem("cetec_logs") || "[]");
let mainMap, liveChart;

const $ = (id) => document.getElementById(id);
const sevClass = (s) => (s === "ALERT" ? "alert" : s === "WARN" ? "warn" : s === "OK" ? "ok" : "");

/* ---------------- INIT ---------------- */
window.addEventListener("DOMContentLoaded", () => {
  $("telegramBtn").href = CONFIG.TELEGRAM_BOT_URL;

  // Theme
  const savedTheme = localStorage.getItem("cetec_theme") || "dark";
  applyTheme(savedTheme);
  $("themeToggle").checked = savedTheme === "dark";
  $("themeToggle").addEventListener("change", (e) =>
    applyTheme(e.target.checked ? "dark" : "light"));

  // Drawer (overlay on mobile, docked on desktop)
  $("drawerBtn").addEventListener("click", toggleDrawer);
  $("drawerBackdrop").addEventListener("click", closeDrawer);
  if (isMobile()) $("drawer").classList.add("closed");

  initMap();
  initChart();

  // Data source
  DataService.init();
  if (DataService.label) {
    $("demoBanner").hidden = false;
    $("demoBanner").textContent = "⚙ " + DataService.label;
  }
  DataService.onSites((s) => { sites = s || {}; renderTree(); refreshMarkers(); });
  DataService.onPumps((p) => {
    // keep runtime fields when pump config refreshes
    const next = {};
    Object.entries(p || {}).forEach(([id, cfg]) => {
      next[id] = { ...cfg, ...pickRuntime(pumps[id]) };
    });
    pumps = next;
    renderTree(); renderCards(); refreshMarkers(); updateKpis();
  });
  DataService.onTelemetry(handleTelemetry);

  // Cloud link indicator (dashboard ↔ Firebase). In a power cut at the
  // sites this stays GREEN — sensor loss shows per-pump as OFFLINE.
  if (DataService.onConnection) {
    DataService.onConnection((up) => {
      $("cloudPill").className = "cloud-pill " + (up ? "on" : "off");
      $("cloudLed").className = "led " + (up ? "ok" : "alert");
      $("cloudText").textContent = DataService.label
        ? "Demo" : (up ? "Cloud OK" : "Cloud lost");
    });
  }

  // Leaflet needs a size refresh whenever the layout changes on
  // mobile (rotation, keyboard, drawer) or tiles render grey/misaligned.
  let rsT;
  window.addEventListener("resize", () => {
    clearTimeout(rsT);
    rsT = setTimeout(() => mainMap.invalidateSize(), 200);
  });
  window.addEventListener("orientationchange", () =>
    setTimeout(() => mainMap.invalidateSize(), 300));
  setTimeout(() => mainMap.invalidateSize(), 400); // after first paint

  setInterval(checkOffline, 3000);
});

const pickRuntime = (old) => old
  ? { sev: old.sev, fault: old.fault, v: old.v, freq: old.freq, ts: old.ts, history: old.history }
  : {};

const isMobile = () => window.innerWidth < 860;

function toggleDrawer() {
  const closed = $("drawer").classList.toggle("closed");
  document.body.classList.toggle("drawer-open", !closed && isMobile());
  setTimeout(() => mainMap && mainMap.invalidateSize(), 280); // after CSS transition
}
function closeDrawer() {
  $("drawer").classList.add("closed");
  document.body.classList.remove("drawer-open");
}

function applyTheme(t) {
  document.body.setAttribute("data-theme", t === "dark" ? "" : "light");
  localStorage.setItem("cetec_theme", t);
}

/* ---------------- MAP ---------------- */
function initMap() {
  mainMap = L.map("mainMap", { zoomControl: false })
    .setView(CONFIG.MAP_CENTER, CONFIG.MAP_ZOOM);
  L.control.zoom({ position: "topright" }).addTo(mainMap);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap",
  }).addTo(mainMap);
}

function markerIcon(sev) {
  const color = { OK: "#2fbf71", WARN: "#f5a623", ALERT: "#ef4e4e" }[sev] || "#5b6b80";
  return L.divIcon({
    className: "",
    html: `<div style="width:16px;height:16px;border-radius:50%;
      background:${color};border:2.5px solid #fff;
      box-shadow:0 0 8px ${color}"></div>`,
    iconSize: [16, 16], iconAnchor: [8, 8],
  });
}

function refreshMarkers() {
  Object.keys(markers).forEach((id) => {
    if (!pumps[id]) { mainMap.removeLayer(markers[id]); delete markers[id]; }
  });
  Object.entries(pumps).forEach(([id, p]) => {
    if (!markers[id]) {
      markers[id] = L.marker([p.lat, p.lng], { icon: markerIcon(p.sev) })
        .addTo(mainMap)
        .on("click", () => selectPump(id));
    } else {
      markers[id].setLatLng([p.lat, p.lng]);
      markers[id].setIcon(markerIcon(p.sev));
    }
    markers[id].bindPopup(popupHtml(id));
  });
}

function popupHtml(id) {
  const p = pumps[id];
  const siteName = sites[p.siteId]?.name || "—";
  return `<b>${p.name}</b><br>${siteName}<br>
    Status: <b>${p.sev || "OFFLINE"}</b><br>
    Condition: ${p.fault || "—"}<br>
    Vibration: ${p.v != null ? p.v.toFixed(2) + " mm/s" : "—"}`;
}

/* ---------------- SITE NAVIGATOR ---------------- */
function renderTree() {
  const tree = $("siteTree");
  tree.innerHTML = "";
  Object.entries(sites).forEach(([sid, s]) => {
    const sitePumps = Object.entries(pumps).filter(([, p]) => p.siteId === sid);
    const worst = worstSev(sitePumps.map(([, p]) => p.sev));

    const group = document.createElement("div");
    group.className = "site-group" + (selectedSite === sid ? " open" : "");

    const row = document.createElement("button");
    row.className = "site-row" + (selectedSite === sid ? " selected" : "");
    row.innerHTML = `<span class="led ${sevClass(worst)}"></span>
      <span>${s.name}</span>
      <span class="site-count">${sitePumps.length}</span>
      <span class="chev">▸</span>`;
    row.onclick = () => selectSite(sid);
    group.appendChild(row);

    const list = document.createElement("div");
    list.className = "pump-list";
    sitePumps.forEach(([pid, p]) => {
      const pr = document.createElement("button");
      pr.className = "pump-row" + (selectedPump === pid ? " selected" : "");
      pr.innerHTML = `<span class="led ${sevClass(p.sev)}"></span>
        <span>${p.name}</span>
        <span class="p-val">${p.v != null ? p.v.toFixed(1) : "--"} mm/s</span>`;
      pr.onclick = () => selectPump(pid);
      list.appendChild(pr);
    });
    group.appendChild(list);
    tree.appendChild(group);
  });

  if (!Object.keys(sites).length) {
    tree.innerHTML = `<p style="color:var(--text-dim);font-size:12.5px;padding:8px">
      No sites configured yet. An administrator can add sites and pumps
      from the Admin panel.</p>`;
  }
}

function worstSev(list) {
  if (list.includes("ALERT")) return "ALERT";
  if (list.includes("WARN")) return "WARN";
  if (list.includes("OK")) return "OK";
  return "OFFLINE";
}

function selectSite(sid) {
  selectedSite = selectedSite === sid ? null : sid;
  renderTree(); renderCards();
  const s = sites[sid];
  if (selectedSite && s) {
    mainMap.flyTo([s.lat, s.lng], 16, { duration: 1.2 });
    $("mapBadgeText").textContent = s.name;
  } else {
    $("mapBadgeText").textContent = "All sites";
  }
}

function showAllSites() {
  selectedSite = null; renderTree(); renderCards();
  $("mapBadgeText").textContent = "All sites";
  const pts = Object.values(pumps).map((p) => [p.lat, p.lng]);
  if (pts.length) mainMap.flyToBounds(L.latLngBounds(pts).pad(0.25), { duration: 1.2 });
}

function selectPump(pid) {
  selectedPump = pid;
  const p = pumps[pid];
  if (!p) return;
  if (p.siteId !== selectedSite) { selectedSite = p.siteId; }
  renderTree(); renderCards();
  if (isMobile()) closeDrawer(); // let the user see the map they just navigated to
  mainMap.flyTo([p.lat, p.lng], 18, { duration: 1 });
  markers[pid]?.openPopup();
  $("chartTitle").textContent = `Live Vibration — ${p.name}`;
  $("detailGrid").hidden = false;
  updateDetail(p);
  liveChart.data.datasets[0].data = p.history || Array(CONFIG.CHART_POINTS).fill(0);
  liveChart.update("none");
  // On phones the chart sits below the map — bring it into view so the
  // selection has an obvious result.
  if (isMobile()) setTimeout(() =>
    $("chartTitle").scrollIntoView({ behavior: "smooth", block: "start" }), 350);
}

/* ---------------- PUMP CARDS (right rail) ---------------- */
function renderCards() {
  const wrap = $("pumpCards");
  wrap.innerHTML = "";
  const list = Object.entries(pumps)
    .filter(([, p]) => !selectedSite || p.siteId === selectedSite);

  list.forEach(([pid, p]) => {
    const card = document.createElement("div");
    card.className = `pump-card s-${sevClass(p.sev)}` + (selectedPump === pid ? " selected" : "");
    card.id = "pc-" + pid;
    card.onclick = () => selectPump(pid);
    card.innerHTML = `
      <div class="pc-head">
        <span class="pc-name">${p.name}</span>
        <span class="risk-badge ${sevClass(p.sev)}" id="badge-${pid}">${p.sev || "OFFLINE"}</span>
      </div>
      <div class="pc-site">📍 ${sites[p.siteId]?.name || "—"}</div>
      <div class="pc-row"><span>Condition</span><b id="fault-${pid}">${p.fault || "—"}</b></div>
      <div class="pc-row"><span>Vibration</span><b><span id="val-${pid}">${p.v != null ? p.v.toFixed(2) : "--"}</span> mm/s</b></div>`;
    wrap.appendChild(card);
  });

  if (!list.length) {
    wrap.innerHTML = `<div class="card"><p style="margin:0;color:var(--text-dim);font-size:13px">
      No pumps at this site yet.</p></div>`;
  }
}

/* ---------------- CHART ---------------- */
function initChart() {
  liveChart = new Chart($("liveChart").getContext("2d"), {
    type: "line",
    data: {
      labels: Array(CONFIG.CHART_POINTS).fill(""),
      datasets: [{
        label: "Vibration (mm/s)",
        data: Array(CONFIG.CHART_POINTS).fill(0),
        borderColor: "#35d0e0",
        backgroundColor: "rgba(53,208,224,0.10)",
        fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2,
      }],
    },
    options: {
      animation: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, suggestedMax: 10, grid: { color: "rgba(128,148,170,0.12)" } },
        x: { display: false },
      },
    },
  });
}

/* ---------------- TELEMETRY ---------------- */
function handleTelemetry(t) {
  const p = pumps[t.pumpId];
  if (!p) return;

  p.v = t.v; p.freq = t.freq; p.fault = t.fault; p.sev = t.sev; p.ts = t.ts;
  p.history = p.history || Array(CONFIG.CHART_POINTS).fill(0);
  p.history.push(t.v); p.history.shift();

  // Inline DOM updates (cheap path — avoids full re-render each packet)
  const badge = $("badge-" + t.pumpId);
  if (badge) { badge.textContent = t.sev; badge.className = "risk-badge " + sevClass(t.sev); }
  const val = $("val-" + t.pumpId);
  if (val) val.textContent = t.v.toFixed(2);
  const fault = $("fault-" + t.pumpId);
  if (fault) fault.textContent = t.fault;
  const card = $("pc-" + t.pumpId);
  if (card) card.className =
    `pump-card s-${sevClass(t.sev)}` + (selectedPump === t.pumpId ? " selected" : "");

  markers[t.pumpId]?.setIcon(markerIcon(t.sev));
  markers[t.pumpId]?.setPopupContent(popupHtml(t.pumpId));

  // Emergency handling
  if (t.sev === "WARN" || t.sev === "ALERT") {
    logFault(t.pumpId, t.fault, t.sev);
    if (t.sev === "ALERT") document.body.classList.add("emergency-active");
  }
  if (!Object.values(pumps).some((x) => x.sev === "ALERT")) {
    document.body.classList.remove("emergency-active");
  }

  if (selectedPump === t.pumpId) {
    updateDetail(p);
    liveChart.data.datasets[0].data = p.history;
    liveChart.data.datasets[0].borderColor =
      t.sev === "ALERT" ? "#ef4e4e" : t.sev === "WARN" ? "#f5a623" : "#35d0e0";
    liveChart.update("none");
  }

  // Throttled tree refresh so LEDs stay current
  throttleTree();
  updateKpis();
}

let treeTimer = null;
function throttleTree() {
  if (treeTimer) return;
  treeTimer = setTimeout(() => { renderTree(); treeTimer = null; }, 2000);
}

function updateDetail(p) {
  $("dVib").textContent = p.v != null ? p.v.toFixed(2) + " mm/s" : "--";
  $("dFreq").textContent = p.freq != null ? p.freq.toFixed(1) + " Hz" : "--";
  $("dFault").textContent = p.fault || "--";
  $("dTs").textContent = p.ts ? new Date(p.ts).toLocaleTimeString() : "--";
}

function checkOffline() {
  const now = Date.now();
  let changed = false;
  Object.entries(pumps).forEach(([pid, p]) => {
    if (p.ts && now - p.ts > CONFIG.OFFLINE_TIMEOUT_MS && p.sev !== "OFFLINE") {
      p.sev = "OFFLINE";
      p.fault = "No data since " + new Date(p.ts).toLocaleTimeString();
      logFault(pid, "Sensor offline — no data received (power cut / WiFi loss?)", "OFFLINE");
      changed = true;
    }
  });
  if (changed) { renderTree(); renderCards(); refreshMarkers(); updateKpis(); }
}

function updateKpis() {
  const all = Object.values(pumps);
  $("kpiTotal").textContent = all.length;
  $("kpiOnline").textContent = all.filter((p) => p.sev === "OK").length;
  $("kpiWarn").textContent = all.filter((p) => p.sev === "WARN").length;
  $("kpiAlert").textContent = all.filter((p) => p.sev === "ALERT").length;
}

/* ---------------- FAULT LOG ---------------- */
function logFault(pumpId, fault, sev) {
  const p = pumps[pumpId];
  const last = faultLogs[faultLogs.length - 1];
  if (last && last.pumpId === pumpId && last.fault === fault &&
      Date.now() - last.ts < 60000) return; // de-dupe 1 min
  faultLogs.push({
    ts: Date.now(),
    pumpId,
    pump: p?.name || pumpId,
    site: sites[p?.siteId]?.name || "—",
    fault, sev,
  });
  if (faultLogs.length > 500) faultLogs = faultLogs.slice(-500);
  localStorage.setItem("cetec_logs", JSON.stringify(faultLogs));
}

function openLogModal() {
  const tbody = $("logTableBody");
  tbody.innerHTML = "";
  [...faultLogs].reverse().forEach((l) => {
    const tr = document.createElement("tr");
    tr.className = "sev-" + l.sev;
    tr.innerHTML = `<td>${new Date(l.ts).toLocaleString()}</td>
      <td>${l.site}</td><td>${l.pump}</td><td>${l.fault}</td><td>${l.sev}</td>`;
    tbody.appendChild(tr);
  });
  if (!faultLogs.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:var(--text-dim)">
      No faults recorded yet.</td></tr>`;
  }
  $("logModal").classList.add("open");
}

function downloadLog() {
  let csv = "Timestamp,Site,Pump,Fault,Severity\n";
  faultLogs.forEach((l) => {
    csv += `"${new Date(l.ts).toLocaleString()}","${l.site}","${l.pump}","${l.fault}","${l.sev}"\n`;
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = "CETEC_Fault_Report.csv";
  a.click();
}
