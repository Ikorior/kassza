import * as db from '../db.js';
import {
  ft, signed, dayKey, timeStr, parseDay, startOfDay, addDays, startOfMonth, addMonths,
  weekday, dayShort, monthLabel, esc, totals,
} from '../format.js';

function cards({ inc, exp, bal }) {
  return `
    <div class="cards">
      <div class="card wide"><span>Egyenleg</span><strong class="${bal < 0 ? 'neg' : ''}">${bal < 0 ? '−' : ''}${ft(Math.abs(bal))}</strong></div>
      <div class="card"><span>Bevétel</span><strong class="pos">${ft(inc)}</strong></div>
      <div class="card"><span>Kiadás</span><strong class="neg">${ft(exp)}</strong></div>
    </div>`;
}

const catName = (cmap, id) => cmap.get(id)?.name ?? 'Törölt típus';

/* ---------- Napi nézet ---------- */

export async function renderDay(el, ctx) {
  const day = startOfDay(ctx.state.day);
  const [txs, cats] = await Promise.all([
    db.txInRange(day.getTime(), addDays(day, 1).getTime()),
    db.getCategories(),
  ]);
  const cmap = new Map(cats.map(c => [c.id, c]));
  const isToday = dayKey(day) === dayKey(new Date());

  const rows = txs.map(t => {
    const sub = [t.clientName, t.note].filter(Boolean).join(' · ');
    return `
      <li><button type="button" class="tx" data-id="${t.id}">
        <span class="tx-time">${timeStr(new Date(t.timestamp))}</span>
        <span class="tx-main"><b>${esc(catName(cmap, t.categoryId))}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>
        <span class="tx-amt ${t.type === 'income' ? 'pos' : 'neg'}">${signed(t.amount, t.type)}</span>
      </button></li>`;
  }).join('');

  el.innerHTML = `
    <div class="pager">
      <button type="button" data-step="-1" aria-label="Előző nap">‹</button>
      <div class="pager-mid">
        <input type="date" id="day-pick" aria-label="Nap kiválasztása" value="${dayKey(day)}">
      </div>
      <button type="button" data-step="1" aria-label="Következő nap">›</button>
    </div>
    <div class="pager-extra">
      <small class="hint">${weekday(day)}${isToday ? ' · ma' : ''}</small>
    </div>
    ${isToday ? '' : `<div class="pager-extra"><button type="button" class="btn small" id="today">Ugrás a mai napra</button></div>`}
    ${cards(totals(txs))}
    <h2>Tételek${txs.length ? ` (${txs.length})` : ''}</h2>
    ${txs.length
      ? `<ul class="list">${rows}</ul>`
      : `<div class="empty"><p>Erre a napra még nincs rögzített tétel.</p>
           <button type="button" class="btn primary" id="add">Tétel rögzítése erre a napra</button></div>`}`;

  el.onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.step) ctx.go('day', { day: addDays(day, Number(b.dataset.step)) });
    else if (b.id === 'today') ctx.go('day', { day: new Date() });
    else if (b.id === 'add') ctx.go('entry', { presetDay: day });
    else if (b.dataset.id) ctx.go('entry', { editId: b.dataset.id });
  };
  el.querySelector('#day-pick').onchange = e => {
    if (e.target.value) ctx.go('day', { day: parseDay(e.target.value) });
  };
}

/* ---------- Havi nézet ---------- */

function sumBy(txs, keyFn) {
  const map = new Map();
  for (const t of txs) {
    const k = keyFn(t);
    if (k == null || k === '') continue;
    const cur = map.get(k) ?? { amount: 0, count: 0 };
    cur.amount += t.amount;
    cur.count += 1;
    map.set(k, cur);
  }
  return [...map].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.amount - a.amount);
}

function breakdown(items, label, neg = false) {
  const max = Math.max(...items.map(i => i.amount), 1);
  return `<ul class="list">${items.map(i => `
    <li class="brk">
      <div class="brk-head"><span>${esc(label(i))}</span><b>${ft(i.amount)}</b></div>
      <div class="bar ${neg ? 'neg' : ''}"><i style="width:${Math.max(2, (i.amount / max) * 100).toFixed(1)}%"></i></div>
    </li>`).join('')}</ul>`;
}

export async function renderMonth(el, ctx) {
  const month = startOfMonth(ctx.state.month);
  const [txs, cats] = await Promise.all([
    db.txInRange(month.getTime(), addMonths(month, 1).getTime()),
    db.getCategories(),
  ]);
  const cmap = new Map(cats.map(c => [c.id, c]));
  const income = txs.filter(t => t.type === 'income');
  const expense = txs.filter(t => t.type === 'expense');

  const byClient = sumBy(income, t => t.clientName);
  const days = new Map();
  for (const t of txs) {
    const k = dayKey(new Date(t.timestamp));
    if (!days.has(k)) days.set(k, []);
    days.get(k).push(t);
  }
  const dayRows = [...days].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([k, list]) => {
    const s = totals(list);
    return `
      <li><button type="button" class="tx" data-day="${k}">
        <span class="tx-main"><b>${dayShort(parseDay(k))}</b><small>${list.length} tétel</small></span>
        <span></span>
        <span class="tx-amt">
          ${s.inc ? `<small class="pos">+${ft(s.inc)}</small>` : ''}
          ${s.exp ? `<small class="neg">−${ft(s.exp)}</small>` : ''}
        </span>
      </button></li>`;
  }).join('');

  el.innerHTML = `
    <div class="pager">
      <button type="button" data-step="-1" aria-label="Előző hónap">‹</button>
      <div class="pager-mid"><strong>${monthLabel(month)}</strong></div>
      <button type="button" data-step="1" aria-label="Következő hónap">›</button>
    </div>
    ${cards(totals(txs))}
    ${txs.length ? `
      ${income.length ? `<h2>Bevételek forrásonként</h2>${breakdown(sumBy(income, t => t.categoryId), i => catName(cmap, i.key))}` : ''}
      ${byClient.length ? `<h2>Ügyfelek</h2>${breakdown(byClient, i => `${i.key} (${i.count})`)}` : ''}
      ${expense.length ? `<h2>Kiadások típusonként</h2>${breakdown(sumBy(expense, t => t.categoryId), i => catName(cmap, i.key), true)}` : ''}
      <h2>Napok</h2>
      <ul class="list">${dayRows}</ul>`
    : `<div class="empty"><p>Ebben a hónapban még nincs rögzített tétel.</p>
         <button type="button" class="btn primary" id="add">Tétel rögzítése</button></div>`}`;

  el.onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.step) ctx.go('month', { month: addMonths(month, Number(b.dataset.step)) });
    else if (b.dataset.day) ctx.go('day', { day: parseDay(b.dataset.day) });
    else if (b.id === 'add') ctx.go('entry');
  };
  el.onchange = null;
}
