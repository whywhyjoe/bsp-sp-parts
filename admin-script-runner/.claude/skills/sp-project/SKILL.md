---
name: sp-project
description: This repo is a SharePoint two-tenant project. Read env.json for what it needs; use tools/sp for provision/verify/deploy/test; ALL environment rules, conventions, and runbooks are in the global sp-env skill — read it first.
---

# sp-project (thin pointer)

This repo follows the sp-env system. Everything you need to know lives in the
GLOBAL skill `sp-env` (~/.claude/skills/sp-env) — the hard verification rule,
environment facts, name resolution, and runbooks. Read it before any work here.

- `env.json` — what this project needs (logical names only; never URLs).
- `env.local.json` — gitignored, this machine; scripts refuse to run without it.
- `tools/sp/` — deploy.ps1 (copy mode), bootstrap-dev.ps1 (one-time dev),
  reset-dev.ps1, run-harness.js (Playwright, dev), resolve.js (stamped copy).
- `app/` — everything deployed to the scripts library: harness.js + ops
  (provision.js / verify.js / test-*.js), loader.js + app.js.

Dev loop: deploy → (first time: bootstrap-dev) → `node tools/sp/run-harness.js
provision` → `… verify` (zero drift) → `… test-smoke` → read the TestRuns rows
run-harness prints. Verification is YOURS via Playwright + TestRuns readback —
never the user's.
