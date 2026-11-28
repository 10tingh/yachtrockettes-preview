/* Splash: the anchor fills like a loading bar (driven by real load progress: fonts, the logo art and the hero video),
   lifts to the top of the screen still upright, then leans over to its 45deg place in the logo as it slides left and
   YACHT expands out, then "Rock-ettes" is written with real pen strokes.
   The hero video buffers behind the dark cover, so the reveal never starts on an empty frame.
   Plays on every load (the flag in <head> skips it for reduced motion); ?perf logs frame times, ?hold pauses the
   choreography (window.__splash.seek(ms) to step through it). */
(function () {
  'use strict';
  const root = document.documentElement;
  const t0 = performance.now();

  /* ?perf: record frame intervals for the first 7s and log a summary (used to compare with/without the splash) */
  if (/[?&]perf/.test(location.search)) {
    const d = [], long = [], tasks = []; let last = performance.now(); const end = last + 7000;
    const vis = [{ atMs: 0, state: document.visibilityState, focused: document.hasFocus() }];
    document.addEventListener('visibilitychange', () => vis.push({ atMs: Math.round(performance.now() - t0), state: document.visibilityState }));
    try { new PerformanceObserver((l) => l.getEntries().forEach((e) => tasks.push({ atMs: Math.round(e.startTime - t0), durMs: Math.round(e.duration) }))).observe({ type: 'longtask', buffered: true }); } catch (e) { /* unsupported */ }
    requestAnimationFrame(function f(n) {
      d.push(n - last); if (n - last > 50) long.push({ atMs: Math.round(n - t0), durMs: Math.round(n - last) }); last = n;
      if (n < end) return requestAnimationFrame(f);
      const s = d.slice().sort((a, b) => a - b);
      window.__perf = { frames: d.length, p50: +s[s.length >> 1].toFixed(1), p95: +s[Math.floor(s.length * .95)].toFixed(1), max: +s[s.length - 1].toFixed(1),
        over34ms: d.filter((v) => v > 34).length, over50ms: d.filter((v) => v > 50).length, over100ms: d.filter((v) => v > 100).length, splash: root.classList.contains('splash'), long, mainThreadLongTasks: tasks, visibility: vis };
      console.log('[perf]', JSON.stringify(window.__perf));
    });
  }

  const hero = document.getElementById('hero');
  const logo = document.getElementById('heroLogo');
  if (!root.classList.contains('splash') || !hero || !logo) { return; }

  const q = (s) => logo.querySelector(s);
  const anchor = q('.logo__anchor'), fill = q('.logo__fill'), trace = q('.logo__trace'), tilt = q('.logo__tilt'), yacht = q('.logo__yacht'), script = q('.logo__script'), solid = q('.logo__yachtsolid');
  const scriptImg = script.querySelector('image');
  const HALO = 52;                                                  // how much wider than the pen the cut-away gap is
  const strokePaths = [...script.querySelectorAll('mask path')];   // the pen paths, in writing order
  const cover = hero.querySelector('.hero__cover');
  const bottom = hero.querySelector('.hero__bottom');
  const tagline = hero.querySelector('.hero__tagline');
  const nextShow = hero.querySelector('.hero__top .nextshow');   // under the logo
  bottom.inert = true;
  nextShow.inert = true;

  /* Rock-ettes: shown through a mask made of the pen paths. Each path starts fully undrawn (dash offset past its end,
     plus half the stroke width so the round cap hides too) and is later drawn on via stroke-dashoffset. */
  scriptImg.setAttribute('mask', 'url(#scriptMask)');
  script.style.opacity = '1';
  for (const path of strokePaths) {
    const len = path.getTotalLength(), w = parseFloat(path.getAttribute('stroke-width'));
    path.dataset.len = len;
    path.dataset.hidden = len + w / 2 + 3;
    path.style.strokeDasharray = `${len} ${len + w * 2}`;     // one dash = the whole stroke
    path.style.strokeDashoffset = path.dataset.hidden;
    // The solid YACHT has the script's gaps filled in. Each pen path gets a wider copy in its mask, drawn on at the same moment,
    // so the gap is cut around the pen as it writes (and the finished logo is exactly the original artwork).
    const halo = path.cloneNode(false), hw = w + HALO;
    halo.setAttribute('stroke-width', hw);
    halo.dataset.hidden = len + hw / 2 + 3;
    halo.style.strokeDasharray = `${len} ${len + hw * 2}`;
    halo.style.strokeDashoffset = halo.dataset.hidden;
    solid.querySelector('#yachtHalo').appendChild(halo);
    path.halo = halo;
  }

  /* The anchor starts centred on the screen, a little larger than its final size. */
  anchor.style.transform = 'none';
  const ar = anchor.getBoundingClientRect(), hr = hero.getBoundingClientRect();
  const dx = hr.left + hr.width / 2 - (ar.left + ar.width / 2);   // screen centre -> its place in the logo
  const dy = hr.top + hr.height / 2 - (ar.top + ar.height / 2);
  const START = `translate(${dx}px, ${dy}px) scale(1.3)`;
  const TOP = `translate(${dx}px, 0px) scale(1)`;                 // top of the screen, still centred
  anchor.style.transform = START;

  /* The fill is a level waterline on screen: the clip lives on the (un-rotated) wrapper, while the tilt is on an inner
     layer. These are the upright anchor's top and bottom edges as a % of the wrapper's height (measured from its pixels). */
  const TOP_EDGE = -18.5, BOTTOM_EDGE = 104.5;
  const clipFor = (p) => `inset(${(BOTTOM_EDGE - p * (BOTTOM_EDGE - TOP_EDGE)).toFixed(2)}% -60% -60% -60%)`;      // fill: rises from the bottom
  const traceFor = (p) => `inset(-60% -60% ${(100 - (TOP_EDGE + p * (BOTTOM_EDGE - TOP_EDGE))).toFixed(2)}% -60%)`;   // outline: drawn on from the top
  const inOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  /* Loader: the fill follows real progress, but never outruns a minimum time, so it always reads as loading. */
  const OUTLINE = 1250, MIN_FILL = 900, GIVE_UP = 14000;   // the outline draws first; the fill starts as it nears the bottom
  let target = 0, shown = 0, ready = false;
  const parts = { fonts: 0, art: 0, video: 0 }, weight = { fonts: 0.25, art: 0.25, video: 0.5 };
  const done = (k) => {
    parts[k] = 1;
    target = Math.max(target, 0.06 + 0.94 * Object.keys(parts).reduce((n, key) => n + parts[key] * weight[key], 0));
    if (Object.values(parts).every(Boolean)) ready = true;
  };
  (document.fonts?.ready || Promise.resolve()).then(() => done('fonts'));
  Promise.all([...logo.querySelectorAll('img')].map((i) => (i.decode ? i.decode().catch(() => {}) : Promise.resolve()))).then(() => done('art'));
  const video = document.getElementById('heroVideo');
  // Hold the loop on its first frame behind the dark cover (it would otherwise play through the whole intro). play() below starts it
  // from the very beginning as the cover lifts, so the first playthrough is complete.
  if (video) { video.pause(); video.currentTime = 0; }
  if (!video || video.readyState >= 3) done('video');
  else { video.addEventListener('canplay', () => done('video'), { once: true }); video.addEventListener('error', () => done('video'), { once: true }); }

  function tick(now) {
    const el = now - t0;
    trace.style.clipPath = traceFor(inOut(Math.min(1, el / OUTLINE)));
    const cap = Math.min(1, Math.max(0, el - OUTLINE * 0.82) / MIN_FILL);
    shown += (Math.min(target, cap) - shown) * 0.16;
    fill.style.clipPath = clipFor(shown);
    if ((ready && shown > 0.985) || el > GIVE_UP) return play();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  function play() {
    fill.style.clipPath = 'none';
    trace.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: 'forwards' });     // the outline lets go as the anchor moves
    const T = 950, D0 = 80, anims = [];          // T: the anchor's whole move (lift, lean, slide)
    const run = (el, keyframes, opts) => { const a = el.animate(keyframes, { fill: 'both', ...opts }); anims.push(a); return a; };
    // Ease in (accelerate), then decelerate into place with a small overshoot that settles back: not linear.
    const lift = 'cubic-bezier(.55, 0, .25, 1.18)';      // anchor rising to the top: tiny overshoot
    const settle = 'cubic-bezier(.5, 0, .2, 1.3)';       // lean + slide into the logo: slightly bigger bounce-back

    // 1. anchor: centre -> top of the screen (still upright), a beat, then it leans over to 45deg as it slides left
    run(anchor, [
      { transform: START, offset: 0, easing: lift },
      { transform: TOP, offset: 0.44 },
      { transform: TOP, offset: 0.5, easing: settle },
      { transform: 'translate(0px, 0px) scale(1)', offset: 1 },
    ], { duration: T, delay: D0 });
    run(tilt, [
      { transform: 'rotate(-45deg)', offset: 0 },
      { transform: 'rotate(-45deg)', offset: 0.5, easing: settle },
      { transform: 'rotate(0deg)', offset: 1 },
    ], { duration: T, delay: D0 });

    // the dark cover lifts off the video while the anchor rises
    run(cover, [{ opacity: 1 }, { opacity: 0 }], { duration: 650, delay: D0 + 200, easing: 'ease' });
    if (video) setTimeout(() => { video.currentTime = 0; video.play().catch(() => {}); }, D0 + 200);   // the hero loop starts from frame one as the cover lifts

    // 2. YACHT expands outward from the anchor as it slides left
    const yachtAt = D0 + T * 0.52;                 // starts as the slide does
    run(yacht, [
      { opacity: 0, transform: 'translateX(-16%)', clipPath: 'inset(0 100% 0 0)' },
      { opacity: 1, transform: 'translateX(0)', clipPath: 'inset(0 0 0 0)' },
    ], { duration: 520, delay: yachtAt, easing: 'cubic-bezier(.22, .8, .2, 1)' });
    run(solid, [
      { opacity: 0, transform: 'translateX(-16%)', clipPath: 'inset(0 100% 0 0)' },
      { opacity: 1, transform: 'translateX(0)', clipPath: 'inset(0 0 0 0)' },
    ], { duration: 520, delay: yachtAt, easing: 'cubic-bezier(.22, .8, .2, 1)' });

    // 3. Rock-ettes is written with real pen strokes, in writing order, each drawn on along its own path.
    //    [pen speed in px/s, pen-lift pause after in ms]: the long sweeps are quick, the loops and small letters slower,
    //    and the pen lifts between strokes. Durations come from each path's real length.
    const PEN = {
      'R stem': [2400, 70], 'R bowl + leg': [3800, 90], 'o': [2400, 0], 'c hook': [700, 0],
      'c + k ascender': [3000, 60], 'k arm + leg': [2600, 70], 'hyphen': [1200, 90], 'e': [2400, 0],
      't (first)': [2800, 0], 't (second)': [2800, 60], 't crossbar': [3600, 60], 'e (second)': [2400, 0], 's': [2600, 0],
    };
    const scriptAt = yachtAt + 150;                 // starts while YACHT is still wiping out
    const pen = 'cubic-bezier(.45, .05, .4, .95)';  // each stroke eases in and out: slow start, quick middle, slow finish
    const PEN_SPEED = 1.9;                          // global pen speed: 1 = the slower first version, higher = faster
    let clock = 0;
    for (const path of strokePaths) {
      const [speed, pause] = PEN[path.dataset.stroke] || [2400, 0];
      const ms = Math.max(40, (path.dataset.len / (speed * PEN_SPEED)) * 1000);
      run(path, [{ strokeDashoffset: +path.dataset.hidden }, { strokeDashoffset: 0 }], { duration: ms, delay: scriptAt + clock, easing: pen });
      run(path.halo, [{ strokeDashoffset: +path.halo.dataset.hidden }, { strokeDashoffset: 0 }], { duration: ms, delay: scriptAt + clock, easing: pen });
      clock += ms + pause / PEN_SPEED;
    }
    const WRITE = clock;

    // 4. The CTAs and the next-show chip settle in
    const uiAt = scriptAt + WRITE * 0.45;
    run(bottom, [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 600, delay: uiAt, easing: 'ease-out' });
    run(tagline, [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 600, delay: uiAt, easing: 'ease-out' });
    run(nextShow, [{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 600, delay: uiAt, easing: 'ease-out' });   // settles in beneath the logo

    if (/[?&]hold/.test(location.search)) {   // dev: freeze the choreography so each beat can be inspected
      anims.forEach((a) => a.pause());
      window.__splash = { loadedAtMs: Math.round(performance.now() - t0), anims, seek: (ms) => anims.forEach((a) => { a.currentTime = ms; }), resume: () => anims.forEach((a) => a.play()) };
      window.__splash.seek(0);
      return;
    }
    Promise.all(anims.map((a) => a.finished)).then(() => {
      // Hand over to the normal (non-splash) styles, which look identical, then drop the animations.
      root.classList.remove('splash');
      fill.style.clipPath = '';
      trace.remove();
      solid.remove();
      anchor.style.transform = '';
      scriptImg.removeAttribute('mask');     // final state = the original artwork, pixel for pixel
      script.style.opacity = '';
      anims.forEach((a) => a.cancel());
      bottom.inert = false;
      nextShow.inert = false;
    }).catch(() => { trace.remove(); solid.remove(); root.classList.remove('splash'); scriptImg.removeAttribute('mask'); script.style.opacity = ''; bottom.inert = false; nextShow.inert = false; });
  }
})();
