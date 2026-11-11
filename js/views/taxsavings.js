/* =========================================================
   views/taxsavings.js — the Tax Savings page: every legal way
   to lower this year's taxable income that fits the books,
   ranked by what it's worth, with the authority, the
   paperwork, and the line not to cross for each one.
   The thinking lives in js/taxideas.js; this draws it.
   ========================================================= */
"use strict";

window.Views = window.Views || {};

const TaxSavings = (() => {
  const esc = U.escapeHtml;
  const money0 = n => U.money(n, { cents: false });

  /* What the page remembers while the app is open: which cards are unfolded and
     which filters are on. Redrawing the list must never fold a card you're reading. */
  const view = { open: new Set(), tier: "all", showAll: false };

  const STATUS = {
    plan: { label: "Planning it", color: "blue" },
    done: { label: "Done", color: "green" },
    skip: { label: "Not for me", color: "slate" },
  };
  const KIND_RANK = { saves: 0, defers: 1, check: 2 };

  /** Biggest permanent savings first; then timing moves; then "make sure it's there";
      then the ones with no number. Done and dismissed sink to the bottom. */
  function sorted(ideas) {
    const rank = i => (i.status === "skip" ? 4000 : i.status === "done" ? 3000 : 0) + (i.est ? KIND_RANK[i.est.kind] * 100 : 900);
    return [...ideas].sort((a, b) => rank(a) - rank(b) || ((b.est ? b.est.savings : 0) - (a.est ? a.est.savings : 0)));
  }

  function estHtml(i) {
    if (!i.est) return `<span class="ts-save none">—</span><span class="ts-save-label">no estimate</span>`;
    const label = i.est.kind === "defers" ? "tax moved to next year" : i.est.kind === "check" ? "worth — confirm it's claimed" : "est. tax saved";
    return `<span class="ts-save ${i.est.kind}">≈ ${money0(i.est.savings)}</span><span class="ts-save-label">${label}</span>`;
  }

  function deadlineHtml(i) {
    if (!i.deadline) return "";
    const d = i.deadline.daysLeft;
    const badge = d == null ? "" : d < 0 ? UI.badge("date passed", "slate") : d <= 30 ? UI.badge(`${d} day${d === 1 ? "" : "s"} left`, "red")
      : d <= 75 ? UI.badge(`${d} days left`, "amber") : UI.badge(`${d} days left`, "slate");
    return `<div class="ts-deadline">⏱ <strong>Deadline:</strong> ${esc(i.deadline.label)} ${badge}</div>`;
  }

  const listHtml = (tag, items) => `<${tag}>${items.map(x => `<li>${esc(x)}</li>`).join("")}</${tag}>`;

  function ideaHtml(i) {
    const tier = TaxIdeas.TIERS[i.tier];
    const isOpen = view.open.has(i.id);
    const st = STATUS[i.status];
    return `<div class="ts-idea ts-${i.tier}${i.status ? " is-" + i.status : ""}${isOpen ? " open" : ""}" data-idea="${esc(i.id)}">
      <button type="button" class="ts-head" data-ts-toggle="${esc(i.id)}" aria-expanded="${isOpen}">
        <span class="ts-icon">${i.icon}</span>
        <span class="ts-main">
          <span class="ts-title">${esc(i.title)}</span>
          <span class="ts-tags">${UI.badge(tier.label, tier.color)}${st ? UI.badge(st.label, st.color) : ""}<span class="ts-group">${esc(i.group)}</span></span>
        </span>
        <span class="ts-side">${estHtml(i)}</span>
        <span class="ts-caret" aria-hidden="true">▾</span>
      </button>
      ${isOpen ? `<div class="ts-body">
        <p class="ts-summary">${esc(i.summary)}</p>
        ${i.why ? `<div class="ts-why"><strong>In your books:</strong> ${esc(i.why)}</div>` : ""}
        ${i.est ? `<div class="ts-est">${i.est.amount != null ? `${i.est.kind === "defers" ? "Amount moved" : "Deduction"} ≈ <strong>${money0(i.est.amount)}</strong> → ` : ""}${i.est.kind === "defers" ? "tax pushed to next year" : "tax saved"} ≈ <strong>${money0(i.est.savings)}</strong>. ${esc(i.est.note || "")}</div>` : ""}
        ${i.needs ? `<div class="ts-needs">✏️ ${esc(i.needs)}</div>` : ""}
        ${deadlineHtml(i)}
        <h4>How to do it</h4>${listHtml("ol", i.steps)}
        <h4>What makes it hold up</h4>${listHtml("ul", i.proof)}
        <h4>Where the line is</h4><p class="ts-line">${esc(i.line)}</p>
        <h4>Authority</h4>${listHtml("ul", i.authority).replace("<ul>", '<ul class="ts-auth">')}
        <div class="ts-actions">
          ${i.status === "done" ? "" : `<button type="button" class="btn btn-sm btn-primary" data-ts-set="done">✓ Done for ${TaxSavings.year()}</button>`}
          ${i.status === "plan" || i.status === "done" ? "" : `<button type="button" class="btn btn-sm" data-ts-set="plan">📌 Planning it</button>`}
          ${i.status === "skip" ? "" : `<button type="button" class="btn btn-sm btn-ghost" data-ts-set="skip">Not for me</button>`}
          ${i.status ? `<button type="button" class="btn btn-sm btn-ghost" data-ts-set="">↺ Reopen</button>` : ""}
          ${i.act ? `<button type="button" class="btn btn-sm btn-primary" data-ts-act="${esc(i.act.id)}">${esc(i.act.label)}</button>` : ""}
          ${i.cta ? `<button type="button" class="btn btn-sm" data-ts-go="${esc(i.id)}">${esc(i.cta.label)} →</button>` : ""}
        </div>
      </div>` : ""}
    </div>`;
  }

  /* ---------- the tax profile form ---------- */
  function profileHtml(year) {
    const p = TaxIdeas.profile(), yf = TaxIdeas.yearFacts(year);
    const sel = (key, opts) => `<select data-pf="${key}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(p[key] ?? "") === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    const numIn = (attr, key, val, ph, step = 1) => `<input type="number" inputmode="decimal" min="0" step="${step}" ${attr}="${key}" value="${esc(val ?? "")}" placeholder="${esc(ph)}">`;
    const f = (label, control, hint = "") => `<div class="field"><label>${esc(label)}</label>${control}${hint ? `<div class="hint">${esc(hint)}</div>` : ""}</div>`;
    return `
      <div class="card-title">🧾 Your tax profile</div>
      <div class="card-sub">The few facts the books can't know. They sharpen every estimate on this page, save as you go, and sync with your other device.</div>
      <div class="ts-profile-grid">
        ${f("Filing status", sel("filing", [["", "Not answered"], ["single", "Single / head of household"], ["joint", "Married filing jointly"]]), "Sets the income line where the 20% business-income deduction starts to shrink.")}
        ${f("Top federal bracket", sel("fedMarginalPct", [[10, "10%"], [12, "12%"], [22, "22%"], [24, "24%"], [32, "32%"], [35, "35%"], [37, "37%"]]), "The rate on your last dollar of taxable income. For 2026: 22% starts at $50,400 single / $100,800 joint; 24% at $105,700 / $211,400; 32% at $201,775 / $403,550.")}
        ${f("State rate %", numIn("data-pf", "stateMarginalPct", p.stateMarginalPct, "5.75", 0.05), "Virginia's top rate is 5.75%.")}
        ${f("Your age", numIn("data-pf", "age", p.age, "e.g. 48"), "Unlocks catch-up contributions (50+, 55+, 60–63).")}
        ${f(`Expected ${year} net profit`, numIn("data-yf", "expectedNetProfit", yf.expectedNetProfit, "leave blank to use this year's pace"), "Only if you know better than the pace so far.")}
        ${f("Retirement plan", sel("retirementPlan", [["", "Not sure / tell me"], ["none", "None yet"], ["solo401k", "Solo 401(k)"], ["sep", "SEP-IRA"], ["other", "Other / through a spouse's employer only"]]))}
        ${f(`Put into it for ${year} so far`, numIn("data-yf", "retirementContrib", yf.retirementContrib, "0"))}
        ${f("Health plan", sel("hdhp", [["", "Not sure"], ["none", "Not HSA-eligible"], ["self", "HSA-eligible — just me"], ["family", "HSA-eligible — family"]]), "A high-deductible plan (and, from 2026, bronze or catastrophic marketplace plans).")}
        ${f(`HSA contributions for ${year}`, numIn("data-yf", "hsaContrib", yf.hsaContrib, "0"))}
        ${f("Pay your own health premiums?", sel("selfPaidHealth", [["", "Not sure"], ["yes", "Yes — I buy my own coverage"], ["no", "No — covered through a spouse's or other employer"]]))}
        ${f(`Premiums paid in ${year}`, numIn("data-yf", "healthPremiums", yf.healthPremiums, "medical + dental + vision"))}
        ${f("Children who could do real work (under 18)", numIn("data-pf", "kids", p.kids, "0"), "Filing, scanning, photo sorting, cleaning gear…")}
        ${f("Spouse", sel("spouse", [["", "Not answered"], ["none", "Not married"], ["notinvolved", "Married — not involved in the business"], ["helps", "Married — helps in the business"]]))}
        ${f("Planning to buy a vehicle?", sel("vehiclePlan", [["", "Not answered"], ["no", "No"], ["yes", "Yes, in the next year"]]))}
        ${f(`Equipment you expect to buy soon ($)`, numIn("data-yf", "plannedEquipment", yf.plannedEquipment, "0"), "Laptop, camera, drone, meters, software.")}
        ${f("S-corporation salary to test ($)", numIn("data-yf", "scorpSalary", yf.scorpSalary, "leave blank for an illustration"), "What a licensed PE doing your job would be paid. Only used by the S-corporation idea.")}
      </div>`;
  }

  /* ---------- the fixed guidance ---------- */
  const LADDER = [
    ["More likely than not", "Better than even odds of winning on the merits. The level to aim for on anything large.", "green"],
    ["Substantial authority", "Real weight in the Code, regulations, rulings or court decisions — judged objectively, whatever you or anyone believes about audit odds. A position at this level carries no accuracy penalty if it loses; you owe the tax and interest.", "amber"],
    ["Reasonable basis", "A genuinely supportable reading, but weaker — the regulations call it “a relatively high standard”, not met by something merely arguable. It is protected from the penalty only if it is disclosed on the return (Form 8275) and backed by records.", "red"],
    ["Below that", "No real support. If it loses it costs the tax, interest and a 20% penalty, and disclosure doesn't help.", "slate"],
  ];
  const NEVER = [
    "Deduct personal spending as a business expense — the family holiday, groceries, a personal car.",
    "Create, alter or back-date a record: a mileage log written for the audit, a re-dated invoice or plan document, timesheets for work that wasn't done.",
    "Leave income off because no 1099 arrived. All of it is taxable, and the IRS matches every 1099 to your return by computer.",
    "Pay a spouse or child for work that wasn't done, or without the money actually changing hands.",
    "Claim 100% business use of something you plainly also use personally.",
    "Do a transaction whose only real effect is the deduction. If nothing changes outside the tax return, it can be ignored — with a penalty no adviser's opinion removes.",
  ];
  const NEEDS_SCORP = [
    ["The “Augusta rule” (rent your home to your business 14 days tax-free)", "You can't rent to yourself: a payment from the practice's account to you isn't rent paid to another taxpayer. With an S corporation paying a documented, market-rate rent for real meetings it works — and the Tax Court cut one such deduction from about $290,000 to $16,500 when the rate and the meetings weren't proven (Sinopoli v. Commissioner, T.C. Memo. 2023-105)."],
    ["An accountable plan", "Reimburses an owner-employee for home-office and vehicle costs tax-free. A sole proprietor deducts those directly instead — there's no employer to reimburse you."],
    ["Virginia's pass-through entity tax election", "A workaround for the federal cap on state-tax deductions (Va. Code §58.1-390.3). It's for S corporations and partnerships; a single-member LLC taxed as a sole proprietorship isn't a pass-through entity for it."],
    ["The R&D tax credit", "Heavily marketed to engineers, and it doesn't fit paid claim investigations in any structure: establishing the cause of damage isn't developing a product of your own, and research a client pays for regardless of the outcome is “funded”. The Tax Court has denied it to engineering firms and upheld penalties."],
  ];

  function guidanceHtml(c) {
    const r = c.rate;
    return `
      <div class="card">
        <div class="card-title">⚖️ How hard can a position be pushed?</div>
        <div class="card-sub">Arranging your affairs to pay less tax is legal. Hiding or inventing facts is not. In between, what matters is how much legal support a position has.</div>
        ${LADDER.map(([t, d, col]) => `<div class="ts-rule"><div>${UI.badge(t, col)}</div><div>${esc(d)}</div></div>`).join("")}
        <div class="disclaimer-inline">The 20% accuracy penalty applies to negligence, and to any understatement larger than the greater of $5,000 or 10% of the correct tax — 5% for anyone claiming the business-income deduction, which is you. <strong>Standard</strong> and <strong>Assertive</strong> ideas here rest on substantial authority when your facts fit; <strong>Aggressive</strong> ones turn on your specific facts and records — have your CPA confirm the level before filing, and ask whether Form 8275 disclosure is wise. Documented reliance on an independent CPA or enrolled agent who had all the facts is itself a defence to the penalty; relying on software, this app or an AI is not.</div>
      </div>
      <div class="card">
        <div class="card-title">🧱 What wins an audit: records made at the time</div>
        <div class="ts-rule"><div>${UI.badge("Every expense", "accent")}</div><div>What was bought, what it cost, when, and why the practice needed it. A bank line proves you paid — not that it was deductible. Where paperwork is thin a court may estimate, but it estimates low.</div></div>
        <div class="ts-rule"><div>${UI.badge("Travel, vehicle, gifts", "accent")}</div><div>Stricter: amount, date, place and business purpose (and who, for gifts) — recorded at or near the time. A receipt for all lodging and for anything else of $75 or more. No estimates are allowed here at all.</div></div>
        <div class="ts-rule"><div>${UI.badge("Keep it", "accent")}</div><div>3 years after filing; 6 if more than a quarter of income was left off; no limit for fraud or an unfiled return. Equipment, vehicle and home records until 3 years after you dispose of them.</div></div>
        <div class="ts-rule"><div>${UI.badge("What draws a look", "accent")}</div><div>Mostly mismatches a computer can see — a 1099 that isn't on the return — far more than audits. A home office you're entitled to is not a red flag; an inconsistent or unprovable return is.</div></div>
        <button type="button" class="btn btn-sm" style="margin-top:10px" data-ts-route="reports">Open the audit-readiness packet →</button>
      </div>
      <div class="card ts-never">
        <div class="card-title">⛔ The line — never, whatever the saving</div>
        <ul>${NEVER.map(x => `<li>${esc(x)}</li>`).join("")}</ul>
        <div class="disclaimer-inline">Arranging real affairs to pay the least tax the law allows is legal. These are not aggressive positions — they are false statements. The civil fraud penalty is 75% of the tax, there is no time limit on the audit, and evasion and false returns are felonies.</div>
      </div>
      <div class="card">
        <div class="card-title">🚫 Popular moves that don't work for you (yet)</div>
        <div class="card-sub">You'll hear about these. As a single-member LLC taxed as a sole proprietor they aren't available — most need an S corporation first.</div>
        ${NEEDS_SCORP.map(([t, d]) => `<div class="ts-rule col"><strong>${esc(t)}</strong><div>${esc(d)}</div></div>`).join("")}
      </div>
      <div class="card">
        <div class="card-title">🧮 How the estimates work</div>
        <div class="card-sub">Rough planning numbers from your profile — not a tax calculation.</div>
        ${UI.detailGrid([
          ["A Schedule C deduction saves", `≈ ${U.num(r.schedC * 100, 0)}¢ per $1`],
          ["A retirement / health-premium deduction", `≈ ${U.num(r.bizAbove * 100, 0)}¢ per $1`],
          ["An HSA deduction", `≈ ${U.num(r.above * 100, 0)}¢ per $1`],
          ["Self-employment tax at the margin", `${U.num(r.seMarginal * 100, 1)}%`],
        ])}
        <div class="disclaimer-inline">Federal bracket ${U.num(r.fed * 100, 0)}% and state ${U.num(r.st * 100, 2)}% from your profile. Business deductions also shrink the 20% business-income deduction, so their federal value is counted at 80% of the bracket — an approximation. Each idea is valued on its own; done together they overlap, so the total is a ceiling, not a forecast. Ignores phase-outs, credits, other household income and bracket changes — your CPA's projection is the real number.${c.L.exact ? "" : ` Dollar limits shown are ${c.L.limitsYear}'s — ${c.year}'s aren't in the app yet; confirm them.`}</div>
      </div>`;
  }

  /* ---------- printable sheet for the CPA ---------- */
  function printSheet(year) {
    const { ideas, ctx } = TaxIdeas.ideasFor(year);
    const rows = sorted(ideas).filter(i => i.status !== "skip");
    const sum = TaxIdeas.summary(year);
    const body = `
      <div style="margin-bottom:6px">
        <div style="font-size:19px;font-weight:800">${esc(Store.state.settings.businessName)}</div>
        <div style="font-size:14px;font-weight:700;color:var(--accent-strong)">Tax-savings discussion sheet</div>
        <div style="font-size:12px;color:var(--text-3)">Tax year ${year} · Printed ${U.fmtDateTime(U.nowISO())} · ${esc(Store.state.settings.entityType)}</div>
      </div>
      <p style="font-size:12.5px">Projected net profit ${money0(ctx.projNet)} (${esc(ctx.projFrom)}; ${money0(ctx.ytdNet)} on the books so far). Assumed rates: federal ${U.num(ctx.rate.fed * 100, 0)}%, state ${U.num(ctx.rate.st * 100, 2)}%. Open ideas total ≈ ${money0(sum.potential)} of tax, plus ≈ ${money0(sum.deferral)} that could be deferred. Estimates only — for discussion.</p>
      ${rows.map(i => `<div style="border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:10px;break-inside:avoid">
        <div style="display:flex;justify-content:space-between;gap:10px;font-weight:700"><span>${i.icon} ${esc(i.title)}</span><span>${i.est ? "≈ " + money0(i.est.savings) + (i.est.kind === "defers" ? " (deferred)" : "") : ""}</span></div>
        <div style="font-size:11.5px;color:var(--text-3);margin:2px 0 6px">${esc(TaxIdeas.TIERS[i.tier].label)} · ${esc(i.group)}${i.status ? " · " + esc(STATUS[i.status].label) : ""}${i.deadline ? " · " + esc(i.deadline.label) : ""}</div>
        ${i.why ? `<div style="font-size:12.5px;margin-bottom:5px">${esc(i.why)}</div>` : ""}
        <div style="font-size:12px"><strong>Line not to cross:</strong> ${esc(i.line)}</div>
        <div style="font-size:11.5px;color:var(--text-2);margin-top:4px"><strong>Authority:</strong> ${esc(i.authority.join(" · "))}</div>
        <div style="font-size:12px;margin-top:6px">CPA: ☐ agree &nbsp; ☐ adjust &nbsp; ☐ not for this client &nbsp;&nbsp; Notes: ______________________________</div>
      </div>`).join("")}`;
    Reports.show(`Tax-savings discussion sheet — ${year}`, body);
  }

  /* ---------- the page ---------- */
  let shownYear = null;

  function render(el) {
    const year = App.viewYear();
    shownYear = year;
    el.innerHTML = UI.pageHeader("Tax Savings",
      `Every legal way to lower your <strong>${year}</strong> taxable income that fits your books — ranked by what it's worth, with the authority, the paperwork and the line not to cross. Planning support, not tax advice.`,
      `${App.yearPickerHtml()}<button class="btn" id="ts-print">🖨️ CPA discussion sheet</button>`) +
      `<div id="ts-page">
        <div class="stat-grid" data-ts-stats></div>
        <div class="grid-23">
          <div>
            <div data-ts-nudge></div>
            <div class="ts-filters" data-ts-filters></div>
            <div data-ts-ideas></div>
            <div class="card" data-ts-protect></div>
          </div>
          <div>
            <div class="card" id="ts-profile">${profileHtml(year)}</div>
            <div data-ts-guidance></div>
          </div>
        </div>
        ${UI.disclaimerHtml()}
      </div>`;

    const page = el.querySelector("#ts-page");
    const q = sel => page.querySelector(sel);

    /** Everything that depends on the profile and the idea statuses — redrawn in
        place, so answering a profile question never rebuilds the form under you. */
    function paint() {
      const { ideas, ctx } = TaxIdeas.ideasFor(year);
      const sum = TaxIdeas.summary(year);
      const hidden = ideas.filter(i => i.status === "done" || i.status === "skip");
      const inTier = i => view.tier === "all" || i.tier === view.tier;
      const list = sorted(ideas).filter(i => inTier(i) && (view.showAll || (i.status !== "done" && i.status !== "skip")));

      q("[data-ts-stats]").innerHTML = [
        UI.statCard({ label: `Net profit ${year}`, value: U.money(ctx.projNet, { cents: false }),
          sub: ctx.t.netProfit < 0 && ctx.projNet === 0 ? `the books show a ${money0(-ctx.t.netProfit)} loss`
            : ctx.projNet !== ctx.ytdNet ? `${ctx.projFrom === "your estimate" ? "your estimate" : "projected"} · ${money0(ctx.ytdNet)} on the books so far`
            : "from the books", color: "accent", icon: "📈" }),
        UI.statCard({ label: "Tax you could still save", value: "≈ " + money0(sum.potential), sub: `${sum.open} idea${sum.open === 1 ? "" : "s"} open`, color: "green", icon: "💡" }),
        sum.deferral > 0 ? UI.statCard({ label: "Could move to next year", value: "≈ " + money0(sum.deferral), sub: "timing moves — deferred, not erased", color: "blue", icon: "⏩" }) : "",
        UI.statCard({ label: "Locked in", value: "≈ " + money0(sum.locked), sub: "ideas you've marked done", color: "teal", icon: "✅" }),
        UI.statCard({ label: "Each $1 of deduction saves", value: `≈ ${U.num(ctx.rate.schedC * 100, 0)}¢`, sub: `fed ${U.num(ctx.rate.fed * 100, 0)}% · state ${U.num(ctx.rate.st * 100, 2)}% · SE tax`, color: "purple", icon: "🧮" }),
        ctx.current ? UI.statCard({ label: `Days left in ${year}`, value: String(Math.max(ctx.daysLeft, 0)), sub: "most moves must happen by Dec 31", color: ctx.daysLeft <= 45 ? "red" : "amber", icon: "⏱" }) : "",
      ].join("");

      const p = TaxIdeas.profile();
      const unanswered = ["filing", "retirementPlan", "hdhp", "selfPaidHealth", "kids", "spouse", "vehiclePlan", "age"].filter(k => p[k] === "" || p[k] == null).length;
      q("[data-ts-nudge]").innerHTML = unanswered >= 3
        ? `<div class="ts-nudge">✏️ <span><strong>${unanswered} profile questions are unanswered.</strong> A minute on them turns the “no estimate” ideas into dollar figures and hides the ones that don't apply.</span><button type="button" class="btn btn-sm" data-ts-jump>Answer them</button></div>` : "";

      const tierCount = t => ideas.filter(i => (t === "all" || i.tier === t) && i.status !== "done" && i.status !== "skip").length;
      q("[data-ts-filters]").innerHTML =
        [["all", "All"], ...Object.entries(TaxIdeas.TIERS).map(([k, v]) => [k, v.label])].map(([k, label]) =>
          `<button type="button" class="lv-mf-chip${view.tier === k ? " selected" : ""}" data-ts-tier="${k}" aria-pressed="${view.tier === k}" title="${esc(k === "all" ? "Every idea" : TaxIdeas.TIERS[k].blurb)}">${esc(label)} · ${tierCount(k)}</button>`).join("") +
        (hidden.length ? `<button type="button" class="lv-mf-chip${view.showAll ? " selected" : ""}" data-ts-showall aria-pressed="${view.showAll}">${view.showAll ? "Hide" : "Show"} done / not for me · ${hidden.length}</button>` : "");

      q("[data-ts-ideas]").innerHTML = list.length ? list.map(ideaHtml).join("")
        : UI.emptyState({ icon: "🎉", title: ideas.length ? "Nothing open in this view" : "No ideas for this year yet",
            sub: ideas.length ? "Every idea here is marked done or not for you. Use the chips above to see them again." : "Log some income and expenses and the ideas appear." });

      const prot = TaxIdeas.protect(year);
      q("[data-ts-protect]").innerHTML = `
        <div class="card-title">🛡️ Protect what you're already claiming</div>
        <div class="card-sub">A deduction you can't back up is a deduction lost — plus a 20% penalty. These gaps are in your ${year} books right now.</div>
        ${prot.length ? prot.map(a => `
          <div class="attention-item sev-warn" ${a.action ? `data-ts-action="${esc(a.action)}"` : `data-ts-protect-go="${esc(a.id)}"`}>
            <div class="attention-icon">${a.icon}</div>
            <div class="attention-text"><div class="attention-title">${esc(a.title)}</div>${a.sub ? `<div class="attention-sub">${esc(a.sub)}</div>` : ""}</div>
            <div class="attention-count">${a.count}</div>
          </div>`).join("")
        : `<div class="score-line"><span>No substantiation gaps in ${year} — receipts, purposes and mileage logs are complete.</span><span class="ok">✓</span></div>`}`;

      q("[data-ts-guidance]").innerHTML = guidanceHtml(ctx);
      return { ideas, prot };
    }

    let cur = paint();
    const repaint = () => { cur = paint(); };

    // one listener on the page wrapper (it's rebuilt with the page; #main itself is not)
    page.addEventListener("click", e => {
      const t = e.target;
      const tog = t.closest("[data-ts-toggle]");
      if (tog) {
        const id = tog.getAttribute("data-ts-toggle");
        if (view.open.has(id)) view.open.delete(id); else view.open.add(id);
        cur = paint();
        return;
      }
      const set = t.closest("[data-ts-set]");
      if (set) {
        const id = set.closest("[data-idea]").getAttribute("data-idea");
        const s = set.getAttribute("data-ts-set");
        TaxIdeas.setIdeaStatus(year, id, s);
        if (s === "done" || s === "skip") view.open.delete(id);
        UI.toast(s === "done" ? "Marked done ✓" : s === "plan" ? "On your plan 📌" : s === "skip" ? "Hidden — “Show done / not for me” brings it back" : "Reopened", "success");
        repaint();
        return;
      }
      const actBtn = t.closest("[data-ts-act]");
      if (actBtn) {
        if (actBtn.getAttribute("data-ts-act") === "irs-rates" && Store.useIrsMileageRates(year)) {
          UI.toast(`Mileage rate for ${year} set to the IRS rates — ${Store.mileageRateText(year)}`, "success", 5000);
          repaint();
        }
        return;
      }
      const go = t.closest("[data-ts-go]");
      if (go) {
        const it = cur.ideas.find(x => x.id === go.getAttribute("data-ts-go"));
        if (it && it.cta) App.go(it.cta.route, { freshLists: true, lists: it.cta.lists || null });
        return;
      }
      const pg = t.closest("[data-ts-protect-go]");
      if (pg) {
        const a = cur.prot.find(x => x.id === pg.getAttribute("data-ts-protect-go"));
        if (a) App.go(a.route, { freshLists: true, lists: a.list || null });
        return;
      }
      const act = t.closest("[data-ts-action]");
      if (act) { DataHealth.run(act.getAttribute("data-ts-action")); return; }
      const rt = t.closest("[data-ts-route]");
      if (rt) { App.go(rt.getAttribute("data-ts-route")); return; }
      const tier = t.closest("[data-ts-tier]");
      if (tier) { view.tier = tier.getAttribute("data-ts-tier"); cur = paint(); return; }
      if (t.closest("[data-ts-showall]")) { view.showAll = !view.showAll; cur = paint(); return; }
      if (t.closest("[data-ts-jump]")) {
        const card = q("#ts-profile");
        card.scrollIntoView({ behavior: "smooth", block: "start" });
        const first = card.querySelector("select, input");
        if (first) setTimeout(() => first.focus({ preventScroll: true }), 350);
      }
    });

    // profile answers save as they're given
    q("#ts-profile").addEventListener("change", e => {
      const inp = e.target.closest("[data-pf], [data-yf]");
      if (!inp) return;
      const raw = inp.value.trim();
      const val = inp.type === "number" || inp.getAttribute("data-pf") === "fedMarginalPct" ? (raw === "" ? "" : Math.max(Number(raw) || 0, 0)) : raw;
      if (inp.hasAttribute("data-pf")) TaxIdeas.saveProfile({ [inp.getAttribute("data-pf")]: val });
      else TaxIdeas.saveYearFacts(year, { [inp.getAttribute("data-yf")]: val });
      repaint();
    });

    el.querySelector("#ts-print").addEventListener("click", () => printSheet(year));
  }

  return { render, printSheet, year: () => shownYear };
})();

Views.taxsavings = { title: "Tax Savings", render: el => TaxSavings.render(el) };
