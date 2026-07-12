/* =========================================================
   views/money.js — Income (+1099 reconciliation), Expenses,
   and Receipts/Documents.
   ========================================================= */
"use strict";

window.Views = window.Views || {};

/* ================================================================
   INCOME
   ================================================================ */
const Income = (() => {
  function openEditor(rec, presets) {
    UI.openForm("income", rec, {
      presets,
      onSave: vals => {
        if (rec) Store.update("income", rec.id, vals); else Store.add("income", vals);
        UI.toast(rec ? "Income updated" : "Income added", "success");
        App.rerender();
      },
      deleteFn: r => { Store.remove("income", r.id); UI.toast("Income deleted"); App.rerender(); },
    });
  }

  function open1099Tool() {
    const year = App.viewYear();
    const rows = Alerts.reconcile1099(year);
    const m = UI.modal({
      title: `🔀 1099 Reconciliation — ${year}`,
      size: "lg",
      body: `
        <p style="font-size:13px;color:var(--text-2);margin:0 0 12px">Compare each client's 1099-NEC to the income recorded in this app. Mismatches should go to your CPA with an explanation (timing differences are common — e.g. December invoices paid in January).</p>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Client</th><th>Expected</th><th>Received</th><th class="num">1099 amount</th><th class="num">App income (1099)</th><th class="num">Difference</th><th></th></tr></thead>
          <tbody>
            ${rows.map((r, i) => `<tr>
              <td>${U.escapeHtml(r.clientName)}</td>
              <td>${r.expected ? "Yes" : "No"}</td>
              <td><input type="checkbox" data-recv="${i}" ${r.received ? "checked" : ""} style="width:18px;height:18px;accent-color:var(--green)"></td>
              <td class="num"><input type="number" step="0.01" data-amt="${i}" value="${r.amountReceived || ""}" style="width:110px;padding:6px;border:1px solid var(--border-strong);border-radius:7px;background:var(--bg-elev);color:var(--text);text-align:right"></td>
              <td class="num">${U.money(r.appTotal)}</td>
              <td class="num" data-diff="${i}" style="font-weight:700;color:${Math.abs(r.difference) > 0.5 && r.received ? "var(--red)" : "var(--green)"}">${r.received ? U.money(r.difference) : "—"}</td>
              <td>${r.received && Math.abs(r.difference) > 0.5 ? UI.badge("CPA review", "amber") : r.received ? UI.badge("Matches ✓", "green") : UI.badge("Pending", "slate")}</td>
            </tr>`).join("")}
            ${!rows.length ? `<tr><td colspan="7" style="text-align:center;color:var(--text-3);padding:22px">No 1099-relevant clients for ${year} yet.</td></tr>` : ""}
          </tbody>
        </table></div>
        <div class="disclaimer-inline">Timing differences between cash received and 1099 box amounts are normal — document the reason and let your CPA make the call.</div>`,
      footer: `<button class="btn btn-left" id="t99-export">⬇️ Export CSV</button>
               <button class="btn" id="t99-cancel">Cancel</button>
               <button class="btn btn-primary" id="t99-save">Save</button>`,
    });
    m.footerEl.querySelector("#t99-cancel").addEventListener("click", () => m.close());
    m.footerEl.querySelector("#t99-save").addEventListener("click", () => {
      rows.forEach((r, i) => {
        const received = m.body.querySelector(`[data-recv="${i}"]`).checked;
        const amt = Number(m.body.querySelector(`[data-amt="${i}"]`).value) || 0;
        const S = Store.state;
        let rec = S.form1099s.find(f => f.clientId === r.clientId && Number(f.taxYear) === year);
        if (!rec) { rec = { id: U.uid("f9"), clientId: r.clientId, taxYear: year, createdAt: U.nowISO() }; S.form1099s.push(rec); }
        rec.expected = r.expected; rec.received = received; rec.amountReceived = amt;
        rec.updatedAt = U.nowISO();
      });
      Store.save();
      UI.toast("1099 reconciliation saved", "success");
      m.close(); App.rerender();
    });
    m.footerEl.querySelector("#t99-export").addEventListener("click", () => {
      const csv = U.toCSV(rows, [
        { key: "clientName", label: "Client" }, { label: "Tax Year", value: () => year },
        { label: "1099 Expected", value: r => r.expected ? "Yes" : "No" },
        { label: "1099 Received", value: r => r.received ? "Yes" : "No" },
        { key: "amountReceived", label: "1099 Amount" }, { key: "appTotal", label: "App Income (1099)" },
        { key: "difference", label: "Difference" },
      ]);
      U.download(`1099-reconciliation-${year}.csv`, csv, "text/csv");
    });
  }

  return { openEditor, open1099Tool };
})();

