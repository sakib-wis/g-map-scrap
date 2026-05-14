// ── G Map Scrap Popup v3 ───────────────────────────────
let scraping = false;
let results = [];
let timer = null;
let elapsed = 0;

const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const countFound = document.getElementById("countFound");
const countScrolls = document.getElementById("countScrolls");
const countTime = document.getElementById("countTime");
const progressBar = document.getElementById("progressBar");
const progressLabel = document.getElementById("progressLabel");
const alertBox = document.getElementById("alertBox");
const logBox = document.getElementById("logBox");
const btnStart = document.getElementById("btnStart");
const btnStop = document.getElementById("btnStop");
const btnExcel = document.getElementById("btnExcel");
const btnCsv = document.getElementById("btnCsv");
const btnClear = document.getElementById("btnClear");
const btnLogClear = document.getElementById("btnLogClear");

function log(msg, type = "") {
  const time = new Date().toTimeString().slice(0, 8);
  const el = document.createElement("div");
  el.className = "log-entry";
  el.innerHTML = `<span class="log-time">${time}</span><span class="log-msg ${type}">${msg}</span>`;
  logBox.appendChild(el);
  logBox.scrollTop = logBox.scrollHeight;
}
function setStatus(state, text) {
  statusDot.className = "status-dot " + state;
  statusText.innerHTML = text;
}
function updateStats(found, sc) {
  countFound.textContent = found;
  countScrolls.textContent = sc;
  if (found > 0) {
    btnExcel.disabled = false;
    btnCsv.disabled = false;
  }
}
function startTimer(fromSeconds = 0) {
  elapsed = fromSeconds;
  clearInterval(timer);
  countTime.textContent = formatTime(elapsed);
  timer = setInterval(() => {
    elapsed++;
    countTime.textContent = formatTime(elapsed);
    // Persist elapsed so next popup open can restore it
    chrome.storage.local.get(["gmapScrapeState"], (data) => {
      if (data.gmapScrapeState && data.gmapScrapeState.scraping) {
        chrome.storage.local.set({
          gmapScrapeState: { ...data.gmapScrapeState, elapsed },
        });
      }
    });
  }, 1000);
}
function formatTime(s) {
  return s < 60 ? s + "s" : Math.floor(s / 60) + "m" + (s % 60) + "s";
}
function stopTimer() {
  clearInterval(timer);
}
function setScraping(active) {
  scraping = active;
  btnStart.disabled = active;
  btnStop.disabled = !active;
  if (active) {
    setStatus("active", "Scraping in progress...");
    progressBar.style.width = "8%";
    progressLabel.textContent = "Scrolling & extracting...";
  } else {
    setStatus(
      results.length ? "done" : "",
      results.length
        ? `Done — <span>${results.length} records</span> found`
        : "Idle",
    );
    stopTimer();
    progressBar.style.width = results.length ? "100%" : "0%";
    progressLabel.textContent = results.length
      ? `${results.length} results ready`
      : "Ready";
  }
}

async function injectAndStart(tabId) {
  return new Promise((resolve) => {
    chrome.scripting.executeScript(
      { target: { tabId }, files: ["content.js"] },
      () => {
        if (chrome.runtime.lastError) {
          log("Inject error: " + chrome.runtime.lastError.message, "error");
          resolve(false);
          return;
        }
        setTimeout(() => {
          chrome.tabs.sendMessage(tabId, { action: "START_SCRAPE" }, (res) => {
            if (chrome.runtime.lastError) {
              log(
                "Message error: " + chrome.runtime.lastError.message,
                "error",
              );
              resolve(false);
            } else resolve(true);
          });
        }, 300);
      },
    );
  });
}

