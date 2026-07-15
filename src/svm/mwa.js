// Seed Vault / Mobile Wallet Adapter adapter (Android, React Native). Device-only.
// Uses the RAW protocol — @x402 runs on @solana/kit (web3.js v2); the -web3js wrapper
// would only add a lossy v1 conversion.
// NOTE for RN: the x402 client derives ATAs via crypto.subtle (SHA-256), which RN lacks.
// Import '@seekdaseek/x402-wallet/rn-polyfill' first.
export function mwaAdapter({ transact, cluster = 'mainnet-beta', identity }) {
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const b64ToBytes = (s) => {
    s = s.replace(/=+$/, '');
    const out = new Uint8Array((s.length * 3) >> 2);
    let bits = 0, acc = 0, p = 0;
    for (const ch of s) { acc = (acc << 6) | B64.indexOf(ch); bits += 6; if (bits >= 8) { bits -= 8; out[p++] = (acc >> bits) & 0xff; } }
    return out.subarray(0, p);
  };
  let cachedAddress = null;
  return {
    getAddress: async () => {
      if (cachedAddress) return cachedAddress;
      const { getAddressDecoder } = await import('@solana/kit');
      cachedAddress = await transact(async (w) => {
        const auth = await w.authorize({ cluster, identity });
        return getAddressDecoder().decode(b64ToBytes(auth.accounts[0].address));
      });
      return cachedAddress;
    },
    signPayloads: (payloads) => transact(async (w) => {
      await w.authorize({ cluster, identity });          // fresh authorize inside EVERY transact
      const res = await w.signTransactions({ payloads }); // sign, NOT sign-and-send
      return res.signed_payloads;
    }),
  };
}
