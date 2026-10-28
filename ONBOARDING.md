# LexDiff: project overview

This document explains the whole project: what it does, how it works, why it's built the way it is, what's done and what's left. The repo is at https://github.com/gurrasa/LexDiff. The technical setup details are in [README.md](README.md).

---

## 1. The problem

Smart contracts are increasingly used to enforce legal agreements: escrow, payments, vesting, leases. More and more of that code is written by AI. It often compiles fine but doesn't match the agreement it's supposed to implement.

When something goes wrong, nobody can reliably answer:

1. Did the code match the agreement?
2. Who knew about the mismatch, and who accepted the risk?
3. Who was responsible for fixing it, and was it actually fixed?

## 2. What LexDiff does

LexDiff compares a legal agreement with the smart contract that is supposed to enforce it. It records every mismatch on-chain and tracks who is responsible for each one until it is verifiably resolved.

> LexDiff doesn't decide liability. It preserves the evidence a court needs to decide it.

Every term ends up in one of four categories:

| | |
|---|---|
| ✅ **Match** | code and agreement agree |
| ⚠️ **Mismatch** | both define it, but differently |
| ❌ **Missing** | in the agreement, not in the code |
| 🚩 **Hidden power** | in the code, not in the agreement |

## 3. The demo story

**The agreement:** the client deposits 1,000 USDC. The freelancer delivers within 30 days, and the client has 7 days to review. If the deadline is missed, the client is refunded. Nobody may withdraw the escrowed funds.

**The deployed contract (`FreelanceEscrowV1`, the "AI-generated" one):**

- ⚠️ The deadline is 3 days, not 30.
- ❌ There is no refund function.
- 🚩 The owner can withdraw all funds at any time.

**What happens next:**

1. Legal counsel (the reviewer) signs *Remediation required* on the deadline and the refund. That assigns them to the developer, who signs *Acknowledge*.
2. The client knowingly signs *Accepted risk* on the owner's withdrawal power.
3. The developer deploys `FreelanceEscrowV2`, which has 30 days and a refund, and proposes it. The client accepts it.
4. Chainlink CRE re-runs the comparison. The deadline and refund become **Resolved**. The withdrawal power stays *Accepted risk*.

If a dispute comes up later, there is a complete, signed trail of what was wrong, who knew, who accepted what, and who fixed what.

## 4. How it works

```
Agreement text
   │  Claude API extracts the terms (with a verbatim quote per term)
   ▼
Draft terms ──► lawyer reviews ──► client + reviewer sign ──► LexDiffRegistry (Sepolia)
                                                                   │ emits CheckRequested
                                                                   ▼
                                     Chainlink CRE workflow (deterministic, no AI)
                                       1. read the agreement from the registry
                                       2. fetch the terms, check they match the on-chain hash
                                       3. fetch the contract's verified source from Etherscan
                                       4. read the contract's actual values on Sepolia
                                       5. compare → findings
                                                                   │
                         full report ──► evidence store            │ hashes only
                                                                   ▼
                                                            LexDiffRegistry
                                                                   ▲
                    parties sign decisions (EIP-712) ──────────────┘
```

**Three components:**

| Folder | What it is | Stack |
|---|---|---|
| `contracts/` | `LexDiffRegistry.sol`, the evidence ledger. Also the demo contracts V1/V2 and a mock USDC. | Solidity, Foundry, OpenZeppelin |
| `cre/lexdiff-workflow/` | The Chainlink CRE workflow that does the comparison. `main.ts` is the flow, `compare.ts` the comparison logic, `source-analysis.ts` reads Solidity source, and `report.ts` builds the report. | TypeScript, CRE SDK, viem |
| `web/` | Next.js app: Claude extraction, signing, the evidence store (`/api/evidence`) and the findings dashboard. | Next.js 16, React, viem |

`agreements/` holds the demo agreement and a ready-made example of reviewed terms, which is useful without a Claude API key.

### What the CRE workflow checks

