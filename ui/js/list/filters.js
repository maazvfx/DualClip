// --- DualClip Filters Coordinator Shim ---
// Validates modular loading and exposes window.DC.filters unified API

(function() {
  'use strict';
  if (!window.DC || !window.DC.filtersCollections || !window.DC.filtersSearch) {
    console.warn('[DualClip] filters-collections.js or filters-search.js did not load before filters.js coordinator shim');
  }

  window.DC = window.DC || {};
  window.DC.filters = Object.assign(
    {},
    window.DC.filtersCollections || {},
    window.DC.filtersSearch || {}
  );

  // Neutral on boot; setters light it up as filters change
  try {
    if (typeof updateFilterBtnState === 'function') {
      updateFilterBtnState();
    }
  } catch (e) {}
})();