Views.income = {
  title: "Income",
  render(el) {
    const year = App.viewYear();
    const d = Store.yearData(year);
    const total = U.sum(d.income, i => i.amount);
    const t99 = U.sum(d.income.filter(i => i.is1099), i => i.amount);
    const unlinked = d.income.filter(i => !i.invoiceId && !i.clientId).length;

    el.innerHTML = UI.pageHeader("Income", "Every dollar in — invoiced or not.",
      `<button class="btn" id="inc-1099">🔀 1099 Reconciliation</button>
       <button class="btn btn-primary" id="inc-add">＋ Log Income</button>`) + `
      <div class="stat-grid" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr))">
        ${UI.statCard({ label: `Gross income ${year}`, value: U.money(total), color: "green" })}
        ${UI.statCard({ label: "1099 income", value: U.money(t99), sub: `${U.money(total - t99)} other` })}
        ${UI.statCard({ label: "Entries", value: String(d.income.length) })}
        ${UI.statCard({ label: "Unlinked entries", value: String(unlinked), sub: unlinked ? "link to client/invoice" : "all linked", color: unlinked ? "amber" : "green" })}
      </div>
      <div id="inc-list"></div>`;

    el.querySelector("#inc-add").addEventListener("click", () => Income.openEditor(null));
    el.querySelector("#inc-1099").addEventListener("click", () => Income.open1099Tool());

    UI.listView(el.querySelector("#inc-list"), {
      data: () => Store.all("income"),
      searchText: i => [Store.clientName(i.clientId), i.sourceOther, i.category, i.serviceType, i.notes, Store.invLabel(i.invoiceId)].join(" "),
      filters: [
        { id: "yr", label: "Year", options: App.yearsWithData(), apply: (r, v) => U.yearOf(r.date) === Number(v) },
        { id: "client", label: "Client", options: () => Store.all("client").map(c => ({ value: c.id, label: c.name })), apply: (r, v) => r.clientId === v },
        { id: "t99", label: "1099", options: [{ value: "yes", label: "1099 income" }, { value: "no", label: "Non-1099" }], apply: (r, v) => v === "yes" ? !!r.is1099 : !r.is1099 },
      ],
      columns: [
        { label: "Date", value: r => U.fmtDate(r.date), sortVal: r => r.date || "" },
        { label: "Amount", html: r => `<strong>${U.money(r.amount)}</strong>`, sortVal: r => Number(r.amount) || 0, num: true },
        { label: "Client / source", value: r => Store.clientName(r.clientId) || r.sourceOther || "—" },
        { label: "Category", value: r => r.category || "—" },
        { label: "Invoice", value: r => Store.invLabel(r.invoiceId) || "—" },
        { label: "Method", value: r => r.paymentMethod || "—" },
        { label: "Flags", html: r => [r.is1099 ? UI.badge("1099", "blue") : "", r.cpaReview ? UI.badge("CPA", "amber") : ""].join(" ") },
      ],
      defaultSort: { col: 0, dir: -1 },
      onRow: r => Income.openEditor(r),
      card: r => `<div class="record-card">
        <div class="record-card-top">
          <div class="record-card-title">${U.escapeHtml(Store.clientName(r.clientId) || r.sourceOther || "Income")}</div>
          <div class="record-card-amount" style="color:var(--green)">${U.money(r.amount)}</div>
        </div>
        <div class="record-card-sub">${U.fmtDate(r.date)} · ${U.escapeHtml(r.category || "")}</div>
        <div class="record-card-meta">${r.is1099 ? UI.badge("1099", "blue") : ""}${r.invoiceId ? UI.badge(Store.invLabel(r.invoiceId), "slate") : ""}${r.cpaReview ? UI.badge("CPA review", "amber") : ""}</div>
      </div>`,
      empty: { icon: "💵", title: "No income logged", sub: "Log payments here — they reconcile against invoices and 1099s.", actionLabel: "＋ Log Income", actionId: "inc-empty-add", onAction: () => Income.openEditor(null) },
    });
  },
};

