let toastTimer;

export function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// Tájékoztató ablak listával (pl. névnapos ügyfelek); a Bezárás gombbal zárul.
export function infoDialog({ title, text, items }) {
  const d = document.getElementById('info');
  if (!d || d.open || document.getElementById('confirm')?.open) return;
  d.querySelector('#info-title').textContent = title;
  d.querySelector('#info-text').textContent = text;
  const list = d.querySelector('#info-list');
  list.replaceChildren(...items.map(t => Object.assign(document.createElement('li'), { textContent: t })));
  d.showModal();
}

// Megerősítő párbeszédablak; true, ha a felhasználó a műveletet választotta.
export function confirmDialog({ title, text, ok }) {
  const d = document.getElementById('confirm');
  d.querySelector('#confirm-title').textContent = title;
  d.querySelector('#confirm-text').textContent = text;
  d.querySelector('#confirm-ok').textContent = ok;
  const okBtn = d.querySelector('#confirm-ok');
  const cancelBtn = d.querySelector('button[value="cancel"]');
  d.showModal();
  return new Promise(resolve => {
    const finish = value => e => {
      e.preventDefault();
      if (d.open) d.close();
      resolve(value);
    };
    okBtn.onclick = finish(true);
    cancelBtn.onclick = finish(false);
    d.oncancel = finish(false); // Esc billentyű
  });
}
