// allowance-x402.js — the connective tissue nobody had shipped:
// Solana's native Allowances (capped, revocable, multi-delegate) driving x402 per-call
// payments, signed silently by a session key. The user approves ONCE; the agent then
// pays HTTP 402s until the on-chain cap is spent or the delegation is revoked.
//
// Flow:
//   1. openBudget()  -> user's wallet signs [InitSubscriptionAuthority?, CreateFixedDelegation]
//                       ONE prompt. Returns a session Keypair + budget handle.
//   2. payFetch()    -> each 402 is paid by a TransferFixed the session key signs. No prompt.
//   3. closeBudget() -> user's wallet signs RevokeDelegation. Instant kill switch.
//
// This composes with createX402Wallet from ./core.js: the wallet holds the user's signer
// (Seed Vault / injected) for steps 1 and 3; this module holds the session key for step 2.

import { Keypair, Transaction } from '@solana/web3.js';
import {
  ixInitSubscriptionAuthority, ixCreateFixedDelegation, ixRevokeDelegation,
  subscriptionAuthorityPda, USDC_MAINNET,
} from './allowance.js';

/**
 * Build the one-signature "open a budget" transaction for the user's wallet to sign.
 * Caller checks whether the SA already exists (skip init if so) and supplies saInitId.
 *
 * @returns { sessionKey, tx, budget }  — sessionKey stays in-app; tx goes to the user's wallet.
 */
export function buildOpenBudget({ user, mint = USDC_MAINNET, capUnits, expiryTs = 0, nonce = 0, saExists, saInitId }) {
  const sessionKey = Keypair.generate();
  const tx = new Transaction();
  if (!saExists) tx.add(ixInitSubscriptionAuthority(user, mint));
  tx.add(ixCreateFixedDelegation({ user, sessionKey: sessionKey.publicKey, mint, capUnits, expiryTs, nonce, saInitId: saInitId ?? 0n }));
  const [sa] = subscriptionAuthorityPda(user, mint);
  return { sessionKey, tx, budget: { user, mint, sessionKey, nonce, capUnits, sa } };
}

/** Build the revoke transaction for the user's wallet to sign. */
export function buildCloseBudget(budget) {
  const tx = new Transaction();
  tx.add(ixRevokeDelegation({ user: budget.user, sessionKey: budget.sessionKey.publicKey, mint: budget.mint, nonce: budget.nonce }));
  return tx;
}

/**
 * A per-call payment signer keyed on the session key. Given an x402 payment transaction
 * that pulls via TransferFixed, the session key partial-signs it — no wallet, no prompt.
 * Returned in the base64-wire shape the x402 adapters expect.
 */
export function budgetSessionAdapter(budget) {
  return {
    getAddress: async () => budget.sessionKey.publicKey.toBase58(),
    signPayloads: async (payloads) => payloads.map((b64) => {
      const tx = Transaction.from(Buffer.from(b64, 'base64'));
      tx.partialSign(budget.sessionKey);
      return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
    }),
  };
}
