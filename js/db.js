// Adatréteg-választó: ha van Firebase-beállítás, a felhős tároló fut, különben a helyi.
// A nézetek csak ezt a modult használják.

import { firebaseConfig } from './firebase-config.js';

export { uid, validateBackup } from './store-common.js';

const backend = await (firebaseConfig?.apiKey ? import('./store-cloud.js') : import('./store-local.js'));

export const {
  cloud,
  onAuth, signIn, signOut, userEmail, onChange, syncPending,
  init,
  getCategories, saveCategory, addCategory,
  txInRange, getTx, saveTx, deleteTx, txCount,
  getClients, addClient,
  getMeta, setMeta,
  getShared, setShared,
  getTodos, getTodo, saveTodo, deleteTodo,
  getAppts, getAppt, saveAppt, deleteAppt,
  exportAll, importAll,
} = backend;
