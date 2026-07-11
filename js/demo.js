/* =========================================================
   demo.js — sample data so the app is explorable on first run.
   Load / clear from Settings. All demo records are normal
   records; clearing resets the whole store.
   ========================================================= */
"use strict";

const Demo = (() => {

  function load() {
    const S = Store.state;
    const y = S.settings.taxYear || new Date().getFullYear();
    const D = (m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const now = U.nowISO();
    const mk = (prefix) => U.uid(prefix);

    /* ---- Clients ---- */
    const c1 = { id: mk("cl"), createdAt: now, updatedAt: now, name: "Keystone Claims Group", contactName: "Dana Whitfield", email: "dwhitfield@keystoneclaims.example", phone: "412-555-0142", billingAddress: "800 Liberty Ave, Suite 1200\nPittsburgh, PA 15222", defaultHourlyRate: 185, defaultFlatFee: 1450, paymentTerms: "Net 30", remittanceInstructions: "Upload invoice PDF to COR portal with report.", expects1099: true, w9Provided: true, notes: "High volume carrier work. Wind/hail focus.", cpaNotes: "" };
    const c2 = { id: mk("cl"), createdAt: now, updatedAt: now, name: "Meridian Adjusting Services", contactName: "Rob Castellano", email: "rcastellano@meridianadj.example", phone: "215-555-0177", billingAddress: "1650 Market St, Philadelphia, PA 19103", defaultHourlyRate: 195, defaultFlatFee: 1600, paymentTerms: "Net 45", remittanceInstructions: "Email invoice to ap@meridianadj.example, reference claim #.", expects1099: true, w9Provided: true, notes: "Slower payer — follow up at 30 days.", cpaNotes: "" };
    const c3 = { id: mk("cl"), createdAt: now, updatedAt: now, name: "Hartwell & Boyce LLP", contactName: "Elaine Boyce", email: "eboyce@hartwellboyce.example", phone: "610-555-0155", billingAddress: "40 W Chestnut St, West Chester, PA 19380", defaultHourlyRate: 250, defaultFlatFee: 0, paymentTerms: "Net 30", remittanceInstructions: "Mail check; W-9 on file.", expects1099: true, w9Provided: false, notes: "Attorney client — expert consulting, hourly only.", cpaNotes: "" };
    S.clients.push(c1, c2, c3);

    /* ---- Work orders ---- */
    const woDefaults = { fieldEngineer: "B. Anstett, PE", peNumber: "PE-088214", coaNumber: "COA-4471", feeType: "Flat Fee", mileageAllowed: true, mileageAmount: "IRS rate", serviceType: "Forensic Engineering Report" };
    const w1 = { id: mk("wo"), createdAt: now, updatedAt: now, ...woDefaults, woNumber: `WO-${y}-041`, projectNumber: "KCG-7731", clientId: c1.id, status: "Paid", dateAssigned: D(2, 3), insuranceCarrier: "Allied Mutual", claimNumber: "AM-55-118842", policyNumber: "HO-3312907", catNumber: "", dateOfLoss: D(1, 9), jobType: "Wind", residentialCommercial: "Residential", insuredName: "Gerald & Marie Kowalski", insuredPhone: "724-555-0136", lossLocation: "218 Orchard Ln, Greensburg, PA 15601", descriptionOfLoss: "Wind event; shingle displacement and interior water staining reported.", descriptionOfProperty: "Two-story wood-frame dwelling, asphalt shingle roof, ~2,400 SF.", scopeOfService: "Determine cause and extent of roof damage; differentiate wind vs. wear.", inspectionDate: D(2, 12), reportDueDate: D(2, 26), reportSubmittedDate: D(2, 24), invoiceDate: D(2, 24), paymentDate: D(3, 20), flatFee: 1450, hourlyRate: 185, estimatedHours: 8, actualHours: 7.5, parkingTolls: 12, reportRemittance: "Upload PDF to COR system.", uploadLocation: "COR system", internalNotes: "Straightforward wind claim; good photos." };
    const w2 = { id: mk("wo"), createdAt: now, updatedAt: now, ...woDefaults, woNumber: `WO-${y}-052`, projectNumber: "KCG-7802", clientId: c1.id, status: "Submitted", dateAssigned: D(4, 14), insuranceCarrier: "Allied Mutual", claimNumber: "AM-55-120277", policyNumber: "HO-4415520", catNumber: "CAT-2211 (April hail)", dateOfLoss: D(4, 2), jobType: "Hail", residentialCommercial: "Residential", insuredName: "T. Nguyen", lossLocation: "77 Fernwood Dr, Cranberry Twp, PA 16066", descriptionOfLoss: "Hail impact to roof and aluminum siding; gutters dented.", scopeOfService: "Hail damage assessment; roof and envelope inspection with test squares.", inspectionDate: D(4, 22), reportDueDate: D(5, 6), reportSubmittedDate: D(5, 4), flatFee: 1450, hourlyRate: 185, actualHours: 8, internalNotes: "Report submitted — INVOICE STILL NEEDED." };
    const w3 = { id: mk("wo"), createdAt: now, updatedAt: now, ...woDefaults, woNumber: `WO-${y}-057`, projectNumber: "MAS-2216", clientId: c2.id, status: "Invoiced", dateAssigned: D(5, 2), insuranceCarrier: "Provident Property & Casualty", claimNumber: "PPC-90-33121", dateOfLoss: D(4, 29), jobType: "Water", residentialCommercial: "Commercial", insuredName: "Bella Vista Ristorante LLC", lossLocation: "1421 Federal St, Pittsburgh, PA 15212", descriptionOfLoss: "Second-floor supply line failure; ceiling collapse in dining room.", descriptionOfProperty: "Two-story masonry commercial building, c. 1940.", scopeOfService: "Structural assessment of water-damaged framing and ceiling; repairability opinion.", inspectionDate: D(5, 9), reportDueDate: D(5, 23), reportSubmittedDate: D(5, 21), invoiceDate: D(5, 22), flatFee: 1600, hourlyRate: 195, actualHours: 10, parkingTolls: 18, internalNotes: "Parking garage receipts saved." };
    const w4 = { id: mk("wo"), createdAt: now, updatedAt: now, ...woDefaults, woNumber: `WO-${y}-063`, projectNumber: "KCG-7920", clientId: c1.id, status: "Scheduled", dateAssigned: D(6, 18), insuranceCarrier: "Allied Mutual", claimNumber: "AM-55-124903", dateOfLoss: D(6, 10), jobType: "Vehicle Impact", residentialCommercial: "Residential", insuredName: "P. Okafor", lossLocation: "9 Ridgeview Ct, Butler, PA 16001", descriptionOfLoss: "Vehicle struck attached garage; header and jamb displacement.", scopeOfService: "Structural evaluation of garage framing and foundation at impact area.", inspectionDate: D(7, 9), reportDueDate: D(7, 23), flatFee: 1450, internalNotes: "Insured prefers morning appointment." };
    const w5 = { id: mk("wo"), createdAt: now, updatedAt: now, ...woDefaults, woNumber: `WO-${y}-065`, projectNumber: "HB-EXP-114", clientId: c3.id, status: "Report Drafting", dateAssigned: D(6, 24), feeType: "Hourly", hourlyRate: 250, estimatedHours: 20, actualHours: 9, jobType: "Structural", residentialCommercial: "Commercial", insuredName: "(Litigation — Chestnut Partners)", lossLocation: "1200 Chestnut St, Philadelphia, PA", descriptionOfLoss: "Alleged construction defect; facade cracking at brick veneer.", scopeOfService: "Document review, site observation, and expert opinion letter.", reportDueDate: D(7, 31), attorneyContact: "Elaine Boyce, Esq.", attorneyPhoneEmail: "610-555-0155 / eboyce@hartwellboyce.example", internalNotes: "Track hours carefully — hourly engagement.", mileageAllowed: false };
    const w6 = { id: mk("wo"), createdAt: now, updatedAt: now, ...woDefaults, woNumber: `WO-${y}-066`, projectNumber: "KCG-7944", clientId: c1.id, status: "New", dateAssigned: D(7, 2), insuranceCarrier: "Allied Mutual", claimNumber: "AM-55-125511", dateOfLoss: D(6, 28), jobType: "Roof", residentialCommercial: "Residential", insuredName: "S. Delgado", lossLocation: "310 Maple Ave, Beaver, PA 15009", descriptionOfLoss: "Reported storm-related roof leak over kitchen.", scopeOfService: "Roof inspection; determine cause of leak (storm vs. maintenance).", reportDueDate: D(7, 30), flatFee: 1450 };
    S.workOrders.push(w6, w5, w4, w3, w2, w1);

    /* ---- Invoices ---- */
    const i1 = { id: mk("in"), createdAt: now, updatedAt: now, invoiceNumber: `INV-${y}-009`, clientId: c1.id, workOrderId: w1.id, invoiceDate: D(2, 24), dueDate: D(3, 26), status: "Paid", serviceDescription: `Forensic engineering report — wind damage assessment, claim AM-55-118842 (${w1.woNumber})`, feeType: "Flat Fee", flatFee: 1450, mileageReimb: 46.20, expenseReimb: 12, otherCharges: 0, amountPaid: 1508.20, paymentDate: D(3, 20), paymentMethod: "ACH / Direct Deposit", notes: "" };
    const i2 = { id: mk("in"), createdAt: now, updatedAt: now, invoiceNumber: `INV-${y}-014`, clientId: c2.id, workOrderId: w3.id, invoiceDate: D(5, 22), dueDate: D(7, 6), status: "Sent", serviceDescription: `Structural assessment — water loss, claim PPC-90-33121 (${w3.woNumber})`, feeType: "Flat Fee", flatFee: 1600, mileageReimb: 39.90, expenseReimb: 18, amountPaid: 0, notes: "Emailed to AP 5/22." };
    const i3 = { id: mk("in"), createdAt: now, updatedAt: now, invoiceNumber: `INV-${y}-006`, clientId: c2.id, workOrderId: null, invoiceDate: D(1, 28), dueDate: D(3, 14), status: "Overdue", serviceDescription: "Document review and desk consult — claim PPC-90-31007", feeType: "Hourly", hours: 4, rate: 195, amountPaid: 0, notes: "Two follow-ups sent. Escalate to Rob." };
    S.invoices.push(i1, i2, i3);

    /* ---- Income ---- */
    S.income.push(
      { id: mk("ic"), createdAt: now, updatedAt: now, date: D(3, 20), clientId: c1.id, amount: 1508.20, paymentMethod: "ACH / Direct Deposit", invoiceId: i1.id, workOrderId: w1.id, serviceType: "Forensic Engineering Report", category: "Service Income (1099)", is1099: true, notes: "" },
      { id: mk("ic"), createdAt: now, updatedAt: now, date: D(1, 16), clientId: c1.id, amount: 1450, paymentMethod: "ACH / Direct Deposit", serviceType: "Forensic Engineering Report", category: "Service Income (1099)", is1099: true, notes: `December ${y - 1} report, paid in January.` },
      { id: mk("ic"), createdAt: now, updatedAt: now, date: D(4, 8), clientId: c3.id, amount: 2250, paymentMethod: "Check", serviceType: "Expert Consulting", category: "Consulting Income", is1099: true, notes: "Retainer draw — Chestnut Partners matter." },
      { id: mk("ic"), createdAt: now, updatedAt: now, date: D(5, 30), clientId: null, sourceOther: "Equipment sale — old moisture meter", amount: 150, paymentMethod: "Cash", category: "Other Business Income", is1099: false, cpaReview: true, notes: "Sold old Protimeter — ask CPA how to report.", auditNotes: "" },
    );

    /* ---- Expenses ---- */
    const E = (m, d, vendor, amount, category, purpose, extra = {}) => ({
      id: mk("ex"), createdAt: now, updatedAt: now, date: D(m, d), vendor, amount, category,
      businessPurpose: purpose, paymentMethod: "Credit Card", receiptStatus: "Referenced",
      receiptRef: `Receipts/${y}/${vendor.replace(/\W+/g, "")}_${m}-${d}.jpg`, deductible: true, businessUsePct: 100, ...extra,
    });
    S.expenses.push(
      E(1, 5, "PA State Board of Engineers", 100, "PE Registration Fees", "Biennial PE license renewal"),
      E(1, 12, "Hiscox", 1980, "Professional Liability Insurance", "Annual E&O policy for engineering practice"),
      E(2, 2, "Adobe", 22.99, "Software Subscriptions", "Acrobat Pro for report PDFs — monthly"),
      E(2, 12, "Parkway Garage", 12, "Parking", "Parking at Kowalski inspection (WO-041)", { workOrderId: w1.id, clientId: c1.id, reimbursable: true, reimbursed: true }),
      E(3, 3, "B&H Photo", 1249, "Cameras / Photo Equipment", "Mirrorless camera for inspection photography", { cpaReview: true, auditNotes: "Possible Sec. 179 — see Assets." }),
      E(3, 18, "Verizon", 95, "Phone", "Business line — monthly", { businessUsePct: 80, receiptStatus: "Not Required", sourceRef: "Verizon autopay, card 4412" }),
      E(4, 22, "Sunoco", 48.30, "Vehicle — Fuel (actual method)", "", { receiptStatus: "Missing", notes: "Grabbed fuel on the Nguyen hail trip — need receipt & purpose.", cpaReview: false }),
      E(5, 9, "Grant St Garage", 18, "Parking", "Parking at Bella Vista inspection (WO-057)", { workOrderId: w3.id, clientId: c2.id, reimbursable: true, reimbursed: false }),
      E(5, 15, "Staples", 64.75, "Office Supplies", "Report binding, toner, paper"),
      E(6, 1, "AISC", 249, "Professional Dues", "Annual membership — steel construction institute"),
      E(6, 14, "Home Depot", 89.97, "Inspection Supplies", "Chalk, pitch gauge, shingle samples bag"),
      E(6, 20, "GoDaddy", 21.17, "Website / Domain / Hosting", "Domain + email hosting — monthly"),
    );

    /* ---- Mileage ---- */
    const M = (m, d, dest, miles, purpose, extra = {}) => ({
      id: mk("mi"), createdAt: now, updatedAt: now, date: D(m, d), tripType: "Inspection",
      startLocation: "Home office", destination: dest, businessPurpose: purpose,
      roundTrip: true, miles, reimbursable: true, ...extra,
    });
    S.mileage.push(
      M(2, 12, "218 Orchard Ln, Greensburg PA", 66, "Roof inspection — Kowalski wind claim (WO-041)", { clientId: c1.id, workOrderId: w1.id, reimbursed: true, parking: 12 }),
      M(4, 22, "77 Fernwood Dr, Cranberry Twp PA", 58, "Hail inspection — Nguyen (WO-052)", { clientId: c1.id, workOrderId: w2.id }),
      M(5, 9, "1421 Federal St, Pittsburgh PA", 57, "Structural inspection — Bella Vista water loss (WO-057)", { clientId: c2.id, workOrderId: w3.id, parking: 18 }),
      M(5, 15, "Staples, Cranberry Twp", 14, "Office supply run — report materials", { tripType: "Supply Run", reimbursable: false }),
      M(6, 25, "", 42, "", { tripType: "Inspection", reimbursable: false, notes: "Forgot to log details — fill in destination & purpose!" }),
    );

    /* ---- Receipts ---- */
    S.receipts.push(
      { id: mk("rc"), createdAt: now, updatedAt: now, date: D(3, 3), vendor: "B&H Photo", amount: 1249, status: "Referenced", reference: `Receipts/${y}/BHPhoto_camera.pdf`, paymentMethod: "Credit Card", notes: "Camera — also listed under Assets." },
      { id: mk("rc"), createdAt: now, updatedAt: now, date: D(5, 9), vendor: "Grant St Garage", amount: 18, status: "Referenced", reference: `Receipts/${y}/GrantStGarage.jpg`, workOrderId: w3.id, paymentMethod: "Credit Card" },
    );

    /* ---- Assets ---- */
    S.assets.push(
      { id: mk("as"), createdAt: now, updatedAt: now, purchaseDate: D(3, 3), name: "Mirrorless camera (24MP) + lens", vendor: "B&H Photo", cost: 1249, category: "Camera", businessUsePct: 100, status: "Active", receiptRef: `Receipts/${y}/BHPhoto_camera.pdf`, askCpaDepreciation: true, depreciationStatus: "Not Reviewed", notes: "Used exclusively for inspection photography." },
      { id: mk("as"), createdAt: now, updatedAt: now, purchaseDate: `${y - 1}-09-14`, name: "Tramex MEP moisture meter", vendor: "Tramex", cost: 585, category: "Moisture Meter", businessUsePct: 100, status: "Active", askCpaDepreciation: true, depreciationStatus: "CPA Reviewed", notes: `Expensed in ${y - 1} per CPA.` },
      { id: mk("as"), createdAt: now, updatedAt: now, purchaseDate: `${y - 2}-05-02`, name: "Little Giant 22' ladder", vendor: "Home Depot", cost: 379, category: "Ladder", businessUsePct: 100, status: "Active", askCpaDepreciation: false, depreciationStatus: "Expensed (per CPA)" },
    );

    /* ---- Contractor ---- */
    S.contractors.push({
      id: mk("ct"), createdAt: now, updatedAt: now, name: "Marcus Lee", businessName: "Lee Drone Imaging LLC",
      email: "marcus@leedrone.example", phone: "878-555-0129", address: "Pittsburgh, PA",
      tinNote: "W-9 requested 6/10 — not yet received", w9Received: false, may1099: true, cpaReview: true,
      notes: "Drone roof photos on steep-slope jobs.",
      payments: [
        { id: mk("cp"), date: D(4, 25), amount: 350, paymentMethod: "Zelle", workOrderId: w2.id, notes: "Drone photos — Nguyen roof" },
        { id: mk("cp"), date: D(6, 2), amount: 300, paymentMethod: "Zelle", notes: "Drone photos — marketing shoot" },
      ],
    });

    /* ---- Tax payments ---- */
    S.taxPayments.push(
      { id: mk("tp"), createdAt: now, updatedAt: now, date: D(4, 12), taxYear: y, quarter: "Q1", jurisdiction: "Federal (IRS)", amount: 900, method: "IRS Direct Pay", confirmation: "DP-88213307", notes: "" },
      { id: mk("tp"), createdAt: now, updatedAt: now, date: D(4, 12), taxYear: y, quarter: "Q1", jurisdiction: "State", amount: 210, method: "State Portal", confirmation: "PA-4471190", notes: "" },
      { id: mk("tp"), createdAt: now, updatedAt: now, date: D(6, 13), taxYear: y, quarter: "Q2", jurisdiction: "Federal (IRS)", amount: 950, method: "IRS Direct Pay", confirmation: "DP-90114772", notes: "" },
    );

    /* ---- Home office ---- */
    Object.assign(S.homeOffice, {
      usedRegularlyExclusively: true, officeSqFt: 168, homeSqFt: 2350,
      utilities: 210, internet: 75, insurance: 0, repairs: 0,
      mortgageInterestRentNote: "See Form 1098 from lender — provide to CPA.",
      propertyTaxNote: "County + school tax bills in Tax Docs folder.",
      cpaNotes: "Confirm simplified vs. actual method.", cpaReview: true, updatedAt: now,
    });

    /* ---- 1099 tracker ---- */
    S.form1099s.push({ id: mk("f9"), clientId: c1.id, taxYear: y - 1, expected: true, received: true, amountReceived: 14650, notes: `Matches ${y - 1} records.` });

    S.demoDataLoaded = true;
    Store.logAudit("created", "settings", { id: "demo" }, [{ field: "demoData", from: "", to: "loaded" }]);
    Store.save();
  }

  return { load };
})();
