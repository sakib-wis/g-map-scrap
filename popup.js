// ── State ──────────────────────────────────────────────
let scraping = false;
let results  = [];
let timer    = null;
let elapsed  = 0;

// ── Elements ───────────────────────────────────────────
const statusDot     = document.getElementById('statusDot');
const statusText    = document.getElementById('statusText');
const countFound    = document.getElementById('countFound');
const countScrolls  = document.getElementById('countScrolls');
const countTime     = document.getElementById('countTime');
const progressBar   = document.getElementById('progressBar');
const progressLabel = document.getElementById('progressLabel');
const alertBox      = document.getElementById('alertBox');
const logBox        = document.getElementById('logBox');

const btnStart  = document.getElementById('btnStart');
const btnStop   = document.getElementById('btnStop');
const btnExcel  = document.getElementById('btnExcel');
const btnCsv    = document.getElementById('btnCsv');
const btnClear  = document.getElementById('btnClear');
const btnLogClear = document.getElementById('btnLogClear');

// ── Helpers ────────────────────────────────────────────
function log(msg, type = '') {
  const now = new Date();
  const time = now.toTimeString().slice(0, 8);
  const el = document.createElement('div');
  el.className = 'log-entry';
  el.innerHTML = `<span class="log-time">${time}</span><span class="log-msg ${type}">${msg}</span>`;
  logBox.appendChild(el);
  logBox.scrollTop = logBox.scrollHeight;
}

function setStatus(state, text) {
  statusDot.className = 'status-dot ' + state;
  statusText.innerHTML = text;
}

function updateStats(found, scrolls) {
  countFound.textContent   = found;
  countScrolls.textContent = scrolls;
  if (found > 0) {
    btnExcel.disabled = false;
    btnCsv.disabled   = false;
  }
}

function startTimer() {
  elapsed = 0;
  clearInterval(timer);
  timer = setInterval(() => {
    elapsed++;
    countTime.textContent = elapsed < 60
      ? elapsed + 's'
      : Math.floor(elapsed / 60) + 'm' + (elapsed % 60) + 's';
  }, 1000);
}

function stopTimer() { clearInterval(timer); }

function setScraping(active) {
  scraping = active;
  btnStart.disabled = active;
  btnStop.disabled  = !active;
  if (active) {
    setStatus('active', 'Scraping in progress...');
    startTimer();
    progressBar.style.width = '10%';
    progressLabel.textContent = 'Scrolling & extracting...';
    log('Scraping started.', 'success');
  } else {
    setStatus(results.length ? 'done' : '', results.length ? `Done — <span>${results.length} records</span> found` : 'Idle');
    stopTimer();
    progressBar.style.width = results.length ? '100%' : '0%';
    progressLabel.textContent = results.length ? `${results.length} results ready` : 'Ready';
  }
}

// ── Load stored results ────────────────────────────────
chrome.storage.local.get(['gmapResults'], (data) => {
  if (data.gmapResults && data.gmapResults.length) {
    results = data.gmapResults;
    updateStats(results.length, 0);
    setStatus('done', `<span>${results.length} records</span> loaded from last session`);
    progressBar.style.width = '100%';
    progressLabel.textContent = `${results.length} results ready`;
    log(`Loaded ${results.length} records from previous session.`, 'success');
  }
});

// ── Button Handlers ────────────────────────────────────
btnStart.addEventListener('click', async () => {
  alertBox.classList.remove('show');
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url.includes('google.com')) {
    alertBox.classList.add('show');
    log('Not on Google Maps! Please search on Google first.', 'error');
    setStatus('error', 'Not on Google Maps');
    return;
  }
  chrome.storage.local.set({ gmapResults: [] });
  results = [];
  updateStats(0, 0);
  countTime.textContent = '0s';
  setScraping(true);
  chrome.tabs.sendMessage(tab.id, { action: 'START_SCRAPE' }, (res) => {
    if (chrome.runtime.lastError) {
      log('Content script not ready. Injecting...', 'warn');
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }, () => {
        setTimeout(() => {
          chrome.tabs.sendMessage(tab.id, { action: 'START_SCRAPE' });
        }, 500);
      });
    }
  });
});

