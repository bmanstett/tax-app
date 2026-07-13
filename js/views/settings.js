/* =========================================================
   views/settings.js — business profile, tax assumptions,
   backup/restore, data tools, and the Audit Trail view.
   ========================================================= */
"use strict";

window.Views = window.Views || {};

Views.settings = {
  title: "Settings & Backup",
  render(el) {
    const s = Store.state.settings;
    const rates = s.mileageRates || {};
    const rateYears = Object.keys(rates).map(Number).sort((a, b) => b - a);

    function peExpiryBadge(expires) {
      if (!expires) return "";
      const dd = U.daysFromToday(expires);
      if (dd < 0) return UI.badge(`Expired ${-dd}d ago`, "red");
      if (dd <= 60) return UI.badge(`Renew — ${dd}d left`, "red");
      if (dd <= 183) return UI.badge(`Renew soon — ${dd}d`, "amber");
      return UI.badge("Current", "green");
    }
    function peRowHtml(state, number, expires) {
      const inp = "padding:8px;border:1px solid var(--border-strong);border-radius:8px;background:var(--bg-elev);color:var(--text)";
      return `<div class="pe-row" style="display:flex;gap:8px;align-items:center;margin-bottom:7px;flex-wrap:wrap">
        <input type="text" data-pe-state maxlength="2" value="${U.escapeHtml(state || "")}" placeholder="ST"
          style="width:52px;${inp};text-transform:uppercase;text-align:center">
        <input type="text" data-pe-num value="${U.escapeHtml(number || "")}" placeholder="PE / license number"
          style="flex:1;min-width:120px;${inp}">
        <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text-3)">Exp
          <input type="date" data-pe-exp value="${U.escapeHtml(expires || "")}" title="License expiration date" style="${inp}"></label>
        <span data-pe-badge>${peExpiryBadge(expires)}</span>
        <button class="btn btn-sm btn-ghost" data-pe-remove type="button" title="Remove">✕</button>
      </div>`;
    }

    el.innerHTML = UI.pageHeader("Settings & Backup", "Business profile, tax assumptions, and data management. Data lives only in this browser — back up regularly.") + `
      <div class="grid-2">
        <div>
          <div class="card">
            <div class="card-title">🏢 Business profile</div>
            <div class="form-grid">
              <div class="field span-2"><label>Business name</label><input type="text" id="st-bizname" value="${U.escapeHtml(s.businessName)}"></div>
              <div class="field span-2"><label>Entity type (for your records)</label><input type="text" id="st-entity" value="${U.escapeHtml(s.entityType)}"></div>
              <div class="field"><label>Owner name</label><input type="text" id="st-owner" value="${U.escapeHtml(s.ownerName || "")}"></div>
              <div class="field"><label>Field engineer (default)</label><input type="text" id="st-engineer" value="${U.escapeHtml(s.engineerName || "")}"></div>
              <div class="field"><label>Company COA / certificate #</label><input type="text" id="st-coa" value="${U.escapeHtml(s.coaNumber || "")}"></div>
              <div class="field span-2">
                <label>PE numbers by state</label>
                <div id="st-pes">
                  ${(s.peNumbers || []).map(p => peRowHtml(p.state, p.number, p.expires)).join("")}
                </div>
                <button class="btn btn-sm" id="st-add-pe" type="button">＋ Add PE number</button>
                <div class="hint">One row per state license (e.g. VA — 0402068317). Add the expiration date to get a renewal alert within 6 months. Work order forms let you pick from this list, and PDF imports auto-match the loss-location state.</div>
              </div>
              <div class="field"><label>Business start date</label><input type="date" id="st-start" value="${U.escapeHtml(s.businessStartDate || "")}"></div>
              <div class="field"><label>Home base (mileage start)</label><input type="text" id="st-homebase" value="${U.escapeHtml(s.homeBase || "")}"></div>
              <div class="field span-2"><label>Business address (shows on invoices)</label><textarea id="st-address">${U.escapeHtml(s.businessAddress || "")}</textarea></div>
              <div class="field"><label>Business email</label><input type="email" id="st-email" value="${U.escapeHtml(s.businessEmail || "")}"></div>
              <div class="field"><label>Business phone</label><input type="tel" id="st-phone" value="${U.escapeHtml(s.businessPhone || "")}"></div>
              <div class="field"><label>Default hourly rate</label><input type="number" step="0.01" id="st-rate" value="${s.defaultHourlyRate || ""}"></div>
              <div class="field"><label>Default payment terms</label>
                <select id="st-terms">${SCHEMA.paymentTermsOptions.map(o => `<option ${s.defaultPaymentTerms === o ? "selected" : ""}>${o}</option>`).join("")}</select></div>
            </div>
            <button class="btn btn-primary" id="st-save-profile">Save profile</button>
          </div>

          <div class="card">
            <div class="card-title">🧮 Tax assumptions</div>
            <div class="card-sub">Used for reserve estimates only. Set with your CPA. Estimates ≠ advice.</div>
            <div class="form-grid">
              <div class="field"><label>Working tax year</label><input type="number" id="st-taxyear" value="${s.taxYear}"></div>
              <div class="field"><label>SE tax rate % (of 92.35% of net)</label><input type="number" step="0.1" id="st-se" value="${s.seTaxRatePct}"></div>
              <div class="field"><label>Federal reserve % of net</label><input type="number" step="0.5" id="st-fed" value="${s.federalReservePct}"></div>
              <div class="field"><label>State reserve % of net</label><input type="number" step="0.5" id="st-state" value="${s.stateReservePct}"></div>
              <div class="field"><label>Large-expense review threshold ($)</label><input type="number" id="st-large" value="${s.largeExpenseThreshold}"></div>
              <div class="field"><label>Backup reminder (days)</label><input type="number" id="st-bakdays" value="${s.backupReminderDays}"></div>
            </div>
            <div class="form-section-title" style="grid-column:auto">Standard mileage rate by tax year ($/mile)</div>
            <div id="st-rates">
              ${rateYears.map(y => `
                <div style="display:flex;gap:8px;align-items:center;margin-bottom:7px">
                  <span style="width:56px;font-weight:700">${y}</span>
                  <input type="number" step="0.005" data-rate-year="${y}" value="${rates[y]}" style="width:110px;padding:8px;border:1px solid var(--border-strong);border-radius:8px;background:var(--bg-elev);color:var(--text)">
                  <span style="font-size:12px;color:var(--text-3)">$/mi</span>
                </div>`).join("")}
            </div>
            <button class="btn btn-sm" id="st-add-rate" style="margin-bottom:10px">＋ Add year</button>
            <div class="hint" style="font-size:11.5px;color:var(--text-3);margin-bottom:10px">Verify the current IRS standard mileage rate each January (irs.gov) and confirm with your CPA.</div>
            <button class="btn btn-primary" id="st-save-tax">Save tax assumptions</button>
          </div>
        </div>

        <div>
          <div class="card" id="st-sync-card">
            <div class="card-title">☁️ Phone & desktop sync</div>
            ${Sync.config.enabled ? `
              <div class="card-sub">Syncing with <strong>${U.escapeHtml(Sync.config.repoFull)}</strong> (private GitHub repo).
                ${Sync.config.lastSyncAt ? `Last sync: ${U.fmtDateTime(Sync.config.lastSyncAt)}.` : "First sync pending."}
                ${Sync.lastError ? `<div style="color:var(--red);font-weight:700;margin-top:4px">${U.escapeHtml(Sync.lastError)}</div>` : ""}
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
                <button class="btn btn-primary" id="st-sync-now">🔄 Sync now</button>
                <button class="btn" id="st-sync-off">Turn off on this device</button>
              </div>
              <div class="hint" style="font-size:11.5px;color:var(--text-3)">Changes sync automatically — when the app opens, a few seconds after every edit, and every few minutes while open. Receipts included. Turning sync off keeps all data on this device.</div>
            ` : `
              <div class="card-sub">Keep this device and your other devices on the same books automatically — work orders, expenses, receipts, everything. Data goes to a <strong>private</strong> GitHub repo that only your account can see.</div>
              <div class="field" style="margin-bottom:8px">
                <label>GitHub access token</label>
                <input type="password" id="st-sync-token" placeholder="github_pat_… " autocomplete="off">
              </div>
              <div class="field" style="margin-bottom:8px">
                <label>Data repository</label>
                <input type="text" id="st-sync-repo" value="bmanstett/tax-app-data">
              </div>
              <button class="btn btn-primary" id="st-sync-enable">Turn on sync</button>
              <div class="hint" style="font-size:11.5px;color:var(--text-3);margin-top:8px">
                <strong>One-time setup (same token on every device):</strong><br>
                1. Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com/settings/personal-access-tokens/new</a> (sign in as the account that owns the data repo).<br>
                2. Name it <em>tax-app-sync</em>, set Expiration to <em>Custom → 1 year out</em>.<br>
                3. Repository access → <em>Only select repositories</em> → pick <em>tax-app-data</em>.<br>
                4. Permissions → Repository permissions → <em>Contents</em> → <em>Read and write</em>.<br>
                5. Generate, copy the token, and paste it above — here and once on each other device.
              </div>
            `}
          </div>

          <div class="card">
            <div class="card-title">💾 Backup & restore</div>
            <div class="card-sub">${s.lastBackupAt ? `Last backup: ${U.fmtDateTime(s.lastBackupAt)}` : "No backup exported yet"} ${Store.backupDue() ? UI.badge("Backup due", "amber") : UI.badge("Backed up recently", "green")}</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
              <button class="btn btn-primary" id="st-export">⬇️ Export JSON backup</button>
              <button class="btn" id="st-import">⬆️ Import / restore JSON</button>
              <input type="file" id="st-import-file" accept=".json,application/json" style="display:none">
            </div>
            <div class="hint" style="font-size:11.5px;color:var(--text-3)">The backup includes every record — clients, work orders, invoices, income, expenses, mileage, receipts (with attachments), assets, contractors, home office, tax data, settings, and the audit log. Store copies somewhere safe (cloud drive, external disk).</div>
          </div>

          <div class="card">
            <div class="card-title">🩺 Data health</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
              <button class="btn" id="st-integrity">Run integrity check</button>
              <button class="btn" id="st-dupes">Find duplicates</button>
              <button class="btn" id="st-fix-incdates">Sync income dates to invoice payments</button>
            </div>
            <div class="hint" style="font-size:11.5px;color:var(--text-3);margin-bottom:8px">“Sync income dates” re-dates each invoice-linked income entry to that invoice’s <strong>payment date</strong>, so the monthly income / net-profit charts land in the month the invoice was actually paid. (Set the payment date on each invoice first.)</div>
            <div id="st-health-out"></div>
          </div>

          <div class="card">
            <div class="card-title">🧪 Demo data</div>
            <div class="card-sub">${Store.state.demoDataLoaded ? "Demo data has been loaded into this browser." : "Explore the app with realistic sample records."}</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${!Store.state.demoDataLoaded && !Store.state.workOrders.length ? `<button class="btn" id="st-demo-load">Load demo data</button>` : ""}
              <button class="btn btn-danger" id="st-reset">🗑️ Clear ALL data</button>
            </div>
          </div>

          <div class="card">
            <div class="card-title">🔒 Locked tax years</div>
            ${Store.state.lockedYears.length
              ? Store.state.lockedYears.map(y => `<div class="score-line"><span>Tax year ${y}</span><span>${UI.badge("Locked", "red")}</span></div>`).join("") +
                `<div class="hint" style="font-size:11.5px;color:var(--text-3);margin-top:6px">Unlock from the Taxes page (with confirmation).</div>`
              : `<div class="card-sub">No years locked. Lock a year from the Taxes page after your CPA export.</div>`}
          </div>

          <div class="disclaimer">${U.escapeHtml(SCHEMA.DISCLAIMER)}</div>
        </div>
      </div>`;

    const g = id => el.querySelector(id);

    // PE numbers editor — auto-saves on every change (no separate button needed)
    function readPeNumbers() {
      return [...el.querySelectorAll("#st-pes .pe-row")].map(row => ({
        state: row.querySelector("[data-pe-state]").value.trim().toUpperCase(),
        number: row.querySelector("[data-pe-num]").value.trim(),
        expires: row.querySelector("[data-pe-exp]").value || "",
      })).filter(p => p.number);
    }
    function savePeNumbers() {
      const peNumbers = readPeNumbers();
      s.peNumbers = peNumbers;
      s.peNumber = peNumbers.length ? peNumbers[0].number : "";
      Store.markSettingsChanged();   // persists + stamps for sync
      App.refreshNav();
    }
    g("#st-add-pe").addEventListener("click", () => {
      g("#st-pes").insertAdjacentHTML("beforeend", peRowHtml("", "", ""));
    });
    g("#st-pes").addEventListener("click", e => {
      const btn = e.target.closest("[data-pe-remove]");
      if (btn) { btn.closest(".pe-row").remove(); savePeNumbers(); }
    });
    g("#st-pes").addEventListener("input", e => {
      const exp = e.target.closest("[data-pe-exp]");
      if (exp) { const b = exp.closest(".pe-row").querySelector("[data-pe-badge]"); if (b) b.innerHTML = peExpiryBadge(exp.value); }
    });
    // save when a field loses focus (change fires on blur for text + on pick for date)
    g("#st-pes").addEventListener("change", () => savePeNumbers());

    g("#st-save-profile").addEventListener("click", () => {
      const peNumbers = readPeNumbers();
      Object.assign(s, {
        businessName: g("#st-bizname").value.trim() || s.businessName,
        entityType: g("#st-entity").value.trim(),
        ownerName: g("#st-owner").value.trim(),
        engineerName: g("#st-engineer").value.trim(),
        peNumbers,
        peNumber: peNumbers.length ? peNumbers[0].number : "",
        coaNumber: g("#st-coa").value.trim(),
        businessStartDate: g("#st-start").value,
        homeBase: g("#st-homebase").value.trim(),
        businessAddress: g("#st-address").value,
        businessEmail: g("#st-email").value.trim(),
        businessPhone: g("#st-phone").value.trim(),
        defaultHourlyRate: Number(g("#st-rate").value) || 0,
        defaultPaymentTerms: g("#st-terms").value,
      });
      Store.markSettingsChanged(); UI.toast("Profile saved", "success"); App.refreshNav();
    });

    g("#st-save-tax").addEventListener("click", () => {
      const newRates = {};
      el.querySelectorAll("[data-rate-year]").forEach(inp => {
        const y = Number(inp.getAttribute("data-rate-year"));
        const v = Number(inp.value);
        if (y && v > 0) newRates[y] = v;
      });
      Object.assign(s, {
        taxYear: Number(g("#st-taxyear").value) || s.taxYear,
        seTaxRatePct: Number(g("#st-se").value) || 0,
        federalReservePct: Number(g("#st-fed").value) || 0,
        stateReservePct: Number(g("#st-state").value) || 0,
        largeExpenseThreshold: Number(g("#st-large").value) || 2500,
        backupReminderDays: Number(g("#st-bakdays").value) || 14,
        mileageRates: Object.keys(newRates).length ? newRates : s.mileageRates,
      });
      Store.logAudit("updated", "settings", { id: "assumptions" }, [{ field: "taxAssumptions", from: "", to: "updated" }]);
      Store.markSettingsChanged(); UI.toast("Tax assumptions saved", "success"); App.rerender();
    });

    g("#st-add-rate").addEventListener("click", () => {
      const y = prompt("Tax year for the new rate (e.g. " + (s.taxYear + 1) + "):", String(s.taxYear + 1));
      const yr = Number(y);
      if (!yr || yr < 2000 || yr > 2100) return;
      el.querySelector("#st-rates").insertAdjacentHTML("beforeend", `
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:7px">
          <span style="width:56px;font-weight:700">${yr}</span>
          <input type="number" step="0.005" data-rate-year="${yr}" value="0.70" style="width:110px;padding:8px;border:1px solid var(--border-strong);border-radius:8px;background:var(--bg-elev);color:var(--text)">
          <span style="font-size:12px;color:var(--text-3)">$/mi</span>
        </div>`);
    });

    /* ---- sync ---- */
    const syncEnable = g("#st-sync-enable");
    if (syncEnable) syncEnable.addEventListener("click", async () => {
      const token = g("#st-sync-token").value.trim();
      const repo = g("#st-sync-repo").value.trim();
      if (!token) { UI.toast("Paste the access token first", "error"); return; }
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { UI.toast("Repository should look like owner/name", "error"); return; }
      syncEnable.disabled = true; syncEnable.textContent = "Connecting…";
      try {
        await Sync.enable(repo, token);
        UI.toast("Sync is on — this device now stays up to date automatically", "success", 5000);
        App.rerender();
      } catch (err) {
        UI.toast(err.message, "error", 8000);
        syncEnable.disabled = false; syncEnable.textContent = "Turn on sync";
      }
    });
    const syncNow = g("#st-sync-now");
    if (syncNow) syncNow.addEventListener("click", async () => {
      syncNow.disabled = true; syncNow.textContent = "Syncing…";
      await Sync.now();
      App.rerender();
    });
    const syncOff = g("#st-sync-off");
    if (syncOff) syncOff.addEventListener("click", async () => {
      const ok = await UI.confirm("Turn off sync on this device?",
        "This device stops sending and receiving changes. Nothing is deleted — local data stays, and other devices keep syncing.", { confirmLabel: "Turn off" });
      if (ok) { Sync.disable(); UI.toast("Sync turned off on this device"); App.rerender(); }
    });

    /* ---- backup / restore ---- */
    g("#st-export").addEventListener("click", async () => {
      UI.toast("Preparing backup…");
      const json = await Store.exportJSON(true);
      U.download(`anstett-books-backup-${U.todayISO()}.json`, json);
      Store.markBackedUp();
      const yc = Store.state.yearChecklists[String(App.viewYear())] = Store.state.yearChecklists[String(App.viewYear())] || {};
      yc.backup = true; Store.save();
      UI.toast("Backup exported ✓", "success");
      setTimeout(() => App.rerender(), 400);
    });

    g("#st-import").addEventListener("click", () => g("#st-import-file").click());
    g("#st-import-file").addEventListener("change", async e => {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();
      // validate before scary confirm
      let parsed = null, errs = ["Could not parse file."];
      try { parsed = JSON.parse(text); errs = Store.validateImport(parsed); } catch (err) { errs = ["Invalid JSON: " + err.message]; }
      if (errs.length) { UI.toast("Import blocked: " + errs[0], "error", 6000); e.target.value = ""; return; }
      const counts = parsed.data || parsed;
      const ok = await UI.confirm("Restore from backup?",
        `This <strong>replaces all current data</strong> with the backup${parsed.exportedAt ? ` from <strong>${U.fmtDateTime(parsed.exportedAt)}</strong>` : ""}: ` +
        `${(counts.workOrders || []).length} work orders, ${(counts.invoices || []).length} invoices, ${(counts.expenses || []).length} expenses, ${(counts.income || []).length} income entries, ${(counts.mileage || []).length} trips. This cannot be undone.`,
        { danger: true, confirmLabel: "Replace my data", requireText: "RESTORE" });
      e.target.value = "";
      if (!ok) return;
      try {
        await Store.importJSON(text);
        UI.toast("Backup restored ✓", "success");
        App.go("dashboard");
      } catch (err) { UI.toast("Import failed: " + err.message, "error", 7000); }
    });

    /* ---- data health ---- */
    g("#st-integrity").addEventListener("click", () => {
      const issues = Store.integrityCheck();
      g("#st-health-out").innerHTML = issues.length
        ? `<div style="font-size:12.5px;font-weight:700;color:var(--red);margin-bottom:5px">${issues.length} issue(s):</div>` +
          issues.map(i => `<div style="font-size:12.5px;color:var(--text-2);padding:3px 0;border-bottom:1px dashed var(--border)">• ${U.escapeHtml(i)}</div>`).join("")
        : `<div style="font-size:13px;color:var(--green);font-weight:700">✓ No integrity issues found.</div>`;
    });
    g("#st-fix-incdates").addEventListener("click", () => {
      let n = 0, invoicesWithoutDate = 0;
      Store.state.invoices.forEach(inv => {
        const linked = Store.state.income.some(i => i.invoiceId === inv.id);
        if (inv.paymentDate) n += Invoices.syncIncomeDates(inv);
        else if (linked) invoicesWithoutDate++;
      });
      g("#st-health-out").innerHTML = `<div style="font-size:13px;font-weight:700;color:${n ? "var(--green)" : "var(--text-2)"}">${n ? `✓ Re-dated ${n} income entr${n > 1 ? "ies" : "y"} to match invoice payment dates. Your monthly charts now reflect them.` : "No changes — income dates already match invoice payment dates."}</div>` +
        (invoicesWithoutDate ? `<div class="hint" style="font-size:12px;color:var(--amber);margin-top:5px">${invoicesWithoutDate} paid invoice(s) have no payment date set — open each and set its Payment Date, then run this again.</div>` : "");
      if (n) UI.toast(`Updated ${n} income date${n > 1 ? "s" : ""}`, "success");
    });
    g("#st-dupes").addEventListener("click", () => {
      const dupes = Store.findDuplicates();
      g("#st-health-out").innerHTML = dupes.length
        ? `<div style="font-size:12.5px;font-weight:700;color:var(--amber);margin-bottom:5px">${dupes.length} possible duplicate(s):</div>` +
          dupes.map(x => `<div style="font-size:12.5px;color:var(--text-2);padding:3px 0;border-bottom:1px dashed var(--border)">• ${U.escapeHtml(x.label)}</div>`).join("") +
          `<div class="hint" style="font-size:11.5px;color:var(--text-3);margin-top:6px">Review each pair and delete the extra if it's a true duplicate.</div>`
        : `<div style="font-size:13px;color:var(--green);font-weight:700">✓ No duplicates detected.</div>`;
    });

    /* ---- demo / reset ---- */
    const demoBtn = g("#st-demo-load");
    if (demoBtn) demoBtn.addEventListener("click", () => { Demo.load(); UI.toast("Demo data loaded — explore!", "success"); App.go("dashboard"); });
    g("#st-reset").addEventListener("click", async () => {
      const ok = await UI.confirm("Erase everything?",
        "This permanently deletes <strong>all</strong> clients, work orders, invoices, income, expenses, mileage, receipts, assets, contractors, tax data, settings, and the audit log from this browser. Export a backup first!",
        { danger: true, confirmLabel: "Erase all data", requireText: "DELETE" });
      if (ok) { Store.resetAll(); UI.toast("All data cleared"); App.go("dashboard"); }
    });
  },
};

