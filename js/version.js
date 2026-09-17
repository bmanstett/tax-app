/* =========================================================
   version.js — the deployed build stamp, and the ONLY place
   to bump a version. The running app re-fetches this very
   file in the background and, when the two stop matching,
   tells you a new version is waiting. Loaded first.
   ========================================================= */
"use strict";

const APP_BUILD = {
  version: "2026.09.16-3",
  notes: "Ledger (work-order inbox): jobs filed by Dispatch and FCGA revisions land in the app automatically, and each job folder's agent log records it. Work-order import no longer mixes a wrapped carrier name into the claim or policy number.",
};
