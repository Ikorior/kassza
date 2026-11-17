import * as db from '../db.js';

const MESSAGES = {
  'auth/invalid-credential': 'Hibás e-mail-cím vagy jelszó.',
  'auth/wrong-password': 'Hibás e-mail-cím vagy jelszó.',
  'auth/user-not-found': 'Hibás e-mail-cím vagy jelszó.',
  'auth/invalid-email': 'Ez nem érvényes e-mail-cím.',
  'auth/too-many-requests': 'Túl sok sikertelen próbálkozás. Várj néhány percet, majd próbáld újra.',
  'auth/network-request-failed': 'Nincs internetkapcsolat. A belépéshez csatlakozz a hálózatra.',
  'auth/user-disabled': 'Ez a fiók le van tiltva.',
};

export function renderLogin(el) {
  el.innerHTML = `
    <form class="stack" novalidate>
      <p class="hint">Lépj be a közös fiókkal. A telefon megjegyzi a belépést, legközelebb nem kell újra megadni.</p>
      <label class="field">
        <span>E-mail-cím</span>
        <input id="email" type="email" inputmode="email" autocomplete="username" autocapitalize="none" spellcheck="false">
      </label>
      <label class="field">
        <span>Jelszó</span>
        <input id="password" type="password" autocomplete="current-password">
      </label>
      <p class="error" id="err" role="alert" hidden></p>
      <button class="btn primary" id="login">Belépés</button>
    </form>`;

  const form = el.querySelector('form');
  const err = el.querySelector('#err');
  const button = el.querySelector('#login');

  form.addEventListener('input', () => { err.hidden = true; });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const email = el.querySelector('#email').value.trim();
    const password = el.querySelector('#password').value;
    if (!email || !password) {
      err.textContent = 'Add meg az e-mail-címet és a jelszót.';
      err.hidden = false;
      return;
    }
    button.disabled = true;
    button.textContent = 'Belépés folyamatban…';
    try {
      await db.signIn(email, password); // siker esetén az app magától továbblép
    } catch (error) {
      err.textContent = MESSAGES[error.code] ?? 'A belépés nem sikerült. Próbáld újra.';
      err.hidden = false;
      button.disabled = false;
      button.textContent = 'Belépés';
    }
  });
}
