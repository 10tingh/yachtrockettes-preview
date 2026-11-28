/* Yacht Rock-ettes concept: vanilla JS, no dependencies.
   Content lives in /data/*.json. Serve over http (e.g. `python -m http.server`) so fetch() works. */
(function () {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const getJSON = (p) => fetch(p).then((r) => { if (!r.ok) throw new Error(p + ' ' + r.status); return r.json(); });

  $('#yr').textContent = new Date().getFullYear();

  /* ---------- Site settings (js/config.js) ---------- */
  const CFG = window.SITE_CONFIG || {};
  // The contact email is set once, in js/config.js: every visible email and mailto link on the page is filled from it.
  if (CFG.contactEmail) document.querySelectorAll('[data-email]').forEach((el) => { el.href = `mailto:${CFG.contactEmail}`; el.textContent = CFG.contactEmail; });

  /* ---------- Burger menu (under 900px) ---------- */
  const navEl = $('#top'), burger = $('#navBurger'), navMenu = $('#navMenu');
  if (navEl && burger && navMenu) {
    const setMenu = (on) => {
      navEl.classList.toggle('menu-open', on);
      document.documentElement.classList.toggle('menu-open', on);        // locks the page scroll behind the menu
      burger.setAttribute('aria-expanded', String(on));
      burger.setAttribute('aria-label', on ? 'Close menu' : 'Open menu');
      navMenu.inert = !on;
      if (on) navMenu.querySelector('a').focus({ preventScroll: true });
    };
    burger.addEventListener('click', () => setMenu(!navEl.classList.contains('menu-open')));
    navMenu.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });   // choosing a section closes it, and the page scrolls there
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && navEl.classList.contains('menu-open')) { setMenu(false); burger.focus(); } });
    window.matchMedia('(min-width: 900px)').addEventListener('change', (e) => { if (e.matches) setMenu(false); });
  }

  /* ---------- Background loops (hero + Book section): off for reduced motion, paused when off-screen ---------- */
  const loops = [$('#heroVideo'), $('#bookVideo')].filter(Boolean);
  const rm = window.matchMedia('(prefers-reduced-motion: reduce)');
  const inView = new Map();
  function syncMotion(v) {
    if (rm.matches || !inView.get(v)) { v.removeAttribute('autoplay'); v.pause(); }
    else if (!document.documentElement.classList.contains('splash')) { v.play().catch(() => {}); }   // during the logo intro js/splash.js starts the hero loop itself, from frame one
  }
  loops.forEach((v) => new IntersectionObserver(([e]) => { inView.set(v, e.isIntersecting); syncMotion(v); }).observe(v));
  rm.addEventListener?.('change', () => loops.forEach(syncMotion));

  /* ---------- Featured video: click to load and play with sound ---------- */
  const playBtn = $('#playBtn'), main = $('#mainVideo');
  playBtn?.addEventListener('click', () => {
    main.hidden = false; main.preload = 'auto'; playBtn.hidden = true;
    loops.forEach((v) => v.pause());
    main.play().catch(() => {}); main.focus();
  });

  /* ---------- Spotify (lazy, only when a URL is set) ---------- */
  const slot = $('#spotifySlot');
  const spotify = slot?.dataset.spotifyUrl;
  if (spotify && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => {
      if (!es[0].isIntersecting) return; io.disconnect();
      const src = spotify.replace('open.spotify.com/', 'open.spotify.com/embed/');
      slot.innerHTML = `<iframe title="Yacht Rock-ettes on Spotify" src="${esc(src)}" loading="lazy" allow="encrypted-media; clipboard-write"></iframe>`;
    }, { rootMargin: '300px' });
    io.observe(slot);
  }

  /* ---------- Songs: a shelf of record sleeves ---------- */
  const shelf = $('#songShelf'), prev = $('#songPrev'), next = $('#songNext');
  function syncShelfButtons() {
    if (!shelf) return;
    prev.disabled = shelf.scrollLeft < 8;
    next.disabled = shelf.scrollLeft + shelf.clientWidth >= shelf.scrollWidth - 8;
  }
  getJSON('data/songs.json').then(({ songs }) => {
    const live = songs.filter((s) => !s.tbc);
    // Spotify has no per-song id in our data yet, so each record opens a Spotify search for that song and artist. Put an exact
    // link in songs.json ("spotify": "https://open.spotify.com/track/...") and it is used instead.
    const spotifyUrl = (s) => s.spotify || 'https://open.spotify.com/search/' + encodeURIComponent(`${s.title} ${s.artist || ''}`.trim());
    const GO = '<svg class="sleeve__go" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M240,128a15.74,15.74,0,0,1-7.6,13.51L88.32,229.65a16,16,0,0,1-16.2.3A15.86,15.86,0,0,1,64,216.13V39.87a15.86,15.86,0,0,1,8.12-13.82,16,16,0,0,1,16.2.3L232.4,114.49A15.74,15.74,0,0,1,240,128Z"/></svg>';
    // Cover art order: no two neighbours share a logo piece, and the gold-heavy covers are spread out along the shelf
    const COVER_ORDER = [0, 3, 9, 5, 6, 15, 12, 10, 8, 11, 2, 17, 1, 14, 16, 13, 7, 4, 18];
    $('#songTrack').innerHTML = live.map((s, i) => `<li class="sleeve art-${COVER_ORDER[i % COVER_ORDER.length]}"><a class="sleeve__link" href="${esc(spotifyUrl(s))}" data-track="${esc(((s.spotify || '').match(/track\/([A-Za-z0-9]{22})/) || [])[1] || '')}" target="_blank" rel="noopener noreferrer">
      <div class="sleeve__disc" aria-hidden="true"></div>
      <div class="sleeve__cover"><div class="sleeve__art" aria-hidden="true">${GO}</div>
      <div class="sleeve__text"><span class="sleeve__title">${esc(s.title)}</span>${s.artist ? `<span class="sleeve__artist">${esc(s.artist)}</span>` : ''}</div></div>
      <span class="sr-only">, play it on this page. Opens the song on Spotify in a new tab if the player is unavailable.</span></a></li>`).join('');   // the link's name is its visible text (title, artist) plus this hint
    syncShelfButtons();
  }).catch(console.error);
  /* Click a record: it plays in Spotify's own embed under the shelf. Spotify's script is only fetched on the first click, so nothing
     third-party loads until someone asks for it. The click is the permission browsers need to start audio. Visitors who are not
     logged in to Spotify get a 30-second preview; logged-in visitors get the full song. If the player cannot load, the link still
     opens the song on Spotify in a new tab. */
  const panel = $('#songPlayer'), embedSlot = $('#songEmbed');
  let apiReady = null, controller = null, wantPlay = false, current = -1, ended = false, ignoreUntil = 0, lastPlayingPos = 0, lastDur = 0;
  const songLinks = () => [...document.querySelectorAll('#songTrack .sleeve__link')];
  const loadSpotifyApi = () => (apiReady ||= new Promise((resolve, reject) => {
    window.onSpotifyIframeApiReady = resolve;
    const sc = document.createElement('script');
    sc.src = 'https://open.spotify.com/embed/iframe-api/v1'; sc.async = true; sc.onerror = reject;
    document.head.appendChild(sc);
    setTimeout(() => reject(new Error('Spotify player timed out')), 10000);
  }));
  const clearPlaying = () => document.querySelectorAll('.sleeve.is-playing').forEach((el) => el.classList.remove('is-playing'));
  /* keep the playing record in view: scroll the shelf sideways only, never the page */
  function bringIntoView(link) {
    const r = link.closest('.sleeve').getBoundingClientRect(), s = shelf.getBoundingClientRect();
    shelf.scrollBy({ left: r.left - s.left - (shelf.clientWidth - r.width) / 2, behavior: rm.matches ? 'auto' : 'smooth' });
  }
  /* When a song ends, move on to the next record in the shelf, like a playlist. The last song just stops. */
  function playNext() {
    const next = songLinks()[current + 1];
    if (next) playSong(next, { fromUser: false }); else clearPlaying();
  }
  async function playSong(link, { fromUser = true } = {}) {
    const id = link.dataset.track; if (!id) return false;
    current = songLinks().indexOf(link); ended = false; lastPlayingPos = 0; lastDur = 0; ignoreUntil = Date.now() + 2500;   // ignore stale events from the song that just finished
    clearPlaying();
    link.closest('.sleeve').classList.add('is-playing');
    panel.classList.add('is-open'); panel.inert = false;
    const uri = `spotify:track:${id}`;
    try {
      const api = await loadSpotifyApi();
      wantPlay = true;
      if (!controller) {
        const target = document.createElement('div'); embedSlot.appendChild(target);
        controller = await new Promise((res) => api.createController(target, { uri, width: '100%', height: 152 }, res));
        controller.addListener('ready', () => { if (wantPlay) { wantPlay = false; controller.play(); } });
        controller.addListener('playback_update', (e) => {
          const { duration, position, isPaused } = e.data || {};
          if (Date.now() < ignoreUntil || ended || !(duration > 0)) return;
          if (!isPaused) { lastPlayingPos = position; lastDur = duration; }
          // Spotify ends a song by reporting the full length, then snapping back to 0:00 paused. Either signal moves us on.
          const reachedEnd = !isPaused && position >= duration - 250;
          const wrappedToStart = isPaused && position < 1500 && lastDur > 0 && lastPlayingPos >= lastDur - 3000;
          if (reachedEnd || wrappedToStart) { ended = true; playNext(); }
        });
      } else { controller.loadUri(uri); }
      if (fromUser) setTimeout(() => panel.scrollIntoView({ block: 'nearest', behavior: rm.matches ? 'auto' : 'smooth' }), 350);
      bringIntoView(link);
      return true;
    } catch (err) { console.warn('[songs] on-page player unavailable:', err); return false; }
  }
  $('#songTrack')?.addEventListener('click', async (e) => {
    const link = e.target.closest('.sleeve__link');
    if (!link || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;   // modified clicks keep the normal new-tab behaviour
    e.preventDefault();
    if (!(await playSong(link))) window.open(link.href, '_blank', 'noopener');
  });

  const nudge = (dir) => shelf.scrollBy({ left: dir * shelf.clientWidth * 0.8, behavior: rm.matches ? 'auto' : 'smooth' });
  prev?.addEventListener('click', () => nudge(-1));
  next?.addEventListener('click', () => nudge(1));
  shelf?.addEventListener('scroll', syncShelfButtons, { passive: true });
  window.addEventListener('resize', syncShelfButtons);

  /* ---------- Event types ---------- */
  const ICONS = {
    briefcase: '<path d="M4 8h16v11H4zM9 8V5h6v3M4 13h16"/>',
    glass: '<path d="M7 3h10l-1 7a4 4 0 0 1-8 0zM12 14v7M8 21h8"/>',
    sun: '<path d="M3 17h18M6 17a6 6 0 0 1 12 0M12 5v3M4.5 9l2 2M19.5 9l-2 2"/>',
    curtain: '<path d="M3 4h18M5 4c0 6-1 12-2 16M19 4c0 6 1 12 2 16M12 4v16M9 20h6"/>'
  };
  getJSON('data/events.json').then(({ events }) => {
    // four equal cards in a 2x2 grid: photo, then the name, copy and an inquiry link
    const pic = (e) => {
      const set = (ext) => e.widths.map((w) => `assets/img/${e.image}-${w}.${ext} ${w}w`).join(', ');
      return `<picture><source type="image/webp" srcset="${set('webp')}" sizes="(min-width: 760px) 560px, 92vw"><img src="assets/img/${e.image}-${e.widths[0]}.jpg" srcset="${set('jpg')}" sizes="(min-width: 760px) 560px, 92vw" alt="${esc(e.alt)}"${e.focus ? ` style="object-position:${esc(e.focus)}"` : ''} width="3" height="2" loading="lazy" decoding="async"></picture>`;
    };
    $('#eventList').innerHTML = events.map((e) => `<article class="evcard">
      <figure class="evcard__photo">${pic(e)}</figure>
      <div class="evcard__body">
        <h3><svg class="evcard__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[e.icon] || ''}</svg>${esc(e.title)}</h3>
        <p>${esc(e.blurb)}</p><a class="evcard__cta" href="#book">Send an inquiry</a>
      </div></article>`).join('');
  }).catch(console.error);

  /* ---------- Proof: testimonials ---------- */
  // The whole section stays hidden (no heading, no empty slide) until data/testimonials.json has at least one entry with a quote.
  getJSON('data/testimonials.json').then(({ testimonials }) => {
    const proof = $('#proof');
    const quotes = (Array.isArray(testimonials) ? testimonials : []).filter((t) => t && String(t.quote || '').trim());
    if (!proof || !quotes.length) return;
    // "Name, Event type (Source)": every part but the quote is optional
    const caption = (t) => {
      const who = [t.name, t.eventType].map((x) => String(x || '').trim()).filter(Boolean).join(', ');
      const src = String(t.source || '').trim();
      return who ? (src ? `${who} (${src})` : who) : src;
    };
    // one quote at a time: the slides stack in one grid cell (so the height never jumps) and cross-fade; a progress line moves on to the next
    const slides = $('#quotes'), prog = $('#tProg'), count = $('#tCount');
    slides.innerHTML = quotes.map((t, i) => `<figure class="tq" role="group" aria-roledescription="slide" aria-label="${i + 1} of ${quotes.length}"><blockquote><p>${esc(t.quote)}</p></blockquote>${caption(t) ? `<figcaption>${esc(caption(t))}</figcaption>` : ''}</figure>`).join('');
    const items = [...slides.children];
    let cur = 0;
    const restart = () => { prog.classList.remove('run'); void prog.offsetWidth; prog.classList.add('run'); };   // restarts the timer line
    const show = (i) => {
      cur = (i + items.length) % items.length;
      items.forEach((el, k) => { el.classList.toggle('is-active', k === cur); el.inert = k !== cur; });
      count.textContent = `${String(cur + 1).padStart(2, '0')} / ${String(items.length).padStart(2, '0')}`;
      restart();
    };
    $('#tPrev').addEventListener('click', () => show(cur - 1));
    $('#tNext').addEventListener('click', () => show(cur + 1));
    prog.addEventListener('animationend', () => show(cur + 1));   // the timer line finishing is what advances it (and it does not run for reduced motion)
    proof.hidden = false;
    if (items.length === 1) $('.testi__bar', proof).hidden = true;   // nothing to page through
    show(0);
  }).catch(() => {});

  /* ---------- Booking form ---------- */
  const form = $('#bookForm'), status = $('#formStatus'), flip = $('#flip'), thanks = $('#thanks');
  // the card turns over to a big thank-you on success, and back again for another inquiry
  const setFlipped = (on) => {
    flip.classList.toggle('is-flipped', on);
    form.inert = on; thanks.inert = !on; thanks.setAttribute('aria-hidden', on ? 'false' : 'true');
    if (on) {
      flip.scrollIntoView({ block: 'center', behavior: rm.matches ? 'auto' : 'smooth' });   // on a phone the person is at the bottom of a tall card: bring the message into view
      setTimeout(() => thanks.focus({ preventScroll: true }), 650);
    } else form.elements.name.focus({ preventScroll: true });
  };
  $('#thanksAgain').addEventListener('click', () => setFlipped(false));
  const rules = {
    name: (v) => (v.trim().length < 2 ? 'Please enter your name.' : ''),
    email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? '' : 'Please enter a valid email address.'),
    phone: (v) => (!v || v.replace(/\D/g, '').length >= 7 ? '' : 'That phone number looks short.'),
    eventType: (v) => (v ? '' : 'Please choose an event type.'),
    eventDate: (v) => (v ? '' : 'Please choose a date (a rough one is fine).'),
    location: (v) => (v.trim().length < 2 ? 'Please tell us the city or venue.' : '')
  };
  function validate(name) {
    const el = form.elements[name]; if (!el) return true;
    const msg = rules[name](el.value); const field = el.closest('.field');
    field.classList.toggle('is-invalid', !!msg);
    el.setAttribute('aria-invalid', msg ? 'true' : 'false');
    const err = $(`[data-err-for="${name}"]`, field); if (err) err.textContent = msg;
    return !msg;
  }
  Object.keys(rules).forEach((n) => form.elements[n]?.addEventListener('blur', () => validate(n)));

  /* buildPayload() is the clean, structured record of an inquiry (ready for a future CRM). formspreeBody() flattens it to the
     form's own field names for Formspree, which needs a top-level "email" to set the reply-to. */
  function buildPayload() {
    const f = new FormData(form);
    return {
      contact: { name: f.get('name').trim(), email: f.get('email').trim(), phone: (f.get('phone') || '').trim() },
      event: { type: f.get('eventType'), date: f.get('eventDate'), location: f.get('location').trim() },
      message: (f.get('message') || '').trim(),
      meta: { source: 'landing-page-concept', submittedAt: new Date().toISOString(), page: location.href }
    };
  }
  function formspreeBody(p) {
    const type = form.elements.eventType.selectedOptions[0]?.textContent.trim() || p.event.type;
    const [y, m, d] = p.event.date.split('-').map(Number);
    const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
    return {
      name: p.contact.name, email: p.contact.email, phone: p.contact.phone,
      eventType: p.event.type, eventDate: p.event.date, location: p.event.location, message: p.message,
      source: p.meta.source, page: p.meta.page, submittedAt: p.meta.submittedAt,
      _subject: `Booking inquiry: ${type}, ${date}`,
      _gotcha: form.elements._gotcha.value
    };
  }
  // Sends the inquiry to Formspree (js/config.js: formspreeFormId). While the id is still the placeholder nothing is sent.
  async function submitInquiry(payload) {
    const id = CFG.formspreeFormId;
    if (!id || /^PASTE/i.test(id)) return { ok: false };
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 15000);
    try {
      const r = await fetch(`https://formspree.io/f/${encodeURIComponent(id)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(formspreeBody(payload)), signal: ctl.signal
      });
      return { ok: r.ok };
    } finally { clearTimeout(timer); }
  }
  function showSendError() {
    const mail = CFG.contactEmail;
    status.className = 'form__status err';
    status.innerHTML = 'Sorry, your inquiry did not go through. Please try again' + (mail ? `, or email us at <a href="mailto:${esc(mail)}?subject=Booking%20inquiry">${esc(mail)}</a>.` : '.');
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); status.className = 'form__status'; status.textContent = '';
    if (form.elements._gotcha.value) return; // honeypot: a bot filled the hidden field
    const results = Object.keys(rules).map(validate);
    if (results.includes(false)) {
      status.className = 'form__status err'; status.textContent = 'Please fix the highlighted fields.';
      form.querySelector('.is-invalid input, .is-invalid select')?.focus(); return;
    }
    const btn = form.querySelector('button[type=submit]'), label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Sending...';
    try {
      const { ok } = await submitInquiry(buildPayload());
      if (!ok) throw new Error('not sent');
      form.reset(); setFlipped(true);
    } catch (err) {
      showSendError();     // the form stays filled in
    } finally { btn.disabled = false; btn.textContent = label; }
  });

  /* ---------- About: remember the closed height, so the content stays put while an item opens ---------- */
  const who = $('#about'), whoGrid = $('.who__grid');
  const measureWho = () => {
    const open = [...document.querySelectorAll('.pillar')].reduce((n, d) => n + (d.open ? d.querySelector('.pillar__more').offsetHeight : 0), 0);
    who.style.setProperty('--who-h', (whoGrid.offsetHeight - open) + 'px');   // the height with everything closed
  };
  measureWho();
  window.addEventListener('resize', measureWho);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureWho);
  window.addEventListener('load', measureWho);

  /* ---------- About accordion: smooth open and close ---------- */
  // Native <details> jumps open and shut. This animates the height (and fades the text) in both directions; the toggle can be
  // clicked again mid-way and it turns round from wherever it is. Reduced motion (or no WAAPI) keeps the plain native behaviour.
  document.querySelectorAll('.pillar').forEach((d) => {
    const sum = d.querySelector('summary'), more = d.querySelector('.pillar__more');
    if (!sum || !more || !more.animate) return;
    let anim = null;
    sum.addEventListener('click', (e) => {
      if (rm.matches) return;
      e.preventDefault();
      const open = !(d.open && !d.classList.contains('is-closing'));       // what we are heading towards
      const from = anim ? more.getBoundingClientRect().height : (d.open ? more.scrollHeight : 0);
      const fromOp = anim ? parseFloat(getComputedStyle(more).opacity) : (d.open ? 1 : 0);
      if (anim) anim.cancel();
      d.classList.toggle('is-closing', !open);
      if (open) d.open = true;
      more.style.overflow = 'hidden';
      const to = open ? more.scrollHeight : 0;
      anim = more.animate(
        { height: [from + 'px', to + 'px'], opacity: [fromOp, open ? 1 : 0] },
        { duration: open ? 520 : 380, easing: open ? 'cubic-bezier(.22, 1, .36, 1)' : 'cubic-bezier(.4, 0, .2, 1)' }
      );
      const a = anim;
      a.onfinish = () => { if (anim !== a) return; anim = null; more.style.overflow = ''; d.classList.remove('is-closing'); if (!open) d.open = false; };
    });
  });

  /* ---------- Subtle reveal on scroll ---------- */
  if ('IntersectionObserver' in window && !rm.matches) {
    const els = document.querySelectorAll('.section__head, .who__photo, .pillars li, .album, .evcard, .testi, .form');
    els.forEach((el) => el.classList.add('reveal'));
    const io = new IntersectionObserver((es) => es.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { rootMargin: '0px 0px -8% 0px' });
    els.forEach((el) => io.observe(el));
  }
})();
