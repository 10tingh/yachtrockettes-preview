/* Nav only: hide the fixed nav while the hero fills the screen (body.at-hero).
   Scrolling itself is left completely alone: no wheel, touch or keyboard handling, no snapping between sections. */
(function () {
  'use strict';
  const hero = document.getElementById('hero');
  if (!hero) return;
  const syncNav = () => document.body.classList.toggle('at-hero', window.scrollY < hero.offsetHeight * 0.6);
  window.addEventListener('scroll', syncNav, { passive: true });
  window.addEventListener('resize', syncNav);
  syncNav();
})();
