# Apply this patch only to security/lexdiff-hardening

This ZIP contains exactly two CRE code/test files, one master-plan release-gate document, and these instructions. It does NOT contain the entire repository, credentials, or Git history. It does NOT implement all 29 LDX items.

1. From your local LexDiff repository root, confirm `git branch --show-current` equals `security/lexdiff-hardening`.
2. Extract this ZIP into the repo root using `Expand-Archive -LiteralPath "$HOME\Downloads\LexDiff-priority-safety-patch.zip" -DestinationPath . -Force`.
3. Run the PowerShell commands in `docs/MASTER_PLAN_RELEASE_GATES.md`.
4. If checks pass, stage `cre/lexdiff-workflow/compare.ts`, `cre/lexdiff-workflow/compare.test.ts`, and `docs/MASTER_PLAN_RELEASE_GATES.md`.
5. Do not commit if any test fails. Avoid touching `main`.

Behavior changed deliberately: `refund` may have `kind=Match` (structural observation) but `result=Inconclusive` (behavior not proven). An admin-function name disappearing now produces `kind=HiddenPower`, `result=Inconclusive` rather than a false fix-verified Pass.
