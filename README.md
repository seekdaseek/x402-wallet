# @seekdaseek/x402-wallet

**Pay HTTP 402 from wallets people actually control — on Solana and Base.**

Every x402 payer today is a hot private key in a server's environment variable. This library makes
*user wallets* x402 payers: Seed Vault and MWA wallets on Solana Mobile, injected wallets
(MetaMask, Coinbase Wallet) on Base/EVM — with client-side spend caps enforced **before** any
signature is requested, receipts, and a session-budget primitive for silent per-call payments.

Built on the device-verified findings in [seekdaseek/seeker402](https://github.com/seekdaseek/seeker402):
Seed Vault signs x402 payments, but **mutates the transaction** (rewrites the compute-unit price),
which silently breaks the obvious signer implementation.

## The one design decision that matters

MWA wallets are permitted to modify a transaction before signing — and at least one does.
A `@solana/kit` **`TransactionPartialSigner`** staples the wallet's signature onto the *original*
message: valid signature, wrong bytes, settlement fails with no diagnostic.

This library implements the wallet as a **`TransactionModifyingSigner`** — the wallet's transaction
(mutation and signature together) is carried through. `test/thesis.test.mjs` proves both paths at
the byte level:

```
PartialSigner path  -> signature valid over submitted message: false
ModifyingSigner path-> signature valid over submitted message: true
feePayer intact: true | ix count: 3 | CU price after wallet: 100000
```

On EVM none of this exists: x402's `exact` scheme needs only EIP-712 `signTypedData` — an off-chain
authorization every injected wallet supports. No fee-payer problem, no mutation problem, no gas.

## Usage

```js
import { createX402Wallet, createSvmSigner, mwaAdapter, fromEip1193 } from '@seekdaseek/x402-wallet';

// Solana Mobile (Seed Vault) — React Native
import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol';
const svmSigner = await createSvmSigner(mwaAdapter({ transact, identity: { name: 'MyApp', uri: 'https://my.app', icon: 'favicon.ico' } }));

// Base / EVM — browser
const evmSigner = fromEip1193(window.ethereum, address);

const wallet = createX402Wallet({
  svmSigner, evmSigner,
  rpcUrl: 'https://mainnet.helius-rpc.com/?api-key=…',
  caps: { maxPerCallUsd: 0.05, maxTotalUsd: 5 },   // enforced BEFORE the wallet is prompted
});

const res = await wallet.payFetch('https://x402.ochinimus.app/api/sol-price');
console.log(await res.json(), wallet.receipts, wallet.spentUsd);
```

Caps throw `CapExceeded` before any signature request fires — verified against a captured
production 402 in `test/live-replay.test.mjs`.

## Session budgets — native Solana Allowances (recommended)

You cannot biometric-prompt a human for every $0.001 call. The answer is a capped,
revocable delegation the user approves **once**, after which an ephemeral session key
pulls silently.

The naive way — raw SPL `Approve` — has a fatal flaw: **one delegate per token account**.
A second approval silently overwrites the first, so an agent budget and any subscription
on the same USDC balance can't coexist. Solana's Foundation shipped an audited, mainnet
program that fixes exactly this (`De1eg…avR44`, June 2026): every arrangement routes
through a per-`(user, mint)` Subscription Authority PDA that holds the single approval,
and real caps live in individual delegation PDAs. Unlimited concurrent budgets, one token
account.

This library wraps that program and wires it to x402 — the connective tissue the
Foundation's own docs call out as future work:

```js
import { buildOpenBudget, buildCloseBudget, budgetSessionAdapter, createSvmSigner } from '@seekdaseek/x402-wallet';

// 1. ONE wallet signature opens a capped budget ($5, expires in 24h)
const { sessionKey, tx, budget } = buildOpenBudget({
  user, capUnits: 5_000_000, expiryTs: Math.floor(Date.now()/1000) + 86400,
  saExists, saInitId,               // read the SA from chain first; skip init if it exists
});
// user's wallet (Seed Vault / injected) signs `tx` — the only prompt

// 2. per-call x402 payments sign SILENTLY with the session key — no prompt
const silentSigner = await createSvmSigner(budgetSessionAdapter(budget));
//    ...pass silentSigner to createX402Wallet; every 402 is pulled under the cap

// 3. instant kill switch — user's wallet signs the revoke
const revokeTx = buildCloseBudget(budget);
```

Funds never leave the user's wallet. The cap is enforced **on-chain by an audited program**,
not by client code — which also removes the scariest part of rolling your own: there is no
unaudited money-moving code in the trust path. Every instruction is byte-verified against
the program spec in `test/allowance.test.mjs`, including the property that makes it work —
**the session key signs each pull; the user does not.**

The raw-`Approve` prototype is still exported from `./budget.js` (as `budget-legacy`) so
older imports don't break, but new code should use the Allowances path above.

## Status & tests

| Test | What it proves | Result |
|---|---|---|
| `test/thesis.test.mjs` | Mutating wallet breaks PartialSigner; ModifyingSigner survives (byte-level) | PASS |
| `test/budget.test.mjs` | Cap encoded on-chain, delegate is authority+signer, silent signing works | PASS |
| `test/live-replay.test.mjs` | Caps block pre-signature against the real production 402; both rails parsed | PASS |
| `test/allowance.test.mjs` | Native-Allowances instructions byte-correct; session key signs pulls, user doesn't | PASS |

Device-verified upstream: a physical Seeker's Seed Vault signed a foreign-fee-payer v0 x402
transaction (MWA 2.2.8) — see seeker402. **Not yet done:** a settled mainnet payment through this
library from a device/browser (needs hardware + funds; it is milestone 1 of the roadmap), and the
delegate-authority probe against a live facilitator.

## Files

```
src/core.js         payFetch, rail selection, spend caps, receipts
src/svm/signer.js   TransactionModifyingSigner (+ the naive PartialSigner, kept for the regression test)
src/svm/mwa.js      Seed Vault / MWA adapter (raw protocol, kit-native)
src/evm/signer.js   EIP-1193 + viem adapters (signTypedData)
src/allowance.js       session budgets on Solana's native Subscriptions program (De1eg…avR44)
src/allowance-x402.js  open/close budget + silent session signer wired to x402
src/budget.js          DEPRECATED raw-Approve prototype (kept for back-compat)
examples/base-pay.html  pay AgentFeed on Base from MetaMask
```

MIT. Built by [seekdaseek](https://github.com/seekdaseek) — who also runs the x402 server this is
tested against ([AgentFeed](https://x402.ochinimus.app)): both sides of the protocol, one repo apart.

## Live mainnet settlements

Both rails proven end-to-end against the live Coinbase CDP facilitator — real USDC on mainnet, not testnet or replay. The payer holds **zero native gas** on either chain; the facilitator sponsors it.

| Rail | Signer path | Network | Amount | Transaction |
|------|-------------|---------|--------|-------------|
| Solana | SVM `TransactionModifyingSigner` | solana mainnet | 0.001 USDC | [`5XPKFW…WqM2`](https://solscan.io/tx/5XPKFWmL937cUHF29koc26QeQTwBmzo3KCw88NdfhhpNtx1TUgKjvo6BtkJ1BD7TBDfbfpTHmQC7U7MUFzdxWqM2) |
| Base | EVM EIP-3009 `signTypedData` | eip155:8453 | 0.001 USDC | [`0xe49b8c…4a31`](https://basescan.org/tx/0xe49b8c75de425c52b321fa1df5c428a18e51ca11e3b982fc80b6ea2ed24c4a31) |

Reproduce — put a funded payer key at `./payer.json` (Solana) or `./payer-evm.key` (Base), a few cents of USDC, no gas token needed, then run:

    node settle-mainnet.mjs   # Solana
    node settle-base.mjs      # Base
