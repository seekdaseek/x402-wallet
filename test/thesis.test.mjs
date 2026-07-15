// THE regression test: a wallet that mutates the transaction (exactly what Seed Vault
// does — CU price 1000 -> 100000, measured on device) breaks a PartialSigner and is
// handled correctly by the ModifyingSigner. Wire-level, mirrors the device probe.
import nacl from 'tweetnacl';
import {
  Keypair, PublicKey, TransactionMessage, VersionedTransaction,
  ComputeBudgetProgram, SystemProgram,
} from '@solana/web3.js';

const FACILITATOR = new PublicKey('D6ZhtNQ5nT9ZnTHUbqXZsTx5MH2rPFiBBggX4hY1WePM');
const user = Keypair.generate();

// --- the transaction x402 builds: v0, foreign feePayer ---
const msg = new TransactionMessage({
  payerKey: FACILITATOR,
  recentBlockhash: '11111111111111111111111111111111',
  instructions: [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
    SystemProgram.transfer({ fromPubkey: user.publicKey, toPubkey: user.publicKey, lamports: 1 }),
  ],
}).compileToV0Message();
const original = new VersionedTransaction(msg);
const originalBytes = original.message.serialize();

// --- mock Seed Vault: mutates CU price, signs ITS message, returns signed+unsent ---
function seedVaultMock(b64) {
  const tx = VersionedTransaction.deserialize(Buffer.from(b64, 'base64'));
  const priceIx = tx.message.compiledInstructions[1];
  const d = Buffer.from(priceIx.data); d.writeBigUInt64LE(100000n, 1); priceIx.data = new Uint8Array(d);
  const mutatedBytes = tx.message.serialize();
  const sig = nacl.sign.detached(mutatedBytes, user.secretKey);
  const idx = tx.message.staticAccountKeys.findIndex(k => k.equals(user.publicKey));
  tx.signatures[idx] = sig;
  return { signedB64: Buffer.from(tx.serialize()).toString('base64'), sig };
}

const wallet = seedVaultMock(Buffer.from(original.serialize()).toString('base64'));

// PATH A — TransactionPartialSigner semantics: staple wallet sig onto the ORIGINAL message.
const partialValid = nacl.sign.detached.verify(originalBytes, wallet.sig, user.publicKey.toBytes());

// PATH B — TransactionModifyingSigner semantics: carry the WALLET's transaction through.
const carried = VersionedTransaction.deserialize(Buffer.from(wallet.signedB64, 'base64'));
const carriedBytes = carried.message.serialize();
const idx = carried.message.staticAccountKeys.findIndex(k => k.equals(user.publicKey));
const modifyingValid = nacl.sign.detached.verify(carriedBytes, carried.signatures[idx], user.publicKey.toBytes());

// structural invariants the facilitator checks
const feePayerIntact = carried.message.staticAccountKeys[0].equals(FACILITATOR);
const ixCount = carried.message.compiledInstructions.length;
const cuPrice = Buffer.from(carried.message.compiledInstructions[1].data).readBigUInt64LE(1);

console.log('PartialSigner path  -> signature valid over submitted message:', partialValid, '(must be FALSE)');
console.log('ModifyingSigner path-> signature valid over submitted message:', modifyingValid, '(must be TRUE)');
console.log('feePayer intact:', feePayerIntact, '| ix count:', ixCount, '| CU price after wallet:', cuPrice.toString());

if (partialValid || !modifyingValid || !feePayerIntact || ixCount !== 3 || cuPrice !== 100000n) {
  console.error('THESIS TEST FAILED'); process.exit(1);
}
console.log('THESIS TEST PASSED — mutating wallets require TransactionModifyingSigner');
