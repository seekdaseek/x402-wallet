# Roadmap

## v0.1 — shipped
- `payFetch` with automatic rail selection (Solana `solana:*` + Base/EVM `eip155:*`)
- Solana `TransactionModifyingSigner` — handles wallets that mutate the transaction (Seed Vault)
- MWA / Seed Vault adapter (raw protocol, `@solana/kit`-native)
- EVM signer — EIP-712 `signTypedData` via EIP-1193 and viem
- Client-side spend caps, enforced **before** any signature is requested
- Receipts
- Session-budget primitive (SPL `Approve` capped delegate + silent session signer)
- Test suites: `thesis` (byte-level signer proof), `budget`, `live-replay` (real production 402)

## In progress — grant milestones
- **M1** — a settled mainnet x402 payment through this library, from a browser wallet and from a Seeker (on-chain signatures published)
- **M2** — session budgets verified against a live facilitator; the delegate-authority question resolved via `buildDelegateProbe()`
- **M3** — published, reproducible Solana wallet x402 compatibility matrix
- **M4** — docs, starter template, adoption report

The device-level proof that Seed Vault signs x402 payments lives in
[seekdaseek/seeker402](https://github.com/seekdaseek/seeker402).
