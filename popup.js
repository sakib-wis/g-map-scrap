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
function startTimer() {
  elapsed = 0;
  clearInterval(timer);
  timer = setInterval(() => {
    elapsed++;
    countTime.textContent =
      elapsed < 60
        ? elapsed + "s"
        : Math.floor(elapsed / 60) + "m" + (elapsed % 60) + "s";
  }, 1000);
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
    startTimer();
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

// Load stored
chrome.storage.local.get(["gmapResults"], (data) => {
  if (data.gmapResults && data.gmapResults.length) {
    results = data.gmapResults;
    updateStats(results.length, 0);
    setStatus(
      "done",
      `<span>${results.length} records</span> from last session`,
    );
    progressBar.style.width = "100%";
    progressLabel.textContent = `${results.length} results ready`;
    log(`Loaded ${results.length} records from last session.`, "success");
  }
});

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
  log("Launching deep extractor...", "");
  const ok = await injectAndStart(tab.id);
  if (!ok) {
    setScraping(false);
    log("Failed to start. Try refreshing the page.", "error");
  }
});

btnStop.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) chrome.tabs.sendMessage(tab.id, { action: "STOP_SCRAPE" }, () => {});
  setScraping(false);
  log("Stopped by user.", "warn");
});

btnClear.addEventListener("click", () => {
  results = [];
  chrome.storage.local.set({ gmapResults: [] });
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
// All columns for marketing team
const COLUMNS = [
  { key: "name", label: "Business Name" },
  { key: "category", label: "Category / Type" },
  { key: "rating", label: "Rating (★)" },
  { key: "reviews", label: "Total Reviews" },
  { key: "status", label: "Open / Closed Now" },
  { key: "priceLevel", label: "Price Level" },
  { key: "phone", label: "Phone Number" },
  { key: "website", label: "Website" },
  { key: "address", label: "Full Address" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "pincode", label: "Pincode" },
  { key: "country", label: "Country" },
  { key: "hours", label: "Business Hours" },
  { key: "url", label: "Google Maps Link" },
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

  // Style IDs
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

  // Column widths
  const colWidths = [
    180, 120, 55, 70, 90, 60, 110, 150, 220, 90, 100, 70, 70, 160, 200,
  ];

  const colDefs = colWidths.map((w) => `<Column ss:Width="${w}"/>`).join("");

  // Title row
  const totalCols = COLUMNS.length;
  const titleRow = `<Row ss:Height="30">
    <Cell ss:MergeAcross="${totalCols - 1}" ss:StyleID="title">
      <Data ss:Type="String">G Map Scrap — Business Data Export | ${results.length} Records | ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</Data>
    </Cell>
  </Row>`;

  // Header row
  const headerRow = `<Row ss:Height="22">
    ${COLUMNS.map((c) => `<Cell ss:StyleID="header"><Data ss:Type="String">${esc(c.label)}</Data></Cell>`).join("")}
  </Row>`;

  // Data rows
  const dataRows = results
    .map((r, i) => {
      const isEven = i % 2 === 1;
      const base = isEven ? "rowEven" : "rowOdd";
      const cells = COLUMNS.map((c, ci) => {
        const val = r[c.key] || "";
        // Rating column — special style
        if (c.key === "rating" && val) {
          return `<Cell ss:StyleID="${isEven ? "ratingEven" : "rating"}"><Data ss:Type="String">★ ${esc(val)}</Data></Cell>`;
        }
        // Status column
        if (c.key === "status") {
          const sStyle = /open now|open 24/i.test(val)
            ? "open"
            : /closed/i.test(val)
              ? "closed"
              : base;
          return `<Cell ss:StyleID="${sStyle}"><Data ss:Type="String">${esc(val)}</Data></Cell>`;
        }
        // URL column — hyperlink
        if (c.key === "url" && val) {
          return `<Cell ss:StyleID="${isEven ? "linkEven" : "link"}" ss:HRef="${esc(val)}"><Data ss:Type="String">View on Maps</Data></Cell>`;
        }
        // Website column
        if (c.key === "website" && val) {
          return `<Cell ss:StyleID="${isEven ? "linkEven" : "link"}" ss:HRef="${esc(val)}"><Data ss:Type="String">${esc(val.replace(/^https?:\/\//, ""))}</Data></Cell>`;
        }
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
    <Table>${colDefs}${titleRow}${headerRow}${dataRows}</Table>
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
    chrome.storage.local.set({ gmapResults: results });
    setScraping(false);
    updateStats(results.length, msg.scrolls);
    if (results.length > 0) {
      log(`✓ Done! ${results.length} businesses extracted.`, "success");
      log(
        `Fields: Name, Category, Rating, Reviews, Status, Phone, Website, Address, City, State, Pincode, Hours`,
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