// ── REHYDRATE STATE ON POPUP OPEN ─────────────────────────────────────────────
// This runs every time the popup opens (including after tab switch).
// It checks storage for an active scrape and restores the UI.
async function rehydrateState() {
  const data = await new Promise((r) =>
    chrome.storage.local.get(["gmapScrapeState", "gmapResults"], r),
  );

  const state = data.gmapScrapeState;
  const savedResults = data.gmapResults || [];

  if (state && state.scraping) {
    // Scraping was active when popup closed — restore live UI
    results = savedResults;
    scraping = true;
    btnStart.disabled = true;
    btnStop.disabled = false;
    setStatus("active", "Scraping in progress...");

    const restoredElapsed = state.elapsed || 0;
    startTimer(restoredElapsed);

    updateStats(state.found || savedResults.length, state.scrolls || 0);
    progressBar.style.width = Math.min(8 + (state.scrolls || 0) * 4, 92) + "%";
    progressLabel.textContent = `Scroll ${state.scrolls || 0} — ${state.found || savedResults.length} records found`;

    log(
      `↺ Reconnected to active scrape (${state.found || 0} records so far)`,
      "success",
    );

    // Also try to ask the content script for its live state
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab) {
      chrome.tabs.sendMessage(tab.id, { action: "GET_STATE" }, (res) => {
        if (chrome.runtime.lastError || !res) return;
        if (res.running) {
          updateStats(res.found, res.scrolls);
          log(`Live state: ${res.found} records, ${res.scrolls} scrolls`, "");
        } else if (!res.running && state.scraping) {
          // Content script finished while popup was closed
          setScraping(false);
          log("Scrape completed while popup was closed.", "warn");
        }
      });
    }
  } else if (savedResults.length > 0) {
    // Scraping done, show previous results
    results = savedResults;
    updateStats(results.length, state?.scrolls || 0);
    setStatus(
      "done",
      `<span>${results.length} records</span> from last session`,
    );
    progressBar.style.width = "100%";
    progressLabel.textContent = `${results.length} results ready`;
    btnExcel.disabled = false;
    btnCsv.disabled = false;
    log(`Loaded ${results.length} records from last session.`, "success");
  }
}

// Run rehydration immediately
rehydrateState();

btnStart.addEventListener("click", async () => {
  alertBox.classList.remove("show");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    log("No active tab.", "error");
    return;
  }
  if (!tab.url.includes("google.com")) {
    alertBox.classList.add("show");
    log("Open a Google search or Google Maps page first.", "error");
    setStatus("error", "Not on Google / Maps");
    return;
  }
  results = [];
  chrome.storage.local.set({ gmapResults: [] });
  updateStats(0, 0);
  countTime.textContent = "0s";
  setScraping(true);
  startTimer(0);
  log("Launching deep extractor...", "");
  const ok = await injectAndStart(tab.id);
  if (!ok) {
    setScraping(false);
    stopTimer();
    log("Failed to start. Try refreshing the page.", "error");
  }
});

btnStop.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) chrome.tabs.sendMessage(tab.id, { action: "STOP_SCRAPE" }, () => {});
  setScraping(false);
  stopTimer();
  log("Stopped by user.", "warn");
});

btnClear.addEventListener("click", () => {
  results = [];
  chrome.storage.local.set({
    gmapResults: [],
    gmapScrapeState: { scraping: false },
  });
  updateStats(0, 0);
  countTime.textContent = "0s";
  progressBar.style.width = "0%";
  progressLabel.textContent = "Ready";
  btnExcel.disabled = true;
  btnCsv.disabled = true;
  setStatus("", "Data cleared.");
  log("Cleared.", "warn");
});

btnLogClear.addEventListener("click", () => {
  logBox.innerHTML = "";
});

// ── Export definitions ─────────────────────────────────
const COLUMNS = [
  { key: "email1", label: "email" },
  { key: "email2", label: "email" },
  { key: "email3", label: "email" },
  { key: "phone1", label: "phone" },
  { key: "phone2", label: "phone" },
  { key: "phone3", label: "phone" },
  { key: "madid", label: "madid" },
  { key: "fn", label: "fn" },
  { key: "ln", label: "ln" },
  { key: "pincode", label: "zip" },
  { key: "city", label: "ct" },
  { key: "state", label: "st" },
  { key: "country", label: "country" },
  { key: "dob", label: "dob" },
  { key: "doby", label: "doby" },
  { key: "gen", label: "gen" },
  { key: "age", label: "age" },
  { key: "uid", label: "uid" },
  { key: "value", label: "value" },
];

