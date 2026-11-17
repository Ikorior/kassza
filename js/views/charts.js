import * as db from '../db.js';
import { ft, startOfMonth, addMonths, monthLabel, monthShort, esc } from '../format.js';

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

function dailyChart(txs, month) {
  const n = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const inc = Array(n).fill(0), exp = Array(n).fill(0);
  for (const t of txs) (t.type === 'income' ? inc : exp)[new Date(t.timestamp).getDate() - 1] += t.amount;
  const max = Math.max(...inc, ...exp);
  if (!max) return `<p class="chart-empty">Ebben a hónapban még nincs rögzített tétel.</p>`;

  const slot = W / n, bw = slot * 0.38;
  let inner = '';
  for (let i = 0; i < n; i++) {
    const x = i * slot + slot * 0.1;
    inner += bar('b-pos', x, bw, inc[i], max, `${i + 1}. – bevétel: ${ft(inc[i])}`);
    inner += bar('b-neg', x + bw + slot * 0.04, bw, exp[i], max, `${i + 1}. – kiadás: ${ft(exp[i])}`);
    if (i === 0 || (i + 1) % 5 === 0) {
      inner += `<text x="${(i * slot + slot / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${i + 1}</text>`;
    }
  }
  return KEY + frame(max, inner, `Napi bevétel és kiadás, ${monthLabel(month)}`);
}

function trendChart(all, month) {
  const months = Array.from({ length: 6 }, (_, i) => addMonths(month, i - 5));
  const inc = Array(6).fill(0), exp = Array(6).fill(0);
  for (const t of all) {
    const d = new Date(t.timestamp);
    const i = months.findIndex(m => m.getFullYear() === d.getFullYear() && m.getMonth() === d.getMonth());
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
  const month = startOfMonth(ctx.state.month);
  const [all, cats] = await Promise.all([
    db.txInRange(addMonths(month, -5).getTime(), addMonths(month, 1).getTime()),
    db.getCategories(),
  ]);
  const cmap = new Map(cats.map(c => [c.id, c]));
  const txs = all.filter(t => t.timestamp >= month.getTime());

  el.innerHTML = `
    <div class="pager">
      <button type="button" data-step="-1" aria-label="Előző hónap">‹</button>
      <div class="pager-mid"><strong>${monthLabel(month)}</strong></div>
      <button type="button" data-step="1" aria-label="Következő hónap">›</button>
    </div>
    <h2>Napi bevétel és kiadás</h2>
    <div class="chart">${dailyChart(txs, month)}</div>
    <h2>Kiadások megoszlása</h2>
    <div class="chart">${donut(txs.filter(t => t.type === 'expense'), cmap, 'Ebben a hónapban nincs kiadás.', 'Kiadások megoszlása költségtípusonként')}</div>
    <h2>Bevételek megoszlása</h2>
    <div class="chart">${donut(txs.filter(t => t.type === 'income'), cmap, 'Ebben a hónapban nincs bevétel.', 'Bevételek megoszlása forrásonként')}</div>
    <h2>Utolsó hat hónap</h2>
    <div class="chart">${trendChart(all, month)}</div>`;

  el.onclick = e => {
    const b = e.target.closest('button[data-step]');
    if (b) ctx.go('charts', { month: addMonths(month, Number(b.dataset.step)) });
  };
  el.onchange = null;
}
