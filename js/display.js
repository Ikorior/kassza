// A felület mérete. Készülékenként mentődik (localStorage), mert telefononként más a jó méret.
// „Automatikus” módban a képernyő méretéhez igazodik.

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

// Az Új tétel oldal 100%-on kb. 760 pont magas és kb. 400 pont szélességre van méretezve.
// Annyira kicsinyítünk, hogy görgetés nélkül elférjen (80–100%, 5%-os lépésekben).
// Kezdőképernyős módban a felső és alsó rendszersáv (kb. 96 pont) is a képernyőből jön le.
export function autoPercent() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const free = innerHeight - (standalone ? 96 : 0);
  const f = Math.min(free / 760, innerWidth / 400);
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

addEventListener('resize', () => { if (getSetting() === 'auto') apply(); });
apply();
