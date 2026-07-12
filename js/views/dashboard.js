/* =========================================================
   views/dashboard.js — overview: KPIs, charts, readiness,
   needs-attention panel.
   ========================================================= */
"use strict";

window.Views = window.Views || {};

Views.dashboard = {
  title: "Dashboard",
  render(el) {
    const S = Store.state;
    const year = App.viewYear();
    const t = Store.taxSummary(year);
    const d = Store.yearData(year);
    const wos = S.workOrders;
    const openWOs = wos.filter(w => SCHEMA.woOpenStatuses.includes(w.status));
    const unbilledWOs = wos.filter(w => w.status === "Submitted");
    const closedWOs = wos.filter(w => ["Paid", "Closed"].includes(w.status));
    const pendingWOs = wos.filter(WO.isPendingInvoice);
    const pendingFees = U.sum(pendingWOs, WO.expectedFee);
    const outstanding = S.invoices.filter(i => ["Sent", "Partial", "Overdue"].includes(i.status) && Store.invoiceBalance(i) > 0.005);
    const overdue = outstanding.filter(Store.invoiceIsOverdue);
    const paidInv = d.invoices.filter(i => i.status === "Paid");
    const reimbUnbilled = U.sum(d.expenses.filter(e => e.reimbursable && !e.reimbursed), e => e.amount) +
      U.sum(d.mileage.filter(m => m.reimbursable && !m.reimbursed), m => Store.tripDeduction(m) + (Number(m.parking) || 0) + (Number(m.tolls) || 0));
    const missingReceipts = d.expenses.filter(e => !e.receiptStatus || e.receiptStatus === "Missing").length;

    const cpa = Alerts.cpaScore(year);
    const audit = Alerts.auditScore(year);
    const health = Alerts.healthScore(year);
    const attention = Alerts.attention(year);

    /* ---- monthly series ---- */
    const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
    const mLabels = months.map(U.monthLabel);
    const incByM = months.map(m => U.sum(d.income.filter(r => U.monthKey(r.date) === m), r => r.amount));
    const expByM = months.map(m => U.sum(d.expenses.filter(r => U.monthKey(r.date) === m), r => Store.expenseDeductibleAmt(r)));
    const netByM = months.map((_, i) => U.round2(incByM[i] - expByM[i]));
    const milesByM = months.map(m => U.sum(d.mileage.filter(r => U.monthKey(r.date) === m), r => r.miles));

    const incByClient = Object.entries(U.groupBy(d.income, r => r.clientId ? Store.clientName(r.clientId) : (r.sourceOther || "Other")))
      .map(([name, rs]) => ({ name, value: U.sum(rs, r => r.amount) }));
    const incByService = Object.entries(U.groupBy(d.income.filter(r => r.serviceType), r => r.serviceType))
      .map(([name, rs]) => ({ name, value: U.sum(rs, r => r.amount) }));
    const expByCat = Object.entries(U.groupBy(d.expenses, r => r.category || "Uncategorized"))
      .map(([name, rs]) => ({ name, value: U.sum(rs, r => r.amount) }));

    /* ---- invoice aging ---- */
    const aging = { "Current": 0, "1–30 days": 0, "31–60 days": 0, "61–90 days": 0, "90+ days": 0 };
    for (const inv of outstanding) {
      const bal = Store.invoiceBalance(inv);
      const late = inv.dueDate ? -U.daysFromToday(inv.dueDate) : 0;
      const bucket = late <= 0 ? "Current" : late <= 30 ? "1–30 days" : late <= 60 ? "31–60 days" : late <= 90 ? "61–90 days" : "90+ days";
      aging[bucket] += bal;
    }

    /* ---- profit per job / effective hourly rate ---- */
    const jobProfit = wos.filter(w => !["Cancelled"].includes(w.status)).map(w => {
      const inc = U.sum(S.income.filter(r => r.workOrderId === w.id), r => r.amount) ||
        U.sum(S.invoices.filter(i => i.workOrderId === w.id), Store.invoiceTotal);
      const exp = U.sum(S.expenses.filter(e => e.workOrderId === w.id && !(e.reimbursable && e.reimbursed)), e => e.amount);
      const mi = U.sum(S.mileage.filter(m => m.workOrderId === w.id && !(m.reimbursable && m.reimbursed)), Store.tripDeduction);
      const profit = U.round2(inc - exp - mi);
      const hrs = Number(w.actualHours) || 0;
      return { wo: w, profit, inc, ehr: hrs > 0 ? U.round2(profit / hrs) : null };
    }).filter(j => j.inc > 0);

    const dueQ = SCHEMA.quarterDueDates(year);
    const paidByQ = q => U.sum(d.taxPayments.filter(p => p.quarter === q), p => p.amount);

    el.innerHTML = `
      ${UI.pageHeader("Dashboard", `${S.settings.businessName} — tax year <strong>${year}</strong>. Figures are organizer estimates, not tax advice.`, App.yearPickerHtml())}

      <div class="stat-grid">
        ${UI.statCard({ label: "YTD Gross Income", value: U.money(t.grossIncome), color: "green", icon: "💵", onClickRoute: "income" })}
        ${UI.statCard({ label: "YTD Expenses (deductible est.)", value: U.money(t.deductibleExpenses), sub: `+ ${U.money(t.mileageDeduction)} est. mileage`, color: "red", icon: "💳", onClickRoute: "expenses" })}
        ${UI.statCard({ label: "Estimated Net Profit", value: U.money(t.netProfit), sub: "before CPA adjustments", color: "accent", icon: "📈" })}
        ${UI.statCard({ label: "Total Tax Reserve (est.)", value: U.money(t.totalReserve), sub: `SE ${U.money(t.seTax, { cents: false })} · Fed ${U.money(t.fedReserve, { cents: false })} · State ${U.money(t.stateReserve, { cents: false })}`, color: "purple", icon: "🏛️", onClickRoute: "taxes" })}
        ${UI.statCard({ label: "Pending Fees (not yet invoiced)", value: U.money(pendingFees), sub: `${pendingWOs.length} work order(s) awaiting invoice`, color: "purple", icon: "⏳", onClickRoute: "workorders" })}
        ${UI.statCard({ label: "Outstanding Invoices", value: U.money(U.sum(outstanding, Store.invoiceBalance)), sub: `${outstanding.length} open · ${overdue.length} overdue`, color: overdue.length ? "red" : "blue", icon: "🧾", onClickRoute: "invoices" })}
        ${UI.statCard({ label: "Work Orders", value: `${openWOs.length} open`, sub: `${unbilledWOs.length} unbilled · ${closedWOs.length} closed`, color: "teal", icon: "📋", onClickRoute: "workorders" })}
        ${UI.statCard({ label: "Business Miles (YTD)", value: U.num(t.mileageMiles, 0), sub: `≈ ${U.money(t.mileageDeduction)} deduction @ $${t.mileageRate.toFixed(2)}/mi`, color: "amber", icon: "🚗", onClickRoute: "mileage" })}
        ${UI.statCard({ label: "Unbilled Reimbursables", value: U.money(reimbUnbilled), sub: "expenses + mileage not yet invoiced", color: "amber", icon: "↩️", onClickRoute: "expenses" })}
        ${UI.statCard({ label: "Missing Receipts", value: String(missingReceipts), sub: missingReceipts ? "fix before year-end" : "all clear 🎉", color: missingReceipts ? "red" : "green", icon: "📎", onClickRoute: "expenses" })}
        ${UI.statCard({ label: "Paid Invoices (YTD)", value: String(paidInv.length), sub: U.money(U.sum(paidInv, i => Number(i.amountPaid) || 0)), color: "green", icon: "✅", onClickRoute: "invoices" })}
      </div>

      <div class="grid-23">
        <div>
          <div class="card">
            <div class="card-title">📊 Monthly income vs. expenses</div>
            <div class="card-sub">Income received vs. estimated deductible expenses by month</div>
            ${Charts.barChart({ labels: mLabels, series: [
              { name: "Income", color: "#16a34a", values: incByM },
              { name: "Expenses", color: "#ef4444", values: expByM }] })}
          </div>
          <div class="card">
            <div class="card-title">📈 Monthly net profit</div>
            ${Charts.lineChart({ labels: mLabels, series: [{ name: "Net profit", color: "#0ea5e9", values: netByM }] })}
          </div>
          <div class="grid-2">
            <div class="card">
              <div class="card-title">🏢 Income by client</div>
              ${Charts.donut({ items: incByClient, centerLabel: "YTD income" })}
            </div>
            <div class="card">
              <div class="card-title">🧰 Income by service type</div>
              ${incByService.length ? Charts.hbar({ items: incByService }) : UI.emptyState({ icon: "🧰", title: "No service types yet", sub: "Set a service type on income entries" })}
            </div>
          </div>
          <div class="grid-2">
            <div class="card">
              <div class="card-title">💳 Expenses by category</div>
              ${Charts.donut({ items: expByCat, centerLabel: "YTD spend" })}
            </div>
            <div class="card">
              <div class="card-title">🚗 Mileage by month</div>
              ${Charts.barChart({ labels: mLabels, series: [{ name: "Miles", color: "#f59e0b", values: milesByM }], money: false, height: 200 })}
            </div>
          </div>
          <div class="grid-2">
            <div class="card">
              <div class="card-title">⏳ Invoice aging (open balances)</div>
              ${Charts.hbar({ items: Object.entries(aging).map(([name, value], i) => ({ name, value, color: ["#16a34a", "#f59e0b", "#f97316", "#ef4444", "#991b1b"][i] })), maxItems: 5 })}
            </div>
            <div class="card">
              <div class="card-title">💼 Profit per job</div>
              <div class="card-sub">Income minus job-linked costs${jobProfit.some(j => j.ehr != null) ? " · effective $/hr where hours logged" : ""}</div>
              ${jobProfit.length ? Charts.hbar({ items: U.sortBy(jobProfit, j => j.profit, -1).map(j => ({
                name: `${j.wo.woNumber || "WO"} — ${Store.clientName(j.wo.clientId)}`,
                value: j.profit, sub: j.ehr != null ? `${U.money(j.ehr, { cents: false })}/hr` : "" })) })
              : UI.emptyState({ icon: "💼", title: "No completed jobs yet", sub: "Profit appears once income is linked to work orders" })}
            </div>
          </div>
        </div>

        <div>
          <div class="card">
            <div class="card-title">🚨 What needs attention</div>
            <div class="card-sub">Most important first — tap to jump there</div>
            ${attention.length ? attention.slice(0, 9).map(a => `
              <div class="attention-item sev-${a.severity}" data-route="${a.route}">
                <div class="attention-icon">${a.icon}</div>
                <div class="attention-text">
                  <div class="attention-title">${U.escapeHtml(a.title)}</div>
                  ${a.sub ? `<div class="attention-sub">${U.escapeHtml(a.sub)}</div>` : ""}
                </div>
                <div class="attention-count">${a.count}</div>
              </div>`).join("")
            : `<div class="empty-state" style="padding:18px"><div class="es-icon">🎉</div><div class="es-title">All clear</div><div class="es-sub">No open action items for ${year}.</div></div>`}
          </div>

          <div class="card">
            <div class="card-title">🎯 Readiness scores</div>
            <div class="card-sub">Higher = better documented. Tap a line to fix.</div>
            <div style="display:flex;justify-content:space-around;gap:6px;flex-wrap:wrap">
              ${Charts.scoreRing(cpa.score, { size: 105, label: "CPA ready" })}
              ${Charts.scoreRing(audit.score, { size: 105, label: "Audit ready" })}
              ${Charts.scoreRing(health.score, { size: 105, label: "Biz health" })}
            </div>
            <div style="margin-top:10px">
              ${[...cpa.detail, ...audit.detail].filter((x, i, arr) => arr.findIndex(y => y.id === x.id) === i).slice(0, 6).map(x => `
                <div class="score-line" data-route="${x.route}" style="cursor:pointer">
                  <span>${U.escapeHtml(U.truncate(x.title, 46))}</span><span class="${x.severity === "bad" ? "bad" : "warn"}">−${x.penalty}</span>
                </div>`).join("") || `<div class="score-line"><span>No deductions — well documented</span><span class="ok">✓</span></div>`}
            </div>
          </div>

          <div class="card">
            <div class="card-title">🏛️ Quarterly estimated taxes — ${year}</div>
            <div class="card-sub">Reserve estimate vs. payments logged. Confirm amounts with your CPA.</div>
            ${Charts.gaugeBar(t.taxPaymentsMade, t.totalReserve, { label: "Reserve funded" })}
            <div style="margin-top:12px">
              ${dueQ.map(q => {
                const paid = paidByQ(q.q);
                const dd = U.daysFromToday(q.due);
                const status = paid > 0 ? UI.badge(`Paid ${U.money(paid, { cents: false })}`, "green")
                  : dd < 0 ? UI.badge("Not logged", "red")
                  : dd <= 21 ? UI.badge(`Due in ${dd}d`, "amber") : UI.badge("Upcoming", "slate");
                return `<div class="score-line"><span><strong>${q.q}</strong> · due ${U.fmtDate(q.due)}</span><span>${status}</span></div>`;
              }).join("")}
            </div>
            <button class="btn btn-sm" style="margin-top:10px" data-route="taxes">Open tax planner →</button>
          </div>

          <div class="card">
            <div class="card-title">✅ Tax readiness checklist</div>
            ${(() => {
              const items = Reports.checklistItems(year);
              const done = items.filter(i => i.done).length;
              return `${Charts.gaugeBar(done, items.length, { label: `${done} of ${items.length} complete`, money: false })}
                <button class="btn btn-sm" style="margin-top:10px" data-route="taxes">Open year-end checklist →</button>`;
            })()}
          </div>
        </div>
      </div>
      ${UI.disclaimerHtml()}
    `;

    el.querySelectorAll("[data-route]").forEach(x => x.addEventListener("click", () => App.go(x.getAttribute("data-route"))));
    Charts.bindTooltips(el);
  },
};
