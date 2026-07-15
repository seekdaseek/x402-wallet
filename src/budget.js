// Session budgets — the primitive that makes per-request payment usable.
// One wallet signature performs SPL Approve: a CAPPED delegation on the user's own
// token account to an ephemeral session key. Per-call payments are then signed by the
// session key as DELEGATE AUTHORITY. Funds never leave the user's wallet; the cap is
// enforced on-chain by the token program; Revoke ends it instantly.
//
// OPEN QUESTION (stated in both grant applications): do live facilitators accept a
// delegate as the TransferChecked authority? buildDelegateProbe() below is the
// one-cent mainnet experiment that answers it.
import {
  Transaction, PublicKey, Keypair, ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  createApproveCheckedInstruction, createRevokeInstruction,
  createTransferCheckedInstruction, getAssociatedTokenAddressSync,
} from '@solana/spl-token';

export const USDC_MAINNET = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

/** One-time, wallet-signed: approve `capUnits` (e.g. 5_000_000 = $5 USDC) to a fresh session key. */
export function createSessionBudget({ owner, mint = USDC_MAINNET, capUnits, decimals = 6 }) {
  const sessionKey = Keypair.generate();
  const ownerPk = new PublicKey(owner);
  const ata = getAssociatedTokenAddressSync(mint, ownerPk);
  const approveTx = new Transaction().add(
    createApproveCheckedInstruction(ata, mint, sessionKey.publicKey, ownerPk, BigInt(capUnits), decimals),
  );
  const revokeTx = new Transaction().add(createRevokeInstruction(ata, ownerPk));
  return { sessionKey, approveTx, revokeTx, ata };
}

/** Adapter for the session key: signs payments as delegate — silently, no wallet prompt. */
export function sessionAdapter(sessionKey) {
  return {
    getAddress: async () => sessionKey.publicKey.toBase58(),
    signPayloads: async (payloads) => payloads.map((b64) => {
      const tx = Transaction.from(Buffer.from(b64, 'base64'));
      tx.partialSign(sessionKey);
      return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
    }),
  };
}

/** The decisive experiment: a spec-shaped x402 transfer where the AUTHORITY is the delegate. */
export function buildDelegateProbe({ ownerAta, mint, payTo, feePayer, sessionKey, units = 1000, decimals = 6, blockhash }) {
  const dstAta = getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(payTo), true);
  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }));
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }));
  tx.add(createTransferCheckedInstruction(
    new PublicKey(ownerAta), new PublicKey(mint), dstAta,
    sessionKey.publicKey, /* <-- delegate signs, NOT the owner */
    BigInt(units), decimals,
  ));
  tx.feePayer = new PublicKey(feePayer);
  tx.recentBlockhash = blockhash;
  tx.partialSign(sessionKey);
  return tx;
}