/* ================================================================
   EXPENSES
   ================================================================ */
const Expenses = (() => {
  function openEditor(rec, presets) {
    UI.openForm("expense", rec, {
      presets,
      onSave: vals => {
        if (rec) Store.update("expense", rec.id, vals); else Store.add("expense", vals);
        UI.toast(rec ? "Expense updated" : "Expense added", "success");
        App.rerender();
      },
      deleteFn: async r => {
        if (r.attachmentId) await Store.Attachments.delete(r.attachmentId).catch(() => {});
        Store.remove("expense", r.id); UI.toast("Expense deleted"); App.rerender();
      },
    });
  }
  /** One-tap receipt attach straight from the list — no form needed. */
  function quickAttach(exp) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,.pdf";
    input.hidden = true;
    document.body.appendChild(input);
    input.addEventListener("change", async () => {
      const file = input.files[0];
      input.remove();
      if (!file) return;
      try {
        const dataUrl = await Store.Attachments.fileToDataUrl(file);
        const attId = exp.attachmentId || U.uid("att");
        await Store.Attachments.put({ id: attId, name: file.name, type: file.type, dataUrl });
        const patch = { attachmentId: attId, attachmentName: file.name };
        if (!exp.receiptStatus || exp.receiptStatus === "Missing" || exp.receiptStatus === "Referenced") patch.receiptStatus = "Attached";
        Store.update("expense", exp.id, patch);
        UI.toast(`Receipt attached — ${exp.vendor || "expense"}`, "success");
        App.rerender();
      } catch (err) { UI.toast("Couldn't store the file: " + err.message, "error", 5000); }
    });
    input.click();
  }

  function flags(e) {
    const out = [];
    if (!e.receiptStatus || e.receiptStatus === "Missing") out.push({ t: "No receipt", c: "red" });
    if (!String(e.businessPurpose || "").trim()) out.push({ t: "No purpose", c: "red" });
    if (!e.category) out.push({ t: "Uncategorized", c: "red" });
    if (e.cpaReview) out.push({ t: "CPA review", c: "amber" });
    if (e.reimbursable && !e.reimbursed) out.push({ t: "Bill client", c: "amber" });
    if (e.reimbursable && e.reimbursed && e.deductible !== false) out.push({ t: "Reimbursed+deductible?", c: "amber" });
    if (e.deductible === false) out.push({ t: "Non-deductible", c: "slate" });
    if ((Number(e.businessUsePct) || 100) < 100) out.push({ t: `${e.businessUsePct}% business`, c: "purple" });
    return out;
  }
  return { openEditor, flags, quickAttach };
})();

