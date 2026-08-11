/* =========================================================================
   APP — routage, rendu des tableaux, fiche de ligne.
   ========================================================================= */

Store.init();

const $ = (s, r = document) => r.querySelector(s);
const el = {
  nav: $('#nav'), view: $('#view'), tools: $('#tools'),
  modal: $('#modal'), alertes: $('#alertes'),
};

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
/** Le journal peut compter des milliers d'entrées : on n'en peint qu'une
    tranche, et on l'annonce. Le bouton de l'écran lève le plafond. */
const JOURNAL_TRANCHE = 300;
let journalMax = JOURNAL_TRANCHE;

/* ============================== ROUTAGE ================================= */

/** Un écran est soit un tableau de saisie, soit une vue de suivi. */
const ecran = (id) => TABLES[id] || ECRANS[id] || null;

function route() {
  const id = location.hash.replace(/^#\/?/, '');
  current = ecran(id) ? id : ACCUEIL;
  filter = '';
  journalMax = JOURNAL_TRANCHE;
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

/** Rendus des écrans de suivi, désignés par `vue` dans le schéma. */
const VUES = { journal: renderJournal, corbeille: renderCorbeille };

function render() {
  const spec = ecran(current);
  renderNav();
  (VUES[spec.vue] || renderTable)(spec);
  renderAlertes();
}

function setCrumb(machine, view) {
  $('#crumbMachine').textContent = machine;
  $('#crumbView').textContent = view;
  document.title = machine + ' — Maintenance Atelier';
}

/* --------------------------------------------------------------- TABLE --- */

function cellHtml(col, row, i) {
  const v = row[col.key] ?? '';
  const isDate = col.type === 'date' || col.type === 'datetime';
  const cls = 'cell' + (col.type === 'num' ? ' cell--num' : '')
    + (isDate ? ' cell--date' + (v ? '' : ' is-empty') : '');
  const at = `data-k="${esc(col.key)}" data-i="${i}"`;

  switch (col.type) {
    case 'select':
      return `<select class="${cls}" ${at}><option value=""></option>${col.options.map((o) =>
        `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    case 'date':
      return `<input type="date" class="${cls}" ${at} value="${esc(v)}">`;
    case 'datetime':
      return `<input type="datetime-local" class="${cls}" ${at} value="${esc(v)}">`;
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

/* La gouttière de gauche (le « # ») n'existe que sur les tableaux de saisie :
   c'est elle qui ouvre la fiche. Les vues de suivi s'en passent, d'où le
   paramètre — le calcul des colonnes gelées reste commun. */

function headHtml(spec, num) {
  let left = num ? 44 : 0;
  const ths = spec.columns.map((c) => {
    const style = c.stick ? ` style="left:${left}px"` : '';
    if (c.stick) left += c.w;
    return `<th${c.stick ? ' class="stick"' : ''}${style}>${esc(c.label)}</th>`;
  }).join('');
  return `<thead><tr class="heads">${num ? '<th class="stick" style="left:0">#</th>' : ''}${ths}</tr></thead>`;
}

/** Chaque colonne porte sa largeur en pixels et la même en proportion : sur
    tablette en portrait, la feuille de style bascule sur --p pour que les
    colonnes tiennent toutes à l'écran sans défilement latéral. */
function colsHtml(spec, num) {
  const largeurs = num ? [{ w: 44 }, ...spec.columns] : spec.columns;
  const total = largeurTotale(spec, num);
  return largeurs.map((c) =>
    `<col style="width:${c.w}px; --p:${(c.w / total * 100).toFixed(3)}%">`).join('');
}

/** Un tableau en `table-layout: fixed` sans largeur définie retombe en calcul
    automatique et ignore le colgroup : les vues de suivi portent donc leur
    largeur, celle que le schéma additionne. */
const largeurTotale = (spec, num) =>
  (num ? 44 : 0) + spec.columns.reduce((s, c) => s + c.w, 0);

/** Cellules d'une vue en lecture seule : du texte, pas de champ de saisie. */
function lectureRow(spec, valeur, ton) {
  let left = 0;
  const tds = spec.columns.map((c) => {
    const style = c.stick ? ` style="left:${left}px"` : '';
    if (c.stick) left += c.w;
    const v = valeur(c.key);
    // null : la colonne ne concerne pas cette ligne, on ne met rien.
    const dedans = v === null ? ''
      : v === '' ? '<i class="vide">vide</i>'
        : `<span title="${esc(v)}">${esc(v)}</span>`;
    return `<td${c.stick ? ' class="stick"' : ''}${style}>${dedans}</td>`;
  }).join('');
  return `<tr${ton ? ` data-t="${esc(ton)}"` : ''}>${tds}</tr>`;
}

/* ---------------------------------------------------------- RAPPEL ------ */

const frDate = (v) => {
  const d = v instanceof Date ? v : new Date(String(v ?? '').slice(0, 10) + 'T00:00:00');
  return isNaN(d) ? '' : d.toLocaleDateString('fr-FR');
};

/**
 * Entretien périodique déclaré par le schéma (spec.rappel) : on retient la
 * dernière ligne dont la colonne repère mentionne le mot-clé et on annonce la
 * prochaine échéance. Une ligne d'interface, aucune saisie de plus — le bouton
 * consigne l'intervention avec le bon libellé, sans avoir à le taper.
 */
function rappelHtml(spec) {
  const r = spec.rappel;
  if (!r) return '';
  const dernier = Store.rows(spec.id)
    .filter((row) => String(row[r.cle] ?? '').toLowerCase().includes(r.motCle))
    .map((row) => String(row.date ?? '').slice(0, 10))
    .filter(Boolean)
    .sort()
    .pop();

  let tone = 'bad';
  let etat = 'jamais consigné — à faire';
  if (dernier) {
    const prochain = new Date(dernier + 'T00:00:00');
    prochain.setMonth(prochain.getMonth() + r.mois);
    const retard = prochain < new Date(new Date().setHours(0, 0, 0, 0));
    tone = retard ? 'bad' : 'ok';
    etat = `dernier le ${frDate(dernier)} · ${retard ? 'dépassé depuis le' : 'prochain le'} ${frDate(prochain)}`;
  }

  return `<div class="rappel" data-t="${tone}">
    <b>${esc(r.titre)}</b>
    <span>tous les ${r.mois} mois — ${esc(etat)}</span>
    <button type="button" class="btn" data-rappel>Consigner le nettoyage</button>
  </div>`;
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

  paint(el.view, `
    <section class="panel">
      <div class="panel__head">
        <h2>${esc(spec.title)}</h2>
        <p>${esc(spec.subtitle)}</p>
      </div>
      ${rappelHtml(spec)}
      <div class="tablewrap">
        <table class="grid">
          <colgroup>${colsHtml(spec, true)}</colgroup>
          ${headHtml(spec, true)}
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

  bindRecherche(spec, renderTable);

  // Ligne ajoutée en tête, curseur posé sur la première case vide : on
  // enchaîne la saisie sans toucher la souris.
  const addRow = (prerempli) => {
    const row = Object.assign(spec.addRow ? spec.addRow() : {}, prerempli || {});
    let i;
    if (spec.prepend) { Store.insert(spec.id, 0, row); i = 0; }
    else i = Store.add(spec.id, row);
    filter = '';
    renderTable(spec);
    // La première ligne d'un poste neuf fait apparaître le rappel de sauvegarde.
    renderAlertes();
    const tr = $(`#tb tr[data-i="${i}"]`);
    if (!tr) return;
    const cells = [...tr.querySelectorAll('[data-k]')];
    const target = cells.find((c) => !c.value) || cells[0];
    if (target) target.focus();
  };
  $('#btnAdd').addEventListener('click', () => addRow());
  const cta = el.view.querySelector('[data-addrow]');
  if (cta) cta.addEventListener('click', () => addRow());
  const rappel = el.view.querySelector('[data-rappel]');
  if (rappel) rappel.addEventListener('click', () => addRow({ [spec.rappel.cle]: spec.rappel.valeur }));

  $('#btnCsv').addEventListener('click', () => { Store.exportCsv(spec.id); toast('Export CSV généré'); });
}

/** Recherche : on repeint l'écran courant et on rend le curseur au champ. */
function bindRecherche(spec, redessine) {
  $('#q').addEventListener('input', (e) => {
    filter = e.target.value;
    const pos = e.target.selectionStart;
    redessine(spec);
    const q = $('#q');
    q.focus();
    try { q.setSelectionRange(pos, pos); } catch (_) { /* type=search */ }
  });
}

/* ========================== ÉCRANS DE SUIVI ============================== */

const quand = (v) => {
  const d = new Date(v);
  return isNaN(d) ? '' : d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
};

/* Une table retirée du schéma garde ses lignes : son identifiant sert de nom de
   repli plutôt que de laisser la colonne vide. */
const nomEcran = (id) =>
  TABLES[id] ? TABLES[id].machine : (ECRANS[id] ? ECRANS[id].title : (id || ''));

const nomChamp = (tableId, key) => {
  const c = ((TABLES[tableId] || {}).columns || []).find((x) => x.key === key);
  return c ? c.label : (key || '');
};

/**
 * Une entrée de journal lue comme une ligne de tableau. Le même passe-plat sert
 * à l'écran et à l'export CSV : les deux disent forcément la même chose.
 * null = la colonne ne s'applique pas à cette action ; '' = la valeur était
 * bel et bien vide. La nuance compte : un « avant » vide est une information.
 */
function valeurJournal(e, key) {
  switch (key) {
    case 't':     return quand(e.t);
    case 'table': return e.table == null ? null : nomEcran(e.table);
    case 'op':    return (OPS[e.op] || {}).label || e.op || '';
    case 'champ': return e.champ == null ? null : nomChamp(e.table, e.champ);
    default:      return e[key] == null ? null : String(e[key]);
  }
}

function renderJournal(spec) {
  setCrumb(spec.machine, spec.title);

  paint(el.tools, `
    <label class="search"><input type="search" id="q" aria-label="Rechercher dans l'historique"
      placeholder="Rechercher…" value="${esc(filter)}" autocomplete="off"></label>
    <button type="button" class="btn btn--icon" id="btnCsv" title="Export CSV pour Excel">CSV</button>
    <button type="button" class="btn btn--icon" data-print title="Imprimer l'historique">Imprimer</button>`);

  // Du plus récent au plus ancien : c'est ce qu'on vient vérifier.
  const q = filter.toLowerCase();
  const total = Store.journal().length;
  const trouve = Store.journal().slice().reverse().filter((e) =>
    !q || spec.columns.some((c) => String(valeurJournal(e, c.key) ?? '').toLowerCase().includes(q)));
  const visible = trouve.slice(0, journalMax);
  const reste = trouve.length - visible.length;

  paint(el.view, `
    <section class="panel">
      <div class="panel__head">
        <h2>${esc(spec.title)}</h2>
        <p>${esc(spec.subtitle)}</p>
      </div>
      <div class="tablewrap">
        <table class="grid grid--lecture" style="width:${largeurTotale(spec, false)}px">
          <colgroup>${colsHtml(spec, false)}</colgroup>
          ${headHtml(spec, false)}
          <tbody>${visible.map((e) =>
            lectureRow(spec, (k) => valeurJournal(e, k), (OPS[e.op] || {}).t)).join('')}</tbody>
        </table>
        ${visible.length ? '' : `<div class="empty"><strong>Aucune écriture</strong>
          ${total ? 'Aucun résultat pour cette recherche.' : 'Le journal se remplit tout seul dès la première saisie.'}</div>`}
        ${reste > 0 ? `<div class="plus">
          <span>${visible.length} entrées affichées sur ${trouve.length} — les plus récentes.</span>
          <button type="button" class="btn" id="btnPlus">Tout afficher</button></div>` : ''}
      </div>
      <div class="panel__foot">
        <span>${trouve.length} / ${total} écriture${total > 1 ? 's' : ''}</span>
        <span class="foot-note">Journal en ajout seul — aucune entrée ne s’efface</span>
      </div>
    </section>`);

  bindRecherche(spec, renderJournal);
  $('#btnCsv').addEventListener('click', () => {
    Store.exportJournal(spec.columns, valeurJournal);
    toast('Historique exporté');
  });
  const plus = $('#btnPlus');
  if (plus) plus.addEventListener('click', () => { journalMax = Infinity; renderJournal(spec); });
}

function renderCorbeille(spec) {
  setCrumb(spec.machine, spec.title);

  paint(el.tools, `
    <label class="search"><input type="search" id="q" aria-label="Rechercher dans la corbeille"
      placeholder="Rechercher…" value="${esc(filter)}" autocomplete="off"></label>`);

  const q = filter.toLowerCase();
  const total = Store.trash().length;
  // L'indice d'origine voyage avec la ligne : c'est lui que untrash() attend.
  const items = Store.trash().map((t, i) => [t, i]).reverse().filter(([t]) =>
    !q || (nomEcran(t.table) + ' ' + Store.libelle(t.table, t.row)).toLowerCase().includes(q));

  paint(el.view, `
    <section class="panel">
      <div class="panel__head">
        <h2>${esc(spec.title)}</h2>
        <p>${esc(spec.subtitle)}</p>
      </div>
      <div class="tablewrap">
        ${items.length ? `<ul class="trash">${items.map(([t, i]) => `
          <li class="trashline">
            <div class="trashline__id">
              <b>${esc(Store.libelle(t.table, t.row))}</b>
              <span>${esc(nomEcran(t.table))} · retirée le ${esc(quand(t.at))}${t.poste ? ' · ' + esc(t.poste) : ''}</span>
            </div>
            <button type="button" class="btn btn--signal" data-untrash="${i}">Remettre en place</button>
          </li>`).join('')}</ul>`
        : `<div class="empty"><strong>Corbeille vide</strong>
            ${total ? 'Aucun résultat pour cette recherche.' : 'Aucune ligne n’a été retirée d’un tableau.'}</div>`}
      </div>
      <div class="panel__foot">
        <span>${items.length} / ${total} ligne${total > 1 ? 's' : ''}</span>
        <span class="foot-note">Conservées dans le fichier — rien ne s’efface d’ici</span>
      </div>
    </section>`);

  bindRecherche(spec, renderCorbeille);
  // La liste est repeinte à chaque rendu : l'écouteur part avec elle.
  const liste = el.view.querySelector('.trash');
  if (liste) liste.addEventListener('click', (e) => {
    const b = e.target.closest('[data-untrash]');
    if (!b) return;
    const t = Store.untrash(+b.dataset.untrash);
    render();
    if (t) toast('Ligne remise dans « ' + nomEcran(t.table) + ' »');
  });
}

/* ============================== ALERTES ================================== */

/**
 * Deux choses doivent se voir sans qu'on aille les chercher : l'écriture qui
 * échoue — ce qui est tapé n'est plus conservé — et la sauvegarde qui date.
 * Le bandeau reste tant que la cause dure ; ce n'est pas un toast.
 */
function renderAlertes() {
  const parts = [];
  const err = Store.erreur();

  if (err) {
    parts.push(`<div class="alerte alerte--bad" role="alert">
      <b>Enregistrement impossible</b>
      <span>Ce qui est saisi n’est plus conservé sur ce poste (${esc(err.name || 'stockage refusé')}).
        Fais une sauvegarde .json maintenant : elle contient tout.</span>
      <button type="button" class="btn" data-backup>Sauvegarde .json</button>
    </div>`);
  }

  const j = Store.backupAge();
  if (!err && Store.compte() && (j === null || j >= 7)) {
    parts.push(`<div class="alerte alerte--warn">
      <b>Sauvegarde</b>
      <span>${j === null
        ? 'Aucune sauvegarde .json depuis ce poste.'
        : `Dernière sauvegarde il y a ${j} jour${j > 1 ? 's' : ''}.`}
        Les données ne vivent que dans ce navigateur.</span>
      <button type="button" class="btn" data-backup>Sauvegarde .json</button>
    </div>`);
  }

  paint(el.alertes, parts.join(''));
}

/* ------------------------------------------------------ FICHE DE LIGNE --- */

/* Le tableau suffit pour saisir. La fiche sert à voir une ligne en entier sur
   un petit écran, et c'est le seul endroit d'où l'on retire une ligne — vers la
   corbeille, jamais dans le vide. */
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
      case 'datetime': input = `<input type="datetime-local" id="${id}" data-k="${k}" value="${v}">`; break;
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
        <button type="button" class="btn btn--danger" data-del>Mettre à la corbeille</button>
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
      if (confirm(`Retirer la ligne n°${i + 1} du tableau ?\n\n`
        + 'Elle part à la corbeille : elle reste dans le fichier et se remet en place quand tu veux.')) {
        Store.remove(spec.id, i);
        closeModal();
        toast('Ligne mise à la corbeille');
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

/* Le rail dit trois choses : quand ça a été écrit ici, quand ça a été sorti sur
   disque, et si le navigateur s'est engagé à ne pas vider ce stockage. */
function updateStorageNote() {
  const d = Store.updatedAt();
  const b = Store.backupAt();
  const dur = Store.durable();
  $('#storageNote').textContent = [
    d ? 'Écrit ici ' + quand(d) : 'Aucune donnée enregistrée',
    b ? 'Sauvegardé ' + quand(b) : 'Jamais sauvegardé sur disque',
    dur === true ? 'Stockage protégé par le navigateur'
      : dur === false ? 'Stockage non protégé — sauvegarde souvent'
        : 'Protection du stockage inconnue',
  ].join('\n');
}

let etatPrecedent = null;
Store.onState((s) => {
  const box = $('#saver');
  box.dataset.state = s;
  box.querySelector('span').textContent =
    s === 'error' ? 'Non enregistré' : s === 'dirty' ? 'Saisie…' : 'Enregistré';
  if (s !== 'dirty') updateStorageNote();
  // Le bandeau ne se repeint qu'au basculement : pendant la frappe, l'écriture
  // se déclenche toutes les 350 ms.
  if ((s === 'error') !== (etatPrecedent === 'error')) renderAlertes();
  etatPrecedent = s;
});

function toggleNav(open) {
  document.body.classList.toggle('nav-open', open);
  $('#scrim').hidden = !open;
  $('#burger').setAttribute('aria-expanded', String(open));
}

/* ------------------------------------------------------------ GLOBALS --- */

function sauvegarde() {
  Store.backup();
  toast('Sauvegarde téléchargée');
  updateStorageNote();
  renderAlertes();
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-print]')) { window.print(); return; }
  if (e.target.closest('[data-backup]')) { sauvegarde(); return; }
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

$('#btnBackup').addEventListener('click', sauvegarde);
$('#btnRestore').addEventListener('click', () => $('#fileRestore').click());
$('#fileRestore').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  if (!confirm('Les tableaux vont être remplacés par le contenu de ce fichier.\n\n'
    + 'L’historique et la corbeille sont fusionnés, pas remplacés.\n'
    + 'Une sauvegarde de l’état actuel va d’abord être téléchargée.\n\nContinuer ?')) {
    e.target.value = '';
    return;
  }
  // Le filet part maintenant, dans le geste de l'opérateur : un téléchargement
  // déclenché après la lecture du fichier se ferait bloquer par le navigateur.
  const filet = Store.backup('avant-restauration');
  try {
    const bilan = await Store.restore(f);
    render();
    updateStorageNote();
    toast(`Restauré · ${bilan.lignes} ligne(s), ${bilan.journal} entrée(s) d’historique reprises`);
  } catch (err) {
    alert('Restauration impossible : ' + err.message
      + '\n\nRien n’a été modifié. Le filet « ' + filet + ' » est sur le disque.');
  }
  e.target.value = '';
});

/* Le nom du poste distingue la tablette du PC dans l'historique. Il reste
   attaché à la machine : une restauration de sauvegarde ne l'emporte pas. */
const champPoste = $('#poste');
champPoste.value = Store.poste();
champPoste.addEventListener('change', () => {
  Store.setPoste(champPoste.value);
  champPoste.value = Store.poste();
  toast('Poste enregistré');
});

window.addEventListener('hashchange', route);
updateStorageNote();
route();
// Demande au navigateur de ne pas vider ce stockage quand la place manque.
Store.durabilite().then(updateStorageNote);
