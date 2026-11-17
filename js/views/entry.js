import * as db from '../db.js';
import { ft, dayKey, timeStr, esc, groupDigits } from '../format.js';
import { toast, confirmDialog } from '../ui.js';

// Az utoljára használt típus és kategória megmarad a következő rögzítéshez.
const last = { type: 'income', cat: { income: null, expense: null } };

export async function renderEntry(el, ctx) {
  let [cats, clients] = await Promise.all([db.getCategories(), db.getClients()]);
  const editing = ctx.state.editId ? await db.getTx(ctx.state.editId) : null;

  let type = editing?.type ?? last.type;
  const clientCat = cats.find(c => c.type === 'income' && c.isClientPayment && !c.archived);
  const picked = { income: last.cat.income ?? clientCat?.id ?? null, expense: last.cat.expense };
  if (editing) picked[editing.type] = editing.categoryId;

  const when = editing ? new Date(editing.timestamp) : new Date();
  const preset = ctx.state.presetDay;
  if (!editing && preset) when.setFullYear(preset.getFullYear(), preset.getMonth(), preset.getDate());

  el.innerHTML = `
    <form class="stack" novalidate>
      <div class="seg" role="group" aria-label="Tétel típusa">
        <button type="button" data-type="income">Bevétel</button>
        <button type="button" data-type="expense">Kiadás</button>
      </div>

      <label class="field">
        <span>Összeg</span>
        <div class="amount-wrap">
          <input id="amount" inputmode="numeric" autocomplete="off" placeholder="0"
                 value="${editing ? groupDigits(editing.amount) : ''}">
          <span aria-hidden="true">Ft</span>
        </div>
      </label>

      <div class="field">
        <span id="cat-label"></span>
        <div class="chips" id="chips" role="group" aria-labelledby="cat-label"></div>
        <div class="inline-add" id="newcat" hidden>
          <label class="sr-only" for="newcat-name">Új típus neve</label>
          <input id="newcat-name" type="text" maxlength="40" autocomplete="off" placeholder="pl. Parkolás">
          <button type="button" class="btn" id="newcat-add">Hozzáadás</button>
        </div>
      </div>

      <label class="field" id="client-row" hidden>
        <span>Ügyfél neve</span>
        <input id="client" type="text" list="client-list" maxlength="80" autocomplete="off"
               value="${esc(editing?.clientName)}">
        <datalist id="client-list">${clients.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
      </label>

      <div class="row2">
        <label class="field"><span>Dátum</span><input id="date" type="date" value="${dayKey(when)}"></label>
        <label class="field"><span>Időpont</span><input id="time" type="time" value="${timeStr(when)}"></label>
      </div>

      <label class="field">
        <span>Megjegyzés</span>
        <input id="note" type="text" maxlength="200" autocomplete="off" value="${esc(editing?.note)}">
      </label>

      <p class="error" id="err" role="alert" hidden></p>

      <button class="btn primary" id="save"></button>
      ${editing ? `
        <button type="button" class="btn danger-ghost" id="del">Tétel törlése</button>
        <button type="button" class="btn ghost" id="cancel">Mégse</button>` : ''}
    </form>`;

  const form = el.querySelector('form');
  const $ = id => el.querySelector('#' + id);

  const showErr = msg => { $('err').textContent = msg; $('err').hidden = false; };
  const clearErr = () => { $('err').hidden = true; };

  function paint() {
    form.dataset.type = type;
    for (const b of form.querySelectorAll('.seg button')) b.setAttribute('aria-pressed', b.dataset.type === type);
    $('cat-label').textContent = type === 'income' ? 'Bevételi forrás' : 'Költségtípus';

    const list = cats.filter(c => c.type === type && (!c.archived || c.id === picked[type]));
    if (!list.some(c => c.id === picked[type])) picked[type] = null;
    $('chips').innerHTML =
      list.map(c => `<button type="button" class="chip" data-cat="${c.id}" aria-pressed="${c.id === picked[type]}">${esc(c.name)}</button>`).join('') +
      `<button type="button" class="chip add" id="addcat">+ Új ${type === 'income' ? 'forrás' : 'típus'}</button>`;

    const cat = cats.find(c => c.id === picked[type]);
    $('client-row').hidden = !(type === 'income' && cat?.isClientPayment);
    $('save').textContent = editing ? 'Módosítás mentése' : type === 'income' ? 'Bevétel mentése' : 'Kiadás mentése';
    $('newcat').hidden = true;
    $('newcat-name').value = '';
  }
  paint();

  async function addCategory() {
    const name = $('newcat-name').value.trim();
    if (!name) return showErr(`Írd be az új ${type === 'income' ? 'bevételi forrás' : 'költségtípus'} nevét.`);
    const cat = await db.addCategory(type, name);
    cats = await db.getCategories();
    picked[type] = cat.id;
    clearErr();
    paint();
  }

  $('amount').addEventListener('input', e => { e.target.value = groupDigits(e.target.value); });
  form.addEventListener('input', clearErr);

  $('newcat-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addCategory(); }
  });

  form.addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.type) { type = b.dataset.type; clearErr(); paint(); }
    else if (b.dataset.cat) { picked[type] = b.dataset.cat; clearErr(); paint(); }
    else if (b.id === 'addcat') { $('newcat').hidden = false; $('newcat-name').focus(); }
    else if (b.id === 'newcat-add') addCategory();
    else if (b.id === 'cancel') ctx.go('day', { day: new Date(editing.timestamp) });
    else if (b.id === 'del') {
      const yes = await confirmDialog({
        title: 'Törlöd ezt a tételt?',
        text: `${ft(editing.amount)} – a törlés nem vonható vissza.`,
        ok: 'Tétel törlése',
      });
      if (!yes) return;
      await db.deleteTx(editing.id);
      toast('Tétel törölve');
      ctx.go('day', { day: new Date(editing.timestamp) });
    }
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const amount = parseInt($('amount').value.replace(/\D/g, ''), 10);
    if (!amount) { $('amount').focus(); return showErr('Írd be az összeget.'); }
    if (!picked[type]) return showErr(type === 'income' ? 'Válassz bevételi forrást.' : 'Válassz költségtípust.');
    const ts = new Date(`${$('date').value}T${$('time').value}`);
    if (!$('date').value || !$('time').value || isNaN(ts)) return showErr('Add meg a dátumot és az időpontot.');

    const cat = cats.find(c => c.id === picked[type]);
    const clientName = type === 'income' && cat?.isClientPayment ? $('client').value.trim() : '';

    $('save').disabled = true;
    await db.saveTx({
      id: editing?.id ?? db.uid(),
      type,
      amount,
      categoryId: cat.id,
      clientName,
      note: $('note').value.trim(),
      timestamp: ts.getTime(),
      createdAt: editing?.createdAt ?? Date.now(),
    });
    if (clientName) await db.addClient(clientName);

    last.type = type;
    last.cat[type] = cat.id;

    if (editing) {
      toast('Módosítás elmentve');
      ctx.go('day', { day: ts });
    } else {
      toast(`${type === 'income' ? 'Bevétel' : 'Kiadás'} elmentve: ${ft(amount)}`);
      ctx.go('entry');
    }
  });
}
