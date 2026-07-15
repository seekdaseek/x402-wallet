// budget-legacy.js — the ORIGINAL raw-SPL-Approve prototype. Superseded by allowance.js
// (which builds on Solana's audited Subscriptions program and lifts the one-delegate
// limit). Preserved so pre-existing imports keep working; do not use for new code.
import { Transaction, PublicKey, Keypair, ComputeBudgetProgram } from '@solana/web3.js';
import {
  createApproveCheckedInstruction, createRevokeInstruction,
  createTransferCheckedInstruction, getAssociatedTokenAddressSync,
} from '@solana/spl-token';

export const USDC_MAINNET = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

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

export function buildDelegateProbe({ ownerAta, mint, payTo, feePayer, sessionKey, units = 1000, decimals = 6, blockhash }) {
  const dstAta = getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(payTo), true);
  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }));
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }));
  tx.add(createTransferCheckedInstruction(
    new PublicKey(ownerAta), new PublicKey(mint), dstAta, sessionKey.publicKey, BigInt(units), decimals,
  ));
  tx.feePayer = new PublicKey(feePayer);
  tx.recentBlockhash = blockhash;
  tx.partialSign(sessionKey);
  return tx;
}
