'use strict';

grist.ready({requiredAccess: 'full'});

const $ = q => document.querySelector(q);
const $$ = q => [...document.querySelectorAll(q)];
const VERSION = '0.3.0';
const SCHEMA = 'grist-acl-studio/v1';

const state = {
  resources: [], rules: [], tables: [], columns: [],
  tableByRef: new Map(), columnsByTable: new Map(),
  selectedTable: null, imported: null, validation: null, diff: [],
  expert: false,
};

function rows(table) {
  if (!table?.id) return [];
  const cols = Object.keys(table).filter(k => k !== 'id');
  return table.id.map((id, i) => Object.fromEntries([['id', id], ...cols.map(k => [k, table[k][i]])]));
}

function text(v) { return v == null ? '' : String(v); }
function esc(v) { return text(v).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function nowStamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function canonCols(v) {
  const s = text(v).trim();
  if (!s || s === '*') return '*';
  return s.split(',').map(x => x.trim()).filter(Boolean).sort().join(',');
}
function resourceKey(table, columns) { return `${text(table).trim()}::${canonCols(columns)}`; }
function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

function status(message, kind='ok', timeout=4500) {
  const el = $('#status');
  el.hidden = false;
  el.className = `status ${kind}`;
  el.textContent = message;
  clearTimeout(status.timer);
  if (timeout) status.timer = setTimeout(() => el.hidden = true, timeout);
}

function download(name, content, type='application/json;charset=utf-8') {
  const blob = new Blob([content], {type});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function fetchRows(name) { return rows(await grist.docApi.fetchTable(name)); }

async function loadDocument() {
  $('#reloadBtn').disabled = true;
  status('Lecture des permissions…', 'warn', 0);
  try {
    const [resources, rules, tables, columns] = await Promise.all([
      fetchRows('_grist_ACLResources'),
      fetchRows('_grist_ACLRules'),
      fetchRows('_grist_Tables'),
      fetchRows('_grist_Tables_column')
    ]);

    Object.assign(state, {resources, rules, tables, columns});
    state.tableByRef = new Map(tables.map(t => [Number(t.id), t]));
    state.columnsByTable = new Map();

    for (const col of columns) {
      const table = state.tableByRef.get(Number(col.parentId));
      if (!table) continue;
      if (!state.columnsByTable.has(table.tableId)) state.columnsByTable.set(table.tableId, []);
      state.columnsByTable.get(table.tableId).push(col);
    }

    const available = userTables();
    if (!state.selectedTable || !available.some(t => t.id === state.selectedTable)) {
      const firstProtected = available.find(t => t.ruleCount > 0);
      state.selectedTable = firstProtected?.id || available[0]?.id || null;
    }

    $('#accessBadge').className = 'badge ok';
    $('#accessBadge').textContent = 'Accès complet';
    $('#status').hidden = true;
    render();
  } catch (e) {
    console.error(e);
    $('#accessBadge').className = 'badge warn';
    $('#accessBadge').textContent = 'Lecture impossible';
    status(`Impossible de lire les permissions : ${e.message || e}`, 'error', 0);
  } finally {
    $('#reloadBtn').disabled = false;
  }
}

function userTables() {
  const counts = new Map();
  for (const resource of state.resources) {
    const table = text(resource.tableId);
    counts.set(table, (counts.get(table) || 0) + rulesForResource(resource.id).length);
  }

  const items = state.tables
    .filter(t => !text(t.tableId).startsWith('_grist_'))
    .map(t => ({id:text(t.tableId), ruleCount:counts.get(text(t.tableId)) || 0}));

  if (state.resources.some(r => text(r.tableId) === '*')) {
    items.unshift({id:'*', ruleCount:counts.get('*') || 0, label:'Document entier'});
  }

  return items;
}

function rulesForResource(id) {
  return state.rules
    .filter(r => Number(r.resource) === Number(id) && !text(r.userAttributes).trim())
    .sort((a,b) => (Number(a.rulePos) || a.id) - (Number(b.rulePos) || b.id));
}

function resourcesForTable(tableId) {
  return state.resources.filter(r => text(r.tableId) === tableId);
}

function getUserAttributeRules() {
  return state.rules.filter(r => text(r.userAttributes).trim());
}

function permissionTokens(value) {
  const s = text(value).trim();
  if (s === 'all') return [{kind:'grant', chars:'CRUDS'}];
  if (s === 'none') return [{kind:'deny', chars:'CRUDS'}];
  const out = [];
  const re = /([+-])([CRUDS]+)/g;
  let m;
  while ((m = re.exec(s))) out.push({kind:m[1] === '+' ? 'grant' : 'deny', chars:m[2]});
  return out;
}

function permissionPills(value) {
  const labels = {R:'Voir', C:'Créer', U:'Modifier', D:'Supprimer', S:'Schéma'};
  const tokens = permissionTokens(value);
  if (!tokens.length) return `<span class="perm-pill deny">${esc(value || '—')}</span>`;
  return tokens.flatMap(token =>
    [...token.chars].map(ch =>
      `<span class="perm-pill ${token.kind === 'deny' ? 'deny' : ch.toLowerCase()}">${token.kind === 'deny' ? '−' : '+'} ${labels[ch] || ch}</span>`
    )
  ).join('');
}

function ruleAudience(rule) {
  const formula = text(rule?.aclFormula ?? rule?.when);
  const labels = [];

  if (/user\.Access\s*==\s*OWNER|OWNER\s*==\s*user\.Access/i.test(formula)) labels.push('Propriétaire');

  const profileEq = formula.match(/PROFIL\s*==\s*["']([^"']+)["']/i);
  if (profileEq) labels.push(profileEq[1]);

  const profileIn = formula.match(/PROFIL\s+in\s+\[([^\]]+)\]/i);
  if (profileIn) {
    const names = [...profileIn[1].matchAll(/["']([^"']+)["']/g)].map(m => m[1]);
    if (names.length) labels.push(names.join(' / '));
  }

  if (/UNITE_SOCLE\s*==\s*["']BRAVO["']/i.test(formula)) labels.push('Socle BRAVO');
  if (/SUPER_AUTO/i.test(formula)) labels.push('SUPER AUTO');
  if (/user\.Email\s*==\s*rec\.Email|rec\.Email\s*==\s*user\.Email/i.test(formula)) labels.push('Utilisateur concerné');
  if (!formula.trim()) labels.push('Règle de repli');

  if (!labels.length) {
    const memo = text(rule?.memo || rule?.label).trim();
    return memo || 'Autre règle';
  }
  return [...new Set(labels)].join(' · ');
}

function ruleScope(rule) {
  const formula = text(rule?.aclFormula ?? rule?.when);
  const bits = [];

  if (/DROITS\s*==\s*["']Modification["']/i.test(formula)) bits.push('si droit Modification');
  if (/rec\.GTG\s*==\s*user\.UTIL\.GTG/i.test(formula)) bits.push('sur son GTG');
  if (/newRec\.GTG\s*==\s*user\.UTIL\.GTG/i.test(formula)) bits.push('sans déplacer vers un autre GTG');
  if (/rec\.UNITE\s*==\s*user\.UTIL\.UNITE/i.test(formula)) bits.push('sur son unité');
  if (/rec\.TYPE\s*==\s*["']VCB["']/i.test(formula)) bits.push('pour les VCB');
  if (/UNITE_ACTIF\s*==\s*True/i.test(formula)) bits.push('si unité active');

  return bits;
}

function actionLabel(ch) {
  return {R:'Voir', C:'Créer', U:'Modifier', D:'Supprimer', S:'Schéma'}[ch] || ch;
}

function actionIcon(ch, kind) {
  if (kind === 'deny') return '⛔';
  return {R:'👁', C:'➕', U:'✏️', D:'🗑️', S:'⚙️'}[ch] || '•';
}

function normalizeExportRule(r) {
  return {
    label: text(r.memo).trim() || ruleAudience(r),
    explanation: '',
    when: text(r.aclFormula),
    permissions: text(r.permissionsText) || 'none',
    ...(text(r.memo) ? {memo:text(r.memo)} : {}),
    ...(text(r.principals) ? {principals:text(r.principals)} : {}),
  };
}

function buildCurrentPolicy() {
  return {
    schema: SCHEMA,
    version: 1,
    title: 'Export des ACL actuelles',
    description: 'Export généré par Grist ACL Studio.',
    mode: 'replace-resources',
    generatedAt: new Date().toISOString(),
    userAttributes: getUserAttributeRules().map(r => ({
      id:r.id,
      userAttributes:text(r.userAttributes),
      when:text(r.aclFormula),
      permissions:text(r.permissionsText),
      memo:text(r.memo)
    })),
    resources: state.resources.map(resource => ({
      table:text(resource.tableId),
      columns:canonCols(resource.colIds),
      rules:rulesForResource(resource.id).map(normalizeExportRule)
    }))
  };
}

function isAclUsefulColumn(col) {
  const id = text(col?.colId).trim();
  const type = text(col?.type).trim();
  return Boolean(id) && id !== 'manualSort' && type !== 'ManualSortPos' && !id.startsWith('gristHelper_');
}

function documentSchemaForAI() {
  return Object.fromEntries(
    state.tables
      .filter(t => !text(t.tableId).startsWith('_grist_'))
      .map(t => [
        t.tableId,
        (state.columnsByTable.get(t.tableId) || [])
          .filter(isAclUsefulColumn)
          .map(c => `${c.colId}:${c.type}`)
      ])
  );
}

function currentAclForAI() {
  return {
    userAttributes: getUserAttributeRules().map(r => ({
      definition:text(r.userAttributes),
      when:text(r.aclFormula),
      ...(text(r.memo) ? {memo:text(r.memo)} : {})
    })),
    resources: state.resources.map(resource => ({
      table:text(resource.tableId),
      columns:canonCols(resource.colIds),
      rules:rulesForResource(resource.id).map(r => ({
        when:text(r.aclFormula),
        permissions:text(r.permissionsText) || 'none',
        ...(text(r.memo) ? {memo:text(r.memo)} : {}),
        ...(text(r.principals) ? {principals:text(r.principals)} : {})
      }))
    }))
  };
}

function buildAiPrompt() {
  return `Tu es expert des règles d'accès avancées de Grist.

MISSION
À partir de la structure et des ACL actuelles ci-dessous, produis le JSON à importer dans Grist ACL Studio selon le besoin que je vais te décrire dans mon prochain message.

RÈGLES
- Utilise uniquement les tables et colonnes listées dans STRUCTURE.
- Chaque ressource présente dans le JSON remplace toutes les règles actuelles de cette même ressource.
- Recopie donc toute règle existante à conserver.
- Place une règle Owner en premier : "user.Access == OWNER" avec "all".
- Conserve les attributs utilisateur existants sauf demande contraire.
- "when": "" signifie règle de repli.
- permissions : "all", "none" ou syntaxe Grist (+R, +CU, +R-CUD, -D...).
- Ajoute un label court et une explanation simple en français à chaque règle.
- Réponds UNIQUEMENT par un objet JSON valide, sans markdown.

FORMAT
{
  "schema": "${SCHEMA}",
  "version": 1,
  "title": "Titre",
  "description": "Résumé simple",
  "mode": "replace-resources",
  "resources": [{
    "table": "TABLE_ID",
    "columns": "*",
    "description": "Objet de la ressource",
    "rules": [{
      "label": "Owner",
      "explanation": "Le propriétaire garde tous les droits.",
      "when": "user.Access == OWNER",
      "permissions": "all"
    }]
  }]
}

STRUCTURE
${JSON.stringify(documentSchemaForAI(), null, 2)}

ACL_ACTUELLES
${JSON.stringify(currentAclForAI(), null, 2)}
`;
}

function render() {
  renderTableList();
  renderSelectedTable();
}

function renderTableList() {
  const query = text($('#tableSearch').value).trim().toLowerCase();
  const tables = userTables().filter(t => {
    const label = t.label || t.id;
    return !query || label.toLowerCase().includes(query);
  });

  $('#tableCount').textContent = userTables().length;
  $('#tableList').innerHTML = tables.length ? tables.map(t => {
    const label = t.label || t.id;
    return `<button class="table-btn ${state.selectedTable === t.id ? 'active' : ''}" data-table="${esc(t.id)}" type="button">
      <span class="table-name">${esc(label)}</span>
      <small>${t.ruleCount || '—'}</small>
    </button>`;
  }).join('') : '<div class="empty">Aucune table.</div>';

  $$('.table-btn').forEach(btn => btn.addEventListener('click', () => {
    state.selectedTable = btn.dataset.table;
    render();
  }));
}

function renderSelectedTable() {
  const tableId = state.selectedTable;
  if (!tableId) {
    $('#selectedTableTitle').textContent = 'Aucune table';
    $('#selectedTableMeta').textContent = '';
    $('#rulesView').innerHTML = '<div class="empty">Aucune table disponible.</div>';
    $('#summaryView').innerHTML = '';
    return;
  }

  const resources = resourcesForTable(tableId);
  const ruleCount = resources.reduce((n,r) => n + rulesForResource(r.id).length, 0);
  $('#selectedTableTitle').textContent = tableId === '*' ? 'Document entier' : tableId;
  $('#selectedTableMeta').textContent = resources.length ? `${resources.length} ressource(s) · ${ruleCount} règle(s)` : 'Aucune règle spécifique';

  if (!resources.length) {
    $('#rulesView').innerHTML = '<div class="empty">Cette table n’a pas de règle spécifique. Elle dépend des règles globales du document.</div>';
    renderSummary([]);
    return;
  }

  $('#rulesView').innerHTML = resources.map(resource => {
    const rules = rulesForResource(resource.id);
    const columns = canonCols(resource.colIds);
    return `<section class="resource-block">
      <header class="resource-head">
        <strong>${columns === '*' ? 'Toutes les colonnes' : esc(columns)}</strong>
        <span>${rules.length} règle${rules.length > 1 ? 's' : ''}</span>
      </header>
      ${rules.map(renderRuleRow).join('')}
    </section>`;
  }).join('');

  renderSummary(resources);
}

function renderRuleRow(rule) {
  const audience = ruleAudience(rule);
  const scopes = ruleScope(rule);
  const expertClass = state.expert ? 'expert visible' : 'expert';

  return `<div class="rule-row">
    <div class="rule-main">
      <div>
        <div class="rule-audience">${esc(audience)}</div>
        ${scopes.map(s => `<span class="scope-pill">${esc(s)}</span>`).join('')}
      </div>
      <div class="rule-right">${permissionPills(rule.permissionsText)}</div>
    </div>
    ${rule.memo ? `<div class="rule-explain">${esc(rule.memo)}</div>` : ''}
    <div class="${expertClass}">
      <code>${esc(rule.aclFormula || '(sans condition)')}</code>
    </div>
  </div>`;
}

function renderSummary(resources) {
  const items = [];

  for (const resource of resources) {
    for (const rule of rulesForResource(resource.id)) {
      const audience = ruleAudience(rule);
      const scopes = ruleScope(rule);
      for (const token of permissionTokens(rule.permissionsText)) {
        for (const ch of token.chars) {
          if (!['R','C','U','D'].includes(ch)) continue;
          items.push({
            audience,
            action:ch,
            kind:token.kind,
            scope:scopes.length ? scopes.join(' · ') : (token.kind === 'grant' ? 'selon cette règle' : 'refusé par cette règle'),
            columns:canonCols(resource.colIds)
          });
        }
      }
    }
  }

  if (!items.length) {
    $('#summaryView').innerHTML = '<div class="empty">Aucun droit spécifique à résumer pour cette table.</div>';
    return;
  }

  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.audience)) groups.set(item.audience, []);
    groups.get(item.audience).push(item);
  }

  $('#summaryView').innerHTML =
    '<div class="summary-note">Résumé indicatif des règles affichées. L’ordre des ACL Grist reste déterminant.</div>' +
    [...groups.entries()].map(([audience, entries]) => `<section class="summary-group">
      <div class="summary-title">${esc(audience)}</div>
      ${entries.map(entry => `<div class="summary-action">
        <span class="icon">${actionIcon(entry.action, entry.kind)}</span>
        <strong>${entry.kind === 'deny' ? 'Interdit' : actionLabel(entry.action)}</strong>
        <span>${esc(entry.scope)}${entry.columns !== '*' ? ` · ${esc(entry.columns)}` : ''}</span>
      </div>`).join('')}
    </section>`).join('');
}

function validatePermissions(v) {
  return /^(?:all|none|(?:[+-][CRUDS]+)+)$/.test(text(v).trim());
}

function hasOwnerSafety(resource) {
  return (resource.rules || []).some(r => {
    const f = text(r.when);
    const p = text(r.permissions);
    return /user\.Access/.test(f) && /(OWNER|owners)/i.test(f) &&
      (p === 'all' || (/\+/.test(p) && ['C','R','U','D'].every(ch => p.includes(ch))));
  });
}

function validatePolicy(policy) {
  const errors = [], warnings = [];
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) errors.push('Le JSON racine doit être un objet.');
  if (policy?.schema !== SCHEMA) errors.push(`schema doit être "${SCHEMA}".`);
  if (Number(policy?.version) !== 1) errors.push('version doit être 1.');
  if ((policy?.mode || 'replace-resources') !== 'replace-resources') errors.push('mode doit être "replace-resources".');
  if (!Array.isArray(policy?.resources) || !policy.resources.length) errors.push('resources doit être une liste non vide.');

  const tableIds = new Set(state.tables.map(t => text(t.tableId)));
  tableIds.add('*');
  const seen = new Set();

  for (const [ri,res] of (policy?.resources || []).entries()) {
    const prefix = `Ressource ${ri+1}`;
    const table = text(res?.table).trim();
    const cols = canonCols(res?.columns);

    if (!tableIds.has(table)) errors.push(`${prefix} : table inconnue "${table}".`);

    const key = resourceKey(table, cols);
    if (seen.has(key)) errors.push(`${prefix} : ressource dupliquée.`);
    seen.add(key);

    if (table !== '*' && cols !== '*') {
      const existingCols = new Set((state.columnsByTable.get(table) || []).map(c => text(c.colId)));
      for (const col of cols.split(',')) {
        if (!existingCols.has(col)) errors.push(`${prefix} : colonne inconnue "${table}.${col}".`);
      }
    }

    if (!Array.isArray(res?.rules) || !res.rules.length) errors.push(`${prefix} : aucune règle.`);

    for (const [i,rule] of (res?.rules || []).entries()) {
      if (typeof rule?.when !== 'string') errors.push(`${prefix}, règle ${i+1} : "when" doit être une chaîne.`);
      if (!validatePermissions(rule?.permissions)) errors.push(`${prefix}, règle ${i+1} : permissions invalides.`);
    }

    if (!hasOwnerSafety(res)) errors.push(`${prefix} : ajoute une règle Owner explicite donnant "all".`);
    if (!(res.rules || []).some(r => text(r.when) === '')) warnings.push(`${prefix} : aucune règle de repli sans condition.`);
  }

  return {valid:!errors.length, errors, warnings};
}

function comparableRules(rules) {
  return (rules || []).map(r => ({
    when:text(r.when ?? r.aclFormula),
    permissions:text(r.permissions ?? r.permissionsText),
    memo:text(r.memo),
    principals:text(r.principals)
  }));
}

function computeDiff(policy) {
  const existing = new Map();
  for (const resource of state.resources) {
    existing.set(resourceKey(resource.tableId, resource.colIds), resource);
  }

  return (policy.resources || []).map(target => {
    const key = resourceKey(target.table, target.columns);
    const current = existing.get(key);
    if (!current) return {kind:'add', target, current:null, oldCount:0, newCount:target.rules.length};

    const oldRules = rulesForResource(current.id).map(normalizeExportRule);
    const same = JSON.stringify(comparableRules(oldRules)) === JSON.stringify(comparableRules(target.rules));
    return {kind:same ? 'same' : 'change', target, current, oldCount:oldRules.length, newCount:target.rules.length};
  });
}

function validateImportedJson() {
  let policy;
  try {
    policy = JSON.parse($('#jsonInput').value);
  } catch (e) {
    showValidation({valid:false, errors:[`JSON invalide : ${e.message}`], warnings:[]});
    return;
  }

  const validation = validatePolicy(policy);
  showValidation(validation);
  if (!validation.valid) return;

  state.imported = deepClone(policy);
  state.validation = validation;
  state.diff = computeDiff(policy);

  renderDiff();
  $('#importDialog').close();
  $('#diffDialog').showModal();
}

function showValidation(validation) {
  const box = $('#validationBox');
  box.hidden = false;
  box.className = `validation ${validation.valid ? 'ok' : 'error'}`;
  box.innerHTML = `<strong>${validation.valid ? 'JSON valide' : 'JSON invalide'}</strong>
    ${validation.errors.length ? `<ul>${validation.errors.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${validation.warnings.length ? `<ul>${validation.warnings.map(x => `<li>⚠ ${esc(x)}</li>`).join('')}</ul>` : ''}`;
}

function renderDiff() {
  const changed = state.diff.filter(d => d.kind !== 'same');
  $('#diffIntro').textContent = `${changed.length} ressource(s) seront modifiées. Les autres ACL resteront intactes.`;
  $('#applyBtn').disabled = !changed.length;

  $('#diffView').innerHTML = state.diff.map(d => `<section class="diff-card ${d.kind}">
    <header>
      <strong>${esc(d.target.table)} · ${esc(canonCols(d.target.columns))}</strong>
      <span>${d.kind === 'add' ? 'Ajout' : d.kind === 'change' ? 'Remplacement' : 'Inchangé'}</span>
    </header>
    <div class="body">
      <div>${d.oldCount} règle(s) actuelle(s) → ${d.newCount} règle(s) proposée(s)</div>
      ${(d.target.rules || []).map(rule => `<div class="diff-rule">
        <strong>${esc(rule.label || ruleAudience(rule))}</strong> · ${esc(rule.permissions)}
        <div>${esc(rule.explanation || '')}</div>
        <code>${esc(rule.when || '(sans condition)')}</code>
      </div>`).join('')}
    </div>
  </section>`).join('');
}

function currentResourceMatches(target) {
  const key = resourceKey(target.table, target.columns);
  return state.resources.filter(r => resourceKey(r.tableId, r.colIds) === key);
}

async function applyImportedPolicy() {
  if (!state.imported || !state.validation?.valid) return;
  const changes = state.diff.filter(d => d.kind !== 'same');
  if (!changes.length) return;

  download(`grist-acl-backup-${nowStamp()}.json`, JSON.stringify(buildCurrentPolicy(), null, 2));
  $('#applyBtn').disabled = true;
  status('Application des permissions…', 'warn', 0);

  try {
    const actions = [];

    for (const change of changes) {
      for (const existing of currentResourceMatches(change.target)) {
        for (const rule of rulesForResource(existing.id)) {
          actions.push(['RemoveRecord', '_grist_ACLRules', rule.id]);
        }
        actions.push(['RemoveRecord', '_grist_ACLResources', existing.id]);
      }
    }

    let tempId = -1;
    for (const change of changes) {
      const res = change.target;
      const rid = tempId--;
      actions.push(['AddRecord', '_grist_ACLResources', rid, {
        tableId:text(res.table),
        colIds:canonCols(res.columns)
      }]);

      (res.rules || []).forEach((rule, index) => {
        const fields = {
          resource:rid,
          aclFormula:text(rule.when),
          permissionsText:text(rule.permissions),
          rulePos:(index + 1) * 1000
        };
        if (text(rule.memo)) fields.memo = text(rule.memo);
        if (text(rule.principals)) fields.principals = text(rule.principals);
        actions.push(['AddRecord', '_grist_ACLRules', null, fields]);
      });
    }

    await grist.docApi.applyUserActions(actions);
    state.imported = null;
    state.validation = null;
    state.diff = [];
    $('#jsonInput').value = '';
    $('#diffDialog').close();
    await loadDocument();
    status('Permissions appliquées avec succès.', 'ok', 6000);
  } catch (e) {
    console.error(e);
    status(`Échec de l'application : ${e.message || e}`, 'error', 0);
    $('#applyBtn').disabled = false;
  }
}

$('#reloadBtn').addEventListener('click', loadDocument);
$('#tableSearch').addEventListener('input', renderTableList);
$('#expertToggle').addEventListener('change', e => {
  state.expert = e.target.checked;
  renderSelectedTable();
});

$('#copyPromptBtn').addEventListener('click', async () => {
  const prompt = buildAiPrompt();
  try {
    await navigator.clipboard.writeText(prompt);
    status('Prompt copié. Colle-le dans ton IA puis décris les droits souhaités.', 'ok', 5500);
  } catch (e) {
    download(`prompt-acl-grist-${nowStamp()}.txt`, prompt, 'text/plain;charset=utf-8');
    status('Copie impossible : le prompt a été téléchargé.', 'warn');
  }
});

$('#backupBtn').addEventListener('click', () => {
  download(`grist-acl-backup-${nowStamp()}.json`, JSON.stringify(buildCurrentPolicy(), null, 2));
});

$('#importBtn').addEventListener('click', () => {
  $('#validationBox').hidden = true;
  $('#importDialog').showModal();
});

$('#loadFileBtn').addEventListener('click', () => $('#jsonFile').click());
$('#jsonFile').addEventListener('change', async e => {
  const file = e.target.files?.[0];
  if (!file) return;
  $('#jsonInput').value = await file.text();
  e.target.value = '';
});
$('#validateBtn').addEventListener('click', validateImportedJson);
$('#applyBtn').addEventListener('click', applyImportedPolicy);

loadDocument();
