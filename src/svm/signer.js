// The core insight of this library, encoded once:
// MWA wallets may MODIFY a transaction before signing (Seed Vault rewrites the
// compute-unit price — measured on device). So the signer MUST be a
// @solana/kit TransactionModifyingSigner. A TransactionPartialSigner staples the
// wallet's signature onto the ORIGINAL message and verification fails silently.
import { address, getBase64EncodedWireTransaction, getTransactionDecoder } from '@solana/kit';

const txDecoder = getTransactionDecoder();

/**
 * createSvmSigner(adapter)
 * adapter = {
 *   getAddress(): Promise<string base58>,
 *   signPayloads(base64Txs: string[]): Promise<string[] base64 signed txs>  // signed, UNSENT
 * }
 * Any wallet that can sign-without-sending plugs in here: MWA/Seed Vault,
 * wallet-standard, a test keypair, a mutating mock.
 */
export async function createSvmSigner(adapter) {
  const addr = address(await adapter.getAddress());
  return {
    address: addr,
    modifyAndSignTransactions: async (transactions) => {
      const payloads = transactions.map(getBase64EncodedWireTransaction);
      const signed = await adapter.signPayloads(payloads);
      // Return the WALLET's transaction verbatim — its mutation and its signature together.
      return signed.map(b64 => txDecoder.decode(Uint8Array.from(Buffer.from(b64, 'base64'))));
    },
  };
}

/** The WRONG implementation, exported only for the regression test that proves why. */
export async function createNaivePartialSigner(adapter) {
  const addr = address(await adapter.getAddress());
  return {
    address: addr,
    signTransactions: async (transactions) => {
      const payloads = transactions.map(getBase64EncodedWireTransaction);
      const signed = await adapter.signPayloads(payloads);
      return signed.map(b64 => {
        const tx = txDecoder.decode(Uint8Array.from(Buffer.from(b64, 'base64')));
        return { [addr]: tx.signatures[addr] }; // signature only — kit staples it onto ITS message
      });
    },
  };
}
