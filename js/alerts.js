/* =========================================================
   alerts.js — "what needs attention" engine + CPA / IRS-audit
   readiness scores. Every check returns records that fail, so
   panels can link straight to the fix.
   ========================================================= */
"use strict";

const Alerts = (() => {

  /** All substantiation / workflow checks for a tax year.
      Each: {id, icon, title, sub, route, severity: 'bad'|'warn'|'info', weight, items[]} */
  function runChecks(year) {
    const S = Store.state;
    const d = Store.yearData(year);
    const checks = [];
    const push = (c) => { c.count = c.items.length; checks.push(c); };

    /* --- Expenses --- */
    push({
      id: "exp-missing-receipt", icon: "🧾", route: "expenses", severity: "bad", weight: 3,
      title: "Expenses missing receipts",
      sub: "Attach or reference a receipt, or mark 'Not Required' for small items",
      items: d.expenses.filter(e => !e.receiptStatus || e.receiptStatus === "Missing"),
    });
    push({
      id: "exp-missing-purpose", icon: "✍️", route: "expenses", severity: "bad", weight: 3,
      title: "Expenses missing a business purpose",
      sub: "IRS substantiation generally expects a documented business purpose",
      items: d.expenses.filter(e => !String(e.businessPurpose || "").trim()),
    });
    push({
      id: "exp-uncategorized", icon: "🏷️", route: "expenses", severity: "bad", weight: 2,
      title: "Uncategorized expenses",
      sub: "Assign a Schedule C-style category for the CPA organizer",
      items: d.expenses.filter(e => !e.category),
    });
    push({
      id: "exp-cpa-review", icon: "👀", route: "expenses", severity: "warn", weight: 1,
      title: "Expenses flagged for CPA review",
      sub: "Resolve or document these before year-end",
      items: d.expenses.filter(e => e.cpaReview),
    });
    push({
      id: "exp-reimb-unbilled", icon: "↩️", route: "expenses", severity: "warn", weight: 2,
      title: "Reimbursable expenses not yet reimbursed",
      sub: "Add them to an invoice so you don't eat the cost",
      items: d.expenses.filter(e => e.reimbursable && !e.reimbursed),
    });
    const threshold = Number(S.settings.largeExpenseThreshold) || 2500;
    push({
      id: "exp-large", icon: "💰", route: "expenses", severity: "info", weight: 1,
      title: `Large expenses (over ${U.money(threshold, { cents: false })}) — depreciation / Sec. 179 review`,
      sub: "Big equipment purchases may need to be capitalized — ask your CPA",
      items: d.expenses.filter(e => (Number(e.amount) || 0) >= threshold ||
        (SCHEMA.assetLikeCategories.includes(e.category) && (Number(e.amount) || 0) >= 1000)),
    });
    push({
      id: "exp-double-dip", icon: "⚠️", route: "expenses", severity: "warn", weight: 2,
      title: "Reimbursed expenses still marked deductible",
      sub: "Deducting a reimbursed expense can double-count — CPA review",
      items: d.expenses.filter(e => e.reimbursable && e.reimbursed && e.deductible !== false),
    });

    /* --- Mileage --- */
    push({
      id: "mi-missing-purpose", icon: "🚗", route: "mileage", severity: "bad", weight: 3,
      title: "Mileage trips missing purpose or destination",
      sub: "IRS mileage substantiation expects date, miles, destination, and purpose",
      items: d.mileage.filter(m => !String(m.businessPurpose || "").trim() || !String(m.destination || "").trim()),
    });

    /* --- Income --- */
    push({
      id: "inc-unlinked", icon: "💵", route: "income", severity: "warn", weight: 2,
      title: "Income not linked to an invoice or 1099 source",
      sub: "Link to an invoice/client or note the source for reconciliation",
      items: d.income.filter(i => !i.invoiceId && !i.is1099 && !i.clientId),
    });
    push({
      id: "inc-cpa-review", icon: "👀", route: "income", severity: "warn", weight: 1,
      title: "Income entries flagged for CPA review",
      sub: "",
      items: d.income.filter(i => i.cpaReview),
    });

    /* --- Work orders / invoices --- */
    const wos = S.workOrders;
    push({
      id: "wo-uninvoiced", icon: "📋", route: "workorders", severity: "warn", weight: 2,
      title: "Reports submitted but not invoiced",
      sub: "Create the invoice so revenue isn't missed",
      items: wos.filter(w => w.status === "Submitted"),
    });
    push({
      id: "wo-overdue-report", icon: "⏰", route: "workorders", severity: "warn", weight: 1,
      title: "Reports past their due date",
      sub: "",
      items: wos.filter(w => SCHEMA.woOpenStatuses.includes(w.status) &&
        w.reportDueDate && U.daysFromToday(w.reportDueDate) < 0),
    });
    push({
      id: "inv-overdue", icon: "🔴", route: "invoices", severity: "bad", weight: 2,
      title: "Overdue invoices",
      sub: "Follow up on payment",
      items: S.invoices.filter(Store.invoiceIsOverdue),
    });
    push({
      id: "inv-unpaid", icon: "🧾", route: "invoices", severity: "info", weight: 1,
      title: "Invoices sent, awaiting payment",
      sub: "",
      items: S.invoices.filter(i => ["Sent", "Partial"].includes(i.status) && Store.invoiceBalance(i) > 0.005 && !Store.invoiceIsOverdue(i)),
    });
    push({
      id: "inv-paid-missing-info", icon: "❓", route: "invoices", severity: "warn", weight: 1,
      title: "Invoices marked paid but missing payment date or method",
      sub: "Complete the payment record for clean reconciliation",
      items: S.invoices.filter(i => i.status === "Paid" && (!i.paymentDate || !i.paymentMethod)),
    });

    /* --- Assets --- */
    push({
      id: "asset-depr", icon: "🛠️", route: "assets", severity: "info", weight: 1,
      title: "Assets awaiting depreciation / Section 179 review",
      sub: "Bring these to your CPA at year-end",
      items: S.assets.filter(a => a.askCpaDepreciation && ["Not Reviewed", "Sent to CPA"].includes(a.depreciationStatus || "Not Reviewed")),
    });

    /* --- Contractors --- */
    push({
      id: "ctr-1099", icon: "👷", route: "contractors", severity: "warn", weight: 2,
      title: "Contractor payments that may require a 1099-NEC",
      sub: "Generally $600+ per year for services — confirm with CPA; collect W-9s",
      items: S.contractors.filter(c => {
        const paid = U.sum((c.payments || []).filter(p => U.yearOf(p.date) === Number(year)), p => p.amount);
        return paid >= 600 && !c.w9Received;
      }),
    });

    /* --- Home office --- */
    const ho = S.homeOffice;
    push({
      id: "ho-review", icon: "🏠", route: "homeoffice", severity: "info", weight: 1,
      title: "Home office needs CPA confirmation",
      sub: "Fields entered but not yet reviewed with CPA",
      items: (ho.usedRegularlyExclusively && ho.cpaReview) ? [ho] : [],
    });

    /* --- Quarterly taxes --- */
    const dueSoon = SCHEMA.quarterDueDates(Number(year)).filter(q => {
      const dd = U.daysFromToday(q.due);
      const paidForQ = S.taxPayments.some(p => Number(p.taxYear) === Number(year) && p.quarter === q.q);
      return dd !== null && dd >= -10 && dd <= 21 && !paidForQ;
    });
    push({
      id: "tax-quarter", icon: "🏛️", route: "taxes", severity: "warn", weight: 2,
      title: "Quarterly estimated tax due soon (or just passed)",
      sub: dueSoon.map(q => `${q.q} due ${U.fmtDate(q.due)}`).join(" · "),
      items: dueSoon,
    });

    /* --- 1099 reconciliation --- */
    const recon = reconcile1099(year);
    push({
      id: "ten99-mismatch", icon: "🔀", route: "income", severity: "warn", weight: 2,
      title: "1099 totals that don't match recorded income",
      sub: "Compare each client's 1099 to what you recorded — CPA review",
      items: recon.filter(r => r.received && Math.abs(r.difference) > 0.5),
    });

    /* --- Data hygiene --- */
    push({
      id: "dupes", icon: "👯", route: "settings", severity: "warn", weight: 1,
      title: "Possible duplicate records",
      sub: "Same date/vendor/amount — verify and delete extras",
      items: Store.findDuplicates(),
    });
    push({
      id: "backup", icon: "💾", route: "settings", severity: "info", weight: 1,
      title: "Backup reminder",
      sub: "Export a JSON backup — data lives only in this browser",
      items: Store.backupDue() ? [{}] : [],
    });

    return checks;
  }

  /** 1099 reconciliation rows for a year. */
  function reconcile1099(year) {
    const S = Store.state;
    const rows = [];
    for (const c of S.clients) {
      const incomeTotal = U.sum(S.income.filter(i => i.clientId === c.id && U.yearOf(i.date) === Number(year) && i.is1099), i => i.amount);
      const rec = S.form1099s.find(f => f.clientId === c.id && Number(f.taxYear) === Number(year));
      const expected = c.expects1099 || incomeTotal >= 600;
      if (!expected && !rec && incomeTotal === 0) continue;
      const amountReceived = rec ? Number(rec.amountReceived) || 0 : 0;
      rows.push({
        clientId: c.id, clientName: c.name, taxYear: Number(year),
        expected, received: !!(rec && rec.received),
        appTotal: U.round2(incomeTotal), amountReceived: U.round2(amountReceived),
        difference: U.round2(amountReceived - incomeTotal),
        notes: rec ? rec.notes : "",
      });
    }
    return rows;
  }

  /** CPA readiness = documentation completeness for handing off to a CPA. */
  function cpaScore(year) {
    const checks = runChecks(year);
    const ids = ["exp-missing-receipt", "exp-missing-purpose", "exp-uncategorized", "exp-cpa-review",
      "inc-unlinked", "inc-cpa-review", "mi-missing-purpose", "wo-uninvoiced", "inv-paid-missing-info",
      "asset-depr", "ctr-1099", "ten99-mismatch", "dupes"];
    return scoreFrom(checks, ids, year);
  }

  /** IRS audit readiness = substantiation depth (receipts, purposes, logs, allocations). */
  function auditScore(year) {
    const checks = runChecks(year);
    const ids = ["exp-missing-receipt", "exp-missing-purpose", "exp-uncategorized", "mi-missing-purpose",
      "exp-double-dip", "exp-large", "inc-unlinked", "ten99-mismatch", "ho-review", "dupes"];
    return scoreFrom(checks, ids, year);
  }

  /** Business health = operational (billing, collections, cash discipline). */
  function healthScore(year) {
    const checks = runChecks(year);
    const ids = ["wo-uninvoiced", "wo-overdue-report", "inv-overdue", "exp-reimb-unbilled", "tax-quarter", "backup"];
    return scoreFrom(checks, ids, year);
  }

  function scoreFrom(checks, ids, year) {
    const d = Store.yearData(year);
    const volume = d.expenses.length + d.mileage.length + d.income.length + Store.state.invoices.length;
    const relevant = checks.filter(c => ids.includes(c.id));
    let penalty = 0;
    const detail = [];
    for (const c of relevant) {
      const per = c.severity === "bad" ? 4 : c.severity === "warn" ? 2.5 : 1.5;
      const p = Math.min(c.count * per * (c.weight || 1), 24);
      penalty += p;
      detail.push({ id: c.id, title: c.title, count: c.count, penalty: U.round2(p), severity: c.severity, route: c.route });
    }
    // With almost no data, a perfect score is misleading — floor it informatively
    let score = Math.max(0, Math.round(100 - penalty));
    if (volume < 3 && score === 100) score = 100;
    return { score, detail: U.sortBy(detail.filter(x => x.count > 0), x => x.penalty, -1), checks: relevant };
  }

  /** Items for the "needs attention" panel, most severe first. */
  function attention(year) {
    const sevRank = { bad: 0, warn: 1, info: 2 };
    return U.sortBy(runChecks(year).filter(c => c.count > 0), c => sevRank[c.severity] * 100 - c.count, 1);
  }

  /** Mileage substantiation score (per requirement #8). */
  function mileageScore(year) {
    const trips = Store.yearData(year).mileage;
    if (!trips.length) return { score: 100, complete: 0, total: 0 };
    const complete = trips.filter(m => m.date && m.miles && String(m.destination || "").trim() && String(m.businessPurpose || "").trim()).length;
    return { score: Math.round(complete / trips.length * 100), complete, total: trips.length };
  }

  return { runChecks, attention, cpaScore, auditScore, healthScore, mileageScore, reconcile1099 };
})();