Views.expenses = {
  title: "Expenses",
  render(el) {
    const year = App.viewYear();
    const d = Store.yearData(year);
    const total = U.sum(d.expenses, e => e.amount);
    const deductible = U.sum(d.expenses, Store.expenseDeductibleAmt);
    const missingReceipts = d.expenses.filter(e => !e.receiptStatus || e.receiptStatus === "Missing").length;
    const missingPurpose = d.expenses.filter(e => !String(e.businessPurpose || "").trim()).length;
    const reimbOpen = U.sum(d.expenses.filter(e => e.reimbursable && !e.reimbursed), e => e.amount);

    el.innerHTML = UI.pageHeader("Expenses", "Schedule C-style expense organizer with substantiation flags.",
      `<button class="btn" id="exp-export">⬇️ Export CSV</button>
       <button class="btn btn-primary" id="exp-add">＋ Add Expense</button>`) + `
      <div class="stat-grid" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr))">
        ${UI.statCard({ label: `Total spent ${year}`, value: U.money(total), color: "red" })}
        ${UI.statCard({ label: "Est. deductible", value: U.money(deductible), sub: "after business-use % & reimbursements", color: "accent" })}
        ${UI.statCard({ label: "Missing receipts", value: String(missingReceipts), color: missingReceipts ? "red" : "green" })}
        ${UI.statCard({ label: "Missing purpose", value: String(missingPurpose), color: missingPurpose ? "red" : "green" })}
        ${UI.statCard({ label: "Reimbursable, unbilled", value: U.money(reimbOpen), color: reimbOpen ? "amber" : "green" })}
      </div>
      <div id="exp-list"></div>
      ${UI.disclaimerHtml()}`;

    el.querySelector("#exp-add").addEventListener("click", () => Expenses.openEditor(null));
    // one-tap attach / view receipt from list rows and cards
    el.querySelector("#exp-list").addEventListener("click", e => {
      const a = e.target.closest("[data-attach-exp]");
      if (a) { const r = Store.get("expense", a.getAttribute("data-attach-exp")); if (r) Expenses.quickAttach(r); return; }
      const v = e.target.closest("[data-view-att]");
      if (v) {
        const r = Store.get("expense", v.getAttribute("data-view-att"));
        if (r && r.attachmentId) UI.viewAttachment(r.attachmentId, `${r.vendor || "Expense"} — ${U.fmtDate(r.date)}`);
      }
    });
    el.querySelector("#exp-export").addEventListener("click", () => {
      const rows = Store.all("expense");
      const csv = U.toCSV(rows, [
        { key: "date", label: "Date" }, { key: "vendor", label: "Vendor" }, { key: "amount", label: "Amount" },
        { key: "category", label: "Category" }, { key: "subcategory", label: "Subcategory" },
        { label: "Schedule C line", value: r => SCHEMA.scheduleCFor(r.category) },
        { key: "businessPurpose", label: "Business Purpose" }, { key: "paymentMethod", label: "Payment Method" },
        { label: "Work Order", value: r => Store.woLabel(r.workOrderId) },
        { label: "Client", value: r => Store.clientName(r.clientId) },
        { key: "receiptStatus", label: "Receipt" }, { key: "receiptRef", label: "Receipt Ref" },
        { label: "Deductible", value: r => r.deductible === false ? "No" : "Yes" },
        { key: "businessUsePct", label: "Business Use %" },
        { label: "Reimbursable", value: r => r.reimbursable ? "Yes" : "No" },
        { label: "Reimbursed", value: r => r.reimbursed ? "Yes" : "No" },
        { label: "Est. Deductible Amt", value: Store.expenseDeductibleAmt },
        { key: "notes", label: "Notes" },
      ]);
      U.download(`expenses-all.csv`, csv, "text/csv");
      UI.toast("Expense CSV downloaded", "success");
    });

    UI.listView(el.querySelector("#exp-list"), {
      data: () => Store.all("expense"),
      searchText: e => [e.vendor, e.category, e.subcategory, e.businessPurpose, e.notes, Store.woLabel(e.workOrderId)].join(" "),
      filters: [
        { id: "yr", label: "Year", options: App.yearsWithData(), apply: (r, v) => U.yearOf(r.date) === Number(v) },
        { id: "cat", label: "Category", options: SCHEMA.expenseCategoryNames, apply: (r, v) => r.category === v },
        { id: "flag", label: "Flag", options: [
            { value: "noreceipt", label: "Missing receipt" }, { value: "nopurpose", label: "Missing purpose" },
            { value: "uncategorized", label: "Uncategorized" }, { value: "cpa", label: "CPA review" },
            { value: "reimb", label: "Reimbursable, unbilled" }, { value: "partial", label: "Partial business use" },
          ],
          apply: (r, v) => ({
            noreceipt: !r.receiptStatus || r.receiptStatus === "Missing",
            nopurpose: !String(r.businessPurpose || "").trim(),
            uncategorized: !r.category,
            cpa: !!r.cpaReview,
            reimb: r.reimbursable && !r.reimbursed,
            partial: (Number(r.businessUsePct) || 100) < 100,
          }[v]) },
      ],
      columns: [
        { label: "Date", value: r => U.fmtDate(r.date), sortVal: r => r.date || "" },
        { label: "Vendor", value: r => r.vendor || "—" },
        { label: "Amount", html: r => `<strong>${U.money(r.amount)}</strong>`, sortVal: r => Number(r.amount) || 0, num: true },
        { label: "Category", value: r => r.category || "⚠ none" },
        { label: "Purpose", value: r => U.truncate(r.businessPurpose || "", 34) || "⚠ missing" },
        { label: "Receipt", html: r => r.attachmentId
            ? `<span class="receipt-action" data-lv-stop data-view-att="${r.id}" title="View attached receipt">📎 ${UI.statusBadge(SCHEMA.receiptStatuses, r.receiptStatus || "Attached")}</span>`
            : `${UI.statusBadge(SCHEMA.receiptStatuses, r.receiptStatus || "Missing")} <button class="btn btn-sm receipt-attach-btn" data-lv-stop data-attach-exp="${r.id}" title="Attach a photo or PDF">📎 Attach</button>` },
        { label: "Flags", html: r => Expenses.flags(r).slice(0, 3).map(f => UI.badge(f.t, f.c)).join(" ") },
      ],
      defaultSort: { col: 0, dir: -1 },
      rowClass: r => Expenses.flags(r).some(f => f.c === "red") ? "row-warn" : "",
      onRow: r => Expenses.openEditor(r),
      card: r => `<div class="record-card">
        <div class="record-card-top">
          <div class="record-card-title">${U.escapeHtml(r.vendor || "Expense")}</div>
          <div class="record-card-amount">${U.money(r.amount)}</div>
        </div>
        <div class="record-card-sub">${U.fmtDate(r.date)} · ${U.escapeHtml(r.category || "uncategorized")}</div>
        <div class="record-card-meta">${Expenses.flags(r).slice(0, 3).map(f => UI.badge(f.t, f.c)).join("")}
          ${r.attachmentId
            ? `<button class="btn btn-sm" data-lv-stop data-view-att="${r.id}">📎 View receipt</button>`
            : `<button class="btn btn-sm receipt-attach-btn" data-lv-stop data-attach-exp="${r.id}">📷 Attach receipt</button>`}
        </div>
      </div>`,
      empty: { icon: "💳", title: "No expenses yet", sub: "Log every business expense with a receipt and purpose — future-you at tax time says thanks.", actionLabel: "＋ Add Expense", actionId: "exp-empty-add", onAction: () => Expenses.openEditor(null) },
    });
  },
};

