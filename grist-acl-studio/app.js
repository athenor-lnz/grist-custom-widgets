'use strict';

grist.ready({requiredAccess: 'full'});

const $ = (q) => document.querySelector(q);
const $$ = (q) => [...document.querySelectorAll(q)];
const VERSION = '0.1.1';
const SCHEMA = 'grist-acl-studio/v1';

const state = {
  resources: [], rules: [], tables: [], columns: [],
  tableByRef: new Map(), columnsByTable: new Map(),
  imported: null, validation: null, diff: [], loaded: false,
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
function status(message, kind='ok', timeout=4500) {
  const el = $('#status'); el.hidden = false; el.className = `status ${kind}`; el.textContent = message;
  clearTimeout(status.timer); if (timeout) status.timer = setTimeout(() => el.hidden = true, timeout);
}
function download(name, content, type='application/json;charset=utf-8') {
  const blob = new Blob([content], {type}); const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

async function fetchRows(name) { return rows(await grist.docApi.fetchTable(name)); }

async function loadDocument() {
  $('#reloadBtn').disabled = true;
  status('Lecture des ACL et du schéma du document…', 'warn', 0);
  try {
    const [resources, rules, tables, columns] = await Promise.all([
      fetchRows('_grist_ACLResources'), fetchRows('_grist_ACLRules'), fetchRows('_grist_Tables'), fetchRows('_grist_Tables_column')
    ]);
    Object.assign(state, {resources, rules, tables, columns, loaded: true});
    state.tableByRef = new Map(tables.map(t => [t.id, t]));
    state.columnsByTable = new Map();
    for (const col of columns) {
      const table = state.tableByRef.get(Number(col.parentId));
      if (!table) continue;
      if (!state.columnsByTable.has(table.tableId)) state.columnsByTable.set(table.tableId, []);
      state.columnsByTable.get(table.tableId).push(col);
    }
    renderAll();
    $('#accessBadge').className = 'badge ok'; $('#accessBadge').textContent = 'Accès complet au document';
    $('#status').hidden = true;
  } catch (e) {
    console.error(e);
    $('#accessBadge').className = 'badge warn'; $('#accessBadge').textContent = 'ACL non accessibles';
    status(`Impossible de lire les ACL internes : ${e.message || e}. Le widget doit être utilisé avec les droits suffisants sur le document.`, 'error', 0);
  } finally { $('#reloadBtn').disabled = false; }
}

function getUserAttributeRules() { return state.rules.filter(r => text(r.userAttributes).trim()); }
function rulesForResource(id) { return state.rules.filter(r => Number(r.resource) === Number(id) && !text(r.userAttributes).trim()).sort((a,b) => (Number(a.rulePos)||a.id) - (Number(b.rulePos)||b.id)); }

function normalizeExportRule(r) {
  return {
    label: text(r.memo).trim() || 'Règle',
    explanation: '',
    when: text(r.aclFormula),
    permissions: text(r.permissionsText) || 'none',
    ...(text(r.memo) ? {memo: text(r.memo)} : {}),
    ...(text(r.principals) ? {principals: text(r.principals)} : {}),
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
      id: r.id,
      userAttributes: text(r.userAttributes),
      when: text(r.aclFormula),
      permissions: text(r.permissionsText),
      memo: text(r.memo),
    })),
    resources: state.resources.map(resource => ({
      table: text(resource.tableId),
      columns: canonCols(resource.colIds),
      description: '',
      rules: rulesForResource(resource.id).map(normalizeExportRule),
    })),
  };
}

function documentSchemaForAI() {
  return state.tables
    .filter(t => !text(t.tableId).startsWith('_grist_'))
    .map(t => ({
      table: t.tableId,
      columns: (state.columnsByTable.get(t.tableId) || []).map(c => ({id: c.colId, label: c.label, type: c.type, formula: c.isFormula ? text(c.formula) : ''}))
    }));
}

