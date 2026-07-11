/* =========================================================
   views/clients.js — client management with profitability,
   payment behavior, and 1099 reconciliation status.
   ========================================================= */
"use strict";

window.Views = window.Views || {};

const Clients = (() => {

  function stats(c, year) {
    const S = Store.state;
    const wos = S.workOrders.filter(w => w.clientId === c.id);
    const open = wos.filter(w => SCHEMA.woOpenStatuses.includes(w.status) || ["Submitted", "Invoiced"].includes(w.status));
    const closed = wos.filter(w => ["Paid", "Closed"].includes(w.status));
    const incomeAll = S.income.filter(i => i.clientId === c.id);
    const incomeYr = incomeAll.filter(i => U.yearOf(i.date) === Number(year));
    const invs = S.invoices.filter(i => i.clientId === c.id);
    const outstanding = invs.filter(i => ["Sent", "Partial", "Overdue"].includes(i.status) && Store.invoiceBalance(i) > 0.005);
    // average days from invoice to payment
    const payTimes = invs.filter(i => i.status === "Paid" && i.invoiceDate && i.paymentDate)
      .map(i => U.daysBetween(i.invoiceDate, i.paymentDate)).filter(x => x != null && x >= 0);
    const avgPay = payTimes.length ? Math.round(U.sum(payTimes) / payTimes.length) : null;
    // profitability: income minus costs linked to this client's jobs
    const costs = U.sum(S.expenses.filter(e => e.clientId === c.id && !(e.reimbursable && e.reimbursed)), e => e.amount) +
      U.sum(S.mileage.filter(m => m.clientId === c.id && !(m.reimbursable && m.reimbursed)), Store.tripDeduction);
    const profit = U.round2(U.sum(incomeAll, i => i.amount) - costs);
    const hours = U.sum(wos, w => Number(w.actualHours) || 0);
    return {
      open: open.length, closed: closed.length,
      totalIncome: U.sum(incomeAll, i => i.amount), yearIncome: U.sum(incomeYr, i => i.amount),
      outstanding: U.sum(outstanding, Store.invoiceBalance), outstandingCount: outstanding.length,
      avgPay, profit, ehr: hours > 0 ? U.round2(profit / hours) : null,
    };
  }

  function reconStatus(c, year) {
    const rows = Alerts.reconcile1099(year).filter(r => r.clientId === c.id);
    if (!rows.length) return { label: "N/A", color: "slate" };
    const r = rows[0];
    if (!r.expected) return { label: "Not expected", color: "slate" };
    if (!r.received) return { label: "1099 pending", color: "amber" };
    if (Math.abs(r.difference) > 0.5) return { label: `Mismatch ${U.money(r.difference)}`, color: "red" };
    return { label: "Reconciled ✓", color: "green" };
  }

  function openEditor(rec) {
    UI.openForm("client", rec, {
      onSave: vals => {
        if (rec) Store.update("client", rec.id, vals);
        else Store.add("client", vals);
        UI.toast(rec ? "Client updated" : "Client added", "success");
        App.rerender();
      },
      deleteFn: r => { Store.remove("client", r.id); UI.toast("Client deleted"); App.rerender(); },
    });
  }

  function openDetail(c) {
    c = Store.get("client", c.id) || c;
    const year = App.viewYear();
    const st = stats(c, year);
    const rc = reconStatus(c, year);
    const S = Store.state;
    const wos = U.sortBy(S.workOrders.filter(w => w.clientId === c.id), w => w.dateAssigned || "", -1);
    const invs = U.sortBy(S.invoices.filter(i => i.clientId === c.id), i => i.invoiceDate || "", -1);

    const m = UI.modal({
      title: `🏢 ${U.escapeHtml(c.name)}`,
      size: "lg",
      body: `
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
          <button class="btn btn-sm btn-primary" id="cl-edit">✏️ Edit</button>
          <button class="btn btn-sm" id="cl-newwo">📋 New work order</button>
          <button class="btn btn-sm" id="cl-newinv">🧾 New invoice</button>
        </div>
        <div class="stat-grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">
          ${UI.statCard({ label: "Income (all time)", value: U.money(st.totalIncome, { cents: false }), color: "green" })}
          ${UI.statCard({ label: `Income ${year}`, value: U.money(st.yearIncome, { cents: false }) })}
          ${UI.statCard({ label: "Outstanding", value: U.money(st.outstanding, { cents: false }), sub: `${st.outstandingCount} invoice(s)`, color: st.outstanding > 0 ? "amber" : "green" })}
          ${UI.statCard({ label: "Est. profitability", value: U.money(st.profit, { cents: false }), sub: st.ehr != null ? `≈ ${U.money(st.ehr, { cents: false })}/hr effective` : "", color: "accent" })}
          ${UI.statCard({ label: "Avg. payment time", value: st.avgPay != null ? `${st.avgPay}d` : "—", color: st.avgPay > 45 ? "red" : "teal" })}
          ${UI.statCard({ label: "Work orders", value: `${st.open} open`, sub: `${st.closed} closed` })}
        </div>
        ${UI.detailGrid([
          ["Contact", U.escapeHtml(c.contactName || "")],
          ["Email", c.email ? `<a href="mailto:${U.escapeHtml(c.email)}">${U.escapeHtml(c.email)}</a>` : ""],
          ["Phone", c.phone ? `<a href="tel:${U.escapeHtml(c.phone)}">${U.escapeHtml(c.phone)}</a>` : ""],
          ["Billing address", U.escapeHtml(c.billingAddress || "").replace(/\n/g, "<br>")],
          ["Default rate", c.defaultHourlyRate ? U.money(c.defaultHourlyRate) + "/hr" : ""],
          ["Default flat fee", c.defaultFlatFee ? U.money(c.defaultFlatFee) : ""],
          ["Payment terms", U.escapeHtml(c.paymentTerms || "")],
          ["Remittance", U.escapeHtml(c.remittanceInstructions || "").replace(/\n/g, "<br>")],
          ["1099 expected", c.expects1099 ? "Yes" : "No"],
          ["W-9 provided", c.w9Provided ? "Yes" : "No"],
          ["1099 status (" + year + ")", UI.badge(rc.label, rc.color)],
          c.notes ? ["Notes", U.escapeHtml(c.notes).replace(/\n/g, "<br>")] : null,
          c.cpaNotes ? ["CPA notes", U.escapeHtml(c.cpaNotes).replace(/\n/g, "<br>")] : null,
        ])}
        ${wos.length ? `<h3 style="font-size:13px;margin:16px 0 6px;color:var(--accent-strong);text-transform:uppercase">Work orders</h3>
          ${wos.slice(0, 12).map(w => `<div class="score-line"><span>${U.escapeHtml(w.woNumber || "WO")} · ${U.escapeHtml(w.jobType || "")} · ${U.fmtDate(w.dateAssigned)}</span><span>${UI.statusBadge(SCHEMA.workOrderStatuses, w.status)}</span></div>`).join("")}` : ""}
        ${invs.length ? `<h3 style="font-size:13px;margin:16px 0 6px;color:var(--accent-strong);text-transform:uppercase">Invoices</h3>
          ${invs.slice(0, 12).map(i => `<div class="score-line"><span>${U.escapeHtml(i.invoiceNumber)} · ${U.fmtDate(i.invoiceDate)} · ${U.money(Store.invoiceTotal(i))}</span><span>${UI.statusBadge(SCHEMA.invoiceStatuses, i.status)}</span></div>`).join("")}` : ""}
      `,
      footer: `<button class="btn" id="cl-close">Close</button>`,
    });
    m.footerEl.querySelector("#cl-close").addEventListener("click", () => m.close());
    m.body.querySelector("#cl-edit").addEventListener("click", () => { m.close(); openEditor(c); });
    m.body.querySelector("#cl-newwo").addEventListener("click", () => { m.close(); WO.openEditor(null, { clientId: c.id, hourlyRate: c.defaultHourlyRate || "", flatFee: c.defaultFlatFee || "" }); });
    m.body.querySelector("#cl-newinv").addEventListener("click", () => {
      m.close();
      UI.openForm("invoice", null, { presets: { clientId: c.id, invoiceNumber: `INV-${App.viewYear()}-${String(Store.all("invoice").length + 1).padStart(3, "0")}` },
        onSave: v => { Store.add("invoice", v); UI.toast("Invoice added", "success"); App.rerender(); } });
    });
  }

  return { openEditor, openDetail, stats, reconStatus };
})();

