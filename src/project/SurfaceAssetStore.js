import { openProjectDatabase } from './ProjectStore.js';
export async function surfaceBlobHash(blob) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('');
}
export async function putSurfaceBlob(blob) {
  const hash=await surfaceBlobHash(blob),db=await openProjectDatabase();
  await new Promise((resolve,reject)=>{const tx=db.transaction('surface-files','readwrite');tx.objectStore('surface-files').put({hash,blob});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);}).finally(()=>db.close());
  return {hash,bytes:blob.size,type:blob.type};
}
export async function getSurfaceBlob(hash) {
  const db=await openProjectDatabase();
  return new Promise((resolve,reject)=>{const request=db.transaction('surface-files').objectStore('surface-files').get(hash);request.onsuccess=()=>resolve(request.result?.blob||null);request.onerror=()=>reject(request.error);}).finally(()=>db.close());
}
