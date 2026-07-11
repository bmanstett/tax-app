/* =========================================================
   views/mileage.js — field-optimized mileage log with
   substantiation score and CPA export.
   ========================================================= */
"use strict";

window.Views = window.Views || {};

const Mileage = (() => {
  function openEditor(rec, presets) {
    UI.openForm("mileage", rec, {
      presets,
      onSave: vals => {
        // derive miles from odometer if not typed
        if ((!vals.miles || Number(vals.miles) === 0) && vals.odometerStart && vals.odometerEnd) {
          vals.miles = U.round2(Number(vals.odometerEnd) - Number(vals.odometerStart));
        }
        if (rec) Store.update("mileage", rec.id, vals); else Store.add("mileage", vals);
        UI.toast(rec ? "Trip updated" : `Trip logged — ${U.num(vals.miles, 1)} mi`, "success");
        App.rerender();
      },
      deleteFn: r => { Store.remove("mileage", r.id); UI.toast("Trip deleted"); App.rerender(); },
    });
  }

  /** Quick "log inspection trip" — minimal fields, WO-aware. */
  function quickTrip() {
    const wos = Store.all("workOrder").filter(w => SCHEMA.woOpenStatuses.includes(w.status) || w.status === "Submitted");
    const m = UI.modal({
      title: "🚗 Log inspection trip",
      size: "sm",
      body: `
        <div class="field"><label>Work order (optional)</label>
          <select id="qt-wo"><option value="">— none —</option>
          ${wos.map(w => `<option value="${w.id}">${U.escapeHtml((w.woNumber || "WO") + " — " + U.truncate(w.lossLocation || Store.clientName(w.clientId), 34))}</option>`).join("")}</select></div>
        <div class="field"><label>Destination <span class="req">*</span></label><input type="text" id="qt-dest" placeholder="loss location address"></div>
        <div class="field"><label>Miles (total) <span class="req">*</span></label><input type="number" id="qt-miles" inputmode="decimal" step="0.1" placeholder="e.g. 58"></div>
        <div class="field"><label>Purpose</label><input type="text" id="qt-purpose" placeholder="e.g. roof inspection — claim #"></div>
        <div class="checkbox-field"><input type="checkbox" id="qt-round" checked><label for="qt-round">Round trip</label></div>`,
      footer: `<button class="btn" id="qt-cancel">Cancel</button><button class="btn btn-primary" id="qt-save">Log trip</button>`,
    });
    const woSel = m.body.querySelector("#qt-wo");
    woSel.addEventListener("change", () => {
      const w = Store.get("workOrder", woSel.value);
      if (w) {
        m.body.querySelector("#qt-dest").value = (w.lossLocation || "").split("\n")[0];
        m.body.querySelector("#qt-purpose").value = `${w.jobType || "Site"} inspection — ${w.woNumber || ""} ${w.claimNumber ? "claim " + w.claimNumber : ""}`.trim();
      }
    });
    m.footerEl.querySelector("#qt-cancel").addEventListener("click", () => m.close());
    m.footerEl.querySelector("#qt-save").addEventListener("click", () => {
      const dest = m.body.querySelector("#qt-dest").value.trim();
      const miles = Number(m.body.querySelector("#qt-miles").value);
      if (!dest || !miles) { UI.toast("Destination and miles are required", "error"); return; }
      const w = Store.get("workOrder", woSel.value);
      Store.add("mileage", {
        date: U.todayISO(), tripType: "Inspection", startLocation: Store.state.settings.homeBase || "Home office",
        destination: dest, miles, roundTrip: m.body.querySelector("#qt-round").checked,
        businessPurpose: m.body.querySelector("#qt-purpose").value.trim(),
        workOrderId: w ? w.id : "", clientId: w ? w.clientId : "",
        reimbursable: w ? !!w.mileageAllowed : false,
      });
      UI.toast(`Trip logged — ${U.num(miles, 1)} mi ≈ ${U.money(miles * Store.mileageRate(U.yearOf(U.todayISO())))}`, "success");
      m.close(); App.rerender();
    });
  }

  function exportLog() {
    const rows = U.sortBy(Store.all("mileage"), r => r.date || "", 1);
    const csv = U.toCSV(rows, [
      { key: "date", label: "Date" }, { key: "startLocation", label: "From" }, { key: "destination", label: "To" },
      { key: "businessPurpose", label: "Business Purpose" }, { key: "tripType", label: "Trip Type" },
      { label: "Client", value: r => Store.clientName(r.clientId) },
      { label: "Work Order", value: r => Store.woLabel(r.workOrderId) },
      { label: "Round Trip", value: r => r.roundTrip ? "Yes" : "No" },
      { key: "miles", label: "Miles" }, { key: "odometerStart", label: "Odometer Start" }, { key: "odometerEnd", label: "Odometer End" },
      { key: "parking", label: "Parking" }, { key: "tolls", label: "Tolls" },
      { label: "Rate", value: r => Store.mileageRate(U.yearOf(r.date)) },
      { label: "Est. Deduction", value: Store.tripDeduction },
      { label: "Reimbursable", value: r => r.reimbursable ? "Yes" : "No" },
      { label: "Reimbursed", value: r => r.reimbursed ? "Yes" : "No" },
      { key: "notes", label: "Notes" },
    ]);
    U.download("mileage-log.csv", csv, "text/csv");
    UI.toast("Mileage log downloaded", "success");
  }

  return { openEditor, quickTrip, exportLog };
})();