function buildAiPrompt() {
  const request = $('#aiRequest').value.trim() || '[Décris ici les droits souhaités]';
  const current = buildCurrentPolicy();
  return `Tu es expert des règles d'accès avancées de Grist.\n\nOBJECTIF UTILISATEUR\n${request}\n\nCONTRAINTE DE SORTIE\nRéponds UNIQUEMENT par un objet JSON valide, sans markdown ni commentaire autour. Le JSON doit respecter le schéma Grist ACL Studio v1 ci-dessous.\n\nRÈGLES IMPORTANTES\n- N'invente jamais un identifiant de table ou de colonne : utilise seulement ceux fournis dans STRUCTURE_DU_DOCUMENT.\n- Le widget applique le mode \"replace-resources\" : toute ressource présente dans ton JSON remplacera complètement les règles existantes de cette même ressource (même table + mêmes colonnes). Les ressources absentes restent inchangées.\n- Mets une règle Owner explicite en PREMIÈRE position de chaque ressource modifiée, accordant \"all\" ou au minimum +CRUDS.\n- Conserve toute logique que l'utilisateur demande explicitement de garder (par exemple BRAVO). Si une ressource existante doit être modifiée tout en conservant certaines règles, recopie ces règles dans la ressource JSON produite.\n- Utilise les constantes Grist usuelles (OWNER, EDITOR, VIEWER) uniquement si approprié.\n- Les permissions autorisées sont : all, none, ou des combinaisons comme +R, +CU, +R-CUD, -D.\n- Pour une règle de repli sans condition, mets \"when\": \"\".\n- Fournis toujours \"label\" et \"explanation\" en français pour que le tableau de bord soit compréhensible par un débutant.\n- Ne modifie pas les attributs utilisateur existants sauf demande explicite.\n\nFORMAT ATTENDU\n{\n  \"schema\": \"${SCHEMA}\",\n  \"version\": 1,\n  \"title\": \"Titre court\",\n  \"description\": \"Résumé de la politique\",\n  \"mode\": \"replace-resources\",\n  \"resources\": [\n    {\n      \"table\": \"TABLE_ID\",\n      \"columns\": \"*\",\n      \"description\": \"Ce que protège cette ressource\",\n      \"rules\": [\n        {\n          \"label\": \"Owner\",\n          \"explanation\": \"Le propriétaire garde tous les droits.\",\n          \"when\": \"user.Access == OWNER\",\n          \"permissions\": \"all\",\n          \"memo\": \"\"\n        }\n      ]\n    }\n  ]\n}\n\nSTRUCTURE_DU_DOCUMENT\n${JSON.stringify(documentSchemaForAI(), null, 2)}\n\nACL_ACTUELLES\n${JSON.stringify(current, null, 2)}\n`;
}

function permissionTokens(value) {
  const s = text(value).trim();
  if (s === 'all') return [{kind:'grant', chars:'CRUDS'}];
  if (s === 'none') return [{kind:'deny', chars:'CRUDS'}];
  const out=[]; const re=/([+-])([CRUDS]+)/g; let m;
  while ((m = re.exec(s))) out.push({kind:m[1] === '+' ? 'grant':'deny', chars:m[2]});
  return out;
}
function renderPermissionSet(value) {
  const tokens = permissionTokens(value);
  if (!tokens.length) return `<span class="perm deny">${esc(value || '—')}</span>`;
  return `<span class="permission-set">${tokens.flatMap(t => [...t.chars].map(ch => `<span class="perm ${t.kind==='deny'?'deny':ch.toLowerCase()}">${t.kind==='deny'?'−':'+'}${ch}</span>`)).join('')}</span>`;
}

