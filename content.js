// ── G Map Scrap — Content Script v2 ───────────────────────────────────────────
(function () {
  'use strict';

  // Prevent double-injection
  if (window.__gmapScrapRunning !== undefined) {
    try { chrome.runtime.sendMessage({ type: 'LOG', text: 'Script already active.', level: 'warn' }); } catch(e) {}
    return;
  }
  window.__gmapScrapRunning = false;

  let running = false;
  let results = new Map();
  let scrolls = 0;

  function sendLog(text, level = '') {
    try { chrome.runtime.sendMessage({ type: 'LOG', text, level }); } catch(e) {}
  }
  function sendProgress() {
    try { chrome.runtime.sendMessage({ type: 'PROGRESS', found: results.size, scrolls }); } catch(e) {}
  }

  // ── Find the scrollable results panel ─────────────────────────────────────
  function getScrollContainer() {
    // 1. role=feed (Google Maps search results list)
    const feed = document.querySelector('div[role="feed"]');
    if (feed) return feed;

    // 2. Any tall scrollable div (catches various Google layouts)
    const all = Array.from(document.querySelectorAll('div'));
    const scrollable = all.find(el => {
      const s = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return (s.overflowY === 'auto' || s.overflowY === 'scroll') &&
             el.scrollHeight > 800 &&
             rect.height > 300 &&
             rect.width > 200;
    });
    if (scrollable) return scrollable;

    // 3. Fallback
    return document.scrollingElement || document.documentElement;
  }

  function t(el) { return el?.innerText?.trim() || el?.textContent?.trim() || ''; }

  // ── Extract all visible result cards ──────────────────────────────────────
  function extractAll() {
    const before = results.size;

    // ── STRATEGY 1: Google Search local pack ──────────────────────────────
    // Each result card has an anchor linking to google.com/maps or /maps/place
    const links = Array.from(document.querySelectorAll(
      'a[href*="/maps/place/"], a[href*="google.com/maps/place"]'
    ));

    links.forEach(link => {
      try {
        const url = link.href || '';
        // Walk up 8 levels to find a container with a heading
        let card = link;
        let nameEl = null;
        for (let i = 0; i < 8; i++) {
          card = card.parentElement;
          if (!card) break;
          nameEl = card.querySelector('h3, [role="heading"]');
          if (nameEl && t(nameEl).length > 1) break;
          nameEl = null;
        }
        if (!nameEl) return;

        const name = t(nameEl);
        if (!name || name.length < 2) return;
        const key = name.toLowerCase().replace(/\s+/g, '');
        if (results.has(key)) return;

        // Rating from aria-label
        let rating = '';
        const ratingEl = card.querySelector('[aria-label*="stars"], [aria-label*="star"]');
        if (ratingEl) {
          const m = (ratingEl.getAttribute('aria-label') || '').match(/[\d.]+/);
          if (m) rating = m[0];
        }
        // Fallback: find a span matching "4.5" pattern
        if (!rating) {
          const spans = Array.from(card.querySelectorAll('span'));
          const rspan = spans.find(s => /^[1-5]\.[0-9]$/.test(t(s)));
          if (rspan) rating = t(rspan);
        }

        // Reviews
        let reviews = '';
        const revEl = card.querySelector('[aria-label*="review"]');
        if (revEl) {
          const m = (revEl.getAttribute('aria-label') || '').match(/[\d,]+/);
          if (m) reviews = m[0];
        }
        if (!reviews) {
          const spans = Array.from(card.querySelectorAll('span'));
          const rs = spans.find(s => /^\([\d,]+\)$/.test(t(s)));
          if (rs) reviews = t(rs).replace(/[()]/g, '');
        }

        // Address: text with numbers + road/street/sector keywords
        let address = '';
        const allText = Array.from(card.querySelectorAll('span, div'))
          .map(el => t(el))
          .filter(s => s.length > 5 && s.length < 150);
        const addrMatch = allText.find(s =>
          /\d/.test(s) &&
          (s.includes(',') || /\b(road|rd|street|st|nagar|sector|phase|block|colony|marg|ave|avenue|lane|near|district|mohali|chandigarh|delhi|mumbai|bangalore|hyderabad|punjab)\b/i.test(s))
        );
        if (addrMatch) address = addrMatch;

        // Category: short text near the name that isn't rating/address/reviews
        let category = '';
        const leafSpans = Array.from(card.querySelectorAll('span'))
          .filter(el => el.children.length === 0);
        const catEl = leafSpans.find(el => {
          const txt = t(el);
          return txt.length > 2 && txt.length < 50 &&
                 !txt.includes(name) &&
                 !/^\d+(\.\d+)?$/.test(txt) &&
                 !/^\([\d,]+\)$/.test(txt) &&
                 !/open|closed|closes|opens/i.test(txt) &&
                 txt !== rating && txt !== reviews;
        });
        if (catEl) category = t(catEl);

        // Hours
        let hours = '';
        const allT = Array.from(card.querySelectorAll('span, div')).map(e => t(e));
        const hMatch = allT.find(s => /\b(open|closed|closes|opens)\b/i.test(s) && s.length < 60);
        if (hMatch) hours = hMatch;

        // Phone
        let phone = '';
        const phMatch = allT.find(s => /^[+\d][\d\s\-().]{7,18}$/.test(s.trim()));
        if (phMatch) phone = phMatch.trim();

        // Website
        let website = '';
        const webEl = card.querySelector('a[href*="url?q="]');
        if (webEl) {
          const m = (webEl.getAttribute('href') || '').match(/url\?q=([^&]+)/);
          if (m) website = decodeURIComponent(m[1]);
        }

        results.set(key, { name, rating, reviews, category, address, phone, website, hours, url });
      } catch(e) { /* skip bad card */ }
    });

    // ── STRATEGY 2: Google Maps standalone (maps.google.com) ──────────────
    const mapCards = Array.from(document.querySelectorAll('.Nv2PK, .bfdHYd'));
    mapCards.forEach(card => {
      try {
        const nameEl = card.querySelector('.qBF1Pd, .fontHeadlineSmall, [class*="fontHeadline"]');
        if (!nameEl) return;
        const name = t(nameEl);
        if (!name) return;
        const key = name.toLowerCase().replace(/\s+/g, '');
        if (results.has(key)) return;

        const rating   = t(card.querySelector('.MW4etd, .ZkP5Je'));
        const reviews  = t(card.querySelector('.UY7F9, .e4rVHe')).replace(/[()]/g, '');
        const category = t(card.querySelector('.W4Efsd:first-of-type span'));
        const address  = t(card.querySelector('.W4Efsd:last-of-type span'));
        const link     = card.querySelector('a[href*="/maps/place/"]');
        const url      = link ? link.href : '';

        results.set(key, { name, rating, reviews, category, address, phone: '', website: '', hours: '', url });
      } catch(e) {}
    });

    return results.size - before;
  }

  // ── Human-like scroll ──────────────────────────────────────────────────────
  function humanScroll(el) {
    const amount = 300 + Math.random() * 400;
    el.scrollBy({ top: amount, behavior: 'smooth' });
    window.scrollBy({ top: Math.floor(amount * 0.3), behavior: 'smooth' });
  }

  const delay = ms => new Promise(r => setTimeout(r, ms + Math.random() * 600));

  // ── Scrape loop ────────────────────────────────────────────────────────────
  async function scrapeLoop() {
    sendLog('Scraper initialised. Detecting page structure...', '');

    const scrollEl = getScrollContainer();
    const tag = scrollEl.tagName + (scrollEl.className ? '.' + scrollEl.className.trim().split(/\s+/)[0] : '');
    sendLog(`Scroll container: ${tag} (scrollHeight: ${scrollEl.scrollHeight}px)`, '');

    // Initial extraction
    let gained = extractAll();
    sendLog(`Initial scan: ${gained} records found.`, gained > 0 ? 'success' : 'warn');
    if (gained === 0) {
      sendLog('Tip: Make sure Google search shows local business results (map pack).', 'warn');
    }
    sendProgress();

    let noNewStreak = 0;
    const MAX_NO_NEW = 7;
    const MAX_SCROLLS = 200;
    let prevScrollTop = -1;

    while (running && scrolls < MAX_SCROLLS) {
      humanScroll(scrollEl);
      scrolls++;
      await delay(1800);

      const newGained = extractAll();
      sendProgress();

      if (newGained > 0) {
        noNewStreak = 0;
        sendLog(`Scroll ${scrolls}: +${newGained} new → total ${results.size}`, 'success');
      } else {
        noNewStreak++;
        sendLog(`Scroll ${scrolls}: no new results (${noNewStreak}/${MAX_NO_NEW})`, '');
      }

      // Check if scroll position truly stopped (end of list)
      const curScrollTop = scrollEl.scrollTop || window.scrollY;
      if (scrolls > 3 && curScrollTop === prevScrollTop) {
        sendLog('Scroll position unchanged — reached end of list.', 'warn');
        break;
      }
      prevScrollTop = curScrollTop;

      if (noNewStreak >= MAX_NO_NEW) {
        sendLog('No new results for ' + MAX_NO_NEW + ' scrolls. Finishing.', 'warn');
        break;
      }
    }

    // Final extraction pass
    extractAll();
    const data = Array.from(results.values());
    sendLog(`Done! ${data.length} unique records, ${scrolls} scrolls.`, 'success');
    try { chrome.runtime.sendMessage({ type: 'DONE', data, scrolls }); } catch(e) {}
    running = false;
    window.__gmapScrapRunning = false;
  }

  // ── Message listener ───────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'START_SCRAPE') {
      if (running) { sendLog('Already running!', 'warn'); sendResponse({ ok: false }); return true; }
      results = new Map();
      scrolls = 0;
      running = true;
      window.__gmapScrapRunning = true;
      scrapeLoop();
      sendResponse({ ok: true });
    }
    if (msg.action === 'STOP_SCRAPE') {
      running = false;
      window.__gmapScrapRunning = false;
      const data = Array.from(results.values());
      sendLog(`Stopped. ${data.length} records collected.`, 'warn');
      try { chrome.runtime.sendMessage({ type: 'DONE', data, scrolls }); } catch(e) {}
      sendResponse({ ok: true });
    }
    return true;
  });

  sendLog('G Map Scrap v2 ready ✓', 'success');
})();
