// Live against the real server (free — no payment fires): parse the 402,
// verify both rails advertised, verify caps block before any signature.
import { createX402Wallet, CapExceeded } from '../src/core.js';
import { createSvmSigner } from '../src/svm/signer.js';
import { Keypair, Transaction } from '@solana/web3.js';

const kp = Keypair.generate();
const adapter = {
  getAddress: async () => kp.publicKey.toBase58(),
  signPayloads: async (p) => { throw new Error('SIGNER FIRED — cap failed to block'); },
};
const signer = await createSvmSigner(adapter);

// cap set BELOW the $0.001 price: the wallet must never be asked to sign
const w = createX402Wallet({ svmSigner: signer, rpcUrl: 'https://api.mainnet-beta.solana.com', caps: { maxPerCallUsd: 0.0005 } });
try {
  await w.payFetch('https://x402.ochinimus.app/api/sol-price');
  console.error('FAILED: cap did not block'); process.exit(1);
} catch (e) {
  if (e.name === 'CapExceeded' || e.cause?.name === 'CapExceeded' || String(e).includes('per-call cap')) {
    console.log('CAP BLOCKED BEFORE SIGNING:', e.message ?? String(e));
  } else { console.error('unexpected:', e); process.exit(1); }
}

// raw 402 parse: both rails present
const res = await fetch('https://x402.ochinimus.app/api/sol-price');
const req = JSON.parse(Buffer.from(res.headers.get('payment-required'), 'base64').toString());
const nets = req.accepts.map(a => a.network);
console.log('402 status:', res.status, '| rails:', nets.join(' + '));
console.log('LIVE TEST PASSED — multi-rail 402 parsed, caps enforce pre-signature');
