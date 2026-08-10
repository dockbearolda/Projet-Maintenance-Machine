/* =========================================================================
   APP — routage, rendu des tables, fiche de ligne, tableau de bord.
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

let current = 'dashboard';
let filter = '';
let onlyAlerts = false;

/* ============================== ROUTAGE ================================= */

function route() {
  const id = location.hash.replace(/^#\/?/, '') || 'dashboard';
  current = (TABLES[id] || id === 'aide') ? id : 'dashboard';
  filter = '';
  onlyAlerts = false;
  render();
  toggleNav(false);
  el.view.scrollTop = 0;
  window.scrollTo(0, 0);
}

function go(id) { location.hash = '#/' + id; }

/* ============================== NAVIGATION ============================== */

function alerts() {
  const conso = Store.rows('dtf_consommables');
  return {
    dtf_consommables:
      conso.filter((r) => CALC.statut(r).tone === 'bad').length +
      conso.filter((r) => CALC.alerte(r).tone === 'bad').length,
    pannes: Store.rows('pannes').filter((r) => r.statut === 'Ouvert' || r.statut === 'En cours').length,
    trotec_hebdo: Store.rows('trotec_hebdo').filter((r) => CALC.conformite(r).tone === 'bad').length,
  };
}

function renderNav() {
  const a = alerts();
  paint(el.nav, NAV.map((g) => `
    ${g.label ? `<div class="navgroup"><div class="navgroup__label">${esc(g.label)}</div></div>` : '<div class="navgroup"></div>'}
    ${g.items.map((it) => `
      <button type="button" class="navlink" data-go="${esc(it.id)}" aria-current="${current === it.id}">
        <span>${esc(it.label)}</span>
        ${a[it.id] ? `<span class="navlink__badge" data-tone="${it.id === 'trotec_hebdo' ? 'warn' : 'bad'}">${a[it.id]}</span>` : ''}
      </button>`).join('')}
  `).join(''));
}

/* ============================== RENDU ==================================== */

function render() {
  renderNav();
  if (current === 'aide') return renderAide();
  if (TABLES[current]) return renderTable(TABLES[current]);
  return renderDashboard();
}

function setCrumb(machine, view, isTable) {
  $('#crumbMachine').textContent = machine;
  $('#crumbView').textContent = view;
  document.title = view + ' — Maintenance Atelier';
  el.view.classList.toggle('view--table', !!isTable);
}

/* ------------------------------------------------------ TABLEAU DE BORD -- */

function num(v) { const n = parseFloat(String(v ?? '').replace(',', '.')); return isNaN(n) ? 0 : n; }
function fmt(n, d = 0) { return n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }); }

