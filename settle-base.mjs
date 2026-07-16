import { createX402Wallet, fromViemWalletClient } from './src/index.js';
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, http } from 'viem';
import { base } from 'viem/chains';
import fs from 'node:fs';
const pk = fs.readFileSync(process.env.EVM_PAYER || './payer-evm.key', 'utf8').trim();
const account = privateKeyToAccount(pk);
const walletClient = createWalletClient({ account, chain: base, transport: http(process.env.BASE_RPC || 'https://mainnet.base.org') });
const evmSigner = fromViemWalletClient(walletClient, account);
const wallet = createX402Wallet({ evmSigner, caps: { maxPerCallUsd: 0.01, maxTotalUsd: 0.05 } });
console.log('payer :', evmSigner.address);
const ENDPOINT = process.env.X402_ENDPOINT || 'https://x402.ochinimus.app/api/sol-price';
console.log('paying:', ENDPOINT);
const res = await wallet.payFetch(ENDPOINT);
console.log('status:', res.status);
const h = res.headers.get('payment-response') || res.headers.get('x-payment-response');
if (h) { try { console.log('settlement:', JSON.stringify(JSON.parse(Buffer.from(h,'base64').toString('utf8')), null, 2)); } catch { console.log('settle raw:', h); } }
console.log('receipts:', JSON.stringify(wallet.receipts, null, 2));
console.log('body  :', (await res.text()).slice(0, 200));
