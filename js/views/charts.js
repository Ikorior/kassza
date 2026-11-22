import * as db from '../db.js';
import { ft, addDays, addMonths, dayKey, monthLabel, monthShort, esc } from '../format.js';
import { monthStartDay, periodOf, anchorFor, currentAnchor, rangeText, startDayText } from '../period.js';

const COLORS = ['#0f766e', '#d97706', '#4f46e5', '#be185d', '#65a30d', '#0891b2', '#7c3aed', '#78716c'];
const KEY = `<p class="key"><span><i class="k-pos"></i>Bevétel</span><span><i class="k-neg"></i>Kiadás</span></p>`;

const W = 320, H = 150, BASE = 128, TOP = 16;

function frame(max, inner, label) {
  const mid = (BASE + TOP) / 2;
  return `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
      <line class="grid" x1="0" x2="${W}" y1="${TOP}" y2="${TOP}"/>
      <line class="grid" x1="0" x2="${W}" y1="${mid}" y2="${mid}"/>
      <line class="grid" x1="0" x2="${W}" y1="${BASE}" y2="${BASE}"/>
      <text x="0" y="${TOP - 4}">${ft(max)}</text>
      <text x="0" y="${mid - 4}">${ft(max / 2)}</text>
      ${inner}
    </svg>`;
}

function bar(cls, x, w, value, max, tip) {
  if (!value) return '';
  const h = Math.max(1.5, (value / max) * (BASE - TOP));
  return `<rect class="${cls}" x="${x.toFixed(2)}" y="${(BASE - h).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="1"><title>${esc(tip)}</title></rect>`;
}

// A kiválasztott időszak napjai (pl. okt. 10. – nov. 9.), naponként egy oszloppár.
function dailyChart(txs, period, label) {
  const days = [];
  for (let d = period.from; d < period.to; d = addDays(d, 1)) days.push(d);
  const n = days.length;
  const index = new Map(days.map((d, i) => [dayKey(d), i]));
  const inc = Array(n).fill(0), exp = Array(n).fill(0);
  for (const t of txs) {
    const i = index.get(dayKey(new Date(t.timestamp)));
    if (i != null) (t.type === 'income' ? inc : exp)[i] += t.amount;
  }
  const max = Math.max(...inc, ...exp);
  if (!max) return `<p class="chart-empty">Ebben az időszakban még nincs rögzített tétel.</p>`;

  const slot = W / n, bw = slot * 0.38;
  let inner = '';
  days.forEach((d, i) => {
    const x = i * slot + slot * 0.1;
    const when = d.toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' });
    inner += bar('b-pos', x, bw, inc[i], max, `${when} – bevétel: ${ft(inc[i])}`);
    inner += bar('b-neg', x + bw + slot * 0.04, bw, exp[i], max, `${when} – kiadás: ${ft(exp[i])}`);
    // Tengelyfelirat: az időszak első napja, a hónapváltás, és minden 5. nap (ha nem zsúfolt).
    const day = d.getDate();
    if (i === 0 || day === 1 || (day % 5 === 0 && day !== 30 && i > 1)) {
      inner += `<text x="${(i * slot + slot / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${day === 1 && i > 0 ? esc(monthShort(d)) : day}</text>`;
    }
  });
  return KEY + frame(max, inner, `Napi bevétel és kiadás, ${label}`);
}

function trendChart(all, month, s) {
  const months = Array.from({ length: 6 }, (_, i) => addMonths(month, i - 5));
  const inc = Array(6).fill(0), exp = Array(6).fill(0);
  for (const t of all) {
    const a = anchorFor(new Date(t.timestamp), s);
    const i = months.findIndex(m => m.getFullYear() === a.getFullYear() && m.getMonth() === a.getMonth());
    if (i >= 0) (t.type === 'income' ? inc : exp)[i] += t.amount;
  }
  const max = Math.max(...inc, ...exp);
  if (!max) return `<p class="chart-empty">Az utolsó hat hónapban nincs rögzített tétel.</p>`;

  const slot = W / 6, bw = slot * 0.3;
  let inner = '';
  months.forEach((m, i) => {
    const x = i * slot + slot * 0.17;
    inner += bar('b-pos', x, bw, inc[i], max, `${monthLabel(m)} – bevétel: ${ft(inc[i])}`);
    inner += bar('b-neg', x + bw + slot * 0.06, bw, exp[i], max, `${monthLabel(m)} – kiadás: ${ft(exp[i])}`);
    inner += `<text x="${(i * slot + slot / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(monthShort(m))}</text>`;
  });
  return KEY + frame(max, inner, 'Bevétel és kiadás az utolsó hat hónapban');
}

