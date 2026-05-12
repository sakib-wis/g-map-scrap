// ── G Map Scrap — Content Script v3 (Deep Extraction) ─────────────────────────
(function () {
  "use strict";

  if (window.__gmapScrapActive) {
    try {
      chrome.runtime.sendMessage({
        type: "LOG",
        text: "Already active.",
        level: "warn",
      });
    } catch (e) {}
    return;
  }
  window.__gmapScrapActive = true;

  let running = false;
  let results = new Map();
  let scrolls = 0;

  function sendLog(text, level = "") {
    try {
      chrome.runtime.sendMessage({ type: "LOG", text, level });
    } catch (e) {}
  }
  function sendProgress() {
    try {
      chrome.runtime.sendMessage({
        type: "PROGRESS",
        found: results.size,
        scrolls,
      });
    } catch (e) {}
  }

  // ── Scroll container ──────────────────────────────────────────────────────
  function getScrollContainer() {
    const feed = document.querySelector('div[role="feed"]');
    if (feed) return feed;
    const all = Array.from(document.querySelectorAll("div"));
    const scrollable = all.find((el) => {
      const s = window.getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return (
        (s.overflowY === "auto" || s.overflowY === "scroll") &&
        el.scrollHeight > 800 &&
        r.height > 300 &&
        r.width > 200
      );
    });
    return scrollable || document.scrollingElement || document.documentElement;
  }

  function t(el) {
    return el?.innerText?.trim() || el?.textContent?.trim() || "";
  }

  // ── Parse city, state, pincode from address string ─────────────────────────
  function parseAddress(address) {
    let city = "",
      state = "",
      pincode = "",
      country = "India";

    // Pincode: 6-digit number in India
    const pinMatch = address.match(/\b(\d{6})\b/);
    if (pinMatch) pincode = pinMatch[1];

    // Known Indian states (also covers UTs)
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
      "Mohali",
      "SAS Nagar",
    ];
    for (const s of states) {
      if (address.toLowerCase().includes(s.toLowerCase())) {
        state = s;
        break;
      }
    }

    // City: try to extract from comma-separated address parts
    const parts = address
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    // City is often 2nd or 3rd last part before state/pincode
    if (parts.length >= 2) {
      // find a part that's a word (not a number, not the state)
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

  // ── Parse structured hours from aria-labels / text ─────────────────────────
  function parseHours(card) {
    const result = [];

    // ✅ 1. Parse table (best source)
    const rows = card.querySelectorAll("table tr");

    if (rows.length > 0) {
      rows.forEach((row) => {
        const day = row.querySelector("td:first-child")?.innerText?.trim();
        const time = row.querySelector("td:nth-child(2)")?.innerText?.trim();

        if (day && time) {
          result.push(`${day}: ${time}`);
        }
      });

      if (result.length > 0) {
        return result.join(" | "); // 🔥 flat string
      }
    }

    // ✅ 2. Fallback: aria-label buttons
    const btns = card.querySelectorAll(
      'button[aria-label*="am"], button[aria-label*="pm"]',
    );

    for (const btn of btns) {
      const label = btn.getAttribute("aria-label");
      if (label && label.length > 10) {
        return label.replace(/\s+/g, " ").trim();
      }
    }

    // ✅ 3. Fallback: open/close text
    const text = Array.from(card.querySelectorAll("span, div"))
      .map((el) => el.innerText?.trim())
      .find((t) => /\b(open|closed|closes|opens|24 hours)\b/i.test(t || ""));

    return text || "";
  }

  // ── Deep extract from a single card ───────────────────────────────────────
  function extractCard(card, url) {
    // Name
    const nameEl = card.querySelector(".DUwDvf");
    if (!nameEl) return null;
    const name = t(nameEl);
    if (!name || name.length < 2) return null;
    // // Rating
    let rating = t(card.querySelector(".F7nice span span"));
    // // Reviews count
    let reviews = t(card.querySelector('.F7nice span span span[role="img"]'));
    // // Category
    let category = t(card.querySelector(".DkEaL"));
    let phone = t(card.querySelector('[data-item-id^="phone"] .Io6YTe'));
    // Parse address components
    // Full address
    let address = t(card.querySelector(".Io6YTe.fontBodyMedium.kR99db.fdkmkc"));
    // Parse address components
    const { city, state, pincode, country } = parseAddress(address);
    // // Hours (full string)
    const hours = parseHours(card);
    // // Status (open/closed right now)
    let status = t(card.querySelector("span.ZDu9vd"));
    // Google Maps URL cleanup
    const cleanUrl = url
      ? url.split("?")[0] +
        (url.includes("?")
          ? "?" + url.split("?")[1].split("&").slice(0, 2).join("&")
          : "")
      : "";
    const email = "";
    const madid = "";
    const [fn, ...ln] = name.split(" ");
    const dob = "";
    const doby = "";
    const gen = "";
    const age = "";
    const uid = "";
    const value = "";
    if (!phone && /^(?:\+91|0)?[6-9]\d{9}$/.test(phone)) return null;
    const updatedPhone = `91${phone.replace(/\D/g, "").replace(/^0+/, "")}`;

    return {
      email1: email,
      email2: "",
      email3: "",
      phone1: updatedPhone,
      phone2: "",
      phone3: "",
      madid,
      fn,
      ln,
      pincode,
      city,
      state,
      country,
      dob,
      doby,
      gen,
      age,
      uid,
      value,
      url: cleanUrl,
    };
  }
  //------------ WAIT FOR ELEMENT -----------------------
  function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const interval = 300;
      let elapsed = 0;

      const timer = setInterval(() => {
        const el = document.querySelector(selector);

        if (el) {
          clearInterval(timer);
          resolve(el);
        }

        elapsed += interval;
        if (elapsed >= timeout) {
          clearInterval(timer);
          reject("Element not found: " + selector);
        }
      }, interval);
    });
  }
  // ── Extract all cards on page ─────────────────────────────────────────────
  async function extractAll() {
    const before = results.size;
    // Google Search local pack
    const links = Array.from(
      document.querySelectorAll(
        'a[href*="/maps/place/"], a[href*="google.com/maps/place"]',
      ),
    );
    for (const link of links.slice(before)) {
      try {
        const url = link.href || "";
        link.click();
        // wait for popup load
        await waitForElement("h1.DUwDvf");
        await delay(3000);
        // always re-select AFTER load
        const card = document.querySelector("div.bJzME.Hu9e2e.tTVLSc");
        const data = extractCard(card, url);
        const key = data?.fn?.toLowerCase().replace(/\s+/g, "");
        if (!key) {
          return;
        }
        results.set(key, data);
        // wait before next click (avoid blocking)
        await delay(2000);
      } catch (e) {
        console.log("Error:", e);
      }
    }
    return results.size - before;
  }

  // ── Scroll ────────────────────────────────────────────────────────────────
  function humanScroll(el) {
    const amt = 300 + Math.random() * 400;
    el.scrollBy({ top: amt, behavior: "smooth" });
    window.scrollBy({ top: Math.floor(amt * 0.3), behavior: "smooth" });
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

    let noNewStreak = 0;
    let prevScrollTop = -1;

    while (running && scrolls < 200) {
      humanScroll(scrollEl);
      scrolls++;
      await delay(1900);

      const newGained = await extractAll();
      sendProgress();

      if (newGained > 0) {
        noNewStreak = 0;
        sendLog(
          `Scroll ${scrolls}: +${newGained} → total ${results.size}`,
          "success",
        );
      } else {
        noNewStreak++;
        sendLog(`Scroll ${scrolls}: no new (${noNewStreak}/7)`, "");
      }

      const cur = scrollEl.scrollTop || window.scrollY;
      if (scrolls > 3 && cur === prevScrollTop) {
        sendLog("End of list detected.", "warn");
        break;
      }
      prevScrollTop = cur;
      if (noNewStreak >= 7) {
        sendLog("No new results. Done.", "warn");
        break;
      }
    }

    await extractAll();
    const data = Array.from(results.values());
    sendLog(`Complete! ${data.length} records with full details.`, "success");
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
      scrolls = 0;
      running = true;
      window.__gmapScrapActive = true;
      scrapeLoop();
      sendResponse({ ok: true });
    }
    if (msg.action === "STOP_SCRAPE") {
      running = false;
      window.__gmapScrapActive = false;
      const data = Array.from(results.values());
      try {
        chrome.runtime.sendMessage({ type: "DONE", data, scrolls });
      } catch (e) {}
      sendResponse({ ok: true });
    }
    return true;
  });

  sendLog("G Map Scrap v3 ready ✓", "success");
})();
