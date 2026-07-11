/* =========================================================
   importwo.js — ingest an FCGA "Engineer Work Order Form"
   (PDF or pasted text) and pre-fill a new work order.
   Flow: pick/drop PDF → extract text (pdftext.js) → parse
   labeled fields → open the standard WO editor pre-filled →
   on save, attach the original PDF as a linked document.
   ========================================================= */
"use strict";

const ImportWO = (() => {

  /* ---------- FCGA form labels (order-independent slicing) ---------- */
  const LABELS = [
    "Today's Date", "Project Number", "Field Engineer", "P.E.#", "FCGA COA#",
    "Client Company Name", "Client Address", "Client Contact Name", "Client Contact Phone",
    "Date of Loss", "Job Type", "Claim Number", "Policy Number", "Insurance Carrier",
    "Cat Name/Number", "Insured Name", "Loss Location Address", "Insured Contact Name",
    "Main Phone Number", "Alt. Phone Number", "Cell Phone Number", "Insured Email",
    "Description of Loss", "Residential or Commercial", "Description of Property",
    "Scope of Service", "Additional Notes/Instructions",
    "Public Adjuster Contact", "Attorney Contact", "PA Phone", "Attorney Phone",
    "PA Email", "Attorney Email", "Remit FCG Report To", "Remit FCG Invoice To",
    "Engineer Service Fee Flat Fee", "T&E", "Do Not Exceed Budget Amount", "Mileage",
    "Engineer's Signature",
  ];

  // boilerplate lines to strip out of any captured value
  const NOISE = [
    /make sure to review all documentation/i,
    /\*\s*subject to the terms/i,
    /contractor agreement and fcg service guidelines/i,
    /engineer work order form/i,
    /rea road/i,
    /fcgassociates\.com/i,
    /phone:\s*\(888\)\s*303-2012/i,
    /^_{3,}/,
    /^copyright$/i,
  ];

  function cleanValue(v) {
    return (v || "")
      .split("\n")
      .map(l => l.trim())
      .filter(l => l && !NOISE.some(re => re.test(l)) && !/^_+$/.test(l.replace(/\s/g, "")))
      .join("\n")
      .replace(/\s*\n\s*/g, " ")   // FCGA values wrap mid-sentence; join lines
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function toISO(us) { // MM/DD/YYYY → YYYY-MM-DD
    const m = String(us || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) return "";
    return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }

  function moneyIn(v) {
    const s = String(v || "");
    // prefer an explicit $ amount ("Flat Fee 2 $1300.00" → 1300, not 2)
    const dollar = s.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
    if (dollar) return Number(dollar[1].replace(/,/g, ""));
    const bare = s.match(/([\d,]+(?:\.\d{1,2})?)/);
    return bare ? Number(bare[1].replace(/,/g, "")) : null;
  }

  /** Slice text into {label: value} using positions of every known label. */
  function sliceFields(text) {
    const norm = text.replace(/[‘’]/g, "'");
    const hits = [];
    for (const label of LABELS) {
      const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
      const re = new RegExp(esc + "\\s*:", "i");
      const m = re.exec(norm);
      if (m) hits.push({ label, start: m.index, valStart: m.index + m[0].length });
    }
    hits.sort((a, b) => a.start - b.start);
    const fields = {};
    hits.forEach((h, i) => {
      const end = i + 1 < hits.length ? hits[i + 1].start : norm.length;
      fields[h.label] = cleanValue(norm.slice(h.valStart, end));
    });
    return fields;
  }

  function looksLikeFCGA(text) {
    return /project\s*number/i.test(text) &&
      (/fcga|fcg associates|fcgassociates/i.test(text) || /engineer work order/i.test(text));
  }

  /** Map a US state abbreviation out of an address ("… Springfield, VA 22152"). */
  function stateFrom(address) {
    const m = String(address || "").match(/,\s*([A-Z]{2})\s+\d{5}/);
    return m ? m[1] : "";
  }

  /** Pick the PE number: prefer the one on the form; else match loss-location state. */
  function pickPE(formPE, lossState) {
    const pes = (Store.state.settings.peNumbers || []).filter(p => p.number);
    if (formPE) return formPE;
    const byState = pes.find(p => p.state && p.state.toUpperCase() === lossState);
    if (byState) return byState.number;
    return pes.length === 1 ? pes[0].number : "";
  }

  /** Find or create the FCGA client record. */
  function fcgaClient() {
    const existing = Store.all("client").find(c => /fcg/i.test(c.name || ""));
    if (existing) return existing;
    const rec = Store.add("client", {
      name: "FCG Associates (FCGA)",
      contactName: "", email: "", phone: "(888) 303-2012",
      billingAddress: "9935-D Rea Road #245\nCharlotte, NC 28277",
      paymentTerms: Store.state.settings.defaultPaymentTerms || "Net 30",
      remittanceInstructions: "Upload invoice to the COR system under the project number.",
      expects1099: true, w9Provided: false,
      notes: "Auto-created from work order import.",
    });
    UI.toast("Client \"FCG Associates (FCGA)\" created", "success");
    return rec;
  }

  /* ---------- text → work order presets ---------- */
  function parseFCGA(text) {
    const f = sliceFields(text);
    const warnings = [];
    const get = k => f[k] || "";

    const projectNumber = get("Project Number").match(/\d+/) ? get("Project Number").match(/\d+/)[0] : get("Project Number");
    const lossLocation = get("Loss Location Address");
    const lossState = stateFrom(lossLocation);

    // fee logic
    const feeRaw = get("Engineer Service Fee Flat Fee");
    const dneAmt = moneyIn(get("Do Not Exceed Budget Amount"));
    const teVal = get("T&E");
    const flatAmt = moneyIn(feeRaw);
    let feeType = "Flat Fee", flatFee = flatAmt;
    if (dneAmt) { feeType = "Do-Not-Exceed Budget"; flatFee = dneAmt; }
    else if (teVal && !flatAmt) { feeType = "T&E"; flatFee = null; }

    // mileage
    const mileageRaw = get("Mileage");
    const mileageAllowed = /^y/i.test(mileageRaw);

    // job type: match app options case-insensitively, else keep the raw value
    const jobRaw = get("Job Type");
    const jobType = SCHEMA.jobTypes.find(j => j.toLowerCase() === jobRaw.toLowerCase()) || jobRaw;

    const resCom = get("Residential or Commercial");
    const residentialCommercial = ["Residential", "Commercial", "Mixed-Use"]
      .find(o => resCom.toLowerCase().includes(o.toLowerCase().split("-")[0])) || (resCom || "");

    const phones = [
      get("Main Phone Number") && "Main " + get("Main Phone Number"),
      get("Cell Phone Number") && "Cell " + get("Cell Phone Number"),
      get("Alt. Phone Number") && "Alt " + get("Alt. Phone Number"),
    ].filter(Boolean).join(" / ");

    const presets = {
      woNumber: projectNumber ? `P#${projectNumber}` : "",
      projectNumber,
      dateAssigned: toISO(get("Today's Date")) || U.todayISO(),
      status: "New",
      fieldEngineer: get("Field Engineer") || Store.state.settings.engineerName || "",
      peNumber: pickPE(get("P.E.#"), lossState),
      coaNumber: get("FCGA COA#") || Store.state.settings.coaNumber || "",
      insuranceCarrier: get("Insurance Carrier") || get("Client Company Name"),
      carrierContact: get("Client Contact Name"),
      carrierContactPhone: get("Client Contact Phone"),
      claimNumber: get("Claim Number"),
      policyNumber: get("Policy Number"),
      catNumber: get("Cat Name/Number"),
      dateOfLoss: toISO(get("Date of Loss")),
      jobType,
      serviceType: "Forensic Engineering Report",
      residentialCommercial,
      insuredName: get("Insured Name"),
      insuredContact: get("Insured Contact Name"),
      insuredPhone: phones,
      insuredEmail: get("Insured Email"),
      lossLocation,
      descriptionOfLoss: get("Description of Loss"),
      descriptionOfProperty: get("Description of Property"),
      scopeOfService: get("Scope of Service"),
      additionalNotes: get("Additional Notes/Instructions"),
      paContact: get("Public Adjuster Contact"),
      paPhoneEmail: [get("PA Phone"), get("PA Email")].filter(Boolean).join(" / "),
      attorneyContact: get("Attorney Contact"),
      attorneyPhoneEmail: [get("Attorney Phone"), get("Attorney Email")].filter(Boolean).join(" / "),
      feeType,
      flatFee: flatFee ?? "",
      mileageAllowed,
      mileageAmount: mileageAllowed ? mileageRaw : "",
      reportRemittance: get("Remit FCG Report To"),
      invoiceRemittance: get("Remit FCG Invoice To"),
      uploadLocation: /cor system/i.test(get("Remit FCG Report To") + get("Remit FCG Invoice To")) ? "COR system" : "",
      internalNotes: "Imported from FCGA work order PDF on " + U.fmtDate(U.todayISO()) + ".",
    };

    // review-before-inspection boilerplate is on every FCGA order — keep it as an instruction
    if (/review all documentation/i.test(text)) {
      presets.additionalNotes = (presets.additionalNotes ? presets.additionalNotes + "\n" : "") +
        "Review ALL documentation in the COR system project files prior to inspection.";
    }

    for (const [key, label] of [["projectNumber", "Project number"], ["claimNumber", "Claim number"],
      ["dateOfLoss", "Date of loss"], ["insuredName", "Insured name"], ["lossLocation", "Loss location"]]) {
      if (!presets[key]) warnings.push(`${label} not found — check the form.`);
    }
    if (!flatFee && feeType !== "T&E") warnings.push("Fee amount not found — enter it manually.");
    return { presets, warnings, fields: f };
  }

  /* ---------- import flow ---------- */
  async function handleParsed(text, sourceFile) {
    if (!looksLikeFCGA(text)) {
      UI.toast("This doesn't look like an FCGA work order — parsing anyway, review carefully.", "error", 5000);
    }
    const { presets, warnings } = parseFCGA(text);

    // duplicate check
    const dup = Store.all("workOrder").find(w =>
      (presets.projectNumber && w.projectNumber === presets.projectNumber) ||
      (presets.claimNumber && w.claimNumber === presets.claimNumber));
    if (dup) {
      const ok = await UI.confirm("Possible duplicate",
        `A work order with this project/claim number already exists: <strong>${U.escapeHtml(dup.woNumber || dup.projectNumber || "")}</strong> (${U.escapeHtml(dup.status)}). Import anyway?`,
        { confirmLabel: "Import anyway" });
      if (!ok) return;
    }

    presets.clientId = fcgaClient().id;

    WO.openEditor(null, presets, {
      afterSave: async saved => {
        if (!sourceFile) return;
        try {
          const dataUrl = await Store.Attachments.fileToDataUrl(sourceFile);
          const attId = U.uid("att");
          await Store.Attachments.put({ id: attId, name: sourceFile.name, type: sourceFile.type || "application/pdf", dataUrl });
          Store.add("receipt", {
            date: saved.dateAssigned || U.todayISO(),
            vendor: "FCG Associates (FCGA)",
            amount: null, status: "Attached",
            reference: sourceFile.name,
            workOrderId: saved.id,
            attachmentId: attId, attachmentName: sourceFile.name,
            notes: `Original work order PDF for ${saved.woNumber || saved.projectNumber || "job"}.`,
          });
          UI.toast("Original PDF attached to the job's documents", "success");
        } catch (e) { console.warn("Could not attach source PDF:", e); }
      },
    });

    if (warnings.length) setTimeout(() => UI.toast("⚠ " + warnings[0] + (warnings.length > 1 ? ` (+${warnings.length - 1} more — see form)` : ""), "error", 5000), 400);
    else UI.toast("Work order parsed — review and save", "success");
  }

  async function handleFile(file, modal) {
    if (!file) return;
    UI.toast("Reading PDF…");
    try {
      const buf = await file.arrayBuffer();
      const text = await PDFText.extract(buf);
      if (!text || text.length < 80 || !/project\s*number/i.test(text)) {
        throw new Error("No readable text found (scanned image PDF?). Open the PDF, select all, copy, and use the paste box instead.");
      }
      if (modal) modal.close();
      await handleParsed(text, file);
    } catch (e) {
      UI.toast("Import failed: " + e.message, "error", 7000);
    }
  }

  function openImportModal() {
    const dsOk = PDFText.supported();
    const m = UI.modal({
      title: "📄 Import FCGA Work Order",
      body: `
        ${dsOk ? `
        <div id="iw-drop" style="border:2px dashed var(--border-strong);border-radius:14px;padding:34px 16px;text-align:center;cursor:pointer;transition:border-color .15s,background .15s">
          <div style="font-size:36px;margin-bottom:8px">📄</div>
          <div style="font-weight:700;font-size:15px">Drop the work order PDF here</div>
          <div style="font-size:12.5px;color:var(--text-2);margin-top:4px">or tap to choose a file — parsed entirely on this device, nothing is uploaded</div>
          <input type="file" id="iw-file" accept=".pdf,application/pdf" style="display:none">
        </div>
        <div style="text-align:center;color:var(--text-3);font-size:12px;margin:14px 0 10px">— or —</div>`
        : `<div class="disclaimer" style="margin:0 0 12px">This browser can't decompress PDFs directly. Use the paste box below instead.</div>`}
        <div class="field">
          <label>Paste the work order text</label>
          <textarea id="iw-paste" style="min-height:120px" placeholder="Open the PDF, press Ctrl+A then Ctrl+C, and paste here…"></textarea>
          <div class="hint">Fallback for scanned or protected PDFs — the parser reads the same field labels.</div>
        </div>`,
      footer: `<button class="btn" id="iw-cancel">Cancel</button>
               <button class="btn btn-primary" id="iw-parse-text">Parse pasted text</button>`,
    });

    const drop = m.body.querySelector("#iw-drop");
    if (drop) {
      const fileInput = m.body.querySelector("#iw-file");
      drop.addEventListener("click", () => fileInput.click());
      fileInput.addEventListener("change", () => handleFile(fileInput.files[0], m));
      ["dragover", "dragenter"].forEach(ev => drop.addEventListener(ev, e => {
        e.preventDefault(); drop.style.borderColor = "var(--accent)"; drop.style.background = "var(--accent-soft)";
      }));
      ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => {
        e.preventDefault(); drop.style.borderColor = "var(--border-strong)"; drop.style.background = "";
      }));
      drop.addEventListener("drop", e => handleFile(e.dataTransfer.files[0], m));
    }
    m.footerEl.querySelector("#iw-cancel").addEventListener("click", () => m.close());
    m.footerEl.querySelector("#iw-parse-text").addEventListener("click", () => {
      const text = m.body.querySelector("#iw-paste").value.trim();
      if (text.length < 60) { UI.toast("Paste the full work order text first", "error"); return; }
      m.close();
      handleParsed(text, null);
    });
  }

  return { openImportModal, parseFCGA, handleFile };
})();
