/* =========================================================================
   APP — routage, rendu des tableaux, fiche de ligne.
   ========================================================================= */

Store.init();

const $ = (s, r = document) => r.querySelector(s);
const el = { nav: $('#nav'), view: $('#view'), tools: $('#tools'), modal: $('#modal') };

/** Échappement HTML. Toute donnée saisie passe par là avant d'être peinte. */
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Unique point d'injection de balisage de l'application.
 * Le balisage est écrit par l'appli ; les valeurs saisies y arrivent
 * obligatoirement via esc(). Aucune autre fonction ne construit de DOM à
 * partir d'une chaîne — un seul endroit à auditer.
 */
function paint(node, html) {
  const range = document.createRange();
  range.selectNodeContents(node);
  node.replaceChildren(range.createContextualFragment(html));
}

let current = ACCUEIL;
let filter = '';

/* ============================== ROUTAGE ================================= */

function route() {
  const id = location.hash.replace(/^#\/?/, '');
  current = TABLES[id] ? id : ACCUEIL;
  filter = '';
  render();
  toggleNav(false);
  el.view.scrollTop = 0;
}

function go(id) { location.hash = '#/' + id; }

/* ============================== RENDU ==================================== */

function renderNav() {
  paint(el.nav, NAV.map((g) => `
    ${g.label ? `<div class="navgroup"><div class="navgroup__label">${esc(g.label)}</div></div>` : ''}
    ${g.items.map((it) => `
      <button type="button" class="navlink" data-go="${esc(it.id)}" aria-current="${current === it.id}">
        <span>${esc(it.label)}</span>
      </button>`).join('')}
  `).join(''));
}

function render() {
  renderNav();
  renderTable(TABLES[current]);
}

function setCrumb(machine, view) {
  $('#crumbMachine').textContent = machine;
  $('#crumbView').textContent = view;
  document.title = machine + ' — Maintenance Atelier';
}

/* --------------------------------------------------------------- TABLE --- */

function cellHtml(col, row, i) {
  const v = row[col.key] ?? '';
  const cls = 'cell' + (col.type === 'num' ? ' cell--num' : '')
    + (col.type === 'date' ? ' cell--date' + (v ? '' : ' is-empty') : '');
  const at = `data-k="${esc(col.key)}" data-i="${i}"`;

  switch (col.type) {
    case 'select':
      return `<select class="${cls}" ${at}><option value=""></option>${col.options.map((o) =>
        `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    case 'date':
      return `<input type="date" class="${cls}" ${at} value="${esc(v)}">`;
    case 'num':
      return `<input type="text" inputmode="decimal" class="${cls}" ${at} value="${esc(v)}">`;
    default:
      return `<input type="text" class="${cls}" ${at} value="${esc(v)}" title="${esc(v)}">`;
  }
}

function rowHtml(spec, row, i) {
  let left = 44;
  const tds = spec.columns.map((c, ci) => {
    const isLastStick = c.stick && spec.columns[ci + 1] && !spec.columns[ci + 1].stick;
    const cls = [c.stick ? 'stick' : '', isLastStick ? 'stick--last' : ''].filter(Boolean).join(' ');
    const style = c.stick ? ` style="left:${left}px"` : '';
    if (c.stick) left += c.w;
    return `<td class="${cls}"${style}>${cellHtml(c, row, i)}</td>`;
  }).join('');
  return `<tr data-i="${i}">
    <td class="stick" style="left:0">
      <button type="button" class="rowbtn" data-edit="${i}" title="Ouvrir la fiche">${i + 1}</button>
    </td>${tds}</tr>`;
}

function headHtml(spec) {
  let left = 44;
  const ths = spec.columns.map((c) => {
    const style = c.stick ? ` style="left:${left}px"` : '';
    if (c.stick) left += c.w;
    return `<th${c.stick ? ' class="stick"' : ''}${style}>${esc(c.label)}</th>`;
  }).join('');
  return `<thead><tr class="heads"><th class="stick" style="left:0">#</th>${ths}</tr></thead>`;
}

function matches(spec, row) {
  if (!filter) return true;
  const q = filter.toLowerCase();
  return spec.columns.some((c) => String(row[c.key] ?? '').toLowerCase().includes(q));
}

function renderTable(spec) {
  setCrumb(spec.machine, spec.title);

  paint(el.tools, `
    <label class="search"><input type="search" id="q" aria-label="Rechercher dans le tableau"
      placeholder="Rechercher…" value="${esc(filter)}" autocomplete="off"></label>
    <button type="button" class="btn btn--signal" id="btnAdd">+ Ligne</button>
    <button type="button" class="btn btn--icon" id="btnCsv" title="Export CSV pour Excel">CSV</button>
    <button type="button" class="btn btn--icon" data-print title="Imprimer le tableau">Imprimer</button>`);

  const rows = Store.rows(spec.id);
  const visible = rows.map((r, i) => [r, i]).filter((p) => matches(spec, p[0]));

  // Chaque colonne porte sa largeur en pixels et la même en proportion : sur
  // tablette en portrait, la feuille de style bascule sur --p pour que les
  // colonnes tiennent toutes à l'écran sans défilement latéral.
  const largeurs = [{ w: 44 }, ...spec.columns];
  const total = largeurs.reduce((s, c) => s + c.w, 0);
  const cols = largeurs.map((c) =>
    `<col style="width:${c.w}px; --p:${(c.w / total * 100).toFixed(3)}%">`).join('');

  paint(el.view, `
    <section class="panel">
      <div class="panel__head">
        <h2>${esc(spec.title)}</h2>
        <p>${esc(spec.subtitle)}</p>
      </div>
      <div class="tablewrap">
        <table class="grid">
          <colgroup>${cols}</colgroup>
          ${headHtml(spec)}
          <tbody id="tb">${visible.map((p) => rowHtml(spec, p[0], p[1])).join('')}</tbody>
        </table>
        ${visible.length ? '' : `<div class="empty"><strong>Aucune ligne</strong>
          ${rows.length ? 'Aucun résultat pour ce filtre.' : `Rien de consigné pour l'instant.
            <div style="margin-top:14px"><button type="button" class="btn btn--signal" data-addrow>Ajouter un ${esc(spec.rowLabel)}</button></div>`}
        </div>`}
      </div>
      <div class="panel__foot">
        <span>${visible.length} / ${rows.length} ligne${rows.length > 1 ? 's' : ''}</span>
        <span class="foot-note">Enregistrement automatique dans ce navigateur</span>
      </div>
    </section>`);

  bindTable(spec);
}

/* --------------------------------------------------------- INTERACTION --- */

function bindTable(spec) {
  const tb = $('#tb');

  const write = (e) => {
    const t = e.target;
    if (!t.dataset || !t.dataset.k) return;
    Store.set(spec.id, +t.dataset.i, t.dataset.k, t.value);
    if (t.tagName === 'INPUT' && t.type === 'text') t.title = t.value;
    if (t.classList.contains('cell--date')) t.classList.toggle('is-empty', !t.value);
  };
  tb.addEventListener('input', write);
  tb.addEventListener('change', write);

  tb.addEventListener('click', (e) => {
    const edit = e.target.closest('[data-edit]');
    if (edit) openRow(spec, +edit.dataset.edit);
  });

  // Entrée / flèches : on descend d'une ligne dans la même colonne, comme dans
  // un tableur. Tab passe à la colonne suivante, c'est le comportement natif.
  tb.addEventListener('keydown', (e) => {
    const t = e.target;
    if (!t.dataset || !t.dataset.k) return;
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && !(e.key === 'Enter' && t.tagName !== 'SELECT')) return;
    const sib = e.key === 'ArrowUp' ? t.closest('tr').previousElementSibling : t.closest('tr').nextElementSibling;
    if (!sib) return;
    const target = sib.querySelector(`[data-k="${t.dataset.k}"]`);
    if (!target) return;
    e.preventDefault();
    target.focus();
    if (target.select) { try { target.select(); } catch (_) { /* type=date */ } }
  });

  $('#q').addEventListener('input', (e) => {
    filter = e.target.value;
    const pos = e.target.selectionStart;
    renderTable(spec);
    const q = $('#q');
    q.focus();
    try { q.setSelectionRange(pos, pos); } catch (_) { /* type=search */ }
  });

  // Ligne ajoutée en tête, curseur posé sur la première case vide : on
  // enchaîne la saisie sans toucher la souris.
  const addRow = () => {
    const row = spec.addRow ? spec.addRow() : {};
    let i;
    if (spec.prepend) { Store.insert(spec.id, 0, row); i = 0; }
    else i = Store.add(spec.id, row);
    filter = '';
    renderTable(spec);
    const tr = $(`#tb tr[data-i="${i}"]`);
    if (!tr) return;
    const cells = [...tr.querySelectorAll('[data-k]')];
    const target = cells.find((c) => !c.value) || cells[0];
    if (target) target.focus();
  };
  $('#btnAdd').addEventListener('click', addRow);
  const cta = el.view.querySelector('[data-addrow]');
  if (cta) cta.addEventListener('click', addRow);

  $('#btnCsv').addEventListener('click', () => { Store.exportCsv(spec.id); toast('Export CSV généré'); });
}

