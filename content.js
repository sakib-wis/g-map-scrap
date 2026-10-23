// ── G Map Scrap — Content Script v3 (Deep Extraction) ─────────────────────────
(function () {
  "use strict";

  if (window.__gmapScrapInitialized) {
    return;
  }
  window.__gmapScrapInitialized = true;
  window.__gmapScrapActive = false;

  let running = false;
  let results = new Map();
  let scrolls = 0;
  let scrapeTabId = null;
  let lastStorageSync = 0;
  const processedLinks = new Set();

  function sendLog(text, level = "") {
    try {
      chrome.runtime.sendMessage({ type: "LOG", text, level });
    } catch (e) {}
  }
  function sendProgress() {
    const found = results.size;
    // ── SYNC STATE TO STORAGE so popup can rehydrate after tab switch ──
    if (Date.now() - lastStorageSync >= 3000) {
      lastStorageSync = Date.now();
      try {
        chrome.storage.local.set({
          gmapScrapeState: {
            scraping: true,
            found,
            scrolls,
            tabId: scrapeTabId,
            startedAt: window.__gmapScrapStartedAt || Date.now(),
          },
          gmapResults: Array.from(results.values()),
        });
      } catch (e) {}
    }
    try {
      chrome.runtime.sendMessage({ type: "PROGRESS", found, scrolls });
    } catch (e) {}
  }

  // ── Scroll container ──────────────────────────────────────────────────────
  function getScrollContainer() {
    const candidates = Array.from(
      document.querySelectorAll('div[role="feed"], div, main'),
    ).filter((el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return (
        rect.width > 180 &&
        rect.height > 180 &&
        el.scrollHeight > el.clientHeight + 80 &&
        (/(auto|scroll|overlay)/.test(style.overflowY) || el.getAttribute("role") === "feed")
      );
    });

    const score = (el) => {
      const linkCount = el.querySelectorAll('a[href*="/maps/place/"]').length;
      const feedBonus = el.getAttribute("role") === "feed" ? 100000 : 0;
      return feedBonus + linkCount * 1000 + Math.min(el.scrollHeight - el.clientHeight, 100000);
    };
    candidates.sort((a, b) => score(b) - score(a));
    return candidates[0] || document.scrollingElement || document.documentElement;
  }

  function t(el) {
    return el?.innerText?.trim() || el?.textContent?.trim() || "";
  }

  // ── Parse city, state, pincode from address string ─────────────────────────
  function parseAddress(address) {
    let city = "",
      state = "",
      pincode = "",
      country = "";

    const pinMatch = address.match(/\b(\d{6})\b/);
    if (pinMatch) pincode = pinMatch[1];

    const states = [
      "Andhra Pradesh",
      "Arunachal Pradesh",
      "Assam",
      "Bihar",
      "Chhattisgarh",
      "Goa",
      "Gujarat",
      "Haryana",
      "Himachal Pradesh",
      "Jharkhand",
      "Karnataka",
      "Kerala",
      "Madhya Pradesh",
      "Maharashtra",
      "Manipur",
      "Meghalaya",
      "Mizoram",
      "Nagaland",
      "Odisha",
      "Punjab",
      "Rajasthan",
      "Sikkim",
      "Tamil Nadu",
      "Telangana",
      "Tripura",
      "Uttar Pradesh",
      "Uttarakhand",
      "West Bengal",
      "Delhi",
      "Chandigarh",
      "Jammu",
      "Kashmir",
      "Ladakh",
      "Puducherry",
    ];
    for (const s of states) {
      if (address.toLowerCase().includes(s.toLowerCase())) {
        state = s;
        break;
      }
    }

    const parts = address
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        if (
          p &&
          !/^\d+$/.test(p) &&
          p.toLowerCase() !== state.toLowerCase() &&
          !/\d{6}/.test(p) &&
          p.length > 2 &&
          p.length < 40
        ) {
          city = p.replace(/\b\d{6}\b/, "").trim();
          if (city && city.toLowerCase() !== state.toLowerCase()) break;
        }
      }
    }
    return { city, state, pincode, country };
  }

  // Google Maps changes CSS class names frequently. Prefer the result link's
  // accessible label, then read only the smallest nearby result card text.
  function getPlaceLinks() {
    return Array.from(document.querySelectorAll('a[href*="/maps/place/"]'))
      .filter((link) => {
        try {
          const url = new URL(link.href);
          return (
            ["www.google.com", "maps.google.com"].includes(url.hostname) &&
            url.pathname.startsWith("/maps/place/")
          );
        } catch {
          return false;
        }
      });
  }

  function getListingCard(link) {
    const namedCard = link.closest('[role="article"], .Nv2PK, [data-result-index]');
    if (namedCard) return namedCard;

    let current = link.parentElement;
    for (let depth = 0; current && depth < 9; depth++, current = current.parentElement) {
      const text = t(current);
      if (text.length > 40 && text.length < 1400 && /\b\d(?:\.\d)?\s*\(\s*[\d,.]+\s*\)/.test(text)) {
        return current;
      }
      if (current.matches('div[role="feed"]')) break;
    }
    return link.parentElement || link;
  }

  function extractCard(link, url) {
    const card = getListingCard(link);
    const lines = (card.innerText || "")
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .filter((line) => !/^(sponsored|visited link|results|share|update results when map moves)$/i.test(line));
    const ratingLine = lines.find((line) => /\b\d(?:\.\d)?\s*\(\s*[\d,.]+\s*\)/.test(line)) || "";
    const ratingMatch = ratingLine.match(/\b(\d(?:\.\d)?)\s*\(\s*([\d,.]+)\s*\)/);
    const title = card.querySelector('[role="heading"], .qBF1Pd, .fontHeadlineSmall');
    const ariaName = link.getAttribute("aria-label")?.trim();
    const name = t(title) || ariaName || lines.find((line) => line !== ratingLine && !line.includes(" · ")) || "";
    if (!name || /^(results|share|directions)$/i.test(name)) return null;

    const infoLine = lines.find((line) => line.includes(" · ") && line !== ratingLine) || "";
    const infoParts = infoLine.split(" · ").map((part) => part.trim()).filter(Boolean);
    const category = infoParts[0] || "";
    const address = infoParts.slice(1).join(", ");
    const hoursLine = lines.find((line) => /\b(open|closed|opens|closes|24 hours)\b/i.test(line)) || "";
    const phoneMatch = hoursLine.match(/(?:\+?\d[\d\s().-]{6,}\d)/);
    const phone = phoneMatch && phoneMatch[0].replace(/\D/g, "").length >= 7
      ? phoneMatch[0].trim()
      : "";
    const hours = hoursLine.replace(phoneMatch?.[0] || "", "").replace(/[·,\s]+$/, "").trim();
    const { city, state, pincode, country } = parseAddress(address);

    return {
      name,
      category,
      rating: ratingMatch?.[1] || "",
      reviews: ratingMatch?.[2] || "",
      status: /\b(open|closed)\b/i.test(hours) ? hours : "",
      phone,
      address,
      pincode,
      city,
      state,
      country,
      hours,
      url,
    };
  }

  async function extractAll() {
    const before = results.size;
    const links = getPlaceLinks();
    sendLog(`Visible result links: ${links.length}`);
    for (const link of links) {
      if (!running) break;
      const url = link.href;
      if (processedLinks.has(url)) continue;
      try {
        const data = extractCard(link, url);
        if (data) {
          processedLinks.add(url);
          results.set(url, data);
          sendLog(`Captured: ${data.name}`, "success");
        }
        sendProgress();
      } catch (e) {
        sendLog(`Could not read a visible result: ${String(e)}`, "warn");
      }
    }
    return results.size - before;
  }

  // ── Scroll ────────────────────────────────────────────────────────────────
  function scrollOneViewport(el) {
    const before = el.scrollTop;
    const step = Math.max(Math.floor(el.clientHeight * 0.8), 500);
    const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
    el.scrollTop = Math.min(before + step, maxTop);
    return { before, target: Math.min(before + step, maxTop) };
  }

  async function waitForFeed(el, previousHeight, previousLinks) {
    await delay(900);
    const started = Date.now();
    while (Date.now() - started < 2500) {
      if (
        el.scrollHeight > previousHeight ||
        getPlaceLinks().length > previousLinks ||
        el.scrollTop + el.clientHeight >= el.scrollHeight - 8
      ) {
        await delay(500);
        return;
      }
      await delay(250);
    }
  }
  const delay = (ms) =>
    new Promise((r) => setTimeout(r, ms + Math.random() * 500));

  // ── Main loop ─────────────────────────────────────────────────────────────
  async function scrapeLoop() {
    sendLog("Deep extraction mode active...", "");
    const scrollEl = getScrollContainer();
    sendLog(
      `Container: ${scrollEl.tagName} (h=${scrollEl.scrollHeight}px)`,
      "",
    );

    let gained = await extractAll();
    sendLog(`Initial: ${gained} records`, gained > 0 ? "success" : "warn");
    if (gained === 0)
      sendLog("Make sure Google shows the local business map panel.", "warn");
    sendProgress();

    let bottomPasses = 0;
    let stalledPasses = 0;

    while (running) {
      const activeScroller = getScrollContainer();
      const { before, target } = scrollOneViewport(activeScroller);
      const oldHeight = activeScroller.scrollHeight;
      const oldLinks = getPlaceLinks().length;
      scrolls++;

      await waitForFeed(activeScroller, oldHeight, oldLinks);
      const newGained = await extractAll();
      sendProgress();

      const atBottom =
        activeScroller.scrollTop + activeScroller.clientHeight >=
        activeScroller.scrollHeight - 8;
      const moved = activeScroller.scrollTop > before + 2;
      const loadedMore =
        activeScroller.scrollHeight > oldHeight ||
        getPlaceLinks().length > oldLinks ||
        newGained > 0;

      if (newGained > 0) {
        sendLog(`Scroll ${scrolls}: +${newGained} → total ${results.size}`, "success");
        stalledPasses = 0;
      } else if (!moved && !loadedMore) {
        stalledPasses++;
        sendLog(`Waiting for more results (${stalledPasses}/6)...`, "");
      } else {
        stalledPasses = 0;
      }

      if (atBottom && !loadedMore) {
        bottomPasses++;
        sendLog(`At end of loaded results (${bottomPasses}/6)...`, "");
      } else {
        bottomPasses = 0;
      }

      // Some result sets load another page only after a short pause at the end.
      if (atBottom && bottomPasses > 0 && bottomPasses < 6) {
        activeScroller.scrollTop = activeScroller.scrollHeight;
        await delay(1200);
      }

      if (bottomPasses >= 6 || stalledPasses >= 6 || (atBottom && target === before && !loadedMore && bottomPasses >= 2)) {
        sendLog("Results feed reached its end; finishing scrape.", "success");
        break;
      }
    }

    await extractAll();
    const data = Array.from(results.values());
    sendLog(`Complete! ${data.length} visible business listings extracted.`, "success");

    // ── Clear scrape state, save final results ─────────────────────────────
    try {
      chrome.storage.local.set({
        gmapResults: data,
        gmapScrapeState: { scraping: false, found: data.length, scrolls, tabId: scrapeTabId },
      });
    } catch (e) {}
    try {
      chrome.runtime.sendMessage({ type: "DONE", data, scrolls });
    } catch (e) {}
    running = false;
    window.__gmapScrapActive = false;
  }

  // ── Listener ──────────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "START_SCRAPE") {
      if (running) {
        sendResponse({ ok: false });
        return true;
      }
      results = new Map();
      processedLinks.clear();
      scrolls = 0;
      running = true;
      scrapeTabId = sender.tab?.id ?? null;
      window.__gmapScrapActive = true;
      window.__gmapScrapStartedAt = Date.now();
      // Save start state immediately
      chrome.storage.local.set({
        gmapScrapeState: {
          scraping: true,
          found: 0,
          scrolls: 0,
          tabId: scrapeTabId,
          startedAt: Date.now(),
        },
        gmapResults: [],
      });
      scrapeLoop();
      sendResponse({ ok: true });
    }
    if (msg.action === "STOP_SCRAPE") {
      running = false;
      window.__gmapScrapActive = false;
      const data = Array.from(results.values());
      chrome.storage.local.set({
        gmapResults: data,
        gmapScrapeState: { scraping: false, found: data.length, scrolls, tabId: scrapeTabId },
      });
      try {
        chrome.runtime.sendMessage({ type: "DONE", data, scrolls });
      } catch (e) {}
      sendResponse({ ok: true });
    }
    if (msg.action === "GET_STATE") {
      // Popup asking for current live state on reopen
      sendResponse({
        running,
        found: results.size,
        scrolls,
        startedAt: window.__gmapScrapStartedAt || null,
      });
    }
    return true;
  });

  sendLog("G Map Scrap v3 ready ✓", "success");
})();
