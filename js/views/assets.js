/* =========================================================
   views/assets.js — Assets/Equipment, Home Office (with the
   house's utility bills), and Contractors (1099 tracking).
   ========================================================= */
"use strict";

window.Views = window.Views || {};

/* ================================================================
   ASSETS / EQUIPMENT
   ================================================================ */
const Assets = (() => {
  function openEditor(rec, presets) {
    UI.openForm("asset", rec, {
      presets,
      onSave: vals => {
        if (rec) Store.update("asset", rec.id, vals); else Store.add("asset", vals);
        UI.toast(rec ? "Asset updated" : "Asset added", "success");
        App.rerender();
      },
      deleteFn: r => { Store.remove("asset", r.id); UI.toast("Asset deleted"); App.rerender(); },
    });
  }
  return { openEditor };
})();

Views.assets = {
  title: "Assets & Equipment",
  render(el) {
    const S = Store.state;
    const active = S.assets.filter(a => a.status === "Active");
    const needsReview = S.assets.filter(a => a.askCpaDepreciation && ["Not Reviewed", "Sent to CPA"].includes(a.depreciationStatus || "Not Reviewed"));

    el.innerHTML = UI.pageHeader("Supplies, Tools & Assets",
      "Larger purchases that may need depreciation or Section 179 review. The app organizes them; your CPA decides the treatment.",
      `<button class="btn btn-primary" id="as-add">＋ Add Asset</button>`) + `
      <div class="stat-grid" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr))">
        ${UI.statCard({ label: "Active assets", value: String(active.length), sub: U.money(U.sum(active, a => a.cost), { cents: false }) + " total cost" })}
        ${UI.statCard({ label: "Awaiting CPA review", value: String(needsReview.length), color: needsReview.length ? "amber" : "green" })}
        ${UI.statCard({ label: `Purchased ${App.viewYear()}`, value: String(S.assets.filter(a => U.yearOf(a.purchaseDate) === App.viewYear()).length) })}
      </div>
      <div id="as-list"></div>
      ${UI.disclaimerHtml()}`;

    el.querySelector("#as-add").addEventListener("click", () => Assets.openEditor(null));

    UI.listView(el.querySelector("#as-list"), {
      data: () => Store.all("asset"),
      searchText: a => [a.name, a.vendor, a.category, a.notes].join(" "),
      filters: [
        { id: "status", label: "Status", options: SCHEMA.assetStatuses.map(s => s.value), apply: (a, v) => a.status === v },
        { id: "depr", label: "Depreciation", options: [
            { value: "pending", label: "Awaiting review" }, { value: "done", label: "Reviewed" },
          ], apply: (a, v) => v === "pending"
            ? (a.askCpaDepreciation && ["Not Reviewed", "Sent to CPA"].includes(a.depreciationStatus || "Not Reviewed"))
            : ["CPA Reviewed", "Expensed (per CPA)", "Depreciating (per CPA)"].includes(a.depreciationStatus) },
      ],
      columns: [
        { label: "Item", value: a => a.name },
        { label: "Purchased", value: a => U.fmtDate(a.purchaseDate), sortVal: a => a.purchaseDate || "" },
        { label: "Cost", html: a => `<strong>${U.money(a.cost)}</strong>`, sortVal: a => Number(a.cost) || 0, num: true },
        { label: "Category", value: a => a.category || "—" },
        { label: "Biz use", value: a => U.pct(a.businessUsePct ?? 100), num: true },
        { label: "Status", html: a => UI.statusBadge(SCHEMA.assetStatuses, a.status) },
        { label: "Depreciation", html: a => {
            const st = a.depreciationStatus || "Not Reviewed";
            const color = st === "Not Reviewed" ? (a.askCpaDepreciation ? "amber" : "slate") : st === "Sent to CPA" ? "blue" : "green";
            return UI.badge(st, color);
          } },
      ],
      defaultSort: { col: 1, dir: -1 },
      onRow: a => Assets.openEditor(a),
      card: a => `<div class="record-card">
        <div class="record-card-top">
          <div class="record-card-title">${U.escapeHtml(a.name)}</div>
          <div class="record-card-amount">${U.money(a.cost)}</div>
        </div>
        <div class="record-card-sub">${U.fmtDate(a.purchaseDate)} · ${U.escapeHtml(a.category || "")}</div>
        <div class="record-card-meta">${UI.statusBadge(SCHEMA.assetStatuses, a.status)} ${UI.badge(a.depreciationStatus || "Not Reviewed", a.askCpaDepreciation && ["Not Reviewed", "Sent to CPA"].includes(a.depreciationStatus || "Not Reviewed") ? "amber" : "green")}</div>
      </div>`,
      empty: { icon: "🛠️", title: "No assets tracked", sub: "Laptops, cameras, drones, ladders, meters — anything sizable your CPA might depreciate.", actionLabel: "＋ Add Asset", actionId: "as-empty-add", onAction: () => Assets.openEditor(null) },
    });
  },
};