/* ------------------------------------------------------ FICHE DE LIGNE --- */

/* Le tableau suffit pour saisir. La fiche sert à voir une ligne en entier sur
   un petit écran, et c'est le seul endroit d'où l'on supprime une ligne. */
function openRow(spec, i) {
  const row = Store.rows(spec.id)[i];
  if (!row) return;

  const field = (c) => {
    const v = esc(row[c.key] ?? '');
    const id = 'f_' + c.key;
    const k = esc(c.key);
    let input;
    switch (c.type) {
      case 'select':
        input = `<select id="${id}" data-k="${k}"><option value=""></option>${c.options.map((o) =>
          `<option${o === row[c.key] ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
        break;
      case 'long': input = `<textarea id="${id}" data-k="${k}">${v}</textarea>`; break;
      case 'date': input = `<input type="date" id="${id}" data-k="${k}" value="${v}">`; break;
      case 'num':  input = `<input type="text" inputmode="decimal" id="${id}" data-k="${k}" value="${v}">`; break;
      default:     input = `<input type="text" id="${id}" data-k="${k}" value="${v}">`;
    }
    return `<div class="field"><label for="${id}">${esc(c.label)}</label>${input}</div>`;
  };

  el.modal.hidden = false;
  paint(el.modal, `
    <div class="modal__box" role="dialog" aria-modal="true" aria-label="Fiche ${esc(spec.rowLabel)}">
      <div class="modal__head">
        <h2>${esc(spec.rowLabel)} n°${i + 1}</h2>
        <button type="button" class="btn btn--icon" style="margin-left:auto" data-close>Fermer</button>
      </div>
      <div class="modal__body" id="mbody">
        <div class="fieldset">${spec.columns.map(field).join('')}</div>
      </div>
      <div class="modal__foot">
        <button type="button" class="btn btn--danger" data-del>Supprimer la ligne</button>
        <button type="button" class="btn btn--primary" data-close>Terminé</button>
      </div>
    </div>`);

  const sync = (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.k) Store.set(spec.id, i, t.dataset.k, t.value);
  };
  $('#mbody').addEventListener('input', sync);
  $('#mbody').addEventListener('change', sync);

  el.modal.onclick = (e) => {
    if (e.target.closest('[data-del]')) {
      if (confirm(`Supprimer définitivement la ligne n°${i + 1} ?`)) {
        Store.remove(spec.id, i);
        closeModal();
        toast('Ligne supprimée');
      }
      return;
    }
    if (e.target === el.modal || e.target.closest('[data-close]')) closeModal();
  };
}

