// Főoldal: időjárás, mai névnap, gyorsműveletek, mai találkozók, egyenleg a választott
// időszakra, legutóbbi tételek és a kiadások eloszlása.

import * as db from '../db.js';
import { ft, signed, dayKey, pad, startOfDay, addDays, esc, totals } from '../format.js';
import { monthStartDay, periodOf, anchorFor, rangeText } from '../period.js';
import { donut } from './charts.js';
import { infoDialog } from '../ui.js';

const PERIODS = [['day', 'Napi'], ['week', 'Heti'], ['month', 'Havi'], ['all', 'Összes']];
const norm = s => String(s ?? '').toLocaleLowerCase('hu').normalize('NFD').replace(/[̀-ͯ]/g, '');
const hm = ts => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const shortDay = d => d.toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' });

/* ---------- Időjárás (Open-Meteo, kulcs nélkül) ---------- */

// WMO időjáráskódok magyarul, ikonnal.
const WMO = {
  0: ['☀️', 'Derült'], 1: ['🌤️', 'Többnyire derült'], 2: ['⛅', 'Részben felhős'], 3: ['☁️', 'Borult'],
  45: ['🌫️', 'Köd'], 48: ['🌫️', 'Zúzmarás köd'],
  51: ['🌦️', 'Gyenge szitálás'], 53: ['🌦️', 'Szitálás'], 55: ['🌧️', 'Erős szitálás'],
  56: ['🌧️', 'Ónos szitálás'], 57: ['🌧️', 'Ónos szitálás'],
  61: ['🌦️', 'Gyenge eső'], 63: ['🌧️', 'Eső'], 65: ['🌧️', 'Erős eső'], 66: ['🌧️', 'Ónos eső'], 67: ['🌧️', 'Ónos eső'],
  71: ['🌨️', 'Gyenge havazás'], 73: ['🌨️', 'Havazás'], 75: ['❄️', 'Erős havazás'], 77: ['🌨️', 'Hószemcse'],
  80: ['🌦️', 'Zápor'], 81: ['🌧️', 'Zápor'], 82: ['⛈️', 'Heves zápor'], 85: ['🌨️', 'Hózápor'], 86: ['🌨️', 'Erős hózápor'],
  95: ['⛈️', 'Zivatar'], 96: ['⛈️', 'Zivatar jégesővel'], 99: ['⛈️', 'Zivatar jégesővel'],
};
const wmo = code => WMO[code] ?? ['🌡️', 'Időjárás'];

const withTimeout = (promise, ms = 8000) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

