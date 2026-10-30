# LexDiff — delivery status / safety gates (not a production certification)

Updated against `LexDiff_Consolidated_Changes_Master_Plan(5).md`.

This patch is an incremental implementation, not completion of LDX-01–LDX-22.

## Delivered in this patch (locally modified source; verify in your branch)

- **LDX-04, LDX-05, LDX-07, LDX-08, LDX-17:** Explicit signing-page disclaimer that wallet control is not a verified legal identity, legal authority or counterparty consent. Replacement action clearly says registry update / re-verification and not migrated or active.
- **LDX-01, LDX-02:** CRE report-upload request must contain an internally consistent minimum report envelope (agreement ID, target address, terms/code hashes, outcomes). Does **not** establish that a specific CRE workflow produced the report or that the on-chain agreement matches it.
- **LDX-19–LDX-21:** Printable Legal Case Record from a complete existing case-record JSON snapshot, structured in sections A–I, with an immutable content fingerprint, direct evidence hash checks, unresolved and missing source warnings and explicit verification/authority limitations. Use browser Print -> Save as PDF. Export is **an unredacted local derivative** and not intended for external disclosure.
- **LDX-09:** Render all current findings even if Pass/Fail/Inconclusive; report evidence completeness warnings. Does not prove entire on-chain historical completeness.
- Tests added for report envelope, malicious HTML escaping, nonselective findings and missing/tampered evidence.

## Explicit blockers still open

| IDs | Required additional work before production/legal reliance |
|---|---|
| LDX-01 | Authenticated on-chain production CRE DON/workflow and replay rejection, with adversarial contract tests |
| LDX-02, LDX-06 | Durable shared evidence store, granular role/case confidentiality, read/write audit events, real key rotation/history cleanup, content-aware secret scanner |
| LDX-03, LDX-04, LDX-05 | Contract and UI versioned counterparty consent, amendments/waivers, identity, representative capacity and authority evidence; contract redeployment/migration may be needed |
| LDX-07 | Contract-enforced operational activation and funded migration proof; historical funds must remain separately disclosed |
| LDX-08, LDX-09 | Structured legal assertion classification and historical completeness before claiming official or exhaustive case records |
| LDX-10–LDX-13 | Complete clause coverage and provenance, executable escrow refund scenario tests, full privileged capability analysis across proxies/inheritance |
| LDX-14–LDX-18 | Independent states, developer scope acceptance, notice/response evidence and proper party-specific workflows |
| LDX-19–LDX-22 | Server-authorized case export, recipient-specific true redaction, snapshot storage/manifest with cutoff and audit log, independent Sepolia verification, authentic PDF service and disclosure approvals |

## Non-negotiable limitations

The new browser printable record **does not** safely redact legal advice, confidential terms or identities; it cannot write an immutable server export audit and it cannot guarantee all historical chain activity has been collected. Do not distribute it outside authorized parties without independent approval. It does not provide an encrypted, tamper-evident server archive. It does not establish contract legality or any party's liability.

Wallet challenge storage remains process-local. Local file persistence is not a durable multi-instance database. Gas relayer requires persistent budgets. Two high severity advisories remain on SDK-pinned Zod. None of these issues is resolved by the new PDF print UI.

## Validate from Windows security branch

```powershell
if ((git branch --show-current) -ne 'security/lexdiff-hardening') { throw 'Wrong branch' }
cd web
npx next typegen
npx tsc --noEmit
npx tsx --test tests/api/*.test.ts
npm run build
cd ..\cre\lexdiff-workflow
npx tsc --noEmit
npm test
cd ..\..
git diff --check
git diff --cached --check
node scripts/check-secrets.mjs
```
