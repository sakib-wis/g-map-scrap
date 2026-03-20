// ── State ──────────────────────────────────────────────
let scraping = false;
let results  = [];
let timer    = null;
let elapsed  = 0;
let activeTabId = null;

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

const btnStart    = document.getElementById('btnStart');
const btnStop     = document.getElementById('btnStop');
const btnExcel    = document.getElementById('btnExcel');
const btnCsv      = document.getElementById('btnCsv');
const btnClear    = document.getElementById('btnClear');
const btnLogClear = document.getElementById('btnLogClear');

// ── Helpers ────────────────────────────────────────────
function log(msg, type = '') {
  const now  = new Date();
  const time = now.toTimeString().slice(0, 8);
  const el   = document.createElement('div');
  el.className = 'log-entry';
  el.innerHTML = `<span class="log-time">${time}</span><span class="log-msg ${type}">${msg}</span>`;
  logBox.appendChild(el);
  logBox.scrollTop = logBox.scrollHeight;
}

function setStatus(state, text) {
  statusDot.className = 'status-dot ' + state;
  statusText.innerHTML = text;
}

function updateStats(found, scrollCount) {
  countFound.textContent   = found;
  countScrolls.textContent = scrollCount;
  if (found > 0) { btnExcel.disabled = false; btnCsv.disabled = false; }
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
    progressBar.style.width = '8%';
    progressLabel.textContent = 'Scrolling & extracting...';
  } else {
    setStatus(results.length ? 'done' : '', results.length
      ? `Done — <span>${results.length} records</span> found`
      : 'Idle');
    stopTimer();
    progressBar.style.width = results.length ? '100%' : '0%';
    progressLabel.textContent = results.length ? `${results.length} results ready` : 'Ready';
  }
}

// ── Inject & start scraper ─────────────────────────────
async function injectAndStart(tabId) {
  return new Promise((resolve) => {
    // First inject the script
    chrome.scripting.executeScript(
      { target: { tabId }, files: ['content.js'] },
      () => {
        if (chrome.runtime.lastError) {
          log('Injection error: ' + chrome.runtime.lastError.message, 'error');
          resolve(false);
          return;
        }
        // Give it a moment to set up the listener, then send START
        setTimeout(() => {
          chrome.tabs.sendMessage(tabId, { action: 'START_SCRAPE' }, (res) => {
            if (chrome.runtime.lastError) {
              log('Message error: ' + chrome.runtime.lastError.message, 'error');
              resolve(false);
            } else {
              resolve(true);
            }
          });
        }, 300);
      }
    );
  });
}

// ── Load stored results ────────────────────────────────
chrome.storage.local.get(['gmapResults'], (data) => {
  if (data.gmapResults && data.gmapResults.length) {
    results = data.gmapResults;
    updateStats(results.length, 0);
    setStatus('done', `<span>${results.length} records</span> from last session`);
    progressBar.style.width = '100%';
    progressLabel.textContent = `${results.length} results ready`;
    log(`Loaded ${results.length} records from last session.`, 'success');
  }
});

// ── Button: Start ──────────────────────────────────────
btnStart.addEventListener('click', async () => {
  alertBox.classList.remove('show');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) { log('No active tab found.', 'error'); return; }

  const url = tab.url || '';
  if (!url.includes('google.com') && !url.includes('maps.google')) {
    alertBox.classList.add('show');
    log('Please open a Google search or Google Maps page first.', 'error');
    setStatus('error', 'Not on Google / Maps');
    return;
  }

  activeTabId = tab.id;
  results = [];
  chrome.storage.local.set({ gmapResults: [] });
  updateStats(0, 0);
  countTime.textContent = '0s';
  setScraping(true);
  log('Starting scraper...', '');

  const ok = await injectAndStart(tab.id);
  if (!ok) {
    setScraping(false);
    log('Failed to start. Check you are on a Google search results page.', 'error');
  }
});

// ── Button: Stop ───────────────────────────────────────
btnStop.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) chrome.tabs.sendMessage(tab.id, { action: 'STOP_SCRAPE' }, () => {});
  setScraping(false);
  log('Stopped by user.', 'warn');
});

// ── Button: Clear ──────────────────────────────────────
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

// ── Export: CSV ────────────────────────────────────────
function escapeCsv(v) {
  if (v == null) return '';
  const s = String(v);
  return (s.includes(',') || s.includes('"') || s.includes('\n'))
    ? '"' + s.replace(/"/g, '""') + '"'
    : s;
}

btnCsv.addEventListener('click', () => {
  if (!results.length) return;
  const headers = ['Name','Rating','Reviews','Category','Address','Phone','Website','Hours','Google Maps URL'];
  const rows = results.map(r => [
    r.name, r.rating, r.reviews, r.category, r.address, r.phone, r.website, r.hours, r.url
  ].map(escapeCsv).join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `gmapscrap_${Date.now()}.csv`
  });
  a.click();
  URL.revokeObjectURL(a.href);
  log(`CSV exported: ${results.length} records.`, 'success');
});

// ── Export: Excel ──────────────────────────────────────
btnExcel.addEventListener('click', () => {
  if (!results.length) return;
  const esc = v => String(v || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const headers = ['Name','Rating','Reviews','Category','Address','Phone','Website','Hours','Google Maps URL'];
  const headerRow = headers.map(h => `<Cell ss:StyleID="h"><Data ss:Type="String">${esc(h)}</Data></Cell>`).join('');
  const dataRows  = results.map(r =>
    '<Row>' + [r.name,r.rating,r.reviews,r.category,r.address,r.phone,r.website,r.hours,r.url]
      .map(v => `<Cell><Data ss:Type="String">${esc(v)}</Data></Cell>`).join('') + '</Row>'
  ).join('');
  const xml = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="h"><Font ss:Bold="1"/><Interior ss:Color="#1a2236" ss:Pattern="Solid"/></Style></Styles><Worksheet ss:Name="G Map Scrap"><Table><Row>${headerRow}</Row>${dataRows}</Table></Worksheet></Workbook>`;
  const blob = new Blob([xml], { type: 'application/vnd.ms-excel' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `gmapscrap_${Date.now()}.xls`
  });
  a.click();
  URL.revokeObjectURL(a.href);
  log(`Excel exported: ${results.length} records.`, 'success');
});

// ── Listen for messages from content script ────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'PROGRESS') {
    updateStats(msg.found, msg.scrolls);
    const pct = Math.min(8 + msg.scrolls * 4, 92);
    progressBar.style.width = pct + '%';
    progressLabel.textContent = `Scroll ${msg.scrolls} — ${msg.found} found`;
  }
  if (msg.type === 'DONE') {
    results = msg.data || [];
    chrome.storage.local.set({ gmapResults: results });
    setScraping(false);
    updateStats(results.length, msg.scrolls);
    if (results.length > 0) {
      log(`✓ Complete! ${results.length} records extracted.`, 'success');
    } else {
      log('Finished but 0 records found. See tips below.', 'warn');
      log('Tip: Search on google.com for "shops in [city]" — make sure the map panel shows.', 'warn');
    }
  }
  if (msg.type === 'LOG') {
    log(msg.text, msg.level || '');
  }
});