// ── CSV Export ─────────────────────────────────────────
function escapeCsv(v) {
  if (v == null) return "";
  const s = String(v);
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? '"' + s.replace(/"/g, '""') + '"'
    : s;
}

btnCsv.addEventListener("click", () => {
  if (!results.length) return;
  const headers = COLUMNS.map((c) => c.label).join(",");
  const rows = results.map((r) =>
    COLUMNS.map((c) => escapeCsv(r[c.key])).join(","),
  );
  const csv = "\uFEFF" + [headers, ...rows].join("\n");
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8;" }),
    ),
    download: `gmapscrap_${Date.now()}.csv`,
  });
  a.click();
  URL.revokeObjectURL(a.href);
  log(
    `CSV exported: ${results.length} records × ${COLUMNS.length} columns.`,
    "success",
  );
});

// ── Excel Export (SpreadsheetML) ───────────────────────
btnExcel.addEventListener("click", () => {
  if (!results.length) return;

  const esc = (v) =>
    String(v || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const styles = `
  <Style ss:ID="title">
    <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>
    <Font ss:Bold="1" ss:Color="#FFFFFF" ss:Size="14" ss:FontName="Arial"/>
    <Interior ss:Color="#0D1B2A" ss:Pattern="Solid"/>
    <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#00D4AA"/></Borders>
  </Style>
  <Style ss:ID="header">
    <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>
    <Font ss:Bold="1" ss:Color="#FFFFFF" ss:Size="10" ss:FontName="Arial"/>
    <Interior ss:Color="#111827" ss:Pattern="Solid"/>
    <Borders>
      <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#00D4AA"/>
      <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F2D45"/>
    </Borders>
  </Style>
  <Style ss:ID="rowOdd">
    <Alignment ss:Vertical="Center" ss:WrapText="1"/>
    <Font ss:Color="#1A1A2E" ss:Size="9" ss:FontName="Arial"/>
    <Interior ss:Color="#F8FAFB" ss:Pattern="Solid"/>
    <Borders>
      <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
      <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    </Borders>
  </Style>
  <Style ss:ID="rowEven">
    <Alignment ss:Vertical="Center" ss:WrapText="1"/>
    <Font ss:Color="#1A1A2E" ss:Size="9" ss:FontName="Arial"/>
    <Interior ss:Color="#EEF2FF" ss:Pattern="Solid"/>
    <Borders>
      <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
      <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    </Borders>
  </Style>
  <Style ss:ID="link">
    <Alignment ss:Vertical="Center" ss:WrapText="1"/>
    <Font ss:Color="#0085FF" ss:Size="9" ss:FontName="Arial" ss:Underline="Single"/>
    <Interior ss:Color="#F0F7FF" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="linkEven">
    <Alignment ss:Vertical="Center" ss:WrapText="1"/>
    <Font ss:Color="#0085FF" ss:Size="9" ss:FontName="Arial" ss:Underline="Single"/>
    <Interior ss:Color="#E8F0FF" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="rating">
    <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
    <Font ss:Bold="1" ss:Color="#92400E" ss:Size="10" ss:FontName="Arial"/>
    <Interior ss:Color="#FEF3C7" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="ratingEven">
    <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
    <Font ss:Bold="1" ss:Color="#92400E" ss:Size="10" ss:FontName="Arial"/>
    <Interior ss:Color="#FDE68A" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="open">
    <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
    <Font ss:Bold="1" ss:Color="#065F46" ss:Size="9" ss:FontName="Arial"/>
    <Interior ss:Color="#D1FAE5" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="closed">
    <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
    <Font ss:Bold="1" ss:Color="#991B1B" ss:Size="9" ss:FontName="Arial"/>
    <Interior ss:Color="#FEE2E2" ss:Pattern="Solid"/>
  </Style>`;

  const colWidths = [
    180, 120, 55, 70, 90, 60, 110, 150, 220, 90, 100, 70, 70, 160, 200,
  ];
  const colDefs = colWidths.map((w) => `<Column ss:Width="${w}"/>`).join("");

  const headerRow = `<Row ss:Height="22">
    ${COLUMNS.map((c) => `<Cell ss:StyleID="header"><Data ss:Type="String">${esc(c.label)}</Data></Cell>`).join("")}
  </Row>`;

  const dataRows = results
    .map((r, i) => {
      const isEven = i % 2 === 1;
      const base = isEven ? "rowEven" : "rowOdd";
      const cells = COLUMNS.map((c) => {
        const val = r[c.key] || "";
        if (c.key === "rating" && val)
          return `<Cell ss:StyleID="${isEven ? "ratingEven" : "rating"}"><Data ss:Type="String">★ ${esc(val)}</Data></Cell>`;
        if (c.key === "status") {
          const sStyle = /open now|open 24/i.test(val)
            ? "open"
            : /closed/i.test(val)
              ? "closed"
              : base;
          return `<Cell ss:StyleID="${sStyle}"><Data ss:Type="String">${esc(val)}</Data></Cell>`;
        }
        if (c.key === "url" && val)
          return `<Cell ss:StyleID="${isEven ? "linkEven" : "link"}" ss:HRef="${esc(val)}"><Data ss:Type="String">View on Maps</Data></Cell>`;
        return `<Cell ss:StyleID="${base}"><Data ss:Type="String">${esc(val)}</Data></Cell>`;
      }).join("");
      return `<Row ss:Height="18">${cells}</Row>`;
    })
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:x="urn:schemas-microsoft-com:office:excel">
  <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
    <Title>G Map Scrap Export</Title>
    <Author>G Map Scrap</Author>
    <Created>${new Date().toISOString()}</Created>
  </DocumentProperties>
  <Styles>${styles}</Styles>
  <Worksheet ss:Name="Business Data">
    <Table>${colDefs}${headerRow}${dataRows}</Table>
    <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
      <FreezePanes/>
      <FrozenNoSplit/>
      <SplitHorizontal>2</SplitHorizontal>
      <TopRowBottomPane>2</TopRowBottomPane>
      <ActivePane>2</ActivePane>
    </WorksheetOptions>
  </Worksheet>
</Workbook>`;

  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(
      new Blob([xml], { type: "application/vnd.ms-excel;charset=utf-8;" }),
    ),
    download: `gmapscrap_${new Date().toISOString().slice(0, 10)}.xls`,
  });
  a.click();
  URL.revokeObjectURL(a.href);
  log(
    `Excel exported: ${results.length} records × ${COLUMNS.length} columns.`,
    "success",
  );
});

// ── Message listener ───────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "PROGRESS") {
    updateStats(msg.found, msg.scrolls);
    progressBar.style.width = Math.min(8 + msg.scrolls * 4, 92) + "%";
    progressLabel.textContent = `Scroll ${msg.scrolls} — ${msg.found} records found`;
  }
  if (msg.type === "DONE") {
    results = msg.data || [];
    chrome.storage.local.set({
      gmapResults: results,
      gmapScrapeState: {
        scraping: false,
        found: results.length,
        scrolls: msg.scrolls,
      },
    });
    setScraping(false);
    stopTimer();
    updateStats(results.length, msg.scrolls);
    if (results.length > 0) {
      log(`✓ Done! ${results.length} businesses extracted.`, "success");
      log(
        `Fields: Name, Category, Rating, Reviews, Status, Phone, Address, City, State, Pincode, Hours`,
        "",
      );
    } else {
      log(
        "0 records. Make sure Google shows the local business map panel.",
        "warn",
      );
    }
  }
  if (msg.type === "LOG") log(msg.text, msg.level || "");
});