// Az időjárás 30 mp-enként frissül (lásd refreshLive); a 25 mp-es tárolás csak a
// gyors nézetváltásoknál spórol a lekérésen. force: a tárolt értéket figyelmen kívül hagyja.
let wxCache = { key: '', at: 0, data: null };
async function forecast(city, force = false) {
  const key = `${city.lat},${city.lon}`;
  if (!force && wxCache.key === key && Date.now() - wxCache.at < 25 * 1000) return wxCache.data;
  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${city.lat}&longitude=${city.lon}`
    + '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m'
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max'
    + '&timezone=auto&forecast_days=7';
  const data = await (await withTimeout(fetch(url))).json();
  wxCache = { key, at: Date.now(), data };
  return data;
}

async function searchCities(name) {
  const url = 'https://geocoding-api.open-meteo.com/v1/search'
    + `?name=${encodeURIComponent(name)}&count=8&language=hu&format=json`;
  const data = await (await withTimeout(fetch(url))).json();
  return (data.results ?? []).map(r => ({
    name: r.name, admin: [r.admin1, r.country].filter(Boolean).join(', '), lat: r.latitude, lon: r.longitude,
  }));
}

// Koordinátából településnév (BigDataCloud, kulcs nélküli kliensoldali szolgáltatás;
// csak a koordinátát kapja meg). A „Saját helyzetem” gombhoz.
const GPS_NAME = 'Saját helyzet';
async function placeName(lat, lon) {
  const url = 'https://api.bigdatacloud.net/data/reverse-geocode-client'
    + `?latitude=${lat}&longitude=${lon}&localityLanguage=hu`;
  const d = await (await withTimeout(fetch(url))).json();
  return {
    name: d.locality || d.city || d.principalSubdivision || GPS_NAME,
    admin: [d.principalSubdivision, d.countryName].filter(Boolean).join(', '),
  };
}

// A korábban név nélkül („Saját helyzet”) mentett helyet a településnévvel menti újra.
async function resolveCity(city) {
  if (!city || city.name !== GPS_NAME) return city;
  try {
    const place = await placeName(city.lat, city.lon);
    if (place.name === GPS_NAME) return city;
    const named = { ...city, ...place };
    await db.setMeta('weatherCity', named);
    return named;
  } catch {
    return city;
  }
}

/* ---------- Névnap (nameday.abalin.net, kulcs nélkül) ---------- */

// A névnap naponta egyszer töltődik le (a dátumhoz kötve tároljuk), így új napon magától
// az új névnap jön. force: újra lekéri (Frissítés gomb).
const ndCache = new Map();
async function namedays(date, force = false) {
  const key = dayKey(date);
  if (force) {
    ndCache.delete(key);
    try { localStorage.removeItem('kassza-nameday-' + key); } catch { /* nem fontos */ }
  }
  if (ndCache.has(key)) return ndCache.get(key);
  try {
    const stored = JSON.parse(localStorage.getItem('kassza-nameday-' + key));
    if (Array.isArray(stored)) { ndCache.set(key, stored); return stored; }
  } catch { /* nincs tárolva */ }
  const url = `https://nameday.abalin.net/api/V2/date?day=${date.getDate()}&month=${date.getMonth() + 1}&country=hu`;
  const data = await (await withTimeout(fetch(url))).json();
  const names = String(data?.data?.hu ?? '').split(',').map(n => n.trim()).filter(n => n && n !== 'n/a');
  ndCache.set(key, names);
  try { localStorage.setItem('kassza-nameday-' + key, JSON.stringify(names)); } catch { /* nem fontos */ }
  return names;
}

/* ---------- Főoldal ---------- */

function periodRange(mode, s) {
  const now = new Date();
  if (mode === 'day') {
    const from = startOfDay(now);
    return { from, to: addDays(from, 1), label: 'Ma' };
  }
  if (mode === 'week') {
    const from = addDays(startOfDay(now), -((now.getDay() + 6) % 7));
    return { from, to: addDays(from, 7), label: `Ezen a héten (${shortDay(from)} – ${shortDay(addDays(from, 6))})` };
  }
  if (mode === 'month') {
    const p = periodOf(anchorFor(now, s), s);
    return { ...p, label: `Pénzügyi hónap: ${rangeText(p)}` };
  }
  return { from: new Date(0), to: new Date(8.64e15), label: 'Minden rögzített tétel' };
}

