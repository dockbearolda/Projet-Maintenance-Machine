/* Vérification bout en bout du serveur de partage : deux postes, une ligne, et
   tout ce qui doit survivre — reprise d'envoi, coalescence, redémarrage, fichier
   illisible. Aucune dépendance : `node test/serveur.mjs` depuis la racine.

   Chaque cas ici correspond à un défaut rencontré, pas à une précaution
   théorique. Le serveur est lancé pour de vrai, sur un dossier temporaire. */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = process.argv[2] || path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA = mkdtempSync(path.join(tmpdir(), 'atelier-'));
const PORT = 8791;
const BASE = `http://127.0.0.1:${PORT}`;
const CODE = 'atelier-2026';

let echecs = 0;
const ok = (nom, cond, detail) => {
  console.log(`${cond ? '  ok  ' : ' ÉCHEC'} ${nom}${cond || detail === undefined ? '' : ' → ' + JSON.stringify(detail)}`);
  if (!cond) echecs++;
};

function demarre() {
  const p = spawn('node', [path.join(RACINE, 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, CODE_ATELIER: CODE },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  p.stdout.on('data', (d) => process.stdout.write('    [srv] ' + d));
  p.stderr.on('data', (d) => process.stdout.write('    [srv!] ' + d));
  return p;
}

const attends = async () => {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + '/api/sante'); if (r.ok) return; } catch (_) { /* pas encore */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('serveur muet');
};

const appel = (chemin, options = {}, code = CODE) => fetch(BASE + chemin, {
  ...options,
  headers: { 'Content-Type': 'application/json', ...(code ? { 'X-Code-Atelier': code } : {}), ...(options.headers || {}) },
});
const envoie = (mutations, code = CODE) =>
  appel('/api/ops', { method: 'POST', body: JSON.stringify({ mutations }) }, code).then((r) => r.json());
const etat = (code = CODE) => appel('/api/etat', {}, code).then((r) => r.json());

const T = 'trotec_nettoyage';
const ligne = (id, valeurs, poste) => ({
  mid: 'm-' + id, op: 'ajout', table: T, row: id, valeurs, prepend: true,
  t: new Date().toISOString(), poste, resume: 'test',
});

let srv = demarre();
try {
  await attends();

  /* ---- code d'atelier -------------------------------------------------- */
  ok('sonde accessible sans code', (await (await fetch(BASE + '/api/sante')).json()).code === true);
  ok('lecture refusée sans code', (await appel('/api/etat', {}, '')).status === 401);
  ok('lecture refusée avec mauvais code', (await appel('/api/etat', {}, 'zzz')).status === 401);
  ok('lecture acceptée avec le bon code', (await appel('/api/etat')).status === 200);

  /* Un poste neuf n'envoie pas de seq. Sur un serveur encore à zéro, prendre
     l'absence pour un 0 lui répondrait « rien n'a bougé » et il repartirait
     sans jamais recevoir l'état de départ. */
  const neuf = await etat();
  ok('un poste sans seq reçoit l’état complet', !neuf.inchange && !!neuf.tables, neuf);

  /* ---- poste A ajoute, poste B voit ------------------------------------ */
  await envoie([ligne('r1', { date: '2026-08-12T09:00', tech: 'Léa' }, 'tablette')]);
  let e = await etat();
  ok('la ligne du poste A est visible du poste B', e.tables[T].length === 1 && e.tables[T][0].tech === 'Léa');
  const seq1 = e.seq;

  /* ---- rejeu d'un envoi non acquitté ----------------------------------- */
  const r = await envoie([ligne('r1', { date: '2026-08-12T09:00', tech: 'Léa' }, 'tablette')]);
  e = await etat();
  ok('un envoi rejoué ne duplique pas la ligne', e.tables[T].length === 1, r);
  ok('seq ne bouge pas pour rien', e.seq === seq1);

  /* ---- inchangé -------------------------------------------------------- */
  const inch = await appel(`/api/etat?seq=${e.seq}`).then((x) => x.json());
  ok('réponse courte quand rien n’a bougé', inch.inchange === true && !inch.tables);

  /* ---- coalescence d'une frappe ---------------------------------------- */
  const mid = 'm-frappe';
  const frappe = (apres) => ({ mid, op: 'modif', table: T, row: 'r1', champ: 'obs', avant: '', apres, t: new Date().toISOString(), poste: 'pc', resume: 'test' });
  await envoie([frappe('turb')]);
  await envoie([frappe('turbine')]);
  e = await etat();
  const modifs = e.journal.filter((x) => x.op === 'modif');
  ok('la frappe ne fait qu’une entrée de journal', modifs.length === 1, modifs);
  ok('l’entrée porte la valeur finale', modifs[0]?.apres === 'turbine' && modifs[0]?.avant === '');
  ok('la cellule vaut la valeur finale', e.tables[T][0].obs === 'turbine');

  await envoie([frappe('')]);
  e = await etat();
  ok('revenu au point de départ, l’entrée disparaît', e.journal.filter((x) => x.op === 'modif').length === 0);
  ok('et la cellule est bien revidée', e.tables[T][0].obs === '');

  /* ---- corbeille et remise en place ------------------------------------ */
  await envoie([{ mid: 'm-corb', op: 'corbeille', table: T, row: 'r1', t: new Date().toISOString(), poste: 'pc', resume: 'test' }]);
  e = await etat();
  ok('la ligne quitte le tableau', e.tables[T].length === 0);
  ok('et se retrouve dans la corbeille', e.trash.length === 1 && e.trash[0].row._id === 'r1');

  await envoie([{ mid: 'm-rest', op: 'restauration', table: T, row: 'r1', prepend: true, t: new Date().toISOString(), poste: 'pc', resume: 'test' }]);
  e = await etat();
  ok('elle se remet en place', e.tables[T].length === 1 && e.trash.length === 0);
  ok('avec ses valeurs', e.tables[T][0].tech === 'Léa');

  /* ---- ordre et concurrence -------------------------------------------- */
  await Promise.all([
    envoie([ligne('r2', { tech: 'A' }, 'tablette')]),
    envoie([ligne('r3', { tech: 'B' }, 'pc')]),
    envoie([ligne('r4', { tech: 'C' }, 'portable')]),
  ]);
  e = await etat();
  ok('trois postes écrivent en même temps sans perte', e.tables[T].length === 4, e.tables[T].map((x) => x._id));

  /* ---- journal en ajout seul ------------------------------------------- */
  const avantJ = e.journal.length;
  const partiel = await appel(`/api/etat?j=${avantJ - 2}`).then((x) => x.json());
  ok('le journal se relit par tranches', partiel.journal.length === 2 && partiel.jTotal === avantJ, { recu: partiel.journal.length, total: partiel.jTotal });

  /* ---- statique --------------------------------------------------------- */
  const idx = await fetch(BASE + '/');
  ok('la page se sert', idx.ok && (await idx.text()).includes('Plan de'));
  ok('les assets se servent', (await fetch(BASE + '/assets/js/sync.js')).ok);
  const fuite = await fetch(BASE + '/server.js');
  ok('server.js n’est pas servable', (await fuite.text()).includes('<!doctype html'));
  const remonte = await fetch(BASE + '/assets/../server.js');
  ok('la remontée de dossier ne sort pas d’assets', (await remonte.text()).includes('<!doctype html'));
  ok('une URL inconnue retombe sur la page', (await (await fetch(BASE + '/#/journal')).text()).includes('<!doctype html'));

  /* ---- redémarrage ------------------------------------------------------ */
  const seqAvant = e.seq;
  srv.kill('SIGTERM');
  await new Promise((r) => srv.on('exit', r));
  srv = demarre();
  await attends();
  e = await etat();
  ok('les données survivent au redémarrage', e.tables[T].length === 4 && e.seq === seqAvant, { lignes: e.tables[T].length, seq: e.seq });
  ok('le journal aussi', e.journal.length === avantJ);

  await envoie([ligne('r5', { tech: 'D' }, 'pc')]);
  e = await etat();
  ok('un mid déjà vu avant redémarrage reste connu', (await envoie([ligne('r5', { tech: 'D' }, 'pc')])).appliquees === 0);

  const copies = readdirSync(DATA).filter((f) => /^atelier-\d{4}-\d\d-\d\d\.json$/.test(f));
  ok('une copie datée existe sur le volume', copies.length === 1, copies);

  /* ---- fichier illisible ------------------------------------------------ */
  srv.kill('SIGTERM');
  await new Promise((r) => srv.on('exit', r));
  const { writeFileSync } = await import('node:fs');
  const bon = readFileSync(path.join(DATA, 'atelier.json'), 'utf8');
  writeFileSync(path.join(DATA, 'atelier.json'), '{ceci n\'est pas du json');
  srv = demarre();
  await attends();
  const mis = readdirSync(DATA).filter((f) => f.includes('.corrompu-'));
  ok('un fichier illisible est mis de côté, pas écrasé', mis.length === 1, mis);
  ok('et son contenu est intact', readFileSync(path.join(DATA, mis[0]), 'utf8').startsWith('{ceci'));
  ok('le serveur repart quand même', (await etat()).seq === 0);
  void bon;

} finally {
  srv.kill('SIGTERM');
  rmSync(DATA, { recursive: true, force: true });
}

console.log(echecs ? `\n${echecs} test(s) en échec.` : '\nTous les tests passent.');
process.exit(echecs ? 1 : 0);
