/* =========================================================
   charts.js — lightweight SVG charts (no dependencies).
   All functions return HTML strings; call Charts.bindTooltips(root)
   after inserting into the DOM to enable hover tooltips.
   ========================================================= */
"use strict";

const Charts = (() => {
  const PALETTE = ["#0ea5e9", "#8b5cf6", "#16a34a", "#f59e0b", "#ef4444", "#0d9488", "#2563eb", "#db2777", "#84cc16", "#64748b"];

  const niceMax = v => {
    if (v <= 0) return 100;
    const pow = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / pow;
    const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return step * pow;
  };

  const fmtTick = v => v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : String(Math.round(v));

  function frame(w, h) { return { w, h, padL: 44, padR: 10, padT: 12, padB: 26 }; }

  function gridlines(f, max, fmt = fmtTick) {
    let out = "";
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const v = max * i / steps;
      const y = f.h - f.padB - (f.h - f.padT - f.padB) * i / steps;
      out += `<line x1="${f.padL}" y1="${y}" x2="${f.w - f.padR}" y2="${y}" stroke="var(--chart-grid)" stroke-width="1"/>`;
      out += `<text x="${f.padL - 6}" y="${y + 3.5}" text-anchor="end" font-size="10" fill="var(--text-3)">${fmt(v)}</text>`;
    }
    return out;
  }

  /** Grouped bars. series = [{name, color, values:[…]}], labels aligned with values. */
  function barChart({ labels, series, height = 240, money = true }) {
    const f = frame(720, height);
    const innerW = f.w - f.padL - f.padR, innerH = f.h - f.padT - f.padB;
    const max = niceMax(Math.max(1, ...series.flatMap(s => s.values.map(v => Math.abs(v)))));
    const n = labels.length || 1;
    const slot = innerW / n;
    const barW = Math.min(26, (slot * 0.72) / series.length);
    let bars = "";
    labels.forEach((lb, i) => {
      const cx = f.padL + slot * i + slot / 2;
      series.forEach((s, si) => {
        const v = Math.max(0, s.values[i] || 0);
        const bh = (v / max) * innerH;
        const x = cx - (barW * series.length) / 2 + si * barW;
        const tip = `${lb} · ${s.name}: ${money ? U.money(v) : U.num(v, 0)}`;
        bars += `<rect x="${x}" y="${f.h - f.padB - bh}" width="${barW - 2}" height="${Math.max(bh, v > 0 ? 2 : 0)}" rx="3" fill="${s.color || PALETTE[si]}" data-tip="${U.escapeHtml(tip)}"/>`;
      });
      if (n <= 14 || i % 2 === 0)
        bars += `<text x="${cx}" y="${f.h - 8}" text-anchor="middle" font-size="10" fill="var(--text-3)">${U.escapeHtml(lb)}</text>`;
    });
    const legend = series.length > 1 ? legendHtml(series.map((s, i) => ({ name: s.name, color: s.color || PALETTE[i] }))) : "";
    return `<div class="chart-box"><svg viewBox="0 0 ${f.w} ${f.h}" preserveAspectRatio="xMidYMid meet">${gridlines(f, max)}${bars}</svg>${legend}</div>`;
  }

  /** Line chart. series = [{name, color, values}] */
  function lineChart({ labels, series, height = 240, money = true }) {
    const f = frame(720, height);
    const innerW = f.w - f.padL - f.padR, innerH = f.h - f.padT - f.padB;
    const allVals = series.flatMap(s => s.values);
    const maxV = niceMax(Math.max(1, ...allVals.map(v => Math.abs(v))));
    const hasNeg = allVals.some(v => v < 0);
    const minV = hasNeg ? -maxV : 0;
    const n = labels.length || 1;
    const xAt = i => f.padL + (n === 1 ? innerW / 2 : innerW * i / (n - 1));
    const yAt = v => f.padT + innerH * (1 - (v - minV) / (maxV - minV));
    let out = gridlines(f, maxV, fmtTick);
    if (hasNeg) out += `<line x1="${f.padL}" y1="${yAt(0)}" x2="${f.w - f.padR}" y2="${yAt(0)}" stroke="var(--text-3)" stroke-width="1" stroke-dasharray="3 3"/>`;
    series.forEach((s, si) => {
      const color = s.color || PALETTE[si];
      const pts = s.values.map((v, i) => `${xAt(i)},${yAt(v)}`).join(" ");
      out += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
      s.values.forEach((v, i) => {
        const tip = `${labels[i]} · ${s.name}: ${money ? U.money(v) : U.num(v, 0)}`;
        out += `<circle cx="${xAt(i)}" cy="${yAt(v)}" r="3.5" fill="${color}" data-tip="${U.escapeHtml(tip)}"/>`;
      });
    });
    labels.forEach((lb, i) => {
      if (n <= 14 || i % 2 === 0)
        out += `<text x="${xAt(i)}" y="${f.h - 8}" text-anchor="middle" font-size="10" fill="var(--text-3)">${U.escapeHtml(lb)}</text>`;
    });
    const legend = series.length > 1 ? legendHtml(series.map((s, i) => ({ name: s.name, color: s.color || PALETTE[i] }))) : "";
    return `<div class="chart-box"><svg viewBox="0 0 ${f.w} ${f.h}" preserveAspectRatio="xMidYMid meet">${out}</svg>${legend}</div>`;
  }

  /** Donut. items = [{name, value}] */
  function donut({ items, height = 210, money = true, centerLabel = "" }) {
    const total = U.sum(items, x => x.value);
    const size = height, r = size / 2 - 8, cx = size / 2, cy = size / 2, inner = r * 0.62;
    if (total <= 0) return `<div class="empty-state" style="padding:24px"><div class="es-sub">No data yet</div></div>`;
    let angle = -Math.PI / 2, paths = "";
    const shown = items.filter(x => x.value > 0).slice(0, 9);
    const other = U.sum(items.filter(x => x.value > 0).slice(9), x => x.value);
    if (other > 0) shown.push({ name: "Other", value: other });
    shown.forEach((it, i) => {
      const frac = it.value / total;
      const a2 = angle + frac * Math.PI * 2;
      const large = frac > 0.5 ? 1 : 0;
      const p = (a, rad) => `${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`;
      const tip = `${it.name}: ${money ? U.money(it.value) : U.num(it.value, 0)} (${U.pct(frac * 100, 0)})`;
      if (frac >= 0.999) {
        paths += `<circle cx="${cx}" cy="${cy}" r="${(r + inner) / 2}" fill="none" stroke="${PALETTE[i % PALETTE.length]}" stroke-width="${r - inner}" data-tip="${U.escapeHtml(tip)}"/>`;
      } else {
        paths += `<path d="M ${p(angle, r)} A ${r} ${r} 0 ${large} 1 ${p(a2, r)} L ${p(a2, inner)} A ${inner} ${inner} 0 ${large} 0 ${p(angle, inner)} Z"
          fill="${PALETTE[i % PALETTE.length]}" data-tip="${U.escapeHtml(tip)}" stroke="var(--bg-elev)" stroke-width="1.5"/>`;
      }
      angle = a2;
    });
    const center = `<text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="15" font-weight="800" fill="var(--text)">${money ? U.money(total, { cents: false }) : U.num(total)}</text>
      <text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="9.5" fill="var(--text-3)">${U.escapeHtml(centerLabel)}</text>`;
    const legend = legendHtml(shown.map((s, i) => ({ name: `${s.name} (${money ? U.money(s.value, { cents: false }) : U.num(s.value)})`, color: PALETTE[i % PALETTE.length] })));
    return `<div class="chart-box" style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
      <svg viewBox="0 0 ${size} ${size}" style="max-width:${size}px;flex:none">${paths}${center}</svg>
      <div style="flex:1;min-width:150px">${legend}</div></div>`;
  }

  /** Horizontal bars. items = [{name, value, sub}] */
  function hbar({ items, money = true, maxItems = 8, valueFmt }) {
    const shown = items.slice(0, maxItems);
    if (!shown.length) return `<div class="empty-state" style="padding:24px"><div class="es-sub">No data yet</div></div>`;
    const max = Math.max(1, ...shown.map(x => Math.abs(x.value)));
    const fmt = valueFmt || (v => money ? U.money(v, { cents: false }) : U.num(v, 0));
    return `<div>${shown.map((it, i) => `
      <div style="margin-bottom:9px">
        <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:3px;gap:8px">
          <span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${U.escapeHtml(it.name)}</span>
          <span style="font-variant-numeric:tabular-nums;font-weight:700;flex:none">${fmt(it.value)}${it.sub ? ` <span style="color:var(--text-3);font-weight:400">${U.escapeHtml(it.sub)}</span>` : ""}</span>
        </div>
        <div class="progress"><div style="width:${Math.max(2, Math.abs(it.value) / max * 100)}%;background:${it.color || PALETTE[i % PALETTE.length]}"></div></div>
      </div>`).join("")}</div>`;
  }

  /** Score ring 0–100. */
  function scoreRing(score, { size = 130, label = "" } = {}) {
    const s = Math.max(0, Math.min(100, Math.round(score)));
    const r = size / 2 - 10, c = 2 * Math.PI * r;
    const color = s >= 85 ? "var(--green)" : s >= 60 ? "var(--amber)" : "var(--red)";
    return `<svg viewBox="0 0 ${size} ${size}" style="max-width:${size}px;flex:none">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--bg-sunken)" stroke-width="11"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="11"
        stroke-linecap="round" stroke-dasharray="${c * s / 100} ${c}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
      <text x="50%" y="${size / 2 + 2}" text-anchor="middle" font-size="${size / 4.6}" font-weight="800" fill="var(--text)">${s}</text>
      <text x="50%" y="${size / 2 + size / 6.5}" text-anchor="middle" font-size="${size / 13}" fill="var(--text-3)">${U.escapeHtml(label)}</text>
    </svg>`;
  }

  /** Progress gauge (e.g. tax reserve funded). */
  function gaugeBar(value, target, { label = "", money = true } = {}) {
    const pct = target > 0 ? Math.min(100, value / target * 100) : 0;
    const color = pct >= 100 ? "var(--green)" : pct >= 60 ? "var(--accent)" : "var(--amber)";
    const fmt = v => money ? U.money(v, { cents: false }) : U.num(v);
    return `<div>
      <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:5px">
        <span style="font-weight:600">${U.escapeHtml(label)}</span>
        <span style="font-weight:700">${fmt(value)} <span style="color:var(--text-3);font-weight:400">of ${fmt(target)}</span></span>
      </div>
      <div class="progress" style="height:11px"><div style="width:${pct}%;background:${color}"></div></div>
    </div>`;
  }

  function legendHtml(items) {
    return `<div class="chart-legend">${items.map(it =>
      `<span class="lg-item"><span class="lg-swatch" style="background:${it.color}"></span>${U.escapeHtml(it.name)}</span>`).join("")}</div>`;
  }

  /* Tooltip binding — one floating tooltip for all charts */
  let tipEl = null;
  function bindTooltips(root = document) {
    root.querySelectorAll("[data-tip]").forEach(el => {
      el.addEventListener("mouseenter", e => showTip(e, el.getAttribute("data-tip")));
      el.addEventListener("mousemove", e => moveTip(e));
      el.addEventListener("mouseleave", hideTip);
      el.addEventListener("touchstart", e => { showTip(e.touches[0], el.getAttribute("data-tip")); setTimeout(hideTip, 1800); }, { passive: true });
    });
  }
  function showTip(e, text) {
    hideTip();
    tipEl = document.createElement("div");
    tipEl.className = "chart-tooltip";
    tipEl.textContent = text;
    document.body.appendChild(tipEl);
    moveTip(e);
  }
  function moveTip(e) { if (tipEl) { tipEl.style.left = e.clientX + "px"; tipEl.style.top = e.clientY + "px"; } }
  function hideTip() { if (tipEl) { tipEl.remove(); tipEl = null; } }

  return { barChart, lineChart, donut, hbar, scoreRing, gaugeBar, bindTooltips, PALETTE };
})();