function mondayOf(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function renderDashboard() {
  setCrumb('Atelier', 'Tableau de bord');
  paint(el.tools, `<button type="button" class="btn" data-print>Imprimer</button>`);

  const conso = Store.rows('dtf_consommables');
  const hist = Store.rows('dtf_historique');
  const pan = Store.rows('pannes');
  const hebdo = Store.rows('trotec_hebdo');

  const retard = conso.filter((r) => CALC.statut(r).tone === 'bad');
  const prevoir = conso.filter((r) => CALC.statut(r).tone === 'warn' && r.dernier);
  const commander = conso.filter((r) => CALC.alerte(r).tone === 'bad');
  const ouvertes = pan.filter((r) => r.statut === 'Ouvert' || r.statut === 'En cours');
  const arret = hist.reduce((s, r) => s + num(r.arret), 0) + pan.reduce((s, r) => s + num(r.arret), 0);
  const cout = hist.reduce((s, r) => s + num(r.cout), 0) + pan.reduce((s, r) => s + num(r.cout), 0);

  const lundi = ymd(mondayOf(new Date()));
  const iSem = hebdo.findIndex((r) => r.date === lundi);
  const sem = iSem >= 0 ? hebdo[iSem] : null;
  const semConf = sem ? CALC.conformite(sem) : null;
  const semFaits = sem ? POSTE_KEYS.filter((k) => sem[k]).length : 0;

  const echeances = conso
    .map((r) => ({ r, s: CALC.statut(r), e: CALC.echeance(r) }))
    .filter((x) => x.e.raw)
    .sort((a, b) => a.e.raw - b.e.raw)
    .slice(0, 8);

  const kpi = (k, v, s, t) => `
    <div class="kpi" data-t="${t || ''}"><div class="kpi__k">${esc(k)}</div>
    <div class="kpi__v">${esc(v)}</div><div class="kpi__s">${esc(s)}</div></div>`;

  paint(el.view, `
  <div class="dash">
    <div class="kpis">
      ${kpi('Pièces en retard', retard.length, retard.length ? 'à remplacer sans délai' : 'aucune échéance dépassée', retard.length ? 'bad' : 'ok')}
      ${kpi('À prévoir · 30 j', prevoir.length, 'échéance sous un mois', prevoir.length ? 'warn' : 'ok')}
      ${kpi('À commander', commander.length, 'stock au seuil ou en dessous', commander.length ? 'bad' : 'ok')}
      ${kpi('Pannes ouvertes', ouvertes.length, 'non clôturées', ouvertes.length ? 'bad' : 'ok')}
      ${kpi('Arrêt production', fmt(arret, 1) + ' h', 'cumul historique + pannes')}
      ${kpi('Coût maintenance', fmt(cout) + ' €', 'pièces + interventions')}
    </div>

    <div class="cols2">
      <section class="panel">
        <div class="panel__head"><h2>Semaine en cours — Trotec</h2></div>
        ${sem ? `
          <ul class="list">
            <li><b>Semaine ${esc(sem.sem)}</b><span class="sp">lundi ${esc(sem.date)}</span></li>
            <li><span class="dot"></span><b>Postes pointés</b><span class="sp">${semFaits} / ${POSTE_KEYS.length}</span></li>
            <li data-t="${semConf.tone === 'ok' ? '' : semConf.tone}"><span class="dot"></span><b>Conformité</b>
              <span class="sp"><span class="tag" data-t="${semConf.tone}">${esc(semConf.text)}</span></span></li>
          </ul>
          <div class="panel__foot"><button type="button" class="btn btn--primary" data-go="trotec_hebdo" data-focus="${iSem}">Pointer la semaine</button></div>`
        : `<div class="empty"><strong>Pas de ligne pour cette semaine</strong>
            <div style="margin-top:12px"><button type="button" class="btn" data-go="trotec_hebdo">Ouvrir le pointage</button></div></div>`}
      </section>

      <section class="panel">
        <div class="panel__head"><h2>Prochaines échéances DTF</h2></div>
        ${echeances.length ? `<ul class="list">${echeances.map((x) => `
          <li data-t="${x.s.tone === 'ok' ? '' : x.s.tone}">
            <span class="dot"></span><b>${esc(x.r.piece)}</b>
            <span class="sp">${esc(x.e.text)} · <span class="tag" data-t="${x.s.tone}">${esc(x.s.text)}</span></span>
          </li>`).join('')}</ul>
          <div class="panel__foot"><button type="button" class="btn" data-go="dtf_consommables">Ouvrir les consommables</button></div>`
        : `<div class="empty"><strong>Aucune date de pose saisie</strong>
            Renseignez « Dernier remplacement » pour activer le suivi.
            <div style="margin-top:12px"><button type="button" class="btn" data-go="dtf_consommables">Ouvrir les consommables</button></div></div>`}
      </section>

      <section class="panel">
        <div class="panel__head"><h2>Pièces à commander</h2></div>
        ${commander.length ? `<ul class="list">${commander.map((r) => `
          <li data-t="bad"><span class="dot"></span><b>${esc(r.piece)}</b>
          <span class="sp">stock ${esc(r.stock)} / seuil ${esc(r.seuil)}</span></li>`).join('')}</ul>`
        : `<div class="empty">Aucune pièce sous le seuil.</div>`}
      </section>

      <section class="panel">
        <div class="panel__head"><h2>Pannes ouvertes</h2></div>
        ${ouvertes.length ? `<ul class="list">${ouvertes.map((r) => `
          <li data-t="bad"><span class="dot"></span><b>${esc(r.machine)} — ${esc(r.description || 'sans description')}</b>
          <span class="sp">${esc(String(r.datetime || '').replace('T', ' '))}</span></li>`).join('')}</ul>
          <div class="panel__foot"><button type="button" class="btn" data-go="pannes">Ouvrir le journal</button></div>`
        : `<div class="empty">Aucune anomalie en cours.
            <div style="margin-top:12px"><button type="button" class="btn" data-go="pannes">Déclarer une panne</button></div></div>`}
      </section>
    </div>
  </div>`);
}

/* ---------------------------------------------------------------- AIDE --- */

function renderAide() {
  setCrumb('Atelier', 'Aide & rappels');
  paint(el.tools, `<button type="button" class="btn" data-print>Imprimer</button>`);
  paint(el.view, `
  <div class="doc">
    <section class="panel">
      <h3>Ce qui protège en cas de litige</h3>
      <p style="margin-bottom:12px">Points systématiquement reprochés après coup — à renseigner à chaque intervention.</p>
      <ol>${VIGILANCE.map((v) => `<li>${esc(v)}</li>`).join('')}</ol>
    </section>

    <section class="panel">
      <h3>Comment ça marche</h3>
      <dl>
        <dt>Saisie</dt><dd>Toutes les cases blanches se remplissent directement dans le tableau. L'enregistrement est automatique.</dd>
        <dt>Cases OK/NOK</dt><dd>Un clic fait défiler <b>OK → NOK → N-A → vide</b>. Au clavier : touches <b>O</b>, <b>N</b>, <b>A</b>.</dd>
        <dt>Colonnes calculées</dt><dd>Échéance, statut, conformité et alerte stock se recalculent seuls. Rien à taper dedans.</dd>
        <dt>Fiche de ligne</dt><dd>Le bouton numéroté en début de ligne ouvre la ligne entière en plein écran — pratique sur tablette, et c'est là qu'on supprime une ligne.</dd>
        <dt>Clavier</dt><dd><b>Entrée</b> ou <b>↓</b> descend d'une ligne, <b>↑</b> remonte, <b>Tab</b> passe à la colonne suivante.</dd>
        <dt>Recherche</dt><dd>Filtre les lignes du tableau affiché, sur toutes les colonnes à la fois.</dd>
        <dt>Où sont les données</dt><dd>Dans ce navigateur, sur ce poste. Rien n'est envoyé sur Internet.</dd>
        <dt>Sauvegarde</dt><dd><b>Sauvegarde .json</b> (colonne de gauche) écrit un fichier de secours ; <b>Restaurer</b> le relit. À faire une fois par mois, sur le réseau ou une clé USB.</dd>
        <dt>Excel</dt><dd><b>CSV</b> sur chaque tableau : le fichier s'ouvre directement dans Excel.</dd>
        <dt>Impression</dt><dd><b>Imprimer</b> sort le tableau en paysage A4 sans l'interface — pour signature papier.</dd>
      </dl>
    </section>

    <section class="panel">
      <h3>Règle de l'atelier</h3>
      <p>Toute case <b>NOK</b> du pointage hebdomadaire doit générer une ligne dans le <b>journal des pannes</b>.
      Tout remplacement de pièce doit générer une ligne dans l'<b>historique</b> — on ajoute, on n'efface jamais.</p>
      <div style="margin-top:14px; display:flex; gap:8px; flex-wrap:wrap">
        <button type="button" class="btn" data-go="pannes">Journal des pannes</button>
        <button type="button" class="btn" data-go="dtf_historique">Historique</button>
      </div>
    </section>
  </div>`);
}

/* --------------------------------------------------------------- TABLE --- */

function cellHtml(col, row, i) {
  const v = row[col.key] ?? '';
  const isDate = col.type === 'date' || col.type === 'datetime';
  const cls = 'cell' + (col.mono ? ' cell--mono' : '') + (col.type === 'num' ? ' cell--num' : '')
    + (isDate ? ' cell--date' : '') + (isDate && !v ? ' is-empty' : '');
  const at = `data-k="${esc(col.key)}" data-i="${i}"`;

  switch (col.type) {
    case 'calc': {
      const c = col.calc(row);
      return `<span class="tag" data-t="${c.tone}">${esc(c.text)}</span>`;
    }
    case 'tri':
      return `<button type="button" class="tri" ${at} data-v="${esc(v)}"
        aria-label="${esc(col.label)}">${esc(v || '·')}</button>`;
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
  const flagged = spec.flag && spec.flag(row);
  let left = 44;
  const tds = spec.columns.map((c, ci) => {
    const isLastStick = c.stick && spec.columns[ci + 1] && !spec.columns[ci + 1].stick;
    const cls = [c.type === 'calc' ? 'ro' : '', c.stick ? 'stick' : '', isLastStick ? 'stick--last' : '']
      .filter(Boolean).join(' ');
    const style = c.stick ? ` style="left:${left}px"` : '';
    if (c.stick) left += c.w;
    return `<td class="${cls}"${style}>${cellHtml(c, row, i)}</td>`;
  }).join('');
  return `<tr data-i="${i}"${flagged ? ' class="is-flag"' : ''}>
    <td class="stick" style="left:0">
      <button type="button" class="rowbtn" data-edit="${i}" title="Ouvrir la fiche">${i + 1}</button>
    </td>${tds}</tr>`;
}

function headHtml(spec) {
  const hasGroups = spec.columns.some((c) => c.group);
  let groups = '';
  if (hasGroups) {
    // La cellule de tête reste figée et porte le libellé du 1er groupe : le
    // bandeau ne glisse plus sous les colonnes gelées au défilement latéral.
    const cells = [`<th class="g-lead stick" style="left:0"><span>${esc(spec.columns[0].group || '')}</span></th>`];
    let k = 0;
    while (k < spec.columns.length) {
      const g = spec.columns[k].group;
      let n = 1;
      while (k + n < spec.columns.length && spec.columns[k + n].group === g) n++;
      const label = k === 0 ? '' : esc(g || '');
      cells.push(`<th class="${g ? '' : 'g-empty'}" colspan="${n}">${label}</th>`);
      k += n;
    }
    groups = `<tr class="groups">${cells.join('')}</tr>`;
  }
  let left = 44;
  const ths = spec.columns.map((c) => {
    const isStick = !!c.stick;
    const style = isStick ? ` style="left:${left}px"` : '';
    if (isStick) left += c.w;
    return `<th${isStick ? ' class="stick"' : ''}${style} title="${esc(c.label)}">${esc(c.short || c.label)}</th>`;
  }).join('');
  return `<thead>${groups}
    <tr class="heads"><th class="stick" style="left:0">#</th>${ths}</tr></thead>`;
}

function matches(spec, row) {
  if (onlyAlerts && spec.flag && !spec.flag(row)) return false;
  if (!filter) return true;
  const q = filter.toLowerCase();
  return spec.columns.some((c) => String(row[c.key] ?? '').toLowerCase().includes(q));
}

function renderTable(spec) {
  setCrumb(spec.machine, spec.title, true);

  paint(el.tools, `
    <label class="search"><input type="search" id="q" aria-label="Rechercher dans le tableau"
      placeholder="Rechercher…" value="${esc(filter)}" autocomplete="off"></label>
    ${spec.flag ? `<label class="toggle no-print"><input type="checkbox" id="onlyAlerts"${onlyAlerts ? ' checked' : ''}> Alertes</label>` : ''}
    <button type="button" class="btn btn--signal" id="btnAdd">+ Ligne</button>
    <button type="button" class="btn btn--icon" id="btnCsv" title="Export CSV pour Excel">CSV</button>
    <button type="button" class="btn btn--icon" data-print title="Imprimer le tableau">Imprimer</button>`);

  const rows = Store.rows(spec.id);
  const visible = rows.map((r, i) => [r, i]).filter((p) => matches(spec, p[0]));
  const total = spec.columns.reduce((s, c) => s + c.w, 44);
  const frozen = spec.columns.reduce((s, c) => s + (c.stick ? c.w : 0), 44);

  paint(el.view, `
    <section class="panel">
      <div class="panel__head">
        <h2>${esc(spec.title)}</h2>
        <p>${esc(spec.subtitle)}</p>
      </div>
      <div class="tablewrap" id="wrap">
        <table class="grid${spec.columns.some((c) => c.group) ? ' has-groups' : ''}" style="min-width:${total}px; --frozen:${frozen}px">
          <colgroup><col style="width:44px">${spec.columns.map((c) => `<col style="width:${c.w}px">`).join('')}</colgroup>
          ${headHtml(spec)}
          <tbody id="tb">${visible.map((p) => rowHtml(spec, p[0], p[1])).join('')}</tbody>
        </table>
        ${visible.length ? '' : `<div class="empty"><strong>Aucune ligne</strong>
          ${rows.length ? 'Aucun résultat pour ce filtre.' : `Rien de consigné pour l'instant.
            <div style="margin-top:14px"><button type="button" class="btn btn--signal" data-addrow>Ajouter une ${esc(spec.rowLabel)}</button></div>`}
        </div>`}
      </div>
      <div class="panel__foot">
        <span>${visible.length} / ${rows.length} ligne${rows.length > 1 ? 's' : ''}</span>
        <span>·</span><span>${spec.columns.length} colonnes</span>
        <span class="foot-note">Enregistrement automatique dans ce navigateur</span>
      </div>
    </section>`);

  bindTable(spec);
}

/* --------------------------------------------------------- INTERACTION --- */

let navRefresh = null;

function afterChange(spec, i, tr) {
  const row = Store.rows(spec.id)[i];
  if (!row || !tr) return;
  spec.columns.forEach((c, ci) => {
    if (c.type !== 'calc') return;
    const res = c.calc(row);
    const td = tr.children[ci + 1];
    if (td) paint(td, `<span class="tag" data-t="${res.tone}">${esc(res.text)}</span>`);
  });
  tr.classList.toggle('is-flag', !!(spec.flag && spec.flag(row)));
  clearTimeout(navRefresh);
  navRefresh = setTimeout(renderNav, 500);
}

function bindTable(spec) {
  const tb = $('#tb');

  const write = (e) => {
    const t = e.target;
    if (!t.dataset || !t.dataset.k) return;
    const i = +t.dataset.i;
    Store.set(spec.id, i, t.dataset.k, t.value);
    if (t.tagName === 'INPUT' && t.type === 'text') t.title = t.value;
    if (t.classList.contains('cell--date')) t.classList.toggle('is-empty', !t.value);
    afterChange(spec, i, t.closest('tr'));
  };
  tb.addEventListener('input', write);
  tb.addEventListener('change', write);

  tb.addEventListener('click', (e) => {
    const tri = e.target.closest('.tri');
    if (tri) { setTri(spec, tri, TRI[(TRI.indexOf(tri.dataset.v || '') + 1) % TRI.length]); return; }
    const edit = e.target.closest('[data-edit]');
    if (edit) openRow(spec, +edit.dataset.edit);
  });

  tb.addEventListener('keydown', (e) => {
    const t = e.target;
    if (!t.dataset || !t.dataset.k) return;

    if (t.classList.contains('tri')) {
      const map = { o: 'OK', n: 'NOK', a: 'N-A', backspace: '', delete: '' };
      const k = e.key.toLowerCase();
      if (k in map) { e.preventDefault(); setTri(spec, t, map[k]); return; }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const cells = [...t.closest('tr').querySelectorAll('[data-k]')];
        const n = cells[cells.indexOf(t) + (e.key === 'ArrowRight' ? 1 : -1)];
        if (n) n.focus();
        return;
      }
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || (e.key === 'Enter' && t.tagName !== 'SELECT')) {
      const sib = e.key === 'ArrowUp' ? t.closest('tr').previousElementSibling : t.closest('tr').nextElementSibling;
      if (!sib) return;
      const target = sib.querySelector(`[data-k="${t.dataset.k}"]`);
      if (!target) return;
      e.preventDefault();
      target.focus();
      if (target.select) { try { target.select(); } catch (_) { /* type=date */ } }
    }
  });

  $('#q').addEventListener('input', (e) => {
    filter = e.target.value;
    const pos = e.target.selectionStart;
    renderTable(spec);
    const q = $('#q');
    q.focus();
    try { q.setSelectionRange(pos, pos); } catch (_) { /* type=search */ }
  });

  const oa = $('#onlyAlerts');
  if (oa) oa.addEventListener('change', (e) => { onlyAlerts = e.target.checked; renderTable(spec); });

  const addRow = () => {
    const row = spec.addRow ? spec.addRow() : {};
    let i;
    if (spec.prepend) { Store.insert(spec.id, 0, row); i = 0; }
    else i = Store.add(spec.id, row);
    filter = ''; onlyAlerts = false;
    renderTable(spec);
    openRow(spec, i);
  };
  $('#btnAdd').addEventListener('click', addRow);
  const cta = el.view.querySelector('[data-addrow]');
  if (cta) cta.addEventListener('click', addRow);

  $('#btnCsv').addEventListener('click', () => { Store.exportCsv(spec.id); toast('Export CSV généré'); });
}

function setTri(spec, btn, value) {
  btn.dataset.v = value;
  btn.textContent = value || '·';
  Store.set(spec.id, +btn.dataset.i, btn.dataset.k, value);
  afterChange(spec, +btn.dataset.i, btn.closest('tr'));
}

/* ------------------------------------------------------ FICHE DE LIGNE --- */

function openRow(spec, i) {
  const row = Store.rows(spec.id)[i];
  if (!row) return;

  const groups = [];
  for (const c of spec.columns) {
    const g = c.group || '';
    const last = groups[groups.length - 1];
    if (last && last.g === g) last.cols.push(c);
    else groups.push({ g, cols: [c] });
  }

  const field = (c) => {
    const v = esc(row[c.key] ?? '');
    const id = 'f_' + c.key;
    const k = esc(c.key);
    let input;
    switch (c.type) {
      case 'calc': {
        const r = c.calc(row);
        input = `<div style="padding:9px 0"><span class="tag" data-t="${r.tone}" style="margin:0">${esc(r.text)}</span></div>`;
        break;
      }
      case 'tri':
        input = `<div class="trirow" data-k="${k}">${['OK', 'NOK', 'N-A'].map((o) =>
          `<button type="button" data-v="${o}" aria-pressed="${(row[c.key] || '') === o}">${o}</button>`).join('')}</div>`;
        break;
      case 'select':
        input = `<select id="${id}" data-k="${k}"><option value=""></option>${c.options.map((o) =>
          `<option${o === row[c.key] ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
        break;
      case 'long':      input = `<textarea id="${id}" data-k="${k}">${v}</textarea>`; break;
      case 'date':      input = `<input type="date" id="${id}" data-k="${k}" value="${v}">`; break;
      case 'datetime':  input = `<input type="datetime-local" id="${id}" data-k="${k}" value="${v}">`; break;
      case 'num':       input = `<input type="text" inputmode="decimal" id="${id}" data-k="${k}" value="${v}">`; break;
      default:          input = `<input type="text" id="${id}" data-k="${k}" value="${v}">`;
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
        ${groups.map((g) => `
          ${g.g ? `<div class="legend">${esc(g.g)}</div>` : ''}
          <div class="fieldset${g.cols.length === 1 && g.cols[0].type === 'long' ? ' fieldset--full' : ''}">
            ${g.cols.map(field).join('')}
          </div>`).join('')}
      </div>
      <div class="modal__foot">
        <button type="button" class="btn btn--danger" data-del>Supprimer la ligne</button>
        <button type="button" class="btn btn--primary" data-close>Terminé</button>
      </div>
    </div>`);

  const body = $('#mbody');
  const sync = (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.k) Store.set(spec.id, i, t.dataset.k, t.value);
  };
  body.addEventListener('input', sync);
  body.addEventListener('change', sync);
  body.addEventListener('click', (e) => {
    const b = e.target.closest('.trirow button');
    if (!b) return;
    const wrap = b.parentElement;
    const on = b.getAttribute('aria-pressed') === 'true';
    [...wrap.children].forEach((x) => x.setAttribute('aria-pressed', 'false'));
    if (!on) b.setAttribute('aria-pressed', 'true');
    Store.set(spec.id, i, wrap.dataset.k, on ? '' : b.dataset.v);
  });

  el.modal.onclick = (e) => {
    if (e.target.closest('[data-del]')) {
      if (confirm(`Supprimer définitivement la ${spec.rowLabel} n°${i + 1} ?`)) {
        Store.remove(spec.id, i);
        closeModal();
        toast('Ligne supprimée');
      }
      return;
    }
    if (e.target === el.modal || e.target.closest('[data-close]')) closeModal();
  };

  if (window.matchMedia('(min-width: 861px)').matches) {
    const first = body.querySelector('input, select, textarea, .trirow button');
    if (first) first.focus();
  }
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
  if (!g) return;
  const focusRow = g.dataset.focus;
  go(g.dataset.go);
  if (focusRow != null) {
    setTimeout(() => {
      const tr = document.querySelector(`#tb tr[data-i="${focusRow}"]`);
      if (!tr) return;
      tr.scrollIntoView({ block: 'center' });
      const cell = tr.querySelector('.tri');
      if (cell) cell.focus();
    }, 40);
  }
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
