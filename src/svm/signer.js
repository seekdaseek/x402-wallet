// The core insight of this library, encoded once:
// MWA wallets may MODIFY a transaction before signing (Seed Vault rewrites the
// compute-unit price — measured on device). So the signer MUST be a
// @solana/kit TransactionModifyingSigner. A TransactionPartialSigner staples the
// wallet's signature onto the ORIGINAL message and verification fails silently.
//
// A wallet being ALLOWED to mutate is not the same as being allowed to mutate
// ANYTHING. assertOnlyComputeBudgetChanged confirms the wallet touched nothing but
// the compute-unit price/limit before we return its transaction for submission — so
// a wallet (or a compromised adapter) cannot rewrite the amount, recipient or mint
// under cover of the legitimate CU-price mutation.
import { address, getBase64EncodedWireTransaction, getTransactionDecoder } from '@solana/kit';
import { assertOnlyComputeBudgetChanged } from './verify.js';

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
      // GUARD: the wallet's transaction is carried through verbatim — its mutation and
      // its signature together — but ONLY after confirming that mutation was limited to
      // ComputeBudget. Any change to amount, recipient, mint or the instruction set
      // throws WalletMutationError here, before the tx can be submitted.
      return signed.map((b64, i) => {
        assertOnlyComputeBudgetChanged(payloads[i], b64);
        return txDecoder.decode(Uint8Array.from(Buffer.from(b64, 'base64')));
      });
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
