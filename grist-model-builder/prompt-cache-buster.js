(() => {
  'use strict';
  const originalFetch = window.fetch.bind(window);
  window.fetch = function(input, init) {
    if (typeof input === 'string' && /^prompt-(xlsx|json)\.txt(?:\?|$)/.test(input)) {
      const url = new URL(input, window.location.href);
      url.searchParams.set('v', '1.1.1');
      return originalFetch(url.toString(), init);
    }
    return originalFetch(input, init);
  };
})();
