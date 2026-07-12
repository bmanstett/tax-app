/* =========================================================
   schemas.js — entity field definitions, categories, statuses.
   These drive form generation, list rendering, and exports.
   ========================================================= */
"use strict";

const SCHEMA = {};

/* ---------- Status vocabularies (label → badge color) ---------- */
SCHEMA.workOrderStatuses = [
  { value: "New",             color: "blue" },
  { value: "Review Documents",color: "purple" },
  { value: "Scheduled",       color: "teal" },
  { value: "Inspected",       color: "accent" },
  { value: "Report Drafting", color: "amber" },
  { value: "Submitted",       color: "purple" },
  { value: "Invoiced",        color: "blue" },
  { value: "Paid",            color: "green" },
  { value: "Closed",          color: "slate" },
  { value: "Cancelled",       color: "red" },
];
SCHEMA.woOpenStatuses = ["New", "Review Documents", "Scheduled", "Inspected", "Report Drafting"];

SCHEMA.invoiceStatuses = [
  { value: "Draft",       color: "slate" },
  { value: "Sent",        color: "blue" },
  { value: "Partial",     color: "amber" },
  { value: "Paid",        color: "green" },
  { value: "Overdue",     color: "red" },
  { value: "Written Off", color: "slate" },
];

SCHEMA.assetStatuses = [
  { value: "Active",   color: "green" },
  { value: "Sold",     color: "blue" },
  { value: "Disposed", color: "slate" },
  { value: "Replaced", color: "amber" },
];

SCHEMA.receiptStatuses = [
  { value: "Attached",         color: "green" },
  { value: "Referenced",       color: "blue" },
  { value: "Missing",          color: "red" },
  { value: "Not Required",     color: "slate" },
  { value: "Needs CPA Review", color: "amber" },
];

SCHEMA.statusColor = (list, value) => (list.find(s => s.value === value) || {}).color || "slate";

/* ---------- Pick lists ---------- */
SCHEMA.jobTypes = ["Wind", "Hail", "Water", "Fire", "Structural", "Vehicle Impact", "Snow/Ice", "Roof",
  "Building Envelope", "Foundation", "Collapse", "Lightning", "Plumbing", "Mold/Moisture", "Other"];

SCHEMA.serviceTypes = ["Forensic Engineering Report", "Engineering Consulting", "Forensic Inspection",
  "Report Writing", "Expert Consulting", "Property Inspection", "Claim Support", "Building-Envelope Review",
  "Roof Inspection", "Structural Observation", "Document Review", "Field Investigation", "Expert Testimony",
  "Other Professional Engineering Services"];

SCHEMA.feeTypes = ["Flat Fee", "Hourly", "T&E", "Do-Not-Exceed Budget"];

SCHEMA.paymentMethods = ["ACH / Direct Deposit", "Check", "Credit Card", "Debit Card", "Zelle", "PayPal",
  "Venmo", "Wire Transfer", "Cash", "Other"];

SCHEMA.tripTypes = ["Inspection", "Client Meeting", "Supply Run", "Administrative", "Training", "Other"];

SCHEMA.incomeCategories = ["Service Income (1099)", "Service Income (Invoiced)", "Consulting Income",
  "Expert Testimony", "Reimbursement Received", "Interest Income", "Other Business Income"];

SCHEMA.paymentTermsOptions = ["Due on Receipt", "Net 15", "Net 30", "Net 45", "Net 60"];

/* ---------- Expense categories → Schedule C-style mapping ----------
   scheduleC is the *organizer line* the CPA will map to; the app does
   not decide final deductibility. */