btnStop.addEventListener('click', async () => {
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) chrome.tabs.sendMessage(tab.id, { action: 'STOP_SCRAPE' });
  setScraping(false);
  log('Scraping stopped by user.', 'warn');
});

btnClear.addEventListener('click', () => {
  results = [];
  chrome.storage.local.set({ gmapResults: [] });
  updateStats(0, 0);
  countTime.textContent = '0s';
  progressBar.style.width = '0%';
  progressLabel.textContent = 'Ready';
  btnExcel.disabled = true;
  btnCsv.disabled   = true;
  setStatus('', 'Data cleared. Ready to scrape.');
  log('All data cleared.', 'warn');
});

btnLogClear.addEventListener('click', () => { logBox.innerHTML = ''; });

// ── Export Helpers ─────────────────────────────────────
function escapeCsv(v) {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

btnCsv.addEventListener('click', () => {
  if (!results.length) return;
  const headers = ['Name','Rating','Reviews','Category','Address','Phone','Website','Hours','Google Maps URL'];
  const rows = results.map(r => [
    escapeCsv(r.name), escapeCsv(r.rating), escapeCsv(r.reviews),
    escapeCsv(r.category), escapeCsv(r.address), escapeCsv(r.phone),
    escapeCsv(r.website), escapeCsv(r.hours), escapeCsv(r.url)
  ].join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `gmapscrap_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  log(`CSV exported: ${results.length} records.`, 'success');
});

btnExcel.addEventListener('click', () => {
  if (!results.length) return;
  // Build XLSX manually (XML-based)
  const headers = ['Name','Rating','Reviews','Category','Address','Phone','Website','Hours','Google Maps URL'];
  const esc = (v) => String(v || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  let rowsXml = `<Row>` + headers.map(h => `<Cell><Data ss:Type="String">${esc(h)}</Data></Cell>`).join('') + `</Row>`;
  results.forEach(r => {
    const vals = [r.name, r.rating, r.reviews, r.category, r.address, r.phone, r.website, r.hours, r.url];
    rowsXml += `<Row>` + vals.map(v => `<Cell><Data ss:Type="String">${esc(v)}</Data></Cell>`).join('') + `</Row>`;
  });

  const xml = `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="header">
      <Font ss:Bold="1" ss:Color="#FFFFFF" ss:Size="11"/>
      <Interior ss:Color="#1a2236" ss:Pattern="Solid"/>
    </Style>
  </Styles>
  <Worksheet ss:Name="G Map Scrap">
    <Table>${rowsXml}</Table>
  </Worksheet>
</Workbook>`;

  const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `gmapscrap_${Date.now()}.xls`;
  a.click();
  URL.revokeObjectURL(url);
  log(`Excel exported: ${results.length} records.`, 'success');
});

// ── Listen for messages from content script ────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'PROGRESS') {
    updateStats(msg.found, msg.scrolls);
    const pct = Math.min(10 + msg.scrolls * 5, 95);
    progressBar.style.width = pct + '%';
    progressLabel.textContent = `Scroll ${msg.scrolls} — ${msg.found} found`;
    if (msg.found > 0) {
      chrome.storage.local.get(['gmapResults'], (d) => {
        results = d.gmapResults || [];
      });
    }
  }
  if (msg.type === 'DONE') {
    results = msg.data;
    chrome.storage.local.set({ gmapResults: results });
    setScraping(false);
    updateStats(results.length, msg.scrolls);
    log(`Scraping complete! ${results.length} records extracted.`, 'success');
  }
  if (msg.type === 'LOG') {
    log(msg.text, msg.level || '');
  }
});