/* ================================================================
   RECEIPTS / DOCUMENTS
   ================================================================ */
const Receipts = (() => {
  function openEditor(rec, presets) {
    UI.openForm("receipt", rec, {
      presets,
      onSave: vals => {
        if (rec) Store.update("receipt", rec.id, vals); else Store.add("receipt", vals);
        UI.toast(rec ? "Receipt updated" : "Receipt saved", "success");
        App.rerender();
      },
      deleteFn: async r => {
        if (r.attachmentId) await Store.Attachments.delete(r.attachmentId).catch(() => {});
        Store.remove("receipt", r.id); UI.toast("Receipt deleted"); App.rerender();
      },
    });
  }

  async function view(rec) {
    if (!rec.attachmentId) { openEditor(rec); return; }
    const att = await Store.Attachments.get(rec.attachmentId);
    const m = UI.modal({
      title: `📎 ${U.escapeHtml(rec.vendor || "Receipt")} — ${U.fmtDate(rec.date)}`,
      size: "lg",
      body: att
        ? (att.type === "application/pdf"
          ? `<embed src="${att.dataUrl}" type="application/pdf" style="width:100%;height:70vh;border-radius:10px">`
          : `<img src="${att.dataUrl}" style="max-width:100%;border-radius:10px;display:block;margin:0 auto" alt="Receipt">`)
        : `<div class="empty-state"><div class="es-icon">🫥</div><div class="es-title">Attachment not found</div><div class="es-sub">It may have been cleared from this browser. Reference: ${U.escapeHtml(rec.reference || rec.attachmentName || "")}</div></div>`,
      footer: `<button class="btn btn-left" id="rc-edit">✏️ Edit details</button><button class="btn" id="rc-close">Close</button>`,
    });
    m.footerEl.querySelector("#rc-close").addEventListener("click", () => m.close());
    m.footerEl.querySelector("#rc-edit").addEventListener("click", () => { m.close(); openEditor(rec); });
  }
  return { openEditor, view };
})();