SCHEMA.expenseCategories = [
  { name: "Office Supplies",               scheduleC: "Supplies (Line 22)" },
  { name: "Inspection Supplies",           scheduleC: "Supplies (Line 22)" },
  { name: "Engineering Tools",             scheduleC: "Supplies (Line 22) / Depreciation review" },
  { name: "Measuring Equipment",           scheduleC: "Supplies (Line 22) / Depreciation review" },
  { name: "Cameras / Photo Equipment",     scheduleC: "Supplies (Line 22) / Depreciation review" },
  { name: "Computer Equipment",            scheduleC: "Depreciation / Sec. 179 review (Line 13)" },
  { name: "Software Subscriptions",        scheduleC: "Other Expenses (Line 27a)" },
  { name: "Phone",                         scheduleC: "Utilities (Line 25) — business-use %" },
  { name: "Internet",                      scheduleC: "Utilities (Line 25) — business-use %" },
  { name: "Home Office Expenses",          scheduleC: "Form 8829 / Simplified method — CPA review" },
  { name: "Professional Liability Insurance", scheduleC: "Insurance (Line 15)" },
  { name: "General Business Insurance",    scheduleC: "Insurance (Line 15)" },
  { name: "Licenses",                      scheduleC: "Taxes & Licenses (Line 23)" },
  { name: "PE Registration Fees",          scheduleC: "Taxes & Licenses (Line 23)" },
  { name: "Business Registration Fees",    scheduleC: "Taxes & Licenses (Line 23)" },
  { name: "Continuing Education",          scheduleC: "Other Expenses (Line 27a)" },
  { name: "Professional Dues",             scheduleC: "Other Expenses (Line 27a)" },
  { name: "Legal Fees",                    scheduleC: "Legal & Professional (Line 17)" },
  { name: "Accounting / Bookkeeping Fees", scheduleC: "Legal & Professional (Line 17)" },
  { name: "Advertising & Marketing",       scheduleC: "Advertising (Line 8)" },
  { name: "Website / Domain / Hosting",    scheduleC: "Advertising (Line 8) / Other (27a)" },
  { name: "Printing",                      scheduleC: "Office Expense (Line 18)" },
  { name: "Postage",                       scheduleC: "Office Expense (Line 18)" },
  { name: "Travel",                        scheduleC: "Travel (Line 24a)" },
  { name: "Meals",                         scheduleC: "Meals (Line 24b) — generally 50%, CPA review" },
  { name: "Parking",                       scheduleC: "Car & Truck (Line 9)" },
  { name: "Tolls",                         scheduleC: "Car & Truck (Line 9)" },
  { name: "Vehicle — Fuel (actual method)",     scheduleC: "Car & Truck (Line 9) — actual method only" },
  { name: "Vehicle — Repairs/Maint. (actual method)", scheduleC: "Car & Truck (Line 9) — actual method only" },
  { name: "Bank Fees",                     scheduleC: "Other Expenses (Line 27a)" },
  { name: "Payment Processing Fees",       scheduleC: "Commissions & Fees (Line 10)" },
  { name: "Business Taxes & Licenses",     scheduleC: "Taxes & Licenses (Line 23)" },
  { name: "Contractors / Subcontractors",  scheduleC: "Contract Labor (Line 11) — 1099 review" },
  { name: "Equipment / Assets (may need depreciation)", scheduleC: "Depreciation / Sec. 179 review (Line 13)" },
  { name: "Miscellaneous Business",        scheduleC: "Other Expenses (Line 27a)" },
];
SCHEMA.expenseCategoryNames = SCHEMA.expenseCategories.map(c => c.name);
SCHEMA.scheduleCFor = name => (SCHEMA.expenseCategories.find(c => c.name === name) || {}).scheduleC || "Uncategorized — needs review";

/** Categories that suggest depreciation / Sec. 179 review when large */
SCHEMA.assetLikeCategories = ["Computer Equipment", "Engineering Tools", "Measuring Equipment",
  "Cameras / Photo Equipment", "Equipment / Assets (may need depreciation)"];

SCHEMA.assetCategories = ["Laptop / Computer", "Camera", "Drone", "Measuring Tools", "Moisture Meter",
  "Ladder", "Printer / Scanner", "Phone", "Office Furniture", "Software License", "Engineering Equipment",
  "Vehicle", "Other"];

/* ---------- IRS quarterly estimated tax due dates (typical) ---------- */
SCHEMA.quarterDueDates = year => ([
  { q: "Q1", period: `Jan 1 – Mar 31, ${year}`, due: `${year}-04-15` },
  { q: "Q2", period: `Apr 1 – May 31, ${year}`, due: `${year}-06-15` },
  { q: "Q3", period: `Jun 1 – Aug 31, ${year}`, due: `${year}-09-15` },
  { q: "Q4", period: `Sep 1 – Dec 31, ${year}`, due: `${year + 1}-01-15` },
]);

