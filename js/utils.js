/* =========================================================
   utils.js — shared helpers (no dependencies)
   ========================================================= */
"use strict";

const U = {
  /** Unique id: timestamp + random suffix */
  uid(prefix = "id") {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  },

  todayISO() { return U.localDateOf(new Date()); },

  /** Calendar date (YYYY-MM-DD) of a timestamp in *local* time — an ISO
      timestamp sliced to 10 chars is UTC, which lands on the wrong day
      for anything logged in the evening. */
  localDateOf(ts) {
    const d = ts ? new Date(ts) : new Date();
    if (isNaN(d.getTime())) return "";
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  },

  nowISO() { return new Date().toISOString(); },

  addDaysISO(iso, n) {
    const d = U.parseDate(iso);
    if (!d) return "";
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  },

  /** Parse "YYYY-MM-DD" safely as a local date (avoids UTC off-by-one). */
  parseDate(iso) {
    if (!iso) return null;
    const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  },

  fmtDate(iso) {
    const d = U.parseDate(iso);
    if (!d) return "—";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  },

  fmtDateShort(iso) {
    const d = U.parseDate(iso);
    if (!d) return "—";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  },

  fmtDateTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) +
      " " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  },

  money(n, opts = {}) {
    const v = Number(n) || 0;
    return v.toLocaleString("en-US", {
      style: "currency", currency: "USD",
      minimumFractionDigits: opts.cents === false ? 0 : 2,
      maximumFractionDigits: opts.cents === false ? 0 : 2,
    });
  },

  num(n, dec = 0) {
    return (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  },

  pct(n, dec = 0) { return `${U.num(n, dec)}%`; },

  round2(n) { return Math.round((Number(n) || 0) * 100) / 100; },

  yearOf(iso) {
    const d = U.parseDate(iso);
    return d ? d.getFullYear() : null;
  },

  monthKey(iso) { return iso ? String(iso).slice(0, 7) : null; },

  monthLabel(key) { // "2026-03" -> "Mar"
    if (!key) return "";
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "short" });
  },

  daysBetween(isoA, isoB) {
    const a = U.parseDate(isoA), b = U.parseDate(isoB);
    if (!a || !b) return null;
    return Math.round((b - a) / 86400000);
  },

  daysFromToday(iso) { return U.daysBetween(U.todayISO(), iso); },

  escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  },

  /** html`` tag: auto-escapes ${} values; use ${U.raw(x)} for trusted markup. */
  raw(s) { return { __raw: String(s ?? "") }; },
  html(strings, ...values) {
    return strings.reduce((out, str, i) => {
      let v = values[i - 1];
      if (v && v.__raw !== undefined) v = v.__raw;
      else if (Array.isArray(v)) v = v.map(x => x && x.__raw !== undefined ? x.__raw : U.escapeHtml(x)).join("");
      else v = U.escapeHtml(v);
      return out + v + str;
    });
  },

  debounce(fn, ms = 250) {
    let t;
    return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
  },

  /** Download text content as a file */
  download(filename, content, mime = "application/json") {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 300);
  },

  /** CSV export: rows = array of objects, cols = [{key,label}] */
  toCSV(rows, cols) {
    const esc = v => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = cols.map(c => esc(c.label)).join(",");
    const body = rows.map(r => cols.map(c => esc(typeof c.value === "function" ? c.value(r) : r[c.key])).join(",")).join("\n");
    return head + "\n" + body;
  },

  sum(arr, fn = x => x) { return arr.reduce((t, x) => t + (Number(fn(x)) || 0), 0); },

  groupBy(arr, keyFn) {
    const m = {};
    for (const x of arr) { const k = keyFn(x) ?? "—"; (m[k] = m[k] || []).push(x); }
    return m;
  },

  sortBy(arr, fn, dir = 1) {
    return [...arr].sort((a, b) => {
      const av = fn(a), bv = fn(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return 0;
    });
  },

  titleCase(s) { return String(s || "").replace(/\b\w/g, c => c.toUpperCase()); },

  truncate(s, n = 60) {
    s = String(s || "");
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  },

  /** Deep clone via JSON (fine for our plain-data records) */
  clone(o) { return JSON.parse(JSON.stringify(o)); },

  /** Squash a multi-line address into one line ("12 Oak St\nRoanoke, VA" → "12 Oak St, Roanoke, VA"). */
  addressLine(s) {
    return String(s || "").split("\n").map(x => x.trim()).filter(Boolean).join(", ");
  },

  /** Google Maps driving directions to an address. On a phone with the Maps app
      installed this universal link opens the app straight into navigation. */
  mapsDirectionsUrl(address) {
    return `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent(U.addressLine(address))}`;
  },

  /** Copy text to the clipboard → Promise<boolean>. Falls back to the old
      execCommand trick where the async Clipboard API isn't allowed. */
  async copyText(text) {
    const s = String(text ?? "");
    try {
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(s); return true; }
    } catch (e) { /* fall through to the legacy path */ }
    try {
      const ta = document.createElement("textarea");
      ta.value = s;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0";
      document.body.appendChild(ta);
      ta.select(); ta.setSelectionRange(0, s.length);
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  },

  /* Geocoding cache + fair-use gate. Nominatim asks for at most one request a
     second, so every lookup goes through here: repeats (your office address on
     a whole batch of jobs) are answered from memory and never hit the network. */
  _geoCache: {},
  _geoAt: 0,

  /** One Nominatim lookup → {lon, lat, display_name} or null. Rate-gated + cached. */
  async _geoLookup(q) {
    const key = q.toLowerCase();
    if (key in U._geoCache) return U._geoCache[key];
    const wait = 1100 - (Date.now() - U._geoAt);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    U._geoAt = Date.now();
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`);
    if (!res.ok) throw new Error(`Address lookup failed (${res.status}) — try again in a moment`);
    const js = await res.json();
    U._geoCache[key] = js.length ? js[0] : null;
    return U._geoCache[key];
  },

  /** Address → {coord: "lon,lat", approx, matched}.
      Plenty of rural and new-build house numbers simply aren't in OpenStreetMap.
      Rather than give up on the whole address, fall back to the street and then
      the town — a few hundred feet of error on a 60-mile drive, flagged as
      approximate so the trip can say so. */
  async geocodeDetail(q) {
    const full = U.addressLine(q);
    if (!full) throw new Error("No address to look up");
    const parts = full.split(",").map(s => s.trim()).filter(Boolean);
    const tries = [full];
    // same address minus the house number, then minus the street entirely
    const noNumber = parts.length > 1 ? [parts[0].replace(/^[\d-]+\s+/, ""), ...parts.slice(1)].join(", ") : "";
    if (noNumber && noNumber !== full) tries.push(noNumber);
    if (parts.length > 1) tries.push(parts.slice(1).join(", "));
    for (let i = 0; i < tries.length; i++) {
      const hit = await U._geoLookup(tries[i]);
      if (hit) return { coord: `${hit.lon},${hit.lat}`, approx: i > 0, matched: hit.display_name || tries[i] };
    }
    throw new Error(`Couldn't find "${U.truncate(full, 38)}" — use a fuller street address`);
  },

  /** Address → "lon,lat". */
  async geocode(q) { return (await U.geocodeDetail(q)).coord; },

  /** Driving route between two addresses (one way).
      → {miles, approx, matchedFrom, matchedTo}. Free OpenStreetMap services
      (Nominatim geocoding + OSRM routing) — no API key. */
  async drivingRoute(from, to) {
    const a = await U.geocodeDetail(from);
    const b = await U.geocodeDetail(to);
    const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${a.coord};${b.coord}?overview=false`);
    if (!res.ok) throw new Error(`Routing failed (${res.status}) — try again in a moment`);
    const js = await res.json();
    if (js.code !== "Ok" || !js.routes || !js.routes.length) throw new Error("No driving route found between those addresses");
    return { miles: js.routes[0].distance / 1609.344, approx: a.approx || b.approx, matchedFrom: a.matched, matchedTo: b.matched };
  },

  /** One-way driving distance in miles between two addresses. */
  async drivingMiles(from, to) { return (await U.drivingRoute(from, to)).miles; },

  /** Shallow diff for the audit log: returns [{field, from, to}] */
  diff(before, after, skip = ["updatedAt", "editHistory"]) {
    const out = [];
    const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
    for (const k of keys) {
      if (skip.includes(k)) continue;
      const a = before ? before[k] : undefined;
      const b = after ? after[k] : undefined;
      if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ field: k, from: a ?? "", to: b ?? "" });
    }
    return out;
  },
};

// Convenience: tagged template alias
const html = U.html;