function closeModal() {
  el.modal.hidden = true;
  el.modal.onclick = null;
  paint(el.modal, '');
  render();
}

/* ------------------------------------------------------------- DIVERS --- */

let toastT = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, 2600);
}

function updateStorageNote() {
  const d = Store.updatedAt();
  $('#storageNote').textContent = d
    ? 'Dernière écriture ' + d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
    : 'Aucune donnée enregistrée';
}

Store.onState((s) => {
  const box = $('#saver');
  box.dataset.state = s;
  box.querySelector('span').textContent = s === 'dirty' ? 'Saisie…' : 'Enregistré';
  if (s === 'saved') updateStorageNote();
});

function toggleNav(open) {
  document.body.classList.toggle('nav-open', open);
  $('#scrim').hidden = !open;
  $('#burger').setAttribute('aria-expanded', String(open));
}

/* ------------------------------------------------------------ GLOBALS --- */

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-print]')) { window.print(); return; }
  const g = e.target.closest('[data-go]');
  if (g) go(g.dataset.go);
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!el.modal.hidden) closeModal();
  else if (document.body.classList.contains('nav-open')) toggleNav(false);
});

$('#burger').addEventListener('click', () => toggleNav(!document.body.classList.contains('nav-open')));
$('#scrim').addEventListener('click', () => toggleNav(false));

$('#btnBackup').addEventListener('click', () => { Store.backup(); toast('Sauvegarde téléchargée'); });
$('#btnRestore').addEventListener('click', () => $('#fileRestore').click());
$('#fileRestore').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  if (!confirm('Remplacer toutes les données actuelles par le contenu de ce fichier ?')) { e.target.value = ''; return; }
  try {
    await Store.restore(f);
    render();
    updateStorageNote();
    toast('Sauvegarde restaurée');
  } catch (err) {
    alert('Restauration impossible : ' + err.message);
  }
  e.target.value = '';
});

window.addEventListener('hashchange', route);
updateStorageNote();
route();
