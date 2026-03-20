// ── G Map Scrap — Content Script ──────────────────────────────────────────────
// Runs inside the Google Maps / Google search results page.
// Handles: auto-scroll, data extraction, result deduplication, messaging.

(function () {
  'use strict';

  let running  = false;
  let results  = new Map(); // keyed by name+address to deduplicate
  let scrolls  = 0;
  let scrollEl = null;

  // ── Logging helper ─────────────────────────────────────────────────────────
  function sendLog(text, level = '') {
    chrome.runtime.sendMessage({ type: 'LOG', text, level });
  }

  // ── Detect whether we are on Google Maps embedded in Search ────────────────
  function getScrollContainer() {
    // Google Search local results panel
    const selectors = [
      '[data-async-context] div[role="feed"]',
      'div[jsname][data-hveid] [role="feed"]',
      '#search [data-ved] div[role="feed"]',
      'div[role="main"] [data-hveid]',
      // Google Maps standalone
      'div[role="feed"]',
      '#rcnt',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return document.scrollingElement || document.documentElement;
  }

  // ── Extract a single result card ───────────────────────────────────────────
  function extractCard(card) {
    try {
      // Name
      const nameEl = card.querySelector(
        'div[class*="dbg0pd"] span, .OSrXXb, [data-rc] h3, h3, [jsname="r4nke"], .lcorqs .OSrXXb, span[class*="fontHeadlineSmall"]'
      );
      const name = nameEl?.innerText?.trim() || '';
      if (!name) return null;

      // Rating
      const ratingEl = card.querySelector('[aria-label*="stars"], [aria-label*="star"], span.yi40Hd, .Aq14fc');
      let rating = '';
      if (ratingEl) {
        const match = ratingEl.getAttribute('aria-label')?.match(/[\d.]+/);
        rating = match ? match[0] : ratingEl.innerText?.trim();
      }

      // Reviews count
      const reviewsEl = card.querySelector('span[aria-label*="review"], .RDApEe, .UY7F9, span[aria-label*="Google reviews"]');
      let reviews = '';
      if (reviewsEl) {
        reviews = reviewsEl.innerText?.trim().replace(/[()]/g, '') || reviewsEl.getAttribute('aria-label')?.match(/[\d,]+/)?.[0] || '';
      }

      // Category / type
      const catEl = card.querySelector('.YhemCb, .rllt__details div:first-child, div[class*="category"], .BSaJad');
      const category = catEl?.innerText?.trim() || '';

      // Address
      const addrEl = card.querySelector(
        '[data-dtype="d3adr"] .rllt__wrapped-text, [data-rc] .rllt__details div:last-child, span[class*="address"], .lqhpac .rllt__details'
      );
      const address = addrEl?.innerText?.trim() || '';

      // Phone
      const phoneEl = card.querySelector('[data-dtype="d3ph"], span[aria-label*="phone"], [data-phone]');
      const phone = phoneEl?.innerText?.trim() || phoneEl?.getAttribute('aria-label') || '';

      // Website
      const websiteEl = card.querySelector('a[data-url], a[href*="url?q="], a[data-web]');
      let website = '';
      if (websiteEl) {
        const href = websiteEl.getAttribute('href') || '';
        const match = href.match(/url\?q=([^&]+)/);
        website = match ? decodeURIComponent(match[1]) : (href.startsWith('http') ? href : '');
      }

      // Hours
      const hoursEl = card.querySelector('[data-dtype="d3oh"], .oh0HQb, span[aria-label*="hours"], .rllt__details span[class*="open"]');
      const hours = hoursEl?.innerText?.trim() || '';

      // Google Maps URL
      let url = '';
      const linkEl = card.querySelector('a[href*="maps/place"], a[data-cid], a[href*="/local/"]');
      if (linkEl) url = linkEl.href;

      return { name, rating, reviews, category, address, phone, website, hours, url };
    } catch (e) {
      return null;
    }
  }

  // ── Extract all visible cards ───────────────────────────────────────────────
  function extractAll() {
    const cardSelectors = [
      '.VkpGBb', '.rllt__link', '[data-rc]', 'div[jsaction*="mouseover"] div[data-hveid]',
      '[data-cid]', '.uMdZh', 'div.Nv2PK', 'a[data-cid]'
    ];

    let cards = [];
    for (const sel of cardSelectors) {
      const found = Array.from(document.querySelectorAll(sel));
      if (found.length > cards.length) cards = found;
    }

    // Also try to grab parent containers
    const allLinks = Array.from(document.querySelectorAll('a[href*="maps/place"]'));
    allLinks.forEach(link => {
      // Walk up to find a reasonable card container
      let el = link;
      for (let i = 0; i < 6; i++) {
        el = el.parentElement;
        if (!el) break;
        const h = el.querySelector('h3, [role="heading"], span[class*="fontHeadline"]');
        if (h && !cards.includes(el)) { cards.push(el); break; }
      }
    });

    let newCount = 0;
    cards.forEach(card => {
      const data = extractCard(card);
      if (!data || !data.name) return;
      const key = (data.name + data.address).toLowerCase().replace(/\s/g, '');
      if (!results.has(key)) {
        results.set(key, data);
        newCount++;
      }
    });

    return newCount;
  }

  // ── Human-like scroll ──────────────────────────────────────────────────────
  function humanScroll(el) {
    const amount = 300 + Math.random() * 400;
    const jitter = () => Math.random() * 30 - 15;
    el.scrollBy({ top: amount + jitter(), behavior: 'smooth' });
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms + Math.random() * 500));
  }

  // ── Main scrape loop ───────────────────────────────────────────────────────
  async function scrapeLoop() {
    sendLog('Initialising scraper...', '');
    scrollEl = getScrollContainer();
    sendLog(`Scroll target: ${scrollEl.tagName}${scrollEl.id ? '#' + scrollEl.id : ''}`, '');

    let noNewCount = 0;
    const MAX_NO_NEW = 5; // stop after 5 scrolls with no new results
    const MAX_SCROLLS = 200; // safety cap

    while (running && scrolls < MAX_SCROLLS) {
      // Extract before scroll
      const before = results.size;
      extractAll();
      const gained = results.size - before;

      // Report progress
      chrome.runtime.sendMessage({
        type: 'PROGRESS',
        found: results.size,
        scrolls
      });

      if (gained === 0) {
        noNewCount++;
        if (noNewCount >= MAX_NO_NEW) {
          sendLog(`No new results after ${noNewCount} scrolls. Finishing.`, 'warn');
          break;
        }
      } else {
        noNewCount = 0;
        sendLog(`+${gained} records (total: ${results.size})`, 'success');
      }

      // Scroll
      humanScroll(scrollEl);
      scrolls++;
      await delay(1500);

      // Check if end of list indicator appeared
      const endEl = document.querySelector('.HlvSq, [aria-label*="end of list"], .lXJj5c');
      if (endEl) {
        sendLog('Reached end of results.', 'success');
        break;
      }
    }

    // Final extraction pass
    extractAll();
    sendLog(`Done. Total: ${results.size} records, ${scrolls} scrolls.`, 'success');

    const data = Array.from(results.values());
    chrome.runtime.sendMessage({ type: 'DONE', data, scrolls });
    running = false;
  }

  // ── Message listener ───────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'START_SCRAPE') {
      if (running) { sendResponse({ ok: false, reason: 'already running' }); return; }
      results  = new Map();
      scrolls  = 0;
      running  = true;
      scrapeLoop();
      sendResponse({ ok: true });
    }
    if (msg.action === 'STOP_SCRAPE') {
      running = false;
      sendResponse({ ok: true });
    }
    return true;
  });

  // Auto-announce presence
  sendLog('Content script ready.', 'success');
})();
