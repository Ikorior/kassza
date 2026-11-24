import * as db from '../db.js';
import { esc } from '../format.js';
import { toast } from '../ui.js';
import * as gc from '../gcontacts.js';

// Gmail-névjegyzék az appon belül: lista + keresés, részletek (e-mail, térkép; hívás/SMS szándékosan nincs),
// új névjegy felvétele egyenesen a Gmail-fiókba.

const q = { text: '' };
const initials = name => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export async function renderContacts(el, ctx) {
  const gmail = String((await db.getShared('gmailContacts')) ?? '').trim();
  const sub = ctx.state.contact; // null: lista, 'new': új névjegy, egyébként a névjegy azonosítója
  const bar = (label, right = '') => `
    <div class="todo-bar">
      <button type="button" class="btn small" data-act="back">‹ ${label}</button>
      <span>${right}</span>
    </div>`;

  if (!gmail) {
    el.innerHTML = `${bar('Főoldal')}
      <div class="empty"><p>Még nincs megadva a Gmail-fiók.</p>
        <span class="hint">A Beállításokban add meg, melyik Gmail-fiók névjegyzékét mutassa az app.</span><br><br>
        <button type="button" class="btn primary" data-act="settings">Beállítások megnyitása</button></div>`;
    return wire(el, ctx);
  }

  const t = gc.token();
  if (!t) {
    // Lejárt az 1 órás kulcs: ha korábban már engedélyezve volt, csendben megújítjuk.
    if (gc.signedEmail() && gc.maySilentRenew() && navigator.onLine) {
      el.innerHTML = `${bar('Főoldal')}<div class="empty"><p>Kapcsolódás a Gmailhez…</p></div>`;
      setTimeout(() => gc.signIn(gmail, { silent: true }), 50);
      return wire(el, ctx);
    }
    el.innerHTML = `${bar('Főoldal')}
      <div class="contacts-login">
        <span class="cl-icon" aria-hidden="true">👥</span>
        <h2>Gmail névjegyzék</h2>
        <p>Jelentkezz be a <b>${esc(gmail)}</b> fiókkal, hogy az app megjeleníthesse a névjegyeket.</p>
        <button type="button" class="btn primary block" data-act="login">Bejelentkezés a Google-fiókba</button>
        <p class="hint">Az első belépéskor a Google figyelmeztet, hogy az appot nem ellenőrizte.
          Ilyenkor koppints a <b>Speciális</b>, majd az <b>Ugrás a(z) Kassza oldalra</b> feliratra, és engedélyezd a névjegyek elérését.</p>
      </div>`;
    return wire(el, ctx, gmail);
  }

  const wrongAccount = t.email && t.email.toLowerCase() !== gmail.toLowerCase();

  let list;
  try {
    list = await gc.listContacts(!!ctx.state.contactsForce);
  } catch (err) {
    if (err instanceof gc.AuthError) return renderContacts(el, ctx); // lejárt: újra bejelentkezés
    el.innerHTML = `${bar('Főoldal')}
      <div class="empty"><p>A névjegyeket most nem sikerült betölteni.</p>
        <span class="hint">Ellenőrizd az internetkapcsolatot, majd próbáld újra.</span><br><br>
        <button type="button" class="btn" data-act="reload">Újra</button></div>`;
    return wire(el, ctx, gmail);
  }
  ctx.state.contactsForce = false;

  if (sub === 'new') return renderNew(el, ctx, bar);
  if (sub) {
    const c = list.find(x => x.id === sub);
    if (c) return renderDetail(el, ctx, bar, c);
  }

  el.innerHTML = `
    ${bar('Főoldal', `${list.length} névjegy`)}
    ${wrongAccount ? `<p class="error">Most a <b>${esc(t.email)}</b> fiók névjegyei látszanak, nem a beállított ${esc(gmail)} fiókéi.
      <button type="button" class="btn small" data-act="switch">Fiókváltás</button></p>` : ''}
    <div class="contacts-tools">
      <label class="sr-only" for="cq">Keresés a névjegyek között</label>
      <input id="cq" type="search" autocomplete="off" enterkeyhint="search" placeholder="Keresés: név, telefon, e-mail…" value="${esc(q.text)}">
      <button type="button" class="btn primary small" data-act="new">+ Új</button>
    </div>
    <ul class="list contacts-list" id="clist"></ul>
    <p class="hint contacts-foot">Bejelentkezve: ${esc(t.email || gmail)} ·
      <button type="button" class="linkish" data-act="logout">Kijelentkezés ezen a telefonon</button></p>`;

  const ul = el.querySelector('#clist');
  const paint = () => {
    const words = norm(q.text).split(/\s+/).filter(Boolean);
    const hits = list.filter(c => {
      const hay = norm([c.name, c.org, ...c.phones.map(p => p.value + ' ' + p.value.replace(/\D/g, '')), ...c.emails.map(e => e.value)].join(' '));
      return words.every(w => hay.includes(w));
    });
    ul.innerHTML = hits.length ? hits.map(c => `
      <li><button type="button" class="tx contact-row" data-id="${esc(c.id)}">
        <span class="avatar" aria-hidden="true">${esc(initials(c.name)) || '👤'}</span>
        <span class="tx-main"><b>${esc(c.name)}</b><small>${esc(c.phones[0]?.value || c.emails[0]?.value || c.org || '')}</small></span>
        <span class="chev" aria-hidden="true">›</span>
      </button></li>`).join('')
      : `<li class="empty"><p>${list.length ? 'Nincs találat.' : 'A névjegyzék még üres.'}</p></li>`;
  };
  paint();
  el.querySelector('#cq').addEventListener('input', e => { q.text = e.target.value; paint(); });
  return wire(el, ctx, gmail);
}

