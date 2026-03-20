// ── G Map Scrap — Content Script v3 (Deep Extraction) ─────────────────────────
(function () {
  'use strict';

  if (window.__gmapScrapActive) {
    try { chrome.runtime.sendMessage({ type: 'LOG', text: 'Already active.', level: 'warn' }); } catch(e) {}
    return;
  }
  window.__gmapScrapActive = true;

  let running = false;
  let results = new Map();
  let scrolls = 0;

  function sendLog(text, level = '') {
    try { chrome.runtime.sendMessage({ type: 'LOG', text, level }); } catch(e) {}
  }
  function sendProgress() {
    try { chrome.runtime.sendMessage({ type: 'PROGRESS', found: results.size, scrolls }); } catch(e) {}
  }

  // ── Scroll container ──────────────────────────────────────────────────────
  function getScrollContainer() {
    const feed = document.querySelector('div[role="feed"]');
    if (feed) return feed;
    const all = Array.from(document.querySelectorAll('div'));
    const scrollable = all.find(el => {
      const s = window.getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return (s.overflowY === 'auto' || s.overflowY === 'scroll') &&
             el.scrollHeight > 800 && r.height > 300 && r.width > 200;
    });
    return scrollable || document.scrollingElement || document.documentElement;
  }

  function t(el) { return el?.innerText?.trim() || el?.textContent?.trim() || ''; }

  // ── Parse city, state, pincode from address string ─────────────────────────
  function parseAddress(address) {
    let city = '', state = '', pincode = '', country = 'India';

    // Pincode: 6-digit number in India
    const pinMatch = address.match(/\b(\d{6})\b/);
    if (pinMatch) pincode = pinMatch[1];

    // Known Indian states (also covers UTs)
    const states = [
      'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat',
      'Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh',
      'Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan',
      'Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal',
      'Delhi','Chandigarh','Jammu','Kashmir','Ladakh','Puducherry','Mohali','SAS Nagar'
    ];
    for (const s of states) {
      if (address.toLowerCase().includes(s.toLowerCase())) { state = s; break; }
    }

    // City: try to extract from comma-separated address parts
    const parts = address.split(',').map(p => p.trim()).filter(Boolean);
    // City is often 2nd or 3rd last part before state/pincode
    if (parts.length >= 2) {
      // find a part that's a word (not a number, not the state)
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        if (p && !/^\d+$/.test(p) && p.toLowerCase() !== state.toLowerCase() &&
            !/\d{6}/.test(p) && p.length > 2 && p.length < 40) {
          city = p.replace(/\b\d{6}\b/, '').trim();
          if (city && city.toLowerCase() !== state.toLowerCase()) break;
        }
      }
    }

    return { city, state, pincode, country };
  }

  // ── Parse structured hours from aria-labels / text ─────────────────────────
  function parseHours(card) {
    // Try to get full hours table from aria-label on hours button
    const hoursBtn = card.querySelector('[aria-label*="Monday"], [aria-label*="Tuesday"], [aria-label*="hours" i]');
    if (hoursBtn) {
      const label = hoursBtn.getAttribute('aria-label') || '';
      if (label.length > 10) return label.replace(/\s+/g, ' ').trim();
    }
    // Fallback: find open/closed text
    const allText = Array.from(card.querySelectorAll('span, div'))
      .map(el => t(el))
      .filter(s => s.length > 2 && s.length < 100);
    const hMatch = allText.find(s => /\b(open|closed|closes|opens|24 hours)\b/i.test(s));
    return hMatch || '';
  }

  // ── Deep extract from a single card ───────────────────────────────────────
  function extractCard(card, url) {
    // Name
    const nameEl = card.querySelector('h3, [role="heading"]');
    if (!nameEl) return null;
    const name = t(nameEl);
    if (!name || name.length < 2) return null;

    // All text nodes for pattern matching
    const allSpans = Array.from(card.querySelectorAll('span, div'));
    const allTexts = allSpans.map(el => t(el)).filter(s => s.length > 0 && s.length < 250);

    // Rating
    let rating = '';
    const rEl = card.querySelector('[aria-label*="stars"], [aria-label*="star"]');
    if (rEl) { const m = (rEl.getAttribute('aria-label') || '').match(/[\d.]+/); if (m) rating = m[0]; }
    if (!rating) {
      const rs = allTexts.find(s => /^[1-5]\.[0-9]$/.test(s.trim()));
      if (rs) rating = rs.trim();
    }

    // Reviews count
    let reviews = '';
    const revEl = card.querySelector('[aria-label*="review"]');
    if (revEl) { const m = (revEl.getAttribute('aria-label') || '').match(/[\d,]+/); if (m) reviews = m[0]; }
    if (!reviews) {
      const rs = allTexts.find(s => /^\([\d,]+\)$/.test(s.trim()));
      if (rs) reviews = rs.replace(/[()]/g, '').trim();
    }

    // Category
    let category = '';
    const leafSpans = allSpans.filter(el => el.children.length === 0);
    const catEl = leafSpans.find(el => {
      const txt = t(el);
      return txt.length > 2 && txt.length < 50 &&
             !txt.includes(name) &&
             !/^\d+(\.\d+)?$/.test(txt) &&
             !/^\([\d,]+\)$/.test(txt) &&
             !/open|closed|closes|opens/i.test(txt) &&
             txt !== rating && txt !== reviews &&
             /[A-Za-z]/.test(txt);
    });
    if (catEl) category = t(catEl);

    // Full address
    let address = '';
    const addrEl = card.querySelector('[data-dtype="d3adr"]');
    if (addrEl) {
      address = t(addrEl);
    } else {
      const addrMatch = allTexts.find(s =>
        /\d/.test(s) && s.length > 8 && s.length < 160 &&
        (s.includes(',') || /\b(road|rd|street|st|nagar|sector|phase|block|colony|marg|ave|avenue|lane|near|plot|house|flat|building|tower|mall|bazaar|market|chowk|mohali|chandigarh|delhi|mumbai|bangalore|hyderabad|punjab|haryana)\b/i.test(s))
      );
      if (addrMatch) address = addrMatch;
    }

    // Parse address components
    const { city, state, pincode, country } = parseAddress(address);

    // Phone — supports Indian formats: +91, 0xx-xxx, 10-digit
    let phone = '';
    const phoneEl = card.querySelector('[data-dtype="d3ph"], [data-phone]');
    if (phoneEl) {
      phone = t(phoneEl);
    } else {
      const ph = allTexts.find(s => /^(\+91[\s\-]?)?[6-9]\d{9}$|^0\d{2,4}[\s\-]\d{6,8}$/.test(s.trim().replace(/\s/g,'')));
      if (ph) phone = ph.trim();
    }
    // Clean phone
    if (phone) phone = phone.replace(/\u200b/g, '').trim();

    // Website
    let website = '';
    const webEl = card.querySelector('a[href*="url?q="], a[data-url]');
    if (webEl) {
      const href = webEl.getAttribute('href') || '';
      const m = href.match(/url\?q=([^&]+)/);
      website = m ? decodeURIComponent(m[1]) : (href.startsWith('http') ? href : '');
    }

    // Hours (full string)
    const hours = parseHours(card);

    // Status (open/closed right now)
    let status = '';
    const statusMatch = allTexts.find(s =>
      /^(open now|closed|opens|closes|open 24 hours)/i.test(s.trim()) && s.length < 50
    );
    if (statusMatch) status = statusMatch.trim();

    // Price level (₹, ₹₹, $, $$)
    let priceLevel = '';
    const priceMatch = allTexts.find(s => /^[₹$€£]{1,4}$/.test(s.trim()));
    if (priceMatch) priceLevel = priceMatch.trim();

    // Google Maps URL cleanup
    const cleanUrl = url ? url.split('?')[0] + (url.includes('?') ? '?' + url.split('?')[1].split('&').slice(0,2).join('&') : '') : '';

    return {
      name,
      category,
      rating,
      reviews,
      status,
      priceLevel,
      phone,
      website,
      address,
      city,
      state,
      pincode,
      country,
      hours,
      url: cleanUrl
    };
  }

  // ── Extract all cards on page ─────────────────────────────────────────────
  function extractAll() {
    const before = results.size;

    // Google Search local pack
    const links = Array.from(document.querySelectorAll(
      'a[href*="/maps/place/"], a[href*="google.com/maps/place"]'
    ));
    links.forEach(link => {
      try {
        const url = link.href || '';
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
        const data = extractCard(card, url);
        if (!data) return;
        const key = data.name.toLowerCase().replace(/\s+/g, '');
        if (!results.has(key)) results.set(key, data);
      } catch(e) {}
    });

    // Google Maps standalone
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
        const category = t(card.querySelector('.W4Efsd span'));
        const address  = t(card.querySelector('.W4Efsd:last-of-type'));
        const link     = card.querySelector('a[href*="/maps/place/"]');
        const url      = link ? link.href : '';
        const { city, state, pincode, country } = parseAddress(address);

        results.set(key, {
          name, category, rating, reviews,
          status: '', priceLevel: '', phone: '', website: '',
          address, city, state, pincode, country, hours: '', url
        });
      } catch(e) {}
    });

    return results.size - before;
  }

  // ── Scroll ────────────────────────────────────────────────────────────────
  function humanScroll(el) {
    const amt = 300 + Math.random() * 400;
    el.scrollBy({ top: amt, behavior: 'smooth' });
    window.scrollBy({ top: Math.floor(amt * 0.3), behavior: 'smooth' });
  }
  const delay = ms => new Promise(r => setTimeout(r, ms + Math.random() * 500));

  // ── Main loop ─────────────────────────────────────────────────────────────
  async function scrapeLoop() {
    sendLog('Deep extraction mode active...', '');
    const scrollEl = getScrollContainer();
    sendLog(`Container: ${scrollEl.tagName} (h=${scrollEl.scrollHeight}px)`, '');

    let gained = extractAll();
    sendLog(`Initial: ${gained} records`, gained > 0 ? 'success' : 'warn');
    if (gained === 0) sendLog('Make sure Google shows the local business map panel.', 'warn');
    sendProgress();

    let noNewStreak = 0;
    let prevScrollTop = -1;

    while (running && scrolls < 200) {
      humanScroll(scrollEl);
      scrolls++;
      await delay(1900);

      const newGained = extractAll();
      sendProgress();

      if (newGained > 0) {
        noNewStreak = 0;
        sendLog(`Scroll ${scrolls}: +${newGained} → total ${results.size}`, 'success');
      } else {
        noNewStreak++;
        sendLog(`Scroll ${scrolls}: no new (${noNewStreak}/7)`, '');
      }

      const cur = scrollEl.scrollTop || window.scrollY;
      if (scrolls > 3 && cur === prevScrollTop) { sendLog('End of list detected.', 'warn'); break; }
      prevScrollTop = cur;
      if (noNewStreak >= 7) { sendLog('No new results. Done.', 'warn'); break; }
    }

    extractAll();
    const data = Array.from(results.values());
    sendLog(`Complete! ${data.length} records with full details.`, 'success');
    try { chrome.runtime.sendMessage({ type: 'DONE', data, scrolls }); } catch(e) {}
    running = false;
    window.__gmapScrapActive = false;
  }

  // ── Listener ──────────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'START_SCRAPE') {
      if (running) { sendResponse({ ok: false }); return true; }
      results = new Map(); scrolls = 0; running = true;
      window.__gmapScrapActive = true;
      scrapeLoop();
      sendResponse({ ok: true });
    }
    if (msg.action === 'STOP_SCRAPE') {
      running = false;
      window.__gmapScrapActive = false;
      const data = Array.from(results.values());
      try { chrome.runtime.sendMessage({ type: 'DONE', data, scrolls }); } catch(e) {}
      sendResponse({ ok: true });
    }
    return true;
  });

  sendLog('G Map Scrap v3 ready ✓', 'success');
})();
