// Proves the mutation guard behind the ModifyingSigner. A wallet that touches only the
// compute-unit price/limit is accepted; a wallet that changes the amount, recipient,
// mint, instruction set, or fee payer is rejected. Mutation model mirrors the on-device
// behaviour proven in thesis.test.mjs (Seed Vault rewrites the CU price).
import {
  Keypair, PublicKey, TransactionMessage, VersionedTransaction,
  ComputeBudgetProgram, SystemProgram,
} from '@solana/web3.js';
import { assertOnlyComputeBudgetChanged, WalletMutationError } from '../src/svm/verify.js';

const FEEPAYER = new PublicKey('D6ZhtNQ5nT9ZnTHUbqXZsTx5MH2rPFiBBggX4hY1WePM'); // x402 facilitator
const user = Keypair.generate();
const rcv = Keypair.generate();
const ATTACKER = Keypair.generate().publicKey;
const BH = '11111111111111111111111111111111';

// Build a base64 wire tx: [setComputeUnitLimit, setComputeUnitPrice, ...transfers].
function build({
  payer = FEEPAYER,
  cuLimit = 200000,
  cuPrice = 1000,
  transfers = [{ to: rcv.publicKey, amount: 5 }],
} = {}) {
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: cuPrice }),
    ...transfers.map((t) =>
      SystemProgram.transfer({ fromPubkey: user.publicKey, toPubkey: t.to, lamports: t.amount }),
    ),
  ];
  const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: BH, instructions: ixs }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(msg).serialize()).toString('base64');
}

const SENT = build(); // what we hand the wallet

let pass = 0, fail = 0;
const accept = (name, returned) => {
  try { assertOnlyComputeBudgetChanged(SENT, returned); console.log('  PASS  accept:', name); pass++; }
  catch (e) { console.error('  FAIL  accept:', name, '->', e.message); fail++; }
};
const reject = (name, returned) => {
  try { assertOnlyComputeBudgetChanged(SENT, returned); console.error('  FAIL  reject:', name, '-> guard let it through'); fail++; }
  catch (e) {
    if (e instanceof WalletMutationError) { console.log('  PASS  reject:', name, '->', e.message); pass++; }
    else { console.error('  FAIL  reject:', name, '-> wrong error type:', e.message); fail++; }
  }
};

console.log('ACCEPT — legitimate wallet mutations (compute budget only):');
accept('unchanged', build());
accept('CU price rewritten (1000 -> 100000)', build({ cuPrice: 100000 }));
accept('CU limit rewritten', build({ cuLimit: 50000 }));
accept('CU price + limit both changed', build({ cuPrice: 100000, cuLimit: 50000 }));

console.log('\nREJECT — value-moving mutations:');
reject('amount inflated (5 -> 5,000,000)', build({ transfers: [{ to: rcv.publicKey, amount: 5_000_000 }] }));
reject('recipient swapped to attacker', build({ transfers: [{ to: ATTACKER, amount: 5 }] }));
reject('extra drain instruction added', build({ transfers: [{ to: rcv.publicKey, amount: 5 }, { to: ATTACKER, amount: 9 }] }));
reject('transfer instruction removed', build({ transfers: [] }));
reject('fee payer changed', build({ payer: ATTACKER }));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
