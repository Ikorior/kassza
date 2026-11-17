import * as db from '../db.js';
import { esc } from '../format.js';
import { toast, confirmDialog } from '../ui.js';

// Egy tétel állapota: nyitott, kész (pipa), mégsem kell (áthúzva), nem megoldható (szürke).
const STATES = {
  open: 'Nyitott',
  done: 'Kész',
  dropped: 'Mégsem kell',
  blocked: 'Nem megoldható',
};

const ICONS = {
  open: '<circle cx="12" cy="12" r="8.5"/>',
  done: '<circle cx="12" cy="12" r="8.5" class="fill"/><path d="M8 12.3l2.7 2.7L16.2 9.5" class="mark"/>',
  dropped: '<circle cx="12" cy="12" r="8.5"/><path d="M8 12h8"/>',
  blocked: '<circle cx="12" cy="12" r="8.5"/><path d="M6 18L18 6"/>',
};
const icon = state => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[state]}</svg>`;

// A lista neve; ha nincs megadva, az első sor első néhány karakteréből.
export function todoName(list) {
  const name = (list.name ?? '').trim();
  if (name) return name;
  const first = list.items?.find(i => i.text.trim())?.text.trim();
  if (!first) return 'Új lista';
  if (first.length <= 24) return first;
  // Szóhatáron vágunk, ha az nem túl rövid eredményt ad.
  const cut = first.slice(0, 25);
  const space = cut.lastIndexOf(' ');
  return (space >= 12 ? cut.slice(0, space) : cut.slice(0, 24)).trimEnd() + '…';
}

const isEmpty = list => !(list.name ?? '').trim() && !list.items?.length;

const shortWhen = ts => new Date(ts).toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' });

function progress(list) {
  const items = list.items ?? [];
  const count = s => items.filter(i => i.state === s).length;
  const relevant = items.length - count('dropped');
  return { done: count('done'), blocked: count('blocked'), relevant, total: items.length };
}

export async function renderTodos(el, ctx) {
  if (ctx.state.todoId) {
    const list = await db.getTodo(ctx.state.todoId);
    if (list) return renderList(el, ctx, structuredClone(list));
    ctx.state.todoId = null;
  }
  return renderOverview(el, ctx);
}

/* ---------- Listák áttekintése ---------- */

async function renderOverview(el, ctx) {
  let lists = await db.getTodos();
  // Üresen otthagyott (név és tétel nélküli) listák takarítása.
  for (const l of lists.filter(isEmpty)) await db.deleteTodo(l.id);
  lists = lists.filter(l => !isEmpty(l)).sort((a, b) => b.updatedAt - a.updatedAt);

  el.innerHTML = `
    <button type="button" class="btn primary block" id="new">+ Új teendőlista</button>
    ${lists.length ? `
      <h2>Listáim (${lists.length})</h2>
      <ul class="list">${lists.map(l => {
        const p = progress(l);
        const parts = [`${p.done}/${p.relevant} kész`];
        if (p.blocked) parts.push(`${p.blocked} nem megoldható`);
        const pct = p.relevant ? (p.done / p.relevant) * 100 : 0;
        return `
          <li><button type="button" class="tx todo-card" data-list="${l.id}">
            <span class="tx-main">
              <b>${esc(todoName(l))}</b>
              <small>${parts.join(' · ')}</small>
              <span class="bar"><i style="width:${pct.toFixed(1)}%"></i></span>
            </span>
            <span></span>
            <span class="tx-amt"><small>${shortWhen(l.updatedAt)}</small></span>
          </button></li>`;
      }).join('')}</ul>`
    : `<div class="empty"><p>Még nincs teendőlistád. Hozz létre egyet a fenti gombbal.</p></div>`}`;

  el.onclick = async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'new') {
      const now = Date.now();
      const list = { id: db.uid(), name: '', items: [], createdAt: now, updatedAt: now };
      await db.saveTodo(list);
      ctx.go('todos', { todoId: list.id, focusNew: true });
    } else if (b.dataset.list) {
      ctx.go('todos', { todoId: b.dataset.list });
    }
  };
}

/* ---------- Egy lista ---------- */

function renderList(el, ctx, list) {
  const focusNew = ctx.state.focusNew;
  ctx.state.focusNew = false;

  el.innerHTML = `
    <div class="todo-head">
      <button type="button" class="btn small ghost" id="back">‹ Listák</button>
    </div>
    <label class="field">
      <span>Lista neve</span>
      <input id="tname" type="text" maxlength="60" autocomplete="off" value="${esc(list.name)}">
    </label>
    <p class="hint" style="margin-top:0.375rem">Ha üresen hagyod, az első sor elejéből kap nevet.</p>

    <h2 id="items-title"></h2>
    <ul class="list todo-items" id="items"></ul>

    <form class="inline-add" id="add" novalidate>
      <label class="sr-only" for="newitem">Új teendő</label>
      <input id="newitem" type="text" maxlength="200" autocomplete="off" enterkeyhint="done" placeholder="Új teendő">
      <button class="btn">Hozzáadás</button>
    </form>
    <p class="hint" style="margin-top:0.5rem">A körre koppintva kész / nyitott. A ⋯ gombbal: mégsem kell, nem megoldható, szerkesztés, törlés.</p>

    <button type="button" class="btn danger-ghost block" id="dellist" style="margin-top:1.5rem">Lista törlése</button>

    <dialog id="item-menu" aria-labelledby="item-menu-title">
      <form method="dialog" class="stack">
        <h2 id="item-menu-title">Teendő</h2>
        <label class="field"><span>Szöveg</span><input id="edit-text" type="text" maxlength="200" autocomplete="off"></label>
        <div class="state-grid" role="group" aria-label="Állapot">
          ${Object.entries(STATES).map(([s, label]) =>
            `<button type="button" class="state-btn s-${s}" data-state="${s}">${icon(s)}<span>${label}</span></button>`).join('')}
        </div>
        <div class="dialog-actions">
          <button type="button" class="btn danger-ghost" id="del-item">Törlés</button>
          <button type="button" class="btn primary" id="close-item">Kész</button>
        </div>
      </form>
    </dialog>`;

  const $ = id => el.querySelector('#' + id);
  const nameInput = $('tname');
  const menu = $('item-menu');
  let menuItem = null;
  let nameTimer;

  function save() {
    list.updatedAt = Date.now();
    return db.saveTodo(structuredClone(list));
  }

  function paint() {
    const p = progress(list);
    nameInput.placeholder = todoName({ ...list, name: '' });
    $('items-title').textContent = list.items.length ? `Teendők · ${p.done}/${p.relevant} kész` : 'Teendők';
    $('items').innerHTML = list.items.length
      ? list.items.map(i => `
        <li class="todo s-${i.state}">
          <button type="button" class="todo-check" data-toggle="${i.id}"
                  aria-label="${esc(i.text)}: ${STATES[i.state]}. Koppintásra ${i.state === 'done' ? 'nyitott' : 'kész'}.">${icon(i.state)}</button>
          <span class="todo-text">${esc(i.text)}</span>
          <button type="button" class="todo-more" data-more="${i.id}" aria-label="${esc(i.text)}: további lehetőségek">⋯</button>
        </li>`).join('')
      : `<li class="todo-empty">Még nincs teendő a listán. Írd be az elsőt lent.</li>`;
  }
  paint();
  if (focusNew) setTimeout(() => nameInput.focus(), 0); // a nézet beillesztése után

  nameInput.addEventListener('input', () => {
    list.name = nameInput.value;
    clearTimeout(nameTimer);
    nameTimer = setTimeout(save, 400);
  });
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('newitem').focus(); } });

  $('add').addEventListener('submit', async e => {
    e.preventDefault();
    const text = $('newitem').value.trim();
    if (!text) { $('newitem').focus(); return; }
    list.items.push({ id: db.uid(), text, state: 'open' });
    $('newitem').value = '';
    paint();
    $('newitem').focus(); // gyorsan lehessen több sort egymás után beírni
    await save();
  });

  function openMenu(item) {
    menuItem = item;
    $('edit-text').value = item.text;
    for (const b of menu.querySelectorAll('[data-state]')) b.setAttribute('aria-pressed', b.dataset.state === item.state);
    menu.showModal();
  }
  async function closeMenu() {
    const text = $('edit-text').value.trim();
    if (menuItem && text && text !== menuItem.text) {
      menuItem.text = text;
      paint();
      await save();
    }
    menuItem = null;
    if (menu.open) menu.close();
  }
  menu.addEventListener('cancel', e => { e.preventDefault(); closeMenu(); });

  el.onclick = async e => {
    const b = e.target.closest('button');
    if (!b) return;
    const find = id => list.items.find(i => i.id === id);

    if (b.dataset.toggle) {
      const item = find(b.dataset.toggle);
      item.state = item.state === 'done' ? 'open' : 'done';
      paint();
      await save();
    } else if (b.dataset.more) {
      openMenu(find(b.dataset.more));
    } else if (b.dataset.state && menuItem) {
      menuItem.state = b.dataset.state;
      paint();
      await save();
      await closeMenu();
    } else if (b.id === 'close-item') {
      await closeMenu();
    } else if (b.id === 'del-item' && menuItem) {
      list.items = list.items.filter(i => i !== menuItem);
      menuItem = null;
      menu.close();
      paint();
      await save();
      toast('Teendő törölve');
    } else if (b.id === 'back') {
      clearTimeout(nameTimer);
      if (isEmpty(list)) await db.deleteTodo(list.id);
      else await save();
      ctx.go('todos', { todoId: null });
    } else if (b.id === 'dellist') {
      const yes = await confirmDialog({
        title: 'Törlöd a listát?',
        text: `„${todoName(list)}” és mind a(z) ${list.items.length} teendője törlődik${db.cloud ? ', minden belépett telefonon' : ''}. Ez nem vonható vissza.`,
        ok: 'Lista törlése',
      });
      if (!yes) return;
      clearTimeout(nameTimer);
      await db.deleteTodo(list.id);
      toast('Lista törölve');
      ctx.go('todos', { todoId: null });
    }
  };
}
