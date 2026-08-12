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

/* Une cellule se désigne par l'identifiant de sa ligne, jamais par son rang :
   sur un tableau partagé, l'ajout d'un collègue décale les indices de ce poste
   entre le moment où la case est peinte et celui où elle est remplie. */
function cellHtml(col, row) {
  const v = row[col.key] ?? '';
  const isDate = col.type === 'date' || col.type === 'datetime';
  const cls = 'cell' + (col.type === 'num' ? ' cell--num' : '')
    + (isDate ? ' cell--date' + (v ? '' : ' is-empty') : '');
  const at = `data-k="${esc(col.key)}" data-id="${esc(row._id)}"`;

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
    return `<td class="${cls}"${style}>${cellHtml(c, row)}</td>`;
  }).join('');
  return `<tr data-id="${esc(row._id)}">
    <td class="stick" style="left:0">
      <button type="button" class="rowbtn" data-edit="${esc(row._id)}" title="Ouvrir la fiche">${i + 1}</button>
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
 * Entretiens périodiques déclarés par le schéma (spec.rappels) : pour chacun on
 * retient la dernière ligne dont la colonne repère mentionne le mot-clé et on
 * annonce la prochaine échéance. Une ligne d'interface, aucune saisie de plus —
 * le bouton consigne l'intervention avec le bon libellé, sans avoir à le taper.
 *
 * Trois régimes, parce que le constructeur ne donne pas la même consigne
 * partout. `mois` pose une échéance et le bandeau vire au rouge quand elle est
 * passée. Sans `mois`, on se contente de dater le dernier passage : afficher
 * une échéance inventée serait pire que rien. Sans `motCle`, il n'y a rien à
 * suivre dans le tableau — la règle elle-même est tout le message.
 *
 * `motCle` cherche, `valeur` écrit : les deux sont indépendants. Un rappel qui
 * couvre plusieurs pièces d'un coup date bien le dernier passage mais n'a pas
 * de libellé unique à pré-remplir, donc pas de bouton.
 *
 * `motCle` accepte plusieurs termes, et il en faut : le fournisseur écrit
 * « wiper » et « mousse rectangle » là où l'atelier tape « essuyeur » et
 * « éponge de purge ». Un seul mot-clé et le bandeau resterait au rouge devant
 * une ligne pourtant saisie — le pire des cas, puisqu'il ferait refaire
 * l'entretien.
 */
function rappelHtml(spec) {
  return (spec.rappels || []).map((r, i) => {
    let tone = '';
    let etat = '';

    if (r.motCle) {
      const termes = [].concat(r.motCle);
      const dernier = Store.rows(spec.id)
        .filter((row) => {
          const v = String(row[r.cle] ?? '').toLowerCase();
          return termes.some((m) => v.includes(m));
        })
        .map((row) => String(row.date ?? '').slice(0, 10))
        .filter(Boolean)
        .sort()
        .pop();

      if (!dernier) {
        tone = r.mois ? 'bad' : '';
        etat = r.mois ? 'jamais consigné — à faire' : 'jamais consigné';
      } else if (r.mois) {
        const prochain = new Date(dernier + 'T00:00:00');
        prochain.setMonth(prochain.getMonth() + r.mois);
        const retard = prochain < new Date(new Date().setHours(0, 0, 0, 0));
        tone = retard ? 'bad' : 'ok';
        etat = `dernier le ${frDate(dernier)} · ${retard ? 'dépassé depuis le' : 'prochain le'} ${frDate(prochain)}`;
      } else {
        etat = `dernier le ${frDate(dernier)}`;
      }
    }

    const dit = [r.mois ? `tous les ${r.mois} mois` : null, etat].filter(Boolean).join(' — ');

    return `<div class="rappel" data-t="${tone}">
      <b>${esc(r.titre)}</b>
      ${dit ? `<span>${esc(dit)}</span>` : ''}
      ${r.regle ? `<i>${esc(r.regle)}</i>` : ''}
      ${r.valeur ? `<button type="button" class="btn" data-rappel="${i}">Consigner le ${esc(spec.rowLabel)}</button>` : ''}
    </div>`;
  }).join('');
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
        <span class="foot-note">${esc(noteEnregistrement())}</span>
      </div>
    </section>`);

  bindTable(spec);
}

/** Le pied de tableau dit où part ce qui est tapé. Il ne doit jamais promettre
    un partage qui n'a pas lieu : c'est le mode réel qui parle. */
