import { createScene } from './scene.js';
import { createWater } from './water.js';
import { createYacht } from './yacht.js';
import { Spawner } from './spawner.js';

/* Hero 3D scene entry. Fails soft: any problem leaves the static poster in place (hero--fallback). */
const hero = document.querySelector('.hero');
const canvas = document.getElementById('heroCanvas');

/* Progress and readiness are broadcast as window events so the splash (js/splash.js) can drive its anchor
   loader from real load progress and only reveal the hero once the scene is warmed up. */
const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
const progress = (p) => emit('hero:progress', Math.min(1, p));
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

async function start() {
  const cfg = await (await fetch('data/scene.json')).json();
  progress(0.06);
  const mobile = window.matchMedia(`(max-width: ${cfg.mobile.breakpoint - 1}px), (pointer: coarse)`).matches;
  const rm = window.matchMedia('(prefers-reduced-motion: reduce)');

  const ctx = createScene(canvas, cfg, mobile);
  const water = createWater(cfg, mobile);
  ctx.scene.add(water.mesh);
  progress(0.12);
  const yacht = await createYacht(cfg, water, ctx.scene);
  progress(0.3);
  const spawner = new Spawner(ctx.scene, cfg, water, mobile);
  await spawner.init((f) => progress(0.3 + f * 0.5));   // every prop pool built = a step of the loader
  await spawner.prewarm();
  progress(0.82);

  let t = 4;                // start mid-swell so the still frame (reduced motion) already looks alive
  let last = 0, raf = 0, inView = true;

  const step = (dt) => {
    t += dt;
    water.update(t);
    yacht.update(dt, t);
    spawner.update(dt, t);
    ctx.update(dt);
  };
  const draw = () => {
    yacht.particles.forEach((p) => p.setPixelScale(ctx.pixelScale()));
    ctx.render();
  };
  const frame = (now) => {
    raf = 0;
    if (!shouldRun()) return;
    step(Math.min((now - last) / 1000, 0.05));
    last = now;
    draw();
    raf = requestAnimationFrame(frame);
  };
  const shouldRun = () => inView && !document.hidden && !rm.matches;
  const sync = () => {
    if (shouldRun() && !raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
    else if (!shouldRun() && raf) { cancelAnimationFrame(raf); raf = 0; }
  };
  const still = () => { step(0.016); draw(); };   // one frame: reduced motion, or after a resize while paused

  // Resizing clears the canvas, so redraw in the same frame: a resize must never show as a blank flash.
  const resize = () => { ctx.resize(); if (raf) draw(); else still(); };
  resize();
  new ResizeObserver(resize).observe(hero);
  new IntersectionObserver(([e]) => { inView = e.isIntersecting; sync(); }).observe(hero);
  document.addEventListener('visibilitychange', sync);
  rm.addEventListener?.('change', sync);
  if (!mobile) window.addEventListener('pointermove', (e) => {
    ctx.pointer.x = (e.clientX / innerWidth) * 2 - 1;
    ctx.pointer.y = (e.clientY / innerHeight) * 2 - 1;
  }, { passive: true });

  // Warm-up: compile every shader and push textures/shadow maps to the GPU now, behind the splash, so the first
  // visible frames are not the expensive ones.
  window.heroScene = { cfg, ctx, water, yacht, spawner };   // handy for tuning in the console
  try { await (ctx.renderer.compileAsync ? ctx.renderer.compileAsync(ctx.scene, ctx.camera) : ctx.renderer.compile(ctx.scene, ctx.camera)); } catch (e) { /* first draw compiles anyway */ }
  progress(0.92);
  for (let i = 0; i < 4; i++) { still(); await nextFrame(); }
  hero.classList.add('hero--3d');   // reveals the canvas over the poster
  sync();
  progress(1);
  emit('hero:ready', { ok: true });
}

start().catch((err) => {
  console.warn('[hero3d] falling back to poster:', err);
  hero.classList.add('hero--fallback');
  emit('hero:ready', { ok: false });
});
