(() => {
  'use strict';

  const DATE_FORMAT = 'DD/MM/YYYY';
  const TIME_FORMAT = 'HH:mm';
  const DEFAULT_TIMEZONE = 'Europe/Paris';

  // Le modèle XLSX peut rester simple : "DateTime" devient par défaut
  // "DateTime:Europe/Paris". Un fuseau explicite dans le XLSX reste prioritaire.
  if (window.XLSX?.utils?.sheet_to_json) {
    const originalSheetToJson = window.XLSX.utils.sheet_to_json.bind(window.XLSX.utils);
    window.XLSX.utils.sheet_to_json = function(sheet, options) {
      const rows = originalSheetToJson(sheet, options);
      if (!Array.isArray(rows)) return rows;
      return rows.map((row) => {
        if (!row || typeof row !== 'object' || !Object.prototype.hasOwnProperty.call(row, 'TYPE')) return row;
        const type = String(row.TYPE ?? '').trim();
        if (type === 'DateTime') return {...row, TYPE: `DateTime:${DEFAULT_TIMEZONE}`};
        return row;
      });
    };
  }

  function dateWidgetOptions(type, existing = {}) {
    const opts = {...existing};
    if (type === 'Date') {
      opts.dateFormat = DATE_FORMAT;
      opts.isCustomDateFormat = true;
    }
    if (String(type || '').startsWith('DateTime:')) {
      opts.dateFormat = DATE_FORMAT;
      opts.timeFormat = TIME_FORMAT;
      opts.isCustomDateFormat = true;
      opts.isCustomTimeFormat = true;
    }
    return opts;
  }

  function safeParse(value) {
    if (!value) return {};
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch { return {}; }
  }

  function rowsFromTableData(data) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return [];
    const keys = Object.keys(data).filter((key) => Array.isArray(data[key]));
    if (!keys.length) return [];
    const length = Math.max(...keys.map((key) => data[key].length));
    return Array.from({length}, (_, index) => Object.fromEntries(keys.map((key) => [key, data[key][index]])));
  }

  if (window.grist?.docApi?.applyUserActions) {
    const originalApplyUserActions = window.grist.docApi.applyUserActions.bind(window.grist.docApi);

    window.grist.docApi.applyUserActions = async function(actions, ...rest) {
      const patched = actions.map((action) => {
        if (!Array.isArray(action)) return action;

        if (action[0] === 'AddTable' && Array.isArray(action[2])) {
          return [action[0], action[1], action[2].map((column) => {
            const options = dateWidgetOptions(column?.type, safeParse(column?.widgetOptions));
            return Object.keys(options).length ? {...column, widgetOptions: JSON.stringify(options)} : column;
          })];
        }

        if (action[0] === 'AddColumn' && action[3] && typeof action[3] === 'object') {
          const info = action[3];
          const options = dateWidgetOptions(info.type, safeParse(info.widgetOptions));
          return [action[0], action[1], action[2], Object.keys(options).length ? {...info, widgetOptions: JSON.stringify(options)} : info];
        }

        return action;
      });

      // L'application met ensuite à jour les libellés/descriptions et widgetOptions.
      // On complète à ce moment-là les options de dates afin qu'elles ne soient pas écrasées.
      for (const action of patched) {
        if (!Array.isArray(action) || action[0] !== 'BulkUpdateRecord' || action[1] !== '_grist_Tables_column') continue;
        const ids = action[2];
        const values = action[3];
        if (!Array.isArray(ids) || !values || !Array.isArray(values.widgetOptions)) continue;

        try {
          const meta = rowsFromTableData(await window.grist.docApi.fetchTable('_grist_Tables_column'));
          const byId = new Map(meta.map((row) => [row.id, row]));
          values.widgetOptions = values.widgetOptions.map((raw, index) => {
            const row = byId.get(ids[index]);
            const options = dateWidgetOptions(row?.type, safeParse(raw));
            return Object.keys(options).length ? JSON.stringify(options) : raw;
          });
        } catch (err) {
          console.warn('Grist Model Builder: impossible d’appliquer les formats de date par défaut', err);
        }
      }

      return originalApplyUserActions(patched, ...rest);
    };
  }
})();