/* =========================================================
   Field definitions per entity — drive FormBuilder.
   type: text|number|money|percent|date|select|textarea|checkbox|
         client|workorder|invoice|expenseCategory
   ========================================================= */

const F = (key, label, type = "text", extra = {}) => ({ key, label, type, ...extra });

SCHEMA.fields = {};

/* ---------- Work Order ---------- */
SCHEMA.fields.workOrder = [
  F("_s1", "Assignment", "section"),
  F("woNumber", "Work Order #", "text", { required: true, placeholder: "WO-2026-014" }),
  F("projectNumber", "Project #", "text"),
  F("dateAssigned", "Date Assigned", "date", { default: () => U.todayISO() }),
  F("status", "Status", "select", { options: SCHEMA.workOrderStatuses.map(s => s.value), default: "New", required: true }),
  F("clientId", "Client / Company", "client", { required: true }),
  F("fieldEngineer", "Field Engineer", "text", { defaultFromSettings: "engineerName" }),
  F("peNumber", "PE Number", "peNumber", {
    hint: "Manage state-specific PE numbers in Settings",
    default: () => {
      const pes = (Store.state.settings.peNumbers || []).filter(p => p.number);
      return pes.length === 1 ? pes[0].number : (Store.state.settings.peNumber || "");
    } }),
  F("coaNumber", "Company Certificate / COA #", "text", { defaultFromSettings: "coaNumber" }),

  F("_s2", "Claim Information", "section"),
  F("insuranceCarrier", "Insurance Carrier", "text"),
  F("carrierContact", "Carrier / Client Contact", "text"),
  F("carrierContactPhone", "Carrier Contact Phone", "tel"),
  F("claimNumber", "Claim #", "text"),
  F("policyNumber", "Policy #", "text"),
  F("catNumber", "CAT Name / #", "text"),
  F("dateOfLoss", "Date of Loss", "date"),
  F("jobType", "Job Type (peril)", "select", { options: SCHEMA.jobTypes }),
  F("serviceType", "Service Type", "select", { options: SCHEMA.serviceTypes, default: "Forensic Engineering Report" }),
  F("residentialCommercial", "Property Class", "select", { options: ["Residential", "Commercial", "Mixed-Use", "Other"] }),

  F("_s3", "Insured / Property", "section"),
  F("insuredName", "Insured Name", "text"),
  F("insuredContact", "Insured Contact Name", "text"),
  F("insuredPhone", "Insured Phone", "tel"),
  F("insuredEmail", "Insured Email", "email"),
  F("lossLocation", "Loss Location Address", "textarea", { span2: true }),
  F("descriptionOfLoss", "Description of Loss", "textarea", { span2: true }),
  F("descriptionOfProperty", "Description of Property", "textarea", { span2: true }),
  F("scopeOfService", "Scope of Service", "textarea", { span2: true }),
  F("additionalNotes", "Additional Notes / Instructions", "textarea", { span2: true }),

  F("_s4", "Other Parties", "section"),
  F("paContact", "Public Adjuster Contact", "text"),
  F("paPhoneEmail", "Public Adjuster Phone / Email", "text"),
  F("attorneyContact", "Attorney Contact", "text"),
  F("attorneyPhoneEmail", "Attorney Phone / Email", "text"),

  F("_s5", "Schedule", "section"),
  F("inspectionDate", "Inspection Date", "date"),
  F("reportDueDate", "Report Due Date", "date"),
  F("reportSubmittedDate", "Report Submitted", "date"),
  F("invoiceDate", "Invoice Date", "date"),
  F("paymentDate", "Payment Date", "date"),

  F("_s6", "Fees & Reimbursables", "section"),
  F("feeType", "Fee Type", "select", { options: SCHEMA.feeTypes, default: "Flat Fee" }),
  F("flatFee", "Flat Fee Amount", "money", { showIf: r => r.feeType === "Flat Fee" || r.feeType === "Do-Not-Exceed Budget" }),
  F("hourlyRate", "Hourly Rate", "money", { defaultFromSettings: "defaultHourlyRate" }),
  F("estimatedHours", "Estimated Hours", "number", { step: 0.25 }),
  F("actualHours", "Actual Hours", "number", { step: 0.25 }),
  F("mileageAllowed", "Mileage Reimbursable?", "checkbox"),
  F("mileageReimbType", "Mileage Reimbursed As", "select", { options: ["Per mile (IRS/agreed rate)", "Flat fee"], default: "Per mile (IRS/agreed rate)", showIf: r => !!r.mileageAllowed }),
  F("mileageFlatFee", "Mileage Flat Fee Amount", "money", { showIf: r => !!r.mileageAllowed && r.mileageReimbType === "Flat fee" }),
  F("mileageAmount", "Mileage Rate Note", "text", { placeholder: "e.g. IRS rate, $0.70/mi, cap 145 mi", showIf: r => !!r.mileageAllowed && r.mileageReimbType !== "Flat fee" }),
  F("parkingTolls", "Parking / Tolls Budget", "money"),

  F("_s7", "Remittance & Delivery", "section"),
  F("reportRemittance", "Report Remittance Instructions", "textarea", { span2: true, placeholder: "e.g. upload PDF to COR system, email to claims@…" }),
  F("invoiceRemittance", "Invoice Remittance Instructions", "textarea", { span2: true }),
  F("uploadLocation", "Upload Location / System", "text", { placeholder: "e.g. COR system, client portal" }),
  F("signatureName", "Engineer Signature (name)", "text"),
  F("signatureDate", "Signature Date", "date"),

  F("_s8", "Notes & Review", "section"),
  F("internalNotes", "Internal Notes", "textarea", { span2: true }),
  F("cpaNotes", "CPA Notes", "textarea", { span2: true }),
  F("auditNotes", "Audit Notes", "textarea", { span2: true }),
  F("cpaReview", "Flag for CPA review", "checkbox"),
];

