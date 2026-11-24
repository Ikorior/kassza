// Naptár (határidőnapló): nap / hét / hónap nézet, találkozók felvétele, módosítása,
// törlése, keresés. A találkozók a felhőben közösek.

import * as db from '../db.js';
import {
  ft, pad, dayKey, parseDay, addDays, startOfMonth, addMonths, monthLabel, weekday, esc, groupDigits,
} from '../format.js';
import { toast, confirmDialog } from '../ui.js';

// Megbízhatóság, fontossági sorrendben (a nap színét a legfontosabb adja).
export const STATUS = {
  sure: { label: 'Biztos találkozó', short: 'Biztos' },
  maybe: { label: 'Bizonytalan / tervezet', short: 'Bizonytalan' },
  bad: { label: 'Elmaradó / kamu bejelentkezés', short: 'Elmaradó' },
};
const ORDER = Object.keys(STATUS);
const dayStatus = list => ORDER.find(s => list.some(a => a.status === s)) ?? 'none';
// Emlékeztető: a találkozók mellett tárolt bejegyzés, csak dátum + időpont + megjegyzés.
export const isRem = a => a.kind === 'reminder';
const remTitle = a => String(a.note ?? '').split('\n')[0];

// Ügyfélidő: csak egész órák.
const DURATIONS = Array.from({ length: 12 }, (_, i) => (i + 1) * 60); // 1–12 óra
// Érkezési idősáv: alapból a kezdés + 1 óra (korábbi, ilyen mező nélküli találkozóknál is).
const WINDOW = 60;
const durLabel = m => (m < 60 ? `${m} perc` : `${Math.floor(m / 60)} óra${m % 60 ? ` ${m % 60} perc` : ''}`);
const endTime = (time, dur) => {
  const [h, m] = time.split(':').map(Number);
  const t = h * 60 + m + (dur || 0);
  return `${pad(Math.floor(t / 60) % 24)}:${pad(t % 60)}`;
};

const arriveTo = a => a.arriveTo || endTime(a.time, WINDOW);