export async function renderHome(el, ctx) {
  if (ctx.state.weather) return renderWeather(el, ctx);

  const mode = ctx.state.homePeriod ?? 'month';
  const s = await monthStartDay();
  const range = periodRange(mode, s);
  const [txs, cats, appts, city] = await Promise.all([
    db.txInRange(range.from.getTime(), range.to.getTime()),
    db.getCategories(),
    db.getAppts(),
    db.getMeta('weatherCity'),
  ]);
  const cmap = new Map(cats.map(c => [c.id, c]));
  const t = totals(txs);
  const today = dayKey(new Date());
  const todays = appts.filter(a => a.date === today).sort((a, b) => a.time.localeCompare(b.time));
  const recent = [...txs].sort((a, b) => b.timestamp - a.timestamp).slice(0, 5);
  const gmail = String((await db.getShared('gmailContacts')) ?? '').trim();

  el.innerHTML = `
    <button type="button" class="hero weather" id="wx-card">
      <span class="hero-icon" id="wx-icon">${city ? '⏳' : '🌤️'}</span>
      <span class="hero-main">
        <span class="eyebrow">📍 ${city ? esc(city.name) : 'Település keresése…'}</span>
        <b id="wx-main">${city ? 'Időjárás betöltése…' : 'Időjárás'}</b>
        <small id="wx-sub">${city ? '' : 'Érintsd meg az időjárás beállításához'}</small>
      </span>
      <span class="hero-side" id="wx-temp"></span>
    </button>

    <section class="hero nameday" aria-live="polite">
      <span class="hero-icon">🎉</span>
      <span class="hero-main">
        <span class="eyebrow">🎁 Mai névnap <span class="nd-date">${new Date().toLocaleDateString('hu-HU', { month: 'long', day: 'numeric', weekday: 'long' })}</span></span>
        <b id="nd-names">…</b>
        <small id="nd-clients"></small>
      </span>
    </section>

    <button type="button" class="hero contacts" id="gc-card">
      <span class="hero-icon">👥</span>
      <span class="hero-main">
        <span class="eyebrow">📇 Partnerek</span>
        <b>Gmail névjegyzék</b>
        <small>${gmail ? esc(gmail) : 'Érintsd meg a fiók beállításához'}</small>
      </span>
      <span class="hero-side" aria-hidden="true">›</span>
    </button>

    <h2>Gyors műveletek</h2>
    <div class="quick">
      <button type="button" class="quick-tile" data-quick="client"><span class="qi t-green">💵</span><b>Ügyfél bevétel</b><small>Új bevétel</small></button>
      <button type="button" class="quick-tile" data-quick="other"><span class="qi t-gold">💰</span><b>Egyéb bevétel</b><small>Egyéb jóváírás</small></button>
      <button type="button" class="quick-tile" data-quick="expense"><span class="qi t-red">🛍️</span><b>Kiadás</b><small>Kiadás hozzáadása</small></button>
      <button type="button" class="quick-tile" data-quick="appt"><span class="qi t-purple">📅</span><b>Új találkozó</b><small>A naptárba</small></button>
    </div>

    ${todays.length ? `
      <div class="home-head"><h2>Mai találkozók</h2><button type="button" data-goto="calendar">Naptár</button></div>
      <ul class="list">${todays.map(a => `
        <li><button type="button" class="appt-mini s-${a.status}" data-appt="${a.id}">
          <span class="t">${a.time}–${a.arriveTo || ''}</span><span class="n">${esc(a.name)}</span>
          ${a.amount ? `<span class="a">${ft(a.amount)}</span>` : ''}
        </button></li>`).join('')}</ul>` : ''}

    <h2>Egyenleg</h2>
    <div class="seg four" role="group" aria-label="Időszak">
      ${PERIODS.map(([id, label]) => `<button type="button" data-period="${id}" aria-pressed="${id === mode}">${label}</button>`).join('')}
    </div>
    <div class="home-sum">
      <div class="home-card wide">
        <span class="hc-label">Egyenleg <span aria-hidden="true">✦</span></span>
        <strong class="${t.bal < 0 ? 'neg' : 'pos'}">${t.bal < 0 ? '−' : ''}${ft(Math.abs(t.bal))}</strong>
        <small>${esc(range.label)}</small>
      </div>
      <div class="home-card">
        <span class="hc-icon">💵</span><span class="hc-label">Összes bevétel</span>
        <strong class="pos">${ft(t.inc)}</strong><small>Ügyfél + egyéb bevétel</small>
      </div>
      <div class="home-card">
        <span class="hc-icon">💸</span><span class="hc-label">Összes kiadás</span>
        <strong class="neg">${ft(t.exp)}</strong><small>Kiadások összesen</small>
      </div>
    </div>

    <div class="home-head"><h2>Legutóbbi tételek</h2><button type="button" data-goto="search">Összes tétel</button></div>
    ${recent.length ? `<ul class="list">${recent.map(x => {
      const sub = [x.clientName, x.note].filter(Boolean).join(' · ');
      return `
        <li><button type="button" class="tx" data-tx="${x.id}">
          <span class="tx-time">${shortDay(new Date(x.timestamp))}<br>${hm(x.timestamp)}</span>
          <span class="tx-main"><b>${esc(cmap.get(x.categoryId)?.name ?? 'Törölt típus')}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>
          <span class="tx-amt ${x.type === 'income' ? 'pos' : 'neg'}">${signed(x.amount, x.type)}</span>
        </button></li>`;
    }).join('')}</ul>`
    : '<div class="empty"><p>Ebben az időszakban még nincs bejegyzés.</p><span class="hint">Az első tétel hozzáadása után itt jelenik meg.</span></div>'}

    <div class="home-head"><h2>Kiadások eloszlása</h2></div>
    <div class="chart">${donut(txs.filter(x => x.type === 'expense'), cmap, 'Még nincs megjeleníthető kiadás.', 'Kiadások eloszlása típusonként')}</div>`;

  el.onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'wx-card') ctx.go('home', { weather: true });
    else if (b.id === 'gc-card') {
      // A megadott fiók névjegyzéke (a Safariban ebbe a fiókba be kell lenni jelentkezve).
      if (gmail) window.open(`https://contacts.google.com/?authuser=${encodeURIComponent(gmail)}`, '_blank', 'noopener');
      else ctx.go('settings');
    }
    else if (b.dataset.period) { ctx.state.homePeriod = b.dataset.period; ctx.go('home', { keepScroll: true }); }
    else if (b.dataset.quick === 'client') ctx.go('entry', { presetType: 'income', presetCat: 'client' });
    else if (b.dataset.quick === 'other') ctx.go('entry', { presetType: 'income', presetCat: 'other' });
    else if (b.dataset.quick === 'expense') ctx.go('entry', { presetType: 'expense' });
    else if (b.dataset.quick === 'appt') ctx.go('calendar', { apptNew: true, apptDate: today });
    else if (b.dataset.appt) ctx.go('calendar', { apptId: b.dataset.appt });
    else if (b.dataset.tx) ctx.go('entry', { editId: b.dataset.tx });
    else if (b.dataset.goto) ctx.go(b.dataset.goto);
  };

  // Hálózati adatok a megjelenítés után töltődnek be, hogy a Főoldal azonnal látsszon.
  live = { kind: 'card', el, city };
  if (city?.name === GPS_NAME) {
    resolveCity(city).then(named => {
      if (named.name === GPS_NAME || live?.el !== el) return;
      live = { kind: 'card', el, city: named };
      el.querySelector('#wx-card .eyebrow').textContent = '📍 ' + named.name;
    });
  }
  fillWeather(el, city);
  fillNamedays(el);
}