/* ================================================================
   HOME OFFICE — the office's facts, and the house's utility bills
   (the office's operating cost). The bills live here, not in expenses:
   the office's share of the house applies to them, and the method
   (simplified or actual, Form 8829) is the CPA's call.
   ================================================================ */
const OfficeBills = (() => {
  function openEditor(rec) {
    UI.openForm("officeBill", rec, {
      onSave: vals => {
        if (vals.billMonth && !/^\d{4}-\d{2}$/.test(String(vals.billMonth).trim())) {
          vals.billMonth = "";
          UI.toast("Bill month should look like 2026-09 — left blank, so the bill date's month counts", "default", 5000);
        }
        if (rec) Store.update("officeBill", rec.id, vals); else Store.add("officeBill", vals);
        UI.toast(rec ? "Utility bill updated" : "Utility bill added", "success");
        App.rerender();
      },
      deleteFn: async r => {
        if (r.attachmentId) await Store.Attachments.delete(r.attachmentId).catch(() => {});
        Store.remove("officeBill", r.id);
        UI.toast("Utility bill deleted");
        App.rerender();
      },
    });
  }

  /** A row per utility, Jan–Dec: ✓ a bill covers that month, — none logged yet
      (months still to come in the current year are left blank). */
  function monthGrid(sum, year) {
    if (!sum.byUtility.length) return "";
    const now = new Date();
    const lastDue = year < now.getFullYear() ? 12 : year > now.getFullYear() ? 0 : now.getMonth();   // months fully past
    const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
    const cell = (u, m, i) => u.months.includes(m)
      ? `<td class="num" style="color:var(--green);font-weight:800" title="${U.escapeHtml(u.key)} — ${U.monthLabel(m)} bill logged">✓</td>`
      : i < lastDue
        ? `<td class="num" style="color:var(--red);font-weight:800" title="No ${U.escapeHtml(u.key)} bill logged for ${U.monthLabel(m)}">—</td>`
        : `<td class="num" style="color:var(--text-3)"></td>`;
    return `<div class="table-wrap" style="margin:4px 0 12px"><table class="data-table" style="font-size:12.5px">
      <thead><tr><th style="cursor:default">Bill months</th>${months.map(m => `<th class="num" style="cursor:default">${U.monthLabel(m)}</th>`).join("")}</tr></thead>
      <tbody>${sum.byUtility.map(u => `<tr style="cursor:default"><td>${U.escapeHtml(u.key)} <span style="color:var(--text-3);font-size:11px">${U.escapeHtml(u.service)}</span></td>${months.map((m, i) => cell(u, m, i)).join("")}</tr>`).join("")}</tbody>
    </table></div>`;
  }

  return { openEditor, monthGrid };
})();

