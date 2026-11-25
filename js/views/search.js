import * as db from '../db.js';
import {
  ft, signed, dayKey, timeStr, parseDay, addDays, startOfMonth, addMonths, dayShort, esc, totals,
} from '../format.js';
import { cards } from './summary.js';

const PAGE = 200;

// Kis- és nagybetű, valamint ékezetek nélküli összehasonlítás („kovacs” = „Kovács”).
const norm = s => String(s ?? '').toLocaleLowerCase('hu').normalize('NFD').replace(/[̀-ͯ]/g, '');

function presets() {
  const now = new Date();
  const monday = addDays(now, -((now.getDay() + 6) % 7));
  return [
    ['today', 'Ma', dayKey(now), dayKey(now)],
    // A hét / hónap / év végéig, hogy a későbbi napokra szóló emlékeztetők is benne legyenek.
    ['week', 'Ez a hét', dayKey(monday), dayKey(addDays(monday, 6))],
    ['month', 'Ez a hónap', dayKey(startOfMonth(now)), dayKey(addDays(addMonths(startOfMonth(now), 1), -1))],
    ['prev', 'Előző hónap', dayKey(addMonths(startOfMonth(now), -1)), dayKey(addDays(startOfMonth(now), -1))],
    ['year', 'Idén', dayKey(new Date(now.getFullYear(), 0, 1)), dayKey(new Date(now.getFullYear(), 11, 31))],
    ['all', 'Minden', '', ''],
  ];
}

