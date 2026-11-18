import * as display from './display.js';
import * as db from './db.js';
import { toast } from './ui.js';
import { renderEntry } from './views/entry.js';
import { renderDay, renderMonth } from './views/summary.js';
import { renderCharts } from './views/charts.js';
import { renderSettings } from './views/settings.js';
import { renderLogin } from './views/login.js';
import { renderSearch } from './views/search.js';
import { renderTodos } from './views/todos.js';
import { renderCalendar } from './views/calendar.js';

const TABS = {
  entry: { title: 'Új tétel', render: renderEntry },
  day: { title: 'Napi összesítő', render: renderDay },
  search: { title: 'Keresés és lista', render: renderSearch },
  month: { title: 'Havi összesítő', render: renderMonth },
  charts: { title: 'Grafikonok', render: renderCharts },
  todos: { title: 'Teendők', render: renderTodos },
  calendar: { title: 'Naptár', render: renderCalendar },
  settings: { title: 'Beállítások', render: renderSettings },
};

const view = document.getElementById('view');
const title = document.getElementById('title');
// Az alsó fülsáv gombjai és a fejléc Beállítások gombja.
const tabButtons = [...document.querySelectorAll('button[data-tab]')];

const state = { tab: 'entry', day: new Date(), month: new Date(), editId: null, presetDay: null };
let navToken = 0;

// Nézetváltás; a patch-ben adható át pl. { day }, { month }, { editId }, { presetDay }.
async function go(tab, patch = {}) {
  Object.assign(state, { editId: null, presetDay: null, returnTo: null, apptId: null, apptNew: false, apptDate: null }, patch, { tab });
  for (const b of tabButtons) {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  title.textContent = state.editId ? 'Tétel szerkesztése' : TABS[tab].title;
  // Minden nézet saját konténerbe rajzol; ha közben újabb váltás indult, a régit eldobjuk.
  const token = ++navToken;
  const page = document.createElement('div');
  try {
    await TABS[tab].render(page, ctx);
  } catch (err) {
    // Ne „fagyjon be” a képernyő: jelezzük, és maradunk az előző nézeten.
    console.error(err);
    if (token === navToken) toast('Ezt most nem sikerült megnyitni. Próbáld újra.');
    return;
  }
  if (token !== navToken) return;
  view.replaceChildren(page);
  if (!patch.keepScroll) view.scrollTop = 0;
}

const ctx = { state, go };

// A Teendők fülre koppintva (ha már ott vagyunk) vissza a listák áttekintéséhez.
for (const b of tabButtons) {
  b.addEventListener('click', () =>
    go(b.dataset.tab, b.dataset.tab === 'todos' && state.tab === 'todos' ? { todoId: null } : {}));
}

function showMessage(text) {
  navToken++;
  const box = document.createElement('div');
  box.className = 'empty';
  box.append(Object.assign(document.createElement('p'), { textContent: text }));
  view.replaceChildren(box);
}

// Belépés figyelése. Helyi módban (felhő nélkül) azonnal „belépett” állapot érkezik.
db.onAuth(async user => {
  if (!user) {
    navToken++;
    document.body.classList.add('locked');
    title.textContent = 'Belépés';
    const page = document.createElement('div');
    renderLogin(page);
    view.replaceChildren(page);
    return;
  }
  try {
    await db.init();
    display.applyStored(await db.getMeta(display.cloudKey())); // a mentett méret
    document.body.classList.remove('locked');
    await go('entry');
  } catch (err) {
    console.error(err);
    showMessage(db.cloud
      ? 'A felhőben tárolt adatokat nem sikerült elérni. Ellenőrizd az internetkapcsolatot, majd nyisd meg újra az appot.'
      : 'Az adattárolót nem sikerült megnyitni. Privát böngészés módban az app nem tud adatot menteni – nyisd meg normál Safari-ablakban.');
  }
});

// Másik telefonról érkezett változás: az összesítő nézetek frissülnek.
// Az űrlapokat (új tétel, beállítások) nem rajzoljuk újra, hogy a beírt szöveg ne vesszen el.
db.onChange(() => {
  // A keresést sem rajzoljuk újra, hogy a beírt keresőszó és a görgetés megmaradjon.
  // A teendőket csak akkor, ha épp nem gépelünk bennük.
  const typing = document.activeElement?.matches?.('#view input');
  // A naptárat sem, ha épp egy találkozót szerkesztünk.
  const editingAppt = !!document.querySelector('#appt-form');
  if ((['day', 'month', 'charts'].includes(state.tab)
       || (['todos', 'calendar'].includes(state.tab) && !typing && !editingAppt))
      && !document.querySelector('dialog[open]')) {
    go(state.tab, { keepScroll: true });
  }
});

// iPhone: ha a billentyűzet miatt a böngésző feltolta az egész oldalt, a billentyűzet bezárása
// után nem húzza vissza, így a fejléc (és benne pl. a „‹ Listák” gomb) kilóg a képből.
// A felület maga nem görgethető (csak a középső rész), ezért ilyenkor visszaállítjuk.
const resetPageShift = () => {
  if (window.scrollY || document.documentElement.scrollTop || document.body.scrollTop) {
    window.scrollTo(0, 0);
    document.body.scrollTop = 0;
  }
};
document.addEventListener('focusout', () => {
  setTimeout(() => {
    if (!document.activeElement?.matches?.('input, textarea, select')) resetPageShift();
  }, 60);
});
window.visualViewport?.addEventListener('resize', () => {
  if (window.visualViewport.height >= window.innerHeight - 2) resetPageShift(); // billentyűzet bezárva
});
window.addEventListener('scroll', () => {
  if (!document.activeElement?.matches?.('input, textarea, select')) resetPageShift();
});

// Offline működés: csak HTTPS-en (éles), vagy helyi teszthez a ?sw paraméterrel.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || new URLSearchParams(location.search).has('sw'))) {
  const hadController = !!navigator.serviceWorker.controller;

  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    // A háttérből visszahozott app is nézzen frissítést (az iPhone nem mindig indítja újra).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch(err => console.warn('Service worker hiba:', err));

  // Új változat vette át az irányítást: újratöltjük, hogy azonnal az fusson.
  // Ha épp félig kitöltött tétel van a képernyőn, megvárjuk, amíg az app háttérbe kerül.
  let reloading = false;
  const reload = () => { if (!reloading) { reloading = true; location.reload(); } };
  const busy = () => !!document.querySelector('dialog[open]')
    || (state.tab === 'entry' && ['#amount', '#client', '#note', '#newcat-name']
      .some(sel => document.querySelector(sel)?.value?.trim()));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return; // legelső telepítés: nincs mit frissíteni
    if (!busy()) return reload();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') reload();
    });
  });
}
