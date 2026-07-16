import fs from 'node:fs';
import { createKeyPairFromBytes, getAddressFromPublicKey, partiallySignTransaction, getBase64EncodedWireTransaction, getTransactionDecoder } from '@solana/kit';
const dec = getTransactionDecoder();
export async function keypairAdapter(path) {
  const kp = await createKeyPairFromBytes(Uint8Array.from(JSON.parse(fs.readFileSync(path, 'utf8'))));
  const addr = await getAddressFromPublicKey(kp.publicKey);
  return {
    getAddress: async () => addr,
    signPayloads: async (b64Txs) => {
      const out = [];
      for (const b64 of b64Txs) {
        const tx = dec.decode(Uint8Array.from(Buffer.from(b64, 'base64')));
        out.push(getBase64EncodedWireTransaction(await partiallySignTransaction([kp], tx)));
      }
      return out;
    },
  };
}