| Term | How |
|---|---|
| Client, freelancer, token, amount | Finds a getter by name and type in the verified ABI and reads it on-chain |
| Delivery deadline, review period | Same, compared in seconds |
| Refund on missed deadline | Looks for a state-changing function named like `refund` / `reclaim` / `cancel` |
| Admin powers | Static analysis of the source: functions only the owner can call, grouped by what they do (withdraw funds, pause, upgrade…). Anything the agreement doesn't grant is a 🚩. |

## 5. The responsibility framework: six questions

This is the core of the pitch. Each question has a signed or independently verified answer.

| Question | Answer | Who |
|---|---|---|
| 1. **What was agreed?** | Claude drafts the terms; the reviewer and client sign the reviewed terms hash | Reviewer + client |
| 2. **Does the code match?** | CRE compares deterministically | CRE |
| 3. **Who knew?** | Findings are anchored on-chain; parties sign *Acknowledge* | Any party |
| 4. **Who took the risk, and who fixes?** | *Accepted risk* (client) / *Remediation required* (reviewer → developer) | Client / reviewer |
| 5. **Is it fixed?** | Only a CRE report can set *Resolved* | CRE |
| 6. **Who disputes?** | *Dispute* with a reason; history is never rewritten | Any party |

## 6. Key design decisions

Please talk to me before changing any of these; a lot of the pitch rests on them.

| Decision | Why |
|---|---|
| **AI runs outside CRE** | LLM output isn't deterministic, and CRE needs every node to reach the same result. Claude only produces a draft that a human approves. |
| **Only CRE can resolve** | That's the whole point. Nobody can just claim something was fixed. |
| **Signatures are bound to the evidence hash** | A signature applies to the exact version of a finding the signer saw. Nobody can later claim "I never saw that". |
| **Only hashes on-chain** | Terms, reports and notes live in an off-chain evidence store; the chain holds their hashes. We don't publish vulnerabilities or personal data on an immutable ledger (GDPR), but everything stays verifiable. |
| **No admin in the registry** | Each agreement names its own verifier when the parties sign it, and nobody can change it afterwards. An admin who could swap the verifier would be exactly the kind of 🚩 hidden power LexDiff is meant to detect. |
| **The client accepts contract changes** | The developer proposes a new contract and the client (who holds the funds) accepts it. Otherwise someone could "fix" findings on a contract nobody uses. |
| **Dispute doesn't change status** | LexDiff doesn't judge; it preserves the fact that someone disagreed. |
| **Amendments create a new agreement** | The old one is never overwritten; the new one links to it. |

### Legal framing (for the pitch)

- **Say:** "LexDiff compares approved agreement terms with deployed code and on-chain values, records evidence-bound signed decisions, and only marks findings resolved through reports delivered by the agreement's Chainlink CRE verifier."
- **Don't say:** "LexDiff proves a developer is liable", "a wallet signature is legally binding consent", "AI verified the contract", or "the escrow is secure".
- A wallet signature proves control of a key, not a person's identity. Under EU law (eIDAS) it's at most a *simple electronic signature*.

## 7. Status

### Done and tested

- The registry contract: two-signature registration, a verifier per agreement, Acknowledge/Dispute, two-step contract replacement. **17 tests pass.**
- The comparison and source analysis, tested against the real V1/V2 contracts. **10 tests pass.**
- The CRE workflow compiles to WASM.
- The web app builds.
- The full flow on a local chain (anvil) works end to end. Web signatures are accepted by the contract, and report hashes match the evidence store.

### Not done yet

- **Nothing is deployed to Sepolia.**
- **`cre workflow simulate` has never been run for real.** This is the biggest risk. Possible issues: the size of Etherscan's response, CRE reaching `localhost`, and gas.
- The Claude extraction hasn't been run with a real API key.

## 8. What's left (priority order)

