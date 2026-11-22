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
import { renderHome } from './views/home.js';
import { monthStartDay, periodOf, anchorFor } from './period.js';
import { pad } from './format.js';

const TABS = {
  home: { title: 'Főoldal', render: renderHome },
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

const state = { tab: 'home', day: new Date(), month: new Date(), editId: null, presetDay: null };
let navToken = 0;

// Nézetváltás; a patch-ben adható át pl. { day }, { month }, { editId }, { presetDay }.
async function go(tab, patch = {}) {
  Object.assign(state, {
    editId: null, presetDay: null, returnTo: null, apptId: null, apptNew: false, apptDate: null,
    presetType: null, presetCat: null, weather: false,
  }, patch, { tab });
  for (const b of tabButtons) {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  title.textContent = state.editId ? 'Tétel szerkesztése' : state.weather ? 'Időjárás' : TABS[tab].title;
  updateFab();
  updateHeader();
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

/* ----- Fejléc: aktuális pénzügyi hónap és utolsó szinkron ----- */

const topMonth = document.getElementById('top-month');
const topSync = document.getElementById('top-sync');
const ymd = d => `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}.`;

async function updateHeader() {
  try {
    const s = await monthStartDay();
    const p = periodOf(anchorFor(new Date(), s), s);
    const last = new Date(p.to.getFullYear(), p.to.getMonth(), p.to.getDate() - 1);
    topMonth.textContent = `${ymd(p.from)} – ${ymd(last)}`;
  } catch { /* még nincs betöltve */ }
  if (!db.cloud) {
    topSync.textContent = 'Helyi tárolás';
  } else if (!navigator.onLine) {
    topSync.textContent = 'Nincs internet – a telefonon tárolt adatok';
  } else {
    const t = db.lastSyncAt();
    topSync.textContent = t ? `Utolsó szinkron: ${pad(new Date(t).getHours())}:${pad(new Date(t).getMinutes())}` : 'Szinkronizálás…';
  }
}
setInterval(updateHeader, 30000);
addEventListener('online', updateHeader);
addEventListener('offline', updateHeader);

// Frissítés gomb: kapcsolat-ellenőrzés a felhővel, app-frissítés keresése, a nézet újrarajzolása.
const refreshBtn = document.getElementById('refresh');
refreshBtn.addEventListener('click', async () => {
  if (refreshBtn.classList.contains('spinning')) return;
  refreshBtn.classList.add('spinning');
  const ok = await db.pingServer();
  navigator.serviceWorker?.getRegistration?.().then(r => r?.update()).catch(() => {});
  refreshBtn.classList.remove('spinning');
  updateHeader();
  const typing = document.activeElement?.matches?.('#view input, #view textarea');
  const editing = document.querySelector('#appt-form, form .amount-wrap input#amount') && state.tab !== 'home';
  if (!typing && !editing) go(state.tab, { keepScroll: true, todoId: state.todoId, apptId: state.apptId, weather: state.weather });
  toast(ok ? 'Az adatok frissek' : 'Nincs kapcsolat a felhővel – a telefonon tárolt adatok látszanak');
});

/* ----- Lebegő + gomb: új tétel (a listanézetekben) ----- */

const fab = document.getElementById('fab');
const FAB_TABS = ['home', 'day', 'search', 'month', 'charts'];
function updateFab() {
  const show = FAB_TABS.includes(state.tab) && !state.weather;
  fab.hidden = !show;
  document.body.classList.toggle('has-fab', show);
}
fab.addEventListener('click', () => go('entry'));

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
    await go('home');
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
  updateHeader();
  if ((['home', 'day', 'month', 'charts'].includes(state.tab) && !typing
       || (['todos', 'calendar'].includes(state.tab) && !typing && !editingAppt))
      && !document.querySelector('dialog[open]')) {
    // A nyitott al-nézetek (időjárás, teendőlista) megmaradnak.
    go(state.tab, { keepScroll: true, weather: state.weather, todoId: state.todoId });
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
