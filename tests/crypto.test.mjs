import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,webcrypto} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {checkBundle,decryptBundle,importSecret} from '../crypto.js';

test('encrypted package decrypts only with matching key',async()=>{
  const secret=randomBytes(32);
  const text='RFKEY1:'+secret.toString('base64url');
  const readKey=await importSecret(text);
  const writeKey=await webcrypto.subtle.importKey('raw',secret,{name:'AES-GCM'},false,['encrypt']);
  const header=Buffer.concat([Buffer.from('RFDATA01'),randomBytes(12)]);
  const sample={v:1,records:[[1,42,'Example','A','B',['42','example']]]};
  const zipped=gzipSync(Buffer.from(JSON.stringify(sample)));
  const ciphertext=await webcrypto.subtle.encrypt(
    {name:'AES-GCM',iv:header.subarray(8),additionalData:header,tagLength:128},
    writeKey,zipped);
  const bundle=Buffer.concat([header,Buffer.from(ciphertext)]);
  const bytes=bundle.buffer.slice(bundle.byteOffset,bundle.byteOffset+bundle.byteLength);
  checkBundle(bytes);
  const opened=await decryptBundle(bytes,readKey);
  assert.deepEqual(opened,sample.records);
  const badSecret=await importSecret('RFKEY1:'+randomBytes(32).toString('base64url'));
  await assert.rejects(()=>decryptBundle(bytes,badSecret),/do not match/);
});
test('key and package input validation',async()=>{
  await assert.rejects(()=>importSecret('not-a-key'),/Invalid key/);
  assert.throws(()=>checkBundle(new ArrayBuffer(8)),/invalid or oversized/i);
});