// SMS-megerősítő időpontok („2026-11-17T18:00”) rövid formában, időrendben.
const confirmList = a => [a.confirm1, a.confirm2].filter(Boolean).sort().map(v => {
  const d = new Date(v);
  return `${d.toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' })} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
});

const startOfWeek = d => addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -((d.getDay() + 6) % 7));
const short = d => d.toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' });
const longDay = d => d.toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' });
const cap = s => s.charAt(0).toLocaleUpperCase('hu') + s.slice(1);
const norm = s => String(s ?? '').toLocaleLowerCase('hu').normalize('NFD').replace(/[̀-ͯ]/g, '');
const sortAppts = list => list.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

const byDay = list => {
  const map = new Map();
  for (const a of list) {
    if (!map.has(a.date)) map.set(a.date, []);
    map.get(a.date).push(a);
  }
  return map;
};

const LEGEND = `
  <p class="cal-legend">
    ${ORDER.map(s => `<span><i class="dot s-${s}"></i>${STATUS[s].short}</span>`).join('')}
    <span><i class="dot s-rem"></i>Emlékeztető</span>
  </p>`;

const ICON_SEARCH = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>';

// Egy találkozó kártyája (napi nézet és keresési találatok).
// Díjak: Összes díj = ügyfélidő (óra) × óradíj + kiszállási díj + fehér + extra.
export const FEES = [['travel', 'Kiszállási díj'], ['white', 'Fehér'], ['extra', 'Extra']];
const totalFee = (minutes, rate, travel, white, extra) =>
  Math.round((minutes / 60) * (rate || 0)) + (travel || 0) + (white || 0) + (extra || 0);

// Rövid bontás a kártyára, pl. „2 óra × 10 000 Ft + kiszállás 3 000 Ft”.
function feeBreakdown(a) {
  const parts = [];
  if (a.rate) parts.push(`${durLabel(a.duration)} × ${ft(a.rate)}`);
  if (a.travel) parts.push(`kiszállás ${ft(a.travel)}`);
  if (a.white) parts.push(`fehér ${ft(a.white)}`);
  if (a.extra) parts.push(`extra ${ft(a.extra)}`);
  return parts.length > 1 || a.rate ? parts.join(' + ') : '';
}

function card(a) {
  if (isRem(a)) {
    return `
    <li><button type="button" class="appt s-rem" data-appt="${a.id}">
      <span class="appt-time">${a.time}</span>
      <span class="appt-main">
        <small class="appt-status">🔔 Emlékeztető</small>
        <span class="rem-note">${esc(a.note)}</span>
      </span>
      <span class="appt-amt"></span>
    </button></li>`;
  }
  const sub = [a.address, a.note, feeBreakdown(a)].filter(Boolean);
  return `
    <li><button type="button" class="appt s-${a.status}" data-appt="${a.id}">
      <span class="appt-time">${a.time}<small>–${arriveTo(a)}</small></span>
      <span class="appt-main">
        <b>${esc(a.name)}</b>
        <small class="appt-status">${STATUS[a.status].label} · ${durLabel(a.duration)}</small>
        ${confirmList(a).length ? `<small class="appt-confirm">SMS-megerősítés eddig: ${confirmList(a).join(', ')}</small>` : ''}
        ${sub.map(s => `<small>${esc(s)}</small>`).join('')}
      </span>
      <span class="appt-amt">${a.amount ? ft(a.amount) : ''}</span>
    </button></li>`;
}

// „2 találkozó · 1 emlékeztető” (üres, ha egyik sincs).
function countLabel(list) {
  const rem = list.filter(isRem).length, appt = list.length - rem;
  return [appt ? `${appt} találkozó` : '', rem ? `${rem} emlékeztető` : ''].filter(Boolean).join(' · ');
}

function summary(list) {
  if (!list.length) return 'Nincs találkozó';
  const sure = list.filter(a => a.status === 'sure').reduce((s, a) => s + (a.amount || 0), 0);
  return `${countLabel(list)}${sure ? ` · biztos: ${ft(sure)}` : ''}`;
}

export async function renderCalendar(el, ctx) {
  const cal = (ctx.state.cal ??= {
    mode: 'month', // a Naptár fülre lépve mindig a havi nézet jön (lásd app.js)
    date: new Date(),
    searching: false,
    q: '', from: '', to: '', status: 'all',
  });
  if (ctx.state.remNew) return renderReminderForm(el, ctx, cal, null);
  if (ctx.state.apptId || ctx.state.apptNew) return renderForm(el, ctx, cal);

  const all = sortAppts(await db.getAppts());
  const today = dayKey(new Date());

  el.innerHTML = `
    <div class="cal-bar">
      <div class="seg three" role="group" aria-label="Nézet">
        <button type="button" data-mode="day">Nap</button>
        <button type="button" data-mode="week">Hét</button>
        <button type="button" data-mode="month">Hónap</button>
      </div>
      <button type="button" class="icon-btn cal-search" id="cal-search" aria-label="Keresés és szűrés"
              aria-pressed="${cal.searching}">${ICON_SEARCH}</button>
      <button type="button" class="cal-add rem" id="cal-rem" aria-label="Új emlékeztető" title="Új emlékeztető">🔔</button>
      <button type="button" class="cal-add" id="cal-add" aria-label="Új találkozó" title="Új találkozó">+</button>
    </div>
    <div id="cal-body"></div>`;

  for (const b of el.querySelectorAll('[data-mode]')) {
    b.setAttribute('aria-pressed', !cal.searching && b.dataset.mode === cal.mode);
  }
  const body = el.querySelector('#cal-body');

  // Az új találkozó alapértelmezett napja: a megnézett nap, illetve ha a mai nap
  // benne van a látott időszakban, akkor a mai nap, különben az időszak első napja.
  let range;
  if (cal.searching) {
    renderSearch(body, cal, all);
  } else if (cal.mode === 'day') {
    range = renderDay(body, cal, all, today);
  } else if (cal.mode === 'week') {
    range = renderWeek(body, cal, all, today);
  } else {
    range = renderMonth(body, cal, all, today);
  }

  const defaultDay = () => {
    if (!range) return today;
    if (cal.mode === 'day') return range.from;
    return today >= range.from && today <= range.to ? today : range.from;
  };

  el.onclick = async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.mode) {
      cal.mode = b.dataset.mode;
      cal.searching = false;
      ctx.go('calendar');
    } else if (b.id === 'cal-search') {
      cal.searching = !cal.searching;
      ctx.go('calendar');
    } else if (b.id === 'cal-rem') {
      ctx.go('calendar', { remNew: true, apptDate: defaultDay() });
    } else if (b.dataset.remday) {
      ctx.go('calendar', { remNew: true, apptDate: b.dataset.remday });
    } else if (b.id === 'cal-add') {
      ctx.go('calendar', { apptNew: true, apptDate: defaultDay() });
    } else if (b.dataset.addday) {
      ctx.go('calendar', { apptNew: true, apptDate: b.dataset.addday });
    } else if (b.dataset.appt) {
      ctx.go('calendar', { apptId: b.dataset.appt });
    } else if (b.dataset.goday) {
      cal.mode = 'day';
      cal.date = parseDay(b.dataset.goday);
      ctx.go('calendar');
    } else if (b.dataset.step) {
      const n = Number(b.dataset.step);
      cal.date = cal.mode === 'day' ? addDays(cal.date, n) : cal.mode === 'week' ? addDays(cal.date, 7 * n) : addMonths(cal.date, n);
      ctx.go('calendar');
    } else if (b.id === 'cal-today') {
      cal.date = new Date();
      ctx.go('calendar');
    } else if (b.dataset.fstatus) {
      cal.status = b.dataset.fstatus;
      ctx.go('calendar', { keepScroll: true });
    } else if (b.id === 'cal-clear') {
      Object.assign(cal, { q: '', from: '', to: '', status: 'all' });
      ctx.go('calendar');
    }
  };
}

function pager(label, sub, hasToday) {
  return `
    <div class="pager">
      <button type="button" data-step="-1" aria-label="Előző">‹</button>
      <div class="pager-mid"><strong>${label}</strong><small>${sub}</small></div>
      <button type="button" data-step="1" aria-label="Következő">›</button>
    </div>
    ${hasToday ? '' : '<div class="pager-extra"><button type="button" class="btn small" id="cal-today">Ugrás a mai napra</button></div>'}`;
}

/* ---------- Napi nézet ---------- */

function renderDay(body, cal, all, today) {
  const key = dayKey(cal.date);
  const list = all.filter(a => a.date === key);
  body.innerHTML = `
    ${pager(longDay(cal.date), `${cap(weekday(cal.date))} · ${summary(list)}`, key === today)}
    ${list.length
      ? `<ul class="appt-list">${list.map(card).join('')}</ul>`
      : `<div class="empty"><p>Erre a napra nincs találkozó.</p>
           <button type="button" class="btn primary" data-addday="${key}">+ Találkozó erre a napra</button>
           <button type="button" class="btn" data-remday="${key}">🔔 Emlékeztető erre a napra</button></div>`}
    ${LEGEND}`;
  return { from: key, to: key };
}

/* ---------- Heti nézet ---------- */

function renderWeek(body, cal, all, today) {
  const start = startOfWeek(cal.date);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const from = dayKey(days[0]), to = dayKey(days[6]);
  const inWeek = all.filter(a => a.date >= from && a.date <= to);
  const map = byDay(inWeek);

  body.innerHTML = `
    ${pager(`${short(days[0])} – ${short(days[6])}`, `${days[0].getFullYear()} · ${summary(inWeek)}`, today >= from && today <= to)}
    ${days.map(d => {
      const k = dayKey(d);
      const list = map.get(k) ?? [];
      return `
        <section class="wk-day st-${dayStatus(list)}${k === today ? ' today' : ''}">
          <button type="button" class="wk-head" data-goday="${k}">
            <b>${cap(weekday(d))}</b><span>${short(d)}</span>
            <small>${countLabel(list)}</small>
          </button>
          ${list.length ? `<ul class="wk-list">${list.map(a => isRem(a) ? `
            <li><button type="button" class="appt-mini s-rem" data-appt="${a.id}">
              <span class="t">${a.time}</span><span class="n">🔔 ${esc(remTitle(a))}</span>
            </button></li>` : `
            <li><button type="button" class="appt-mini s-${a.status}" data-appt="${a.id}">
              <span class="t">${a.time}–${arriveTo(a)}</span><span class="n">${esc(a.name)}</span>
              ${confirmList(a).length ? '<span class="sms" title="SMS-megerősítés kérve">SMS</span>' : ''}
              ${a.amount ? `<span class="a">${ft(a.amount)}</span>` : ''}
            </button></li>`).join('')}</ul>` : ''}
        </section>`;
    }).join('')}
    ${LEGEND}`;
  return { from, to };
}

/* ---------- Havi nézet ---------- */

function renderMonth(body, cal, all, today) {
  const first = startOfMonth(cal.date);
  const last = addDays(addMonths(first, 1), -1);
  const gridStart = startOfWeek(first);
  const gridEnd = addDays(startOfWeek(last), 6);
  const from = dayKey(first), to = dayKey(last);
  const map = byDay(all.filter(a => a.date >= dayKey(gridStart) && a.date <= dayKey(gridEnd)));
  const inMonth = all.filter(a => a.date >= from && a.date <= to);

  const cells = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) {
    const k = dayKey(d);
    const list = map.get(k) ?? [];
    const dots = list.slice(0, 3).map(a => `<i class="dot s-${isRem(a) ? 'rem' : a.status}"></i>`).join('')
      + (list.length > 3 ? `<small>+${list.length - 3}</small>` : '');
    const label = `${longDay(d)}${list.length ? `, ${countLabel(list)}` : ''}`;
    // A kék keret a munkás (találkozós) napoké; a csak emlékeztetős napot a pont jelzi.
    const work = list.some(a => !isRem(a));
    cells.push(`
      <button type="button" class="mon-cell ${d.getDay() % 6 === 0 ? 'we' : 'wd'}${work ? ' has-appt' : ''}${d.getMonth() !== first.getMonth() ? ' out' : ''}${k === today ? ' today' : ''}"
              data-goday="${k}" aria-label="${label}">
        <span class="num">${d.getDate()}</span><span class="dots">${dots}</span>
      </button>`);
  }

  body.innerHTML = `
    ${pager(cap(monthLabel(first)), summary(inMonth), today >= from && today <= to)}
    <div class="mon-grid">
      ${['H', 'K', 'Sze', 'Cs', 'P', 'Szo', 'V'].map(w => `<div class="mon-wd" aria-hidden="true">${w}</div>`).join('')}
      ${cells.join('')}
    </div>
    ${LEGEND}`;
  return { from, to };
}

/* ---------- Keresés és szűrés ---------- */

function renderSearch(body, cal, all) {
  body.innerHTML = `
    <div class="stack">
      <label class="field">
        <span>Név</span>
        <input id="cq" type="search" autocomplete="off" enterkeyhint="search" value="${esc(cal.q)}"
               placeholder="Név, cím vagy megjegyzés">
      </label>
      <div class="row2">
        <label class="field"><span>Ettől</span><input id="cfrom" type="date" value="${cal.from}"></label>
        <label class="field"><span>Eddig</span><input id="cto" type="date" value="${cal.to}"></label>
      </div>
      <div class="field">
        <span id="cst-label">Megbízhatóság</span>
        <div class="chips" role="group" aria-labelledby="cst-label">
          <button type="button" class="chip" data-fstatus="all" aria-pressed="${cal.status === 'all'}">Mind</button>
          ${ORDER.map(s => `<button type="button" class="chip st-chip s-${s}" data-fstatus="${s}" aria-pressed="${cal.status === s}">${STATUS[s].short}</button>`).join('')}
        </div>
      </div>
      <button type="button" class="btn small ghost" id="cal-clear" hidden>Szűrők törlése</button>
    </div>
    <div id="cres" aria-live="polite"></div>`;

  const res = body.querySelector('#cres');
  const paint = () => {
    body.querySelector('#cal-clear').hidden = !(cal.q || cal.from || cal.to || cal.status !== 'all');
    const q = norm(cal.q.trim());
    const hits = all.filter(a =>
      (cal.status === 'all' || a.status === cal.status)
      && (!cal.from || a.date >= cal.from)
      && (!cal.to || a.date <= cal.to)
      && (!q || q.split(/\s+/).every(w => norm([a.name, a.address, a.note].join(' ')).includes(w))));
    if (!hits.length) {
      res.innerHTML = `<div class="empty"><p>${all.length ? 'Nincs a szűrésnek megfelelő találkozó.' : 'Még nincs rögzített találkozó.'}</p></div>`;
      return;
    }
    const groups = byDay(hits);
    res.innerHTML = `
      <h2>Találatok · ${summary(hits)}</h2>
      ${[...groups].map(([k, list]) => `
        <div class="day-head"><button type="button" data-goday="${k}">${longDay(parseDay(k))}, ${weekday(parseDay(k))}</button></div>
        <ul class="appt-list">${list.map(card).join('')}</ul>`).join('')}`;
  };
  paint();

  body.querySelector('#cq').addEventListener('input', e => { cal.q = e.target.value; paint(); });
  body.querySelector('#cq').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
  for (const [id, key] of [['cfrom', 'from'], ['cto', 'to']]) {
    body.querySelector('#' + id).addEventListener('change', e => { cal[key] = e.target.value; paint(); });
  }
}

/* ---------- Találkozó felvétele / módosítása ---------- */

// A találkozó vége: a legkésőbbi érkezés + ügyfélidő (ms). Éjfélen átnyúló idősávot is kezel.
function apptEnd(a) {
  const d = parseDay(a.date);
  const to = arriveTo(a);
  const [h, m] = to.split(':').map(Number);
  let end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
  if (to < a.time) end += 24 * 3600 * 1000;
  return end + (a.duration || 0) * 60 * 1000;
}

// A bevétel megjegyzése: a díjtételek külön-külön, kötőjellel elválasztva.
const incomeNote = a =>
  `Óradíj: ${ft(a.rate || 0)} - Ügyfélidő: ${durLabel(a.duration)} - Kiszállási díj: ${ft(a.travel || 0)}`
  + ` - Fehér: ${ft(a.white || 0)} - Extra: ${ft(a.extra || 0)}`;

async function renderForm(el, ctx, cal) {
  const editing = ctx.state.apptId ? await db.getAppt(ctx.state.apptId) : null;
  if (ctx.state.apptId && !editing) {
    // Közben a másik telefonon törölték.
    toast('Ez a bejegyzés már nem létezik');
    return ctx.go('calendar');
  }
  if (editing && isRem(editing)) return renderReminderForm(el, ctx, cal, editing);

  // Bevétel mentése: csak már mentett és lejárt találkozónál; ha már van hozzá bevétel, azt mutatjuk.
  // A gomb és a tájékoztatás is benne van; hogy melyik látszik, az űrlap aktuális adataiból
  // dől el (lásd updateIncome), így a dátum jövőbe írása után a gomb azonnal eltűnik.
  // A bevételt közben törölhették (pl. a bevételi listából): ilyenkor nincs kapcsolt bevétel,
  // és a lekérés hibája sem akadályozhatja meg a szerkesztő megnyitását.
  let linkedTx = null;
  if (editing?.incomeTxId) {
    try {
      linkedTx = (await db.getTx(editing.incomeTxId, new Date(`${editing.date}T${editing.time}`).getTime())) ?? null;
    } catch (err) {
      console.warn('A kapcsolt bevétel nem kérhető le:', err);
    }
  }
  const endLabel = ms => `${short(new Date(ms))} ${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`;
  let incomeBlock = '';
  if (editing && linkedTx) {
    incomeBlock = `
      <button type="button" class="btn income-btn done" id="a-income-open">✓ Bevétel mentve (${ft(linkedTx.amount)}) – megnyitás</button>`;
  } else if (editing) {
    incomeBlock = `
      <button type="button" class="btn income-btn" id="a-income" hidden>Bevétel mentése</button>
      <p class="hint" id="a-income-hint" hidden></p>`;
  }

  const now = new Date();
  const date = editing?.date ?? ctx.state.apptDate ?? dayKey(now);
  const defaultTime = date === dayKey(now) ? `${pad(Math.min(now.getHours() + 1, 23))}:00` : '09:00';
  const a = editing ?? {
    name: '', date, time: defaultTime, arriveTo: endTime(defaultTime, WINDOW), duration: 60,
    address: '', note: '', amount: 0, status: 'sure', confirm1: '', confirm2: '',
    rate: 0, travel: 0, white: 0, extra: 0,
  };
  // Régi, díjbontás nélkül rögzített találkozó: az összeg marad, amíg nem adnak meg díjat.
  const legacyAmount = editing && editing.rate == null ? editing.amount || 0 : 0;
  const money = v => (v ? groupDigits(v) : '');
  const durations = DURATIONS.includes(a.duration) ? DURATIONS : [...DURATIONS, a.duration].sort((x, y) => x - y);

  document.getElementById('title').textContent = editing ? 'Találkozó módosítása' : 'Új találkozó';

  el.innerHTML = `
    <form class="stack" id="appt-form" novalidate>
      <div class="form-bar">
        <button type="button" class="btn small" data-cancel>Mégse</button>
        <button class="btn small primary">Mentés</button>
      </div>
      <label class="field">
        <span>Név</span>
        <input id="a-name" type="text" maxlength="80" autocomplete="off" value="${esc(a.name)}">
      </label>
      <label class="field"><span>Dátum</span><input id="a-date" type="date" value="${a.date}"></label>
      <div class="field">
        <span id="arr-label">Érkezés</span>
        <div class="time-range" role="group" aria-labelledby="arr-label" aria-describedby="arr-hint">
          <input id="a-time" type="time" value="${a.time}" aria-label="Érkezés legkorábban">
          <span aria-hidden="true">–</span>
          <input id="a-to" type="time" value="${arriveTo(a)}" aria-label="Érkezés legkésőbb">
        </div>
        <small class="hint" id="arr-hint">Elég a kezdést megadni: a vége magától 1 órával későbbre áll, de átírható.</small>
      </div>
      <label class="field">
        <span>Ügyfélidő</span>
        <select id="a-dur">${durations.map(m => `<option value="${m}" ${m === a.duration ? 'selected' : ''}>${durLabel(m)}</option>`).join('')}</select>
      </label>
      <div class="fee-row">
        ${FEES.map(([key, label]) => `
          <label class="field">
            <span>${label}</span>
            <div class="amount-wrap compact">
              <input id="a-${key}" class="fee" inputmode="numeric" autocomplete="off" placeholder="0" value="${money(a[key])}">
              <span aria-hidden="true">Ft</span>
            </div>
          </label>`).join('')}
      </div>
      <label class="field">
        <span>Cím</span>
        <input id="a-addr" type="text" maxlength="160" autocomplete="off" value="${esc(a.address)}">
      </label>
      <label class="field">
        <span>Megjegyzés</span>
        <textarea id="a-note" rows="3" maxlength="1000">${esc(a.note)}</textarea>
      </label>
      <label class="field">
        <span>Óradíj</span>
        <div class="amount-wrap compact">
          <input id="a-rate" class="fee" inputmode="numeric" autocomplete="off" placeholder="0" value="${money(a.rate)}">
          <span aria-hidden="true">Ft / óra</span>
        </div>
      </label>
      <div class="field">
        <span id="total-label">Összes díj</span>
        <div class="amount-wrap compact total" aria-labelledby="total-label">
          <output id="a-amount" aria-live="polite"></output>
          <span aria-hidden="true">Ft</span>
        </div>
        <small class="hint" id="a-formula"></small>
      </div>
      <label class="field">
        <span>Megbízhatóság</span>
        <select id="a-status" class="status-select">
          ${ORDER.map(s => `<option value="${s}" class="s-${s}" ${s === a.status ? 'selected' : ''}>${STATUS[s].label}</option>`).join('')}
        </select>
      </label>
      <div class="field">
        <span id="conf-label">SMS-megerősítés</span>
        <small class="hint">Új vagy megbízhatatlan ügyfélnél: eddig az időpontig kell SMS-ben jeleznie, hogy a találkozó még áll. Nem kötelező.</small>
        ${[1, 2].map(n => `
          <div class="confirm-row">
            <input id="a-c${n}" type="datetime-local" value="${a[`confirm${n}`] ?? ''}" aria-label="${n}. megerősítő időpont">
            <button type="button" class="btn small ghost" data-clear="a-c${n}" aria-label="${n}. megerősítő időpont törlése">Törlés</button>
          </div>`).join('')}
      </div>

      <p class="error" id="a-err" role="alert" hidden></p>
      ${incomeBlock}
      <button class="btn primary" id="a-save">${editing ? 'Módosítás mentése' : 'Találkozó mentése'}</button>
      ${editing ? '<button type="button" class="btn danger-ghost" id="a-del">Találkozó törlése</button>' : ''}
      <button type="button" class="btn ghost" id="a-cancel" data-cancel>Mégse</button>
    </form>`;

  const $ = id => el.querySelector('#' + id);
  const form = $('appt-form');
  const statusSel = $('a-status');
  const paintStatus = () => { statusSel.className = `status-select s-${statusSel.value}`; };
  paintStatus();
  statusSel.addEventListener('change', paintStatus);

  // Díjmezők: ezres tagolás, és az Összes díj azonnali újraszámolása.
  const num = id => parseInt($(id).value.replace(/\D/g, ''), 10) || 0;
  const fees = () => ({ rate: num('a-rate'), travel: num('a-travel'), white: num('a-white'), extra: num('a-extra') });
  const computeTotal = () => {
    const f = fees();
    const minutes = Number($('a-dur').value);
    const anyFee = f.rate || f.travel || f.white || f.extra;
    const total = !anyFee && legacyAmount ? legacyAmount : totalFee(minutes, f.rate, f.travel, f.white, f.extra);
    $('a-amount').textContent = groupDigits(total) || '0';
    $('a-formula').textContent = anyFee
      ? `${durLabel(minutes)} × ${ft(f.rate)} + ${ft(f.travel)} + ${ft(f.white)} + ${ft(f.extra)}`
      : legacyAmount ? 'Korábban rögzített összeg. Ha díjat adsz meg, újraszámolódik.' : 'Ügyfélidő × óradíj + kiszállási díj + fehér + extra';
    return total;
  };
  for (const input of el.querySelectorAll('input.fee')) {
    input.addEventListener('input', () => { input.value = groupDigits(input.value); computeTotal(); });
  }
  $('a-dur').addEventListener('change', computeTotal);
  computeTotal();

  // Érkezés vége: a kezdést követi (+1 óra), amíg kézzel át nem írják.
  let toManual = !!editing?.arriveTo && editing.arriveTo !== endTime(editing.time, WINDOW);
  $('a-time').addEventListener('input', () => {
    if (!toManual && $('a-time').value) $('a-to').value = endTime($('a-time').value, WINDOW);
  });
  $('a-to').addEventListener('input', () => { toManual = !!$('a-to').value; });
  // Volt-e módosítás (a Mégse ilyenkor rákérdez).
  let dirty = false;

  // A találkozó vége a jelenleg beírt adatok szerint (null, ha még hiányos).
  const formEnd = () => {
    const date = $('a-date').value, time = $('a-time').value.slice(0, 5);
    if (!date || !time) return null;
    return apptEnd({ date, time, arriveTo: ($('a-to').value || endTime(time, WINDOW)).slice(0, 5), duration: Number($('a-dur').value) });
  };
  // Bevétel mentése gomb: csak ha a beírt adatok szerint a találkozó már véget ért.
  const updateIncome = () => {
    if (!$('a-income')) return;
    const end = formEnd();
    const ok = end != null && end <= Date.now();
    $('a-income').hidden = !ok;
    $('a-income-hint').hidden = ok;
    $('a-income-hint').textContent = end == null
      ? 'A bevétel mentéséhez add meg a dátumot és az érkezést.'
      : `A bevétel a találkozó vége után menthető (${endLabel(end)}).`;
  };
  updateIncome();
  for (const id of ['a-date', 'a-time', 'a-to', 'a-dur']) {
    $(id).addEventListener('input', updateIncome);
    $(id).addEventListener('change', updateIncome);
  }
  form.addEventListener('input', () => { $('a-err').hidden = true; dirty = true; });
  form.addEventListener('change', () => { dirty = true; });
  const showErr = (msg, field) => {
    $('a-err').textContent = msg;
    $('a-err').hidden = false;
    field?.focus();
  };
  if (!editing) setTimeout(() => $('a-name').focus(), 0);

  const back = day => {
    if (day) cal.date = parseDay(day);
    cal.searching = cal.searching && !!editing; // keresésből szerkesztve oda térünk vissza
    ctx.go('calendar');
  };

  // Az űrlap ellenőrzése és a találkozó összeállítása; hiba esetén null (és hibaüzenet).
  function collect() {
    const fail = (msg, field) => { showErr(msg, field); return null; };
    const name = $('a-name').value.trim();
    if (!name) return fail('Add meg a nevet.', $('a-name'));
    if (!$('a-date').value) return fail('Add meg a dátumot.', $('a-date'));
    if (!$('a-time').value) return fail('Add meg az érkezés kezdetét.', $('a-time'));
    const time = $('a-time').value.slice(0, 5);
    const to = ($('a-to').value || endTime(time, WINDOW)).slice(0, 5);
    if (to <= time && to !== endTime(time, WINDOW)) {
      return fail('Az érkezési idősáv vége legyen későbbi, mint a kezdete.', $('a-to'));
    }
    const start = `${$('a-date').value}T${time}`;
    const confirm1 = $('a-c1').value.slice(0, 16);
    const confirm2 = $('a-c2').value.slice(0, 16);
    for (const [c, id] of [[confirm1, 'a-c1'], [confirm2, 'a-c2']]) {
      if (c && c > start) return fail('A megerősítő időpont a találkozó előtt legyen.', $(id));
    }

    return {
      id: editing?.id ?? db.uid(),
      name,
      date: $('a-date').value,
      time,
      arriveTo: to,
      confirm1,
      confirm2,
      duration: Number($('a-dur').value),
      address: $('a-addr').value.trim(),
      note: $('a-note').value.trim(),
      ...fees(),
      amount: computeTotal(), // Összes díj
      status: statusSel.value,
      incomeTxId: linkedTx ? editing.incomeTxId : '', // a belőle mentett bevétel (törölt bevételnél üres)
      createdAt: editing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
  }

  // A bevételt érintő adatok: ha ezek közül bármi változik, a már mentett bevétel nem érvényes.
  const INCOME_FIELDS = ['name', 'date', 'time', 'duration', 'rate', 'travel', 'white', 'extra', 'amount'];
  const incomeChanged = (before, after) => INCOME_FIELDS.some(k => (before[k] ?? 0) !== (after[k] ?? 0));
  const txLabel = tx => `${ft(tx.amount)} (${short(new Date(tx.timestamp))})`;

  // Zár: mentés / törlés / bevétel mentése közben minden gomb tiltott, így egy második
  // koppintás nem ment kétszer (új találkozónál nem jön létre két példány).
  let busy = false;
  const lock = on => {
    busy = on;
    for (const btn of form.querySelectorAll('button')) btn.disabled = on;
  };
  // A művelet a zár alatt fut; ha félbemarad (hiba, Mégse a kérdésnél), a zár feloldódik.
  const locked = fn => async () => {
    if (busy) return;
    lock(true);
    let finished = false;
    try {
      finished = await fn();
    } catch (err) {
      console.error(err);
      showErr('A művelet nem sikerült. Próbáld újra.');
    } finally {
      if (!finished) lock(false);
    }
  };

  form.addEventListener('submit', e => {
    e.preventDefault();
    locked(async () => {
      const appt = collect();
      if (!appt) return false;

      // Módosított találkozó, amelyhez már van bevétel: a bevételt is töröljük (rákérdezés után).
      let incomeRemoved = false;
      if (editing && linkedTx && incomeChanged(editing, appt)) {
        const yes = await confirmDialog({
          title: 'A bevétel is törlődik',
          text: `Ehhez a találkozóhoz már mentettél bevételt: ${txLabel(linkedTx)}. A módosítás miatt ez a bevétel törlődik; `
            + 'ha kell, a találkozó vége után a „Bevétel mentése” gombbal újra mentheted az új adatokkal.',
          ok: 'Mentés, bevétel törlése',
        });
        if (!yes) return false;
        await db.deleteTx(linkedTx.id);
        appt.incomeTxId = '';
        incomeRemoved = true;
      }

      await db.saveAppt(appt);
      toast(incomeRemoved ? `Találkozó módosítva, a ${ft(linkedTx.amount)}-os bevétel törölve`
        : editing ? 'Találkozó módosítva' : `Találkozó mentve: ${short(parseDay(appt.date))} ${appt.time}`);
      back(appt.date); // mentés után mindig vissza a naptár listájába
      return true;
    })();
  });

  el.onclick = async e => {
    const b = e.target.closest('button');
    if (!b || busy) return;
    if (b.dataset.clear) {
      // A megerősítő időpont kiürítése (az iPhone választója csak visszaállítani tud).
      $(b.dataset.clear).value = '';
      $('a-err').hidden = true;
    } else if (b.id === 'a-income') {
      // Bevétel a találkozóból: Összes díj, ügyfél neve, kezdési dátum + érkezés eleje, díjtételek.
      await locked(async () => {
        const appt = collect();
        if (!appt) return false;
        // A beírt (akár épp módosított) adatok szerint is véget kellett érnie a találkozónak.
        const end = apptEnd(appt);
        if (end > Date.now()) {
          updateIncome();
          showErr(`A bevétel csak a találkozó vége után menthető (${endLabel(end)}). A dátum módosításához használd a Mentés gombot.`);
          return false;
        }
        if (!appt.amount) { showErr('Az összes díj 0 Ft – adj meg óradíjat vagy más díjat.', $('a-rate')); return false; }
        const yes = await confirmDialog({
          title: 'Bevétel mentése?',
          text: `${ft(appt.amount)} bevétel – ${appt.name}, ${short(parseDay(appt.date))} ${appt.time}. A találkozón végzett módosítások is mentődnek.`,
          ok: 'Bevétel mentése',
        });
        if (!yes) return false;
        const cats = await db.getCategories();
        const cat = cats.find(c => c.type === 'income' && c.isClientPayment && !c.archived)
          ?? cats.find(c => c.type === 'income' && !c.archived);
        if (!cat) { showErr('Nincs bevételi forrás. Vegyél fel egyet a Beállításokban.'); return false; }
        const tx = {
          id: db.uid(),
          type: 'income',
          amount: appt.amount,
          categoryId: cat.id,
          clientName: appt.name,
          note: incomeNote(appt),
          timestamp: new Date(`${appt.date}T${appt.time}`).getTime(),
          createdAt: Date.now(),
        };
        await db.saveTx(tx);
        await db.addClient(appt.name);
        await db.saveAppt({ ...appt, incomeTxId: tx.id });
        toast(`Találkozó és bevétel mentve: ${ft(tx.amount)}`);
        back(appt.date); // vissza a naptár listájába
        return true;
      })();
    } else if (b.id === 'a-income-open') {
      ctx.go('entry', { editId: editing.incomeTxId });
    } else if (b.hasAttribute('data-cancel')) {
      if (dirty) {
        const yes = await confirmDialog({
          title: editing ? 'Elveted a módosításokat?' : 'Elveted az új találkozót?',
          text: editing ? 'A találkozó a korábbi állapotában marad.' : 'A beírt adatok nem mentődnek.',
          ok: 'Elvetés',
        });
        if (!yes) return;
      }
      back(editing?.date);
    } else if (b.id === 'a-del') {
      await locked(async () => {
        const yes = await confirmDialog({
          title: linkedTx ? 'Törlöd a találkozót és a bevételt?' : 'Törlöd a találkozót?',
          text: `${editing.name}, ${short(parseDay(editing.date))} ${editing.time}`
            + (linkedTx ? `. A hozzá mentett ${txLabel(linkedTx)} bevétel is törlődik` : '')
            + `${db.cloud ? ' – minden belépett telefonról' : ''}. Ez nem vonható vissza.`,
          ok: linkedTx ? 'Mindkettő törlése' : 'Találkozó törlése',
        });
        if (!yes) return false;
        if (linkedTx) await db.deleteTx(linkedTx.id);
        await db.deleteAppt(editing.id);
        toast(linkedTx ? `Találkozó és ${ft(linkedTx.amount)}-os bevétel törölve` : 'Találkozó törölve');
        back(editing.date); // törlés után vissza a naptár listájába
        return true;
      })();
    }
  };
}


/* ---------- Emlékeztető módosítása / törlése ---------- */

// r: a módosítandó emlékeztető, vagy null (új emlékeztető a ctx.state.apptDate napra).
function renderReminderForm(el, ctx, cal, r) {
  const isNew = !r;
  if (isNew) {
    const now = new Date();
    const date = ctx.state.apptDate ?? dayKey(now);
    const time = date === dayKey(now) ? `${pad(Math.min(now.getHours() + 1, 23))}:00` : '09:00';
    r = { id: db.uid(), kind: 'reminder', date, time, note: '', createdAt: Date.now() };
  }
  document.getElementById('title').textContent = isNew ? 'Új emlékeztető' : 'Emlékeztető módosítása';
  el.innerHTML = `
    <form class="stack" id="appt-form" novalidate>
      <div class="form-bar">
        <button type="button" class="btn small" data-cancel>Mégse</button>
        <button class="btn small primary">Mentés</button>
      </div>
      <div class="row2">
        <label class="field"><span>Dátum</span><input id="r-date" type="date" value="${r.date}"></label>
        <label class="field"><span>Időpont</span><input id="r-time" type="time" value="${r.time}"></label>
      </div>
      <label class="field">
        <span>Megjegyzés</span>
        <textarea id="r-note" class="note2" rows="5" maxlength="1000">${esc(r.note)}</textarea>
      </label>
      <p class="error" id="r-err" role="alert" hidden></p>
      <button class="btn primary" id="r-save">${isNew ? 'Emlékeztető mentése' : 'Módosítás mentése'}</button>
      ${isNew ? '' : '<button type="button" class="btn danger-ghost" id="r-del">Emlékeztető törlése</button>'}
      <button type="button" class="btn ghost" data-cancel>Mégse</button>
    </form>`;
  const $ = id => el.querySelector('#' + id);
  const form = $('appt-form');
  let dirty = false, busy = false;
  if (isNew) setTimeout(() => $('r-note').focus(), 0);
  form.addEventListener('input', () => { $('r-err').hidden = true; dirty = true; });
  const err = (msg, field) => { $('r-err').textContent = msg; $('r-err').hidden = false; field?.focus(); };
  const back = day => { if (day) cal.date = parseDay(day); ctx.go('calendar'); };

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (busy) return;
    const note = $('r-note').value.trim();
    const date = $('r-date').value, time = $('r-time').value.slice(0, 5);
    if (!note) return err('Írd be, mire emlékeztessen.', $('r-note'));
    if (!date || !time) return err('Add meg a dátumot és az időpontot.');
    busy = true;
    await db.saveAppt({ ...r, date, time, note, updatedAt: Date.now() });
    toast(isNew ? `Emlékeztető mentve: ${short(parseDay(date))} ${time}` : 'Emlékeztető módosítva');
    back(date);
  });

  el.onclick = async e => {
    const b = e.target.closest('button');
    if (!b || busy) return;
    if (b.hasAttribute('data-cancel')) {
      if (dirty && !(await confirmDialog(isNew
        ? { title: 'Elveted az új emlékeztetőt?', text: 'A beírt szöveg nem mentődik.', ok: 'Elvetés' }
        : { title: 'Elveted a módosításokat?', text: 'Az emlékeztető a korábbi állapotában marad.', ok: 'Elvetés' }))) return;
      back(r.date);
    } else if (b.id === 'r-del') {
      const yes = await confirmDialog({
        title: 'Törlöd az emlékeztetőt?',
        text: `${short(parseDay(r.date))} ${r.time} – ${remTitle(r)}${db.cloud ? ' – minden belépett telefonról' : ''}. Ez nem vonható vissza.`,
        ok: 'Emlékeztető törlése',
      });
      if (!yes) return;
      busy = true;
      await db.deleteAppt(r.id);
      toast('Emlékeztető törölve');
      back(r.date);
    }
  };
}
