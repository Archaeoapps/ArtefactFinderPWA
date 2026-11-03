const STORE='local-vault';
const VERSION=1;
function connect(){
  return new Promise((resolve,reject)=>{
    if(!('indexedDB'in globalThis)) {reject(new Error('Local storage is unavailable.'));return;}
    const request=indexedDB.open(STORE,VERSION);
    request.onupgradeneeded=()=>{
      if(!request.result.objectStoreNames.contains('items'))
        request.result.createObjectStore('items',{keyPath:'id'});
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error('Unable to open local storage.'));
    request.onblocked=()=>reject(new Error('Local storage is busy. Close other tabs.'));
  });
}
export async function loadVault() {
  const db=await connect();
  try {
    return await new Promise((resolve,reject)=>{
      const request=db.transaction('items','readonly').objectStore('items').get('active');
      request.onsuccess=()=>resolve(request.result||null);
      request.onerror=()=>reject(request.error||new Error('Unable to read local data.'));
    });
  }finally{ db.close(); }
}
export async function saveVault(bundle,key) {
  const db=await connect();
  try{
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction('items','readwrite');
      tx.objectStore('items').put({id:'active',bundle,key});
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error||new Error('Unable to save local data.'));
      tx.onabort=()=>reject(tx.error||new Error('Local data write aborted.'));
    });
  }finally{db.close();}
}
