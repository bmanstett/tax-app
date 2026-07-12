/* =========================================================
   ui.js — shared components: toasts, modals, confirm dialogs,
   schema-driven forms, generic list views (table + mobile cards).
   ========================================================= */
"use strict";

const UI = (() => {

  /* ================= Toasts ================= */
  function toast(msg, kind = "default", ms = 2600) {
    const root = document.getElementById("toast-root");
    const el = document.createElement("div");
    el.className = "toast" + (kind === "error" ? " toast-error" : kind === "success" ? " toast-success" : "");
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; setTimeout(() => el.remove(), 320); }, ms);
  }

  /* ================= Modals (stackable) ================= */
  function modal({ title, body, footer, size = "", onClose }) {
    const root = document.getElementById("modal-root");
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal ${size ? "modal-" + size : ""}" role="dialog" aria-modal="true">
        <div class="modal-header">
          <div class="modal-title"></div>
          <button class="modal-close" aria-label="Close">×</button>
        </div>
        <div class="modal-body"></div>
        ${footer !== null ? '<div class="modal-footer"></div>' : ""}
      </div>`;
    backdrop.querySelector(".modal-title").innerHTML = title;
    backdrop.querySelector(".modal-body").innerHTML = body || "";
    if (footer !== null && footer !== undefined) backdrop.querySelector(".modal-footer").innerHTML = footer;
    root.appendChild(backdrop);
    document.body.style.overflow = "hidden";

    const api = {
      el: backdrop,
      body: backdrop.querySelector(".modal-body"),
      footerEl: backdrop.querySelector(".modal-footer"),
      close() {
        backdrop.remove();
        if (!root.children.length) document.body.style.overflow = "";
        if (onClose) onClose();
      },
    };
    backdrop.querySelector(".modal-close").addEventListener("click", api.close);
    backdrop.addEventListener("mousedown", e => { if (e.target === backdrop) api.close(); });
    const escHandler = e => { if (e.key === "Escape" && root.lastElementChild === backdrop) { api.close(); document.removeEventListener("keydown", escHandler); } };
    document.addEventListener("keydown", escHandler);
    return api;
  }

  /** Confirm dialog. opts: {danger, confirmLabel, requireText} → Promise<boolean> */
  function confirm(title, message, opts = {}) {
    return new Promise(resolve => {
      const needType = opts.requireText;
      const m = modal({
        title: U.escapeHtml(title),
        size: "sm",
        body: `<p style="margin:0 0 10px;font-size:14px;line-height:1.55">${message}</p>` +
          (needType ? `<div class="field"><label>Type <strong>${U.escapeHtml(needType)}</strong> to confirm</label><input type="text" id="cf-type" autocomplete="off"></div>` : ""),
        footer: `<button class="btn" id="cf-no">Cancel</button>
                 <button class="btn ${opts.danger ? "btn-danger" : "btn-primary"}" id="cf-yes" ${needType ? "disabled" : ""}>${U.escapeHtml(opts.confirmLabel || "Confirm")}</button>`,
        onClose: () => resolve(false),
      });
      if (needType) {
        m.body.querySelector("#cf-type").addEventListener("input", e => {
          m.footerEl.querySelector("#cf-yes").disabled = e.target.value.trim() !== needType;
        });
      }
      m.footerEl.querySelector("#cf-no").addEventListener("click", () => m.close());
      m.footerEl.querySelector("#cf-yes").addEventListener("click", () => { resolve(true); m.el.remove(); if (!document.getElementById("modal-root").children.length) document.body.style.overflow = ""; });
    });
  }

  /* ================= Badges & small pieces ================= */
  const badge = (text, color = "slate") => `<span class="badge badge-${color}">${U.escapeHtml(text)}</span>`;
  const statusBadge = (list, value) => value ? badge(value, SCHEMA.statusColor(list, value)) : "";

  function statCard({ label, value, sub, color, onClickRoute, icon }) {
    const accent = color ? `<div class="stat-accent" style="background:var(--${color})"></div>` : "";
    return `<div class="stat-card ${onClickRoute ? "clickable" : ""}" ${onClickRoute ? `data-route="${onClickRoute}"` : ""}>
      ${accent}
      <div class="stat-label">${icon ? icon + " " : ""}${U.escapeHtml(label)}</div>
      <div class="stat-value">${value}</div>
      ${sub ? `<div class="stat-sub">${sub}</div>` : ""}
    </div>`;
  }

  function emptyState({ icon = "📭", title = "Nothing here yet", sub = "", actionLabel, actionId }) {
    return `<div class="empty-state">
      <div class="es-icon">${icon}</div>
      <div class="es-title">${U.escapeHtml(title)}</div>
      <div class="es-sub">${U.escapeHtml(sub)}</div>
      ${actionLabel ? `<button class="btn btn-primary" id="${actionId}">${U.escapeHtml(actionLabel)}</button>` : ""}
    </div>`;
  }

  function pageHeader(title, subtitle = "", actionsHtml = "") {
    return `<div class="page-header">
      <div><h1 class="page-title">${U.escapeHtml(title)}</h1>
      ${subtitle ? `<div class="page-subtitle">${subtitle}</div>` : ""}</div>
      <div class="page-actions">${actionsHtml}</div>
    </div>`;
  }

  /* ================= Detail grid ================= */
  function detailGrid(pairs) {
    return `<div class="detail-grid">${pairs.filter(p => p).map(([label, val]) => `
      <div class="detail-item">
        <div class="detail-label">${U.escapeHtml(label)}</div>
        <div class="detail-value ${val === "" || val == null || val === "—" ? "empty" : ""}">${val === "" || val == null ? "—" : val}</div>
      </div>`).join("")}</div>`;
  }

  /* ================= Schema-driven form builder ================= */
  /**
   * openForm(entityType, record, opts)
   * opts: { title, onSave(values, modalApi), presets, deleteFn }
   * Returns modal api. record=null → create mode.
   */
  function openForm(entityType, record, opts = {}) {
    const fields = SCHEMA.fields[entityType];
    const ent = SCHEMA.entities[entityType] || { label: entityType };
    const isNew = !record;
    const values = initValues(fields, record, opts.presets);
    let pendingFile = null;

    const m = modal({
      title: `${ent.icon || ""} ${isNew ? "New" : "Edit"} ${U.escapeHtml(opts.title || ent.label)}`,
      size: fields.length > 14 ? "lg" : "",
      body: `<form class="form-grid" id="entity-form" novalidate></form>`,
      footer: `
        ${!isNew && opts.deleteFn ? `<button class="btn btn-danger btn-left" id="form-delete">Delete</button>` : ""}
        <button class="btn" id="form-cancel">Cancel</button>
        <button class="btn btn-primary" id="form-save">${isNew ? "Add" : "Save changes"}</button>`,
    });

    const form = m.body.querySelector("#entity-form");
    renderFields();

    function renderFields() {
      form.innerHTML = fields.map(f => fieldHtml(f, values)).join("");
      // wire inputs
      form.querySelectorAll("[data-key]").forEach(input => {
        const key = input.getAttribute("data-key");
        const f = fields.find(x => x.key === key);
        const evt = input.type === "checkbox" || input.tagName === "SELECT" || input.type === "file" ? "change" : "input";
        input.addEventListener(evt, () => {
          if (input.type === "checkbox") values[key] = input.checked;
          else if (input.type === "file") { pendingFile = input.files[0] || null; showFilePreview(input, pendingFile); return; }
          else values[key] = input.value;
          if (f && (f.type === "checkbox" || f.type === "select" || f.type === "client" || f.type === "workorder")) {
            // re-render if any field (or action button) visibility depends on values
            if (fields.some(x => x.showIf || (x.actionBtn && x.actionBtn.showIf))) { snapshotAndRerender(); }
          }
        });
      });
      // per-field action buttons (e.g. "Calculate miles" on the mileage form)
      form.querySelectorAll("[data-field-action]").forEach(btn => {
        const f = fields.find(x => x.key === btn.getAttribute("data-field-action"));
        if (!f || !f.actionBtn || !f.actionBtn.onClick) return;
        btn.addEventListener("click", e => {
          e.preventDefault();
          // snapshot current inputs so the handler sees what's typed right now
          form.querySelectorAll("[data-key]").forEach(input => {
            const k = input.getAttribute("data-key");
            if (input.type === "checkbox") values[k] = input.checked;
            else if (input.type !== "file") values[k] = input.value;
          });
          f.actionBtn.onClick({
            values, btn,
            setValue: (k, v) => {
              values[k] = v;
              const inp = form.querySelector(`[data-key="${k}"]`);
              if (inp && inp.type !== "checkbox" && inp.type !== "file") inp.value = v;
            },
            hint: text => {
              let h = btn.parentElement.querySelector(".action-hint");
              if (!h) { h = document.createElement("div"); h.className = "hint action-hint"; btn.insertAdjacentElement("afterend", h); }
              h.textContent = text;
            },
          });
        });
      });
      // file pickers: buttons proxy to the hidden inputs (camera vs. file)
      form.querySelectorAll("[data-file-btn]").forEach(btn => {
        btn.addEventListener("click", e => {
          e.preventDefault();
          const input = form.querySelector(`#${CSS.escape(btn.getAttribute("data-file-btn"))}`);
          if (input) input.click();
        });
      });
      // existing attachment (view / replace note) under the file field
      if (record && record.attachmentId) {
        const fileWrap = form.querySelector('[data-field-wrap="_file"]');
        if (fileWrap) {
          fileWrap.insertAdjacentHTML("beforeend", `
            <div class="hint" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:6px">
              <span>📎 Attached: <strong>${U.escapeHtml(record.attachmentName || "file")}</strong> — choosing a new file replaces it</span>
              <button class="btn btn-sm" type="button" id="fld-view-attachment">👁 View</button>
            </div>`);
          fileWrap.querySelector("#fld-view-attachment").addEventListener("click", e => {
            e.preventDefault();
            viewAttachment(record.attachmentId, record.attachmentName || "Attachment");
          });
        }
      }
      // keep the pending-file preview across re-renders
      if (pendingFile) {
        const fi = form.querySelector('input[type="file"][data-key]');
        if (fi) showFilePreview(fi, pendingFile);
      }
      // quick-add client button
      form.querySelectorAll("[data-quickadd-client]").forEach(btn => {
        btn.addEventListener("click", e => {
          e.preventDefault();
          openForm("client", null, {
            onSave: vals => {
              const rec = Store.add("client", vals);
              values.clientId = rec.id;
              snapshotAndRerender();
              toast("Client added", "success");
            },
          });
        });
      });
    }

    function showFilePreview(input, file) {
      const previewEl = input.closest("[data-field-wrap]")?.querySelector("[data-file-preview]");
      if (!previewEl) return;
      if (!file) { previewEl.hidden = true; previewEl.innerHTML = ""; return; }
      previewEl.hidden = false;
      const meta = `<div class="file-preview-meta"><strong>${U.escapeHtml(file.name)}</strong><span>${(file.size / 1024).toFixed(0)} KB — saved when you hit ${isNew ? "Add" : "Save"}</span></div>`;
      if (/^image\//.test(file.type)) {
        const url = URL.createObjectURL(file);
        previewEl.innerHTML = `<img src="${url}" alt="Receipt preview">` + meta;
        previewEl.querySelector("img").addEventListener("load", () => URL.revokeObjectURL(url));
      } else {
        previewEl.innerHTML = `<span class="file-preview-icon">📄</span>` + meta;
      }
    }

    function snapshotAndRerender() {
      // preserve current text inputs before rebuild
      form.querySelectorAll("[data-key]").forEach(input => {
        const key = input.getAttribute("data-key");
        if (input.type === "checkbox") values[key] = input.checked;
        else if (input.type !== "file") values[key] = input.value;
      });
      renderFields();
    }

    m.footerEl.querySelector("#form-cancel").addEventListener("click", () => m.close());
    if (!isNew && opts.deleteFn) {
      m.footerEl.querySelector("#form-delete").addEventListener("click", async () => {
        const ok = await confirm(`Delete ${ent.label.toLowerCase()}?`,
          "This permanently removes the record. The deletion is noted in the audit log.", { danger: true, confirmLabel: "Delete" });
        if (ok) { opts.deleteFn(record); m.close(); }
      });
    }

    m.footerEl.querySelector("#form-save").addEventListener("click", async () => {
      // collect + coerce
      form.querySelectorAll("[data-key]").forEach(input => {
        const key = input.getAttribute("data-key");
        if (input.type === "checkbox") values[key] = input.checked;
        else if (input.type !== "file") values[key] = input.value;
      });
      const out = {};
      let firstInvalid = null;
      for (const f of fields) {
        if (f.type === "section") continue;
        if (f.showIf && !f.showIf(values)) { out[f.key] = values[f.key]; continue; }
        let v = values[f.key];
        if (["money", "number", "percent"].includes(f.type)) v = v === "" || v == null ? null : Number(v);
        if (f.type === "checkbox") v = !!v;
        out[f.key] = v;
        const wrap = form.querySelector(`[data-field-wrap="${f.key}"]`);
        const missing = f.required && (v === "" || v == null || (typeof v === "number" && isNaN(v)));
        if (wrap) {
          wrap.classList.toggle("invalid", !!missing);
          const msg = wrap.querySelector(".invalid-msg");
          if (msg) msg.remove();
          if (missing) {
            wrap.insertAdjacentHTML("beforeend", `<div class="invalid-msg">Required</div>`);
            if (!firstInvalid) firstInvalid = wrap;
          }
        }
        if (missing && !firstInvalid) firstInvalid = wrap;
      }
      if (firstInvalid) { firstInvalid.scrollIntoView({ behavior: "smooth", block: "center" }); toast("Please fill the required fields", "error"); return; }
      delete out._file;

      // attach file if present (receipts)
      if (pendingFile) {
        try {
          const dataUrl = await Store.Attachments.fileToDataUrl(pendingFile);
          const attId = (record && record.attachmentId) || U.uid("att");
          await Store.Attachments.put({ id: attId, name: pendingFile.name, type: pendingFile.type, dataUrl });
          out.attachmentId = attId;
          out.attachmentName = pendingFile.name;
          if (out.status === "Missing" || out.status === "Referenced") out.status = "Attached";
          if (out.receiptStatus === "Missing" || out.receiptStatus === "Referenced") out.receiptStatus = "Attached";
        } catch (e) { toast("Couldn't store the file: " + e.message, "error", 5000); }
      }
      opts.onSave && opts.onSave(out, m);
      m.close();
    });

    return m;
  }

  function initValues(fields, record, presets = {}) {
    const v = {};
    for (const f of fields) {
      if (f.type === "section") continue;
      if (record && record[f.key] !== undefined) { v[f.key] = record[f.key]; continue; }
      if (presets[f.key] !== undefined) { v[f.key] = presets[f.key]; continue; }
      if (f.defaultFromSettings && Store.state.settings[f.defaultFromSettings]) { v[f.key] = Store.state.settings[f.defaultFromSettings]; continue; }
      if (f.default !== undefined) { v[f.key] = typeof f.default === "function" ? f.default() : f.default; continue; }
      v[f.key] = f.type === "checkbox" ? false : "";
    }
    return v;
  }

  function fieldHtml(f, values) {
    if (f.type === "section") return `<div class="form-section-title">${U.escapeHtml(f.label)}</div>`;
    if (f.showIf && !f.showIf(values)) return "";
    const val = values[f.key] ?? "";
    const span = f.span2 || f.type === "textarea" ? "span-2" : "";
    const req = f.required ? '<span class="req"> *</span>' : "";
    const hint = f.hint ? `<div class="hint">${U.escapeHtml(f.hint)}</div>` : "";
    const label = `<label for="fld-${f.key}">${U.escapeHtml(f.label)}${req}</label>`;
    const actionBtn = (f.actionBtn && (!f.actionBtn.showIf || f.actionBtn.showIf(values))) ? `<button type="button" class="btn btn-sm" data-field-action="${f.key}" style="margin-top:6px">${U.escapeHtml(f.actionBtn.label)}</button>` : "";
    const wrap = inner => `<div class="field ${span}" data-field-wrap="${f.key}">${label}${inner}${actionBtn}${hint}</div>`;
    const esc = U.escapeHtml;

    switch (f.type) {
      case "textarea":
        return wrap(`<textarea id="fld-${f.key}" data-key="${f.key}" placeholder="${esc(f.placeholder || "")}">${esc(val)}</textarea>`);
      case "checkbox":
        return `<div class="field ${span}" data-field-wrap="${f.key}"><div class="checkbox-field">
          <input type="checkbox" id="fld-${f.key}" data-key="${f.key}" ${val ? "checked" : ""}>
          <label for="fld-${f.key}">${esc(f.label)}</label></div>${hint}</div>`;
      case "select": {
        const opts = (f.allowEmpty !== false ? [""] : []).concat(f.options || []);
        // keep imported/legacy values visible even if not in the options list
        if (val !== "" && val != null && !opts.some(o => String(o) === String(val))) opts.push(String(val));
        return wrap(`<select id="fld-${f.key}" data-key="${f.key}">
          ${opts.map(o => `<option value="${esc(o)}" ${String(val) === String(o) ? "selected" : ""}>${o === "" ? "—" : esc(o)}</option>`).join("")}</select>`);
      }
      case "peNumber": {
        const pes = (Store.state.settings.peNumbers || []).filter(p => p.number);
        if (!pes.length) {
          return wrap(`<input type="text" id="fld-${f.key}" data-key="${f.key}" value="${esc(val)}" placeholder="e.g. 0402068317">`);
        }
        const opts = pes.map(p => ({ v: p.number, label: (p.state ? p.state + " — " : "") + p.number }));
        if (val && !opts.some(o => o.v === val)) opts.push({ v: val, label: val });
        return wrap(`<select id="fld-${f.key}" data-key="${f.key}">
          <option value="">—</option>
          ${opts.map(o => `<option value="${esc(o.v)}" ${String(val) === String(o.v) ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select>`);
      }
      case "expenseCategory": {
        return wrap(`<select id="fld-${f.key}" data-key="${f.key}">
          <option value="">— select category —</option>
          ${SCHEMA.expenseCategoryNames.map(o => `<option value="${esc(o)}" ${val === o ? "selected" : ""}>${esc(o)}</option>`).join("")}
        </select>
        <div class="hint">Schedule C organizer line: <strong>${esc(val ? SCHEMA.scheduleCFor(val) : "select a category")}</strong></div>`);
      }
      case "client": {
        const clients = U.sortBy(Store.all("client"), c => (c.name || "").toLowerCase());
        return wrap(`<div style="display:flex;gap:7px">
          <select id="fld-${f.key}" data-key="${f.key}" style="flex:1">
            <option value="">—</option>
            ${clients.map(c => `<option value="${c.id}" ${val === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
          </select>
          <button class="btn btn-sm" data-quickadd-client title="Add new client" style="flex:none">+ New</button>
        </div>`);
      }
      case "workorder": {
        const wos = U.sortBy(Store.all("workOrder"), w => w.dateAssigned || "", -1);
        return wrap(`<select id="fld-${f.key}" data-key="${f.key}">
          <option value="">—</option>
          ${wos.map(w => `<option value="${w.id}" ${val === w.id ? "selected" : ""}>${esc((w.woNumber || "WO") + (w.clientId ? " — " + Store.clientName(w.clientId) : ""))}</option>`).join("")}
        </select>`);
      }
      case "invoice": {
        const invs = U.sortBy(Store.all("invoice"), i => i.invoiceDate || "", -1);
        return wrap(`<select id="fld-${f.key}" data-key="${f.key}">
          <option value="">—</option>
          ${invs.map(i => `<option value="${i.id}" ${val === i.id ? "selected" : ""}>${esc((i.invoiceNumber || "INV") + " — " + Store.clientName(i.clientId) + " — " + U.money(Store.invoiceTotal(i)))}</option>`).join("")}
        </select>`);
      }
      case "expense": {
        const exps = U.sortBy(Store.all("expense"), e => e.date || "", -1).slice(0, 100);
        return wrap(`<select id="fld-${f.key}" data-key="${f.key}">
          <option value="">—</option>
          ${exps.map(e => `<option value="${e.id}" ${val === e.id ? "selected" : ""}>${esc(`${U.fmtDate(e.date)} — ${e.vendor || "?"} — ${U.money(e.amount)}`)}</option>`).join("")}
        </select>`);
      }
      case "file":
        return wrap(`
          <input type="file" id="fld-${f.key}" data-key="${f.key}" accept="image/*,.pdf" hidden>
          <input type="file" id="fld-${f.key}-cam" data-key="${f.key}" accept="image/*" capture="environment" hidden>
          <div class="file-attach">
            <button type="button" class="btn" data-file-btn="fld-${f.key}-cam">📷 Take photo</button>
            <button type="button" class="btn" data-file-btn="fld-${f.key}">📁 Choose file</button>
          </div>
          <div class="file-preview" data-file-preview hidden></div>`);
      case "money":
        return wrap(`<input type="number" inputmode="decimal" step="0.01" min="0" id="fld-${f.key}" data-key="${f.key}" value="${esc(val)}" placeholder="${esc(f.placeholder || "0.00")}">`);
      case "percent":
        return wrap(`<input type="number" inputmode="numeric" step="1" min="0" max="100" id="fld-${f.key}" data-key="${f.key}" value="${esc(val)}">`);
      case "number":
        return wrap(`<input type="number" inputmode="decimal" step="${f.step || 1}" id="fld-${f.key}" data-key="${f.key}" value="${esc(val)}">`);
      case "date":
        return wrap(`<input type="date" id="fld-${f.key}" data-key="${f.key}" value="${esc(val)}">`);
      case "email": case "tel":
        return wrap(`<input type="${f.type}" id="fld-${f.key}" data-key="${f.key}" value="${esc(val)}" placeholder="${esc(f.placeholder || "")}">`);
      default:
        return wrap(`<input type="text" id="fld-${f.key}" data-key="${f.key}" value="${esc(val)}" placeholder="${esc(f.placeholder || "")}">`);
    }
  }

  /* ================= Generic list view ================= */
  /**
   * listView(container, cfg)
   * cfg: {
   *   data: () => rows,
   *   columns: [{label, value(r) → text, html(r) → html, num, sortVal(r)}],
   *   searchText(r) → string,
   *   filters: [{id, label, options: [{value,label}] | () => [...], apply(r, val) → bool}],
   *   defaultSort: {col: index, dir: 1|-1},
   *   onRow(r), rowClass(r),
   *   card(r) → html (mobile),
   *   empty: {…emptyState args, onAction},
   *   toolbarExtra: html,
   * }
   */
  function listView(container, cfg) {
    const stateLV = { q: "", filters: {}, sortCol: cfg.defaultSort ? cfg.defaultSort.col : 0, sortDir: cfg.defaultSort ? cfg.defaultSort.dir : -1 };

    function rows() {
      let rs = cfg.data();
      if (stateLV.q) {
        const q = stateLV.q.toLowerCase();
        rs = rs.filter(r => (cfg.searchText ? cfg.searchText(r) : JSON.stringify(r)).toLowerCase().includes(q));
      }
      for (const f of cfg.filters || []) {
        const val = stateLV.filters[f.id];
        if (val) rs = rs.filter(r => f.apply(r, val));
      }
      const col = cfg.columns[stateLV.sortCol];
      if (col) {
        const fn = col.sortVal || col.value || (r => "");
        rs = U.sortBy(rs, r => { const v = fn(r); return typeof v === "string" ? v.toLowerCase() : v; }, stateLV.sortDir);
      }
      return rs;
    }

    function render() {
      const rs = rows();
      const filterSelects = (cfg.filters || []).map(f => {
        const opts = typeof f.options === "function" ? f.options() : f.options;
        return `<select data-filter="${f.id}">
          <option value="">${U.escapeHtml(f.label)}: All</option>
          ${opts.map(o => {
            const val = typeof o === "object" ? o.value : o;
            const lb = typeof o === "object" ? o.label : o;
            return `<option value="${U.escapeHtml(val)}" ${stateLV.filters[f.id] === String(val) ? "selected" : ""}>${U.escapeHtml(lb)}</option>`;
          }).join("")}</select>`;
      }).join("");

      container.innerHTML = `
        <div class="toolbar">
          <div class="search-box"><input type="text" placeholder="Search…" value="${U.escapeHtml(stateLV.q)}" data-lv-search></div>
          ${filterSelects}
          ${cfg.toolbarExtra || ""}
          <span style="margin-left:auto;font-size:12px;color:var(--text-3);flex:none">${rs.length} record${rs.length === 1 ? "" : "s"}</span>
        </div>
        ${rs.length === 0 ? emptyState(cfg.empty || {}) : `
        <div class="hide-mobile-table">
          <div class="table-wrap"><table class="data-table">
            <thead><tr>${cfg.columns.map((c, i) => `
              <th data-col="${i}" class="${c.num ? "num" : ""}">${U.escapeHtml(c.label)}
                ${stateLV.sortCol === i ? `<span class="sort-arrow">${stateLV.sortDir > 0 ? "▲" : "▼"}</span>` : ""}</th>`).join("")}
            </tr></thead>
            <tbody>${rs.map((r, ri) => `
              <tr data-row="${ri}" class="${cfg.rowClass ? cfg.rowClass(r) : ""}">
                ${cfg.columns.map(c => `<td class="${c.num ? "num" : ""}">${c.html ? c.html(r) : U.escapeHtml(String(c.value ? c.value(r) : ""))}</td>`).join("")}
              </tr>`).join("")}</tbody>
          </table></div>
          <div class="record-cards">${rs.map((r, ri) => `<div data-row="${ri}">${cfg.card ? cfg.card(r) : defaultCard(cfg, r)}</div>`).join("")}</div>
        </div>`}`;

      // wire
      const search = container.querySelector("[data-lv-search]");
      if (search) search.addEventListener("input", U.debounce(e => { stateLV.q = e.target.value; render(); restoreFocus(); }, 200));
      container.querySelectorAll("[data-filter]").forEach(sel => sel.addEventListener("change", e => {
        stateLV.filters[sel.getAttribute("data-filter")] = e.target.value; render();
      }));
      container.querySelectorAll("th[data-col]").forEach(th => th.addEventListener("click", () => {
        const i = Number(th.getAttribute("data-col"));
        if (stateLV.sortCol === i) stateLV.sortDir *= -1; else { stateLV.sortCol = i; stateLV.sortDir = -1; }
        render();
      }));
      if (cfg.onRow) container.querySelectorAll("[data-row]").forEach(el => el.addEventListener("click", e => {
        if (e.target.closest("[data-lv-stop]")) return; // in-row action controls handle their own clicks
        cfg.onRow(rs[Number(el.getAttribute("data-row"))]);
      }));
      if (cfg.empty && cfg.empty.actionId && cfg.empty.onAction) {
        const btn = container.querySelector(`#${cfg.empty.actionId}`);
        if (btn) btn.addEventListener("click", cfg.empty.onAction);
      }
      function restoreFocus() {
        const s = container.querySelector("[data-lv-search]");
        if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
      }
    }

    render();
    return { refresh: render };
  }

  function defaultCard(cfg, r) {
    const [c0, c1, ...rest] = cfg.columns;
    return `<div class="record-card">
      <div class="record-card-top">
        <div class="record-card-title">${c0.html ? c0.html(r) : U.escapeHtml(String(c0.value ? c0.value(r) : ""))}</div>
        <div>${c1 ? (c1.html ? c1.html(r) : U.escapeHtml(String(c1.value ? c1.value(r) : ""))) : ""}</div>
      </div>
      <div class="record-card-meta">${rest.slice(0, 4).map(c => {
        const v = c.html ? c.html(r) : U.escapeHtml(String(c.value ? c.value(r) : ""));
        return v && v !== "—" ? `<span style="font-size:12px;color:var(--text-2)">${v}</span>` : "";
      }).filter(Boolean).join('<span style="color:var(--border-strong)">·</span>')}</div>
    </div>`;
  }

  /* ================= Attachment viewer ================= */
  async function viewAttachment(attachmentId, title = "Attachment") {
    const att = await Store.Attachments.get(attachmentId).catch(() => null);
    const m = modal({
      title: `📎 ${U.escapeHtml(title)}`,
      size: "lg",
      body: att
        ? (att.type === "application/pdf"
          ? `<embed src="${att.dataUrl}" type="application/pdf" style="width:100%;height:70vh;border-radius:10px">`
          : `<img src="${att.dataUrl}" style="max-width:100%;border-radius:10px;display:block;margin:0 auto" alt="Attachment">`)
        : `<div class="empty-state"><div class="es-icon">🫥</div><div class="es-title">Attachment not found</div><div class="es-sub">It may have been cleared from this browser. Restore a JSON backup that includes attachments.</div></div>`,
      footer: `${att ? `<a class="btn btn-left" id="att-download" download="${U.escapeHtml(att.name || "attachment")}" href="${att.dataUrl}">⬇️ Download</a>` : ""}
               <button class="btn" id="att-close">Close</button>`,
    });
    m.footerEl.querySelector("#att-close").addEventListener("click", () => m.close());
    return m;
  }

  /* ================= Bottom sheet ================= */
  function sheet({ title, items }) {
    const root = document.getElementById("sheet-root");
    root.innerHTML = `
      <div class="sheet-backdrop"></div>
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">${U.escapeHtml(title)}</div>
        <div class="sheet-grid">${items.map((it, i) => `
          <button class="sheet-item" data-sheet-item="${i}">
            <span class="si-icon">${it.icon}</span><span>${U.escapeHtml(it.label)}</span>
          </button>`).join("")}</div>
      </div>`;
    const close = () => { root.innerHTML = ""; };
    root.querySelector(".sheet-backdrop").addEventListener("click", close);
    root.querySelectorAll("[data-sheet-item]").forEach(btn => btn.addEventListener("click", () => {
      close();
      items[Number(btn.getAttribute("data-sheet-item"))].action();
    }));
    return { close };
  }

  /* ================= Print isolation ================= */
  /**
   * Print ONLY the given element: it's cloned into #print-root and the rest
   * of the app is hidden for the duration, so the PDF contains just the
   * document — no page/dashboard front matter.
   */
  function printDoc(el) {
    if (!el) { window.print(); return; }
    const root = document.getElementById("print-root");
    root.innerHTML = "";
    const clone = el.cloneNode(true);
    clone.querySelectorAll(".no-print").forEach(x => x.remove());
    root.appendChild(clone);
    document.body.classList.add("print-mode");
    const cleanup = () => {
      document.body.classList.remove("print-mode");
      root.innerHTML = "";
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    setTimeout(cleanup, 60000); // safety net if afterprint never fires
    window.print();
  }

  /* ================= Misc ================= */
  const disclaimerHtml = () => `<div class="disclaimer"><strong>Disclaimer:</strong> ${U.escapeHtml(SCHEMA.DISCLAIMER)}</div>`;

  const linkChip = (route, text) => `<a href="#/${route}" style="text-decoration:none">${badge(text, "accent")}</a>`;

  return {
    toast, modal, confirm, badge, statusBadge, statCard, emptyState, pageHeader,
    detailGrid, openForm, listView, sheet, disclaimerHtml, linkChip, viewAttachment, printDoc,
  };
})();
