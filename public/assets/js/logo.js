// The "nownownow.now" wordmark. The small and tall logos are the same glyphs
// with longer vertical stems, so the paths are generated for any height and
// the stems grow from small to tall on page load. The baseline stays put and
// the extra height extends upward, past the top of the page.

const SVG_NS = 'http://www.w3.org/2000/svg';
const WIDTH = 1328;
const SMALL = 138.61;
const TALL = 348.16;
const DELAY = 250; // before the first character starts growing
const STAGGER = 90; // between one character starting and the next
const DURATION = 1100; // for each character
const FADE_STAGGER = 90; // between one character fading to the dark shade and the next

const r = (n) => Math.round(n * 100) / 100;

// Glyph outlines in local coordinates (each glyph is 102 wide, top at y=0, bottom at y=h).
const GLYPHS = {
  n: (h) =>
    `M69,${h}c-18.2,0-33-14.8-33-33V33c0-1.65-1.35-3-3-3s-3,1.35-3,3v${r(h - 48)}` +
    `c0,8.29-6.72,15-15,15s-15-6.71-15-15V33C0,14.8,14.8,0,33,0s33,14.8,33,33v${r(h - 66)}` +
    `c0,1.66,1.35,3,3,3s3-1.34,3-3V15c0-8.28,6.72-15,15-15s15,6.72,15,15v${r(h - 48)}` +
    `C102,${r(h - 14.8)},87.2,${h},69,${h}Z`,
  o: (h) =>
    `M51,${h}c-28.12,0-51-22.88-51-51V51c0-28.12,22.88-51,51-51s51,22.88,51,51V${r(h - 51)}` +
    `C102,${r(h - 22.88)},79.12,${h},51,${h}Z` +
    `M51,30c-11.58,0-21,9.42-21,21V${r(h - 51)}c0,11.58,9.42,21,21,21s21-9.42,21-21V51` +
    `C72,39.42,62.58,30,51,30Z`,
  w: (h) =>
    `M69,${h}c-6.64,0-12.82-1.97-18-5.35c-5.18,3.38-11.36,5.35-18,5.35c-18.2,0-33-14.8-33-33V15` +
    `c0-8.28,6.72-15,15-15s15,6.72,15,15v${r(h - 48)}c0,1.66,1.35,3,3,3s3-1.34,3-3V15` +
    `c0-8.28,6.72-15,15-15s15,6.72,15,15v${r(h - 48)}c0,1.66,1.35,3,3,3s3-1.34,3-3V15` +
    `c0-8.28,6.72-15,15-15s15,6.72,15,15v${r(h - 48)}C102,${r(h - 14.8)},87.2,${h},69,${h}Z`,
};

// "nownownow" + "." + "now", with the x offset of each glyph.
const LAYOUT = [
  ['n', 0], ['o', 108], ['w', 216],
  ['n', 324], ['o', 432], ['w', 540],
  ['n', 648], ['o', 756], ['w', 864],
  ['n', 1010], ['o', 1118], ['w', 1226],
];
const DOT = { cx: 987, r: 19.5 };

function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function mount(container) {
  // The viewBox is the small logo. Taller states overflow above it.
  const svg = svgEl('svg', {
    viewBox: `0 0 ${WIDTH} ${SMALL}`,
    fill: 'currentColor',
    overflow: 'visible',
    'aria-hidden': 'true',
    focusable: 'false',
  });
  // Each character grows on its own, shifted up by the extra height so its baseline stays put.
  const glyphs = LAYOUT.map(([glyph, x]) => {
    const path = svgEl('path', {});
    svg.append(path);
    return {
      node: path,
      draw(h) {
        path.setAttribute('transform', `translate(${x} ${r(SMALL - h)})`);
        path.setAttribute('d', GLYPHS[glyph](h));
      },
    };
  });
  // The dot never grows, but it does fade.
  const dot = svgEl('circle', { cx: DOT.cx, cy: r(SMALL - DOT.r), r: DOT.r });
  svg.append(dot);
  container.append(svg);
  return { glyphs, dot };
}

const ease = (t) => (t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2); // easeInOutQuart

/** A random permutation of 0..n-1 (Fisher–Yates). */
function shuffledOrder(n) {
  const order = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

for (const container of document.querySelectorAll('[data-logo]')) {
  const { glyphs, dot } = mount(container);
  const characters = [...glyphs.map((g) => g.node), dot];
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduced) {
    for (const g of glyphs) g.draw(TALL);
    for (const node of characters) node.classList.add('is-faded');
    continue;
  }

  // Characters fade to the dark shade in a fresh random order, one every FADE_STAGGER ms.
  const fadeOut = () => {
    shuffledOrder(characters.length).forEach((i, rank) => {
      setTimeout(() => characters[i].classList.add('is-faded'), rank * FADE_STAGGER);
    });
  };
  for (const g of glyphs) g.draw(SMALL);

  // Characters start growing in a random order, one every STAGGER ms.
  const order = shuffledOrder(glyphs.length);
  const startAt = glyphs.map((_, i) => DELAY + order.indexOf(i) * STAGGER);
  const end = DELAY + (glyphs.length - 1) * STAGGER + DURATION;

  let t0;
  const tick = (now) => {
    t0 ??= now;
    const elapsed = now - t0;
    glyphs.forEach((g, i) => {
      const t = Math.min(Math.max((elapsed - startAt[i]) / DURATION, 0), 1);
      g.draw(SMALL + (TALL - SMALL) * ease(t));
    });
    if (elapsed < end) requestAnimationFrame(tick);
    else fadeOut();
  };
  requestAnimationFrame(tick);
}
