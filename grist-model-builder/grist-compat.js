(() => {
  'use strict';
  if (!window.grist || typeof grist.onOptions !== 'function') return;
  const originalOnOptions = grist.onOptions.bind(grist);
  grist.onOptions = function(callback) {
    return originalOnOptions((options, interaction) => {
      const normalized = interaction ? {...interaction} : {};
      if (!normalized.access_level && normalized.accessLevel) {
        normalized.access_level = normalized.accessLevel;
      }
      if (!normalized.accessLevel && normalized.access_level) {
        normalized.accessLevel = normalized.access_level;
      }
      callback(options, normalized);
    });
  };
})();