function policyForDashboard() { return state.imported || buildCurrentPolicy(); }
function renderDashboard() {
  const policy = policyForDashboard();
  const imported = Boolean(state.imported);
  $('#dashboardTitle').textContent = imported ? `Aperçu : ${policy.title || 'Politique importée'}` : 'Lecture simplifiée des ACL actuelles';
  $('#dashboardIntro').textContent = imported ? (policy.description || 'Aperçu des règles proposées par le JSON.') : "Chaque carte explique une ressource et les règles qui s'y appliquent.";
  const resources = policy.resources || [];
  $('#kpiResources').textContent = resources.length;
  $('#kpiRules').textContent = resources.reduce((n,r)=>n+(r.rules?.length||0),0);
  $('#kpiTables').textContent = new Set(resources.map(r=>r.table).filter(t=>t && t!=='*' && !t.startsWith('_grist_'))).size;
  $('#kpiAttrs').textContent = getUserAttributeRules().length;
  $('#dashboardResources').innerHTML = resources.length ? resources.map(renderResourceCard).join('') : '<div class="empty-state">Aucune ressource ACL.</div>';
}
function renderResourceCard(resource) {
  const colLabel = canonCols(resource.columns) === '*' ? 'Toutes les colonnes' : `Colonnes : ${canonCols(resource.columns)}`;
  const rules = resource.rules || [];
  return `<article class="resource-card"><div class="resource-title"><div><strong>${esc(resource.table || '*')}</strong><small>${esc(colLabel)}</small></div><span class="badge neutral">${rules.length} règle${rules.length>1?'s':''}</span></div>${resource.description?`<div class="rule"><div class="rule-explanation">${esc(resource.description)}</div></div>`:''}${rules.map((r,i)=>`<div class="rule"><div class="rule-head"><span class="rule-label">${esc(r.label || `Règle ${i+1}`)}</span>${renderPermissionSet(r.permissions)}</div>${r.explanation?`<div class="rule-explanation">${esc(r.explanation)}</div>`:''}<code>${esc(r.when || '(sans condition — règle de repli)')}</code></div>`).join('')}</article>`;
}

function renderCurrentAcl() {
  $('#currentAcl').innerHTML = state.resources.length ? state.resources.map(resource => {
    const rules = rulesForResource(resource.id);
    return `<article class="technical-resource"><header><strong>${esc(resource.tableId)} · ${esc(resource.colIds || '*')}</strong><span>${rules.length} règle${rules.length>1?'s':''}</span></header>${rules.map(r=>`<div class="rule"><div class="rule-head"><strong>#${r.id}</strong>${renderPermissionSet(r.permissionsText)}</div><code>${esc(r.aclFormula || '(sans condition)')}</code>${r.memo?`<div class="rule-explanation">Mémo : ${esc(r.memo)}</div>`:''}</div>`).join('')}</article>`;
  }).join('') : '<div class="empty-state">Aucune ACL lisible.</div>';
}

