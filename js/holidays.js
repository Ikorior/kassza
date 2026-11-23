// Magyarországi munkaszüneti napok és pihenőnapok (a naptár színezéséhez).
// Fix ünnepek + húsvéthoz kötöttek (nagypéntek, húsvét, pünkösd), valamint az évenkénti
// rendeletben áthelyezett napok. Új év rendeletét az EXTRA_OFF / EXTRA_WORK listákba kell felvenni.

const FIXED = ['01-01', '03-15', '05-01', '08-20', '10-23', '11-01', '12-25', '12-26'];

// Áthelyezett pihenőnapok (piros) és ledolgozós szombatok (munkanap, kék).
// 2026: 10/2025. (IV. 30.) NGM rendelet, a 2026. novemberi módosítással (dec. 12. már nem munkanap).
const EXTRA_OFF = new Set(['2026-01-02', '2026-08-21']);
const EXTRA_WORK = new Set(['2026-01-10', '2026-08-08']);

const pad = n => String(n).padStart(2, '0');
const key = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Húsvétvasárnap (Gergely-naptár, Meeus/Jones/Butcher-módszer).
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}

const cache = new Map();
function holidaysOf(y) {
  if (cache.has(y)) return cache.get(y);
  const set = new Set(FIXED.map(md => `${y}-${md}`));
  if (y >= 2025) set.add(`${y}-12-24`); // 2025-től szenteste is munkaszüneti nap
  const e = easter(y);
  for (const off of [-2, 0, 1, 49, 50]) set.add(key(new Date(y, e.getMonth(), e.getDate() + off)));
  cache.set(y, set);
  return set;
}

// Igaz, ha a nap hétvége, ünnep vagy áthelyezett pihenőnap (és nem ledolgozós szombat).
export function isDayOff(d) {
  const k = key(d);
  if (EXTRA_WORK.has(k)) return false;
  return d.getDay() === 0 || d.getDay() === 6 || EXTRA_OFF.has(k) || holidaysOf(d.getFullYear()).has(k);
}
