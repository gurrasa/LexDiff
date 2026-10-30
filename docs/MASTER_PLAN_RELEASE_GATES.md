# LexDiff master plan: release-gate audit and remaining work

Status: **Open; not production-ready.** Reference: `LexDiff_Consolidated_Changes_Master_Plan(4).md`, LDX-01–LDX-29. This document does not certify legal or contract security.

## What this patch fixes
- **LDX-11 / T13–T14:** Structural evidence that `refund()` checks a deadline and pays a client is now `Inconclusive`, **not `Pass`**, until scenario-based execution evidence exists. Missing or clearly deficient refund structures still fail.
- **LDX-12 / T15:** Absence of the old named admin function now yields an `Inconclusive` finding for the original property key, **never `Pass`** or `FixVerified`. Detecting absence of privileged capability requires independent analysis/tests, including renamed, inherited, delegatecall and proxy paths.
- Adds regression assertions in `cre/lexdiff-workflow/compare.test.ts`.

## P0 (must finish before real-money or legal reliance)
| ID | Status after this patch | Required acceptance work |
|---|---|---|
| LDX-01 | Partial | Confirm forwarder/workflow identity in production and rejection of forged/replayed reports; isolate simulated workflows |
| LDX-02 | Partial | Case-scoped confidential permissions, access audit, reliable shared storage, export controls |
| LDX-03 | Open | Affected counterparty approval for specifications, amendments and material replacements |
| LDX-04 | Partial | Separate receipt, limited risk declaration, waiver, amendment and dispute semantics |
| LDX-05 | Open | Signer capacity, represented entity, authority evidence, dual-role safeguard |
| LDX-06 | Partial | Rotate exposed secrets, history cleanup strategy, content-aware secret scanner in CI |
| LDX-07 | Open | Require legal/operational/funds-migration evidence before declaring replacement active |
| LDX-08 | Partial | Classify facts, party statements, technical observations and legal questions across UI/reports |
| LDX-09 | Open | Nonselective, scope-disclosing case exports; keep adverse/unknown issues visible |

## P1 (controlled pilot)
| ID | Status after this patch | Required work |
|---|---|---|
| LDX-10 | Partial | Material clause inventory, exact quotes, approved interpretation and coverage links |
| LDX-11 | Partial, safer result | Behavioral refund scenarios: caller, amount, token, boundaries, repeat, insufficient funds |
| LDX-12 | Partial, safer result | Capability-level admin tests, inherited/renamed/indirect/proxy reachability |
| LDX-13 | Partial | Block-scoped runtime code/proxy/checker/chain provenance and upgrade invalidation |
| LDX-14 | Partial | Six separate technical, remediation, risk, legal, operational, incident statuses |
| LDX-15 | Partial | Developer scope acceptance, deadlines, evidence and explicit recheck |
| LDX-16 | Open | Notice, delivery, response, objections and chronology |
| LDX-17 | Partial | Legal limits and authority plus exact signed consequences at decision time |
| LDX-18 | Partial | Role-specific queues, accessibility, outstanding risk indicators |
| LDX-19 | Open | Authenticated, lawyer-readable sourced PDF Case Record, A–I sections |
| LDX-20 | Partial | Frozen evidence snapshots with manifests and missing/conflicted sources |
| LDX-21 | Open | Case-record identity/authority qualification and complete provenance |
| LDX-22 | Open | Actual redaction bytes, audience controls, preview and export audit |
| LDX-23 | Partial | Governing law, notice rules, forum, historic claims and losses |

## P2 (maturity)
| ID | Status | Required work |
|---|---|---|
| LDX-24 | Open | JSON evidence ZIP, independently verifiable manifest, derivative-labelled DOCX |
| LDX-25 | Open | Authorized dispute-resolution workspace |
| LDX-26 | Open | Scheduled/change-triggered checks |
| LDX-27 | Open | Retention, deletion, privacy, disclosure lifecycle |
| LDX-28 | Open | Versioned contract-family check modules |
| LDX-29 | Open | Explicit human-approved source-grounded AI narrative |

## Deployment blockers beyond the plan
- In-memory wallet challenge map is not suitable for multi-instance deployment; use an atomic shared TTL store and request throttles.
- Local files for evidence and registrations are not a durable/shared transactional database.
- Relayer needs spending quotas/budgets, operational monitoring and stronger abuse prevention.
- CRE token is too broadly scoped to generic structured terms; validate report-to-agreement binding and report schema.
- CRE npm audit reported **two high advisories** involving Zod 3 supplied by the CRE SDK; review upstream compatibility; do not blindly force Zod 4.
- Secrets removed from new commits may still exist in old Git history; rotate any previously exposed credentials.

## Exact validation steps before commit
From repository root on `security/lexdiff-hardening`:

```powershell
cd cre\lexdiff-workflow
npx tsc --noEmit
npm test
cd ..\..
cd web
npx next typegen
npx tsc --noEmit
npx tsx --test tests/api/evidence-security.test.ts tests/api/registration-auth.test.ts
npm run build
cd ..
git branch --show-current
git diff --check
git diff --cached --check
node scripts/check-secrets.mjs
```

**Do not deploy/merge as production-ready** until P0 acceptance tests, consent, on-chain trust and privacy gates pass. All this patch's CRE results are unverified until run in your environment.
