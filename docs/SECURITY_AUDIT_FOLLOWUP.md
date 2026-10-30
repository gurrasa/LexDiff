# Security audit follow-up — review branch, not production approval

This patch addresses session/role checks on pending registration endpoints, verifies the caller on gas-subsidised relay requests, and disables the browser-triggered CRE simulator in production. It limits registration body size by streamed bytes and adds negative HTTP route tests.

## Still blocking a production security approval

- Wallet nonce state lives in a process-local Map (no persistent atomic single-use challenge store or distributed rate limiting). Use a shared Redis/database challenge store with TTL and atomic consume before multi-instance deployment.
- Pending registration `savePending` still uses filesystem overwrite and is not transactionally safe across concurrent writers/instances. Use atomic database updates; don't treat recorded signatures as a durable audit log until addressed.
- The paid relayer's rate limiter is process-local and takes a caller-supplied forwarded IP; 10/hour is a demo guard, not a reliable shared gas-spend quota. Implement authenticated per-wallet and global transaction budgets/monitoring before funding it.
- Evidence uses local filesystem and separate metadata records. Missing durable ownership provenance, confidentiality-by-role, audit trails, and backup/migration need fixing.
- CRE bearer token is shared and not case-scoped; submitted reports need stronger schema, workflow/registry binding and on-chain forwarder trust checks.
- Zod 3.25.76 via `@chainlink/cre-sdk@1.23.0` produces two high-severity npm audit findings; do not force an untested major dependency override.
- `cre/secrets.yaml` has been removed from Git's index, but credentials exposed through historical commits need rotation.
- Full legal consent, capability checks, completeness of case reports, and operational activation controls in the master plan are not implemented by this patch.

## Regression commands on the security branch

```powershell
cd web
npm ci
npx next typegen
npx tsc --noEmit
npx tsx --test tests/api/*.test.ts
npm run build
cd ..
node scripts/check-secrets.mjs
```

Do not merge or deploy based only on successful TypeScript/build/test results.
