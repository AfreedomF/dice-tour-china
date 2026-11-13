import test from 'node:test';
import assert from 'node:assert/strict';
import {createIdentity,sharedKey,encrypt,decrypt,seal,open,randomHex,privateKey} from '../shared/network-crypto.js';

test('ECDH agreement, authenticated topic binding, signature integrity and random IVs',async()=>{
  const alice=await createIdentity(),bob=await createIdentity(),key=await sharedKey(randomHex(32));
  const a=await privateKey(alice,bob.dhPublic),b=await privateKey(bob,alice.dhPublic);
  const ct=await encrypt(a,{cards:['private']},'epoch:identity');
  assert.deepEqual(await decrypt(b,ct,'epoch:identity'),{cards:['private']});
  await assert.rejects(decrypt(b,ct,'wrong-identity'));
  const one=await seal(key,alice,{kind:'test'},'private-topic'),two=await seal(key,alice,{kind:'test'},'private-topic');
  assert.notEqual(one,two);assert.equal((await open(key,one,'private-topic')).from,alice.id);
  await assert.rejects(open(key,one,'different-topic'));
  await assert.rejects(open(await sharedKey(randomHex(32)),one,'private-topic'));
  const forged=JSON.parse(one);forged.ct='00'+forged.ct.slice(2);await assert.rejects(open(key,JSON.stringify(forged),'private-topic'));
});
