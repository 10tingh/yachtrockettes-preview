/* Upcoming shows, read live from the band's public Google Calendar (Calendar API v3, events.list). Settings (API key, calendar id)
   are in js/config.js. This file also runs under Node for the tests (tests/shows/test_shows.js): the pure functions are exported.

   How the calendar is written (found by reading its public iCal feed, see README "Calendar conventions"):
   - SUMMARY is the show or event name (usually the venue or the festival), LOCATION is a Google Maps address:
     "Venue, street, City, ST ZIP, USA" (the venue part is sometimes missing: "151 N Island Ave, Batavia, IL 60510, USA").
   - Most events are timed (stored in UTC); private gigs are usually all-day events titled "Private Party" / "Private Event".
   - A ticket or info link, when there is one, is typed into DESCRIPTION as HTML (<a href>) or a plain URL. There is no URL field.
   - Titles often spell the band name without the hyphen, and have stray spaces or a "(public!)" note, so names are cleaned before display. */
(function (root) {
  'use strict';

  const TZ = 'America/Chicago';
  const COUNT = 6;                                   // how many shows to list
  const SEE_ALL = 'https://calendar.google.com/calendar/embed?src=a7b68q49t730bv3icl5p7povks%40group.calendar.google.com&ctz=America%2FChicago';
  const SITE_URL = 'https://yachtrockettes.com/';
  const BAD_LINK_HOST = /(^|\.)(meet\.google\.com|support\.google\.com|calendar\.google\.com|maps\.google\.com|goo\.gl)$/i;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tidy = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const fmt = (opts, tz) => new Intl.DateTimeFormat('en-US', { timeZone: tz || TZ, ...opts });
  const ymd = (s) => s.split('-').map(Number);

  /* ---------- time ---------- */

  // UTC offset of Chicago at an instant, in minutes (-300 in summer, -360 in winter)
  function chicagoOffset(ms) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms) / 60000);
  }
  // An all-day event starts at midnight Chicago time: that is its place in the date order next to the timed shows
  const chicagoMidnight = (y, m, d) => Date.UTC(y, m - 1, d) - chicagoOffset(Date.UTC(y, m - 1, d, 6)) * 60000;

  /* ---------- cleaning ---------- */

  // A title like "<band name> @ Epiphany" becomes "Epiphany". The band's name is always written Yacht Rock-ettes on this site.
  function cleanName(raw) {
    let t = tidy(raw)
      .replace(/\(\s*public\s*!?\s*\)/ig, '')                    // an internal note some titles carry
      .replace(/Yacht\s*Rock-?ettes/gi, 'Yacht Rock-ettes');
    t = tidy(t);
    const short = tidy(t.replace(/^(?:Yacht Rock-ettes|YR)\s*(?:@|at)\s+/i, ''));
    t = short || t;
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  // Private gigs: the calendar title says so ("Private Party", "Private Event", "<band name> Private Gig"), or Google marks
  // the event private/confidential. (The public feed carries no visibility field, so the title is what actually matters.)
  function isPrivate(item) {
    return /\bprivate\b/i.test(item.summary || '') || /^(private|confidential)$/i.test(item.visibility || '');
  }

  // "Venue, 2100 W Belmont Ave, Chicago, IL 60618, USA" -> { venue, street, city, state, zip }. Anything unparseable gives {}.
  function parseLocation(raw) {
    const segs = tidy(raw).split(',').map(tidy).filter(Boolean);
    const si = segs.findIndex((s, i) => i > 0 && /^[A-Z]{2}(\s+\d{5}(-\d{4})?)?$/.test(s));
    if (si < 1) return {};
    const m = /^([A-Z]{2})(?:\s+(\d{5}))?/.exec(segs[si]);
    const out = { city: segs[si - 1], state: m[1], zip: m[2] };
    const pre = segs.slice(0, si - 1);
    if (pre.length >= 2) {
      if (/^\d/.test(pre[0])) out.street = pre.join(', ');
      else { out.venue = pre[0]; out.street = pre.slice(1).join(', '); }
    } else if (pre.length === 1) {
      if (/^\d/.test(pre[0])) out.street = pre[0];
      else out.venue = pre[0].replace(/\s\d{3,}\s.+$/, '');      // "Miami Valley Gaming 6000 OH-63" -> the venue name
    }
    if (out.venue && out.venue.toLowerCase() === out.city.toLowerCase()) delete out.venue;
    return out;
  }

  // The first usable link in the description: an <a href> or a plain URL. Google's redirect wrapper is unwrapped; Meet, help and
  // maps links are ignored. Only http(s) is accepted.
  function extractLink(desc) {
    if (!desc) return null;
    const html = String(desc), found = [];
    html.replace(/href\s*=\s*["']([^"']+)["']/gi, (_, u) => found.push(u));
    html.replace(/https?:\/\/[^\s<>"']+/gi, (u) => found.push(u));
    for (const raw of found) {
      try {
        let url = new URL(raw.replace(/&amp;/g, '&').trim());
        if (url.hostname.replace(/^www\./, '') === 'google.com' && url.pathname === '/url' && url.searchParams.get('q')) url = new URL(url.searchParams.get('q'));
        if (!/^https?:$/.test(url.protocol) || BAD_LINK_HOST.test(url.hostname)) continue;
        return url.href;
      } catch (e) { /* not a URL, try the next one */ }
    }
    return null;
  }

  /* ---------- one calendar item (events.list shape) -> what the page needs ---------- */

  function normalizeEvent(item) {
    if (!item || item.status === 'cancelled') return null;
    const s = item.start || {}, e = item.end || {};
    const allDay = !!s.date && !s.dateTime;
    if (!allDay && !s.dateTime) return null;
    const priv = isPrivate(item);
    const loc = parseLocation(item.location);
    let d, sortMs;
    if (allDay) { const [y, m, dd] = ymd(s.date); d = new Date(Date.UTC(y, m - 1, dd)); sortMs = chicagoMidnight(y, m, dd); } else { d = new Date(s.dateTime); sortMs = d.getTime(); }
    if (isNaN(d)) return null;
    const tz = allDay ? 'UTC' : TZ;
    const show = {
      id: item.id, private: priv, allDay, start: allDay ? s.date : s.dateTime, startMs: sortMs,
      month: fmt({ month: 'short' }, tz).format(d), day: Number(fmt({ day: 'numeric' }, tz).format(d)),
      weekday: fmt({ weekday: 'long' }, tz).format(d),
      shortDate: fmt({ month: 'short', day: 'numeric' }, tz).format(d),
      city: loc.city, state: loc.state
    };
    if (!allDay) show.time = fmt({ hour: 'numeric', minute: '2-digit' }).format(d).replace(/[  ]/g, ' ') + ' CT';
    if (allDay && e.date) {                                           // an all-day end date is the day after the last day
      const [y, m, dd] = ymd(e.date), last = new Date(Date.UTC(y, m - 1, dd) - 864e5);
      if (last.getTime() > d.getTime()) show.lastShortDate = fmt({ month: 'short', day: 'numeric' }, 'UTC').format(last);
    }
    if (priv) { show.name = 'Private event'; return show; }          // nothing but the date and city is ever kept
    show.name = cleanName(item.summary) || 'Show';
    const same = loc.venue && (show.name.toLowerCase().includes(loc.venue.toLowerCase()) || loc.venue.toLowerCase().includes(show.name.toLowerCase()));
    if (loc.venue && !same) show.venue = loc.venue;                   // the name already says it when it matches
    show.venueForSchema = loc.venue || show.name;
    show.street = loc.street; show.zip = loc.zip;
    show.link = extractLink(item.description);
    return show;
  }

  // The next COUNT shows, in date order
  function selectShows(items, count) {
    return (items || []).map(normalizeEvent).filter(Boolean).sort((a, b) => a.startMs - b.startMs).slice(0, count || COUNT);
  }

  /* ---------- markup ---------- */

  const place = (s) => (s.city ? `${s.city}, ${s.state}` : '');

  function rowHtml(s) {
    const when = s.allDay ? (s.lastShortDate ? `${s.shortDate} to ${s.lastShortDate}` : s.weekday) : s.weekday;
    const bits = s.private ? [when, place(s)] : [when, s.time, s.venue, place(s)];
    const link = s.link ? `<a class="show__link" href="${esc(s.link)}" rel="noopener">Info &amp; tickets<span class="sr-only"> for ${esc(s.name)}</span></a>` : '';
    return `<li class="show${s.private ? ' show--private' : ''}">
          <time class="show__date" datetime="${esc(s.start)}"><span class="show__mo">${esc(s.month)}</span><span class="show__day">${s.day}</span></time>
          <div><p class="show__venue">${esc(s.name)}</p>
          <p class="show__meta">${bits.filter(Boolean).map(esc).join(' &middot; ')}</p></div>${link}</li>`;
  }

  // Wide screens: "Jan 23 · Venue, City". Phones hide the venue and add the state: "Jan 23 · City, ST" (see .ns__venue / .ns__st).
  function chipParts(s) {
    if (s.private) return { html: `${esc(s.shortDate)} &middot; Private event${s.city ? `, ${esc(s.city)}` : ''}`, label: `Next show: ${s.shortDate}, Private event${s.city ? `, ${s.city}` : ''}` };
    const where = s.venue || s.name;
    const html = s.city
      ? `${esc(s.shortDate)} &middot; <span class="ns__venue">${esc(where)}, </span>${esc(s.city)}<span class="ns__st">, ${esc(s.state)}</span>`
      : `${esc(s.shortDate)} &middot; ${esc(where)}`;
    return { html, label: `Next show: ${s.shortDate}, ${where}${s.city ? `, ${s.city}, ${s.state}` : ''}` };
  }

  // Event structured data for the public shows only
  function schemaFor(shows) {
    return shows.filter((s) => !s.private).map((s) => {
      const loc = { '@type': 'Place', name: s.venueForSchema };
      if (s.city) {
        loc.address = { '@type': 'PostalAddress', addressLocality: s.city, addressRegion: s.state, addressCountry: 'US' };
        if (s.street) loc.address.streetAddress = s.street;
        if (s.zip) loc.address.postalCode = s.zip;
      }
      return {
        '@context': 'https://schema.org', '@type': 'Event',
        name: /Yacht Rock-ettes/.test(s.name) ? s.name : `Yacht Rock-ettes at ${s.name}`,
        startDate: s.start, eventStatus: 'https://schema.org/EventScheduled', location: loc,
        url: s.link || `${SITE_URL}#shows`,
        performer: { '@type': 'MusicGroup', name: 'Yacht Rock-ettes' }
      };
    });
  }

  function apiUrl(cfg, nowIso) {
    const q = new URLSearchParams({ key: cfg.googleCalendarApiKey, singleEvents: 'true', orderBy: 'startTime', timeMin: nowIso, maxResults: '12',
      timeZone: TZ, fields: 'items(id,status,summary,description,location,start,end,visibility)' });
    return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cfg.googleCalendarId)}/events?${q}`;
  }

  /* ---------- page ---------- */

  function init() {
    const list = document.getElementById('showList');
    if (!list) return;
    const cfg = window.SITE_CONFIG || {};
    const all = document.getElementById('showsAll');
    const chip = document.getElementById('nextShow');
    const fallback = () => {
      list.innerHTML = `<li class="empty">Our show dates are not loading right now. <a href="${SEE_ALL}" target="_blank" rel="noopener">View the full calendar</a>.</li>`;
      if (all) all.hidden = true;
      if (chip) chip.hidden = true;
      list.removeAttribute('aria-busy');
    };
    if (!cfg.googleCalendarApiKey || /^PASTE/i.test(cfg.googleCalendarApiKey)) return fallback();     // no key yet: do not call Google

    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl && setTimeout(() => ctl.abort(), 8000);
    fetch(apiUrl(cfg, new Date().toISOString()), ctl ? { signal: ctl.signal } : undefined)
      .then((r) => { if (!r.ok) throw new Error('calendar ' + r.status); return r.json(); })
      .then((data) => {
        const shows = selectShows(data.items, COUNT);
        list.removeAttribute('aria-busy');
        if (!shows.length) {
          list.innerHTML = '<li class="empty">New dates are on the way. Planning an event? <a href="#book">Send us an inquiry</a>.</li>';
          if (chip) chip.hidden = true;
        } else {
          list.innerHTML = shows.map(rowHtml).join('');
          if (chip) {
            const c = chipParts(shows[0]);
            document.getElementById('nextShowText').innerHTML = c.html;
            chip.setAttribute('aria-label', c.label);
            chip.hidden = false;
          }
          const ld = schemaFor(shows);
          if (ld.length) {
            const tag = document.createElement('script');
            tag.type = 'application/ld+json'; tag.id = 'showsSchema'; tag.textContent = JSON.stringify(ld);
            document.head.appendChild(tag);
          }
        }
        if (all) all.hidden = false;
      })
      .catch(fallback)
      .finally(() => timer && clearTimeout(timer));
  }

  const api = { cleanName, isPrivate, parseLocation, extractLink, normalizeEvent, selectShows, rowHtml, chipParts, schemaFor, apiUrl, COUNT, SEE_ALL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (root.document) { root.YRT_SHOWS = api; if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init(); }
})(typeof window !== 'undefined' ? window : globalThis);
