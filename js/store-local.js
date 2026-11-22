// Helyi adatréteg (IndexedDB) – felhő nélkül minden adat a készüléken marad.

import { SEED, uid, sortTx } from './store-common.js';

const DB = 'kassza';
const VERSION = 3; // 2: teendőlisták, 3: naptár

export const cloud = false;

// Helyi módban nincs belépés és nincs távoli változás.
export const onAuth = cb => cb({ email: '' });
export const signIn = async () => {};
export const signOut = async () => {};
export const userEmail = () => '';
export const onChange = () => {};
export const syncPending = () => false;
export const lastSyncAt = () => 0;
export const pingServer = async () => true;

let opening;
function open() {
  return (opening ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      const has = name => db.objectStoreNames.contains(name);
      if (!has('transactions')) db.createObjectStore('transactions', { keyPath: 'id' }).createIndex('timestamp', 'timestamp');
      if (!has('categories')) db.createObjectStore('categories', { keyPath: 'id' });
      if (!has('clients')) db.createObjectStore('clients', { keyPath: 'name' });
      if (!has('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      if (!has('todos')) db.createObjectStore('todos', { keyPath: 'id' });
      if (!has('appointments')) db.createObjectStore('appointments', { keyPath: 'id' });
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

// Közös beállítások: helyi módban csak egy készülék van, így ugyanott tároljuk.
export const getShared = key => getMeta('shared:' + key);
export const setShared = (key, value) => setMeta('shared:' + key, value);

/* ----- Mentés / visszatöltés ----- */

/* ----- Teendőlisták ----- */

export const getTodos = async () => done((await os('todos')).getAll());
export const getTodo = async id => done((await os('todos')).get(id));
export const saveTodo = async list => done((await os('todos', 'readwrite')).put(list));
export const deleteTodo = async id => done((await os('todos', 'readwrite')).delete(id));

/* ----- Naptár: találkozók ----- */

export const getAppts = async () => done((await os('appointments')).getAll());
export const getAppt = async id => done((await os('appointments')).get(id));
export const saveAppt = async appt => done((await os('appointments', 'readwrite')).put(appt));
export const deleteAppt = async id => done((await os('appointments', 'readwrite')).delete(id));

/* ----- Mentés / visszatöltés ----- */

const BACKUP = ['transactions', 'categories', 'clients', 'todos', 'appointments'];

export async function exportAll() {
  const db = await open();
  const tx = db.transaction(BACKUP);
  const [transactions, categories, clients, todos, appointments] =
    await Promise.all(BACKUP.map(n => done(tx.objectStore(n).getAll())));
  return { app: 'kassza', version: 1, exportedAt: new Date().toISOString(), categories, transactions, clients, todos, appointments };
}

// A jelenlegi adatokat a mentés tartalmára cseréli (egy tranzakcióban).
// A teendőlistákhoz és a naptárhoz csak akkor nyúl, ha a mentés tartalmazza őket.
export async function importAll(data) {
  const db = await open();
  const names = ['transactions', 'categories', 'clients', ...['todos', 'appointments'].filter(n => n in data)];
  const tx = db.transaction(names, 'readwrite');
  for (const name of names) {
    const s = tx.objectStore(name);
    s.clear();
    for (const row of data[name] ?? []) s.put(row);
  }
  await txDone(tx);
}