/* ---------- Client ---------- */
SCHEMA.fields.client = [
  F("_s1", "Client", "section"),
  F("name", "Client / Company Name", "text", { required: true }),
  F("contactName", "Contact Name", "text"),
  F("email", "Email", "email"),
  F("phone", "Phone", "tel"),
  F("billingAddress", "Billing Address", "textarea", { span2: true }),

  F("_s2", "Defaults", "section"),
  F("defaultHourlyRate", "Default Hourly Rate", "money"),
  F("defaultFlatFee", "Default Flat Fee", "money"),
  F("paymentTerms", "Default Payment Terms", "select", { options: SCHEMA.paymentTermsOptions, default: "Net 30" }),
  F("remittanceInstructions", "Default Invoice / Remittance Instructions", "textarea", { span2: true }),

  F("_s3", "1099 / Tax", "section"),
  F("expects1099", "1099 expected from this client", "checkbox", { hint: "Typically clients paying $600+/yr for services" }),
  F("w9Provided", "W-9 provided to this client", "checkbox"),

  F("_s4", "Notes", "section"),
  F("notes", "Notes", "textarea", { span2: true }),
  F("cpaNotes", "CPA Notes", "textarea", { span2: true }),
];

/* ---------- Invoice ---------- */
SCHEMA.fields.invoice = [
  F("_s1", "Invoice", "section"),
  F("invoiceNumber", "Invoice #", "text", { required: true }),
  F("clientId", "Client", "client", { required: true }),
  F("workOrderId", "Linked Work Order", "workorder"),
  F("invoiceDate", "Invoice Date", "date", { default: () => U.todayISO(), required: true }),
  F("dueDate", "Due Date", "date"),
  F("status", "Status", "select", { options: SCHEMA.invoiceStatuses.map(s => s.value), default: "Draft", required: true }),
  F("serviceDescription", "Service Description", "textarea", { span2: true }),

  F("_s2", "Amounts", "section"),
  F("feeType", "Billing Basis", "select", { options: ["Flat Fee", "Hourly"], default: "Flat Fee" }),
  F("flatFee", "Flat Fee", "money", { showIf: r => r.feeType !== "Hourly" }),
  F("hours", "Hours", "number", { step: 0.25, showIf: r => r.feeType === "Hourly" }),
  F("rate", "Hourly Rate", "money", { showIf: r => r.feeType === "Hourly" }),
  F("mileageReimb", "Mileage Reimbursement", "money"),
  F("expenseReimb", "Expense Reimbursement", "money"),
  F("otherCharges", "Other Charges", "money"),

  F("_s3", "Payment", "section"),
  F("amountPaid", "Amount Paid", "money"),
  F("paymentDate", "Payment Date", "date"),
  F("paymentMethod", "Payment Method", "select", { options: SCHEMA.paymentMethods, allowEmpty: true }),

  F("_s4", "Notes", "section"),
  F("notes", "Notes", "textarea", { span2: true }),
  F("auditNotes", "Audit Notes", "textarea", { span2: true }),
];

