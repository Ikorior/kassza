// A helyi és a felhős adatréteg közös részei.

export const SEED = [
  { type: 'income', name: 'Ügyfél befizetés', isClientPayment: true },
  { type: 'income', name: 'Egyéb bevétel' },
  { type: 'expense', name: 'Üzemanyag' },
  { type: 'expense', name: 'Anyagköltség' },
  { type: 'expense', name: 'Bérleti díj' },
  { type: 'expense', name: 'Rezsi' },
  { type: 'expense', name: 'Étkezés' },
  { type: 'expense', name: 'Egyéb' },
];

export const uid = () =>
  crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);

export function validateBackup(data) {
  return !!data && data.app === 'kassza' && Array.isArray(data.transactions) && Array.isArray(data.categories)
    && data.categories.every(c => c && c.id && c.name && (c.type === 'income' || c.type === 'expense'))
    && data.transactions.every(t => t && t.id && Number.isFinite(t.amount) && Number.isFinite(t.timestamp));
}

export const sortTx = rows => rows.sort((a, b) => a.timestamp - b.timestamp || a.createdAt - b.createdAt);
