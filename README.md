# LinkedIn Multi-Page Scraper Extension

## 📝 Personal Experience

I have tried numerous methods to scrape data from LinkedIn, but every time, my accounts ended up getting blocked. After spending a significant amount of time experimenting with different approaches, I came up with the idea of developing this Chrome extension.

With this extension, I have successfully scraped data from **over 500,000 public accounts**, gathering millions of posts, comments, likes, and other engagement data. I ran this script continuously for **five days straight**, and it did not affect my account in any way.

However, **please note that this tool is strictly designed for scraping publicly available LinkedIn data**. It is **not** intended for any **illegal activities, privacy violations, or unauthorized access**. **Always comply with LinkedIn’s policies and legal regulations** when using this tool.

## Overview

This **Chrome Extension** automates collecting posts from multiple LinkedIn company pages. It:

1. **Reads** a list of LinkedIn URLs from a local file (`chunk.txt`).  
2. **Navigates** a browser tab to each page, finds the **Posts** section, then **scrolls** to load *all* posts.  
3. **Extracts** post content (text, date, likes, comments) and **adds** the company URL to each row.  
4. **Saves** the results in a **CSV** file for each page.  
5. If a page has **no posts** or is **unclaimed**, it creates a single-row CSV documenting "no post".  
6. **Never stops** if any page fails—automatically **skips** errors and continues.  
7. **Utilizes a heartbeat** system to differentiate between “still loading” and “stuck”. If no heartbeat is received within 30 seconds, it **skips** that page.  

---

## Key Features

- **Reads `chunk.txt`**: A JSON array of LinkedIn company URLs, e.g.  
  ```json
  [
    "https://www.linkedin.com/company/red-ventures",
    "https://www.linkedin.com/company/example-company"
  ]
  ```  
- **Infinite Scrolling**: Automatically scrolls until no more posts are loaded.  
- **Heartbeat** Mechanism: The content script sends "heartbeat" messages every scroll iteration. The extension will only force a skip if *30 seconds* pass with no heartbeat.  
- **Skipping**: If a page **errors out** or is **unclaimed** or has **no posts**, the extension logs that scenario (by generating a short CSV) and moves on.  
- **Updates** a `chunk-updated.txt` after each page, listing **remaining** URLs to be scraped.  
- **Never** blocks or stops entirely on errors.

---

## Repository Structure

```
.
├─ manifest.json
├─ popup.html
├─ popup.js
├─ contentScript.js
└─ chunk.txt
```

1. **`manifest.json`** – Chrome Extension manifest (Manifest V3).  
2. **`popup.html`** – The simple UI shown when you click the extension icon.  
3. **`popup.js`** – The main logic orchestrating URL navigation, scraping calls, timeouts, CSV creation.  
4. **`contentScript.js`** – Injected on LinkedIn pages, scrolls, sends heartbeats, and scrapes post data.  
5. **`chunk.txt`** – A JSON array of LinkedIn URLs. This is read at runtime.

---

## Installation

1. **Download or clone** this repository.  
2. **Open Chrome** and go to `chrome://extensions`.  
3. Enable **Developer mode** (toggle in top-right).  
4. Click **Load unpacked** and choose the folder containing this extension.  

Chrome will load your extension, showing its name and version.

---

## Usage

1. **Ensure you’re logged into LinkedIn** in the same Chrome profile.  
2. **Click** the extension icon in the browser’s toolbar.  
3. In the popup, you’ll see a **“Scrape All Pages”** button.  
4. **`chunk.txt`** is fetched on first run to get the list of LinkedIn pages.  
5. The extension **navigates** your active tab to each page, waiting for a full load.  
6. **Infinite Scroll** occurs on each page, sending you **CSV files** as they’re ready.  
7. After each page, an updated `chunk-updated.txt` is automatically downloaded to show the **remaining** URLs.  
8. If a page is stuck for **30 seconds** without sending a "heartbeat," the extension skips that page.  
9. If a page has **no posts**, you’ll still get a **1-row CSV** documenting "no post."  

---

## Configuration / Customization

- **`heartbeatTimeoutMs`** in `popup.js` default is **30 seconds**. Increase if you have extremely slow loading or massive pages.  
- **CSS selectors** in `contentScript.js`:  
  - `".update-components-text"` for post content.  
  - `"div.feed-shared-update-v2"` for each post container.  
  - If LinkedIn changes its internal DOM classes, you must update these selectors.  
- **CSV Columns** are: `[PageURL, PageName, Content, PostDate, Likes, Comments]`.  
- **`chunk.txt`** is read once per session; if you want a fresh load, remove existing `chunk_urls` from `chrome.storage.local` or reload the extension.

---

## How It Works

1. **Reading `chunk.txt`**:  
   - The extension fetches your local `chunk.txt` (an array of LinkedIn URLs).  
   - It stores them in `chrome.storage.local` under the key `"chunk_urls"`.  
2. **Infinite Scroll**:  
   - On each page, `contentScript.js` attempts to click the `"/posts/"` link if not already on it.  
   - It scrolls until no new posts load for 3 consecutive checks (spaced 3 seconds apart).  
3. **Heartbeat**:  
   - After each scroll iteration, `contentScript.js` calls `chrome.runtime.sendMessage({ action: "heartbeat" })`.  
   - `popup.js` resets a 30-second timer on each heartbeat. If the timer expires, that means no new heartbeat => skip.  
4. **CSV Generation**:  
   - For each page, we build a CSV with `[pageUrl, pageName, content, postDate, likes, comments]`.  
   - If the page is “unclaimed” or “deleted,” we add a single record with `"not found"` and `"no post"`.  
   - If an error or timeout occurs, we skip that page but still generate a "skipped" CSV.  
5. **`chunk-updated.txt`** is automatically downloaded each time a page is processed, showing leftover URLs.

---

## Limitations & Notes

1. **LinkedIn TOS**: This scraping may violate LinkedIn’s [User Agreement](https://www.linkedin.com/legal/user-agreement). Use at your own risk.  
2. **Selectors**: If LinkedIn changes DOM classes, you must update `contentScript.js`.  
3. **Scale**: Very large lists might trigger rate limits or suspicious activity detection from LinkedIn. Increase sleeps if you see errors or partial loads.  
4. **No Headless**: This runs in a real, visible Chrome tab—**not** headless. You can keep working in another window, though.  

---

## Troubleshooting

- **No Data / Empty CSV**: Check if the user is logged in or the LinkedIn page truly has no posts. Inspect DevTools for errors.  
- **Manifest or CSP Errors**: Ensure you have no inline scripts in Manifest V3.  
- **Skipping Too Soon**: Raise the 30s heartbeat timeout if you have slow pages.

---

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss. Keep in mind the code is subject to break if LinkedIn updates its layout.

---

## License

This extension’s code is provided **as-is**, under no specific license or an [MIT License](https://choosealicense.com/licenses/mit/). Use responsibly!

---

## Final Words

Enjoy **automated** LinkedIn post scraping across multiple company pages with robust skipping, CSV output, and a heartbeat-based approach to avoid infinite hangs. Let us know if you have any questions!