function renderDetail(el, ctx, bar, c) {
  const row = (icon, label, value, actions) => `
    <div class="cd-row"><span class="cd-icon" aria-hidden="true">${icon}</span>
      <span class="cd-main"><small>${esc(label)}</small><b>${esc(value)}</b></span>
      <span class="cd-acts">${actions}</span></div>`;
  el.innerHTML = `
    ${bar('Névjegyek')}
    <div class="contact-head">
      <span class="avatar big" aria-hidden="true">${esc(initials(c.name)) || '👤'}</span>
      <h2>${esc(c.name)}</h2>
      ${c.org ? `<p>${esc(c.org)}</p>` : ''}
    </div>
    <div class="cd-card">
      ${c.phones.map(p => row('📞', p.type || 'Telefon', p.value, '')).join('')}
      ${c.emails.map(m => row('✉️', m.type || 'E-mail', m.value, `<a class="btn small" href="mailto:${encodeURIComponent(m.value)}">Levél</a>`)).join('')}
      ${c.addresses.map(a => row('📍', a.type || 'Cím', a.value,
        `<a class="btn small" href="https://maps.apple.com/?q=${encodeURIComponent(a.value)}">Térkép</a>`)).join('')}
      ${c.note ? row('📝', 'Megjegyzés', c.note, '') : ''}
      ${!c.phones.length && !c.emails.length && !c.addresses.length && !c.note ? '<p class="hint">Ehhez a névjegyhez nincs más adat.</p>' : ''}
    </div>`;
  return wire(el, ctx);
}

function renderNew(el, ctx, bar) {
  el.innerHTML = `
    ${bar('Mégse')}
    <form class="stack" id="cform" novalidate>
      <h2>Új névjegy a Gmailbe</h2>
      <div class="row2">
        <label class="field"><span>Vezetéknév</span><input id="c-family" autocomplete="off" maxlength="80"></label>
        <label class="field"><span>Keresztnév</span><input id="c-given" autocomplete="off" maxlength="80"></label>
      </div>
      <label class="field"><span>Telefon</span><input id="c-phone" type="tel" inputmode="tel" autocomplete="off" maxlength="40" placeholder="+36 30 123 4567"></label>
      <label class="field"><span>E-mail</span><input id="c-email" type="email" inputmode="email" autocapitalize="off" autocomplete="off" maxlength="120"></label>
      <label class="field"><span>Cég</span><input id="c-org" autocomplete="off" maxlength="120"></label>
      <label class="field"><span>Cím</span><input id="c-address" autocomplete="off" maxlength="200"></label>
      <label class="field"><span>Megjegyzés</span><textarea id="c-note" class="note2" rows="2" maxlength="1000"></textarea></label>
      <p class="error" id="c-err" role="alert" hidden></p>
      <button class="btn primary" id="c-save">Névjegy mentése</button>
    </form>`;
  const $ = id => el.querySelector('#' + id);
  $('cform').addEventListener('submit', async e => {
    e.preventDefault();
    const v = id => $(id).value.trim();
    const c = { family: v('c-family'), given: v('c-given'), phone: v('c-phone'), email: v('c-email'), org: v('c-org'), address: v('c-address'), note: v('c-note') };
    const err = msg => { $('c-err').textContent = msg; $('c-err').hidden = false; };
    if (!c.family && !c.given && !c.org) return err('Adj meg legalább egy nevet (vagy cégnevet).');
    if (!c.phone && !c.email) return err('Adj meg legalább egy telefonszámot vagy e-mail-címet.');
    if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) return err('Az e-mail-cím formátuma nem jó.');
    $('c-save').disabled = true;
    try {
      const saved = await gc.createContact(c);
      toast('Névjegy elmentve a Gmailbe');
      ctx.go('contacts', { contact: saved.id });
    } catch (ex) {
      $('c-save').disabled = false;
      if (ex instanceof gc.AuthError) { toast('Lejárt a Google-belépés – lépj be újra'); ctx.go('contacts'); }
      else err('A mentés nem sikerült. Ellenőrizd az internetkapcsolatot, és próbáld újra.');
    }
  });
  return wire(el, ctx);
}

function wire(el, ctx, gmail) {
  el.addEventListener('click', e => {
    const b = e.target.closest('button[data-act], button[data-id]');
    if (!b) return;
    const act = b.dataset.act;
    if (b.dataset.id) ctx.go('contacts', { contact: b.dataset.id });
    else if (act === 'back') ctx.state.contact ? ctx.go('contacts', { keepScroll: false }) : ctx.go('home');
    else if (act === 'settings') ctx.go('settings');
    else if (act === 'login' || act === 'switch') gc.signIn(gmail);
    else if (act === 'reload') ctx.go('contacts', { contactsForce: true });
    else if (act === 'new') ctx.go('contacts', { contact: 'new' });
    else if (act === 'logout') { gc.signOut(); toast('Kijelentkeztél a Gmail-névjegyzékből'); ctx.go('contacts'); }
  });
}
