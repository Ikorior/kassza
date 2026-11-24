import * as db from '../db.js';
import { dayKey, dateTimeLabel, esc } from '../format.js';
import { toast, confirmDialog } from '../ui.js';
import * as display from '../display.js';
import { monthStartDay, setMonthStartDay, startDayText } from '../period.js';

const capFirst = t => t.charAt(0).toLocaleUpperCase('hu') + t.slice(1);

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

async function saveBackup() {
  const data = await db.exportAll();
  const name = `kassza-mentes-${dayKey(new Date())}.json`;
  const json = JSON.stringify(data, null, 2);
  const file = new File([json], name, { type: 'application/json' });

  // Telefonon a megosztás panel (Fájlokba mentés, iCloud, e-mail); gépen sima letöltés.
  const touch = window.matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
    } catch (err) {
      if (err.name === 'AbortError') return false;
      download(file, name);
    }
  } else {
    download(file, name);
  }
  await db.setMeta('lastBackup', Date.now());
  return true;
}

function download(file, name) {
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function renderSettings(el, ctx) {
  const [cats, count, lastBackup] = await Promise.all([db.getCategories(), db.txCount(), db.getMeta('lastBackup')]);

  const block = (type, heading, noun, hint) => `
    <section>
      <h2>${heading}</h2>
      <ul class="list">${cats.filter(c => c.type === type).map(c => `
        <li class="cat-row ${c.archived ? 'archived' : ''}">
          <input type="text" maxlength="40" autocomplete="off" data-rename="${c.id}" value="${esc(c.name)}"
                 aria-label="${esc(c.name)} – ${noun} neve" ${c.archived ? 'disabled' : ''}>
          <button type="button" class="btn small ghost" data-toggle="${c.id}">${c.archived ? 'Visszaállítás' : 'Elrejtés'}</button>
        </li>`).join('')}</ul>
      <form class="inline-add" data-add="${type}" novalidate>
        <label class="sr-only" for="add-${type}">Új ${noun} neve</label>
        <input id="add-${type}" type="text" maxlength="40" autocomplete="off" placeholder="${hint}">
        <button class="btn">Hozzáadás</button>
      </form>
    </section>`;

  const scaleSetting = display.getSetting();
  const monthStart = await monthStartDay();
  const gmail = String((await db.getShared('gmailContacts')) ?? '');
  // A verziószám az offline tároló nevéből jön (sw.js → CACHE), így nem kell külön karbantartani.
  let version = null;
  try {
    version = (await caches.keys()).find(k => k.startsWith('kassza-v'))?.slice('kassza-v'.length) ?? null;
  } catch { /* nincs offline tároló */ }

  el.innerHTML = `
    <section>
      <h2>Pénzügyi hónap</h2>
      <label class="field">
        <span>A hónap kezdőnapja</span>
        <select id="month-start">
          ${Array.from({ length: 28 }, (_, i) => i + 1).map(d =>
            `<option value="${d}" ${d === monthStart ? 'selected' : ''}>${d === 1 ? '1. (naptári hónap)' : `${d}.`}</option>`).join('')}
        </select>
      </label>
      <p class="hint" id="month-start-hint" style="margin-top:0.5rem">${capFirst(startDayText(monthStart))}. A Havi és a Grafikon lap ehhez igazodik${db.cloud ? ', mindkét telefonon' : ''}.</p>
    </section>

    <section>
      <h2>Gmail névjegyzék</h2>
      <label class="field">
        <span>Gmail-fiók címe</span>
        <input id="gmail" type="email" inputmode="email" autocomplete="off" autocapitalize="off" spellcheck="false"
               maxlength="120" placeholder="pl. partnerek@gmail.com" value="${esc(gmail)}">
      </label>
      <p class="hint" id="gmail-hint" style="margin-top:0.5rem">A Főoldal „Gmail névjegyzék” kártyája ennek a fióknak a névjegyeit mutatja az appon belül${db.cloud ? ' (mindkét telefonon)' : ''}. Első megnyitáskor telefononként egyszer be kell jelentkezni a fiókba.</p>
    </section>

    <section>
      <h2>Megjelenítés mérete</h2>
      <div class="scale-row">
        <input type="range" id="scale" min="${display.MIN}" max="${display.MAX}" step="5"
               value="${display.currentPercent()}" aria-label="Megjelenítés mérete" aria-describedby="scale-hint">
        <output id="scale-val" for="scale">${display.currentPercent()}%</output>
      </div>
      <label class="check">
        <input type="checkbox" id="scale-auto" ${scaleSetting === 'auto' ? 'checked' : ''}>
        Automatikus (a képernyőmérethez igazodik)
      </label>
      <p class="hint" id="scale-hint">Csak ezen a telefonon érvényes. Ha az Új tétel oldalt görgetni kell, vedd lejjebb; ha túl apró, vedd feljebb.</p>
    </section>

    ${block('income', 'Bevételi források', 'bevételi forrás', 'pl. Borravaló')}
    ${block('expense', 'Költségtípusok', 'költségtípus', 'pl. Parkolás')}
    <p class="hint" style="margin-top:10px">A név átírható. Az elrejtett típus új tételnél nem választható, a korábbi tételek megmaradnak.</p>

    ${db.cloud ? `
    <section>
      <h2>Fiók és felhő</h2>
      <p>Belépve: <strong>${esc(db.userEmail())}</strong></p>
      <p class="hint">${db.syncPending()
        ? 'Vannak még fel nem töltött tételek – amint lesz internetkapcsolat, maguktól felkerülnek a felhőbe.'
        : 'Minden tétel fel van töltve a felhőbe. Aki ezzel a fiókkal lép be, ugyanezeket az adatokat látja.'}</p>
      <p class="hint">A beállítások (megjelenítés mérete, hónap kezdőnapja) telefononként külön mentődnek a felhőbe. Ez a telefon: ${Math.min(screen.width, screen.height)}×${Math.max(screen.width, screen.height)} képernyő.</p>
      <div class="actions"><button type="button" class="btn" id="logout">Kijelentkezés</button></div>
    </section>` : ''}

    <section>
      <h2>Biztonsági mentés</h2>
      <p>${count} rögzített tétel van ${db.cloud ? 'a fiókban' : 'a készüléken'}.
         ${lastBackup ? `Utolsó fájlmentés: ${dateTimeLabel(new Date(lastBackup))}.` : 'Még nem készült fájlmentés.'}</p>
      <p class="hint">${db.cloud
        ? 'Az adatok a felhőben vannak, telefoncsere után belépéssel visszajönnek. Külön másolatnak időnként fájlba is mentheted őket.'
        : 'Az adatok csak ezen a telefonon vannak. Ha törlöd az appot vagy a Safari webhelyadatait, elvesznek – ezért érdemes rendszeresen fájlba menteni.'}</p>
      <div class="actions">
        <button type="button" class="btn primary" id="backup">Mentés fájlba</button>
        <button type="button" class="btn" id="restore">Visszatöltés fájlból</button>
        <input type="file" id="restore-file" accept=".json,application/json" hidden>
      </div>
      <p class="error" id="restore-err" role="alert" hidden style="margin-top:10px"></p>
    </section>

    <!-- IDEIGLENES: a tesztidőszak után kivenni (gomb + kezelő lent, id="wipe"). -->
    <section>
      <h2>Tesztadatok törlése</h2>
      <p class="hint">Törli az összes rögzített tételt és ügyfélnevet${db.cloud ? ' a fiókból, minden belépett telefonon' : ''}. A bevételi források és költségtípusok megmaradnak.</p>
      <div class="actions"><button type="button" class="btn danger-ghost" id="wipe">Összes tétel törlése</button></div>
      <p class="error" id="wipe-err" role="alert" hidden style="margin-top:10px"></p>
    </section>

    ${isStandalone() ? '' : `
    <section>
      <h2>Telepítés iPhone-ra</h2>
      <p class="hint">Safariban koppints a Megosztás gombra, majd válaszd a „Főképernyőhöz adás” lehetőséget. Ezután az app saját ikonról, teljes képernyőn és internet nélkül is indul.</p>
    </section>`}

    <p class="foot">Kassza · ${version ? `verzió ${version}` : 'fejlesztői változat'}</p>`;

  const again = () => ctx.go('settings', { keepScroll: true });

  const scale = el.querySelector('#scale');
  const scaleVal = el.querySelector('#scale-val');
  const scaleAuto = el.querySelector('#scale-auto');
  // Pénzügyi hónap kezdőnapja (közös beállítás).
  el.querySelector('#gmail').addEventListener('change', async e => {
    const v = e.target.value.trim().toLowerCase();
    if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      toast('Ez nem érvényes e-mail-cím – nem mentettem');
      return;
    }
    e.target.value = v;
    await db.setShared('gmailContacts', v);
    toast(v ? 'Gmail-fiók elmentve' : 'Gmail-fiók törölve');
  });

  el.querySelector('#month-start').addEventListener('change', async e => {
    const day = Number(e.target.value);
    await setMonthStartDay(day);
    ctx.state.monthSet = false; // a Havi és Grafikon lap a mai napot tartalmazó hónapra álljon
    el.querySelector('#month-start-hint').textContent =
      `${capFirst(startDayText(day))}. A Havi és a Grafikon lap ehhez igazodik${db.cloud ? ', mindkét telefonon' : ''}.`;
    toast('Pénzügyi hónap módosítva');
  });

  const saveScale = () => db.setMeta(display.cloudKey(), display.getSetting()); // felhőbe
  scale.addEventListener('input', () => {
    display.setSetting(Number(scale.value)); // azonnal látszik
    scaleVal.textContent = scale.value + '%';
    scaleAuto.checked = false;
  });
  scale.addEventListener('change', saveScale); // elengedéskor mentjük
  scaleAuto.addEventListener('change', () => {
    display.setSetting(scaleAuto.checked ? 'auto' : display.currentPercent());
    scale.value = display.currentPercent();
    scaleVal.textContent = scale.value + '%';
    saveScale();
  });
  const err = el.querySelector('#restore-err');
  const fileInput = el.querySelector('#restore-file');

  el.onclick = async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.toggle) {
      const cat = cats.find(c => c.id === b.dataset.toggle);
      await db.saveCategory({ ...cat, archived: !cat.archived });
      again();
    } else if (b.id === 'backup') {
      if (await saveBackup()) { toast('Mentés elkészült'); again(); }
    } else if (b.id === 'wipe') { // IDEIGLENES
      const wipeErr = el.querySelector('#wipe-err');
      wipeErr.hidden = true;
      const yes = await confirmDialog({
        title: 'Törlöd az összes tételt?',
        text: `${count} tétel és az összes ügyfélnév törlődik${db.cloud ? ', minden belépett telefonon' : ''}. Ez nem vonható vissza.`,
        ok: 'Összes törlése',
      });
      if (!yes) return;
      try {
        await db.importAll({ transactions: [], clients: [], categories: await db.getCategories() });
      } catch (error) {
        console.error(error);
        wipeErr.textContent = db.cloud
          ? 'A törlés nem sikerült. Internetkapcsolat kell hozzá – csatlakozz a hálózatra, majd próbáld újra.'
          : 'A törlés nem sikerült. Próbáld újra.';
        wipeErr.hidden = false;
        return;
      }
      toast('Minden tétel törölve');
      again();
    } else if (b.id === 'logout') {
      const yes = await confirmDialog({
        title: 'Kijelentkezel?',
        text: db.syncPending()
          ? 'Vannak még fel nem töltött tételek. Ha most kijelentkezel, ezek elveszhetnek – előbb csatlakozz az internetre.'
          : 'Az adatok a felhőben megmaradnak, belépés után újra látod őket.',
        ok: 'Kijelentkezés',
      });
      if (yes) await db.signOut();
    } else if (b.id === 'restore') {
      err.hidden = true;
      fileInput.click();
    }
  };

  el.onchange = async e => {
    const id = e.target.dataset?.rename;
    if (!id) return;
    const cat = cats.find(c => c.id === id);
    const name = e.target.value.trim();
    if (!name) { e.target.value = cat.name; return; }
    if (name !== cat.name) {
      await db.saveCategory({ ...cat, name });
      cat.name = name;
      toast('Név módosítva');
    }
  };

  el.onsubmit = async e => {
    e.preventDefault();
    const type = e.target.dataset.add;
    const input = e.target.querySelector('input');
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    await db.addCategory(type, name);
    toast('Hozzáadva');
    again();
  };

  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      data = null;
    }
    if (!db.validateBackup(data)) {
      err.textContent = 'Ez a fájl nem a Kassza mentése. Válaszd a korábban mentett „kassza-mentes-…json” fájlt.';
      err.hidden = false;
      return;
    }
    const yes = await confirmDialog({
      title: 'Lecseréled a jelenlegi adatokat?',
      text: `A fájlban ${data.transactions.length} tétel van. A ${db.cloud ? 'fiókban' : 'készüléken'} lévő ${count} tétel helyére ezek kerülnek${db.cloud ? ', minden belépett telefonon' : ''} – ez nem vonható vissza.`,
      ok: 'Adatok lecserélése',
    });
    if (!yes) return;
    try {
      await db.importAll(data);
    } catch (error) {
      console.error(error);
      err.textContent = db.cloud
        ? 'A visszatöltés nem sikerült. Internetkapcsolat kell hozzá – csatlakozz a hálózatra, majd próbáld újra.'
        : 'A visszatöltés nem sikerült. Próbáld újra.';
      err.hidden = false;
      return;
    }
    toast(`${data.transactions.length} tétel visszatöltve`);
    again();
  };
}
