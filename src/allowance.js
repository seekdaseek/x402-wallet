// allowance.js — session budgets built on Solana's native Subscriptions & Allowances
// program (De1eg…avR44), NOT a hand-rolled SPL Approve.
//
// Why this exists: raw SPL Approve allows only ONE delegate per token account — a second
// approval silently overwrites the first, so an agent budget and a subscription can't
// coexist on one USDC balance. The Foundation's program (audited by Cantina, mainnet,
// June 2026) fixes this by routing every arrangement through a per-(user,mint)
// Subscription Authority PDA that holds the single u64::MAX approval, then gating each
// pull through individual delegation PDAs with their own caps and expiry.
//
// The x402 fit is exact: the delegatee SIGNS each TransferFixed. So the user's wallet
// approves ONCE (CreateFixedDelegation, one biometric), an ephemeral session key is the
// delegatee, and every subsequent per-call payment is signed silently by that session
// key — pulling from the user's own account, capped on-chain, revocable instantly.
//
// This module builds the on-chain instructions. Wiring the session key as an x402
// payment signer is in ./allowance-x402.js.

import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';

export const SUBSCRIPTIONS_PROGRAM_ID = new PublicKey('De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44');
export const USDC_MAINNET = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const SYS_PROGRAM = new PublicKey('11111111111111111111111111111111');

// Instruction discriminators — verified against solana-program/subscriptions src.
const IX = { InitSubscriptionAuthority: 0, CreateFixedDelegation: 1, RevokeDelegation: 3, TransferFixed: 4 };

// ---- PDA derivation (seeds verbatim from the program) ----
export function subscriptionAuthorityPda(user, mint) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('SubscriptionAuthority'), user.toBuffer(), mint.toBuffer()],
    SUBSCRIPTIONS_PROGRAM_ID,
  );
}
export function delegationPda(sa, delegator, delegatee, nonce) {
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64LE(BigInt(nonce));
  return PublicKey.findProgramAddressSync(
    [Buffer.from('delegation'), sa.toBuffer(), delegator.toBuffer(), delegatee.toBuffer(), nonceBuf],
    SUBSCRIPTIONS_PROGRAM_ID,
  );
}
export function eventAuthorityPda() {
  return PublicKey.findProgramAddressSync([Buffer.from('event_authority')], SUBSCRIPTIONS_PROGRAM_ID)[0];
}

const m = (pubkey, isSigner, isWritable) => ({ pubkey, isSigner, isWritable });

/**
 * Step 1 (once per user+mint): approve the Subscription Authority as the single delegate.
 * The user's wallet signs this. Idempotent — skip if the SA already exists on-chain.
 */
export function ixInitSubscriptionAuthority(user, mint = USDC_MAINNET) {
  const [sa] = subscriptionAuthorityPda(user, mint);
  const userAta = getAssociatedTokenAddressSync(mint, user);
  return new TransactionInstruction({
    programId: SUBSCRIPTIONS_PROGRAM_ID,
    keys: [
      m(user, true, true), m(sa, false, true), m(mint, false, false),
      m(userAta, false, true), m(SYS_PROGRAM, false, false), m(TOKEN_PROGRAM_ID, false, false),
    ],
    data: Buffer.from([IX.InitSubscriptionAuthority]),
  });
}

/**
 * Step 2 (once per budget): create a capped, expiring delegation to the session key.
 * The user's wallet signs this — the ONE biometric prompt. After this, the session key
 * pulls silently. `capUnits` e.g. 5_000_000 = $5 USDC. `expiryTs` unix seconds (0 = none).
 */
export function ixCreateFixedDelegation({ user, sessionKey, mint = USDC_MAINNET, capUnits, expiryTs = 0, nonce = 0, saInitId }) {
  const [sa] = subscriptionAuthorityPda(user, mint);
  const [delegation] = delegationPda(sa, user, sessionKey, nonce);
  // CreateFixedDelegationData: nonce u64, amount u64, expiry_ts i64, expected_sa_init_id i64
  const data = Buffer.alloc(1 + 8 + 8 + 8 + 8);
  data.writeUInt8(IX.CreateFixedDelegation, 0);
  data.writeBigUInt64LE(BigInt(nonce), 1);
  data.writeBigUInt64LE(BigInt(capUnits), 9);
  data.writeBigInt64LE(BigInt(expiryTs), 17);
  data.writeBigInt64LE(BigInt(saInitId), 25);
  return new TransactionInstruction({
    programId: SUBSCRIPTIONS_PROGRAM_ID,
    keys: [
      m(user, true, true),          // delegator (signs)
      m(sa, false, false),          // subscription authority
      m(delegation, false, true),   // delegation PDA (created)
      m(sessionKey, false, false),  // delegatee
      m(SYS_PROGRAM, false, false),
    ],
    data,
  });
}

/**
 * Per-call: pull `amount` from the user's ATA to `receiver`. The SESSION KEY signs —
 * no wallet, no prompt. Cap enforced on-chain; underflow past the cap is rejected.
 */
export function ixTransferFixed({ user, sessionKey, receiver, mint = USDC_MAINNET, amount, nonce = 0 }) {
  const [sa] = subscriptionAuthorityPda(user, mint);
  const [delegation] = delegationPda(sa, user, sessionKey, nonce);
  const userAta = getAssociatedTokenAddressSync(mint, user);
  const receiverAta = getAssociatedTokenAddressSync(mint, receiver, true);
  const evAuth = eventAuthorityPda();
  // TransferData: amount u64, delegator Pubkey(32), mint Pubkey(32)
  const data = Buffer.alloc(1 + 8 + 32 + 32);
  data.writeUInt8(IX.TransferFixed, 0);
  data.writeBigUInt64LE(BigInt(amount), 1);
  user.toBuffer().copy(data, 9);
  mint.toBuffer().copy(data, 41);
  return new TransactionInstruction({
    programId: SUBSCRIPTIONS_PROGRAM_ID,
    keys: [
      m(delegation, false, true), m(sa, false, false),
      m(userAta, false, true), m(receiverAta, false, true),
      m(mint, false, false), m(TOKEN_PROGRAM_ID, false, false),
      m(sessionKey, true, false),   // delegatee signs — the silent per-call auth
      m(evAuth, false, false), m(SUBSCRIPTIONS_PROGRAM_ID, false, false),
    ],
    data,
  });
}

/** Kill switch: revoke the delegation PDA. User's wallet signs. */
export function ixRevokeDelegation({ user, sessionKey, mint = USDC_MAINNET, nonce = 0 }) {
  const [sa] = subscriptionAuthorityPda(user, mint);
  const [delegation] = delegationPda(sa, user, sessionKey, nonce);
  return new TransactionInstruction({
    programId: SUBSCRIPTIONS_PROGRAM_ID,
    keys: [ m(user, true, true), m(sa, false, false), m(delegation, false, true), m(sessionKey, false, false) ],
    data: Buffer.from([IX.RevokeDelegation]),
  });
}

/** Read the SA's init_id from chain (needed as consent field in CreateFixedDelegation). */
export function readSaInitId(accountData) {
  // SubscriptionAuthority: disc(1) user(32) mint(32) payer(32) bump(1) init_id(i64)
  return accountData.readBigInt64LE(98);
}