/* ---------- Income ---------- */
SCHEMA.fields.income = [
  F("_s1", "Income", "section"),
  F("date", "Date Received", "date", { default: () => U.todayISO(), required: true }),
  F("clientId", "Client / Source", "client"),
  F("sourceOther", "Other Source (if not a client)", "text", { showIf: r => !r.clientId }),
  F("amount", "Amount", "money", { required: true }),
  F("paymentMethod", "Payment Method", "select", { options: SCHEMA.paymentMethods, allowEmpty: true }),
  F("invoiceId", "Linked Invoice", "invoice"),
  F("workOrderId", "Linked Work Order", "workorder"),
  F("serviceType", "Service Type", "select", { options: SCHEMA.serviceTypes, allowEmpty: true }),
  F("category", "Income Category", "select", { options: SCHEMA.incomeCategories, default: "Service Income (1099)" }),

  F("_s2", "1099 Tracking", "section"),
  F("is1099", "This is 1099 income", "checkbox", { default: true }),

  F("_s3", "Notes & Review", "section"),
  F("notes", "Notes", "textarea", { span2: true }),
  F("auditNotes", "Audit Notes", "textarea", { span2: true }),
  F("cpaReview", "Flag for CPA review", "checkbox"),
];

/* ---------- Expense ---------- */
SCHEMA.fields.expense = [
  F("_s1", "Expense", "section"),
  F("date", "Date", "date", { default: () => U.todayISO(), required: true }),
  F("vendor", "Vendor", "text", { required: true, placeholder: "e.g. Home Depot, Adobe" }),
  F("amount", "Amount", "money", { required: true }),
  F("paymentMethod", "Payment Method", "select", { options: SCHEMA.paymentMethods, allowEmpty: true }),
  F("category", "Category", "expenseCategory", { required: true }),
  F("subcategory", "Subcategory / Detail", "text", { placeholder: "optional detail" }),
  F("businessPurpose", "Business Purpose", "textarea", { span2: true, required: false,
    hint: "IRS substantiation: what was this for and how does it relate to the business?" }),
  F("workOrderId", "Linked Work Order", "workorder"),
  F("clientId", "Linked Client", "client"),

  F("_s2", "Receipt & Substantiation", "section"),
  F("receiptStatus", "Receipt", "select", { options: SCHEMA.receiptStatuses.map(s => s.value), default: "Missing" }),
  F("_file", "Attach Receipt (photo, PDF, or email printout)", "file", { span2: true,
    hint: "Stored in this browser (IndexedDB) and included in JSON backups. Status flips to Attached automatically." }),
  F("receiptRef", "Receipt Reference", "text", { placeholder: "filename, cloud link, or folder location" }),
  F("sourceRef", "Source / Document Reference", "text", { placeholder: "bank stmt line, card ending 1234…" }),

  F("_s3", "Deductibility & Reimbursement", "section"),
  F("deductible", "Deductible (subject to CPA confirmation)", "checkbox", { default: true }),
  F("businessUsePct", "Business-Use %", "percent", { default: 100, hint: "Personal-use % is the remainder" }),
  F("reimbursable", "Reimbursable by client", "checkbox"),
  F("reimbursed", "Already reimbursed", "checkbox", { showIf: r => !!r.reimbursable,
    hint: "Reimbursed expenses generally shouldn't also be deducted — CPA review" }),

  F("_s4", "Notes & Review", "section"),
  F("notes", "Notes", "textarea", { span2: true }),
  F("auditNotes", "Audit Notes", "textarea", { span2: true }),
  F("cpaReview", "Flag for CPA review", "checkbox"),
];

