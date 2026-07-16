import { createX402Wallet, createSvmSigner } from './src/index.js';
import { keypairAdapter } from './keypair-adapter.mjs';
const RPC = process.env.SOL_RPC || 'https://api.mainnet-beta.solana.com';
const ENDPOINT = process.env.X402_ENDPOINT || 'https://x402.ochinimus.app/api/sol-price';
const PAYER = process.env.PAYER || './payer.json';
const svmSigner = await createSvmSigner(await keypairAdapter(PAYER));
const wallet = createX402Wallet({ svmSigner, rpcUrl: RPC, caps: { maxPerCallUsd: 0.01, maxTotalUsd: 0.05 } });
console.log('payer :', svmSigner.address);
console.log('paying:', ENDPOINT);
const res = await wallet.payFetch(ENDPOINT);
console.log('status:', res.status);
const h = res.headers.get('payment-response') || res.headers.get('x-payment-response');
if (h) { try { console.log('settlement:', JSON.stringify(JSON.parse(Buffer.from(h,'base64').toString('utf8')), null, 2)); } catch { console.log('settle raw:', h); } }
console.log('receipts:', JSON.stringify(wallet.receipts, null, 2));
console.log('body  :', (await res.text()).slice(0, 200));
