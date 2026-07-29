/* =========================================================
   views/datahealth.js — the review screens behind the
   "what needs attention" panel: side-by-side duplicate
   review, and one-tap payment-info completion for invoices
   marked paid without a date or method.
   ========================================================= */
"use strict";

const DataHealth = (() => {

  const TYPE_META = {
    expense:   { icon: "💳", label: "Expense",    open: r => Expenses.openEditor(r) },
    income:    { icon: "💵", label: "Income",     open: r => Income.openEditor(r) },
    mileage:   { icon: "🚗", label: "Mileage",    open: r => Mileage.openEditor(r) },
    invoice:   { icon: "🧾", label: "Invoice",    open: r => Invoices.openDetail(r) },
    workOrder: { icon: "📋", label: "Work order", open: r => WO.openDetail(r) },
  };

  /* ================= duplicate review ================= */

  /** The fields that matter when deciding which copy to keep. */
  function facts(type, r) {
    const wo = r.workOrderId ? Store.woLabel(r.workOrderId) : "";
    switch (type) {
      case "expense": return [
        ["Date", U.fmtDate(r.date)], ["Vendor", r.vendor], ["Amount", U.money(r.amount)],
        ["Category", r.category], ["Business purpose", r.businessPurpose],
        ["Work order", wo], ["Receipt", r.attachmentId ? "📎 attached" : (r.receiptStatus || "")],
        ["Notes", r.notes],
      ];
      case "income": return [
        ["Date", U.fmtDate(r.date)], ["Client / source", Store.clientName(r.clientId) || r.sourceOther],
        ["Amount", U.money(r.amount)], ["Category", r.category],
        ["Invoice", Store.invLabel(r.invoiceId)], ["Work order", wo], ["Notes", r.notes],
      ];
      case "mileage": return [
        ["Date", U.fmtDate(r.date)], ["Destination", r.destination], ["Miles", U.num(r.miles, 1)],
        ["Purpose", r.businessPurpose], ["Work order", wo], ["Notes", r.notes],
      ];
      case "invoice": return [
        ["Invoice #", r.invoiceNumber], ["Status", r.status], ["Client", Store.clientName(r.clientId)],
        ["Invoice date", U.fmtDate(r.invoiceDate)], ["Total", U.money(Store.invoiceTotal(r))],
        ["Work order", wo], ["Description", U.truncate(r.serviceDescription || "", 70)],
      ];
      case "workOrder": return [
        ["WO #", r.woNumber], ["Status", r.status], ["Client", Store.clientName(r.clientId)],
        ["Assigned", U.fmtDate(r.dateAssigned)], ["Claim #", r.claimNumber],
        ["Loss location", U.truncate((r.lossLocation || "").split("\n")[0], 44)],
      ];
      default: return [];
    }
  }

  /** Records that point at this one — deleting it would orphan them. */
  function linkedNote(type, r) {
    const S = Store.state;
    const bits = [];
    const n = (label, list) => { if (list.length) bits.push(`${list.length} ${label}${list.length > 1 ? "s" : ""}`); };
    if (type === "invoice") n("income entry", S.income.filter(i => i.invoiceId === r.id));
    if (type === "workOrder") {
      n("invoice", S.invoices.filter(i => i.workOrderId === r.id));
      n("income entry", S.income.filter(i => i.workOrderId === r.id));
      n("expense", S.expenses.filter(e => e.workOrderId === r.id));
      n("trip", S.mileage.filter(mm => mm.workOrderId === r.id));
    }
    if (type === "expense") n("receipt", S.receipts.filter(x => x.expenseId === r.id));
    return bits.join(" · ");
  }

  function recordCardHtml(type, r, which) {
    const linked = linkedNote(type, r);
    return `<div style="flex:1;min-width:230px;border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--bg-elev)">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:7px">
        <strong style="font-size:12px;color:var(--text-3)">${which === 0 ? "Entered first" : "Entered later"}</strong>
        <span style="font-size:11px;color:var(--text-3)">${U.fmtDateTime(r.createdAt)}</span>
      </div>
      ${facts(type, r).filter(f => f[1] !== "" && f[1] != null).map(f => `
        <div style="display:flex;justify-content:space-between;gap:10px;font-size:12.5px;padding:2px 0">
          <span style="color:var(--text-3)">${U.escapeHtml(f[0])}</span>
          <span style="text-align:right;color:var(--text)">${U.escapeHtml(String(f[1]))}</span>
        </div>`).join("")}
      ${linked ? `<div style="font-size:11.5px;color:var(--amber);margin-top:6px">⚠️ Linked to ${U.escapeHtml(linked)} — deleting this one leaves them unlinked</div>` : ""}
      <div style="display:flex;gap:6px;margin-top:9px">
        <button class="btn btn-sm" data-dh="open" data-type="${type}" data-id="${r.id}">Open</button>
        <button class="btn btn-sm btn-danger" data-dh="del" data-type="${type}" data-id="${r.id}">🗑️ Delete this one</button>
      </div>
    </div>`;
  }

  function openDuplicates() {
    let showIgnored = false;

    const m = UI.modal({
      title: "👯 Possible duplicate records",
      size: "lg",
      body: "",
      footer: `<button class="btn" id="dh-close">Close</button>`,
    });

    function paint() {
      const pairs = Store.findDuplicates({ includeIgnored: showIgnored });
      const ignoredCount = Store.findDuplicates({ includeIgnored: true }).filter(p => p.ignored).length;
      const open = pairs.filter(p => !p.ignored);

      m.body.innerHTML = `
        <div class="hint" style="font-size:12.5px;color:var(--text-2);margin-bottom:12px">
          These records share the same date, amount, and vendor/destination — the usual sign of an entry logged twice.
          Compare each pair, delete the extra, or keep both if they're genuinely separate charges.
        </div>
        ${open.length || (showIgnored && pairs.length) ? pairs.map(p => `
          <div style="border:1px solid var(--border-strong);border-radius:12px;padding:11px;margin-bottom:12px;${p.ignored ? "opacity:.6" : ""}">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:9px">
              <div style="font-weight:700;font-size:13.5px">${TYPE_META[p.type].icon} ${U.escapeHtml(p.label)}</div>
              ${p.ignored
                ? `${UI.badge("Kept both", "slate")} <button class="btn btn-sm" data-dh="unignore" data-key="${p.key}">Undo</button>`
                : `<button class="btn btn-sm" data-dh="ignore" data-key="${p.key}">✓ Not a duplicate — keep both</button>`}
            </div>
            <div style="display:flex;gap:10px;flex-wrap:wrap">
              ${U.sortBy(p.records, r => r.createdAt || "").map((r, i) => recordCardHtml(p.type, r, i)).join("")}
            </div>
          </div>`).join("")
        : `<div class="empty-state" style="padding:20px"><div class="es-icon">✅</div>
             <div class="es-title">No duplicates to review</div>
             <div class="es-sub">Every record looks unique.</div></div>`}
        ${ignoredCount ? `<button class="btn btn-sm" id="dh-toggle-ignored">${showIgnored ? "Hide" : "Show"} ${ignoredCount} pair(s) you kept</button>` : ""}`;

      const t = m.body.querySelector("#dh-toggle-ignored");
      if (t) t.addEventListener("click", () => { showIgnored = !showIgnored; paint(); });
    }

    m.body.addEventListener("click", async e => {
      const btn = e.target.closest("[data-dh]");
      if (!btn) return;
      const act = btn.getAttribute("data-dh");
      const type = btn.getAttribute("data-type");
      const id = btn.getAttribute("data-id");

      if (act === "open") {
        const rec = Store.get(type, id);
        if (rec) { m.close(); TYPE_META[type].open(rec); }
        return;
      }
      if (act === "ignore" || act === "unignore") {
        Store.setDuplicateIgnored(btn.getAttribute("data-key"), act === "ignore");
        paint(); App.refreshNav();
        return;
      }
      if (act === "del") {
        const rec = Store.get(type, id);
        if (!rec) { paint(); return; }
        const ok = await UI.confirm(`Delete this ${TYPE_META[type].label.toLowerCase()}?`,
          `<strong>${U.escapeHtml(Store.labelFor(type, rec))}</strong> will be removed. The deletion is recorded in the audit trail, and syncs to your other devices.`,
          { danger: true, confirmLabel: "Delete" });
        if (!ok) return;
        if (Store.remove(type, id)) UI.toast("Deleted", "success");
        paint(); App.rerender();
      }
    });

    m.footerEl.querySelector("#dh-close").addEventListener("click", () => { m.close(); App.rerender(); });
    paint();
  }

  /* ================= paid invoices missing payment info ================= */

  function openPaymentInfoFix() {
    const invoices = Invoices.needingPaymentInfo();
    if (!invoices.length) { UI.toast("Every paid invoice already has a payment date and method ✓", "success"); return; }

    const rows = invoices.map(inv => ({ inv, guess: Invoices.paymentDateGuess(inv) }));

    const m = UI.modal({
      title: "❓ Complete the payment record",
      size: "lg",
      body: `
        <div class="hint" style="font-size:12.5px;color:var(--text-2);margin-bottom:12px">
          ${rows.length} invoice${rows.length > 1 ? "s are" : " is"} marked <strong>Paid</strong> without a payment date or method.
          Each date below is the best evidence on file — the linked income entry, or the day the invoice or its work order was
          marked paid, from the audit trail. Adjust any you know differently, then apply.
        </div>
        <div class="field" style="max-width:300px;margin-bottom:14px">
          <label>Payment method to use where one is missing</label>
          <select id="dh-method">${SCHEMA.paymentMethods.map(o =>
            `<option ${o === Invoices.DEFAULT_PAYMENT_METHOD ? "selected" : ""}>${U.escapeHtml(o)}</option>`).join("")}</select>
        </div>
        ${rows.map(({ inv, guess }) => `
          <div style="border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:9px;background:var(--bg-elev)">
            <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
              <div>
                <div style="font-weight:700;font-size:13.5px">${U.escapeHtml(inv.invoiceNumber || "(no number)")}</div>
                <div style="font-size:12px;color:var(--text-3)">${U.escapeHtml(Store.clientName(inv.clientId) || "—")} · ${U.money(Store.invoiceTotal(inv))}${inv.workOrderId ? " · " + U.escapeHtml(Store.woLabel(inv.workOrderId)) : ""}</div>
              </div>
              <div style="font-size:12px;color:var(--text-3);text-align:right">
                ${inv.paymentMethod ? `Method: ${U.escapeHtml(inv.paymentMethod)}` : UI.badge("method missing", "amber")}
              </div>
            </div>
            <div style="display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-top:8px">
              ${inv.paymentDate
                ? `<div style="font-size:12.5px">Payment date: <strong>${U.fmtDate(inv.paymentDate)}</strong> ✓</div>`
                : `<label style="font-size:12px;color:var(--text-3)">Payment date
                     <input type="date" data-dh-date="${inv.id}" value="${U.escapeHtml(guess.date)}"
                       style="margin-left:6px;padding:7px;border:1px solid var(--border-strong);border-radius:8px;background:var(--bg-elev);color:var(--text)">
                   </label>
                   <span style="font-size:11.5px;color:var(--text-3)">${guess.source ? "from " + U.escapeHtml(guess.source) : "no date found — pick one"}</span>`}
            </div>
          </div>`).join("")}`,
      footer: `<button class="btn" id="dh-pay-cancel">Cancel</button>
               <button class="btn btn-primary" id="dh-pay-apply">Apply to ${rows.length} invoice${rows.length > 1 ? "s" : ""}</button>`,
    });

    m.footerEl.querySelector("#dh-pay-cancel").addEventListener("click", () => m.close());
    m.footerEl.querySelector("#dh-pay-apply").addEventListener("click", () => {
      const method = m.body.querySelector("#dh-method").value;
      let applied = 0, skipped = 0;
      for (const { inv } of rows) {
        const overrides = {};
        if (!inv.paymentDate) {
          const field = m.body.querySelector(`[data-dh-date="${inv.id}"]`);
          const val = field ? field.value : "";
          if (!val) { skipped++; continue; }
          overrides.paymentDate = val;
        }
        if (!inv.paymentMethod) overrides.paymentMethod = method;
        Invoices.applyPaymentDefaults(inv, overrides);
        applied++;
      }
      m.close();
      UI.toast(applied
        ? `Payment info completed on ${applied} invoice${applied > 1 ? "s" : ""}${skipped ? ` · ${skipped} skipped (no date)` : ""}`
        : "Nothing applied — no dates entered", applied ? "success" : "default", 4000);
      App.rerender();
    });
  }

  /* ================= dispatcher for attention-panel taps ================= */
  function run(action) {
    if (action === "duplicates") openDuplicates();
    else if (action === "paid-missing-info") openPaymentInfoFix();
  }

  return { openDuplicates, openPaymentInfoFix, run };
})();