Views.homeoffice = {
  title: "Home Office",
  render(el) {
    const ho = Store.state.homeOffice;
    const year = App.viewYear();
    const pctOfHome = Store.officePct();
    const simplified = Math.min(Number(ho.officeSqFt) || 0, 300) * 5;
    const sum = Store.officeBillSummary(year);

    el.innerHTML = UI.pageHeader("Home Office",
      "Organizes home-office facts and the house's utility bills for your CPA. The app does not determine deductibility.",
      `${App.yearPickerHtml()}<button class="btn btn-primary" id="ob-add">＋ Add Utility Bill</button>`) + `
      <div class="grid-2">
        <div class="card">
          <div class="card-title">🏠 Home office details</div>
          <div class="checkbox-field">
            <input type="checkbox" id="ho-excl" ${ho.usedRegularlyExclusively ? "checked" : ""}>
            <label for="ho-excl">This space is used <strong>regularly and exclusively</strong> for business</label>
          </div>
          <div class="hint" style="font-size:11.5px;color:var(--text-3);margin-bottom:12px">"Regular and exclusive use" is the IRS threshold question — if unsure, note it for your CPA.</div>
          <div class="form-grid">
            <div class="field span-2"><label>Home office address</label><input type="text" id="ho-addr" value="${U.escapeHtml(ho.address || "")}" placeholder="the house the utility bills are for"></div>
            <div class="field"><label>Office square footage</label><input type="number" id="ho-office" value="${ho.officeSqFt || ""}" inputmode="numeric"></div>
            <div class="field"><label>Total home square footage</label><input type="number" id="ho-home" value="${ho.homeSqFt || ""}" inputmode="numeric"></div>
            <div class="form-section-title">Actual-method inputs (monthly $)</div>
            <div class="hint span-2" style="font-size:11.5px;color:var(--text-3);margin:-4px 0 4px">Quick monthly estimates. The utility bills logged below are the year's record.</div>
            <div class="field"><label>Utilities</label><input type="number" step="0.01" id="ho-util" value="${ho.utilities || ""}"></div>
            <div class="field"><label>Internet</label><input type="number" step="0.01" id="ho-inet" value="${ho.internet || ""}"></div>
            <div class="field"><label>Homeowner's / renter's insurance</label><input type="number" step="0.01" id="ho-ins" value="${ho.insurance || ""}"></div>
            <div class="field"><label>Repairs & maintenance</label><input type="number" step="0.01" id="ho-rep" value="${ho.repairs || ""}"></div>
            <div class="field span-2"><label>Mortgage interest / rent (note for CPA)</label><textarea id="ho-mort">${U.escapeHtml(ho.mortgageInterestRentNote || "")}</textarea></div>
            <div class="field span-2"><label>Property tax (note for CPA)</label><textarea id="ho-ptax">${U.escapeHtml(ho.propertyTaxNote || "")}</textarea></div>
            <div class="field span-2"><label>Notes for CPA</label><textarea id="ho-notes">${U.escapeHtml(ho.cpaNotes || "")}</textarea></div>
          </div>
          <div class="checkbox-field">
            <input type="checkbox" id="ho-review" ${ho.cpaReview ? "checked" : ""}>
            <label for="ho-review">Needs CPA confirmation</label>
          </div>
          <button class="btn btn-primary" id="ho-save" style="margin-top:8px">Save home office info</button>
        </div>
        <div>
          <div class="card">
            <div class="card-title">🧮 Organizer estimates</div>
            <div class="card-sub">For discussion with your CPA — not a deduction calculation.</div>
            ${UI.detailGrid([
              ["Office % of home", pctOfHome ? U.pct(pctOfHome, 1) : "—"],
              ["Simplified method (est.)", ho.officeSqFt ? `${U.money(simplified)} <span style="font-size:11px;color:var(--text-3)">($5/sq ft, max 300 sq ft)</span>` : "—"],
              [`Utility bills logged (${year})`, sum.count ? `${U.money(sum.total)} <span style="font-size:11px;color:var(--text-3)">(${sum.count} bill${sum.count === 1 ? "" : "s"})</span>` : "—"],
              ["Office share of those bills (est.)", sum.count ? (sum.officeShare != null ? `${U.money(sum.officeShare)} <span style="font-size:11px;color:var(--text-3)">(${U.pct(sum.pct, 1)} of ${U.money(sum.total)})</span>` : `<span style="font-size:12px;color:var(--text-3)">Enter the office and home square footage</span>`) : "—"],
              ["Actual-method monthly inputs", U.money((Number(ho.utilities) || 0) + (Number(ho.internet) || 0) + (Number(ho.insurance) || 0) + (Number(ho.repairs) || 0)) + "/mo recorded"],
              ["Last updated", ho.updatedAt ? U.fmtDateTime(ho.updatedAt) : "—"],
            ])}
          </div>
          <div class="disclaimer"><strong>Home office warning:</strong> Home office deductions should be reviewed with a CPA. This app helps organize records but does not determine final deductibility, method choice (simplified vs. actual), or depreciation implications of the actual method.</div>
        </div>
      </div>
      <div class="card" style="margin-top:16px">
        <div class="card-title">💡 Utility bills — ${year}</div>
        <div class="card-sub">The house's bills${ho.address ? ` for <strong>${U.escapeHtml(ho.address)}</strong>` : ""} — the office's operating cost. They're logged here, not as expenses, so they never count twice: your CPA applies the office's share. Ledger adds the ones the Crew files in <em>Work Orders\\CY${String(year).slice(2)}\\Receipts\\Home Office</em>.</div>
        <div class="stat-grid" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">
          ${UI.statCard({ label: `Logged ${year}`, value: U.money(sum.total, { cents: false }), sub: `${sum.count} bill${sum.count === 1 ? "" : "s"}` })}
          ${sum.byService.map(s => UI.statCard({ label: s.key, value: U.money(s.total, { cents: false }), sub: `${s.count} bill${s.count === 1 ? "" : "s"}` })).join("")}
          ${UI.statCard({ label: "Office share (est.)", value: sum.officeShare != null ? U.money(sum.officeShare, { cents: false }) : "—", sub: sum.pct ? `${U.pct(sum.pct, 1)} of the house` : "set the square footage", color: "accent" })}
        </div>
        ${OfficeBills.monthGrid(sum, year)}
        <div id="ob-list"></div>
      </div>`;

    el.querySelector("#ob-add").addEventListener("click", () => OfficeBills.openEditor(null));

    UI.listView(el.querySelector("#ob-list"), {
      data: () => Store.all("officeBill").filter(b => U.yearOf(b.date) === Number(year)),
      searchText: b => [b.utility, b.service, b.account, b.paymentNote, b.notes, b.sourceRef].join(" "),
      filters: [
        { id: "service", label: "Service", options: SCHEMA.utilityServices, apply: (b, v) => b.service === v },
      ],
      columns: [
        { label: "Bill date", value: b => U.fmtDate(b.date), sortVal: b => b.date || "" },
        { label: "Utility", value: b => b.utility || "—" },
        { label: "Service", value: b => b.service || "—" },
        { label: "For", value: b => U.monthLabel(Store.billMonthOf(b)) + " " + Store.billMonthOf(b).slice(0, 4), sortVal: b => Store.billMonthOf(b) },
        { label: "Amount", html: b => `<strong>${U.money(b.amount)}</strong>`, sortVal: b => Number(b.amount) || 0, num: true },
        { label: "Bill copy", html: b => b.attachmentId ? UI.badge("📎 attached", "green") : UI.statusBadge(SCHEMA.receiptStatuses, b.receiptStatus || "Missing") },
      ],
      defaultSort: { col: 0, dir: -1 },
      onRow: b => OfficeBills.openEditor(b),
      card: b => `<div class="record-card">
        <div class="record-card-top">
          <div class="record-card-title">${U.escapeHtml(b.utility || "Utility bill")}</div>
          <div class="record-card-amount">${U.money(b.amount)}</div>
        </div>
        <div class="record-card-sub">${U.fmtDate(b.date)} · ${U.escapeHtml(b.service || "")} · for ${U.monthLabel(Store.billMonthOf(b))}</div>
        <div class="record-card-meta">${b.attachmentId ? UI.badge("📎 attached", "green") : UI.statusBadge(SCHEMA.receiptStatuses, b.receiptStatus || "Missing")}</div>
      </div>`,
      empty: { icon: "💡", title: `No utility bills for ${year} yet`, sub: "Electric, gas, water and internet for the house. Ledger adds the ones the Crew files; add any others here.", actionLabel: "＋ Add Utility Bill", actionId: "ob-empty-add", onAction: () => OfficeBills.openEditor(null) },
    });

    el.querySelector("#ho-save").addEventListener("click", () => {
      const g = id => el.querySelector(id);
      const patch = {
        usedRegularlyExclusively: g("#ho-excl").checked,
        address: g("#ho-addr").value.trim(),
        officeSqFt: Number(g("#ho-office").value) || 0,
        homeSqFt: Number(g("#ho-home").value) || 0,
        utilities: Number(g("#ho-util").value) || 0,
        internet: Number(g("#ho-inet").value) || 0,
        insurance: Number(g("#ho-ins").value) || 0,
        repairs: Number(g("#ho-rep").value) || 0,
        mortgageInterestRentNote: g("#ho-mort").value,
        propertyTaxNote: g("#ho-ptax").value,
        cpaNotes: g("#ho-notes").value,
        cpaReview: g("#ho-review").checked,
        updatedAt: U.nowISO(),
      };
      const changes = U.diff(Store.state.homeOffice, { ...Store.state.homeOffice, ...patch });
      Object.assign(Store.state.homeOffice, patch);
      if (changes.length) Store.logAudit("updated", "settings", { id: "homeOffice" }, changes);
      Store.save();
      UI.toast("Home office info saved", "success");
      App.rerender();
    });
  },
};

