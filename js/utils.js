/* =========================================================
   utils.js — shared helpers (no dependencies)
   ========================================================= */
"use strict";

const U = {
  /** Unique id: timestamp + random suffix */
  uid(prefix = "id") {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  },

  todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  },

  nowISO() { return new Date().toISOString(); },

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
