// A felület mérete. „Automatikus” módban a képernyő méretéhez igazodik.
// Mentés: a felhőben, telefononként külön (store-cloud.js → settingsRef), hogy bezárás után
// se vesszen el; a localStorage csak gyorsítótár, hogy indításkor azonnal jó méretben jelenjen meg.

const KEY = 'kassza-scale';
export const MIN = 70;
export const MAX = 130;

export function getSetting() {
  try {
    const v = Number(localStorage.getItem(KEY));
    return v >= MIN && v <= MAX ? v : 'auto';
  } catch {
    return 'auto';
  }
}

// Az Új tétel oldal 100%-on kb. 800 pont magas (fejléccel, fülsorral) és kb. 400 pont szélességre van méretezve.
// Annyira kicsinyítünk, hogy görgetés nélkül elférjen (80–100%, 5%-os lépésekben).
// Kezdőképernyős módban a felső és alsó rendszersáv (kb. 96 pont) is a képernyőből jön le.
export function autoPercent() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const free = innerHeight - (standalone ? 96 : 0);
  const f = Math.min(free / 800, innerWidth / 400);
  return Math.min(100, Math.max(80, Math.floor(f * 20) * 5));
}

export const currentPercent = () => {
  const s = getSetting();
  return s === 'auto' ? autoPercent() : s;
};

export function apply() {
  document.documentElement.style.setProperty('--scale', (currentPercent() / 100).toFixed(2));
}

export function setSetting(value) {
  try {
    if (value === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(value));
  } catch { /* privát módban nem menthető, de erre a munkamenetre érvényes */ }
  apply();
}

// A felhős beállítások már telefononként külön dokumentumban vannak, így elég egy kulcs.
export const cloudKey = () => 'scale';

// A felhőben tárolt érték ('auto' vagy szám) alkalmazása induláskor.
export function applyStored(value) {
  if (value === 'auto' || (Number(value) >= MIN && Number(value) <= MAX)) setSetting(value === 'auto' ? 'auto' : Number(value));
}

addEventListener('resize', () => { if (getSetting() === 'auto') apply(); });
apply();