/* ================================================================
   AUDIT TRAIL
   ================================================================ */
Views.audit = {
  title: "Audit Trail",
  render(el) {
    const log = Store.state.auditLog;
    const types = [...new Set(log.map(a => a.recordType))];
    let filterType = "", q = "", shown = 100;

    el.innerHTML = UI.pageHeader("Audit Trail",
      "Every create, edit, and delete — with field-level before/after values. This is your defensibility layer.") + `
      <div class="toolbar">
        <div class="search-box"><input type="text" id="au-q" placeholder="Search log…"></div>
        <select id="au-type"><option value="">Type: All</option>${types.map(t => `<option value="${t}">${U.escapeHtml(SCHEMA.entities[t] ? SCHEMA.entities[t].label : t)}</option>`).join("")}</select>
        <button class="btn btn-sm" id="au-export">⬇️ Export log CSV</button>
      </div>
      <div class="card" id="au-list"></div>`;

    const actionBadge = a => a === "created" ? UI.badge("Created", "green") : a === "deleted" ? UI.badge("Deleted", "red") : a === "imported" ? UI.badge("Imported", "purple") : UI.badge("Updated", "blue");

    function render() {
      let rows = log;
      if (filterType) rows = rows.filter(a => a.recordType === filterType);
      if (q) {
        const qq = q.toLowerCase();
        rows = rows.filter(a => (a.recordLabel + " " + a.recordType + " " + a.changes.map(c => c.field).join(" ")).toLowerCase().includes(qq));
      }
      const list = el.querySelector("#au-list");
      list.innerHTML = rows.length ? rows.slice(0, shown).map(a => `
        <div class="audit-entry">
          <div class="au-head">
            <span class="au-what">${actionBadge(a.action)} ${U.escapeHtml(SCHEMA.entities[a.recordType] ? SCHEMA.entities[a.recordType].label : a.recordType)}: ${U.escapeHtml(a.recordLabel)}</span>
            <span class="au-when">${U.fmtDateTime(a.at)}</span>
          </div>
          ${a.changes && a.changes.length ? `<div class="au-changes">${a.changes.slice(0, 8).map(c => `
            <span class="chg"><strong>${U.escapeHtml(c.field)}</strong>: <span class="old">${U.escapeHtml(U.truncate(String(c.from ?? ""), 42)) || "(empty)"}</span> → <span class="new">${U.escapeHtml(U.truncate(String(c.to ?? ""), 42)) || "(empty)"}</span></span>`).join("")}
            ${a.changes.length > 8 ? `<span class="chg" style="color:var(--text-3)">…and ${a.changes.length - 8} more field(s)</span>` : ""}</div>` : ""}
        </div>`).join("") + (rows.length > shown ? `<button class="btn btn-sm" id="au-more" style="margin-top:10px">Show more (${rows.length - shown} remaining)</button>` : "")
        : UI.emptyState({ icon: "📜", title: "No audit entries yet", sub: "Every change you make is recorded here automatically." });
      const more = list.querySelector("#au-more");
      if (more) more.addEventListener("click", () => { shown += 200; render(); });
    }
    render();

    el.querySelector("#au-q").addEventListener("input", U.debounce(e => { q = e.target.value; shown = 100; render(); }, 200));
    el.querySelector("#au-type").addEventListener("change", e => { filterType = e.target.value; shown = 100; render(); });
    el.querySelector("#au-export").addEventListener("click", () => {
      const csv = U.toCSV(log, [
        { key: "at", label: "Timestamp" }, { key: "action", label: "Action" },
        { key: "recordType", label: "Record Type" }, { key: "recordId", label: "Record ID" },
        { key: "recordLabel", label: "Record" },
        { label: "Changes", value: a => (a.changes || []).map(c => `${c.field}: "${c.from}" -> "${c.to}"`).join("; ") },
      ]);
      U.download("audit-trail.csv", csv, "text/csv");
      UI.toast("Audit log exported", "success");
    });
  },
};
