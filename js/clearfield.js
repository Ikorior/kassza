// Törlő gomb (ⓧ) minden szöveges beviteli mezőhöz: amíg a mező aktív és van benne szöveg,
// a jobb szélén megjelenik egy kis kör alakú x, amely egy koppintással kiüríti a mezőt.
// Egyetlen, a képernyőn lebegő gomb szolgál ki minden mezőt, így az egyes nézetek
// HTML-jéhez nem kell hozzányúlni.

const TEXT_TYPES = new Set(['text', 'search', 'email', 'tel', 'url', 'number', 'password', '']);
const isClearable = el =>
  el instanceof HTMLTextAreaElement
  || (el instanceof HTMLInputElement && TEXT_TYPES.has((el.getAttribute('type') ?? '').toLowerCase()));

export function initClearButtons() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'clear-x';
  btn.setAttribute('aria-label', 'Mező kiürítése');
  btn.innerHTML = '<span aria-hidden="true">×</span>';
  btn.hidden = true;
  let field = null;

  const place = () => {
    if (!field || !field.isConnected || field.readOnly || field.disabled || !field.value) {
      btn.hidden = true;
      return;
    }
    // Párbeszédablakban (dialog) a gombnak is az ablakban kell lennie, különben alatta maradna.
    const host = field.closest('dialog[open]') ?? document.body;
    if (btn.parentNode !== host) host.append(btn);
    const r = field.getBoundingClientRect();
    const size = 32;
    const top = field instanceof HTMLTextAreaElement ? r.top + 4 : r.top + (r.height - size) / 2;
    btn.style.top = `${Math.round(top)}px`;
    btn.style.left = `${Math.round(r.right - size - 4)}px`;
    btn.hidden = false;
  };

  document.addEventListener('focusin', e => {
    if (field) field.classList.remove('has-clear');
    field = isClearable(e.target) ? e.target : null;
    if (field) field.classList.add('has-clear');
    place();
  });
  document.addEventListener('focusout', e => {
    if (e.target !== field) return;
    // Kis késleltetés: a gombra koppintás még elérje a mezőt.
    setTimeout(() => {
      if (document.activeElement === field) return;
      field?.classList.remove('has-clear');
      field = null;
      btn.hidden = true;
    }, 0);
  });
  document.addEventListener('input', e => { if (e.target === field) place(); });
  document.addEventListener('scroll', place, true);
  window.addEventListener('resize', place);
  window.visualViewport?.addEventListener('resize', place);
  window.visualViewport?.addEventListener('scroll', place);

  // A gomb ne vegye el a fókuszt (a billentyűzet maradjon nyitva).
  btn.addEventListener('pointerdown', e => e.preventDefault());
  btn.addEventListener('mousedown', e => e.preventDefault());
  btn.addEventListener('click', () => {
    if (!field) return;
    field.value = '';
    // A nézetek figyelik a mező változását (keresés, összeg formázása stb.).
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    field.focus();
    place();
  });
}
