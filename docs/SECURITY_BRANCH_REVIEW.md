# LexDiff security branch — review notes

## Scope

This branch is a **security foundation PR**, not completion of the 29-item master plan, independent legal review, or certification for production/legal reliance. It adds:

- Wallet signature login with an HMAC-authenticated, HTTP-only 1-hour session cookie and five-minute challenge.
- Schema allowlisting, request-byte limits, authenticated report writes, and content-hash integrity on reads.
- Evidence metadata and case-scoped reads against on-chain agreement roles or a pending registration.
- CRE bearer-token access to reviewed terms, service-authenticated report writes, and removal of public URI fallback.
- Secret-scanning script and local secret-file ignore rules.

## Required configuration

Generate independent 256-bit random hex secrets and set **only in the server environment**:

- `web/.env.local`: `LEXDIFF_SESSION_SECRET`, `LEXDIFF_EVIDENCE_API_TOKEN`
- `cre/.env`: `LEXDIFF_EVIDENCE_API_TOKEN_VALUE` with the **same** evidence token; map it through ignored `cre/secrets.yaml` under `secretsNames: LEXDIFF_EVIDENCE_API_TOKEN: [LEXDIFF_EVIDENCE_API_TOKEN_VALUE]` in the normal CRE YAML list structure.
- `EVIDENCE_DIR`, `EVIDENCE_METADATA_DIR` should use durable, protected directories.

Do not put any tokens in `NEXT_PUBLIC_` variables or the Git repository. Rotate credentials previously included in any Git history or exported ZIP.

## Important deployment blockers / explicit limits

1. **Do not deploy as a production confidentiality solution yet.** Challenge nonces are held in process memory and evidence files/metadata are on the local filesystem; multi-instance/serverless deployment needs a transactional shared TTL store, durable shared evidence/metadata storage, backup, and authorization audit logs.
2. Existing evidence documents **lack ownership metadata** and are intentionally not retrievable until a separately reviewed, authenticated migration binds them to the correct agreement/creator.
3. The existing pending-registration API and other endpoints still need a complete authentication, confidentiality, permission, CSRF and rate-limit review. Signing links may reveal registration payloads.
4. The current EIP-712 registry still uses **client and reviewer signatures**; counterparty consent and legal-effect distinctions remain open.
5. CRE on-chain verifier/forwarder trust separation, mock/prod isolation, refund behavioural tests, inherited admin capabilities, asset migration gating, export redaction, and lawyer-readable PDF are **not implemented** by this PR.
6. CRE SDK 1.23.0 pins Zod 3.25.76, which npm has reported as vulnerable; upgrading to Zod 4 may break SDK compatibility.
7. Users need a wallet signature before viewing draft documents and private case evidence. Existing frontend flows were adapted, but need browser end-to-end QA.
8. The implementation supports only a limited evidence classification (`terms`, `agreement-document`, `report`, `decision-note`) and a basic case-role policy. It does not implement legal-advice and dispute-file permissions.

## Verification before merging

- `cd web && npm ci && npx tsc --noEmit && npm run build`
- `cd cre/lexdiff-workflow && npm ci && npx tsc --noEmit && npm audit`
- `node scripts/check-secrets.mjs` from repository root
- Browser test: reviewer logs in and uploads terms; client logs in and views pending terms; unrelated wallet gets no private evidence; agreement-role wallet retrieves report; CRE bearer request reads terms and writes report; anonymous report POST denied; oversized body denied; wrong session/expired nonce denied.
- Review `git diff --cached --check`, `git status`, and all staged paths. Do not include local `.env*` or `cre/secrets.yaml` in the PR.

**No tests were executed in the sandbox** because npm dependencies could not be fully installed here. No readiness or security guarantees are claimed.
