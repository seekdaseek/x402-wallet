// EVM/Base signer: x402's exact/EVM scheme needs only EIP-712 signTypedData —
// an off-chain authorization (no fee payer problem, no mutation problem).
// Every injected wallet (MetaMask, Coinbase Wallet, Rabby) exposes eth_signTypedData_v4.

/** From any EIP-1193 provider (window.ethereum). */
export function fromEip1193(provider, addr) {
  return {
    address: addr,
    signTypedData: async ({ domain, types, primaryType, message }) => provider.request({
      method: 'eth_signTypedData_v4',
      params: [addr, JSON.stringify({ domain, types, primaryType, message })],
    }),
  };
}

/** From a viem WalletClient (browser or local account). */
export function fromViemWalletClient(walletClient, account) {
  const addr = account?.address ?? walletClient.account.address;
  return {
    address: addr,
    signTypedData: (msg) => walletClient.signTypedData({ account: account ?? walletClient.account, ...msg }),
  };
}
