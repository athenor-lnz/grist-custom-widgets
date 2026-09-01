(() => {
  'use strict';

  const AUDIT_IDS = ['CreeLe', 'CreePar', 'ModifieLe', 'ModifiePar'];
  let checking = false;
  let applying = false;

  const $ = id => document.getElementById(id);
  const enabled = () => Boolean($('traceabilityEnabled')?.checked);
  const authorMode = () => $('traceabilityAuthor')?.value || 'name';

  function authorFormula() {
    if (authorMode() === 'email') return 'user.Email';
    if (authorMode() === 'userid') return 'str(user.UserID)';
    return 'user.Name';
  }

  function specs() {
    const dateOpts = JSON.stringify({
      dateFormat: 'DD/MM/YYYY',
      timeFormat: 'HH:mm',
      isCustomDateFormat: true,
      isCustomTimeFormat: true
    });
    const author = authorFormula();
    return [
      {
        id: 'CreeLe', label: 'Créé le', type: 'DateTime:Europe/Paris', formula: 'NOW()',
        recalcWhen: 0, description: 'Horodatage automatique de création de la ligne.', widgetOptions: dateOpts
      },
      {
        id: 'CreePar', label: 'Créé par', type: 'Text', formula: author,
        recalcWhen: 0, description: 'Utilisateur ayant créé la ligne.', widgetOptions: '{}'
      },
      {
        id: 'ModifieLe', label: 'Modifié le', type: 'DateTime:Europe/Paris', formula: 'NOW()',
        recalcWhen: 2, description: 'Horodatage automatique de la dernière modification manuelle.', widgetOptions: dateOpts
      },
      {
        id: 'ModifiePar', label: 'Modifié par', type: 'Text', formula: author,
        recalcWhen: 2, description: 'Utilisateur ayant effectué la dernière modification manuelle.', widgetOptions: '{}'
      }
    ];
  }

  function tableDataToRows(data) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return [];
    const keys = Object.keys(data).filter(k => Array.isArray(data[k]));
    if (!keys.length) return [];
    const length = Math.max(...keys.map(k => data[k].length));
    return Array.from({length}, (_, i) => Object.fromEntries(keys.map(k => [k, data[k][i]])));
  }

  async function fetchSchema() {
    const tableIds = await grist.docApi.listTables();
    const mt = tableDataToRows(await grist.docApi.fetchTable('_grist_Tables'));
    const mc = tableDataToRows(await grist.docApi.fetchTable('_grist_Tables_column'));
    const tableByRef = new Map(mt.map(r => [r.id, r.tableId]));
    const columnsByTable = new Map(tableIds.map(id => [id, new Map()]));
    for (const col of mc) {
      const tableId = tableByRef.get(col.parentId);
      if (tableId && columnsByTable.has(tableId)) columnsByTable.get(tableId).set(col.colId, col);
    }
    return {tableIds: new Set(tableIds), columnsByTable};
  }

  function modelTableIds() {
    return [...document.querySelectorAll('#tablesPreview .table-title > span')]
      .map(el => String(el.textContent || '').split(' · ')[0].trim())
      .filter(Boolean);
  }

  function structuralMissingFromUi() {
    const values = [...document.querySelectorAll('#simulationSummary .sim-box strong')]
      .slice(0, 2)
      .map(el => Number(el.textContent) || 0);
    return (values[0] || 0) + (values[1] || 0);
  }

  async function missingAuditColumns(tableIds) {
    const schema = await fetchSchema();
    let missing = 0;
    for (const tableId of tableIds) {
      if (!schema.tableIds.has(tableId)) {
        missing += AUDIT_IDS.length;
        continue;
      }
      const cols = schema.columnsByTable.get(tableId) || new Map();
      for (const id of AUDIT_IDS) if (!cols.has(id)) missing++;
    }
    return missing;
  }

  async function refreshSimulationTraceability() {
    if (checking || applying) return;
    const sim = $('simulationSection');
    if (!sim || sim.classList.contains('hidden')) return;
    checking = true;
    try {
      const old = $('traceabilitySummary');
      if (old) old.remove();
      const tableIds = modelTableIds();
      const buildBtn = $('buildBtn');
      if (!enabled() || !tableIds.length) {
        if (buildBtn && structuralMissingFromUi() === 0) buildBtn.disabled = true;
        return;
      }
      const missing = await missingAuditColumns(tableIds);
      const box = document.createElement('div');
      box.id = 'traceabilitySummary';
      box.className = 'sim-box trace-sim-box';
      box.innerHTML = `<strong>${missing}</strong> colonnes de traçabilité à créer`;
      $('simulationSummary')?.appendChild(box);
      if (buildBtn && missing > 0) {
        buildBtn.disabled = false;
        buildBtn.title = 'Construire le modèle et appliquer la traçabilité automatique.';
      } else if (buildBtn && structuralMissingFromUi() === 0) {
        buildBtn.disabled = true;
        buildBtn.title = 'Le modèle et la traçabilité sont déjà conformes.';
      }
    } catch (e) {
      console.warn('[Grist Model Builder] Vérification de la traçabilité impossible', e);
    } finally {
      checking = false;
    }
  }

  function appendLog(message, kind='ok') {
    const log = $('buildLog');
    if (!log) return;
    const div = document.createElement('div');
    div.className = `log-${kind}`;
    div.textContent = message;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  async function addAuditColumn(tableId, spec) {
    await grist.docApi.applyUserActions([[
      'AddColumn', tableId, spec.id,
      {
        type: spec.type,
        isFormula: false,
        formula: spec.formula,
        recalcWhen: spec.recalcWhen,
        recalcDeps: null,
        widgetOptions: spec.widgetOptions
      }
    ]]);

    const mt = tableDataToRows(await grist.docApi.fetchTable('_grist_Tables'));
    const mc = tableDataToRows(await grist.docApi.fetchTable('_grist_Tables_column'));
    const tableRef = mt.find(r => r.tableId === tableId)?.id;
    const row = mc.find(r => r.parentId === tableRef && r.colId === spec.id);
    if (row) {
      await grist.docApi.applyUserActions([[
        'UpdateRecord', '_grist_Tables_column', row.id,
        {
          label: spec.label,
          description: spec.description,
          untieColIdFromLabel: true,
          widgetOptions: spec.widgetOptions,
          isFormula: false,
          formula: spec.formula,
          recalcWhen: spec.recalcWhen,
          recalcDeps: null
        }
      ]]);
    }
  }

  async function applyTraceability(tableIds) {
    if (!enabled() || !tableIds.length || applying) return;
    applying = true;
    try {
      let schema = await fetchSchema();
      let created = 0;
      const audit = specs();
      for (const tableId of tableIds) {
        if (!schema.tableIds.has(tableId)) continue;
        const cols = schema.columnsByTable.get(tableId) || new Map();
        for (const spec of audit) {
          if (cols.has(spec.id)) continue;
          await addAuditColumn(tableId, spec);
          created++;
          appendLog(`✓ ${tableId}.${spec.id} — traçabilité ajoutée.`);
          schema = await fetchSchema();
        }
      }
      if (created) {
        const progressText = $('progressText');
        if (progressText) progressText.textContent = `Construction terminée · ${created} colonne(s) de traçabilité ajoutée(s).`;
      } else {
        appendLog('✓ La traçabilité était déjà présente sur toutes les tables du modèle.');
      }
    } catch (e) {
      appendLog(`Erreur de traçabilité : ${e.message}`, 'error');
      const progressText = $('progressText');
      if (progressText) progressText.textContent = 'Construction terminée, mais la traçabilité est incomplète.';
    } finally {
      applying = false;
      await refreshSimulationTraceability();
    }
  }

  function waitForMainBuild(tableIds) {
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts++;
      const status = String($('progressText')?.textContent || '');
      if (/Erreur pendant la construction/i.test(status) || attempts > 240) {
        clearInterval(timer);
        return;
      }
      if (/Construction terminée/i.test(status)) {
        clearInterval(timer);
        await applyTraceability(tableIds);
      }
    }, 250);
  }

  function updateOptionHint() {
    const hint = $('traceabilityHint');
    if (!hint) return;
    const map = {name: 'nom Grist', email: 'adresse e-mail', userid: 'identifiant utilisateur'};
    hint.textContent = enabled()
      ? `Les 4 colonnes seront ajoutées aux tables du modèle. Auteur enregistré : ${map[authorMode()]}.`
      : 'La traçabilité automatique est désactivée pour cette construction.';
  }

  function init() {
    const toggle = $('traceabilityEnabled');
    const author = $('traceabilityAuthor');
    const buildBtn = $('buildBtn');
    if (!toggle || !author || !buildBtn) return;

    toggle.addEventListener('change', async () => { updateOptionHint(); await refreshSimulationTraceability(); });
    author.addEventListener('change', updateOptionHint);
    buildBtn.addEventListener('click', () => {
      if (!enabled()) return;
      const ids = modelTableIds();
      if (ids.length) waitForMainBuild(ids);
    });

    const observer = new MutationObserver(() => {
      clearTimeout(observer._timer);
      observer._timer = setTimeout(refreshSimulationTraceability, 120);
    });
    observer.observe($('simulationSection'), {childList: true, subtree: true, attributes: true, attributeFilter: ['class']});
    updateOptionHint();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
