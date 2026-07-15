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

## Session budgets (experimental — the usability primitive)

You cannot biometric-prompt a human for every $0.001 call. One wallet signature performs an SPL
`Approve` delegating a **capped** amount on the user's own token account to an ephemeral session
key; per-call payments are then signed by the session key as **delegate authority**. Funds never
leave the user's wallet; the cap is enforced on-chain by the token program; `Revoke` ends it.

```js
import { createSessionBudget, sessionAdapter, createSvmSigner } from '@seekdaseek/x402-wallet';
const { sessionKey, approveTx, revokeTx } = createSessionBudget({ owner, capUnits: 5_000_000 }); // $5
// 1. user's wallet signs+sends approveTx (ONE prompt)
// 2. silent per-call payments:
const silent = await createSvmSigner(sessionAdapter(sessionKey));
```

**Open question, stated plainly:** whether live facilitators accept a delegate as the
`TransferChecked` authority. `buildDelegateProbe()` constructs the one-cent mainnet experiment
that answers it. Until it settles, treat budgets as experimental.

## Status & tests

| Test | What it proves | Result |
|---|---|---|
| `test/thesis.test.mjs` | Mutating wallet breaks PartialSigner; ModifyingSigner survives (byte-level) | PASS |
| `test/budget.test.mjs` | Cap encoded on-chain, delegate is authority+signer, silent signing works | PASS |
| `test/live-replay.test.mjs` | Caps block pre-signature against the real production 402; both rails parsed | PASS |

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
src/budget.js       session budgets: Approve/Revoke, silent delegate signer, delegate probe
examples/base-pay.html  pay AgentFeed on Base from MetaMask
```

MIT. Built by [seekdaseek](https://github.com/seekdaseek) — who also runs the x402 server this is
tested against ([AgentFeed](https://x402.ochinimus.app)): both sides of the protocol, one repo apart.
