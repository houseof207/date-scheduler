// Settings for the background snowfall (DHTML Snowstorm by Scott Schiller,
// /assets/vendor/snowstorm.js). This runs after the library loads but before
// the page's load event, which is when the storm reads its settings and starts.
(function () {
  var storm = window.snowStorm;
  if (!storm) return;

  // Theme-aware color: soft blue-grey on the cream background, white at night.
  storm.snowColor = 'var(--flake)';
  storm.className = 'snowflake';

  // Keep snow in the viewport while scrolling (the library default lets it
  // scroll away with the top of the page, which leaves long pages bare).
  storm.usePositionFixed = true;

  // Flakes sit at z-index 0, behind the header and cards (z-index 1).
  storm.zIndex = 0;

  // Respect "reduce motion": never start the animation.
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    storm.disabled = true;
  }
})();