/* ---------- Mileage trip ---------- */
SCHEMA.fields.mileage = [
  F("_s1", "Trip", "section"),
  F("date", "Date", "date", { default: () => U.todayISO(), required: true }),
  F("tripType", "Trip Type", "select", { options: SCHEMA.tripTypes, default: "Inspection" }),
  F("startLocation", "Start Location", "text", { defaultFromSettings: "homeBase", placeholder: "e.g. Home office" }),
  F("destination", "Destination", "text", { required: false, placeholder: "loss location / client address" }),
  F("businessPurpose", "Business Purpose", "text", { placeholder: "e.g. Roof inspection for claim #…", span2: true }),
  F("clientId", "Client", "client"),
  F("workOrderId", "Linked Work Order", "workorder"),

  F("_s2", "Distance", "section"),
  F("roundTrip", "Round trip", "checkbox", { default: true }),
  F("miles", "Miles Driven (total)", "number", { required: true, step: 0.1 }),
  F("odometerStart", "Odometer Start", "number"),
  F("odometerEnd", "Odometer End", "number"),
  F("parking", "Parking", "money"),
  F("tolls", "Tolls", "money"),

  F("_s3", "Reimbursement", "section"),
  F("reimbursable", "Reimbursable by client", "checkbox"),
  F("reimbursed", "Already reimbursed", "checkbox", { showIf: r => !!r.reimbursable }),

  F("_s4", "Notes & Review", "section"),
  F("notes", "Notes", "textarea", { span2: true }),
  F("auditNotes", "Audit Notes", "textarea", { span2: true }),
  F("cpaReview", "Flag for CPA review", "checkbox"),
];

/* ---------- Receipt / document ---------- */
SCHEMA.fields.receipt = [
  F("_s1", "Receipt / Document", "section"),
  F("date", "Receipt Date", "date", { default: () => U.todayISO(), required: true }),
  F("vendor", "Vendor", "text", { required: true }),
  F("amount", "Amount", "money"),
  F("paymentMethod", "Payment Method", "select", { options: SCHEMA.paymentMethods, allowEmpty: true }),
  F("status", "Status", "select", { options: SCHEMA.receiptStatuses.map(s => s.value), default: "Referenced" }),
  F("reference", "Reference", "text", { placeholder: "filename, cloud link, or physical folder", span2: true }),
  F("expenseId", "Linked Expense", "expense"),
  F("workOrderId", "Linked Work Order", "workorder"),
  F("_file", "Attach Image / PDF (stored in this browser)", "file", { span2: true,
    hint: "Images are resized and stored locally in IndexedDB. Keep originals too." }),
  F("notes", "Notes", "textarea", { span2: true }),
];

/* ---------- Asset ---------- */
SCHEMA.fields.asset = [
  F("_s1", "Asset / Equipment", "section"),
  F("purchaseDate", "Purchase Date", "date", { default: () => U.todayISO(), required: true }),
  F("name", "Item Name", "text", { required: true, placeholder: "e.g. DJI Mavic 3 drone" }),
  F("vendor", "Vendor", "text"),
  F("cost", "Cost", "money", { required: true }),
  F("category", "Category", "select", { options: SCHEMA.assetCategories }),
  F("businessUsePct", "Business-Use %", "percent", { default: 100 }),
  F("status", "Status", "select", { options: SCHEMA.assetStatuses.map(s => s.value), default: "Active" }),
  F("receiptRef", "Receipt Reference", "text"),
  F("expenseId", "Linked Expense", "expense"),

  F("_s2", "Depreciation Review", "section"),
  F("askCpaDepreciation", "Ask CPA about depreciation / Section 179", "checkbox", { default: true }),
  F("depreciationStatus", "Depreciation Review Status", "select",
    { options: ["Not Reviewed", "Sent to CPA", "CPA Reviewed", "Expensed (per CPA)", "Depreciating (per CPA)"], default: "Not Reviewed" }),

  F("_s3", "Notes", "section"),
  F("notes", "Notes", "textarea", { span2: true }),
  F("auditNotes", "Audit Notes", "textarea", { span2: true }),
];

