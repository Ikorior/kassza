const nf = new Intl.NumberFormat('hu-HU', { useGrouping: 'always', maximumFractionDigits: 0 });

export const ft = n => nf.format(Math.round(n)) + ' Ft';
export const signed = (n, type) => (type === 'income' ? '+' : '−') + ft(n);

export const pad = n => String(n).padStart(2, '0');
export const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const timeStr = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export const parseDay = s => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const startOfMonth = d => new Date(d.getFullYear(), d.getMonth(), 1);
export const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);

export const weekday = d => d.toLocaleDateString('hu-HU', { weekday: 'long' });
export const dayShort = d => d.toLocaleDateString('hu-HU', { month: 'short', day: 'numeric', weekday: 'short' });
export const monthLabel = d => d.toLocaleDateString('hu-HU', { year: 'numeric', month: 'long' });
export const monthShort = d => d.toLocaleDateString('hu-HU', { month: 'short' });
export const dateTimeLabel = d => d.toLocaleString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });

// Számjegyek ezres tagolással, beírás közben: "12000" -> "12 000"
export const groupDigits = s =>
  String(s).replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 10).replace(/\B(?=(\d{3})+$)/g, ' ');

export const esc = s =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function totals(txs) {
  let inc = 0, exp = 0;
  for (const t of txs) {
    if (t.type === 'income') inc += t.amount; else exp += t.amount;
  }
  return { inc, exp, bal: inc - exp };
}
