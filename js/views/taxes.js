/* =========================================================
   views/taxes.js — quarterly estimated tax planner, reserve
   tracking, assumptions panel, year-end checklist.
   ========================================================= */
"use strict";

window.Views = window.Views || {};

const Taxes = (() => {
  function addPayment(presets) {
    UI.openForm("taxPayment", null, {
      presets: { taxYear: App.viewYear(), ...presets },
      onSave: vals => { Store.add("taxPayment", vals); UI.toast("Tax payment logged", "success"); App.rerender(); },
    });
  }
  function editPayment(rec) {
    UI.openForm("taxPayment", rec, {
      onSave: vals => { Store.update("taxPayment", rec.id, vals); UI.toast("Payment updated", "success"); App.rerender(); },
      deleteFn: r => { Store.remove("taxPayment", r.id); UI.toast("Payment deleted"); App.rerender(); },
    });
  }
  return { addPayment, editPayment };
})();

Views.taxes = {
  title: "Tax Planning",
  render(el) {
    const year = App.viewYear();
    const s = Store.state.settings;
    const t = Store.taxSummary(year);
    const d = Store.yearData(year);
    const quarters = SCHEMA.quarterDueDates(year);
    const locked = Store.isYearLocked(year);

    /* Schedule C-style expense rollup */
    const byLine = {};
    for (const e of d.expenses) {
      const line = SCHEMA.scheduleCFor(e.category);
      byLine[line] = (byLine[line] || 0) + Store.expenseDeductibleAmt(e);
    }
    const lineRows = U.sortBy(Object.entries(byLine).map(([name, value]) => ({ name, value })), r => r.value, -1);

    const checklist = Reports.checklistItems(year);
    const doneCount = checklist.filter(i => i.done).length;

    el.innerHTML = UI.pageHeader("Quarterly Taxes & Year-End Planning",
      `Organizer-level estimates for tax year <strong>${year}</strong>${locked ? " · " + UI.badge("YEAR LOCKED", "red") : ""}. Confirm all amounts with your CPA.`,
      `${App.yearPickerHtml()}<button class="btn btn-primary" id="tx-add">＋ Log Tax Payment</button>`) + `

      <div class="stat-grid">
        ${UI.statCard({ label: "Gross income", value: U.money(t.grossIncome), color: "green" })}
        ${UI.statCard({ label: "Est. deductions", value: U.money(t.deductibleExpenses + t.mileageDeduction), sub: `expenses ${U.money(t.deductibleExpenses, { cents: false })} + mileage ${U.money(t.mileageDeduction, { cents: false })}` })}
        ${UI.statCard({ label: "Est. net profit", value: U.money(t.netProfit), color: "accent" })}
        ${UI.statCard({ label: "SE tax reserve (est.)", value: U.money(t.seTax), sub: `${s.seTaxRatePct}% of 92.35% of net`, color: "purple" })}
        ${UI.statCard({ label: "Federal reserve (est.)", value: U.money(t.fedReserve), sub: `${s.federalReservePct}% of net`, color: "purple" })}
        ${UI.statCard({ label: "State reserve (est.)", value: U.money(t.stateReserve), sub: `${s.stateReservePct}% of net`, color: "purple" })}
        ${UI.statCard({ label: "Total reserve (est.)", value: U.money(t.totalReserve), color: "red" })}
        ${UI.statCard({ label: "Payments logged", value: U.money(t.taxPaymentsMade), sub: t.reserveRemaining > 0 ? `${U.money(t.reserveRemaining)} reserve remaining` : "reserve fully funded 🎉", color: "green" })}
      </div>

      <div class="grid-23">
        <div>
          <div class="card">
            <div class="card-title">🏛️ Quarterly estimated payments — ${year}</div>
            <div class="card-sub">Typical IRS due dates. A simple even split of the reserve is shown as a planning aid only.</div>
            <div class="table-wrap"><table class="data-table">
              <thead><tr><th>Quarter</th><th>Period</th><th>Due date</th><th class="num">Even-split est.</th><th class="num">Paid</th><th>Status</th></tr></thead>
              <tbody>
                ${quarters.map(q => {
                  const pays = d.taxPayments.filter(p => p.quarter === q.q);
                  const paid = U.sum(pays, p => p.amount);
                  const dd = U.daysFromToday(q.due);
                  const status = paid > 0 ? UI.badge("Paid", "green")
                    : dd < 0 ? UI.badge("Past due — not logged", "red")
                    : dd <= 21 ? UI.badge(`Due in ${dd}d`, "amber") : UI.badge("Upcoming", "slate");
                  return `<tr data-q="${q.q}" style="cursor:pointer">
                    <td><strong>${q.q}</strong></td><td>${q.period}</td><td>${U.fmtDate(q.due)}</td>
                    <td class="num">${U.money(t.totalReserve / 4)}</td>
                    <td class="num">${paid ? U.money(paid) : "—"}</td><td>${status}</td></tr>`;
                }).join("")}
              </tbody>
            </table></div>
            ${Charts.gaugeBar(t.taxPaymentsMade, t.totalReserve, { label: "Total reserve funded" })}
          </div>

          <div class="card">
            <div class="card-title">🧾 Payments logged</div>
            ${d.taxPayments.length ? `<div class="table-wrap"><table class="data-table">
              <thead><tr><th>Date</th><th>Quarter</th><th>Jurisdiction</th><th class="num">Amount</th><th>Method</th><th>Confirmation</th></tr></thead>
              <tbody>${U.sortBy(d.taxPayments, p => p.date || "", -1).map(p => `
                <tr data-pay="${p.id}"><td>${U.fmtDate(p.date)}</td><td>${U.escapeHtml(p.quarter)}</td><td>${U.escapeHtml(p.jurisdiction || "")}</td>
                <td class="num"><strong>${U.money(p.amount)}</strong></td><td>${U.escapeHtml(p.method || "")}</td><td>${U.escapeHtml(p.confirmation || "")}</td></tr>`).join("")}
              </tbody></table></div>`
            : UI.emptyState({ icon: "🏛️", title: "No payments logged", sub: "Log each estimated payment with its confirmation number." })}
          </div>

          <div class="card">
            <div class="card-title">📋 Expense summary by Schedule C-style line</div>
            <div class="card-sub">Estimated deductible amounts (after business-use % and reimbursements) — organizer only.</div>
            ${lineRows.length ? Charts.hbar({ items: lineRows, maxItems: 20 }) : UI.emptyState({ icon: "📋", title: "No expenses yet" })}
          </div>
        </div>

        <div>
          <div class="card">
            <div class="card-title">⚙️ Tax assumptions</div>
            <div class="card-sub">These drive every estimate. Set them with your CPA's guidance.</div>
            ${UI.detailGrid([
              ["SE tax rate", U.pct(s.seTaxRatePct, 1) + " of 92.35% of net"],
              ["Federal reserve", U.pct(s.federalReservePct) + " of net"],
              ["State reserve", U.pct(s.stateReservePct) + " of net"],
              [`Mileage rate ${year}`, "$" + Store.mileageRate(year).toFixed(2) + "/mi"],
              ["Business start", s.businessStartDate ? U.fmtDate(s.businessStartDate) : "—"],
              ["Entity", U.escapeHtml(s.entityType)],
            ])}
            <button class="btn btn-sm" style="margin-top:10px" data-route="settings">Edit assumptions in Settings →</button>
            <div class="disclaimer-inline">Estimates ignore other household income, deductions, credits, QBI, and bracket effects. They are reserves, not filing amounts.</div>
          </div>

          <div class="card">
            <div class="card-title">✅ Year-end tax checklist — ${year}</div>
            <div class="card-sub">${doneCount} of ${checklist.length} complete. Auto-checks reflect live data; manual items you tick yourself.</div>
            ${checklist.map(item => `
              <div class="checklist-item ${item.done ? "done" : ""}">
                <input type="checkbox" ${item.done ? "checked" : ""} ${item.auto ? "disabled" : `data-check="${item.key}"`}>
                <div><div class="cl-text">${U.escapeHtml(item.label)}${item.auto ? ' <span style="font-size:10.5px;color:var(--text-3)">(auto)</span>' : ""}</div>
                ${item.sub ? `<div class="cl-sub">${U.escapeHtml(item.sub)}</div>` : ""}</div>
              </div>`).join("")}
          </div>

          <div class="card">
            <div class="card-title">🔒 Year-end lock</div>
            <div class="card-sub">After your CPA export, lock ${year} so records can't be accidentally changed.</div>
            ${locked
              ? `<button class="btn" id="tx-unlock">🔓 Unlock ${year}</button>`
              : `<button class="btn btn-danger" id="tx-lock">🔒 Lock tax year ${year}</button>`}
          </div>
        </div>
      </div>
      ${UI.disclaimerHtml()}`;

    el.querySelector("#tx-add").addEventListener("click", () => Taxes.addPayment());
    el.querySelectorAll("[data-q]").forEach(tr => tr.addEventListener("click", () => Taxes.addPayment({ quarter: tr.getAttribute("data-q") })));
    el.querySelectorAll("[data-pay]").forEach(tr => tr.addEventListener("click", e => {
      e.stopPropagation();
      const p = Store.get("taxPayment", tr.getAttribute("data-pay"));
      if (p) Taxes.editPayment(p);
    }));
    el.querySelectorAll("[data-check]").forEach(cb => cb.addEventListener("change", () => {
      const y = String(year);
      Store.state.yearChecklists[y] = Store.state.yearChecklists[y] || {};
      Store.state.yearChecklists[y][cb.getAttribute("data-check")] = cb.checked;
      Store.save();
      App.rerender();
    }));
    el.querySelectorAll("[data-route]").forEach(x => x.addEventListener("click", () => App.go(x.getAttribute("data-route"))));

    const lockBtn = el.querySelector("#tx-lock");
    if (lockBtn) lockBtn.addEventListener("click", async () => {
      const ok = await UI.confirm(`Lock tax year ${year}?`,
        `Records dated in ${year} become read-only until unlocked. Do this after your CPA export.`,
        { danger: true, confirmLabel: "Lock year" });
      if (ok) {
        Store.state.lockedYears.push(year);
        Store.logAudit("updated", "settings", { id: "yearLock" }, [{ field: "lockedYear", from: "", to: year }]);
        Store.save(); UI.toast(`Tax year ${year} locked`, "success"); App.rerender();
      }
    });
    const unlockBtn = el.querySelector("#tx-unlock");
    if (unlockBtn) unlockBtn.addEventListener("click", async () => {
      const ok = await UI.confirm(`Unlock tax year ${year}?`,
        "Records in this year become editable again. Changes remain tracked in the audit log.",
        { requireText: "UNLOCK", confirmLabel: "Unlock" });
      if (ok) {
        Store.state.lockedYears = Store.state.lockedYears.filter(y => y !== year);
        Store.logAudit("updated", "settings", { id: "yearLock" }, [{ field: "unlockedYear", from: year, to: "" }]);
        Store.save(); UI.toast(`Tax year ${year} unlocked`); App.rerender();
      }
    });
    Charts.bindTooltips(el);
  },
};