function noteEnregistrement() {
  switch (Sync.mode()) {
    case 'partage': return 'Partagé — visible sur tous les postes de l’atelier';
    case 'attente': return 'Hors ligne — enregistré ici, envoyé au retour du réseau';
    case 'code':    return 'Partage en attente du code d’atelier';
    default:        return 'Enregistrement automatique dans ce navigateur';
  }
}

/* --------------------------------------------------------- INTERACTION --- */

function bindTable(spec) {
  const tb = $('#tb');

  const write = (e) => {
    const t = e.target;
    if (!t.dataset || !t.dataset.k) return;
    Store.set(spec.id, t.dataset.id, t.dataset.k, t.value);
    if (t.tagName === 'INPUT' && t.type === 'text') t.title = t.value;
    if (t.classList.contains('cell--date')) t.classList.toggle('is-empty', !t.value);
  };
  tb.addEventListener('input', write);
  tb.addEventListener('change', write);

  tb.addEventListener('click', (e) => {
    const edit = e.target.closest('[data-edit]');
    if (edit) openRow(spec, edit.dataset.edit);
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
    const r = Store.add(spec.id, row, !!spec.prepend);
    filter = '';
    renderTable(spec);
    // La première ligne d'un poste neuf fait apparaître le rappel de sauvegarde.
    renderAlertes();
    const tr = $(`#tb tr[data-id="${CSS.escape(r._id)}"]`);
    if (!tr) return;
    const cells = [...tr.querySelectorAll('[data-k]')];
    const target = cells.find((c) => !c.value) || cells[0];
    if (target) target.focus();
  };
  $('#btnAdd').addEventListener('click', () => addRow());
  const cta = el.view.querySelector('[data-addrow]');
  if (cta) cta.addEventListener('click', () => addRow());
  el.view.querySelectorAll('[data-rappel]').forEach((b) => {
    const r = spec.rappels[+b.dataset.rappel];
    b.addEventListener('click', () => addRow({ [r.cle]: r.valeur }));
  });

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
  // La ligne se remet en place par son identifiant : la corbeille est partagée,
  // son rang change dès qu'un autre poste y dépose ou en reprend une ligne.
  const items = Store.trash().slice().reverse().filter((t) =>
    !q || (nomEcran(t.table) + ' ' + Store.libelle(t.table, t.row)).toLowerCase().includes(q));

  paint(el.view, `
    <section class="panel">
      <div class="panel__head">
        <h2>${esc(spec.title)}</h2>
        <p>${esc(spec.subtitle)}</p>
      </div>
      <div class="tablewrap">
        ${items.length ? `<ul class="trash">${items.map((t) => `
          <li class="trashline">
            <div class="trashline__id">
              <b>${esc(Store.libelle(t.table, t.row))}</b>
              <span>${esc(nomEcran(t.table))} · retirée le ${esc(quand(t.at))}${t.poste ? ' · ' + esc(t.poste) : ''}</span>
            </div>
            <button type="button" class="btn btn--signal" data-untrash="${esc(t.row._id)}">Remettre en place</button>
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
    const t = Store.untrash(b.dataset.untrash);
    render();
    if (t) toast('Ligne remise dans « ' + nomEcran(t.table) + ' »');
  });
}

/* ============================== ALERTES ================================== */

/**
 * Ce qui doit se voir sans qu'on aille le chercher : l'écriture qui échoue — ce
 * qui est tapé n'est plus conservé —, le partage qui ne prend pas, et la
 * sauvegarde qui date. Le bandeau reste tant que la cause dure ; ce n'est pas
 * un toast.
 */
function renderAlertes() {
  const parts = [];
  const err = Store.erreur();
  const mode = Sync.mode();
  const partage = Sync.actif();

  if (err) {
    parts.push(`<div class="alerte alerte--bad" role="alert">
      <b>Enregistrement impossible</b>
      <span>Ce qui est saisi n’est plus conservé sur ce poste (${esc(err.name || 'stockage refusé')}).
        Fais une sauvegarde .json maintenant : elle contient tout.</span>
      <button type="button" class="btn" data-backup>Sauvegarde .json</button>
    </div>`);
  }

  if (mode === 'code') {
    parts.push(`<div class="alerte alerte--warn" role="alert">
      <b>Code d’atelier</b>
      <span>Ce poste n’est pas encore relié au tableau partagé. Saisis le code de l’atelier :
        il est demandé une seule fois par navigateur.</span>
      <label class="alerte__champ"><input type="password" id="codeAtelier" autocomplete="off"
        aria-label="Code d’atelier" placeholder="Code" enterkeyhint="go"></label>
      <button type="button" class="btn" data-code-ok>Relier ce poste</button>
    </div>`);
  }

  if (mode === 'attente') {
    const n = Sync.enAttente();
    parts.push(`<div class="alerte alerte--warn">
      <b>Serveur injoignable</b>
      <span>La saisie continue normalement et reste enregistrée ici.
        ${n ? `${n} écriture${n > 1 ? 's' : ''} en attente — elle${n > 1 ? 's repartiront' : ' repartira'}` : 'Tout repartira'}
        dès le retour du réseau.</span>
      <button type="button" class="btn" data-resync>Réessayer</button>
    </div>`);
  }

  /* Le journal partagé porte une colonne « Poste ». Sans nom, toutes les
     écritures de l'atelier se ressemblent — autant le demander une fois. */
  if (mode === 'partage' && !Store.poste()) {
    parts.push(`<div class="alerte alerte--warn">
      <b>Nom du poste</b>
      <span>Donne un nom à ce navigateur (« tablette atelier », « PC bureau »…) :
        l’historique partagé dira qui a écrit quoi.</span>
      <label class="alerte__champ"><input type="text" id="nomPoste" autocomplete="off"
        aria-label="Nom du poste" placeholder="tablette atelier" maxlength="24" enterkeyhint="go"></label>
      <button type="button" class="btn" data-poste-ok>Enregistrer</button>
    </div>`);
  }

  // Le serveur garde une copie datée par jour : le rappel se fait plus discret
  // quand le partage tourne, sans disparaître — le .json reste le seul filet
  // qui ne dépend d'aucun serveur.
  const j = Store.backupAge();
  const seuil = partage ? 30 : 7;
  if (!err && Store.compte() && (j === null || j >= seuil)) {
    parts.push(`<div class="alerte alerte--warn">
      <b>Sauvegarde</b>
      <span>${j === null
        ? 'Aucune sauvegarde .json depuis ce poste.'
        : `Dernière sauvegarde il y a ${j} jour${j > 1 ? 's' : ''}.`}
        ${partage
          ? 'Les données sont partagées et copiées chaque jour côté serveur ; le .json reste le filet qui ne dépend de rien.'
          : 'Les données ne vivent que dans ce navigateur.'}</span>
      <button type="button" class="btn" data-backup>Sauvegarde .json</button>
    </div>`);
  }

  paint(el.alertes, parts.join(''));
}

/* ------------------------------------------------------------- PARTAGE --- */

/** Ce que le rail de la barre du haut affiche selon l'état du partage. */
const ETATS_SYNC = {
  local:   { t: 'local',   texte: 'Ce poste' },
  code:    { t: 'code',    texte: 'Code requis' },
  partage: { t: 'ok',      texte: 'Partagé' },
  attente: { t: 'attente', texte: 'Hors ligne' },
};

function renderSync(mode, info) {
  const box = $('#sync');
  const etat = ETATS_SYNC[mode];
  // Tant que la sonde cherche, on n'annonce rien : un « Ce poste » qui bascule
  // sur « Partagé » une demi-seconde plus tard se lit comme une panne.
  box.hidden = !etat;
  if (!etat) return;
  box.dataset.state = etat.t;
  box.querySelector('span').textContent =
    mode === 'attente' && info.enAttente ? `${etat.texte} · ${info.enAttente}` : etat.texte;
  box.title = mode === 'partage'
    ? 'Les lignes sont les mêmes sur tous les postes de l’atelier.'
    : mode === 'attente'
      ? 'Serveur injoignable. La saisie est conservée ici et repartira au retour du réseau.'
      : mode === 'code'
        ? 'Code d’atelier requis pour rejoindre le tableau partagé.'
        : 'Aucun serveur de partage à cette adresse : les données restent sur ce poste.';
}

/**
 * L'état des autres postes vient d'arriver : on repeint. Le curseur et la
 * sélection sont remis là où ils étaient — l'opérateur ne doit pas sentir la
 * synchronisation pendant qu'il tape.
 */
function rafraichir() {
  if (ficheOuverte && !Store.row(ficheOuverte.table, ficheOuverte.row)) {
    closeModal();
    toast('Cette ligne vient d’être retirée depuis un autre poste');
    return;
  }
  const memo = focusMemo();
  render();
  majFiche();
  focusRestaure(memo);
}

function focusMemo() {
  const a = document.activeElement;
  if (!a || !a.dataset || !a.dataset.k || !a.dataset.id) return null;
  const memo = { id: a.dataset.id, k: a.dataset.k, modale: !el.modal.hidden };
  // Les champs date/heure n'exposent pas de sélection : on ignore, sans bruit.
  try { memo.debut = a.selectionStart; memo.fin = a.selectionEnd; } catch (_) { /* type=date */ }
  return memo;
}

function focusRestaure(memo) {
  if (!memo) return;
  const racine = memo.modale ? el.modal : el.view;
  const cible = racine.querySelector(`[data-id="${CSS.escape(memo.id)}"][data-k="${CSS.escape(memo.k)}"]`);
  if (!cible) return;
  cible.focus();
  if (memo.debut == null) return;
  try { cible.setSelectionRange(memo.debut, memo.fin); } catch (_) { /* type=date */ }
}

/* ------------------------------------------------------ FICHE DE LIGNE --- */

/* Le tableau suffit pour saisir. La fiche sert à voir une ligne en entier sur
   un petit écran, et c'est le seul endroit d'où l'on retire une ligne — vers la
   corbeille, jamais dans le vide. */
/** La ligne dont la fiche est ouverte, pour la suivre quand l'état du serveur
    arrive : ses champs se rafraîchissent, et elle se ferme si un autre poste
    vient de mettre cette ligne à la corbeille. */
let ficheOuverte = null;

function openRow(spec, rowId) {
  const row = Store.row(spec.id, rowId);
  if (!row) return;
  ficheOuverte = { table: spec.id, row: rowId };
  const rang = Store.rows(spec.id).indexOf(row) + 1;

  const field = (c) => {
    const v = esc(row[c.key] ?? '');
    const id = 'f_' + c.key;
    const at = `data-k="${esc(c.key)}" data-id="${esc(rowId)}"`;
    let input;
    switch (c.type) {
      case 'select':
        input = `<select id="${id}" ${at}><option value=""></option>${c.options.map((o) =>
          `<option${o === row[c.key] ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
        break;
      case 'long': input = `<textarea id="${id}" ${at}>${v}</textarea>`; break;
      case 'date': input = `<input type="date" id="${id}" ${at} value="${v}">`; break;
      case 'datetime': input = `<input type="datetime-local" id="${id}" ${at} value="${v}">`; break;
      case 'num':  input = `<input type="text" inputmode="decimal" id="${id}" ${at} value="${v}">`; break;
      default:     input = `<input type="text" id="${id}" ${at} value="${v}">`;
    }
    return `<div class="field"><label for="${id}">${esc(c.label)}</label>${input}</div>`;
  };

  el.modal.hidden = false;
  paint(el.modal, `
    <div class="modal__box" role="dialog" aria-modal="true" aria-label="Fiche ${esc(spec.rowLabel)}">
      <div class="modal__head">
        <h2>${esc(spec.rowLabel)} n°${rang}</h2>
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
    if (t.dataset && t.dataset.k) Store.set(spec.id, rowId, t.dataset.k, t.value);
  };
  $('#mbody').addEventListener('input', sync);
  $('#mbody').addEventListener('change', sync);

  el.modal.onclick = (e) => {
    if (e.target.closest('[data-del]')) {
      if (confirm(`Retirer la ligne n°${rang} du tableau ?\n\n`
        + 'Elle part à la corbeille : elle reste dans le fichier et se remet en place quand tu veux.'
        + (Sync.actif() ? '\n\nLe retrait vaut pour tous les postes de l’atelier.' : ''))) {
        Store.remove(spec.id, rowId);
        closeModal();
        toast('Ligne mise à la corbeille');
      }
      return;
    }
    if (e.target === el.modal || e.target.closest('[data-close]')) closeModal();
  };
}

/** Un autre poste a modifié la ligne ouverte : les champs suivent, sauf celui
    qui a le curseur — on n'efface pas ce qui est en train d'être tapé. */
function majFiche() {
  if (el.modal.hidden || !ficheOuverte) return;
  const row = Store.row(ficheOuverte.table, ficheOuverte.row);
  if (!row) return;
  el.modal.querySelectorAll('[data-k]').forEach((f) => {
    if (f === document.activeElement) return;
    const v = String(row[f.dataset.k] ?? '');
    if (f.value !== v) f.value = v;
  });
}

function closeModal() {
  el.modal.hidden = true;
  el.modal.onclick = null;
  ficheOuverte = null;
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

let etatPrecedent = null;
Store.onState((s) => {
  const box = $('#saver');
  box.dataset.state = s;
  box.querySelector('span').textContent =
    s === 'error' ? 'Non enregistré' : s === 'dirty' ? 'Saisie…' : 'Enregistré';
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
  renderAlertes();
}

/** Le code d'atelier est demandé une fois par navigateur, puis mémorisé. */
async function relie() {
  const champ = $('#codeAtelier');
  const bouton = el.alertes.querySelector('[data-code-ok]');
  if (!champ || !champ.value.trim()) { if (champ) champ.focus(); return; }
  if (bouton) { bouton.disabled = true; bouton.textContent = 'Vérification…'; }
  const ok = await Sync.essaieCode(champ.value);
  renderAlertes();
  toast(ok ? 'Poste relié au tableau partagé' : 'Code refusé — réessaie');
  if (ok) rafraichir(); else { const c = $('#codeAtelier'); if (c) c.focus(); }
}

function nommePoste() {
  const champ = $('#nomPoste');
  if (!champ || !champ.value.trim()) { if (champ) champ.focus(); return; }
  Store.setPoste(champ.value);
  renderAlertes();
  toast('Poste nommé « ' + Store.poste() + ' »');
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-print]')) { window.print(); return; }
  if (e.target.closest('[data-backup]')) { sauvegarde(); return; }
  if (e.target.closest('[data-resync]')) { Sync.maintenant(); toast('Nouvelle tentative…'); return; }
  if (e.target.closest('[data-code-ok]')) { relie(); return; }
  if (e.target.closest('[data-poste-ok]')) { nommePoste(); return; }
  const g = e.target.closest('[data-go]');
  if (g) go(g.dataset.go);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'codeAtelier') { e.preventDefault(); relie(); return; }
  if (e.key === 'Enter' && e.target.id === 'nomPoste') { e.preventDefault(); nommePoste(); return; }
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
    + 'Une sauvegarde de l’état actuel va d’abord être téléchargée.\n'
    + (Sync.actif()
      ? 'Partage : les lignes du fichier que le serveur ignore lui seront renvoyées.\n'
        + 'Les lignes qu’il connaît déjà gardent leur valeur — remonter une vieille\n'
        + 'sauvegarde ne fait pas reculer le travail des autres postes.\n'
      : '')
    + '\nContinuer ?')) {
    e.target.value = '';
    return;
  }
  // Le filet part maintenant, dans le geste de l'opérateur : un téléchargement
  // déclenché après la lecture du fichier se ferait bloquer par le navigateur.
  const filet = Store.backup('avant-restauration');
  try {
    const bilan = await Store.restore(f);
    render();
    // Le serveur ne connaît pas les lignes que le fichier vient de remettre :
    // on relance un échange complet pour les lui pousser.
    Sync.reconcilie();
    toast(`Restauré · ${bilan.lignes} ligne(s), ${bilan.journal} entrée(s) d’historique reprises`);
  } catch (err) {
    alert('Restauration impossible : ' + err.message
      + '\n\nRien n’a été modifié. Le filet « ' + filet + ' » est sur le disque.');
  }
  e.target.value = '';
});

/* --------------------------------------------------------- DÉMARRAGE ----- */

/* Le champ sous le curseur ne se fait pas écraser par l'état venu du serveur :
   sans ça, la saisie s'effacerait sous les doigts au moment où la réponse
   arrive. Le store lui demande la ligne et le champ, jamais le rang. */
Store.protege(() => {
  const a = document.activeElement;
  if (!a || !a.dataset || !a.dataset.k || !a.dataset.id) return null;
  if (!TABLES[current]) return null;
  return { table: current, row: a.dataset.id, champ: a.dataset.k };
});

let syncMode = null;
let syncMajs = -1;
let syncAttente = -1;
Sync.onState((mode, info) => {
  renderSync(mode, info);
  const donneesNeuves = info.majs !== syncMajs;
  const modeChange = mode !== syncMode;
  // Hors ligne, le bandeau annonce combien d'écritures patientent : le nombre
  // doit suivre la frappe, sinon il dit « 1 » devant une pile de trois.
  const fileChange = mode === 'attente' && info.enAttente !== syncAttente;
  syncMajs = info.majs;
  syncMode = mode;
  syncAttente = info.enAttente;
  // Le mode se lit jusque dans le pied du tableau : un changement d'état vaut
  // un repeint, même sans donnée neuve.
  if (donneesNeuves || modeChange) rafraichir();
  else if (fileChange) renderAlertes();
});

window.addEventListener('hashchange', route);
route();
// La sonde décide seule : serveur de partage à cette adresse, ou repli sur le
// stockage du poste. L'appli est déjà utilisable avant sa réponse.
Sync.init();
// Demande au navigateur de ne pas vider ce stockage quand la place manque.
// Plus rien n'affiche la réponse, mais la demande, elle, protège les données.
Store.durabilite();