| # | Task | Why | Size |
|---|---|---|---|
| 1 | **Deploy to Sepolia + first real CRE run** | Everything else depends on this working | ½ day, together |
| 2 | **Structural refund check**: `refund()` must pay the client and check the deadline | Right now it's enough that the function is *named* refund. A judge could ask "what if it's empty?" | ~2 h (CRE) |
| 3 | **JSON evidence export** + transaction links per event | Judges want to click the transaction and inspect it themselves | ~2 h (web) |
| 4 | **Hosting**: the evidence store writes to local disk, which won't work on Vercel | The submission needs a URL | ~1–2 h (web) |
| 5 | **Demo polish + recording** a 3-minute backup video | Sepolia or the RPC can act up during the live demo | ½ day, together |
| 6 | Behavioral refund check (actually simulate `refund()`) | Strongest answer to #2, but a big job | 1 day, only if time |

Suggested split: one of us takes CRE + contracts (#2), the other takes the web app (#3, #4).

## 9. Getting started

**Install:**
- [Foundry](https://getfoundry.sh)
- Node 22+
- [Bun](https://bun.sh): `curl -fsSL https://bun.sh/install | bash`
- The [CRE CLI](https://docs.chain.link/cre/getting-started/cli-installation), then log in with `cre login`
- MetaMask with some Sepolia ETH from a faucet

**Clone:**
```bash
git clone --recursive https://github.com/gurrasa/LexDiff.git
cd LexDiff
```
`--recursive` pulls in the OpenZeppelin and forge-std submodules. If you forgot it, run `git submodule update --init --recursive`.

**Run the tests (no keys needed):**
```bash
cd contracts && forge test
cd ../cre/lexdiff-workflow && npm install && npm test
```

**Run the web app:**
```bash
cd web
cp .env.example .env.local     # put your ANTHROPIC_API_KEY here, NEVER in .env.example
npm install
npm run dev                    # http://localhost:3000
```
Go to **New agreement** → *Load demo agreement* → *Extract terms with Claude*. Without a key, paste `agreements/freelance-escrow.terms.example.json` into the terms box.

For the full Sepolia + CRE flow, see *Running it* in [README.md](README.md).

## 10. Gotchas we've already hit

- **Deploy with `./script/deploy-sepolia.sh`, not `forge script`.** Sepolia charges much more gas per byte of contract code than Foundry assumes, so `forge script` deploys run out of gas. The script asks the node for the real estimate. That is also why the registry is split into `LexDiffRegistry` + the `LexDiffLogic` library: as one contract it exceeded the 16.7M gas-per-transaction cap.
- **`PRIVATE_KEY` in `contracts/.env` needs `0x`; `CRE_ETH_PRIVATE_KEY` in `cre/.env` must not have it.**
- **Never put keys in `.env.example`.** That file is committed and the repo is public. Keys go in `web/.env.local`, `cre/.env` and `contracts/.env`, which are all git-ignored.
- **Run `npm run dev` in `web/`**, not in `cre/lexdiff-workflow/`.
- **When you change the contract:**
  1. Run `forge build` in `contracts/`.
  2. Run `node scripts/gen-abi.mjs` in `web/`.
  3. Update `cre/lexdiff-workflow/abi.ts` by hand if the report format or the `Agreement` struct changed.
  4. Redeploy and re-register the agreement.
- **The terms schema exists in two places:** `web/lib/terms.ts` and `cre/lexdiff-workflow/terms.ts`. Keep them identical, or the hashes won't match.
- **`npm audit` reports 5 vulnerabilities in the workflow.** Don't run `npm audit fix --force`: it upgrades packages the CRE SDK is pinned to. The warnings don't affect the demo.
- **CRE needs the web app running.** It fetches the terms and stores its report through `localhost:3000/api/evidence`.
- **The "Run the Chainlink check" button** only works with `ENABLE_LOCAL_CRE=true` in `web/.env.local` and the CRE CLI on your PATH. It is for local demos only.
- **The workflow reads the latest block, not the finalized one** (`readFinalized: false`). Sepolia finality lags ~15 minutes, and reading finalized state made fresh registrations invisible to CRE.
- **The simulation forwarder is a mock** and doesn't verify signatures. We say so openly in the README and the pitch.

## 11. How we work

- Use your own branch and open pull requests against `main`.
- Run `forge test` and `npm test` before pushing.
- Contract changes require a redeploy, so batch them and do them early.
