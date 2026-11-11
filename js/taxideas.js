/* =========================================================
   taxideas.js — the "Tax Savings" engine.

   Reads the books (income, expenses, mileage, assets, home
   office, work orders) plus a short tax profile, and returns
   the ways to legally lower this year's taxable income that
   actually apply — each with what it's worth, the authority
   behind it, the paperwork that makes it hold up, and the
   line where it stops being legal.

   Three tiers, so it's always clear how hard a position is
   being pushed:
     standard   — routine; rarely questioned when documented
     assertive  — clearly allowed, often missed, commonly
                  looked at on exam: paperwork is what wins
     aggressive — a defensible position with real audit
                  exposure; holds only if the facts and the
                  records are in place — CPA sign-off first

   The law and the figures here were checked against primary
   sources (the Code, regulations, IRS notices and revenue
   procedures, Virginia Tax bulletins) in November 2026, for
   a single-member Virginia PLLC filing Schedule C. Nothing
   here files anything or changes a record. It is planning
   support, not tax advice (see SCHEMA.DISCLAIMER).
   ========================================================= */
"use strict";

const TaxIdeas = (() => {

  /* ---------- the numbers, by tax year ----------
     Dollar limits change every year, and the 2025 budget law (P.L. 119-21) moved several.
     Each year's figures live here and nowhere else; a year that isn't listed borrows the
     nearest one and the page says so. Sources: Notice 2024-80 and 2025-67 (retirement
     limits); Rev. Proc. 2024-40 and 2025-32 (inflation adjustments); Rev. Proc. 2025-19
     (HSA); SSA wage-base announcements. */
  const LIMITS = {
    2025: {
      deferral: 23500, catchUp50: 7500, catchUp60: 11250, annualAdditions: 70000,
      hsaSelf: 4300, hsaFamily: 8550, hsaCatchUp55: 1000,
      ssWageBase: 176100,
      stdDeductionSingle: 15750, stdDeductionJoint: 31500, iraLimit: 7000,
      suv179: 31300, deMinimis: 2500,
      qbiSingle: 197300, qbiJoint: 394600,
      perDiemMIE: 68,
      homeOfficeRate: 5, homeOfficeMaxSqFt: 300,
    },
    2026: {
      deferral: 24500, catchUp50: 8000, catchUp60: 11250, annualAdditions: 72000,
      hsaSelf: 4400, hsaFamily: 8750, hsaCatchUp55: 1000,
      ssWageBase: 184500,
      stdDeductionSingle: 16100, stdDeductionJoint: 32200, iraLimit: 7500,
      suv179: 32000, deMinimis: 2500,
      qbiSingle: 201750, qbiJoint: 403500,
      perDiemMIE: 68,
      homeOfficeRate: 5, homeOfficeMaxSqFt: 300,
    },
  };

  /** The limits to use for a tax year → {…figures, limitsYear, exact}. */
  function limitsFor(year) {
    year = Number(year);
    const years = Object.keys(LIMITS).map(Number).sort((a, b) => a - b);
    const use = LIMITS[year] ? year : year < years[0] ? years[0] : years[years.length - 1];
    return { ...LIMITS[use], limitsYear: use, exact: use === year };
  }

  /* ---------- the tax profile ----------
     The handful of facts the books can't know. Kept in settings (so it rides along with
     backups and sync) under settings.taxPlan:
       profile — facts that hold year to year
       years   — { "2026": {…} } amounts that belong to one tax year
       ideas   — { "2026:solo401k": {s: "done"|"plan"|"skip", at} } */
  const PROFILE_DEFAULTS = {
    filing: "",               // "" unknown · single · joint
    fedMarginalPct: 22,       // top federal bracket — the rate on the last dollar
    stateMarginalPct: 5.75,   // Virginia's top rate (taxable income over $17,000)
    age: "",
    retirementPlan: "",       // "" unknown · none · solo401k · sep · other
    hdhp: "",                 // "" unknown · none · self · family
    selfPaidHealth: "",       // "" unknown · yes · no
    kids: "",                 // children old enough to do real work, under 18
    spouse: "",               // "" unknown · none · notinvolved · helps
    vehiclePlan: "",          // "" unknown · no · yes
  };
  const YEAR_DEFAULTS = { expectedNetProfit: "", retirementContrib: "", hsaContrib: "", healthPremiums: "", plannedEquipment: "", scorpSalary: "" };

  const plan = () => Store.state.settings.taxPlan || {};
  function profile() { return { ...PROFILE_DEFAULTS, ...(plan().profile || {}) }; }
  function yearFacts(year) { return { ...YEAR_DEFAULTS, ...((plan().years || {})[String(year)] || {}) }; }

  /** Write to the live settings object (never a captured one — a sync can swap it). */
  function mutatePlan(fn) {
    const s = Store.state.settings;
    const tp = s.taxPlan = { profile: {}, years: {}, ideas: {}, ...(s.taxPlan || {}) };
    fn(tp);
    Store.markSettingsChanged();
  }
  function saveProfile(patch) { mutatePlan(tp => { tp.profile = { ...(tp.profile || {}), ...patch }; }); }
  function saveYearFacts(year, patch) {
    mutatePlan(tp => { tp.years = { ...(tp.years || {}) }; tp.years[String(year)] = { ...(tp.years[String(year)] || {}), ...patch }; });
  }

  const ideaKey = (year, id) => `${year}:${id}`;
  function ideaStatus(year, id) { return ((plan().ideas || {})[ideaKey(year, id)] || {}).s || ""; }
  function setIdeaStatus(year, id, s) {
    mutatePlan(tp => {
      tp.ideas = { ...(tp.ideas || {}) };
      if (s) tp.ideas[ideaKey(year, id)] = { s, at: U.nowISO() };
      else delete tp.ideas[ideaKey(year, id)];
    });
  }

  /* ---------- helpers ---------- */
  const num = v => (v === "" || v == null || isNaN(Number(v))) ? null : Number(v);
  const $ = (n, cents = false) => U.money(n, { cents });
  const sumCat = (expenses, cats) => U.sum(expenses.filter(e => cats.includes(e.category)), Store.expenseDeductibleAmt);

  /** Self-employment tax on a net profit, and the half that's deductible. */
  function seTaxOn(net, L, seRatePct) {
    const base = Math.max(net, 0) * 0.9235;
    const full = Number(seRatePct) > 0 ? Number(seRatePct) / 100 : 0.153;
    const medicare = 0.029, oasdi = Math.max(full - medicare, 0);
    const tax = Math.min(base, L.ssWageBase) * oasdi + base * medicare;
    return { base, tax: U.round2(tax), half: U.round2(tax / 2), aboveWageBase: base > L.ssWageBase };
  }

  /* ---------- everything an idea needs to know ---------- */
  function context(year) {
    year = Number(year);
    const S = Store.state, s = S.settings;
    const t = Store.taxSummary(year), d = Store.yearData(year);
    const p = profile(), yf = yearFacts(year), L = limitsFor(year);
    const today = U.todayISO();
    const thisYear = new Date().getFullYear();
    const current = year === thisYear;
    const yearEnd = `${year}-12-31`;
    const daysLeft = current ? U.daysBetween(today, yearEnd) : null;
    const elapsed = current ? Math.min(Math.max((U.daysBetween(`${year}-01-01`, today) + 1) / 365, 0.05), 1) : 1;

    // profit: what the books show so far, and where the year is heading
    const ytdNet = Math.max(t.netProfit, 0);
    const typed = num(yf.expectedNetProfit);
    const projNet = typed != null && typed > 0 ? typed : (current && elapsed < 0.97 ? U.round2(ytdNet / elapsed) : ytdNet);
    const projFrom = typed != null && typed > 0 ? "your estimate" : (current && elapsed < 0.97 ? "this year's pace so far" : "the books");

    // rates: what a dollar of deduction is worth
    const fed = Math.min(Math.max(num(p.fedMarginalPct) ?? 22, 0), 50) / 100;
    const st = Math.min(Math.max(num(p.stateMarginalPct) ?? 0, 0), 15) / 100;
    const se = seTaxOn(projNet, L, s.seTaxRatePct);
    const seMarginal = 0.9235 * (se.aboveWageBase ? 0.029 : (Number(s.seTaxRatePct) > 0 ? Number(s.seTaxRatePct) / 100 : 0.153));
    // a business deduction also shrinks the 20% QBI deduction, so the federal bite is ~80% of the
    // bracket (an approximation: exact only while the QBI deduction is fully available)
    const fedBiz = fed * 0.8;
    const rate = {
      fed, st, seMarginal,
      // off Schedule C: income tax (net of the smaller ½-SE-tax deduction) + SE tax
      schedC: (fedBiz + st) * (1 - seMarginal / 2) + seMarginal,
      // above the line but tied to the business (retirement, health premiums): income tax only
      bizAbove: fedBiz + st,
      // personal above-the-line (HSA): full bracket, no QBI effect
      above: fed + st,
    };

    const age = num(p.age);
    const earned = Math.max(projNet - se.half, 0);   // "net earnings from self-employment" for plan limits
    const joint = p.filing === "joint";
    return { year, S, s, t, d, p, yf, L, today, thisYear, current, past: year < thisYear, yearEnd, daysLeft, elapsed,
      ytdNet, projNet, projFrom, rate, se, age, earned, joint, ho: S.homeOffice || {},
      qbiThreshold: joint ? L.qbiJoint : L.qbiSingle };
  }

  /* ---------- deadlines ---------- */
  const dl = (label, date) => ({ label, date: date || "" });
  const yearEndDeadline = c => dl(`By December 31, ${c.year}`, c.yearEnd);
  const returnDeadline = c => dl(`By the ${c.year} return's due date — April 15, ${c.year + 1}, or October 15 on extension`, `${c.year + 1}-04-15`);

  /* =========================================================
     The ideas. Each builder gets the context and returns null
     (doesn't apply) or:
       { id, icon, title, tier, group, summary, why, est, steps[],
         proof[], line, authority[], deadline, cta, act, needs }
     est: { amount (deduction or income moved), savings, kind, note }
       kind "saves"  — a real, permanent reduction; counts in the total
            "defers" — moves tax to a later year; shown, totalled separately
            "check"  — probably already on the return; make sure it is
     ========================================================= */
  const BUILDERS = [];
  const idea = fn => BUILDERS.push(fn);

  /* ================= Retirement & health ================= */

  /** What a solo 401(k) could take this year → {deferral, employer, total, catchUp}. */
  function solo401kRoom(c) {
    const { L, age, earned } = c;
    const catchUp = age == null ? 0 : (age >= 60 && age <= 63) ? L.catchUp60 : age >= 50 ? L.catchUp50 : 0;
    const employer = Math.min(earned * 0.20, L.annualAdditions);
    const deferral = Math.min(L.deferral, Math.max(earned - employer, 0), Math.max(L.annualAdditions - employer, 0));
    const cu = Math.min(catchUp, Math.max(earned - employer - deferral, 0));
    return { deferral: Math.floor(deferral), employer: Math.floor(employer), catchUp: Math.floor(cu), total: Math.floor(deferral + employer + cu) };
  }

  idea(c => {
    if (c.projNet < 5000 || c.p.retirementPlan === "other") return null;
    const r = solo401kRoom(c);
    const put = num(c.yf.retirementContrib) || 0;
    const room = Math.max(r.total - put, 0);
    const has = c.p.retirementPlan === "solo401k";
    return {
      id: "solo401k", icon: "🏦", tier: "standard", group: "Retirement & health",
      title: has ? "Max out your solo 401(k)" : "Open a solo 401(k) — the biggest deduction available to you",
      summary: "A one-person 401(k) lets you contribute twice: once as the “employee” and again as the “employer”. Every pre-tax dollar comes off your federal and Virginia taxable income, and you still own the money. You choose the employer piece after year-end, when the books are final — which makes it the dial for landing taxable income where you want it.",
      why: `On a ${$(c.projNet)} net profit (${c.projFrom}) you can put away up to ${$(r.total)} for ${c.L.limitsYear}: ${$(r.deferral)} as the employee` +
        (r.catchUp ? ` + ${$(r.catchUp)} catch-up` : "") + ` + ${$(r.employer)} as the employer (20% of net profit after half of self-employment tax).` +
        (put ? ` You've recorded ${$(put)} so far — ${$(room)} of room left.` : ""),
      est: room > 0 ? { amount: room, savings: room * c.rate.bizAbove, kind: "saves",
        note: "Income tax only — it is deducted on Schedule 1, not Schedule C, so it doesn't reduce self-employment tax." } : null,
      steps: [
        has ? "Confirm with the plan provider how much has gone in for this year, then decide the split between employee deferral and employer contribution."
            : `Cleanest: open the plan and sign the adoption agreement by December 31, ${c.year}. (A brand-new plan for a sole owner with no employees can still be adopted after year-end, with first-year deferrals in by April 15 — but don't plan on cutting it that close.)`,
        `Sign a written deferral election — a dollar amount or a percentage — by December 31, ${c.year}.`,
        "Deposit both pieces from the business account by the return's due date; the employer piece may wait for an extension.",
        "Pre-tax contributions cut this year's income; Roth ones don't (they pay off later). You can mix them.",
        "Once plan assets pass $250,000 at year-end, file Form 5500-EZ each year (due July 31).",
      ],
      proof: [
        "Signed, dated plan adoption agreement — kept permanently, with any amendments.",
        "Written deferral election dated on or before December 31 (for a new plan adopted after year-end: proof the deferral was deposited by April 15).",
        "Deposits from the business account into an account titled in the plan's name, with the tax year designated.",
        "The Publication 560 deduction worksheet (or your CPA's) showing net profit, half of SE tax and the 20% computation.",
      ],
      line: "Back-dating an adoption agreement or deferral election is fraud. Electing a deferral after December 31 for a plan that already existed doesn't work — only a new plan's first year gets the April 15 rule. Contributing more than the worksheet allows is nondeductible and draws a 10% excise tax. The plan is for a business with no employees but you and a spouse; staff who meet its age and service rules must be covered. Never deduct it on Schedule C to shave self-employment tax.",
      authority: ["IRC §401(k), §402(g)(1), §414(v), §415(c), §404(a)(8)", "IRC §401(b)(2) (a new plan for a sole owner with no employees: first-year deferrals until the unextended due date); Treas. Reg. §1.401(k)-1(a)(6)(iii)", "Notice 2025-67 (2026 limits); Notice 2024-80 (2025 limits); IRS Publication 560"],
      deadline: dl(`Adopt and elect by December 31, ${c.year}; fund by the return's due date`, c.yearEnd),
      needs: c.p.retirementPlan === "" ? "Tell the tax profile which retirement plan you have, and what you've put in this year." : null,
    };
  });

  idea(c => {
    if (c.projNet < 5000 || c.p.retirementPlan === "solo401k" || c.p.retirementPlan === "other") return null;
    const max = Math.floor(Math.min(c.earned * 0.20, c.L.annualAdditions));
    const put = num(c.yf.retirementContrib) || 0;
    const room = Math.max(max - put, 0);
    return {
      id: "sep", icon: "📮", tier: "standard", group: "Retirement & health", altOf: "solo401k",
      title: "SEP-IRA — the low-paperwork fallback",
      summary: "One page to set up, no annual filing, and it can be opened and funded as late as the extended filing deadline. The trade-off: employer-style contributions only, so at your income it shelters far less than a solo 401(k).",
      why: `For ${c.L.limitsYear} a SEP would take up to ${$(max)} (20% of net profit after half of self-employment tax).` + (put ? ` ${$(put)} recorded so far.` : "") +
        " Use it when the 401(k) window has closed or you want zero administration.",
      est: room > 0 ? { amount: room, savings: room * c.rate.bizAbove, kind: "saves", note: "An alternative to the solo 401(k), not in addition to it — counted once in the total." } : null,
      steps: [
        "Open a SEP-IRA at any brokerage and sign Form 5305-SEP (keep it — it isn't filed).",
        "Contribute up to 20% of net self-employment earnings: net profit minus half of SE tax. (Not 25% of net profit — that's the classic over-funding error.)",
        "Have the custodian code the deposit as an employer SEP contribution for the right year.",
      ],
      proof: ["Signed Form 5305-SEP (or the provider's adoption agreement) dated by the return's due date including extensions.", "Deposit confirmation for the correct tax year (Form 5498).", "The Publication 560 worksheet showing the 20% computation."],
      line: "Deposits made after the extended due date can't be claimed for the earlier year. A SEP can't be combined with a SIMPLE IRA for the same year, and if you ever have eligible employees they must get the same percentage. A SEP balance also spoils a later “backdoor Roth”.",
      authority: ["IRC §408(k); IRC §404(h)(1)(C)", "IRS Publication 560; Form 5305-SEP", "Notice 2025-67"],
      deadline: returnDeadline(c),
    };
  });

  idea(c => {
    if (c.projNet < 150000 || (c.age != null && c.age < 40)) return null;
    return {
      id: "cashbalance", icon: "🏛️", tier: "assertive", group: "Retirement & health",
      title: "Stack a cash-balance (defined-benefit) plan on top of the 401(k)",
      summary: "A pension-style plan for one person. The older you are and the more you earn, the more it lets you deduct — often several times the 401(k) limit — because the contribution is whatever an actuary certifies is needed to fund a target benefit. The 401(k) deferral still stacks on top.",
      why: `At roughly ${$(c.projNet)} of net profit you're in the range where the extra deduction outweighs the plan's running cost (an actuary and administrator, typically a few thousand dollars a year).` +
        ` In a high-income year it can also pull taxable income back under the ${$(c.qbiThreshold)} line where the 20% business-income deduction starts to shrink.`,
      est: null,
      steps: [
        "Ask a pension actuary / third-party administrator for an illustration: it shows your maximum deductible contribution by age.",
        "Adopt the plan by the last day of the tax year you want the deduction for.",
        "Fund it by the return's due date including extensions.",
        "Plan on funding it for several years — it's meant to be a lasting commitment.",
      ],
      proof: ["Signed plan document and the annual actuarial certification.", "Form 5500-EZ filed each year it's required.", "Evidence each contribution was deposited by the funding deadline."],
      line: "Contributions are required, not optional — miss the minimum funding and there's an excise tax. A plan opened and closed within a year or two to grab one deduction invites the IRS to say it was never a real, permanent plan. Only sustained high profit justifies it.",
      authority: ["IRC §415(b); IRC §404(a)(1), §404(a)(7)", "Notice 2025-67 (2026 limits)", "IRS Publication 560"],
      deadline: dl(`Adopt by December 31, ${c.year}`, c.yearEnd),
      needs: c.age == null ? "Add your age to the tax profile — the deduction depends on it." : null,
    };
  });

  idea(c => {
    if (c.p.hdhp === "none") return null;
    const family = c.p.hdhp === "family";
    const known = c.p.hdhp === "self" || family;
    const limit = (family ? c.L.hsaFamily : c.L.hsaSelf) + (c.age != null && c.age >= 55 ? c.L.hsaCatchUp55 : 0);
    const put = num(c.yf.hsaContrib) || 0;
    const room = Math.max(limit - put, 0);
    return {
      id: "hsa", icon: "🩺", tier: "standard", group: "Retirement & health",
      title: "Fund a Health Savings Account to the limit",
      summary: "The only account that's deductible going in, grows untaxed, and comes out tax-free for medical costs. With an HSA-eligible health plan you deduct the full contribution on the federal and Virginia returns even if you never itemise.",
      why: known
        ? `With ${family ? "family" : "self-only"} HSA-eligible coverage the ${c.L.limitsYear} limit is ${$(limit)}.` + (put ? ` You've recorded ${$(put)} — ${$(room)} to go.` : "")
        : `If your health plan is HSA-eligible, the ${c.L.limitsYear} limit is ${$(c.L.hsaSelf)} (self-only) or ${$(c.L.hsaFamily)} (family), plus ${$(c.L.hsaCatchUp55)} at age 55 or older.` +
          (c.year >= 2026 ? " New for 2026: any bronze or catastrophic individual-market plan counts as HSA-eligible, whatever its deductible." : ""),
      est: known && room > 0 ? { amount: room, savings: room * c.rate.above, kind: "saves", note: "Income tax only — a self-employed HSA deduction doesn't reduce self-employment tax." } : null,
      steps: [
        "Confirm the plan is HSA-eligible: a high-deductible health plan, or from 2026 any bronze or catastrophic plan bought on the individual market; no other disqualifying coverage, no Medicare.",
        "Open an HSA at any provider and contribute up to the limit for your coverage type.",
        "Pay today's medical bills out of pocket if you can and let the HSA grow — keep the receipts and reimburse yourself tax-free any time later.",
      ],
      proof: ["Insurance documents showing eligible coverage for each month you contributed for.", "Form 5498-SA from the HSA provider; Form 8889 with the return.", "Receipts for anything you reimburse from the account."],
      line: "Contributions for months you weren't covered by an eligible plan are excess contributions (6% excise tax a year until removed). Non-medical withdrawals before 65 are taxed plus a 20% penalty. A bronze plan from a small-group exchange doesn't get the 2026 rule.",
      authority: ["IRC §223, including §223(c)(2)(H) (bronze and catastrophic plans, from 2026)", "Notice 2026-5; Rev. Proc. 2025-19 (2026 limits)", "IRS Publication 969; Form 8889"],
      deadline: dl(`By April 15, ${c.year + 1} (no extension)`, `${c.year + 1}-04-15`),
      needs: known ? null : "Tell the tax profile what kind of health plan you have.",
    };
  });

  idea(c => {
    if (c.p.selfPaidHealth === "no") return null;
    const prem = num(c.yf.healthPremiums) || 0;
    return {
      id: "sehealth", icon: "🏥", tier: "standard", group: "Retirement & health",
      title: "Deduct 100% of your health, dental and vision premiums",
      summary: "A self-employed person deducts the premiums paid for themselves, a spouse, dependents and children under 27 — off the top of the return, no itemising. It's claimed on Schedule 1, not Schedule C, so it's easy for the books to miss.",
      why: prem ? `You've told the profile you pay about ${$(prem)} a year in premiums.`
        : "The books don't track personal insurance premiums — make sure your CPA gets the full-year total: medical, dental, vision, Medicare, and long-term-care premiums up to the age-based cap.",
      est: prem ? { amount: prem, savings: prem * c.rate.bizAbove, kind: "check", note: "Probably already on your return — confirm the full amount is there." } : null,
      steps: [
        "Add up every premium paid during the year for you and your family: medical, dental, vision, Medicare (all parts), long-term care.",
        "Give the total to your CPA for Form 7206 and Schedule 1.",
        "Marketplace plan with a premium tax credit? Only the part you actually paid counts.",
      ],
      proof: ["Premium statements or bank/card records for each month.", "Form 1095-A if the plan came from the marketplace.", "The policy may be in your own name or the business's."],
      line: "No deduction for any month you — or your spouse, a dependent, or a child under 27 — could have joined an employer-subsidised plan, even if it was turned down. The deduction can't exceed net profit after the SE-tax and retirement-plan deductions. Putting your own premiums on Schedule C to cut SE tax is wrong.",
      authority: ["IRC §162(l)", "Form 7206; Schedule 1 (Form 1040), line 17"],
      deadline: yearEndDeadline(c),
      needs: c.p.selfPaidHealth === "" ? "Tell the tax profile whether you pay for your own health coverage, and roughly how much." : null,
    };
  });

  idea(c => {
    if (c.projNet < 5000 || c.p.retirementPlan === "sep" || c.p.retirementPlan === "other") return null;
    return {
      id: "eaca45t", icon: "🎟️", tier: "aggressive", group: "Retirement & health",
      title: "The $500 auto-enrolment credit for a solo 401(k)",
      summary: "A small employer whose 401(k) includes an automatic-enrolment feature gets a $500 tax credit for each of three years. The statute doesn't exclude owner-only plans, so a solo 401(k) with that feature written into it can claim it — a position resting on the law's text, with no IRS ruling either way.",
      why: "It's a credit, not a deduction: $500 straight off the tax bill, three years running. Practitioners are split — some solo-401(k) providers market it, others say it was meant for employers with staff — and many no-fee plan documents don't include the feature at all.",
      est: { amount: null, savings: 500, kind: "saves", note: "$500 a year for three years, if the plan document really contains the feature. Would have to be repaid with interest if the IRS later rules owner-only plans out." },
      steps: [
        "Use a provider whose solo 401(k) document includes an eligible automatic contribution arrangement (a default deferral percentage unless you elect otherwise).",
        "Give yourself the annual notice the law requires, before each plan year, and keep it.",
        "Claim on Form 8881 Part II (carried to Form 3800), with a one-paragraph memo in the file citing the statute.",
        "Keep the feature in the same plan for all three years.",
      ],
      proof: ["The plan document page showing the automatic-enrolment election, default percentage and effective date.", "The annual notice, dated before each plan year.", "Deferrals actually made at or above the default percentage."],
      line: "Claiming it without the feature actually written into the plan for that year — or adding the language later and dating it earlier — is a false claim. The much larger start-up-cost credit does NOT work for an owner-only or owner-plus-spouse plan; don't put a token employee on payroll to manufacture it.",
      authority: ["IRC §45T; IRC §414(w)", "Form 8881, Part II; Notice 2020-68, Q&A A-1 and A-2", "No IRS ruling addresses owner-only plans"],
      deadline: dl(`The feature must be in the plan during ${c.year}`, c.yearEnd),
    };
  });

  /* ================= Rates & structure ================= */

  idea(c => {
    if (c.projNet < 1000) return null;
    const prem = c.p.selfPaidHealth === "no" ? 0 : (num(c.yf.healthPremiums) || 0);
    const qbi = Math.max(c.projNet - c.se.half - prem - (num(c.yf.retirementContrib) || 0), 0);
    const ded = qbi * 0.20;
    // advice-type receipts to watch: engineering testimony is engineering, but pure advice is "consulting"
    const watch = U.sum(c.d.income.filter(i => ["Expert Consulting", "Expert Testimony", "Claim Support"].includes(i.serviceType)), i => i.amount);
    const share = c.t.grossIncome > 0 ? watch / c.t.grossIncome : 0;
    return {
      id: "qbi", icon: "✂️", tier: "standard", group: "Rates & structure",
      title: "Take the 20% business-income deduction — as an engineering practice",
      summary: "Up to 20% of the practice's profit is simply not taxed federally. Doctors, lawyers, accountants and consultants lose it at higher incomes because theirs are “specified service” fields; engineering is carved out of that list by name. Your return and your records should say what you are: a licensed engineering practice.",
      why: `On ${$(c.projNet)} of projected profit the deduction is worth up to about ${$(ded)} off federal taxable income (less if the business is your only income — it is capped at 20% of taxable income). ` +
        `It's automatic while taxable income is at or below ${$(c.qbiThreshold)} (${c.joint ? "joint" : "single"}, ${c.L.limitsYear}). Above that, a practice with no payroll loses it whatever its field — the engineering carve-out then pays off only alongside W-2 wages, one reason the S-corporation option matters as profit grows.` +
        (watch > 0 ? ` Testimony, consulting and claim-support receipts are ${U.pct(share * 100, 0)} of this year's income: keep any advice that isn't tied to an engineering work order under 10% of gross receipts.` : ""),
      est: ded > 0 ? { amount: ded, savings: ded * c.rate.fed, kind: "check", note: "Federal only (Virginia doesn't follow it). Probably already on your return — confirm it, and that the business isn't coded as “consulting”." } : null,
      steps: [
        "Ask your CPA to confirm Form 8995 / 8995-A is on the return, and that the Schedule C business code is 541330 (Engineering services) — not a consulting code.",
        "Describe the work everywhere as what it is: engineering investigations and sealed engineering reports by a licensed PE.",
        "Tag income by service type (the app does this) so testimony and any pure advice work can be shown to be a small, incidental part of an engineering practice.",
        "The deduction is figured after half of SE tax, health-insurance and retirement deductions — make sure it isn't being computed on gross profit.",
      ],
      proof: ["PE licences and the firm's certificate of authority.", "Work orders and sealed reports showing each job is an engineering service.", "Income by service type (Reports → Income by service).", "Schedule C principal business code 541330."],
      line: "“Consulting” IS a specified service. If receipts from non-engineering advice (claims-handling or litigation-strategy consulting, paid speaking) reach 10% of gross receipts, the WHOLE business is treated as a specified service for that year — a cliff, not a proration. Don't relabel non-engineering income as engineering or rewrite invoice descriptions after the fact. No ruling or case addresses forensic engineers specifically. Returns claiming this deduction also face a stricter penalty test (5% understatement instead of 10%).",
      authority: ["IRC §199A, as amended by P.L. 119-21 §70105; §199A(d)(2)(A) with §1202(e)(3)(A)", "Treas. Reg. §1.199A-5(b)(2)(vii) (engineering is not consulting) and §1.199A-5(c)(1) (10% rule); Treas. Reg. §1.199A-3(b)(1)(vi)", "Rev. Proc. 2025-32 §4.26 (2026 thresholds); Forms 8995 / 8995-A; IRC §6662(d)(1)(C)"],
      deadline: dl("On the return — but the facts (invoice wording, the mix of work) are fixed as the year unfolds", ""),
    };
  });

  /** Net yearly gain from an S election at salary W, after the QBI give-back and added costs.
      Compares everything that changes: SE tax vs. payroll tax, both QBI deductions, federal
      and state income tax, and the extra cost K (payroll service, a second return, FUTA and
      state unemployment tax). */
  function scorpGain(c, W, K) {
    const P = c.projNet, { fed, st } = c.rate, L = c.L;
    const sole = c.se.tax + fed * (P - c.se.half) * 0.8 + st * (P - c.se.half);
    const fica1 = Math.min(W, L.ssWageBase) * 0.062 + W * 0.0145;   // each half
    const profit = P - W - fica1 - K;
    const corp = 2 * fica1 + K + fed * (W + profit - 0.2 * Math.max(profit, 0)) + st * (W + profit);
    return U.round2(sole - corp);
  }

  idea(c => {
    if (c.projNet < 100000) return null;
    const typed = num(c.yf.scorpSalary);
    const salary = typed && typed > 0 ? typed : Math.min(Math.max(Math.round(c.projNet * 0.5 / 5000) * 5000, 80000), 120000);
    const K = 2750;
    const gain = scorpGain(c, Math.min(salary, c.projNet), K);
    return {
      id: "scorp", icon: "🏢", tier: "assertive", group: "Rates & structure",
      title: "Elect S-corporation status and pay yourself a reasonable salary",
      summary: "As a sole proprietor essentially all profit pays 15.3% self-employment tax. An LLC taxed as an S corporation pays payroll tax only on the salary it pays you; the rest comes out as distributions with no payroll tax. It pays only when profit is well above what your labour is worth — and after the smaller business-income deduction and the extra accounting, the net is less than promoters claim.",
      why: `Projected ${c.year} profit ${$(c.projNet)}. At a ${$(salary)} salary${typed ? "" : " (an illustration — set your own in the tax profile)"}, after about ${$(K)} a year of payroll, second-return and unemployment-tax cost and the business-income deduction you'd give back, the election ` +
        (gain > 500 ? `nets about ${$(gain)} a year.` : gain > -500 ? "is roughly a wash at this profit." : `would cost about ${$(-gain)} a year — not worth it at this profit and salary.`) +
        " The salary has to be what a forensic PE's work is worth; that is the whole audit question.",
      est: gain > 500 ? { amount: null, savings: gain, kind: "saves", note: `Net of everything that changes, at a ${$(salary)} salary and your profile's tax rates. A lower salary also lowers the 401(k) employer contribution and your Social Security credits.` } : null,
      steps: [
        "Have your CPA run it with a defensible salary: wage surveys for licensed engineers, what you'd pay someone to do your job, your hours.",
        `File Form 2553 between January 1 and March 15, ${c.year + 1} to be an S corporation for all of ${c.year + 1}. (Late-election relief exists, but only if S status was genuinely intended from the start of the year.)`,
        "Run real payroll from the first quarter you take money out: W-2 wages, withholding, Forms 941, Virginia withholding and unemployment accounts.",
        "File Form 1120-S (and Virginia Form 502) each year; keep business and personal money strictly separate.",
        "Before electing, check each state you work in: some tax an S corporation where they don't tax a sole proprietor (DC's personal-services exclusion covers only unincorporated businesses).",
        "What the election also unlocks: Virginia's pass-through entity tax election, an accountable plan for home-office and vehicle costs, and — with real meetings at a documented market rent — renting your home to the company up to 14 days a year.",
      ],
      proof: ["A written reasonable-compensation analysis in the file each year (duties, hours, market wage data).", "Payroll records and timely payroll-tax deposits.", "Salary paid before distributions; distributions documented.", "1099s re-issued to the company's EIN, not your Social Security number."],
      line: "Taking distributions while paying yourself little or nothing is the most-litigated S-corporation abuse: courts recharacterise the distributions as wages and add payroll tax, penalties and interest (in Watson a $24,000 salary was reset to $91,044). For a one-engineer firm the IRS's stated view is that receipts from your personal services are wages — so the salary must look like a real PE's pay. The choice is sticky: after electing you generally can't switch back for 60 months. Never claim a retroactive start date you didn't actually intend.",
      authority: ["IRC §§1361, 1362, 1366; Form 2553; Treas. Reg. §301.7701-3(c)(1)(iv), (v)(C)", "Rev. Rul. 59-221; Rev. Rul. 74-44 (distributions taken in place of salary are wages)", "David E. Watson, P.C. v. United States, 668 F.3d 1008 (8th Cir. 2012); Rev. Proc. 2013-30 (late elections)"],
      deadline: dl(`Form 2553 by March 15, ${c.year + 1}, for ${c.year + 1}`, `${c.year + 1}-03-15`),
    };
  });

  idea(c => {
    if (c.projNet < 1000) return null;
    const have = sumCat(c.d.expenses, ["Business Taxes & Licenses"]);
    return {
      id: "biztaxes", icon: "🏷️", tier: "assertive", group: "Rates & structure",
      title: "Move the business share of taxes, loan interest and tax-prep fees onto Schedule C",
      summary: "Several costs you already pay have a business share that belongs on Schedule C, where it cuts self-employment tax as well as income tax and never touches the cap on state-and-local-tax deductions: the business share of your vehicle's personal property (“car”) tax and loan interest — even when you use the mileage rate — your locality's business licence tax, tax on business equipment, and the business part of your tax-preparation bill.",
      why: have ? `${$(have)} is logged under Business Taxes & Licenses for ${c.year}. Check that the vehicle's car tax and loan interest (× business-use %) and the business part of the tax-prep fee are in the books too.`
        : `Nothing is logged under Business Taxes & Licenses for ${c.year}. The vehicle's car tax and loan interest (× the business-use % from your mileage log) and the business part of last year's tax-prep fee are the usual gaps.`,
      est: null,
      steps: [
        "Work out the vehicle's business-use % for the year: business miles ÷ total miles (so note the odometer each January 1).",
        "Enter the value-based car tax × that %, and the loan interest × that %, as expenses. (Not the flat local registration fee — the mileage rate already covers that.)",
        "Ask your preparer to split the invoice: the part for Schedule C, the home office and the business schedules is a business expense.",
        "If your county or city bills a business licence (BPOL) tax or a tax on business equipment, those are Schedule C expenses in full.",
      ],
      proof: ["The locality's personal property tax bill, the loan's year-end interest statement, and the mileage log that sets the percentage.", "The preparer's invoice showing the business portion.", "Year-start and year-end odometer readings."],
      line: "State income tax on your business profit is never a Schedule C expense. Don't claim a business percentage higher than the mileage log supports, and don't deduct the same interest or tax twice. Virginia trade-off: once more than 50% of a vehicle's mileage is deducted as business, it no longer qualifies for the locality's personal-use car-tax relief — taking the relief while deducting majority business use is inconsistent and can be billed back.",
      authority: ["IRC §164(a), §164(b)(6)–(7); IRC §163(a)", "IRS Publication 463 (car-loan interest and personal property tax for the self-employed); Rev. Proc. 2019-46 §4.03", "Rev. Rul. 92-29 (tax-preparation fees); Va. Code §58.1-3523"],
      deadline: yearEndDeadline(c),
      cta: { label: "Add an expense", route: "expenses", lists: { "exp-list": { filters: { yr: String(c.year) } } } },
    };
  });

  idea(c => {
    const home = String(c.s.officeState || "").toUpperCase();
    const st = Store.stateIncomeSummary(c.year);
    const away = st.states.filter(x => x.state && x.state !== home && x.amount > 0);
    if (!home || !away.length) return null;
    return {
      id: "multistate", icon: "🗺️", tier: "assertive", group: "Rates & structure",
      title: "Out-of-state jobs: source only the on-site work, and take the credit so nothing is taxed twice",
      summary: `${SCHEMA.stateName(home)} taxes everything you earn, then credits income tax you actually pay to another state on the same income. Wage “reciprocity” with neighbouring states doesn't cover 1099 income, so each state has its own rule. Sourcing only the on-site share of a job to the other state — and claiming the credit at home — keeps the same dollars from being taxed twice.`,
      why: `${c.year} income sourced outside ${home}: ` + away.map(x => `${x.state} ${$(x.amount)}`).join(", ") + ". " +
        (away.some(x => x.state === "MD") ? "Maryland requires a nonresident return for any Maryland work in a year you file federally — there is no dollar floor. " : "") +
        (away.some(x => x.state === "DC") ? "DC generally doesn't tax an unincorporated business whose income is from the owner's personal services, and Virginia gives no credit for DC tax. " : "") +
        (away.some(x => x.state === "NC") ? "North Carolina uses its own statutory formula — have your preparer compute it. " : ""),
      est: null,
      steps: [
        "Keep each job's field state and the on-site share of the fee current (the work order has both); the Income by State report is what your CPA files from.",
        "File the other state's nonresident return where it's required, and claim the home-state credit for the tax actually paid (Virginia: Schedule OSC, with a copy of the other return).",
        "Keep time records as the work is done — on-site hours versus office hours per job.",
        "Use one sourcing method consistently, every job, every year.",
      ],
      proof: ["Time records per job showing on-site versus office hours.", "Work orders showing where each inspection took place.", "The other state's filed return and proof of payment."],
      line: "Skipping a required state return (no return means no statute of limitations), treating 1099 income as covered by wage reciprocity, claiming a credit for tax you didn't pay, or using a split that doesn't track where the work was done — and switching methods year to year to chase the lower rate. The hours split is a reasonable method, not a safe harbor.",
      authority: ["Va. Code §58.1-332; Virginia Schedule OSC", "Md. Code, Tax-Gen. §10-806(d)(1) (nonresident return); COMAR 03.04.02.05C", "D.C. Code §47-1808.01(3) (unincorporated-business exclusion)"],
      deadline: dl("With each state's return", ""),
      cta: { label: "Open reports", route: "reports" },
    };
  });

  /* ================= Home office, vehicle & travel ================= */

  idea(c => {
    const k = Store.mileageRateCheck(c.year);
    if (!k.known || k.matches) return null;
    const miles = c.t.mileageMiles;
    return {
      id: "mileagerate", icon: "⛽", tier: "standard", group: "Home office, vehicle & travel",
      title: `Your ${c.year} mileage rate is out of date`,
      summary: "The IRS sets the standard mileage rate each year — and in 2026 raised it mid-year. The rate in Settings doesn't match, so every logged mile is being priced wrong.",
      why: `Settings has ${Store.mileageRateText(c.year)} for ${c.year}. The IRS rates are ${Store.fmtRate(k.irs[0])}` + (k.irs[1] ? ` through June 30 and ${Store.fmtRate(k.irs[1])} from July 1` : " for the year") +
        `. On the ${U.num(miles, 0)} miles logged so far that's ${k.extra >= 0 ? $(k.extra, true) + " of deduction you're not counting" : $(-k.extra, true) + " more than the IRS rate allows"}.`,
      est: k.extra > 0 ? { amount: k.extra, savings: k.extra * c.rate.schedC, kind: "saves", note: "On miles already logged; every later mile is priced right too." } : null,
      steps: ["Tap “Use the IRS rates” below — trips are then priced by their date.", "If your CPA uses a different rate for a reason (a fleet, a reimbursement plan), set it by hand in Settings → Tax assumptions."],
      proof: ["Nothing extra: the rate is published; the mileage log is the proof of the miles."],
      line: "The standard rate is all-inclusive — don't also deduct that vehicle's gas, repairs, insurance or depreciation. It's available only if you chose it in the vehicle's first business year and never claimed Section 179, bonus or accelerated depreciation on it.",
      authority: ["Notice 2026-10 (72.5¢, 2026); Announcement 2026-11, I.R.B. 2026-29 (76¢ from July 1, 2026)", "Notice 2025-5 (70¢, 2025); Rev. Proc. 2019-46"],
      deadline: dl("Before the year's figures go to your CPA", ""),
      act: { id: "irs-rates", label: "Use the IRS rates" },
    };
  });

  idea(c => {
    const ho = c.ho;
    const sq = Number(ho.officeSqFt) || 0, home = Number(ho.homeSqFt) || 0;
    const claimed = !!ho.usedRegularlyExclusively && sq > 0;
    const simplified = Math.min(sq, c.L.homeOfficeMaxSqFt) * c.L.homeOfficeRate;
    const pct = sq && home ? sq / home : 0;
    const monthly = (Number(ho.utilities) || 0) + (Number(ho.internet) || 0) + (Number(ho.insurance) || 0) + (Number(ho.repairs) || 0);
    const actualKnown = pct * monthly * 12;
    const best = Math.max(simplified, actualKnown);
    return {
      id: "homeoffice", icon: "🏠", tier: "assertive", group: "Home office, vehicle & travel",
      title: claimed ? "Home office: run the regular method against the simplified one" : "Claim the home office — it's your principal place of business",
      summary: "You run the practice and write every report from home, and you have no other fixed office: that makes the home office your principal place of business even though the inspections happen elsewhere. It's a Schedule C deduction (so it cuts self-employment tax too), and it is not the audit flag it's rumoured to be.",
      why: claimed
        ? `Recorded: ${U.num(sq)} sq ft${home ? ` of ${U.num(home)} (${U.pct(pct * 100, 1)})` : ""}. Simplified method = ${$(simplified)}. ` +
          (actualKnown ? `Regular method on the costs entered so far ≈ ${$(actualKnown)} a year — before your share of mortgage interest or rent, property tax and depreciation, which usually make it the bigger number.` : "Enter your monthly utilities, insurance and repairs on the Home Office page to compare the regular method.")
        : "The Home Office page doesn't show a space used regularly and exclusively for the business yet. A 150 sq ft office is worth $750 a year on the simplified method alone, and typically more on the regular method.",
      est: best > 0 ? { amount: best, savings: best * c.rate.schedC, kind: claimed ? "check" : "saves",
        note: claimed ? "Already in hand — make sure the better of the two methods is the one on the return." : "Based on what's entered on the Home Office page." } : null,
      steps: [
        "Measure the office and the whole home; enter both on the Home Office page.",
        "Simplified method: $5 per sq ft, up to 300 sq ft ($1,500). No records of home costs, no depreciation to give back later.",
        "Regular method (Form 8829): the office's share of mortgage interest or rent, property tax, utilities, insurance, repairs and depreciation. More work, usually more deduction.",
        "Choose the better method each year, on the original return.",
        "Take a few dated photos of the office each year and keep them with the return.",
      ],
      proof: ["Floor measurements or a sketch showing office and total square footage.", "Dated photos showing the room set up as an office and nothing else.", "Utility, insurance, mortgage-interest or rent, and property-tax records (regular method).", "A note that you have no other fixed place where you do the practice's administrative work."],
      line: "“Exclusively” means exclusively: more than incidental personal use — a guest bed, the family computer, a treadmill — fails the test. The regular method's depreciation is taxed back (at up to 25%) when the house is sold. The deduction can't exceed the practice's income; the excess carries forward. Internet goes in once: on Schedule C at its business-use %, or in the home-office utilities, not both.",
      authority: ["IRC §280A(c)(1) (including the administrative/management test), §280A(c)(5)", "Rev. Proc. 2013-13 (simplified method)", "Form 8829; IRS Publication 587"],
      deadline: dl("On the return — but the space must have qualified during the year", ""),
      cta: { label: "Open Home Office", route: "homeoffice" },
    };
  });

  idea(c => {
    const trips = c.d.mileage;
    const inspect = trips.filter(m => (m.tripType || "Inspection") === "Inspection");
    const other = trips.length - inspect.length;
    const avg = inspect.length ? U.sum(inspect, m => m.miles) / inspect.length : 0;
    const noTrip = c.d.workOrders.filter(WO.tripNotLogged);
    const missingMiles = noTrip.length * avg;
    const rateNow = Store.mileageRateOn(c.current ? c.today : c.yearEnd);
    const amount = missingMiles * rateNow;
    return {
      id: "mileage", icon: "🚗", tier: "standard", group: "Home office, vehicle & travel",
      title: "Count every business mile — starting at your front door",
      summary: "Because your home office is your principal place of business, the drive from home to a loss site is a business trip, not a commute — every mile, both ways. The same goes for the errands nobody logs: the post office, the bank, the supply store, meeting an adjuster, a seminar. Parking and tolls are deductible on top of the per-mile rate.",
      why: (noTrip.length
        ? `${noTrip.length} inspected job${noTrip.length > 1 ? "s" : ""} in ${c.year} ${noTrip.length > 1 ? "have" : "has"} no trip in the mileage log` + (avg ? ` — at your average of ${U.num(avg, 0)} miles a trip that's about ${U.num(missingMiles, 0)} miles (${$(amount)}) not being deducted. ` : ". ")
        : `Every inspected ${c.year} job has a trip logged. `) +
        (other === 0 && trips.length ? `All ${trips.length} trips this year are inspections — no supply runs, bank or post-office trips, meetings or training drives have been logged.` : other ? `${other} non-inspection trip${other > 1 ? "s" : ""} logged.` : ""),
      est: amount > 0 ? { amount, savings: amount * c.rate.schedC, kind: "saves", note: `${U.num(missingMiles, 0)} estimated miles × ${Store.fmtRate(rateNow)} — an estimate to size the gap; only the real, documented trips are deductible.` } : null,
      steps: [
        "Log each trip the day it happens: date, where to, miles, and the business reason (⚡ Quick trip does it in four taps).",
        "Set each job's Travel Deduction to IRS mileage so the round trip is logged automatically when it's paid.",
        "For a past trip that isn't in the log: it can still be claimed if the date, destination, purpose and miles can be shown from other records — the work order with the loss address, dated inspection photos, toll records, the map distance.",
        "Log the small ones too — supply store, post office, bank, printer, seminars, meetings — and enter parking and tolls as expenses.",
        "Note the odometer every January 1: total miles for the year is what proves the business-use percentage.",
      ],
      proof: ["A log kept at or near the time of each trip (a weekly log counts): date, destination, miles, business purpose.", "Odometer readings at the start and end of the year.", "The work order or calendar entry that ties each trip to a job.", "The home-office record — it's what makes in-town trips from home business travel."],
      line: "Estimates and round numbers are not allowed for vehicle expenses, and a log rebuilt after the fact carries far less weight than one kept at the time — invented entries are fraud. Don't log personal stops or detours, and don't claim the per-mile rate plus the same vehicle's gas or repairs. If the home office didn't qualify, trips from home to sites inside your home metropolitan area would be commuting (out-of-area temporary sites stay deductible either way).",
      authority: ["IRC §162(a), §274(d); Temp. Treas. Reg. §1.274-5T(b)(6), (c)", "Rev. Rul. 99-7 (trips from a home that is the principal place of business)", "Rev. Proc. 2019-46; IRS Publication 463"],
      deadline: yearEndDeadline(c),
      cta: noTrip.length
        ? { label: "Show jobs missing mileage", route: "workorders", lists: { "wo-list": { filters: { yr: String(c.year), flag: "notrip" } } } }
        : { label: "Open the mileage log", route: "mileage", lists: { "mi-list": { filters: { yr: String(c.year) } } } },
    };
  });

  idea(c => {
    if (c.p.vehiclePlan === "no") return null;
    return {
      id: "heavyvehicle", icon: "🛻", tier: "aggressive", group: "Home office, vehicle & travel",
      title: "Buying a vehicle? Over 6,000 lbs, the business share can be written off in year one",
      summary: "Ordinary cars are capped at a few thousand dollars of depreciation a year. A truck, van or SUV with a gross vehicle weight rating above 6,000 lbs escapes those caps: with 100% bonus depreciation the business-use share of the price can be deducted the year it goes into service. It permanently gives up the per-mile rate on that vehicle — and for a high-mileage driver the per-mile rate often wins, so run both first.",
      why: `You carry ladders and equipment to job sites, so a heavy vehicle has an obvious business reason. Worth it only when replacing a vehicle anyway and the logged business-use share is high. (Section 179 cap for heavy SUVs: ${$(c.L.suv179)} for ${c.L.limitsYear}; bonus depreciation covers the rest. A pickup with a 6-ft bed has no SUV cap.)`,
      est: null,
      steps: [
        "Compare first: this year's business miles × the IRS rate, versus the vehicle's real costs × business-use %, over the years you'd keep it.",
        "Check the GVWR on the driver's door-jamb sticker — it must be over 6,000 lbs.",
        "Take delivery and start using it for business before December 31 of the year you want the deduction.",
        "Keep a mileage log every year you own it: business use must be more than 50%, and the deduction is the business-use percentage of the cost.",
        "Prefer Section 179 over bonus depreciation where you can: Virginia follows Section 179 but not bonus.",
      ],
      proof: ["Purchase contract and a photo of the door-jamb label showing GVWR.", "A mileage log for every year of ownership proving the business-use percentage.", "Receipts for the actual operating costs."],
      line: "The popular “any heavy SUV is a full write-off” is wrong three ways: only the business-use share is deductible, only if business use exceeds 50%, and the deduction is taxed back (with self-employment tax) if business use later falls to 50% or less. Claiming 100% business use on the household's only vehicle, ordering in December for January delivery, or switching back to the per-mile rate afterwards all fail. A vehicle expensed this way also loses Virginia's personal-use car-tax relief.",
      authority: ["IRC §168(k), as amended by P.L. 119-21; §179(b)(5); §280F(b), (d)(5)", "Rev. Proc. 2025-32 §4.24; Rev. Proc. 2019-46 §4.05", "Virginia Tax Bulletin 26-1; IRS Publications 463 and 946"],
      deadline: dl(`In service by December 31, ${c.year}`, c.yearEnd),
      needs: c.p.vehiclePlan === "" ? "Tell the tax profile whether you plan to buy a vehicle — this one hides if you don't." : null,
    };
  });

  idea(c => {
    const travel = sumCat(c.d.expenses, ["Travel"]);
    const meals = sumCat(c.d.expenses, ["Meals"]);
    const far = c.d.mileage.filter(m => (Number(m.miles) || 0) >= 300).length;
    if (!travel && !far) return null;
    return {
      id: "perdiem", icon: "🧳", tier: "assertive", group: "Home office, vehicle & travel",
      title: "Overnight jobs: deduct meals at the federal per-diem rate",
      summary: "When a job keeps you away from home overnight, you may deduct a flat daily meals-and-incidentals amount instead of keeping meal receipts. Half of it is deductible, and you don't have to prove what you actually spent — only that you were there on business. Lodging is always the actual cost, with a receipt.",
      why: `${c.year} shows ${travel ? $(travel) + " of travel expenses" : ""}${travel && far ? " and " : ""}${far ? far + " long round trip" + (far > 1 ? "s" : "") + " (300+ miles)" : ""}` +
        `${meals ? `, with ${$(meals)} of meals logged` : " and no meals logged at all"}. The standard rate is $${c.L.perDiemMIE} a day (higher in many Virginia, Maryland and North Carolina cities — look up the actual city on gsa.gov), 75% of that on the first and last day.`,
      est: null,
      steps: [
        "For each overnight trip note the dates, the city and the job (the work order already has it).",
        "Take the GSA meals-and-incidentals rate for that city for each day — 75% on the first and last day — then deduct 50% of the total.",
        "On a per-diem day, tips to hotel staff and porters are already inside the rate — don't add them again.",
        "Use one method (per diem or actual meal receipts) consistently.",
      ],
      proof: ["A travel record made at the time: dates away, destination, business purpose.", "Lodging receipts — they also prove you were away overnight.", "The GSA rate for each location."],
      line: "No need to stop for sleep or rest, no meal deduction — lunch on a long day trip is personal. No per diem for lodging, none for personal days added to a trip, none for a spouse who came along, and never per diem plus the actual receipts for the same day.",
      authority: ["IRC §162(a)(2), §274(d), §274(n)(1)", "Rev. Proc. 2019-48 §§4.03, 6.04 (self-employed: meals-and-incidentals rate only)", "United States v. Correll, 389 U.S. 299 (1967); IRS Publication 463"],
      deadline: yearEndDeadline(c),
    };
  });

  /* ================= Equipment & timing ================= */

  idea(c => {
    const small = c.d.expenses.filter(e => SCHEMA.assetLikeCategories.includes(e.category) && (Number(e.amount) || 0) > 200 && (Number(e.amount) || 0) <= c.L.deMinimis && e.deductible !== false);
    const smallAssets = c.d.assets.filter(a => (Number(a.cost) || 0) > 0 && (Number(a.cost) || 0) <= c.L.deMinimis);
    const big = c.d.assets.filter(a => (Number(a.cost) || 0) > c.L.deMinimis);
    const share = a => (Number(a.cost) || 0) * (Number(a.businessUsePct ?? 100) / 100);
    const total = U.sum(small, e => e.amount) + U.sum(smallAssets.filter(a => !a.expenseId), share);
    const bigTotal = U.sum(big, share);
    if (!small.length && !smallAssets.length && !big.length) return null;
    const n = small.length + smallAssets.length;
    return {
      id: "expensing", icon: "🛠️", tier: "standard", group: "Equipment & timing",
      title: "Write off this year's equipment in full, this year",
      summary: "Tools, cameras, drones, computers and meters don't have to be depreciated over five or seven years. Items costing $2,500 or less each can simply be expensed under the de minimis safe harbor — no depreciation schedule, no Virginia adjustment. Bigger ones can be expensed under Section 179.",
      why: `${c.year}: ` + [
        n ? `${n} equipment purchase${n > 1 ? "s" : ""} of $2,500 or less (${$(total)}) — covered by the safe-harbor election` : "",
        big.length ? `${big.length} asset${big.length > 1 ? "s" : ""} over $2,500 (${$(bigTotal)} business share) — use Section 179 rather than bonus depreciation, so Virginia allows the write-off too` : "",
      ].filter(Boolean).join("; ") + ". Make sure none of it is being spread over several years by default.",
      est: (total + bigTotal) > 0 ? { amount: total + bigTotal, savings: (total + bigTotal) * c.rate.schedC, kind: "check", note: "A timing choice, not extra money: the full deduction now instead of over 5–7 years. Confirm your CPA is taking it." } : null,
      steps: [
        "Ask your CPA to attach the de minimis safe-harbor election to this year's original return — it's a short statement, made each year.",
        "The safe harbor needs an expensing practice that was already in place on January 1 (it needn't be in writing). Write a one-line policy now — “items of $2,500 or less are expensed” — so next year is beyond question.",
        "If no such practice existed at the start of this year, use Section 179 for this year's items instead; the federal result is the same.",
        "For anything over $2,500, elect Section 179 rather than relying on bonus depreciation: Virginia follows Section 179 but adds bonus depreciation back.",
        "Mark each asset's depreciation status on the Assets page once your CPA decides.",
      ],
      proof: ["Itemised invoices showing each item's price (shipping on the same invoice counts toward the $2,500).", "The election statement in the filed return.", "For cameras, drones and anything also used personally: a record of business use — only the business share is deductible."],
      line: "An item at $2,501 is entirely out of the safe harbor. Don't have a seller split one unit across invoices to get under $2,500 — separately usable items (laptop, monitor, dock) are each tested on their own, but a kit sold as one unit is one item. Section 179 needs more than 50% business use, can't exceed your business income, and is taxed back if business use later drops to 50% or less. The safe-harbor election can't be added on an amended return.",
      authority: ["Treas. Reg. §1.263(a)-1(f); Notice 2015-82 ($2,500)", "IRC §179; IRC §168(k); Treas. Reg. §1.179-5(c)", "Virginia Tax Bulletin 26-1; IRS Publication 946"],
      deadline: dl(`In service by December 31, ${c.year}; elections made on the return`, c.yearEnd),
      cta: { label: "Review assets", route: "assets" },
    };
  });

  idea(c => ({
    id: "convert", icon: "📷", tier: "assertive", group: "Equipment & timing",
    title: "Put equipment you already own on the books",
    summary: "A camera, ladder, tools, computer, desk or drone you bought personally and now use for inspections or in the home office became a depreciable business asset the day you started using it for work — at the lower of what you paid or what it was worth that day.",
    why: `${c.S.assets.length ? `${c.S.assets.length} asset${c.S.assets.length > 1 ? "s are" : " is"} on the books` : "No assets are on the books yet"}. Anything you owned before the practice started and use for it now — field tools, the office desk and chair, shelving, a second monitor — is easy to leave off because no purchase ever went through the business.`,
    est: null,
    steps: [
      "Walk the office and the truck; list what the practice uses that it never bought.",
      "For each item note the date business use began and a fair value on that day (a used-price listing is fine evidence).",
      "Add each to Assets with the lower of cost or that value; your CPA depreciates it from the conversion date.",
      "Items bought personally after January 19, 2025 can take 100% bonus depreciation in the year of conversion; older ones mostly follow the regular schedule.",
    ],
    proof: ["The original receipt if you have it, or evidence of what it cost.", "Evidence of value at conversion (a comparable used listing, dated).", "When business use began — the first job it was used on."],
    line: "Using original cost when the item is worth less; claiming Section 179 (not allowed on converted property); “converting” things that remain family property; choosing a conversion date earlier than real business use; inflating values. Depreciation that should have been taken in earlier years reduces the basis whether you took it or not.",
    authority: ["Treas. Reg. §1.168(i)-4(b)(1) (basis = lesser of value or adjusted basis on conversion)", "Treas. Reg. §1.179-4(a), (e); Treas. Reg. §1.168(k)-2(g)(6)(iii)", "IRS Publication 946, “Property changed from personal use”"],
    deadline: dl("Depreciation starts on the return for the year business use began", ""),
    cta: { label: "Open Assets", route: "assets" },
  }));

  idea(c => {
    if (!c.current || c.daysLeft == null || c.daysLeft > 92) return null;
    const planned = num(c.yf.plannedEquipment) || 0;
    return {
      id: "buybeforeyearend", icon: "🗓️", tier: "standard", group: "Equipment & timing",
      title: "Need equipment anyway? Put it in service before December 31",
      summary: "A laptop, camera, drone, moisture meter, ladder or software licence you'll buy in the next few months is deductible in full this year if it's delivered and ready for use by year-end — even if it's on a credit card you pay off in January. The same goes for January's ordinary bills paid or charged in December.",
      why: planned ? `You've told the profile you expect to buy about ${$(planned)} of equipment. Moved into ${c.year}, that's a ${c.year} deduction.`
        : `${c.daysLeft} days are left in ${c.year}. Add what you expect to buy to the tax profile to see what moving it into this year is worth.`,
      est: planned ? { amount: planned, savings: planned * c.rate.schedC, kind: "defers", note: "Pulls a deduction forward a year — real money now, but it won't be there next year." } : null,
      steps: [
        "List what's worn out or due for replacement in the next six months.",
        "Order early enough that it arrives and is set up for use by December 31 — “placed in service”, not just paid for.",
        "A bank credit-card charge counts on the day it's charged, not the day you pay the card.",
      ],
      proof: ["Invoice and delivery confirmation dated in the tax year.", "Evidence it was ready for use by year-end (a setup date, a job it was used on)."],
      line: "Only buy what the practice would buy anyway: spending a dollar to save 35–40 cents is still a loss. Equipment ordered or paid for but not delivered and ready by December 31 belongs to next year. A cheque written December 31 but mailed in January is a January payment; a charge on a store's own account isn't payment until you pay it. Back-dating any of it is fraud.",
      authority: ["IRC §179, §168(k); Brown v. Commissioner, T.C. Memo. 2013-275 (placed in service)", "Treas. Reg. §1.461-1(a)(1); Granan v. Commissioner, 55 T.C. 753 (1971)", "Rev. Rul. 78-39 (a bank-card charge is payment when charged)"],
      deadline: yearEndDeadline(c),
    };
  });

  idea(c => {
    if (!c.current || c.daysLeft == null || c.daysLeft > 92) return null;
    const cats = ["Software Subscriptions", "Professional Liability Insurance", "General Business Insurance", "Professional Dues", "PE Registration Fees",
      "Licenses", "Website / Domain / Hosting", "Continuing Education", "Business Registration Fees"];
    const total = sumCat(c.d.expenses, cats);
    if (total < 200) return null;
    return {
      id: "prepay", icon: "⏩", tier: "assertive", group: "Equipment & timing",
      title: "Prepay next year's recurring bills in December",
      summary: "On the cash method an expense is deductible when you pay it. A bill that buys no more than 12 months — insurance, software, annual licence renewals, dues, hosting — can be paid this December and deducted this year.",
      why: `You've paid ${$(total)} this year for insurance, software, licences, dues and similar renewals. Paying the next 12 months of those before December 31 moves about that much of next year's deductions into ${c.year}.`,
      est: { amount: total, savings: total * c.rate.schedC, kind: "defers", note: "A one-time, one-year acceleration. Most useful in a high-income year." },
      steps: [
        "List the renewals due in the first half of next year.",
        "Pay them (or switch to annual billing) by December 31 — a card charge on the 31st counts.",
        `Each must cover 12 months or less AND end by December 31, ${c.year + 1}.`,
      ],
      proof: ["Invoices showing the coverage period.", "A payment record dated in the tax year."],
      line: "A 24- or 36-month policy, licence or subscription doesn't qualify even in part — it's deducted over its term, so a two-year PE renewal is spread over the two years. A 12-month term that starts late enough to run past the end of next year fails entirely. First-time licence or comity application fees are capital costs, never prepayments. A “deposit” parked with a vendor for unspecified future work isn't an expense yet.",
      authority: ["Treas. Reg. §1.263(a)-4(f)(1), (f)(8) Examples 1, 2 and 5", "Treas. Reg. §1.461-1(a)(1); IRS Publication 538", "Zaninovich v. Commissioner, 616 F.2d 429 (9th Cir. 1980)"],
      deadline: yearEndDeadline(c),
    };
  });

  idea(c => {
    if (!c.current || c.daysLeft == null || c.daysLeft > 61) return null;
    const pending = c.S.workOrders.filter(WO.isPendingInvoice);
    const fees = U.sum(pending, WO.expectedFee);
    if (fees <= 0) return null;
    return {
      id: "deferincome", icon: "📆", tier: "assertive", group: "Equipment & timing",
      title: "Time your December invoices so the money arrives in January",
      summary: "You're taxed when you're paid, not when you earn or bill. A job finished in December and invoiced at the end of the month is paid on the client's normal run in January — and that income, and the self-employment tax on it, moves a full year. When to send an invoice is your decision to make.",
      why: `${pending.length} job${pending.length > 1 ? "s" : ""} worth ${$(fees)} ${pending.length > 1 ? "aren't" : "isn't"} invoiced yet. Whatever is billed late enough to be paid after December 31 counts as ${c.year + 1} income.`,
      est: { amount: fees, savings: fees * c.rate.schedC, kind: "defers", note: "Moves the tax to next year; it doesn't remove it. Skip it if you expect a higher bracket next year or need the cash." },
      steps: [
        "Finish and submit reports as usual — don't delay the work.",
        "Send December's invoices in the last days of the month; the client pays on its normal cycle.",
        "Deposit what arrives when it arrives.",
      ],
      proof: ["Invoices dated when they were actually sent.", "Bank records showing the deposit date.", "Nothing else — this is ordinary cash-method accounting."],
      line: "A cheque received on December 30 is this year's income even if you deposit it in January, and so is a payment the client told you was ready in December even if you asked them to wait — both are the IRS's own examples of “constructive receipt”. Never alter an invoice or report date, and don't sign an agreement that pushes payment for finished work past March 15.",
      authority: ["IRC §451(a); Treas. Reg. §1.451-2(a) (constructive receipt)", "Treas. Reg. §1.446-1(c)(1)(i) (cash method)", "IRS Publication 334, ch. 2 (“Constructive receipt”; “Delaying receipt of income”)"],
      deadline: yearEndDeadline(c),
      cta: { label: "Show jobs not yet invoiced", route: "workorders", lists: { "wo-list": { filters: { flag: "pending" } } } },
    };
  });

  idea(c => {
    const start = c.s.businessStartDate ? U.yearOf(c.s.businessStartDate) : null;
    if (!start || (start !== c.year && start !== c.year - 1)) return null;
    return {
      id: "startup", icon: "🌱", tier: "standard", group: "Equipment & timing",
      title: "Deduct your start-up and formation costs",
      summary: "What you spent getting ready before the first job — forming the PLLC, training, a website, market research — isn't lost. Up to $5,000 of start-up costs is deductible in the year the practice opened; the rest is written off over 15 years. Costs of growing an already-running practice are simply current expenses.",
      why: `The profile says the practice started in ${start}. Costs paid before that date are easy to leave out because they predate the books.`,
      est: null,
      steps: ["Gather receipts for everything paid before the first day of business.", "Enter them as expenses dated the start date, with a note that they're start-up costs.", "Your CPA takes the first-year deduction and amortises any excess."],
      proof: ["Receipts, and the business start date (the first work order or invoice).", "State filing records for the PLLC."],
      line: "The education and exams needed to become a PE in the first place are personal, not deductible. A one-time application fee for an additional state licence of indefinite life is a capital cost recovered over 15 years — only the periodic renewals are current expenses. The $5,000 shrinks dollar-for-dollar once start-up costs pass $50,000.",
      authority: ["IRC §195(b)", "Treas. Reg. §1.263(a)-5(d)(3) (formation costs); Treas. Reg. §1.263(a)-4(d)(5) (licence fees)"],
      deadline: dl("On the return for the year the practice began", ""),
    };
  });

  /* ================= Family ================= */

  idea(c => {
    const kids = num(c.p.kids);
    if (kids === 0) return null;
    const perChild = 6000;
    const amount = kids ? kids * perChild : 0;
    return {
      id: "hirekids", icon: "🧒", tier: "assertive", group: "Family",
      title: "Put your children on the payroll — for real work",
      summary: "Wages you pay your own child for real work are a Schedule C deduction for you — and for a child under 18 working for a parent's sole proprietorship (or single-member LLC) there's no Social Security, Medicare or federal unemployment tax on them. The child's standard deduction then shelters the pay, so it can come out tax-free on both ends.",
      why: kids
        ? `With ${kids} child${kids > 1 ? "ren" : ""} able to help: at a modest ${$(perChild)} each for genuine work — filing, scanning, sorting site photos, cleaning and inventorying equipment, data entry — that's ${$(amount)} moved from your bracket to theirs. Each can earn up to ${$(c.L.stdDeductionSingle)} in ${c.L.limitsYear} before owing federal income tax, and put up to ${$(c.L.iraLimit)} of it in a Roth IRA.`
        : `If you have children under 18 who could do real tasks for the practice, each can earn up to ${$(c.L.stdDeductionSingle)} (${c.L.limitsYear}) federal-tax-free while you deduct the wages.`,
      est: kids ? { amount, savings: amount * c.rate.schedC, kind: "saves", note: `An illustration at ${$(perChild)} per child — the wage must match the hours worked and the going rate for the task.` } : null,
      steps: [
        "Write a short job description and an hourly rate you'd pay a stranger for the same work.",
        "Have the child fill in a timesheet as the work is done; pay by cheque or transfer into an account in the child's name.",
        "Run payroll under the LLC's own EIN: W-4, I-9, a W-2 after year-end, and Forms 941/944 even though no FICA is due.",
        "Check Virginia workers' compensation: it's required once you regularly have more than two employees, counting family.",
      ],
      proof: ["Timesheets showing dates, hours and tasks, kept at the time.", "Proof of payment into the child's own account.", "W-2, W-4, I-9 and payroll filings.", "A job description and the basis for the wage rate."],
      line: "It fails when the “wages” aren't pay for business work: an allowance relabelled as payroll, pay for household chores, hours nobody recorded, a rate well above market (the Tax Court trimmed pay for a 7-year-old), a December “bonus” sized to use up the standard deduction, or money that circles back to you. Paying the child on a 1099 forfeits the exemption. Writing timesheets now for work supposedly done earlier is fabricating records. No under-18 on a roof. The exemption ends if the practice becomes an S corporation.",
      authority: ["IRC §162(a)(1) (reasonable pay for services actually rendered)", "IRC §3121(b)(3)(A) (no FICA, child under 18); IRC §3306(c)(5) (no FUTA, under 21); Treas. Reg. §31.3121(b)(3)-1", "Eller v. Commissioner, 77 T.C. 934 (1981); IRS Publication 15"],
      deadline: dl(`Wages must be earned and paid by December 31, ${c.year}`, c.yearEnd),
      needs: kids == null ? "Tell the tax profile how many children could do real work — this hides at zero." : null,
    };
  });

  idea(c => {
    if (c.p.spouse === "none" || c.p.spouse === "notinvolved") return null;
    return {
      id: "spousehra", icon: "💍", tier: "aggressive", group: "Family",
      title: "Employ your spouse and run the family's medical costs through the practice",
      summary: "If your spouse genuinely works in the practice, it can pay a modest W-2 wage plus a written medical reimbursement plan for its employee — covering the employee's whole family, you included. Premiums and out-of-pocket medical bills then become Schedule C expenses, saving self-employment tax as well as income tax.",
      why: (c.p.spouse === "helps"
        ? "The profile says your spouse helps in the practice. Formalising that as real employment is what makes this available. "
        : "Only relevant if you're married and your spouse actually does work for the practice — scheduling, bookkeeping, report formatting, invoicing. ") +
        "It is well grounded in law but entirely fact-dependent, and a known IRS examination target.",
      est: null,
      steps: [
        "Document the job: duties, hours, a reasonable wage. Put your spouse on payroll with a W-2 (the wage carries Social Security and Medicare tax, but no federal unemployment tax).",
        "Adopt a written reimbursement plan BEFORE any expense is reimbursed.",
        "Put the health policy in the employee-spouse's name; they pay the bills and submit them; the practice reimburses from the business account.",
        "Keep total pay (wage plus benefits) reasonable for the work actually done.",
        "Have a CPA or benefits attorney set it up — the rules for one-employee plans are technical (and the plan owes a small annual fee on Form 720).",
      ],
      proof: ["A written plan document, adopted and dated before the first reimbursement.", "Employment records: job description, timesheets, W-2, payroll filings.", "Reimbursement requests with receipts, paid from the business account.", "The insurance policy in the employee-spouse's name."],
      line: "It fails when the employment isn't real: a spouse who does little or nothing, is “paid” only in medical reimbursements, has no W-2, or a plan document created after the bills were paid. A policy bought in YOUR name stays under the ordinary self-employed rules. A spouse who is really a co-owner isn't an employee. And adding any second employee to the plan — including your own children on payroll — ends the one-employee exemption and can draw a $100-a-day excise tax, so write the plan to exclude them.",
      authority: ["IRC §105(b), §106(a), §162(a); Rev. Rul. 71-588", "IRC §9831(a)(2) (plans with fewer than two employee-participants)", "Shellito v. Commissioner, No. 10-9002 (10th Cir. 2011); Frahm v. Commissioner, T.C. Memo. 2007-351; Albers v. Commissioner, T.C. Memo. 2007-144"],
      deadline: dl("The plan must be adopted before the expenses you want covered", ""),
      needs: c.p.spouse === "" ? "Tell the tax profile whether a spouse works in the practice — this hides if not." : null,
    };
  });

  /* ================= Commonly missed ================= */

  idea(c => {
    const list = c.d.expenses.filter(e => e.reimbursable && e.reimbursed && e.deductible !== false);
    const amount = U.sum(list, e => (Number(e.amount) || 0) * Math.min(Math.max(e.businessUsePct == null ? 100 : Number(e.businessUsePct), 0), 100) / 100);
    if (amount < 1) return null;
    return {
      id: "reimbursed", icon: "↩️", tier: "assertive", group: "Commonly missed",
      title: "Deduct the job expenses your client reimbursed",
      summary: "When a client reimburses a job expense on your invoice, the reimbursement is part of what they pay you — and part of the Form 1099-NEC they send. The expense behind it is still your deduction. Leave it off and you pay income tax and self-employment tax on money that only passed through.",
      why: `${list.length} expense${list.length > 1 ? "s" : ""} in ${c.year} (${$(amount, true)}) ${list.length > 1 ? "are" : "is"} marked reimbursed. To avoid double-counting, this app leaves reimbursed expenses out of its deduction estimate — but the reimbursements are in your income. If your CPA works from these totals, that ${$(amount, true)} is being taxed as profit.`,
      est: { amount, savings: amount * c.rate.schedC, kind: "saves", note: "Applies where the reimbursement was reported as income (it is, when it's on your invoice and your 1099). If a client reimbursed you separately and left it off the 1099, there's nothing to deduct." },
      steps: [
        "Tell your CPA these expenses were reimbursed through invoices and are included in gross receipts — so they belong in Schedule C expenses.",
        "Compare the client's 1099-NEC with your invoices: if the total includes the reimbursements, deduct the expenses.",
        "Keep the receipt and the invoice line together for each one.",
      ],
      proof: ["The invoice showing the reimbursement line.", "The receipt for the underlying expense.", "The 1099-NEC, or your deposit records, showing the reimbursement was received as income."],
      line: "It works one way or the other, never both: either the reimbursement is income and the expense is deducted, or the reimbursement is left out of income and the expense isn't deducted. Deducting an expense whose reimbursement was never reported is a double dip.",
      authority: ["IRC §61(a) (gross income), §162(a)", "Schedule C instructions, line 1 (reconciling Forms 1099-NEC to gross receipts)"],
      deadline: dl("On the return", ""),
      cta: { label: "Show these expenses", route: "expenses", lists: { "exp-list": { filters: { yr: String(c.year), flag: "doubledip" } } } },
    };
  });

  idea(c => {
    const have = new Set(c.d.expenses.filter(e => (Number(e.amount) || 0) > 0).map(e => e.category));
    const checks = [
      [["Phone"], "Cell phone — the business-use share of the bill, measured by actual use (a sample month of call logs works)"],
      [["Internet"], "Home internet — the business-use share, in the books once (not also inside the home-office utilities)"],
      [["Professional Liability Insurance", "General Business Insurance"], "Professional liability (E&O), general liability, cyber and equipment insurance"],
      [["PE Registration Fees", "Licenses"], "PE licence renewals in every state, NCEES record fees, certificate-of-authority renewals"],
      [["Continuing Education"], "Continuing education, seminars and conferences — and the travel to them"],
      [["Professional Dues"], "Professional society dues (ASCE, NSPE, NAFE…) and the standards and code books you buy"],
      [["Software Subscriptions"], "Software and cloud storage: CAD, PDF, office suite, photo tools, weather-data reports, backup"],
      [["Accounting / Bookkeeping Fees", "Legal Fees"], "The business share of tax preparation, bookkeeping, legal and registered-agent fees"],
      [["Bank Fees", "Payment Processing Fees"], "Business bank and card fees"],
      [["Inspection Supplies", "Office Supplies"], "Field supplies and safety gear: hard hat, safety boots, harness, respirator, batteries, chalk, tape"],
      [["Meals"], "Business meals with adjusters, attorneys or the people who assign your work (50%) — only ones with a receipt and a business reason recorded at the time"],
      [["Postage", "Printing"], "Postage, shipping, printing and report binding"],
    ];
    const missing = checks.filter(([cats]) => !cats.some(k => have.has(k))).map(([, label]) => label);
    if (!missing.length) return null;
    return {
      id: "missed", icon: "🔎", tier: "standard", group: "Commonly missed",
      title: `${missing.length} everyday deduction${missing.length > 1 ? "s" : ""} with nothing logged this year`,
      summary: "Ordinary costs of running an engineering practice that tend to be paid personally and never make it into the books. Each one you really pay is deductible.",
      why: `Nothing has been entered in ${c.year} for: ` + missing.join("; ") + ".",
      est: null,
      steps: [
        "Go through one month of personal bank and card statements looking for each of these.",
        "Enter what you find as expenses with a business purpose; set the Business-Use % for anything shared with personal use.",
        "For phone and internet, base the percentage on something you can show, and write down how you worked it out.",
        "Small gifts to the people who send you work are deductible up to $25 per person per year.",
      ],
      proof: ["The bill or receipt, and proof you paid it.", "For mixed-use items, a note of how the business percentage was measured.", "For meals and gifts: who, where and the business reason, written at the time."],
      line: "Only the business share of a mixed-use cost is deductible — claiming 100% of your only phone or the household's only internet connection is deducting a personal expense. Clothing you could wear on a Saturday is personal even if bought for inspections. Education that qualifies you for a different profession isn't deductible. Your own lunch on a same-day trip is personal, and so are routine lunches with colleagues with no business purpose. Don't reconstruct meals or trips that weren't recorded.",
      authority: ["IRC §162(a) (ordinary and necessary); IRC §262 (personal expenses)", "Treas. Reg. §1.162-5 (education); Treas. Reg. §1.274-12 (business meals); IRC §274(b)(1) ($25 gifts)", "IRS Publication 334; IRS Publication 463"],
      deadline: yearEndDeadline(c),
      cta: { label: "Add an expense", route: "expenses", lists: { "exp-list": { filters: { yr: String(c.year) } } } },
    };
  });

  idea(c => ({
    id: "sponsorship", icon: "📣", tier: "aggressive", group: "Commonly missed",
    title: "Sponsorships placed with charities — advertising, when there's a real marketing return",
    summary: "A sole proprietor can't deduct charitable gifts on Schedule C. But a payment to a charity that buys real promotion aimed at people who can send you work — a sponsor line at an adjusters' association event, an ad in a claims-industry programme — is advertising: fully deductible on Schedule C, and it cuts self-employment tax.",
    why: "Almost all your work comes from one firm, so showing a reasonable expectation of business return matching what you paid is the weak point on audit. It works for placements in front of adjusters, attorneys and engineers; it doesn't for causes you simply care about.",
    est: null,
    steps: [
      "Choose placements whose audience can hire or refer a forensic engineer.",
      "Get it in writing: what you receive (logo, ad size, mentions, booth) and what it normally costs.",
      "Keep a copy of the ad or sponsor listing, and note any work it led to.",
      "Carve out anything bundled in: event tickets and golf aren't deductible at all; meals are 50%.",
    ],
    proof: ["The sponsorship agreement or invoice describing what was bought.", "A copy of the ad, programme or sponsor board.", "A note on the audience and any resulting contacts or jobs."],
    line: "A gift to your church, your children's school or team, or your alma mater — with no audience that could hire you and nothing received beyond a thank-you — is a charitable contribution, and booking it as advertising is deducting a personal expense. Only the part matched by an expected business return is advertising. Never ask a charity to re-paper a past donation as a sponsorship.",
    authority: ["Treas. Reg. §1.162-15(a) (T.D. 9907): a payment to a charity with a direct business relationship and a commensurate expected return is a business expense", "IRC §162(b); Marquis v. Commissioner, 49 T.C. 695 (1968)"],
    deadline: yearEndDeadline(c),
  }));

  /* =========================================================
     Protect what's already claimed — a deduction that can't be
     backed up is a deduction lost, plus a 20% penalty. These
     come straight from the same checks as the dashboard.
     ========================================================= */
  function protect(year) {
    const c = context(year);
    const ids = ["exp-missing-receipt", "exp-missing-purpose", "mi-missing-purpose", "exp-uncategorized", "wo-travel-choice", "ten99-mismatch"];
    const out = Alerts.runChecks(year).filter(k => ids.includes(k.id) && k.count > 0)
      .map(k => ({ id: k.id, icon: k.icon, title: k.title, sub: k.sub, count: k.count, route: k.route, action: k.action, list: k.list }));
    const meals = c.d.expenses.filter(e => e.category === "Meals" && e.deductible !== false && (e.businessUsePct == null || Number(e.businessUsePct) > 50));
    if (meals.length) {
      const over = U.sum(meals, e => Store.expenseDeductibleAmt(e)) / 2;
      out.push({ id: "meals-50", icon: "🍽️", title: "Meals counted at 100% — only 50% is deductible",
        sub: `The estimates in this app overstate your deductions by about ${$(over)}; your CPA applies the 50% limit on the return.`,
        count: meals.length, route: "expenses", list: { "exp-list": { filters: { yr: String(year), cat: "Meals" } } } });
    }
    return out;
  }

  /* ---------- the public result ---------- */
  function ideasFor(year) {
    const c = context(year);
    const out = [];
    for (const build of BUILDERS) {
      let it = null;
      try { it = build(c); } catch (e) { console.warn("Tax idea skipped:", e); }
      if (!it) continue;
      it.status = ideaStatus(c.year, it.id);
      if (it.est) { it.est.savings = Math.max(U.round2(it.est.savings || 0), 0); if (it.est.amount != null) it.est.amount = U.round2(it.est.amount); }
      if (it.deadline && it.deadline.date && c.current) it.deadline.daysLeft = U.daysBetween(c.today, it.deadline.date);
      out.push(it);
    }
    // an alternative steps aside once the idea it stands in for is under way
    const taken = new Set(out.filter(i => i.status === "done" || i.status === "plan").map(i => i.id));
    return { ctx: c, ideas: out.filter(i => !(i.altOf && taken.has(i.altOf) && !i.status)) };
  }

  /** Headline numbers for a year → {open, potential, deferral, locked, count, top}.
      potential: permanent savings still on the table (alternatives counted once);
      deferral: tax that could be pushed into next year; locked: marked done. */
  function summary(year) {
    return Store.cachedTurn("taxideas:" + Number(year), () => {
      const { ideas, ctx } = ideasFor(year);
      const live = ideas.filter(i => i.status !== "skip");
      const shown = new Set(live.map(i => i.id));
      const counts = i => i.est && !(i.altOf && shown.has(i.altOf));
      const open = live.filter(i => i.status !== "done");
      const sum = (list, kind) => U.round2(U.sum(list.filter(i => counts(i) && i.est.kind === kind), i => i.est.savings));
      return {
        year: ctx.year, count: ideas.length, open: open.length,
        potential: sum(open, "saves"), deferral: sum(open, "defers"),
        locked: U.round2(U.sum(live.filter(i => i.status === "done" && counts(i) && i.est.kind !== "defers"), i => i.est.savings)),
        top: U.sortBy(open.filter(i => counts(i) && i.est.kind === "saves"), i => i.est.savings, -1)[0] || null,
      };
    });
  }

  const TIERS = {
    standard:   { label: "Standard",   color: "green", blurb: "Routine. Rarely questioned when it's documented." },
    assertive:  { label: "Assertive",  color: "amber", blurb: "Clearly allowed, often missed, commonly looked at. The paperwork is what wins." },
    aggressive: { label: "Aggressive", color: "red",   blurb: "Defensible, with real audit exposure. Holds only if the facts and records are in place — get your CPA's sign-off first." },
  };

  return { LIMITS, limitsFor, TIERS, profile, yearFacts, saveProfile, saveYearFacts, ideaStatus, setIdeaStatus, context, ideasFor, summary, protect, PROFILE_DEFAULTS };
})();
