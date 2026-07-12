# Anstett Consulting, LLC — Books & Tax Organizer

A purpose-built, local-first accounting and tax-tracking web app for a forensic engineering PLLC.
Think: lightweight QuickBooks + TurboTax organizer + IRS-grade mileage log + invoice tracker +
forensic engineering work-order tracker — in one fast, mobile-friendly static app.

> **Disclaimer:** This app is for bookkeeping, record organization, audit-readiness, and tax
> planning support only. It does not provide legal, accounting, or tax advice, and does not
> guarantee IRS acceptance of any deduction, position, or filing treatment. Confirm all final
> tax decisions with a qualified CPA or tax professional.

## Run it

No build, no install, no backend, no login:

- **Simplest:** double-click `index.html` (works from `file://`).
- **Local server (recommended for receipt attachments on some browsers):**
  `python -m http.server 8741` in this folder, then open http://localhost:8741
- **Deploy:** upload the folder to any static host (GitHub Pages, Netlify, Cloudflare Pages, S3).

> Data is stored **per browser, per address**. If you switch between `file://` and `localhost`,
> each has its own data — use JSON export/import to move it.

## Install on your phone (PWA)

The app is a Progressive Web App (`manifest.webmanifest` + `sw.js`): host it anywhere over
HTTPS, open the URL on your phone, and add it to the home screen — it then launches full-screen
like a native app and works offline (service worker caches the app shell, network-first, so new
deploys are picked up automatically on the next online launch).

1. **Host it** — e.g. GitHub Pages: push this folder to a repo, enable Pages
   (Settings → Pages → deploy from branch). Netlify/Cloudflare Pages also work.
2. **iPhone:** open the URL in Safari → Share → **Add to Home Screen**.
   **Android:** open in Chrome → menu → **Add to Home screen / Install app**.
3. **Updates:** push new code to the host; the installed app fetches fresh files the next time
   it opens with a connection. Your data is untouched (it lives on the phone, not in the code).
4. **Data lives per device.** Move data between desktop and phone with
   Settings → **Export JSON backup** (includes receipt attachments) → import on the other device.

## Automatic phone ↔ desktop sync

**Settings → ☁️ Phone & desktop sync.** All devices stay on the same books automatically —
work orders, expenses, receipts (attachments included), everything. Data is stored in a
**private GitHub repository** (`tax-app-data`) that only your account can see; it also acts
as an off-device backup with full history (every sync is a git commit).

- **Setup (once per device):** create one fine-grained GitHub token (the Settings card walks
  you through it — token scoped to just the data repo, Contents read/write), then paste it
  into Settings on each device and hit *Turn on sync*.
- **When it syncs:** on app open, a few seconds after every change, when the app regains
  focus/network, and every 4 minutes while open. Tap the ☁️ in the mobile top bar to force one.
- **How conflicts resolve:** merged per record — the newest edit of each work order/expense/etc.
  wins; deletions on one device propagate to the others (tombstones). Nothing is ever
  overwritten wholesale.
- **Safety rails:** sync refuses to write to a public repo, and the token is stored only on
  the device (never in JSON backups or the synced data).

## First run

You'll be offered **demo data** — realistic sample work orders, invoices, expenses, and trips
(with intentional documentation gaps so you can see the alerts and readiness scores in action).
Clear it anytime: **Settings → Clear ALL data**, then start fresh.

## What's inside

