// Picks a new color palette on every page load by rotating hues.
// Loaded as a plain (non-module) script in <head> so it runs before the first paint.
//
// - --hue drives both --fg and --bg, so they always stay in sync.
// - --accent-hue lands 90°–180° around the color wheel from --hue (either direction),
//   so the accent is always at least 90° away from the fg/bg hue.
//
// Colors are OKLCH, so lightness and chroma stay as defined in styles.css and only the hues
// change; every palette looks equally bright.
// Without JavaScript the defaults in styles.css are used.
(function () {
  var MIN_DISTANCE = 90;

  var hue = Math.floor(Math.random() * 360);
  var offset = MIN_DISTANCE + Math.random() * (360 - 2 * MIN_DISTANCE); // 90..270 ⇒ 90..180 either way
  var accentHue = Math.round(hue + offset) % 360;

  var root = document.documentElement;
  root.style.setProperty('--hue', String(hue));
  root.style.setProperty('--accent-hue', String(accentHue));

  // Keep the browser UI (mobile address bar) matching the new background.
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', 'oklch(17.8% 0.031 ' + hue + ')'); // same as --bg in styles.css
})();