Views.mileage = {
  title: "Mileage",
  render(el) {
    const year = App.viewYear();
    const d = Store.yearData(year);
    const t = Store.taxSummary(year);
    const sub = Alerts.mileageScore(year);
    const byClient = Object.entries(U.groupBy(d.mileage.filter(m => m.clientId), m => Store.clientName(m.clientId)))
      .map(([name, rs]) => ({ name, value: U.sum(rs, r => r.miles) }));
    const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
    const milesByM = months.map(mm => U.sum(d.mileage.filter(r => U.monthKey(r.date) === mm), r => r.miles));

    el.innerHTML = UI.pageHeader("Mileage & Vehicle",
      `Business miles at $${t.mileageRate.toFixed(2)}/mi for ${year} (set rates in Settings). <strong>Commuting and personal miles are not business mileage</strong> — log business trips only.`,
      `<button class="btn" id="mi-export">⬇️ Export log</button>
       <button class="btn" id="mi-quick">⚡ Quick trip</button>
       <button class="btn btn-primary" id="mi-add">＋ Log Trip</button>`) + `
      <div class="stat-grid" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr))">
        ${UI.statCard({ label: `Business miles ${year}`, value: U.num(t.mileageMiles, 0), color: "amber" })}
        ${UI.statCard({ label: "Est. mileage deduction", value: U.money(t.mileageDeduction), sub: `@ $${t.mileageRate.toFixed(2)}/mi — CPA confirms`, color: "green" })}
        ${UI.statCard({ label: "Parking + tolls", value: U.money(U.sum(d.mileage, m => (Number(m.parking) || 0) + (Number(m.tolls) || 0))) })}
        ${UI.statCard({ label: "Substantiation score", value: sub.score + "%", sub: `${sub.complete}/${sub.total} trips fully documented`, color: sub.score >= 90 ? "green" : sub.score >= 70 ? "amber" : "red" })}
      </div>
      <div class="grid-2">
        <div class="card"><div class="card-title">🚗 Miles by month</div>
          ${Charts.barChart({ labels: months.map(U.monthLabel), series: [{ name: "Miles", color: "#f59e0b", values: milesByM }], money: false, height: 190 })}</div>
        <div class="card"><div class="card-title">🏢 Miles by client</div>
          ${byClient.length ? Charts.hbar({ items: byClient, money: false, valueFmt: v => U.num(v, 0) + " mi" }) : UI.emptyState({ icon: "🏢", title: "No client-linked trips yet" })}</div>
      </div>
      <div id="mi-list"></div>`;

    el.querySelector("#mi-add").addEventListener("click", () => Mileage.openEditor(null));
    el.querySelector("#mi-quick").addEventListener("click", () => Mileage.quickTrip());
    el.querySelector("#mi-export").addEventListener("click", () => Mileage.exportLog());

    UI.listView(el.querySelector("#mi-list"), {
      data: () => Store.all("mileage"),
      searchText: m => [m.destination, m.businessPurpose, m.startLocation, Store.clientName(m.clientId), Store.woLabel(m.workOrderId)].join(" "),
      filters: [
        { id: "yr", label: "Year", options: App.yearsWithData(), apply: (r, v) => U.yearOf(r.date) === Number(v) },
        { id: "type", label: "Trip type", options: SCHEMA.tripTypes, apply: (r, v) => r.tripType === v },
        { id: "flag", label: "Flag", options: [
            { value: "incomplete", label: "Missing purpose/destination" },
            { value: "reimb", label: "Reimbursable, unbilled" },
          ], apply: (r, v) => v === "incomplete"
            ? (!String(r.businessPurpose || "").trim() || !String(r.destination || "").trim())
            : (r.reimbursable && !r.reimbursed) },
      ],
      columns: [
        { label: "Date", value: r => U.fmtDate(r.date), sortVal: r => r.date || "" },
        { label: "Miles", html: r => `<strong>${U.num(r.miles, 1)}</strong>`, sortVal: r => Number(r.miles) || 0, num: true },
        { label: "Destination", value: r => U.truncate(r.destination || "", 34) || "⚠ missing" },
        { label: "Purpose", value: r => U.truncate(r.businessPurpose || "", 32) || "⚠ missing" },
        { label: "WO", value: r => Store.woLabel(r.workOrderId) || "—" },
        { label: "Est. deduction", html: r => U.money(Store.tripDeduction(r)), sortVal: Store.tripDeduction, num: true },
        { label: "Flags", html: r => [
            (!String(r.businessPurpose || "").trim() || !String(r.destination || "").trim()) ? UI.badge("Incomplete", "red") : "",
            r.reimbursable && !r.reimbursed ? UI.badge("Bill client", "amber") : "",
            r.roundTrip ? UI.badge("RT", "slate") : "",
          ].join(" ") },
      ],
      defaultSort: { col: 0, dir: -1 },
      rowClass: r => (!String(r.businessPurpose || "").trim() || !String(r.destination || "").trim()) ? "row-warn" : "",
      onRow: r => Mileage.openEditor(r),
      card: r => `<div class="record-card">
        <div class="record-card-top">
          <div class="record-card-title">${U.num(r.miles, 1)} mi · ${U.escapeHtml(r.tripType || "Trip")}</div>
          <div class="record-card-amount">${U.money(Store.tripDeduction(r))}</div>
        </div>
        <div class="record-card-sub">${U.fmtDate(r.date)} · ${U.escapeHtml(U.truncate(r.destination || "no destination ⚠", 40))}</div>
        <div class="record-card-meta">
          ${(!String(r.businessPurpose || "").trim() || !String(r.destination || "").trim()) ? UI.badge("Incomplete", "red") : ""}
          ${r.workOrderId ? UI.badge(Store.woLabel(r.workOrderId), "slate") : ""}
          ${r.reimbursable && !r.reimbursed ? UI.badge("Bill client", "amber") : ""}
        </div>
      </div>`,
      empty: { icon: "🚗", title: "No trips logged", sub: "Use ⚡ Quick trip from the field — date, destination, miles, purpose. That's IRS-grade substantiation.", actionLabel: "⚡ Quick trip", actionId: "mi-empty-add", onAction: () => Mileage.quickTrip() },
    });
    Charts.bindTooltips(el);
  },
};
