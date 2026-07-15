// Proves the native-Allowances instructions are byte-correct against the program spec:
// right program, right discriminators, right PDAs, right account roles, cap encoded,
// and — the key property for x402 — the SESSION KEY is the signer on the per-call pull.
import { Keypair, PublicKey } from '@solana/web3.js';
import {
  SUBSCRIPTIONS_PROGRAM_ID, USDC_MAINNET,
  ixInitSubscriptionAuthority, ixCreateFixedDelegation, ixTransferFixed, ixRevokeDelegation,
  subscriptionAuthorityPda, delegationPda,
} from '../src/allowance.js';

const user = Keypair.generate().publicKey;
const session = Keypair.generate();
const merchant = new PublicKey('4a8o45skRPcyjAdyR8yES215Swvh8uTpZD6KLarhxCJ7');

let pass = true;
const check = (name, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) pass = false; };

// 1. every instruction targets the Foundation program
const init = ixInitSubscriptionAuthority(user);
const create = ixCreateFixedDelegation({ user, sessionKey: session.publicKey, capUnits: 5_000_000, saInitId: 123n });
const pull = ixTransferFixed({ user, sessionKey: session.publicKey, receiver: merchant, amount: 1000 });
const revoke = ixRevokeDelegation({ user, sessionKey: session.publicKey });
for (const [n, ix] of [['init', init], ['create', create], ['pull', pull], ['revoke', revoke]]) {
  check(`${n} -> subscriptions program`, ix.programId.equals(SUBSCRIPTIONS_PROGRAM_ID));
}

// 2. discriminators
check('init disc = 0', init.data[0] === 0);
check('create disc = 1', create.data[0] === 1);
check('revoke disc = 3', revoke.data[0] === 3);
check('pull disc = 4', pull.data[0] === 4);

// 3. cap ($5 = 5_000_000) encoded at offset 9 of CreateFixedDelegation
check('cap encoded', create.data.readBigUInt64LE(9) === 5_000_000n);
check('saInitId encoded', create.data.readBigInt64LE(25) === 123n);

// 4. PDAs derive on-curve and consistently
const [sa] = subscriptionAuthorityPda(user, USDC_MAINNET);
const [del] = delegationPda(sa, user, session.publicKey, 0);
check('SA in create accounts', create.keys.some(k => k.pubkey.equals(sa)));
check('delegation PDA in pull accounts', pull.keys.some(k => k.pubkey.equals(del)));

// 5. THE property that makes x402 work: on the per-call pull, the SESSION KEY signs,
//    the USER does NOT. (User only signs init + create + revoke.)
const pullSigners = pull.keys.filter(k => k.isSigner).map(k => k.pubkey.toBase58());
check('pull: session key signs', pullSigners.includes(session.publicKey.toBase58()));
check('pull: user does NOT sign', !pullSigners.includes(user.toBase58()));
check('create: user signs (the one prompt)', create.keys.find(k => k.pubkey.equals(user))?.isSigner === true);

// 6. transfer amount + delegator + mint packed correctly (TransferData)
check('pull amount = 1000', pull.data.readBigUInt64LE(1) === 1000n);
check('pull delegator = user', new PublicKey(pull.data.subarray(9, 41)).equals(user));
check('pull mint = USDC', new PublicKey(pull.data.subarray(41, 73)).equals(USDC_MAINNET));

console.log(pass ? '\nALLOWANCE TEST PASSED' : '\nALLOWANCE TEST FAILED');
process.exit(pass ? 0 : 1);
