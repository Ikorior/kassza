// Felhős adatréteg (Firebase Firestore + e-mail/jelszó belépés).
// Minden adat a users/{uid}/... útvonal alatt van, így a közös fiókkal belépő telefonok
// ugyanazt látják. A Firestore saját offline tárolója miatt térerő nélkül is lehet rögzíteni;
// az írások kapcsolat esetén maguktól feltöltődnek.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut as fbSignOut,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, deleteDoc, getDoc, getDocs, onSnapshot, query, where,
  writeBatch, getCountFromServer,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

import { firebaseConfig } from './firebase-config.js';
import { SEED, uid, sortTx } from './store-common.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const fs = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

export const cloud = true;

let user = null;
let ready = null;      // az első betöltés ígérete
let unsubs = [];
let cutoff = 0;        // ennél újabb tételeket élőben figyeljük (kb. az utolsó 12 hónap)
let pending = false;   // van-e még fel nem töltött tétel
const mem = { categories: [], clients: [], recent: [], todos: [], settings: {} };
const changeListeners = new Set();

const col = name => collection(fs, 'users', user.uid, name);
const ref = (name, id) => doc(fs, 'users', user.uid, name, id);
const clientId = name => 'c_' + encodeURIComponent(name);

// Az írásokat nem várjuk meg: offline a szerver visszaigazolása csak később érkezik.
const fire = promise => { promise.catch(err => console.error('Felhő írási hiba:', err)); };

/* ----- Belépés ----- */

export function onAuth(cb) {
  onAuthStateChanged(auth, u => {
    stop();
    user = u;
    cb(u ? { email: u.email } : null);
  });
}
export const signIn = (email, password) => signInWithEmailAndPassword(auth, email, password);
export const signOut = () => fbSignOut(auth);
export const userEmail = () => user?.email ?? '';
export const onChange = fn => changeListeners.add(fn);
export const syncPending = () => pending;

function stop() {
  unsubs.forEach(u => u());
  unsubs = [];
  ready = null;
  pending = false;
  mem.categories = [];
  mem.clients = [];
  mem.recent = [];
  mem.todos = [];
  mem.settings = {};
}

/* ----- Élő figyelés ----- */

function listen(q, apply) {
  return new Promise((resolve, reject) => {
    let first = true;
    unsubs.push(onSnapshot(q, { includeMetadataChanges: true }, snap => {
      apply(snap);
      if (first) {
        first = false;
        resolve();
      } else if (snap.docChanges().some(c => !c.doc.metadata.hasPendingWrites)) {
        // Másik telefonról érkezett változás.
        changeListeners.forEach(fn => fn());
      }
    }, reject));
  });
}

// A beállítások telefononként külön dokumentumban: users/{uid}/devices/{képernyőméret}.
// A képernyőméret (pl. „402x874”) a telefon tárolójától független, így az app törlése vagy
// újratelepítése után is ugyanazt a dokumentumot találja meg. Két egyforma típusú telefon
// ugyanazt a beállítást kapná.
export const deviceKey = () =>
  `${Math.min(screen.width, screen.height)}x${Math.max(screen.width, screen.height)}`;
const settingsRef = () => ref('devices', deviceKey());

function listenSettings() {
  return new Promise((resolve, reject) => {
    let first = true;
    unsubs.push(onSnapshot(settingsRef(), snap => {
      mem.settings = snap.data() ?? {};
      if (first) {
        first = false;
        resolve();
      } else if (!snap.metadata.hasPendingWrites) {
        changeListeners.forEach(fn => fn());
      }
    }, reject));
  });
}

export function init() {
  return (ready ??= (async () => {
    const now = new Date();
    cutoff = new Date(now.getFullYear(), now.getMonth() - 12, 1).getTime();
    await Promise.all([
      listenSettings(),
      listen(col('categories'), snap => {
        mem.categories = snap.docs.map(d => d.data());
        // Vadonatúj fiók: az induló típusok felvétele (rögzített azonosítókkal, hogy
        // két telefon egyidejű első indítása se duplikáljon).
        if (snap.empty && !snap.metadata.fromCache) {
          SEED.forEach((c, i) => saveCategory({ id: 'seed-' + i, isClientPayment: false, ...c, order: i, archived: false }));
        }
      }),
      listen(col('clients'), snap => {
        mem.clients = snap.docs.map(d => d.data().name);
      }),
      listen(col('todos'), snap => {
        mem.todos = snap.docs.map(d => d.data());
      }),
      listen(query(col('transactions'), where('timestamp', '>=', cutoff)), snap => {
        mem.recent = snap.docs.map(d => d.data());
        pending = snap.metadata.hasPendingWrites;
      }),
    ]);
  })());
}

/* ----- Kategóriák ----- */

export async function getCategories() {
  return [...mem.categories].sort((a, b) => a.order - b.order);
}

export async function saveCategory(cat) {
  fire(setDoc(ref('categories', cat.id), cat));
  mem.categories = [...mem.categories.filter(c => c.id !== cat.id), cat];
  return cat;
}