/* ================================================================
   CONTRACTORS
   ================================================================ */
const Contractors = (() => {
  function paidYtd(c, year) {
    return U.sum((c.payments || []).filter(p => U.yearOf(p.date) === Number(year)), p => p.amount);
  }
  function openEditor(rec) {
    UI.openForm("contractor", rec, {
      onSave: vals => {
        if (rec) Store.update("contractor", rec.id, vals);
        else Store.add("contractor", { ...vals, payments: [] });
        UI.toast(rec ? "Contractor updated" : "Contractor added", "success");
        App.rerender();
      },
      deleteFn: r => { Store.remove("contractor", r.id); UI.toast("Contractor deleted"); App.rerender(); },
    });
  }
  function addPayment(c) {
    UI.openForm("contractorPayment", null, {
      title: `Payment to ${c.name}`,
      onSave: vals => {
        const rec = Store.get("contractor", c.id);
        const payments = [...(rec.payments || []), { id: U.uid("cp"), ...vals }];
        const patch = { payments };
        if (U.sum(payments.filter(p => U.yearOf(p.date) === U.yearOf(vals.date)), p => p.amount) >= 600) patch.may1099 = true;
        Store.update("contractor", c.id, patch);
        // mirror into expenses so it flows to Schedule C organizer
        Store.add("expense", {
          date: vals.date, vendor: c.businessName || c.name, amount: vals.amount,
          paymentMethod: vals.paymentMethod || "", category: "Contractors / Subcontractors",
          businessPurpose: vals.notes || `Subcontracted services — ${c.name}`,
          workOrderId: vals.workOrderId || "", receiptStatus: "Referenced",
          receiptRef: `Contractor payment — ${c.name}`, deductible: true, businessUsePct: 100,
          notes: "Auto-created from contractor payment.",
        });
        UI.toast("Payment recorded (expense entry auto-created)", "success");
        App.rerender();
      },
    });
  }
  function openDetail(c) {
    c = Store.get("contractor", c.id) || c;
    const year = App.viewYear();
    const pays = U.sortBy(c.payments || [], p => p.date || "", -1);
    const ytd = paidYtd(c, year);
    const m = UI.modal({
      title: `👷 ${U.escapeHtml(c.name)}`,
      body: `
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
          <button class="btn btn-sm btn-primary" id="ct-edit">✏️ Edit</button>
          <button class="btn btn-sm" id="ct-pay">＋ Record payment</button>
        </div>
        ${ytd >= 600 && !c.w9Received ? `<div class="disclaimer" style="margin:0 0 14px"><strong>⚠ ${U.money(ytd)} paid in ${year} with no W-9 on file.</strong> Collect the W-9 now — you'll likely need it for a 1099-NEC. Confirm filing requirements with your CPA.</div>` : ""}
        ${UI.detailGrid([
          ["Business", U.escapeHtml(c.businessName || "")],
          ["Email", U.escapeHtml(c.email || "")],
          ["Phone", U.escapeHtml(c.phone || "")],
          ["Address", U.escapeHtml(c.address || "").replace(/\n/g, "<br>")],
          ["W-9 received", c.w9Received ? "✓ Yes" : UI.badge("No", "red")],
          ["EIN/TIN note", U.escapeHtml(c.tinNote || "")],
          [`Paid ${year}`, `<strong>${U.money(ytd)}</strong>`],
          ["Possible 1099 required", c.may1099 ? UI.badge("Yes — CPA review", "amber") : "Not flagged"],
          c.notes ? ["Notes", U.escapeHtml(c.notes).replace(/\n/g, "<br>")] : null,
        ])}
        ${pays.length ? `<h3 style="font-size:13px;margin:16px 0 6px;color:var(--accent-strong);text-transform:uppercase">Payments</h3>
          ${pays.map(p => `<div class="score-line"><span>${U.fmtDate(p.date)} · ${U.escapeHtml(p.paymentMethod || "")} ${p.workOrderId ? "· " + U.escapeHtml(Store.woLabel(p.workOrderId)) : ""} ${p.notes ? "· " + U.escapeHtml(U.truncate(p.notes, 30)) : ""}</span><span><strong>${U.money(p.amount)}</strong></span></div>`).join("")}` : ""}`,
      footer: `<button class="btn" id="ct-close">Close</button>`,
    });
    m.footerEl.querySelector("#ct-close").addEventListener("click", () => m.close());
    m.body.querySelector("#ct-edit").addEventListener("click", () => { m.close(); openEditor(c); });
    m.body.querySelector("#ct-pay").addEventListener("click", () => { m.close(); addPayment(c); });
  }
  return { openEditor, openDetail, addPayment, paidYtd };
})();

Views.contractors = {
  title: "Contractors",
  render(el) {
    const year = App.viewYear();
    const S = Store.state;
    const totalPaid = U.sum(S.contractors, c => Contractors.paidYtd(c, year));
    const need1099 = S.contractors.filter(c => Contractors.paidYtd(c, year) >= 600);
    const noW9 = need1099.filter(c => !c.w9Received);

    el.innerHTML = UI.pageHeader("Contractors & 1099s",
      "Track who you pay so year-end 1099-NEC review is painless. Store W-9s securely outside this app.",
      `<button class="btn btn-primary" id="ct-add">＋ Add Contractor</button>`) + `
      <div class="stat-grid" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr))">
        ${UI.statCard({ label: `Paid to contractors ${year}`, value: U.money(totalPaid) })}
        ${UI.statCard({ label: "Likely need 1099-NEC", value: String(need1099.length), sub: "$600+ paid — CPA confirms", color: need1099.length ? "amber" : "green" })}
        ${UI.statCard({ label: "Missing W-9", value: String(noW9.length), color: noW9.length ? "red" : "green" })}
      </div>
      <div id="ct-list"></div>`;

    el.querySelector("#ct-add").addEventListener("click", () => Contractors.openEditor(null));

    UI.listView(el.querySelector("#ct-list"), {
      data: () => Store.all("contractor"),
      searchText: c => [c.name, c.businessName, c.email, c.notes].join(" "),
      filters: [],
      columns: [
        { label: "Contractor", value: c => c.name },
        { label: "Business", value: c => c.businessName || "—" },
        { label: `Paid ${year}`, html: c => `<strong>${U.money(Contractors.paidYtd(c, year))}</strong>`, sortVal: c => Contractors.paidYtd(c, year), num: true },
        { label: "W-9", html: c => c.w9Received ? UI.badge("Received", "green") : UI.badge("Missing", Contractors.paidYtd(c, year) >= 600 ? "red" : "slate") },
        { label: "1099 flag", html: c => Contractors.paidYtd(c, year) >= 600 || c.may1099 ? UI.badge("Review with CPA", "amber") : "—" },
      ],
      defaultSort: { col: 2, dir: -1 },
      onRow: c => Contractors.openDetail(c),
      card: c => `<div class="record-card">
        <div class="record-card-top">
          <div class="record-card-title">${U.escapeHtml(c.name)}</div>
          <div class="record-card-amount">${U.money(Contractors.paidYtd(c, year))}</div>
        </div>
        <div class="record-card-sub">${U.escapeHtml(c.businessName || "")}</div>
        <div class="record-card-meta">
          ${c.w9Received ? UI.badge("W-9 ✓", "green") : UI.badge("No W-9", "red")}
          ${Contractors.paidYtd(c, year) >= 600 ? UI.badge("1099 review", "amber") : ""}
        </div>
      </div>`,
      empty: { icon: "👷", title: "No contractors", sub: "If you pay subs (drone pilots, drafters, admin help), track them here for 1099 season." },
    });
  },
};
