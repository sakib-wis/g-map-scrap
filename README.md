# G Map Scrap — Chrome Extension

**Extract Google Maps business data with infinite auto-scroll. Export to Excel or CSV.**

---

## Installation (Developer Mode)

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer Mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `gmapscrap` folder
5. The G Map Scrap icon will appear in your toolbar ✅

---

## How to Use

1. Open **Google** and search for businesses, e.g.:
   - `Electronics shop in Mohali`
   - `Restaurants in Delhi`
   - `Hotels near Chandigarh`
2. Click the **G Map Scrap** icon in Chrome toolbar
3. Click **Start Scraping**
4. The extension auto-scrolls like a human and collects all results
5. When done (or you click Stop), click **Export Excel** or **Export CSV**

---

## Data Extracted

| Field       | Description                     |
|-------------|---------------------------------|
| Name        | Business name                   |
| Rating      | Star rating (e.g. 4.5)          |
| Reviews     | Number of Google reviews        |
| Category    | Business type/category          |
| Address     | Full street address             |
| Phone       | Phone number                    |
| Website     | Business website URL            |
| Hours       | Opening hours (if available)    |
| Google Maps URL | Direct Maps link             |

---

## Features

- 🔄 **Human-like scrolling** — mimics natural scroll speed & rhythm
- 🔁 **Infinite scroll** — keeps scrolling until all results load
- 🧹 **Deduplication** — no duplicate entries
- 📊 **Export to Excel (.xls)** — opens in Excel, Google Sheets, LibreOffice
- 📄 **Export to CSV** — universal format for any tool
- 💾 **Session persistence** — data saved even if popup closed
- 📈 **Live stats** — see count, scrolls, and elapsed time in real time

---

## Notes

- Works best on `google.com` search results showing the local business panel
- Some fields (phone, website, hours) may not always be visible in search results
- For maximum data, open the full Google Maps (`maps.google.com`) and search there
- Extension requires no API keys or accounts

---

## Permissions Used

| Permission   | Why Needed                              |
|--------------|-----------------------------------------|
| `activeTab`  | Read & interact with current tab        |
| `scripting`  | Inject content script for scrolling     |
| `storage`    | Remember scraped data between sessions  |
| `downloads`  | Save CSV/Excel file to your computer    |

---

*G Map Scrap v1.0 — Built for data professionals, marketers & researchers.*
