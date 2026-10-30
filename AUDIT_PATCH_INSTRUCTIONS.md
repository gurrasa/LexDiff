# LexDiff security audit patch — apply only to security/lexdiff-hardening

Do not apply to main. This patch is **not** a production-security sign-off.

## Apply on Windows PowerShell

From `C:\Users\vishn\Desktop\LexDiff`:

```powershell
if ((git branch --show-current) -ne 'security/lexdiff-hardening') { throw 'Wrong branch' }
Expand-Archive -LiteralPath "$HOME\Downloads\LexDiff-security-audit-patch.zip" -DestinationPath '.' -Force
cd web
npm ci
npx next typegen
npx tsc --noEmit
npx tsx --test tests/api/evidence-security.test.ts tests/api/registration-auth.test.ts
npm run build
cd ..
git add -- web/app/api/registrations web/app/api/relay/route.ts web/app/api/run-check/route.ts web/lib/server/request-guard.ts web/app/page.tsx web/app/sign/[id]/SignView.tsx web/app/agreements/[id]/AgreementView.tsx web/tests/api/registration-auth.test.ts docs/SECURITY_AUDIT_FOLLOWUP.md
git diff --cached --check
git status --short
```

Review results before any commit. Existing staged changes remain staged. No Git branch or history is included in this ZIP.

## Important

- `sign/[id]` now requires the invited signer to click **Connect and sign in** before seeing private registration details.
- Home pending signing requests require a wallet session; on initial load until wallet sign-in, the list may be empty.
- Relayer calls require a wallet session and matching signer before simulating, even though on-chain EIP-712 verification still applies.
- Browser CRE checks are disabled in production regardless of ENABLE_LOCAL_CRE.
- The patch does not fix process-local nonce storage, relayer quota durability, or filesystem atomicity. See `docs/SECURITY_AUDIT_FOLLOWUP.md`.
- Build/test validation was impossible in the patch-generation environment because npm package zod@4.6.7 was not cached. Run the commands above on your computer.