/* ---------- Élő frissítés (az app.js hívja: 30 mp-enként, előtérbe kerüléskor, Frissítés gombra) ---------- */

let live = null; // a látható időjárás: { kind: 'card' | 'detail', el, city }

export async function refreshLive(force = true) {
  if (!live || !live.city || !live.el.isConnected) return;
  if (live.kind === 'card') await fillWeather(live.el, live.city, force);
  else await fillDetail(live.el, live.city, force);
}

// A Frissítés gombhoz: minden tárolt külső adat (időjárás, mai névnap) eldobása.
export function clearCaches() {
  wxCache = { key: '', at: 0, data: null };
  ndCache.clear();
  ndAlerted = ''; // a Frissítés gomb után újra jelezzük a névnapos ügyfeleket
  try { localStorage.removeItem('kassza-nameday-' + dayKey(new Date())); } catch { /* nem fontos */ }
}

async function fillWeather(el, city, force = false) {
  if (!city) return;
  const $ = id => el.querySelector('#' + id);
  try {
    const data = await forecast(city, force);
    if (live?.el !== el) return; // közben másik nézetre váltottak
    const [icon, text] = wmo(data.current.weather_code);
    const d = data.daily;
    $('wx-icon').textContent = icon;
    $('wx-main').textContent = text;
    $('wx-sub').textContent = `Ma: ${Math.round(d.temperature_2m_min[0])}° / ${Math.round(d.temperature_2m_max[0])}°`
      + (d.precipitation_probability_max?.[0] != null ? ` · csapadék ${d.precipitation_probability_max[0]}%` : '');
    $('wx-temp').innerHTML = `${Math.round(data.current.temperature_2m)}°<small>hőérzet ${Math.round(data.current.apparent_temperature)}°</small>`;
    el.dataset.wxOk = '1';
  } catch {
    // Automatikus frissítésnél egy átmeneti hiba ne írja felül a már látható adatot.
    if (el.dataset.wxOk || live?.el !== el) return;
    $('wx-icon').textContent = '🌥️';
    $('wx-main').textContent = 'Az időjárás most nem érhető el';
    $('wx-sub').textContent = 'Nincs internet, vagy a szolgáltatás nem válaszol.';
  }
}

