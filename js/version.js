/* =========================================================
   version.js — the deployed build stamp, and the ONLY place
   to bump a version. The running app re-fetches this very
   file in the background and, when the two stop matching,
   tells you a new version is waiting. Loaded first.
   ========================================================= */
"use strict";

const APP_BUILD = {
  version: "2026.09.29-1",
  notes: "Ledger now matches work orders by P# only: a new P# on a claim you already have (like P#21688 on the Grace claim) is added as its own job instead of being filed onto the older one. On its next check it adds P#21688, moves that work-order PDF off P#21548, and re-links P#21548 to its own folder.",
};