export async function renderSearch(el, ctx) {
  // A szűrők megmaradnak, ha szerkesztés után visszatérünk ide.
  const f = (ctx.state.search ??= { preset: 'month', from: presets()[2][2], to: presets()[2][3], type: 'all', q: '' });

  el.innerHTML = `
    <div class="stack">
      <label class="field">
        <span>Keresés</span>
        <input id="q" type="search" autocomplete="off" enterkeyhint="search" value="${esc(f.q)}"
               placeholder="Ügyfél, megjegyzés, emlékeztető, típus vagy összeg">
      </label>

      <div class="seg four" role="group" aria-label="Tétel típusa">
        <button type="button" data-ftype="all">Mind</button>
        <button type="button" data-ftype="income">Bevétel</button>
        <button type="button" data-ftype="expense">Kiadás</button>
        <button type="button" data-ftype="reminder">Emlékeztető</button>
      </div>

      <div class="field">
        <span id="period-label">Időszak</span>
        <div class="chips" role="group" aria-labelledby="period-label">
          ${presets().map(([id, label]) => `<button type="button" class="chip" data-preset="${id}">${label}</button>`).join('')}
        </div>
      </div>

      <div class="row2">
        <label class="field"><span>Ettől</span><input id="from" type="date" value="${f.from}"></label>
        <label class="field"><span>Eddig</span><input id="to" type="date" value="${f.to}"></label>
      </div>
    </div>
    <div id="results" aria-live="polite"></div>`;

  const $ = id => el.querySelector('#' + id);
  const results = $('results');
  let rows = [];
  let cmap = new Map();
  let shown = PAGE;
  let loadToken = 0;

  function paintControls() {
    for (const b of el.querySelectorAll('[data-ftype]')) b.setAttribute('aria-pressed', b.dataset.ftype === f.type);
    for (const b of el.querySelectorAll('[data-preset]')) b.setAttribute('aria-pressed', b.dataset.preset === f.preset);
  }

  async function load() {
    const token = ++loadToken;
    const from = f.from ? parseDay(f.from).getTime() : 0;
    const to = f.to ? addDays(parseDay(f.to), 1).getTime() : 8.64e15;
    if (from >= to) {
      rows = [];
      paintResults('A kezdő dátum későbbi, mint a záró dátum.');
      return;
    }
    const [txs, cats, appts] = await Promise.all([db.txInRange(from, to), db.getCategories(), db.getAppts()]);
    if (token !== loadToken) return;
    // Az emlékeztetők (a naptárból) is találatok: tételként kezeljük őket, összeg nélkül.
    const rems = appts.filter(a => a.kind === 'reminder').map(a => ({
      id: a.id, type: 'reminder', note: a.note ?? '', timestamp: new Date(`${a.date}T${a.time}`).getTime(),
    })).filter(r => r.timestamp >= from && r.timestamp < to);
    rows = [...txs, ...rems].sort((a, b) => b.timestamp - a.timestamp); // legújabb elöl
    cmap = new Map(cats.map(c => [c.id, c]));
    shown = PAGE;
    paintResults();
  }

  function matches(t) {
    if (f.type !== 'all' && t.type !== f.type) return false;
    const q = norm(f.q.trim());
    if (!q) return true;
    const digits = q.replace(/\s/g, '');
    if (t.type !== 'reminder' && /^\d+$/.test(digits) && String(t.amount).includes(digits)) return true;
    const hay = norm((t.type === 'reminder' ? ['Emlékeztető', t.note]
      : [t.clientName, t.note, cmap.get(t.categoryId)?.name]).filter(Boolean).join(' '));
    return q.split(/\s+/).every(word => hay.includes(word));
  }

  function paintResults(problem) {
    if (problem) {
      results.innerHTML = `<div class="empty"><p>${problem}</p></div>`;
      return;
    }
    const hits = rows.filter(matches);
    if (!hits.length) {
      results.innerHTML = `<div class="empty"><p>${rows.length
        ? 'Nincs a keresésnek megfelelő tétel ebben az időszakban.'
        : 'Ebben az időszakban nincs rögzített tétel.'}</p></div>`;
      return;
    }
    const money = list => list.filter(t => t.type !== 'reminder'); // az összegekbe nem számít
    const remCount = hits.length - money(hits).length;

    const visible = hits.slice(0, shown);
    const groups = new Map();
    for (const t of visible) {
      const k = dayKey(new Date(t.timestamp));
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(t);
    }

    results.innerHTML = `
      <h2>Találatok (${[money(hits).length ? `${money(hits).length} tétel` : '', remCount ? `${remCount} emlékeztető` : ''].filter(Boolean).join(', ')})</h2>
      ${money(hits).length ? cards(totals(money(hits))) : ''}
      ${[...groups].map(([k, list]) => {
        const s = totals(money(list));
        return `
          <div class="day-head">
            <button type="button" data-day="${k}">${dayShort(parseDay(k))}</button>
            <span>${s.inc ? `<span class="pos">+${ft(s.inc)}</span>` : ''}${s.inc && s.exp ? ' ' : ''}${s.exp ? `<span class="neg">−${ft(s.exp)}</span>` : ''}</span>
          </div>
          <ul class="list">${list.map(t => {
            if (t.type === 'reminder') {
              return `
              <li><button type="button" class="tx" data-rem="${t.id}">
                <span class="tx-time">${timeStr(new Date(t.timestamp))}</span>
                <span class="tx-main"><b class="rem-label">🔔 Emlékeztető</b><small class="rem-text">${esc(t.note)}</small></span>
                <span class="tx-amt"></span>
              </button></li>`;
            }
            const sub = [t.clientName, t.note].filter(Boolean).join(' · ');
            return `
              <li><button type="button" class="tx" data-id="${t.id}">
                <span class="tx-time">${timeStr(new Date(t.timestamp))}</span>
                <span class="tx-main"><b>${esc(cmap.get(t.categoryId)?.name ?? 'Törölt típus')}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>
                <span class="tx-amt ${t.type === 'income' ? 'pos' : 'neg'}">${signed(t.amount, t.type)}</span>
              </button></li>`;
          }).join('')}</ul>`;
      }).join('')}
      ${hits.length > shown
        ? `<button type="button" class="btn block" id="more" style="margin-top:16px">További ${Math.min(PAGE, hits.length - shown)} tétel megjelenítése</button>`
        : ''}`;
  }

  $('q').addEventListener('input', e => { f.q = e.target.value; shown = PAGE; paintResults(); });
  $('q').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });

  for (const id of ['from', 'to']) {
    $(id).addEventListener('change', e => {
      f[id] = e.target.value;
      f.preset = null;
      paintControls();
      load();
    });
  }

  el.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.ftype) {
      f.type = b.dataset.ftype;
      shown = PAGE;
      paintControls();
      paintResults();
    } else if (b.dataset.preset) {
      const p = presets().find(x => x[0] === b.dataset.preset);
      [f.preset, , f.from, f.to] = p;
      $('from').value = f.from;
      $('to').value = f.to;
      paintControls();
      load();
    } else if (b.id === 'more') {
      shown += PAGE;
      paintResults();
    } else if (b.dataset.rem) {
      ctx.go('calendar', { apptId: b.dataset.rem, returnTo: 'search' });
    } else if (b.dataset.id) {
      ctx.go('entry', { editId: b.dataset.id, returnTo: 'search' });
    } else if (b.dataset.day) {
      ctx.go('day', { day: parseDay(b.dataset.day) });
    }
  });

  paintControls();
  await load();
}