export async function addCategory(type, name) {
  const clean = name.trim();
  const existing = mem.categories.find(
    c => c.type === type && c.name.toLocaleLowerCase('hu') === clean.toLocaleLowerCase('hu'));
  if (existing) {
    if (existing.archived) await saveCategory({ ...existing, archived: false });
    return existing;
  }
  return saveCategory({ id: uid(), type, name: clean, isClientPayment: false, order: Date.now(), archived: false });
}

/* ----- Tételek ----- */

export async function txInRange(from, to) {
  if (from >= cutoff) {
    return sortTx(mem.recent.filter(t => t.timestamp >= from && t.timestamp < to));
  }
  // Régebbi időszak: külön lekérdezés (kapcsolat nélkül a készülék tárolójából).
  const snap = await getDocs(query(col('transactions'), where('timestamp', '>=', from), where('timestamp', '<', to)));
  return sortTx(snap.docs.map(d => d.data()));
}

export async function getTx(id) {
  return mem.recent.find(t => t.id === id) ?? (await getDoc(ref('transactions', id))).data();
}

export async function saveTx(tx) {
  fire(setDoc(ref('transactions', tx.id), tx));
  mem.recent = mem.recent.filter(t => t.id !== tx.id);
  if (tx.timestamp >= cutoff) mem.recent.push(tx);
}

export async function deleteTx(id) {
  fire(deleteDoc(ref('transactions', id)));
  mem.recent = mem.recent.filter(t => t.id !== id);
}

export async function txCount() {
  try {
    const timeout = new Promise((_, reject) => setTimeout(reject, 3000));
    const snap = await Promise.race([getCountFromServer(col('transactions')), timeout]);
    return snap.data().count;
  } catch {
    return mem.recent.length;
  }
}

/* ----- Ügyfélnevek ----- */

export async function getClients() {
  return [...mem.clients].sort((a, b) => a.localeCompare(b, 'hu'));
}

export async function addClient(name) {
  fire(setDoc(ref('clients', clientId(name)), { name }));
  if (!mem.clients.includes(name)) mem.clients.push(name);
}

/* ----- Telefononkénti beállítások (hónap kezdőnapja, méret, utolsó fájlmentés…) ----- */
// A felhőben vannak (lásd settingsRef), így az app bezárása vagy a telefon tárolójának
// ürítése után is megmaradnak. (A localStorage-ba írt adat az iPhone-on bezáráskor elveszhet.)

const legacy = key => {
  try { return JSON.parse(localStorage.getItem('kassza-' + key)); } catch { return undefined; }
};

export async function getMeta(key) {
  return key in mem.settings ? mem.settings[key] : legacy(key) ?? undefined;
}

export async function setMeta(key, value) {
  mem.settings = { ...mem.settings, [key]: value };
  fire(setDoc(settingsRef(), { [key]: value }, { merge: true }));
}

/* ----- Teendőlisták (közösek: minden belépett telefon ugyanazokat látja) ----- */

export async function getTodos() {
  return [...mem.todos];
}
export async function getTodo(id) {
  return mem.todos.find(t => t.id === id);
}
export async function saveTodo(list) {
  fire(setDoc(ref('todos', list.id), list));
  mem.todos = [...mem.todos.filter(t => t.id !== list.id), list];
}
export async function deleteTodo(id) {
  fire(deleteDoc(ref('todos', id)));
  mem.todos = mem.todos.filter(t => t.id !== id);
}

/* ----- Mentés / visszatöltés ----- */

export async function exportAll() {
  const [transactions, categories, clients, todos] = await Promise.all(
    ['transactions', 'categories', 'clients', 'todos'].map(async n => (await getDocs(col(n))).docs.map(d => d.data())));
  return { app: 'kassza', version: 1, exportedAt: new Date().toISOString(), categories, transactions, clients, todos };
}

// A felhőben lévő adatokat a mentés tartalmára cseréli. Internetkapcsolat kell hozzá.
export async function importAll(data) {
  if (!navigator.onLine) throw new Error('offline');

  const targets = [
    ...data.transactions.map(t => [ref('transactions', t.id), t]),
    ...data.categories.map(c => [ref('categories', c.id), c]),
    ...(data.clients ?? []).filter(c => c?.name).map(c => [ref('clients', clientId(c.name)), { name: c.name }]),
    ...(data.todos ?? []).filter(t => t?.id).map(t => [ref('todos', t.id), t]),
  ];
  const keep = new Set(targets.map(([r]) => r.path));

  // A teendőlistákhoz csak akkor nyúlunk, ha a mentés tartalmazza őket
  // (régi mentés visszatöltése vagy a tesztadatok törlése nem érinti őket).
  const names = ['transactions', 'categories', 'clients', ...('todos' in data ? ['todos'] : [])];
  const ops = [];
  for (const name of names) {
    (await getDocs(col(name))).forEach(d => { if (!keep.has(d.ref.path)) ops.push(b => b.delete(d.ref)); });
  }
  for (const [r, row] of targets) ops.push(b => b.set(r, row));

  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(fs);
    ops.slice(i, i + 400).forEach(op => op(batch));
    await batch.commit();
  }
}
