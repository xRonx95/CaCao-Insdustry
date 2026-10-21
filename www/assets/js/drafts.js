// Opt-in, encrypted device drafts. The passphrase/key is never persisted.
window.CacaoDrafts = (() => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  async function open() {
    return new Promise((resolve,reject) => {
      const request=indexedDB.open('cacao-encrypted-drafts',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('drafts',{keyPath:'id'});
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    });
  }
  async function transaction(mode,callback) {
    const database=await open();
    return new Promise((resolve,reject)=>{
      const tx=database.transaction('drafts',mode);const request=callback(tx.objectStore('drafts'));
      tx.oncomplete=()=>{database.close();resolve(request.result);};
      tx.onerror=()=>{database.close();reject(tx.error);};
      tx.onabort=()=>{database.close();reject(tx.error||new Error('Draft transaction aborted.'));};
    });
  }
  async function key(passphrase,salt) {
    if(passphrase.length<12)throw new Error('Use a draft passphrase with at least 12 characters.');
    const material=await crypto.subtle.importKey('raw',encoder.encode(passphrase),'PBKDF2',false,['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:210000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  }
  async function save(id,value,passphrase) {
    const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
    const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(id)},await key(passphrase,salt),encoder.encode(JSON.stringify(value)));
    await transaction('readwrite',store=>store.put({id,salt,iv,encrypted,savedAt:new Date().toISOString()}));
  }
  async function restore(id,passphrase) {
    const record=await transaction('readonly',store=>store.get(id));
    if(!record)throw new Error('No saved draft was found for this record on this device.');
    try {
      const data=await crypto.subtle.decrypt({name:'AES-GCM',iv:record.iv,additionalData:encoder.encode(id)},await key(passphrase,record.salt),record.encrypted);
      return JSON.parse(decoder.decode(data));
    } catch {throw new Error('The passphrase is incorrect or the draft is damaged.');}
  }
  async function createVault(id,passphrase) {
    const salt=crypto.getRandomValues(new Uint8Array(16));
    const encryptionKey=await key(passphrase,salt);
    let writes=Promise.resolve();
    return {
      save(value) {
        const snapshot=JSON.stringify(value);
        writes=writes.catch(()=>{}).then(async()=>{
          const iv=crypto.getRandomValues(new Uint8Array(12));
          const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(id)},encryptionKey,encoder.encode(snapshot));
          await transaction('readwrite',store=>store.put({id,salt,iv,encrypted,savedAt:new Date().toISOString()}));
        });
        return writes;
      }
    };
  }
  return {save,restore,createVault,exists:async id=>!!await transaction('readonly',store=>store.get(id)),remove:id=>transaction('readwrite',store=>store.delete(id))};
})();