Views.receipts = {
  title: "Receipts",
  render(el) {
    const S = Store.state;
    const year = App.viewYear();
    const missingExp = S.expenses.filter(e => U.yearOf(e.date) === year && (!e.receiptStatus || e.receiptStatus === "Missing"));

    el.innerHTML = UI.pageHeader("Receipts & Documents", "Attach images/PDFs (stored in this browser) or reference where the original lives.",
      `<button class="btn btn-primary" id="rc-add">＋ Add Receipt</button>`) + `
      ${missingExp.length ? `<div class="card" style="border-color:var(--red)">
        <div class="card-title">🚨 Missing receipt report — ${year}</div>
        <div class="card-sub">${missingExp.length} expense(s) have no receipt attached or referenced.</div>
        ${missingExp.slice(0, 10).map(e => `<div class="score-line" style="cursor:pointer" data-exp="${e.id}">
          <span>${U.fmtDate(e.date)} · ${U.escapeHtml(e.vendor)} · ${U.money(e.amount)}</span><span class="bad">Fix →</span></div>`).join("")}
      </div>` : ""}
      <div id="rc-list"></div>`;

    el.querySelector("#rc-add").addEventListener("click", () => Receipts.openEditor(null));
    el.querySelectorAll("[data-exp]").forEach(x => x.addEventListener("click", () => {
      const e = Store.get("expense", x.getAttribute("data-exp"));
      if (e) Expenses.openEditor(e);
    }));

    UI.listView(el.querySelector("#rc-list"), {
      data: () => Store.all("receipt"),
      searchText: r => [r.vendor, r.reference, r.notes, Store.woLabel(r.workOrderId)].join(" "),
      filters: [
        { id: "status", label: "Status", options: SCHEMA.receiptStatuses.map(s => s.value), apply: (r, v) => r.status === v },
        { id: "yr", label: "Year", options: App.yearsWithData(), apply: (r, v) => U.yearOf(r.date) === Number(v) },
      ],
      columns: [
        { label: "Date", value: r => U.fmtDate(r.date), sortVal: r => r.date || "" },
        { label: "Vendor", value: r => r.vendor || "—" },
        { label: "Amount", html: r => r.amount ? U.money(r.amount) : "—", sortVal: r => Number(r.amount) || 0, num: true },
        { label: "Status", html: r => UI.statusBadge(SCHEMA.receiptStatuses, r.status) },
        { label: "File / reference", html: r => r.attachmentId ? UI.badge("📷 " + U.truncate(r.attachmentName || "attached", 22), "green") : U.escapeHtml(U.truncate(r.reference || "—", 30)) },
        { label: "Linked", value: r => [r.expenseId ? "expense" : "", Store.woLabel(r.workOrderId)].filter(Boolean).join(", ") || "—" },
      ],
      defaultSort: { col: 0, dir: -1 },
      onRow: r => Receipts.view(r),
      card: r => `<div class="record-card">
        <div class="record-card-top">
          <div class="record-card-title">${U.escapeHtml(r.vendor || "Receipt")}</div>
          <div class="record-card-amount">${r.amount ? U.money(r.amount) : ""}</div>
        </div>
        <div class="record-card-sub">${U.fmtDate(r.date)} ${r.attachmentId ? "· 📷 attached" : r.reference ? "· " + U.escapeHtml(U.truncate(r.reference, 30)) : ""}</div>
        <div class="record-card-meta">${UI.statusBadge(SCHEMA.receiptStatuses, r.status)}</div>
      </div>`,
      empty: { icon: "📎", title: "No receipts yet", sub: "Snap a photo in the field or reference where the paper copy lives.", actionLabel: "＋ Add Receipt", actionId: "rc-empty-add", onAction: () => Receipts.openEditor(null) },
    });
  },
};