function validatePermissions(v) { return /^(?:all|none|(?:[+-][CRUDS]+)+)$/.test(text(v).trim()); }
function hasOwnerSafety(resource) {
  return (resource.rules || []).some(r => {
    const f = text(r.when); const p = text(r.permissions);
    return /user\.Access/.test(f) && /(OWNER|owners)/i.test(f) && (p === 'all' || (/\+/.test(p) && ['C','R','U','D'].every(ch => p.includes(ch))));
  });
}
function validatePolicy(policy) {
  const errors=[], warnings=[];
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) errors.push('Le JSON racine doit être un objet.');
  if (policy?.schema !== SCHEMA) errors.push(`schema doit être exactement "${SCHEMA}".`);
  if (Number(policy?.version) !== 1) errors.push('version doit être 1.');
  if ((policy?.mode || 'replace-resources') !== 'replace-resources') errors.push('La V1 accepte uniquement mode="replace-resources".');
  if (!Array.isArray(policy?.resources) || !policy.resources.length) errors.push('resources doit être une liste non vide.');
  const tableIds = new Set(state.tables.map(t=>text(t.tableId))); const seen = new Set();
  for (const [ri,res] of (policy?.resources || []).entries()) {
    const prefix=`Ressource ${ri+1}`; const table=text(res?.table).trim(); const cols=canonCols(res?.columns);
    if (!table) errors.push(`${prefix} : table manquante.`);
    else if (table !== '*' && !tableIds.has(table)) errors.push(`${prefix} : table inconnue "${table}".`);
    const key=resourceKey(table,cols); if (seen.has(key)) errors.push(`${prefix} : ressource dupliquée ${table}/${cols}.`); seen.add(key);
    if (table !== '*' && cols !== '*') {
      const existingCols = new Set((state.columnsByTable.get(table)||[]).map(c=>text(c.colId)));
      for (const col of cols.split(',')) if (!existingCols.has(col)) errors.push(`${prefix} : colonne inconnue "${table}.${col}".`);
    }
    if (!Array.isArray(res?.rules) || !res.rules.length) errors.push(`${prefix} : rules doit être une liste non vide.`);
    for (const [i,rule] of (res?.rules || []).entries()) {
      if (typeof rule?.when !== 'string') errors.push(`${prefix}, règle ${i+1} : when doit être une chaîne (vide autorisée).`);
      if (!validatePermissions(rule?.permissions)) errors.push(`${prefix}, règle ${i+1} : permissions invalides "${text(rule?.permissions)}".`);
    }
    if (!hasOwnerSafety(res)) errors.push(`${prefix} : sécurité bloquante — ajoute une règle Owner explicite donnant "all" ou +CRUD(S).`);
    if (!(res.rules || []).some(r => text(r.when) === '')) warnings.push(`${prefix} : aucune règle de repli sans condition.`);
  }
  return {valid: !errors.length, errors, warnings};
}

function comparableRules(rules) {
  return (rules||[]).map(r=>({when:text(r.when ?? r.aclFormula),permissions:text(r.permissions ?? r.permissionsText),memo:text(r.memo),principals:text(r.principals)}));
}
function sameJson(a,b){ return JSON.stringify(a)===JSON.stringify(b); }
function computeDiff(policy) {
  const existingMap = new Map();
  for (const resource of state.resources) existingMap.set(resourceKey(resource.tableId, resource.colIds), resource);
  return (policy.resources||[]).map(res => {
    const key=resourceKey(res.table,res.columns); const current=existingMap.get(key);
    if (!current) return {kind:'add', key, target:res, current:null, oldCount:0, newCount:res.rules.length};
    const oldRules = rulesForResource(current.id).map(normalizeExportRule);
    const same = sameJson(comparableRules(oldRules), comparableRules(res.rules));
    return {kind:same?'same':'change', key, target:res, current, oldCount:oldRules.length, newCount:res.rules.length};
  });
}