| Section | What it does |
|---|---|
| **Dashboard** | YTD income/expenses/net, tax reserve estimates, invoice aging, readiness scores, "what needs attention" |
| **Work Orders** | Full forensic-engineering job tracker (claim/policy/CAT, insured, loss location, scope, fees, remittance) with **one-tap status changes** (tap the status badge in the list, or the status pipeline in the job detail — dates like report-submitted/invoice/payment are stamped automatically), due-date alerts, quick actions (add mileage/expense/receipt, create invoice, duplicate, export summary) — plus **📄 Import FCGA PDF**: drop an FCGA "Engineer Work Order Form" PDF and every field is parsed into a pre-filled work order (see below) |
| **Clients** | Rates, terms, W-9/1099 flags, profitability, average payment time, 1099 reconciliation status |
| **Invoices** | Flat/hourly billing + mileage & expense reimbursements, aging, partial payments, printable invoice, income reconciliation |
| **Income** | All money in, 1099 tracking, and the **1099 Reconciliation tool** (compare 1099s received vs. recorded income) |
| **Expenses** | Schedule C-style categories, business purpose, **receipt upload right on the expense form** (📷 Take photo / 📁 Choose file with preview) plus **one-tap 📎 Attach on every expense row/card** — no need to open the form; attached receipts open in a viewer from the list; business-use %, reimbursable tracking, CPA-review flags |
| **Mileage** | Field-optimized **⚡ Quick trip** logging, odometer support, per-year IRS rate, substantiation score, CSV log export |
| **Receipts** | Attach photos/PDFs (stored locally in IndexedDB) or reference cloud/paper locations; missing-receipt report |
| **Assets** | Equipment purchases flagged for depreciation / Section 179 CPA review |
| **Home Office** | Square footage, simplified/actual-method inputs, CPA notes — organizer only |
| **Contractors** | Payments, W-9 status, automatic $600 1099-NEC flagging (payments mirror into expenses) |
| **Taxes** | Quarterly estimated payment tracker with due dates, configurable reserve percentages, year-end checklist, **year lock** |
| **Reports** | 20+ printable reports incl. the **CPA Year-End Packet** and **IRS Audit-Readiness Packet** (Print → Save as PDF) |
| **Audit Trail** | Field-level before/after history of every create/edit/delete |
| **Settings** | Business profile, tax assumptions, mileage rates by year, JSON backup/restore, integrity check, duplicate finder |

## FCGA work order import

**Work Orders → 📄 Import FCGA PDF** (also in the quick-add ➕ menu):

- Drop or pick the FCGA work order PDF. Parsing happens **entirely in the browser** —
  nothing is uploaded anywhere (uses the browser's built-in `DecompressionStream`).
- All form fields are extracted: project number (becomes `P#xxxxx`), dates, claim/policy,
  carrier + carrier contact, insured info, loss location, scope, fee ("Flat Fee 2 $1300.00" →
  $1,300 flat fee), mileage authorization ("Yes, not to exceed 145 miles… ($102)"), and
  remittance instructions.
- The standard work-order form opens **pre-filled for review** — nothing saves until you hit Add.
- The client is auto-set to **FCG Associates (FCGA)** (created on first import), duplicates are
  detected by project/claim number, and after saving, the **original PDF is attached** to the
  job's documents for your audit trail.
- Scanned or copy-protected PDF? Use the **paste-text fallback** in the same dialog
  (open the PDF, Ctrl+A, Ctrl+C, paste).

## State-specific PE numbers

**Settings → Business profile → PE numbers by state**: one row per license (e.g. `VA — 0402068317`).
Work-order forms show them as a labeled dropdown, and PDF imports pick the form's PE number
(or match the loss-location state if the form has none).

## Data & backups

- Auto-saves to `localStorage` after every change ("Saved…" indicator in the sidebar).
- Receipt images/PDFs are resized and stored in IndexedDB.
- **Settings → Export JSON backup** downloads everything (including attachments). Store copies
  off this machine. Restore validates the file and requires typed confirmation.
- Versioned schema (`schemaVersion`) so future updates can migrate old backups.

## Tech

Vanilla HTML/CSS/JS. Zero dependencies. Hand-rolled SVG charts. Schema-driven forms and lists
(`js/schemas.js` defines every entity; `js/ui.js` renders forms/tables/cards from those schemas).

```
index.html
css/styles.css        design system, light/dark, responsive, print styles
js/utils.js           helpers (dates, money, CSV, diff)
js/schemas.js         entity fields, categories, statuses, Schedule C mapping
js/store.js           persistence, CRUD + audit trail, tax math, backup, IndexedDB
js/charts.js          SVG bar/line/donut/score-ring/gauge charts
js/ui.js              modals, toasts, form builder, list views
js/alerts.js          attention engine + CPA/audit/health scores
js/demo.js            sample data
js/views/*.js         one file per section
js/app.js             router, nav, quick-add, theme
```

## Yearly maintenance

1. Each January: set the new **IRS standard mileage rate** in Settings (verify at irs.gov).
2. Review reserve percentages with your CPA.
3. At year-end: run the checklist on the Taxes page → export the **CPA packet** → export a
   **JSON backup** → **lock the year**.
