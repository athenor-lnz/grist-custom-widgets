(() => {
  'use strict';
  function init() {
    const button = document.getElementById('buildBtn');
    if (!button) return;
    button.addEventListener('click', () => {
      const progress = document.getElementById('progressText');
      if (progress) progress.textContent = 'Préparation…';
    }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();