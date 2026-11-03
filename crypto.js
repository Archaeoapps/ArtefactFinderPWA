const MAGIC = 'RFDATA01';
const HEADER_SIZE = 20;
const MAX_BYTES = 25 * 1024 * 1024;

function fromUrlSafeBase64(value) {
  const normalized=value.replace(/-/g,'+').replace(/_/g,'/');
  const bytes=atob(normalized+'='.repeat((4-normalized.length%4)%4));
  return Uint8Array.from(bytes, c=>c.charCodeAt(0));
}

export async function importSecret(source) {
  const cleaned=String(source).replace(/^\uFEFF/,'').trim();
  const match=/^RFKEY1:([A-Za-z0-9_-]{43})$/.exec(cleaned);
  if(!match) throw new Error('Invalid key file.');
  const raw=fromUrlSafeBase64(match[1]);
  if(raw.byteLength!==32) throw new Error('Unsupported key length.');
  try {
    return await crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['decrypt']);
  } finally { raw.fill(0); }
}

export function checkBundle(buffer) {
  if(!(buffer instanceof ArrayBuffer)) throw new Error('Invalid data file.');
  if(buffer.byteLength<HEADER_SIZE+16 || buffer.byteLength>MAX_BYTES)
    throw new Error('Invalid or oversized encrypted data file.');
  const bytes=new Uint8Array(buffer,0,8);
  if(Array.from(bytes,c=>String.fromCharCode(c)).join('')!==MAGIC)
    throw new Error('Unknown encrypted data format.');
}

export async function decryptBundle(buffer,key) {
  checkBundle(buffer);
  const content=new Uint8Array(buffer);
  const header=content.subarray(0,HEADER_SIZE);
  const iv=content.subarray(8,HEADER_SIZE);
  let decrypted;
  try {
    decrypted=await crypto.subtle.decrypt(
      {name:'AES-GCM',iv,additionalData:header,tagLength:128},
      key,content.subarray(HEADER_SIZE)
    );
  } catch {
    throw new Error('The encrypted data and key do not match, or the data is damaged.');
  }
  if(typeof DecompressionStream==='undefined')
    throw new Error('This iOS version does not support the required data format.');
  let json;
  try {
    const stream=new Blob([decrypted]).stream().pipeThrough(new DecompressionStream('gzip'));
    const raw=await new Response(stream).arrayBuffer();
    if(raw.byteLength>25*1024*1024) throw new Error('Data exceeds the supported size.');
    json=JSON.parse(new TextDecoder().decode(raw));
  }catch(e){
    throw new Error('Unable to read the verified data: '+e.message);
  }
  if(json?.v!==1 || !Array.isArray(json.records) || !json.records.length)
    throw new Error('Unsupported dataset.');
  for(const row of json.records) {
    if(!Array.isArray(row) || row.length!==6 || !Array.isArray(row[5]))
      throw new Error('Invalid record format.');
  }
  return json.records;
}