function validateInput() {
  let policy;
  try { policy = JSON.parse($('#jsonInput').value); }
  catch (e) { state.imported=null; state.validation={valid:false,errors:[`JSON invalide : ${e.message}`],warnings:[]}; renderValidation(); renderDiff(); renderDashboard(); return; }
  const validation = validatePolicy(policy); state.validation=validation;
  if (validation.valid) { state.imported=deepClone(policy); state.diff=computeDiff(state.imported); status('JSON valide. La simulation est prête.', 'ok'); }
  else { state.imported=null; state.diff=[]; status('Le JSON contient des erreurs bloquantes.', 'error'); }
  renderValidation(); renderDiff(); renderDashboard();
  if (validation.valid) switchTab('diff');
}
function renderValidation(){
  const box=$('#validationBox'); const v=state.validation;
  if (!v) { box.className='validation empty-state'; box.textContent='Aucun JSON chargé.'; return; }
  box.className=`validation ${v.valid?'ok':'error'}`;
  const parts=[]; parts.push(`<strong>${v.valid?'✅ JSON valide':'❌ JSON invalide'}</strong>`);
  if (v.errors.length) parts.push(`<ul>${v.errors.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`);
  if (v.warnings.length) parts.push(`<div><strong>⚠️ Avertissements</strong><ul>${v.warnings.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`);
  box.innerHTML=parts.join('');
}
function renderDiff(){
  const diff=state.diff||[]; $('#diffCount').textContent=diff.filter(x=>x.kind!=='same').length;
  const changed=diff.filter(x=>x.kind==='change').length, added=diff.filter(x=>x.kind==='add').length, same=diff.filter(x=>x.kind==='same').length;
  $('#applyBtn').disabled=!(state.validation?.valid && diff.some(x=>x.kind!=='same'));
  $('#diffSummary').className='diff-summary';
  $('#diffSummary').innerHTML = diff.length ? `<div class="diff-stat"><strong>${added}</strong><span>ressource${added>1?'s':''} ajoutée${added>1?'s':''}</span></div><div class="diff-stat"><strong>${changed}</strong><span>ressource${changed>1?'s':''} remplacée${changed>1?'s':''}</span></div><div class="diff-stat"><strong>${same}</strong><span>inchangée${same>1?'s':''}</span></div><div class="diff-stat"><strong>${diff.reduce((n,d)=>n+d.newCount,0)}</strong><span>règles proposées</span></div>` : 'Valide d’abord un JSON pour voir les changements.';
  $('#diffList').innerHTML = diff.map(d=>`<article class="diff-item ${d.kind}"><header><strong>${esc(d.target.table)} · ${esc(canonCols(d.target.columns))}</strong><span>${d.kind==='add'?'AJOUT':d.kind==='change'?'REMPLACEMENT':'INCHANGÉ'}</span></header><div class="body"><p>${esc(d.target.description || '')}</p><p><strong>${d.oldCount}</strong> règle(s) actuelle(s) → <strong>${d.newCount}</strong> règle(s) proposée(s)</p>${d.target.rules.map((r,i)=>`<div class="rule"><div class="rule-head"><strong>${esc(r.label||`Règle ${i+1}`)}</strong>${renderPermissionSet(r.permissions)}</div><div class="rule-explanation">${esc(r.explanation||'')}</div><code>${esc(r.when || '(sans condition)')}</code></div>`).join('')}</div></article>`).join('');
}

function renderAll(){ renderDashboard(); renderCurrentAcl(); renderValidation(); renderDiff(); }

function switchTab(name){
  $$('.tab').forEach(b=>b.classList.toggle('active', b.dataset.tab===name));
  $$('.tab-panel').forEach(p=>p.classList.toggle('active', p.id===`tab-${name}`));
}

function currentResourceMatches(target) {
  const key=resourceKey(target.table,target.columns); return state.resources.filter(r=>resourceKey(r.tableId,r.colIds)===key);
}

async function applyImportedPolicy(){
  if (!state.imported || !state.validation?.valid) return;
  const changes=state.diff.filter(x=>x.kind!=='same'); if (!changes.length) return status('Aucun changement à appliquer.','warn');
  const confirmed = window.confirm(`Grist ACL Studio va remplacer les règles de ${changes.length} ressource(s). Les autres ressources ACL resteront intactes.\n\nUne sauvegarde JSON des ACL actuelles va être téléchargée avant l'écriture.\n\nContinuer ?`);
  if (!confirmed) return;
  download(`grist-acl-backup-${nowStamp()}.json`, JSON.stringify(buildCurrentPolicy(), null, 2));
  $('#applyBtn').disabled=true; status('Application des ACL…', 'warn', 0);
  try {
    const actions=[];
    for (const change of changes) {
      for (const existing of currentResourceMatches(change.target)) {
        for (const rule of rulesForResource(existing.id)) actions.push(['RemoveRecord','_grist_ACLRules',rule.id]);
        actions.push(['RemoveRecord','_grist_ACLResources',existing.id]);
      }
    }
    let tempId=-1;
    for (const change of changes) {
      const res=change.target; const rid=tempId--;
      actions.push(['AddRecord','_grist_ACLResources',rid,{tableId:text(res.table),colIds:canonCols(res.columns)}]);
      (res.rules||[]).forEach((rule,index)=>{
        const fields={resource:rid,aclFormula:text(rule.when),permissionsText:text(rule.permissions),rulePos:(index+1)*1000};
        if (text(rule.memo)) fields.memo=text(rule.memo);
        if (text(rule.principals)) fields.principals=text(rule.principals);
        actions.push(['AddRecord','_grist_ACLRules',null,fields]);
      });
    }
    await grist.docApi.applyUserActions(actions);
    state.imported=null; state.validation=null; state.diff=[]; $('#jsonInput').value='';
    await loadDocument(); status('ACL appliquées avec succès. Le document a été relu après modification.', 'ok', 7000);
    switchTab('dashboard');
  } catch(e) {
    console.error(e); status(`Échec de l'application des ACL : ${e.message || e}. La sauvegarde téléchargée permet de revenir à l'état précédent.`, 'error', 0);
    $('#applyBtn').disabled=false;
  }
}

