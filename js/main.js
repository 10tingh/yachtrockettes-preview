/* Yacht Rock-ettes concept: vanilla JS, no dependencies.
   Content lives in /data/*.json. Serve over http (e.g. `python -m http.server`) so fetch() works. */
(function () {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const getJSON = (p) => fetch(p).then((r) => { if (!r.ok) throw new Error(p + ' ' + r.status); return r.json(); });

  $('#yr').textContent = new Date().getFullYear();

  /* ---------- Phones held upright get a vertical cut of the hero that follows the lead singer ---------- */
  // The widescreen hero is cropped to a narrow slice on a tall screen, and the singers drift out of it. The mobile file is the same clip with a 9:16 crop window that tracks the vocalists (tools/build_hero_candidates.py). Landscape phones and tablets keep the widescreen one.
  const heroEl = $('#heroVideo');
  if (heroEl && window.matchMedia('(max-width: 700px) and (orientation: portrait)').matches) {
    heroEl.setAttribute('poster', 'assets/video/hero-final-mobile-poster.jpg');
    heroEl.innerHTML = '<source src="assets/video/hero-final-mobile.webm" type="video/webm"><source src="assets/video/hero-final-mobile.mp4" type="video/mp4">';
    heroEl.load();
  }

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
    if (rm.matches || !inView.get(v)) { v.removeAttribute('autoplay'); v.pause(); } else { v.play().catch(() => {}); }
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
    $('#songTrack').innerHTML = live.map((s, i) => `<li class="sleeve art-${COVER_ORDER[i % COVER_ORDER.length]}"><a class="sleeve__link" href="${esc(spotifyUrl(s))}" data-track="${esc(((s.spotify || '').match(/track\/([A-Za-z0-9]{22})/) || [])[1] || '')}" target="_blank" rel="noopener noreferrer" aria-label="${esc(s.title)}${s.artist ? ' by ' + esc(s.artist) : ''}, play it on this page; opens the song on Spotify in a new tab if the player is unavailable">
      <div class="sleeve__disc" aria-hidden="true"></div>
      <div class="sleeve__cover"><div class="sleeve__art" aria-hidden="true">${GO}</div>
      <div class="sleeve__text"><span class="sleeve__title">${esc(s.title)}</span>${s.artist ? `<span class="sleeve__artist">${esc(s.artist)}</span>` : ''}</div></div></a></li>`).join('');
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

  /* ---------- Shows (sorted, past hidden, schema injected) ---------- */
  getJSON('data/shows.json').then(({ shows }) => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const parse = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
    const upcoming = shows.filter((s) => parse(s.date) >= today).sort((a, b) => parse(a.date) - parse(b.date));
    const list = $('#showList');

    if (!upcoming.length) {
      list.innerHTML = '<li class="empty">New dates are on the way. Planning an event? <a href="#book">Send us an inquiry</a>.</li>';
    } else {
      list.innerHTML = upcoming.map((s) => {
        const d = parse(s.date);
        const mo = d.toLocaleDateString('en-US', { month: 'short' });
        const wd = d.toLocaleDateString('en-US', { weekday: 'long' });
        const link = s.private ? '<span class="show__private">Private event</span>' : s.url ? `<a class="show__link" href="${esc(s.url)}">Info &amp; tickets<span class="sr-only"> for ${esc(s.venue)}</span></a>` : '';
        return `<li class="show">
          <time class="show__date" datetime="${esc(s.date)}"><span class="show__mo">${mo}</span><span class="show__day">${d.getDate()}</span></time>
          <div><p class="show__venue">${esc(s.venue)}${s.set ? `<span class="tag tag--set">${esc(s.set)}</span>` : ''}</p>
          <p class="show__meta">${wd} &middot; ${esc(s.city)}, ${esc(s.state)}</p></div>${link}</li>`;
      }).join('');

      // Hero "next show" chip
      const n = upcoming.find((s) => !s.private) || upcoming[0], nd = parse(n.date);
      // Wide screens: "Jan 23 · Venue, City". Phones hide the venue and add the state: "Jan 23 · City, ST" (see .ns__venue / .ns__st).
      const nsDate = nd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      $('#nextShowText').innerHTML = `${esc(nsDate)} &middot; <span class="ns__venue">${esc(n.venue)}, </span>${esc(n.city)}<span class="ns__st">, ${esc(n.state)}</span>`;
      $('#nextShow').setAttribute('aria-label', `Next show: ${nsDate}, ${n.venue}, ${n.city}, ${n.state}`);
      $('#nextShow').hidden = false;

      // Event structured data (real dates only; skip placeholders at launch by removing the flag)
      const ld = upcoming.filter((s) => !s.private).map((s) => ({
        '@context': 'https://schema.org', '@type': 'Event', name: `Yacht Rock-ettes at ${s.venue}`, startDate: s.date,
        eventStatus: 'https://schema.org/EventScheduled',
        location: { '@type': 'Place', name: s.venue, address: { '@type': 'PostalAddress', addressLocality: s.city, addressRegion: s.state } },
        performer: { '@type': 'MusicGroup', name: 'Yacht Rock-ettes' }
      }));
      const tag = document.createElement('script'); tag.type = 'application/ld+json'; tag.textContent = JSON.stringify(ld);
      document.head.appendChild(tag);
    }
  }).catch(console.error);

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

  /* ---------- Proof ---------- */
  getJSON('data/testimonials.json').then(({ testimonials }) => {
    // one quote at a time: the slides stack in one grid cell (so the height never jumps) and cross-fade; a progress line moves on to the next
    const slides = $('#quotes'), prog = $('#tProg'), count = $('#tCount');
    slides.innerHTML = testimonials.map((t, i) => `<figure class="tq" role="group" aria-roledescription="slide" aria-label="${i + 1} of ${testimonials.length}"><blockquote><p>${esc(t.quote)}</p></blockquote><figcaption>${esc(t.role)}</figcaption></figure>`).join('');
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
    show(0);
  }).catch(console.error);

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

  /* Structured payload, ready for a future CRM/webhook. Set ENDPOINT to wire it up. */
  const ENDPOINT = null;
  function buildPayload() {
    const f = new FormData(form);
    return {
      contact: { name: f.get('name').trim(), email: f.get('email').trim(), phone: (f.get('phone') || '').trim() },
      event: { type: f.get('eventType'), date: f.get('eventDate'), location: f.get('location').trim() },
      message: (f.get('message') || '').trim(),
      meta: { source: 'landing-page-concept', submittedAt: new Date().toISOString(), page: location.href }
    };
  }
  async function submitInquiry(payload) {
    if (!ENDPOINT) { console.info('[Booking inquiry: placeholder handler]', payload); return { ok: true }; }
    const r = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return { ok: r.ok };
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); status.className = 'form__status'; status.textContent = '';
    if (form.elements.website.value) return; // honeypot
    const results = Object.keys(rules).map(validate);
    if (results.includes(false)) {
      status.className = 'form__status err'; status.textContent = 'Please fix the highlighted fields.';
      form.querySelector('.is-invalid input, .is-invalid select')?.focus(); return;
    }
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      const { ok } = await submitInquiry(buildPayload());
      if (!ok) throw new Error('bad response');
      form.reset(); setFlipped(true);
    } catch (err) {
      status.className = 'form__status err'; status.textContent = 'Something went wrong. Please try again, or email us directly.';
    } finally { btn.disabled = false; }
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