/* ---------- Contractor ---------- */
SCHEMA.fields.contractor = [
  F("_s1", "Contractor", "section"),
  F("name", "Contractor Name", "text", { required: true }),
  F("businessName", "Business Name", "text"),
  F("email", "Email", "email"),
  F("phone", "Phone", "tel"),
  F("address", "Address", "textarea", { span2: true }),
  F("tinNote", "EIN / TIN note", "text", {
    placeholder: "e.g. 'W-9 on file in Tax Docs folder' — do NOT store full SSN here",
    hint: "Store the W-9 securely elsewhere; keep only a pointer here.", span2: true }),
  F("w9Received", "W-9 received", "checkbox"),

  F("_s2", "1099 Review", "section"),
  F("may1099", "Possible 1099-NEC filing required", "checkbox", { hint: "Generally $600+ paid for services in a year — CPA review" }),
  F("cpaReview", "Flag for CPA review", "checkbox"),

  F("_s3", "Notes", "section"),
  F("notes", "Notes", "textarea", { span2: true }),
];

/* ---------- Contractor payment ---------- */
SCHEMA.fields.contractorPayment = [
  F("date", "Payment Date", "date", { default: () => U.todayISO(), required: true }),
  F("amount", "Amount", "money", { required: true }),
  F("paymentMethod", "Payment Method", "select", { options: SCHEMA.paymentMethods, allowEmpty: true }),
  F("workOrderId", "Linked Work Order", "workorder"),
  F("notes", "Notes", "text", { span2: true }),
];

/* ---------- Tax payment ---------- */
SCHEMA.fields.taxPayment = [
  F("date", "Date Paid", "date", { default: () => U.todayISO(), required: true }),
  F("taxYear", "Tax Year", "number", { required: true }),
  F("quarter", "Quarter", "select", { options: ["Q1", "Q2", "Q3", "Q4"], required: true }),
  F("jurisdiction", "Jurisdiction", "select", { options: ["Federal (IRS)", "State", "Local/Other"], default: "Federal (IRS)" }),
  F("amount", "Amount", "money", { required: true }),
  F("method", "Payment Method", "select", { options: ["EFTPS", "IRS Direct Pay", "Check", "State Portal", "Other"], allowEmpty: true }),
  F("confirmation", "Confirmation #", "text"),
  F("notes", "Notes", "text", { span2: true }),
];

/* ---------- Entity registry (labels + storage keys) ---------- */
SCHEMA.entities = {
  workOrder:  { store: "workOrders",  label: "Work Order",  plural: "Work Orders",  icon: "📋", route: "workorders" },
  client:     { store: "clients",     label: "Client",      plural: "Clients",      icon: "🏢", route: "clients" },
  invoice:    { store: "invoices",    label: "Invoice",     plural: "Invoices",     icon: "🧾", route: "invoices" },
  income:     { store: "income",      label: "Income Entry",plural: "Income",       icon: "💵", route: "income" },
  expense:    { store: "expenses",    label: "Expense",     plural: "Expenses",     icon: "💳", route: "expenses" },
  mileage:    { store: "mileage",     label: "Mileage Trip",plural: "Mileage",      icon: "🚗", route: "mileage" },
  receipt:    { store: "receipts",    label: "Receipt",     plural: "Receipts",     icon: "📎", route: "receipts" },
  asset:      { store: "assets",      label: "Asset",       plural: "Assets",       icon: "🛠️", route: "assets" },
  contractor: { store: "contractors", label: "Contractor",  plural: "Contractors",  icon: "👷", route: "contractors" },
  taxPayment: { store: "taxPayments", label: "Tax Payment", plural: "Tax Payments", icon: "🏛️", route: "taxes" },
};

/* ---------- The required disclaimer ---------- */
SCHEMA.DISCLAIMER = "This app is for bookkeeping, record organization, audit-readiness, and tax planning support only. It does not provide legal, accounting, or tax advice. It does not guarantee IRS acceptance of any deduction, tax position, mileage entry, expense category, home office deduction, depreciation treatment, or filing position. Final deductibility, tax treatment, estimated payments, depreciation, mileage, home office deductions, contractor reporting, 1099 treatment, and filing decisions should be confirmed with a qualified CPA or tax professional.";
