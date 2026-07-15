// x402-wallet core: payFetch with rail selection, client-side spend caps, receipts.
import { wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { ExactSvmScheme } from '@x402/svm/exact/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';

const DEFAULTS = { maxPerCallUsd: 0.10, maxTotalUsd: 5.00, railPreference: ['solana', 'eip155'] };

/**
 * createX402Wallet({ svmSigner?, evmSigner?, rpcUrl?, caps? })
 * Returns { payFetch, receipts, spentUsd }.
 * Caps are enforced BEFORE any signature is requested — a wallet prompt above cap never fires.
 */
export function createX402Wallet(opts = {}) {
  const caps = { ...DEFAULTS, ...(opts.caps || {}) };
  const receipts = [];
  let spentUsd = 0;

  const schemes = [];
  if (opts.svmSigner) schemes.push({ network: 'solana:*', client: new ExactSvmScheme(opts.svmSigner, { rpcUrl: opts.rpcUrl }) });
  if (opts.evmSigner) schemes.push({ network: 'eip155:*', client: new ExactEvmScheme(opts.evmSigner) });
  if (!schemes.length) throw new Error('x402-wallet: provide svmSigner and/or evmSigner');

  // Guard hook: parse the 402 before paying, enforce caps, record receipts.
  const guardedFetch = async (input, init) => {
    const res = await fetch(input, init);
    if (res.status !== 402) return res;

    const header = res.headers.get('payment-required');
    if (header) {
      const req = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
      const usd = cheapestUsd(req.accepts || []);
      if (usd != null) {
        if (usd > caps.maxPerCallUsd) throw new CapExceeded(`per-call cap: $${usd} > $${caps.maxPerCallUsd}`, usd);
        if (spentUsd + usd > caps.maxTotalUsd) throw new CapExceeded(`session cap: spent $${spentUsd.toFixed(4)} + $${usd} > $${caps.maxTotalUsd}`, usd);
      }
    }
    return res;
  };

  const payFetch = wrapFetchWithPaymentFromConfig(guardedFetch, { schemes });

  return {
    payFetch: async (url, init) => {
      const t0 = Date.now();
      const res = await payFetch(url, init);
      const settle = res.headers.get('payment-response');
      if (settle) {
        const info = safeDecode(settle);
        const usd = info?.amountUsd ?? null;
        if (usd) spentUsd += usd;
        receipts.push({ url: String(url), ts: t0, ms: Date.now() - t0, status: res.status, settlement: info });
      }
      return res;
    },
    receipts,
    get spentUsd() { return spentUsd; },
  };
}

export class CapExceeded extends Error { constructor(msg, usd) { super(msg); this.name = 'CapExceeded'; this.usd = usd; } }

// USDC-style 6-decimal assumption for cap math; exact settlement math stays in the SDK.
function cheapestUsd(accepts) {
  const amts = accepts.map(a => Number(a.amount)).filter(n => Number.isFinite(n));
  return amts.length ? Math.min(...amts) / 1e6 : null;
}
function safeDecode(b64) { try { return JSON.parse(Buffer.from(b64, 'base64').toString('utf8')); } catch { return null; } }
