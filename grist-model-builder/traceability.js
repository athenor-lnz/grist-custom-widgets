(() => {
  'use strict';

  const AUDIT_IDS = ['CreeLe', 'CreePar', 'ModifieLe', 'ModifiePar'];
  let applying = false;
  let bypassConfirm = false;
  let simulationRefreshTimer = null;

  const $ = id => document.getElementById(id);
  const enabled = () => Boolean($('traceabilityEnabled')?.checked);
  const authorMode = () => $('traceabilityAuthor')?.value || 'name';

  // The main widget previously used scrollIntoView after analysis/simulation.
  // In an iframe this creates a distracting jump. Keep navigation under user control.
  try {
    Element.prototype.scrollIntoView = function() {};
  } catch (_) {}

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
        recalcWhen: 0, description: 'Date et heure de création de la ligne.', widgetOptions: dateOpts
      },
      {
        id: 'CreePar', label: 'Créé par', type: 'Text', formula: author,
        recalcWhen: 0, description: 'Utilisateur ayant créé la ligne.', widgetOptions: '{}'
      },
      {
        id: 'ModifieLe', label: 'Modifié le', type: 'DateTime:Europe/Paris', formula: 'NOW()',
        recalcWhen: 2, description: 'Date et heure de la dernière modification.', widgetOptions: dateOpts
      },
      {
        id: 'ModifiePar', label: 'Modifié par', type: 'Text', formula: author,
        recalcWhen: 2, description: 'Utilisateur ayant effectué la dernière modification.', widgetOptions: '{}'
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
    return {tableIds: new Set(tableIds), columnsByTable, metaTables: mt, metaCols: mc};
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

  function setTraceHint(message, state='') {
    const hint = $('traceabilityHint');
    if (!hint) return;
    hint.textContent = message;
    hint.classList.remove('is-ok', 'is-pending');
    if (state) hint.classList.add(state);
  }

  async function refreshTraceabilityState() {
    const tableIds = modelTableIds();
    const buildBtn = $('buildBtn');
    if (!enabled()) {
      setTraceHint('La traçabilité est désactivée pour cette construction.');
      if (buildBtn && structuralMissingFromUi() === 0) buildBtn.disabled = true;
      return;
    }
    if (!tableIds.length) {
      const map = {name: 'nom Grist', email: 'adresse e-mail', userid: 'identifiant utilisateur'};
      setTraceHint(`Quatre informations de suivi seront ajoutées à chaque table. Auteur : ${map[authorMode()]}.`);
      return;
    }
    try {
      const missing = await missingAuditColumns(tableIds);
      if (missing > 0) {
        setTraceHint(`${missing} colonne(s) de traçabilité seront ajoutée(s) lors de la construction.`, 'is-pending');
        if (buildBtn) {
          buildBtn.disabled = false;
          buildBtn.title = 'Construire le modèle et ajouter la traçabilité.';
        }
      } else {
        setTraceHint('Traçabilité déjà complète sur toutes les tables du modèle.', 'is-ok');
        if (buildBtn && structuralMissingFromUi() === 0) {
          buildBtn.disabled = true;
          buildBtn.title = 'Le modèle est déjà conforme.';
        }
      }
    } catch (e) {
      setTraceHint('Impossible de vérifier la traçabilité pour le moment.');
      console.warn('[Grist Model Builder] Vérification de la traçabilité impossible', e);
    }
  }

  function makeModal({title, message, kind='info', confirmLabel='OK', cancelLabel=null}) {
    return new Promise(resolve => {
      const backdrop = document.createElement('div');
      backdrop.className = 'app-modal-backdrop';
      backdrop.setAttribute('role', 'presentation');
      const modal = document.createElement('div');
      modal.className = `app-modal ${kind}`;
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', 'gmb-modal-title');
      const icon = kind === 'success' ? '✓' : kind === 'warning' ? '!' : 'i';
      modal.innerHTML = `
        <div class="app-modal-icon">${icon}</div>
        <h2 id="gmb-modal-title"></h2>
        <p></p>
        <div class="app-modal-actions"></div>`;
      modal.querySelector('h2').textContent = title;
      modal.querySelector('p').textContent = message;
      const actions = modal.querySelector('.app-modal-actions');
      if (cancelLabel) {
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'btn btn-ghost';
        cancel.textContent = cancelLabel;
        cancel.addEventListener('click', () => close(false));
        actions.appendChild(cancel);
      }
      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = 'btn btn-primary';
      confirm.textContent = confirmLabel;
      confirm.addEventListener('click', () => close(true));
      actions.appendChild(confirm);
      function close(value) {
        document.removeEventListener('keydown', onKey);
        backdrop.remove();
        resolve(value);
      }
      function onKey(e) {
        if (e.key === 'Escape' && cancelLabel) close(false);
        if (e.key === 'Enter') close(true);
      }
      document.addEventListener('keydown', onKey);
      backdrop.addEventListener('click', e => { if (e.target === backdrop && cancelLabel) close(false); });
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);
      setTimeout(() => confirm.focus(), 0);
    });
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

    const schema = await fetchSchema();
    const tableRef = schema.metaTables.find(r => r.tableId === tableId)?.id;
    const row = schema.metaCols.find(r => r.parentId === tableRef && r.colId === spec.id);
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
    if (!enabled() || !tableIds.length || applying) return {created: 0, skipped: true};
    applying = true;
    let created = 0;
    try {
      let schema = await fetchSchema();
      for (const tableId of tableIds) {
        if (!schema.tableIds.has(tableId)) continue;
        const cols = schema.columnsByTable.get(tableId) || new Map();
        for (const spec of specs()) {
          if (cols.has(spec.id)) continue;
          await addAuditColumn(tableId, spec);
          created++;
          appendLog(`✓ ${tableId}.${spec.id} - traçabilité ajoutée.`);
          schema = await fetchSchema();
        }
      }
      return {created, skipped: false};
    } finally {
      applying = false;
      await refreshTraceabilityState();
    }
  }

  async function showCompletion(createdAudit) {
    const text = createdAudit > 0
      ? `Le modèle a été construit avec succès. ${createdAudit} colonne(s) de traçabilité ont été ajoutée(s).`
      : 'Le modèle a été construit avec succès. La traçabilité est déjà complète ou a été laissée désactivée.';
    await makeModal({
      title: 'Construction terminée',
      message: text,
      kind: 'success',
      confirmLabel: 'Terminer'
    });
  }

  function waitForMainBuild(tableIds) {
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts++;
      const status = String($('progressText')?.textContent || '');
      if (/Erreur pendant la construction/i.test(status)) {
        clearInterval(timer);
        await makeModal({
          title: 'Construction interrompue',
          message: 'Une erreur est survenue pendant la construction. Consultez le journal affiché dans le widget.',
          kind: 'warning',
          confirmLabel: 'Fermer'
        });
        return;
      }
      if (attempts > 240) {
        clearInterval(timer);
        return;
      }
      if (/Construction terminée/i.test(status)) {
        clearInterval(timer);
        try {
          const result = await applyTraceability(tableIds);
          const progressText = $('progressText');
          if (progressText) {
            progressText.textContent = result.created > 0
              ? `Construction terminée - ${result.created} colonne(s) de traçabilité ajoutée(s).`
              : 'Construction terminée.';
          }
          await showCompletion(result.created || 0);
        } catch (e) {
          appendLog(`Erreur de traçabilité : ${e.message}`, 'error');
          await makeModal({
            title: 'Construction partiellement terminée',
            message: 'Le modèle principal a été construit, mais la traçabilité n’a pas pu être ajoutée complètement. Consultez le journal.',
            kind: 'warning',
            confirmLabel: 'Fermer'
          });
        }
      }
    }, 250);
  }

  async function confirmBuild() {
    const tables = modelTableIds();
    let auditInfo = '';
    if (enabled() && tables.length) {
      try {
        const missing = await missingAuditColumns(tables);
        if (missing > 0) auditInfo = ` ${missing} colonne(s) de traçabilité seront également ajoutée(s).`;
      } catch (_) {}
    }
    return makeModal({
      title: 'Construire ce modèle ?',
      message: `Les tables et colonnes manquantes seront ajoutées au document. Les colonnes existantes ne seront pas modifiées.${auditInfo}`,
      kind: 'info',
      confirmLabel: 'Construire',
      cancelLabel: 'Annuler'
    });
  }

  function scheduleRefresh() {
    clearTimeout(simulationRefreshTimer);
    simulationRefreshTimer = setTimeout(refreshTraceabilityState, 250);
  }

  function init() {
    const toggle = $('traceabilityEnabled');
    const author = $('traceabilityAuthor');
    const buildBtn = $('buildBtn');
    if (!toggle || !author || !buildBtn) return;

    toggle.addEventListener('change', refreshTraceabilityState);
    author.addEventListener('change', refreshTraceabilityState);
    $('simulateBtn')?.addEventListener('click', () => setTimeout(refreshTraceabilityState, 450));
    $('resimulateBtn')?.addEventListener('click', () => setTimeout(refreshTraceabilityState, 450));

    // Custom confirmation dialog. The main app still calls window.confirm; on the
    // confirmed synthetic click we temporarily make that internal call return true.
    buildBtn.addEventListener('click', async e => {
      if (bypassConfirm) {
        bypassConfirm = false;
        const ids = modelTableIds();
        setTimeout(() => waitForMainBuild(ids), 0);
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      const ok = await confirmBuild();
      if (!ok) return;
      const originalConfirm = window.confirm;
      try {
        window.confirm = () => true;
        bypassConfirm = true;
        buildBtn.click();
      } finally {
        window.confirm = originalConfirm;
      }
    }, true);

    const observer = new MutationObserver(scheduleRefresh);
    observer.observe($('simulationSummary'), {childList: true, subtree: true});
    observer.observe($('simulationSection'), {attributes: true, attributeFilter: ['class']});
    refreshTraceabilityState();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();