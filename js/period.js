// Pénzügyi hónap (a Havi és a Grafikon lap közös időszaka).
// Egy hónap a kezdőnaptól (1–28) a következő hónap kezdőnapja előtti napig tart.
// Alapból 8-ától a következő hónap 7-éig. A kezdőnap közös (mindkét telefonon ugyanaz),
// és a Beállításokban módosítható.

import * as db from './db.js';
import { addDays, addMonths, startOfMonth } from './format.js';

export const DEFAULT_MONTH_START = 8;

export async function monthStartDay() {
  const v = Number(await db.getShared('monthStart'));
  return v >= 1 && v <= 28 ? v : DEFAULT_MONTH_START;
}

export const setMonthStartDay = day => db.setShared('monthStart', day);

// pl. „8-ától a következő hónap 7-éig” / „naptári hónap (1-jétől a hónap végéig)”
export const startDayText = s => (s === 1
  ? 'naptári hónap (1-jétől a hónap végéig)'
  : `minden hónap ${s}. napjától a következő hónap ${s - 1}. napjáig`);

// A hónap (anchor) időszaka: [from, to) – a „to” már nem tartozik bele.
export const periodOf = (anchor, s) => ({
  from: new Date(anchor.getFullYear(), anchor.getMonth(), s),
  to: new Date(anchor.getFullYear(), anchor.getMonth() + 1, s),
});

// Az a hónap, amelynek időszakába a megadott nap esik.
export const anchorFor = (day, s) => addMonths(startOfMonth(day), day.getDate() >= s ? 0 : -1);

// Első megnyitáskor (vagy a kezdőnap módosítása után) a mai napot tartalmazó hónapra áll.
export function currentAnchor(state, s) {
  if (!state.monthSet) {
    state.month = anchorFor(new Date(), s);
    state.monthSet = true;
  }
  return startOfMonth(state.month);
}

const shortDate = (d, withYear) =>
  d.toLocaleDateString('hu-HU', { ...(withYear ? { year: 'numeric' } : {}), month: 'short', day: 'numeric' });

// pl. „2026. okt. 10. – nov. 9.”
export function rangeText({ from, to }) {
  const last = addDays(to, -1);
  return `${shortDate(from, true)} – ${shortDate(last, last.getFullYear() !== from.getFullYear())}`;
}