// Felugró ablak a névnapos ügyfelekkel: app indításkor, napváltáskor és a Frissítés gombra,
// de egy napon belül a sima újrarajzolások (szinkron, fülváltás) nem nyitják meg újra.
let ndAlerted = '';
async function alertNamedays(matches) {
  const today = dayKey(new Date());
  if (ndAlerted === today) return;
  ndAlerted = today;
  // Indításkor megvárjuk, hogy a kezdőkép eltűnjön.
  for (let i = 0; i < 30 && document.getElementById('splash'); i++) await new Promise(r => setTimeout(r, 100));
  // Közben elnavigáltak a Főoldalról: majd a következő megjelenítéskor jelezzük.
  // (Ha csak újrarajzolódott a Főoldal, a névnapkártya újra ott van, ilyenkor mehet.)
  if (!document.getElementById('nd-clients')) { ndAlerted = ''; return; }
  infoDialog({
    title: matches.length > 1 ? 'Ma névnapjuk van' : 'Ma névnapja van',
    text: matches.length > 1
      ? `${matches.length} ügyfeled ünnepel ma:`
      : 'Az egyik ügyfeled ünnepel ma:',
    items: matches,
  });
}

async function fillNamedays(el) {
  const names = el.querySelector('#nd-names');
  const clientsEl = el.querySelector('#nd-clients');
  try {
    const list = await namedays(new Date());
    names.textContent = list.length ? list.join(' · ') : 'Ma nincs névnap a naptárban';
    // Mentett ügyfelek, akiknek ma névnapjuk van (a név bármelyik tagja egyezik).
    const wanted = new Set(list.map(norm));
    const matches = (await db.getClients()).filter(c => c.split(/\s+/).some(part => wanted.has(norm(part))));
    clientsEl.textContent = matches.length
      ? `Ma névnapja van: ${matches.join(', ')}`
      : 'Ma nincs egyező nevű mentett ügyfél';
    if (matches.length) alertNamedays(matches);
  } catch {
    names.textContent = 'A névnap most nem érhető el';
    clientsEl.textContent = 'Nincs internet, vagy a szolgáltatás nem válaszol.';
  }
}

/* ---------- Időjárás részletesen + település választása ---------- */

