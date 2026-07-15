// Offline replay of the LIVE 402 captured from x402.ochinimus.app/api/sol-price on 14 Jul 2026.
// Same guard path as production: caps must block BEFORE the wallet is ever asked to sign.
// NOTE: fetch must be stubbed BEFORE the x402 graph loads — parts of it bind
// global fetch at import time. Real apps never stub, so this is harness-only.

const REAL_402_HEADER = 'eyJ4NDAyVmVyc2lvbiI6MiwiZXJyb3IiOiJQYXltZW50IHJlcXVpcmVkIiwicmVzb3VyY2UiOnsidXJsIjoiaHR0cHM6Ly94NDAyLm9jaGluaW11cy5hcHAvYXBpL3NvbC1wcmljZSIsImRlc2NyaXB0aW9uIjoiU09MIHNwb3QgcHJpY2UgdmlhIFB5dGgiLCJtaW1lVHlwZSI6IiIsInNlcnZpY2VOYW1lIjoiQWdlbnRGZWVkIiwidGFncyI6WyJjcnlwdG8iLCJwcmljZSIsInNvbGFuYSIsInB5dGgiXX0sImFjY2VwdHMiOlt7InNjaGVtZSI6ImV4YWN0IiwibmV0d29yayI6InNvbGFuYTo1ZXlrdDRVc0Z2OFA4TkpkVFJFcFkxdnpxS3FaS3ZkcCIsImFtb3VudCI6IjEwMDAiLCJhc3NldCI6IkVQakZXZGQ1QXVmcVNTcWVNMnFOMXh6eWJhcEM4RzR3RUdHa1p3eVREdDF2IiwicGF5VG8iOiI0YThvNDVza1JQY3lqQWR5Ujh5RVMyMTVTd3ZoOHVUcFpENktMYXJoeENKNyIsIm1heFRpbWVvdXRTZWNvbmRzIjozMDAsImV4dHJhIjp7ImZlZVBheWVyIjoiRDZaaHROUTVuVDlablRIVWJxWFpzVHg1TUgyclBGaUJCZ2dYNGhZMVdlUE0ifX0seyJzY2hlbWUiOiJleGFjdCIsIm5ldHdvcmsiOiJlaXAxNTU6ODQ1MyIsImFtb3VudCI6IjEwMDAiLCJhc3NldCI6IjB4ODMzNTg5ZkNENmVEYjZFMDhmNGM3QzMyRDRmNzFiNTRiZEEwMjkxMyIsInBheVRvIjoiMHgyMkRCM0E5Njg2RUU1MjYxZTdCZjNlZDRmOTEyNzcyMzJFODA3NmU2IiwibWF4VGltZW91dFNlY29uZHMiOjMwMCwiZXh0cmEiOnsibmFtZSI6IlVTRCBDb2luIiwidmVyc2lvbiI6IjIifX1dfQ==';

// Unconditional stub: the sandbox has no network, and the wrapper swallows
// side-channel fetch failures by returning the original response — which would
// mask the guard. Every URL gets the captured 402.
globalThis.fetch = async () => new Response('{}', { status: 402, headers: { 'payment-required': REAL_402_HEADER } });
const { createX402Wallet } = await import('../src/core.js');
const { createSvmSigner } = await import('../src/svm/signer.js');
const { Keypair } = await import('@solana/web3.js');

let signerFired = false;
const kp = Keypair.generate();
const signer = await createSvmSigner({
  getAddress: async () => kp.publicKey.toBase58(),
  signPayloads: async () => { signerFired = true; throw new Error('signer fired'); },
});

// Case 1: cap BELOW the $0.001 price -> must block pre-signature
const strict = createX402Wallet({ svmSigner: signer, rpcUrl: 'https://x/', caps: { maxPerCallUsd: 0.0005 } });
let blocked = false;
try { await strict.payFetch('https://x402.ochinimus.app/api/sol-price'); }
catch (e) { console.log('caught ->', e?.name, '|', e?.message); blocked = (e?.name === 'CapExceeded') || (e?.cause?.name === 'CapExceeded'); }
console.log('cap $0.0005 vs price $0.001 -> blocked before signing:', blocked, '| wallet ever asked:', signerFired);

// Case 2: parse rails from the same header
const req = JSON.parse(Buffer.from(REAL_402_HEADER, 'base64').toString());
console.log('rails advertised:', req.accepts.map(a => a.network).join('  +  '));
console.log('cheapest:', Math.min(...req.accepts.map(a => +a.amount)) / 1e6, 'USD');

if (!blocked || signerFired) { console.error('REPLAY TEST FAILED'); process.exit(1); }
console.log('REPLAY TEST PASSED — caps enforce pre-signature on the real production 402');