Views.clients = {
  title: "Clients",
  render(el) {
    const year = App.viewYear();
    el.innerHTML = UI.pageHeader("Clients", "Carriers, adjusting firms, attorneys, and other payers.",
      `<button class="btn btn-primary" id="cl-add">＋ New Client</button>`) +
      `<div id="cl-list"></div>`;
    el.querySelector("#cl-add").addEventListener("click", () => Clients.openEditor(null));

    UI.listView(el.querySelector("#cl-list"), {
      data: () => Store.all("client"),
      searchText: c => [c.name, c.contactName, c.email, c.phone].join(" "),
      filters: [
        { id: "t99", label: "1099", options: [{ value: "yes", label: "1099 expected" }, { value: "no", label: "No 1099" }], apply: (c, v) => v === "yes" ? !!c.expects1099 : !c.expects1099 },
      ],
      columns: [
        { label: "Client", value: c => c.name },
        { label: "Contact", value: c => c.contactName || "—" },
        { label: `Income ${year}`, html: c => U.money(Clients.stats(c, year).yearIncome, { cents: false }), sortVal: c => Clients.stats(c, year).yearIncome, num: true },
        { label: "Outstanding", html: c => { const s = Clients.stats(c, year); return s.outstanding ? `<span style="color:var(--amber);font-weight:700">${U.money(s.outstanding, { cents: false })}</span>` : "—"; }, sortVal: c => Clients.stats(c, year).outstanding, num: true },
        { label: "Avg. pay", value: c => { const s = Clients.stats(c, year); return s.avgPay != null ? s.avgPay + "d" : "—"; }, sortVal: c => Clients.stats(c, year).avgPay ?? 999, num: true },
        { label: "Open WOs", value: c => Clients.stats(c, year).open, sortVal: c => Clients.stats(c, year).open, num: true },
        { label: "1099 status", html: c => { const r = Clients.reconStatus(c, year); return UI.badge(r.label, r.color); } },
      ],
      defaultSort: { col: 2, dir: -1 },
      onRow: c => Clients.openDetail(c),
      card: c => {
        const s = Clients.stats(c, year);
        const r = Clients.reconStatus(c, year);
        return `<div class="record-card">
          <div class="record-card-top">
            <div class="record-card-title">${U.escapeHtml(c.name)}</div>
            <div class="record-card-amount">${U.money(s.yearIncome, { cents: false })}</div>
          </div>
          <div class="record-card-sub">${U.escapeHtml(c.contactName || "")}</div>
          <div class="record-card-meta">
            ${s.open ? UI.badge(`${s.open} open WO`, "blue") : ""}
            ${s.outstanding ? UI.badge(`${U.money(s.outstanding, { cents: false })} owed`, "amber") : ""}
            ${UI.badge(r.label, r.color)}
          </div>
        </div>`;
      },
      empty: { icon: "🏢", title: "No clients yet", sub: "Add the carriers and firms that send you work.", actionLabel: "＋ New Client", actionId: "cl-empty-add", onAction: () => Clients.openEditor(null) },
    });
  },
};