async function renderWeather(el, ctx) {
  const city = await resolveCity(await db.getMeta('weatherCity'));
  el.innerHTML = `
    <div class="todo-bar">
      <button type="button" class="btn small" id="wx-back">‹ Főoldal</button>
      <span>${city ? esc(city.name) : ''}</span>
    </div>
    <label class="field">
      <span>Település keresése</span>
      <input id="wx-q" type="search" autocomplete="off" enterkeyhint="search" placeholder="pl. Tatabánya">
    </label>
    <ul class="list wx-results" id="wx-res" hidden></ul>
    <button type="button" class="btn small" id="wx-here" style="margin-top:0.75rem">📍 Saját helyzetem</button>
    <p class="error" id="wx-err" role="alert" hidden style="margin-top:0.75rem"></p>
    <div id="wx-detail">${city ? '<p class="hint" style="margin-top:1rem">Betöltés…</p>' : '<div class="empty"><p>Válassz települést az időjárás megjelenítéséhez.</p></div>'}</div>`;

  const $ = id => el.querySelector('#' + id);
  const choose = async c => {
    await db.setMeta('weatherCity', c);
    ctx.go('home', { weather: true });
  };

  let results = [];
  let timer;
  $('wx-q').addEventListener('input', () => {
    clearTimeout(timer);
    const q = $('wx-q').value.trim();
    if (q.length < 2) { $('wx-res').hidden = true; return; }
    timer = setTimeout(async () => {
      try {
        results = await searchCities(q);
        $('wx-res').innerHTML = results.length
          ? results.map((r, i) => `<li><button type="button" data-city="${i}"><b>${esc(r.name)}</b><br><small>${esc(r.admin)}</small></button></li>`).join('')
          : '<li><button type="button" disabled>Nincs ilyen település</button></li>';
        $('wx-res').hidden = false;
      } catch {
        $('wx-err').textContent = 'A keresés most nem sikerült. Ellenőrizd az internetkapcsolatot.';
        $('wx-err').hidden = false;
      }
    }, 350);
  });

  el.onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'wx-back') ctx.go('home');
    else if (b.dataset.city) choose(results[Number(b.dataset.city)]);
    else if (b.id === 'wx-here') {
      $('wx-err').hidden = true;
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(
        async pos => {
          const lat = +pos.coords.latitude.toFixed(3), lon = +pos.coords.longitude.toFixed(3);
          let place = { name: GPS_NAME, admin: '' };
          try { place = await placeName(lat, lon); } catch { /* név nélkül is működik */ }
          choose({ ...place, lat, lon });
        },
        () => { $('wx-err').textContent = 'A helyzet nem érhető el (engedély megtagadva vagy nincs jel).'; $('wx-err').hidden = false; },
        { timeout: 10000, maximumAge: 600000 });
    }
  };

  live = { kind: 'detail', el, city };
  await fillDetail(el, city);
}

async function fillDetail(el, city, force = false) {
  if (!city) return;
  const box = el.querySelector('#wx-detail');
  try {
    const data = await forecast(city, force);
    if (live?.el !== el) return; // közben másik nézetre váltottak
    const [icon, text] = wmo(data.current.weather_code);
    const d = data.daily;
    box.innerHTML = `
      <div class="hero weather" style="margin-top:1rem">
        <span class="hero-icon">${icon}</span>
        <span class="hero-main">
          <span class="eyebrow">📍 ${esc(city.name)}${city.admin ? ` · ${esc(city.admin)}` : ''}</span>
          <b>${text}</b>
          <small>Hőérzet ${Math.round(data.current.apparent_temperature)}° · szél ${Math.round(data.current.wind_speed_10m)} km/h</small>
        </span>
        <span class="hero-side">${Math.round(data.current.temperature_2m)}°</span>
      </div>
      <h2>7 napos előrejelzés</h2>
      <ul class="list wx-days">${d.time.map((day, i) => {
        const date = new Date(day + 'T12:00');
        const [di] = wmo(d.weather_code[i]);
        const wd = date.toLocaleDateString('hu-HU', { weekday: 'long' });
        const name = i === 0 ? 'Ma' : i === 1 ? 'Holnap' : wd.charAt(0).toLocaleUpperCase('hu') + wd.slice(1);
        return `
          <li>
            <span>${name}<br><small class="hint">${shortDay(date)}</small></span>
            <span class="wx-i">${di}</span>
            <span class="wx-p">${d.precipitation_probability_max?.[i] != null ? `💧 ${d.precipitation_probability_max[i]}%` : ''}</span>
            <span class="wx-t">${Math.round(d.temperature_2m_max[i])}° <span>/ ${Math.round(d.temperature_2m_min[i])}°</span></span>
          </li>`;
      }).join('')}</ul>
      <p class="hint" style="margin-top:0.75rem">Forrás: Open-Meteo · frissítve ${hm(Date.now())}</p>`;
    el.dataset.wxOk = '1';
  } catch {
    if (el.dataset.wxOk || live?.el !== el) return;
    box.innerHTML = '<div class="empty"><p>Az időjárás most nem érhető el.</p><span class="hint">Nincs internet, vagy a szolgáltatás nem válaszol.</span></div>';
  }
}
