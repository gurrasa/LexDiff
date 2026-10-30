# Applying the LexDiff security foundation on a NEW Git branch

This ZIP contains changed files only. It has NO .git history, credential files, or real .env values. It does NOT push to GitHub and does NOT change main automatically.

1. Clone your repository normally. In PowerShell at the fresh clone root: `git switch main`, then `git switch -c security/lexdiff-hardening`.
2. Extract this ZIP into the LexDiff repository root, preserving folder paths. Do not extract into the parent folder and do not overwrite a real .env.local.
3. Stop tracking the previously committed CRE secret mapping (keep the local file): `git rm --cached -- cre/secrets.yaml`. If the file does not exist in the clone, skip this command.
4. Read `docs/SECURITY_BRANCH_REVIEW.md`. Configure your own ignored local secrets and do not share them.
5. Run: `cd web; npm ci; npx tsc --noEmit; npm run build`; then `cd ..; node scripts/check-secrets.mjs`. Also validate the CRE workflow separately.
6. Review: `git status --short`; `git diff`; `git add -A`; `git diff --cached --check`; `git diff --cached --stat`. Do not commit anything containing actual secrets.
7. Commit only after review: `git commit -m "Add wallet sessions and scoped evidence access foundation"`. Push: `git push -u origin security/lexdiff-hardening`. Open a PR to `main`, requesting your partner's review.

NOTE: This is a partial, reviewable security-foundation PR. It is NOT the full 29-item roadmap. Deployment blocked pending metadata migration, auth tests and production shared storage; see docs.
