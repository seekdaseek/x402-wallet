// Session budgets: cap encoded in Approve, delegate is the transfer authority,
// session key signs silently and validly, revoke is one instruction.
import nacl from 'tweetnacl';
import { Keypair } from '@solana/web3.js';
import { createSessionBudget, sessionAdapter, buildDelegateProbe, USDC_MAINNET } from '../src/budget.js';

const owner = Keypair.generate();
const { sessionKey, approveTx, revokeTx, ata } = createSessionBudget({
  owner: owner.publicKey.toBase58(), capUnits: 5_000_000, // $5 cap
});

const app = approveTx.instructions[0];
const capOk = Buffer.from(app.data).readBigUInt64LE(1) === 5_000_000n;
const delegateIsSession = app.keys.some(k => k.pubkey.equals(sessionKey.publicKey));
console.log('Approve: cap=$5 encoded:', capOk, '| delegate = session key:', delegateIsSession, '| revoke ixs:', revokeTx.instructions.length);

const probe = buildDelegateProbe({
  ownerAta: ata.toBase58(), mint: USDC_MAINNET.toBase58(),
  payTo: '4a8o45skRPcyjAdyR8yES215Swvh8uTpZD6KLarhxCJ7',
  feePayer: 'D6ZhtNQ5nT9ZnTHUbqXZsTx5MH2rPFiBBggX4hY1WePM',
  sessionKey, blockhash: '11111111111111111111111111111111',
});
const xfer = probe.instructions[2];
const authorityIsDelegate = xfer.keys[3].pubkey.equals(sessionKey.publicKey) && xfer.keys[3].isSigner;
const sig = probe.signatures.find(s => s.publicKey.equals(sessionKey.publicKey))?.signature;
const sigValid = sig && nacl.sign.detached.verify(probe.compileMessage().serialize(), sig, sessionKey.publicKey.toBytes());
console.log('DelegateProbe: authority = delegate & signer:', authorityIsDelegate, '| foreign feePayer:', probe.feePayer.toBase58().slice(0,4)==='D6Zh', '| session sig valid:', !!sigValid);

// adapter path: silent signing, no wallet involved
const b64 = probe.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
const [signed] = await sessionAdapter(sessionKey).signPayloads([b64]);
console.log('sessionAdapter signs silently:', typeof signed === 'string' && signed.length > 100);

if (!capOk || !delegateIsSession || !authorityIsDelegate || !sigValid) { console.error('BUDGET TEST FAILED'); process.exit(1); }
console.log('BUDGET TEST PASSED');
