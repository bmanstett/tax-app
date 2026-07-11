/* =========================================================
   app.js — router, navigation, quick-add, theme, save
   indicator, first-run welcome. Load order: last.
   ========================================================= */
"use strict";

const App = (() => {

  const NAV = [
    { group: "Overview", items: [
      { route: "dashboard", icon: "📊", label: "Dashboard" },
    ]},
    { group: "Operations", items: [
      { route: "workorders", icon: "📋", label: "Work Orders" },
      { route: "clients", icon: "🏢", label: "Clients" },
      { route: "invoices", icon: "🧾", label: "Invoices" },
    ]},
    { group: "Money", items: [
      { route: "income", icon: "💵", label: "Income" },
      { route: "expenses", icon: "💳", label: "Expenses" },
      { route: "mileage", icon: "🚗", label: "Mileage" },
      { route: "receipts", icon: "📎", label: "Receipts" },
    ]},
    { group: "Tax & Assets", items: [
      { route: "assets", icon: "🛠️", label: "Assets" },
      { route: "homeoffice", icon: "🏠", label: "Home Office" },
      { route: "contractors", icon: "👷", label: "Contractors" },
      { route: "taxes", icon: "🏛️", label: "Taxes" },
    ]},
    { group: "Records", items: [
      { route: "reports", icon: "📦", label: "Reports & Exports" },
      { route: "audit", icon: "📜", label: "Audit Trail" },
      { route: "settings", icon: "⚙️", label: "Settings & Backup" },
    ]},
  ];
  const BOTTOM = ["dashboard", "workorders", "expenses", "mileage"];

  let currentRoute = "dashboard";
  let viewYearState = null;

  /* ---------- year handling ---------- */
  function viewYear() { return viewYearState ?? Store.state.settings.taxYear ?? new Date().getFullYear(); }

  function yearsWithData() {
    const ys = new Set([viewYear(), new Date().getFullYear(), Store.state.settings.taxYear]);
    for (const r of Store.state.income) { const y = U.yearOf(r.date); if (y) ys.add(y); }
    for (const r of Store.state.expenses) { const y = U.yearOf(r.date); if (y) ys.add(y); }
    for (const r of Store.state.mileage) { const y = U.yearOf(r.date); if (y) ys.add(y); }
    return [...ys].filter(Boolean).sort((a, b) => b - a);
  }

  function yearPickerHtml() {
    return `<select id="year-picker" class="btn" style="padding-right:28px" title="Tax year in view">
      ${yearsWithData().map(y => `<option value="${y}" ${y === viewYear() ? "selected" : ""}>Tax year ${y}${Store.isYearLocked(y) ? " 🔒" : ""}</option>`).join("")}
    </select>`;
  }

  /* ---------- routing ---------- */
  function go(route) {
    if (!Views[route]) route = "dashboard";
    currentRoute = route;
    if (location.hash !== "#/" + route) history.replaceState(null, "", "#/" + route);
    render();
  }

  function render() {
    const main = document.getElementById("main");
    main.scrollTop = 0; window.scrollTo(0, 0);
    const view = Views[currentRoute] || Views.dashboard;
    document.getElementById("mobile-title").textContent = view.title;
    try {
      view.render(main);
    } catch (e) {
      console.error(e);
      main.innerHTML = `<div class="card"><div class="card-title">Something went wrong rendering this page</div>
        <div class="card-sub">${U.escapeHtml(e.message)}</div>
        <button class="btn" onclick="App.go('dashboard')">Back to dashboard</button></div>`;
    }
    const yp = main.querySelector("#year-picker");
    if (yp) yp.addEventListener("change", e => { viewYearState = Number(e.target.value); render(); });
    refreshNav();
  }

  function rerender() { render(); }

  /* ---------- navigation chrome ---------- */
  function refreshNav() {
    const attentionCount = Alerts.attention(viewYear()).reduce((t, a) => t + (a.severity !== "info" ? a.count : 0), 0);

    document.getElementById("sidebar-nav").innerHTML = NAV.map(g => `
      <div class="nav-group-label">${g.group}</div>
      ${g.items.map(it => `
        <a class="nav-item ${currentRoute === it.route ? "active" : ""}" href="#/${it.route}">
          <span class="nav-icon">${it.icon}</span>${it.label}
          ${it.route === "dashboard" && attentionCount ? `<span class="nav-badge">${attentionCount}</span>` : ""}
        </a>`).join("")}
    `).join("");

    const allItems = NAV.flatMap(g => g.items);
    document.getElementById("bottom-nav").innerHTML =
      BOTTOM.map(r => {
        const it = allItems.find(x => x.route === r);
        return `<a class="bnav-item ${currentRoute === r ? "active" : ""}" href="#/${r}">
          <span class="bn-icon">${it.icon}</span>${it.label.split(" ")[0]}</a>`;
      }).join("") +
      `<a class="bnav-item ${!BOTTOM.includes(currentRoute) ? "active" : ""}" href="#" id="bnav-more">
        <span class="bn-icon">☰</span>More</a>`;

    const more = document.getElementById("bnav-more");
    if (more) more.addEventListener("click", e => {
      e.preventDefault();
      UI.sheet({
        title: "All sections",
        items: allItems.filter(x => !BOTTOM.includes(x.route)).map(it => ({
          icon: it.icon, label: it.label, action: () => go(it.route),
        })),
      });
    });
  }

  /* ---------- quick add ---------- */
  function quickAdd() {
    UI.sheet({
      title: "Quick add",
      items: [
        { icon: "💳", label: "Expense", action: () => Expenses.openEditor(null) },
        { icon: "🚗", label: "Inspection trip", action: () => Mileage.quickTrip() },
        { icon: "🛣️", label: "Mileage (full)", action: () => Mileage.openEditor(null) },
        { icon: "📋", label: "Work order", action: () => WO.openEditor(null) },
        { icon: "📄", label: "Import WO PDF", action: () => ImportWO.openImportModal() },
        { icon: "🧾", label: "Invoice", action: () => Invoices.openEditor(null, { invoiceNumber: `INV-${viewYear()}-${String(Store.all("invoice").length + 1).padStart(3, "0")}` }) },
        { icon: "💵", label: "Income / payment", action: () => Income.openEditor(null) },
        { icon: "📎", label: "Receipt / document", action: () => Receipts.openEditor(null) },
        { icon: "🏛️", label: "Tax payment", action: () => Taxes.addPayment() },
        { icon: "🏢", label: "Client", action: () => Clients.openEditor(null) },
      ],
    });
  }

  /* ---------- theme ---------- */
  function setTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    Store.state.settings.theme = t;
    Store.save();
  }
  function toggleTheme() {
    setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
  }

  /* ---------- first run ---------- */
  function firstRunWelcome() {
    const m = UI.modal({
      title: "👋 Welcome to your Books & Tax Organizer",
      size: "sm",
      body: `
        <p style="font-size:14px;line-height:1.6;margin:0 0 12px">Purpose-built for <strong>Anstett Consulting, LLC</strong> — work orders, invoices, income, expenses, mileage, receipts, and quarterly taxes, all organized for a clean CPA hand-off.</p>
        <p style="font-size:13px;color:var(--text-2);margin:0 0 12px">Your data stays <strong>in this browser</strong> (localStorage + IndexedDB). Nothing is uploaded anywhere. Export JSON backups regularly from Settings.</p>
        <div class="disclaimer" style="margin:0 0 4px;font-size:11.5px">${U.escapeHtml(SCHEMA.DISCLAIMER)}</div>`,
      footer: `<button class="btn" id="fr-fresh">Start fresh</button>
               <button class="btn btn-primary" id="fr-demo">Load demo data</button>`,
      onClose: () => {},
    });
    m.footerEl.querySelector("#fr-fresh").addEventListener("click", () => {
      Store.state.demoDataLoaded = false; Store.save(); m.close(); render();
    });
    m.footerEl.querySelector("#fr-demo").addEventListener("click", () => {
      Demo.load(); m.close(); UI.toast("Demo data loaded — clear it anytime in Settings", "success", 4000); render();
    });
  }

  /* ---------- init ---------- */
  function init() {
    // PWA: offline cache + fresh-code-when-online (no-op on file://)
    if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register("sw.js").catch(e => console.warn("Service worker registration failed:", e));
    }
    // Ask the browser not to evict localStorage/IndexedDB under storage pressure
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

    Store.load();
    Sync.init();
    setTheme(Store.state.settings.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));

    // save indicator
    const indicator = document.getElementById("save-indicator");
    const indicatorText = document.getElementById("save-indicator-text");
    Store.onSave(when => {
      indicator.classList.remove("saving");
      indicatorText.textContent = "Saved " + when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    });

    // routing
    window.addEventListener("hashchange", () => {
      const r = location.hash.replace(/^#\//, "") || "dashboard";
      if (r !== currentRoute) { currentRoute = Views[r] ? r : "dashboard"; render(); }
    });
    currentRoute = (() => {
      const r = location.hash.replace(/^#\//, "");
      return Views[r] ? r : "dashboard";
    })();

    document.getElementById("theme-toggle").addEventListener("click", toggleTheme);
    document.getElementById("theme-toggle-mobile").addEventListener("click", toggleTheme);
    document.getElementById("fab").addEventListener("click", quickAdd);

    // keyboard: "n" for quick add when not typing
    document.addEventListener("keydown", e => {
      if (e.key === "n" && !e.metaKey && !e.ctrlKey && !e.altKey &&
          !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) &&
          !document.getElementById("modal-root").children.length) {
        e.preventDefault(); quickAdd();
      }
    });

    render();

    // first-run experience
    const hasData = Store.state.workOrders.length || Store.state.expenses.length || Store.state.income.length || Store.state.clients.length;
    if (!hasData && !Store.state.demoDataLoaded && !localStorage.getItem("anstett_welcomed")) {
      localStorage.setItem("anstett_welcomed", "1");
      firstRunWelcome();
    } else if (Store.backupDue() && hasData) {
      setTimeout(() => UI.toast("💾 Backup reminder — export a JSON backup from Settings", "default", 5000), 1200);
    }
  }

  document.addEventListener("DOMContentLoaded", init);

  return { go, rerender, render, viewYear, yearsWithData, yearPickerHtml, refreshNav, quickAdd };
})();