function donut(txs, cmap, emptyText, label) {
  const map = new Map();
  for (const t of txs) map.set(t.categoryId, (map.get(t.categoryId) ?? 0) + t.amount);
  let items = [...map].map(([id, amount]) => ({ name: cmap.get(id)?.name ?? 'Törölt típus', amount }))
    .sort((a, b) => b.amount - a.amount);
  if (!items.length) return `<p class="chart-empty">${emptyText}</p>`;
  if (items.length > COLORS.length) {
    const rest = items.slice(COLORS.length - 1);
    items = [...items.slice(0, COLORS.length - 1), { name: 'Többi együtt', amount: rest.reduce((s, i) => s + i.amount, 0) }];
  }
  const total = items.reduce((s, i) => s + i.amount, 0);

  const R = 42, C = 2 * Math.PI * R;
  let offset = 0;
  const segs = items.map((it, i) => {
    const len = (it.amount / total) * C;
    const gap = items.length > 1 ? 1.5 : 0;
    const seg = `<circle cx="60" cy="60" r="${R}" fill="none" stroke="${COLORS[i]}" stroke-width="18"
      stroke-dasharray="${Math.max(0.5, len - gap).toFixed(2)} ${(C - Math.max(0.5, len - gap)).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"/>`;
    offset += len;
    return seg;
  }).join('');

  return `
    <div class="donut">
      <svg viewBox="0 0 120 120" role="img" aria-label="${esc(label)}">
        <g transform="rotate(-90 60 60)">${segs}</g>
        <text class="center" x="60" y="63.5" text-anchor="middle">${ft(total)}</text>
      </svg>
      <ul class="legend">${items.map((it, i) => `
        <li><i style="background:${COLORS[i]}"></i><span>${esc(it.name)}</span>
        <b>${Math.round((it.amount / total) * 100)}% · ${ft(it.amount)}</b></li>`).join('')}</ul>
    </div>`;
}

export async function renderCharts(el, ctx) {
  // Ugyanaz az egyedi hónap, mint a Havi lapon (kezdőnap, kiválasztott hónap).
  const s = await monthStartDay();
  const month = currentAnchor(ctx.state, s);
  const period = periodOf(month, s);
  const sixStart = periodOf(addMonths(month, -5), s).from;
  const [all, cats] = await Promise.all([
    db.txInRange(sixStart.getTime(), period.to.getTime()),
    db.getCategories(),
  ]);
  const cmap = new Map(cats.map(c => [c.id, c]));
  const txs = all.filter(t => t.timestamp >= period.from.getTime());
  const range = rangeText(period);

  el.innerHTML = `
    <div class="pager">
      <button type="button" data-step="-1" aria-label="Előző hónap">‹</button>
      <div class="pager-mid"><strong>${monthLabel(month)}</strong><small>${range}</small></div>
      <button type="button" data-step="1" aria-label="Következő hónap">›</button>
    </div>
    <h2>Napi bevétel és kiadás</h2>
    <div class="chart">${dailyChart(txs, period, range)}</div>
    <h2>Kiadások megoszlása</h2>
    <div class="chart">${donut(txs.filter(t => t.type === 'expense'), cmap, 'Ebben az időszakban nincs kiadás.', 'Kiadások megoszlása költségtípusonként')}</div>
    <h2>Bevételek megoszlása</h2>
    <div class="chart">${donut(txs.filter(t => t.type === 'income'), cmap, 'Ebben az időszakban nincs bevétel.', 'Bevételek megoszlása forrásonként')}</div>
    <h2>Utolsó hat hónap</h2>
    <div class="chart">${trendChart(all, month, s)}</div>
    <p class="hint" style="margin-top:12px">Pénzügyi hónap: ${startDayText(s)} (Beállítások → Pénzügyi hónap).</p>`;

  el.onclick = e => {
    const b = e.target.closest('button[data-step]');
    if (b) ctx.go('charts', { month: addMonths(month, Number(b.dataset.step)) });
  };
  el.onchange = null;
}