const SAMPLE = {
  schema: SCHEMA, version: 1, title: 'Exemple — GTG sur VEHICULES',
  description: 'Tous les GTG voient tous les véhicules. Un GTG en modification ne modifie que les véhicules de son propre GTG.',
  mode: 'replace-resources',
  resources: [{
    table: 'VEHICULES', columns: '*', description: 'Droits principaux sur le parc véhicules.', rules: [
      {label:'Owner',explanation:'Le propriétaire conserve tous les droits.',when:'user.Access == OWNER',permissions:'all'},
      {label:'GTG — lecture globale',explanation:'Tous les utilisateurs du profil GTG peuvent consulter tous les véhicules.',when:'user.UTIL and user.UTIL.UNITE_ACTIF == True and user.UTIL.PROFIL == "GTG"',permissions:'+R'},
      {label:'GTG — modification de son périmètre',explanation:'Un GTG en modification peut modifier uniquement les lignes de son GTG et ne peut pas les déplacer vers un autre GTG.',when:'user.UTIL and user.UTIL.UNITE_ACTIF == True and user.UTIL.PROFIL == "GTG" and user.UTIL.DROITS == "Modification" and rec.GTG == user.UTIL.GTG and newRec.GTG == user.UTIL.GTG',permissions:'+U'},
      {label:'Repli',explanation:'Tout droit non accordé par les règles précédentes est refusé.',when:'',permissions:'none'}
    ]
  }]
};

$$('.tab').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
$('#reloadBtn').addEventListener('click', loadDocument);
$('#validateBtn').addEventListener('click', validateInput);
$('#clearJsonBtn').addEventListener('click',()=>{ $('#jsonInput').value=''; state.imported=null; state.validation=null; state.diff=[]; renderAll(); });
$('#sampleBtn').addEventListener('click',()=>{ $('#jsonInput').value=JSON.stringify(SAMPLE,null,2); validateInput(); });
$('#importFileBtn').addEventListener('click',()=>$('#jsonFile').click());
$('#jsonFile').addEventListener('change',async e=>{ const file=e.target.files?.[0]; if(!file)return; $('#jsonInput').value=await file.text(); validateInput(); e.target.value=''; });
$('#exportCurrentBtn').addEventListener('click',()=>download(`grist-acl-${nowStamp()}.json`,JSON.stringify(buildCurrentPolicy(),null,2)));
$('#downloadBackupBtn').addEventListener('click',()=>download(`grist-acl-backup-${nowStamp()}.json`,JSON.stringify(buildCurrentPolicy(),null,2)));
$('#copyPromptBtn').addEventListener('click',async()=>{ try{await navigator.clipboard.writeText(buildAiPrompt()); status('Prompt IA copié dans le presse-papiers.','ok');}catch(e){status('Copie automatique impossible : utilise le bouton Télécharger le prompt.','warn');} });
$('#downloadPromptBtn').addEventListener('click',()=>download(`prompt-acl-grist-${nowStamp()}.txt`,buildAiPrompt(),'text/plain;charset=utf-8'));
$('#applyBtn').addEventListener('click',applyImportedPolicy);

loadDocument();
