// Helyi adatréteg (IndexedDB) – felhő nélkül minden adat a készüléken marad.

import { SEED, uid, sortTx } from './store-common.js';

const DB = 'kassza';
const VERSION = 1;

export const cloud = false;

// Helyi módban nincs belépés és nincs távoli változás.
export const onAuth = cb => cb({ email: '' });
export const signIn = async () => {};
export const signOut = async () => {};
export const userEmail = () => '';
export const onChange = () => {};
export const syncPending = () => false;

let opening;
function open() {
  return (opening ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('transactions', { keyPath: 'id' }).createIndex('timestamp', 'timestamp');
      db.createObjectStore('categories', { keyPath: 'id' });
      db.createObjectStore('clients', { keyPath: 'name' });
      db.createObjectStore('meta', { keyPath: 'key' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}

const done = r => new Promise((res, rej) => {
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
const txDone = tx => new Promise((res, rej) => {
  tx.oncomplete = () => res();
  tx.onerror = () => rej(tx.error);
  tx.onabort = () => rej(tx.error);
});
async function os(name, mode = 'readonly') {
  return (await open()).transaction(name, mode).objectStore(name);
}

export async function init() {
  const count = await done((await os('categories')).count());
  if (!count) {
    const tx = (await open()).transaction('categories', 'readwrite');
    const s = tx.objectStore('categories');
    SEED.forEach((c, i) => s.put({ id: uid(), isClientPayment: false, ...c, order: i, archived: false }));
    await txDone(tx);
  }
  // Kérjük a böngészőt, hogy ne ürítse a tárolót helyhiány esetén.
  navigator.storage?.persist?.().catch(() => {});
}

/* ----- Kategóriák ----- */

export async function getCategories() {
  const all = await done((await os('categories')).getAll());
  return all.sort((a, b) => a.order - b.order);
}

export async function saveCategory(cat) {
  await done((await os('categories', 'readwrite')).put(cat));
  return cat;
}

// Új kategória; azonos nevű meglévőt nem duplikál (elrejtettet visszaállít).
export async function addCategory(type, name) {
  const clean = name.trim();
  const existing = (await getCategories()).find(
    c => c.type === type && c.name.toLocaleLowerCase('hu') === clean.toLocaleLowerCase('hu'));
  if (existing) {
    if (existing.archived) await saveCategory({ ...existing, archived: false });
    return existing;
  }
  return saveCategory({ id: uid(), type, name: clean, isClientPayment: false, order: Date.now(), archived: false });
}

/* ----- Tételek ----- */

export async function txInRange(from, to) {
  const idx = (await os('transactions')).index('timestamp');
  return sortTx(await done(idx.getAll(IDBKeyRange.bound(from, to, false, true))));
}

export const getTx = async id => done((await os('transactions')).get(id));
export const saveTx = async tx => done((await os('transactions', 'readwrite')).put(tx));
export const deleteTx = async id => done((await os('transactions', 'readwrite')).delete(id));
export const txCount = async () => done((await os('transactions')).count());

/* ----- Ügyfélnevek ----- */

export async function getClients() {
  const all = await done((await os('clients')).getAll());
  return all.map(c => c.name).sort((a, b) => a.localeCompare(b, 'hu'));
}
export const addClient = async name => done((await os('clients', 'readwrite')).put({ name }));

/* ----- Egyéb ----- */

export const getMeta = async key => (await done((await os('meta')).get(key)))?.value;
export const setMeta = async (key, value) => done((await os('meta', 'readwrite')).put({ key, value }));

/* ----- Mentés / visszatöltés ----- */

export async function exportAll() {
  const db = await open();
  const tx = db.transaction(['transactions', 'categories', 'clients']);
  const [transactions, categories, clients] = await Promise.all(
    ['transactions', 'categories', 'clients'].map(n => done(tx.objectStore(n).getAll())));
  return { app: 'kassza', version: 1, exportedAt: new Date().toISOString(), categories, transactions, clients };
}

// A jelenlegi adatokat teljes egészében a mentés tartalmára cseréli (egy tranzakcióban).
export async function importAll(data) {
  const db = await open();
  const tx = db.transaction(['transactions', 'categories', 'clients'], 'readwrite');
  for (const name of ['transactions', 'categories', 'clients']) {
    const s = tx.objectStore(name);
    s.clear();
    for (const row of data[name] ?? []) s.put(row);
  }
  await txDone(tx);
}
