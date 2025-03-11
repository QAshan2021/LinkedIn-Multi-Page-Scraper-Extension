// popup.js

document.addEventListener("DOMContentLoaded", () => {
  const scrapeBtn = document.getElementById("scrapeBtn");
  const statusDiv = document.getElementById("status");

  // We'll store the current "heartbeatTimer" so we can reset it on each "heartbeat" message.
  let heartbeatTimer = null;
  let heartbeatTimeoutMs = 30000; // 30 seconds

  // Listen for "heartbeat" from the content script
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (msg.action === "heartbeat") {
      // The content script is still actively loading new posts. Reset the timer.
      resetHeartbeatTimer();
    }
  });

  scrapeBtn.addEventListener("click", handleScrapeClick);

  async function handleScrapeClick() {
    try {
      // 1) Load or fetch the chunk URLs
      let storedList = await loadChunkFromStorage();
      if (!storedList || !storedList.length) {
        statusDiv.textContent = "Fetching chunk.txt...";
        const listFromFile = await fetchChunkFile();
        await saveChunkToStorage(listFromFile);
        storedList = listFromFile;
        statusDiv.textContent = `Loaded ${storedList.length} URLs from chunk.txt.`;
      } else {
        statusDiv.textContent = `Resuming with ${storedList.length} stored URLs...`;
      }

      // 2) Process each URL in a loop
      while (true) {
        const freshList = await loadChunkFromStorage();
        if (!freshList || !freshList.length) {
          statusDiv.textContent = "All pages processed. No more URLs!";
          break;
        }

        const url = freshList[0];
        try {
          statusDiv.textContent = `Navigating to ${url}...`;

          // Get the active tab
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab || !tab.id) throw new Error("No active tab found.");

          // 3) Navigate
          await navigateAndWait(tab.id, url);
          await sleep(2000);

          // Start the 30-second "no heartbeat" timer
          startHeartbeatTimer(() => {
            // If it expires, we skip this page
            console.warn(`No heartbeat for 30s from: ${url}. Skipping.`);
            skipUrl(url);
          });

          // 4) Scrape
          statusDiv.textContent = `Scraping ${url}...`;
          const scrapedData = await scrapeTab(tab.id, url);

          // Stop the heartbeat timer; we got the final data
          clearHeartbeatTimer();

          if (!scrapedData || !scrapedData.length) {
            // If the script returned empty array => no posts
            // We'll produce a single row CSV or note that it's no post
            statusDiv.textContent = `No posts found for ${url}. Logging as no post.`;
            downloadOneRowCSV(url, "not found", "no post");
            await removeUrlFromStorage(url);
            await downloadUpdatedChunkFile();
            continue;
          }

          // If the script returns exactly 1 item, check if it’s the “no post” record
          if (
            scrapedData.length === 1 &&
            scrapedData[0].pageName === "not found" &&
            scrapedData[0].content === "no post"
          ) {
            // Means the page was unclaimed / no "Posts" link
            statusDiv.textContent = `Page ${url} is unclaimed or no posts link. Logging.`;
            // We'll produce that single row with pageUrl, not found, no post...
            const csvContent = generateCSV(scrapedData);
            downloadCSV(csvContent, getFilenameForUrl(url));
            await removeUrlFromStorage(url);
            await downloadUpdatedChunkFile();
            continue;
          }

          // 5) Otherwise we have multiple posts or at least 1 real post
          const csvContent = generateCSV(scrapedData);
          downloadCSV(csvContent, getFilenameForUrl(url));

          await sleep(3000);
          statusDiv.textContent = `Checking if CSV downloaded: ${url}`;
          const downloaded = await waitForFileDownload(getFilenameForUrl(url));
          if (!downloaded) {
            console.warn(`Timeout waiting for CSV: ${url}. We'll skip anyway.`);
          }

          // Done. Remove from chunk, update file
          await removeUrlFromStorage(url);
          await downloadUpdatedChunkFile();
          statusDiv.textContent = `Done scraping ${url}.`;
          await sleep(2000);

        } catch (err) {
          // If anything fails in the scraping => skip
          console.error(`Error scraping ${url}, skipping.`, err);
          statusDiv.textContent = `Error scraping ${url}, skipping page...`;
          clearHeartbeatTimer();
          await skipUrl(url);
        }
      }
    } catch (err) {
      console.error(err);
      statusDiv.textContent = "Fatal error: " + err.message;
    }
  }

  /**
   * If we forcibly skip a page, produce a single row CSV to record it, remove it from chunk,
   * and re-download the updated chunk.
   */
  async function skipUrl(url) {
    console.warn("Skipping URL:", url);
    downloadOneRowCSV(url, "skipped", "no post or error");
    await removeUrlFromStorage(url);
    await downloadUpdatedChunkFile();
  }

  /**
   * Start a 30-second timer. If not reset, call `onTimeout()`.
   */
  function startHeartbeatTimer(onTimeout) {
    clearHeartbeatTimer();
    heartbeatTimer = setTimeout(() => {
      onTimeout();
    }, heartbeatTimeoutMs);
  }

  function resetHeartbeatTimer() {
    if (heartbeatTimer) {
      clearTimeout(heartbeatTimer);
      heartbeatTimer = setTimeout(() => {
        console.warn("Heartbeat timer expired => skip");
        // We'll handle skipping in the active logic if needed
      }, heartbeatTimeoutMs);
    }
  }

  function clearHeartbeatTimer() {
    if (heartbeatTimer) {
      clearTimeout(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  /** Download a minimal CSV with 1 row, documenting a no-post or skip scenario. */
  function downloadOneRowCSV(url, pageName, content) {
    // We'll fill out 6 columns: pageUrl, pageName, content, postDate, likes, comments
    const headers = ["PageURL", "PageName", "Content", "PostDate", "Likes", "Comments"];
    const row = [
      quoteCSV(url),
      quoteCSV(pageName),
      quoteCSV(content),
      "",
      "",
      "",
    ];
    const csvRows = [headers.join(","), row.join(",")];
    downloadCSV(csvRows.join("\n"), getFilenameForUrl(url));
  }

  /** -------------- Chrome Storage Logic -------------- */

  function loadChunkFromStorage() {
    return new Promise((resolve) => {
      chrome.storage.local.get("chunk_urls", (data) => {
        if (Array.isArray(data.chunk_urls)) {
          resolve(data.chunk_urls);
        } else {
          resolve([]);
        }
      });
    });
  }

  function saveChunkToStorage(urls) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ chunk_urls: urls }, () => {
        resolve();
      });
    });
  }

  async function removeUrlFromStorage(url) {
    const existing = await loadChunkFromStorage();
    const filtered = existing.filter((item) => item !== url);
    await saveChunkToStorage(filtered);
  }

  async function fetchChunkFile() {
    const chunkUrl = chrome.runtime.getURL("chunk.txt");
    const resp = await fetch(chunkUrl);
    if (!resp.ok) throw new Error("Failed to fetch chunk.txt");
    const arr = await resp.json();
    return arr.filter((u) => u && u.trim());
  }

  /** Re-download chunk-updated.txt so you have an external record of leftover URLs. */
  async function downloadUpdatedChunkFile() {
    const updatedList = await loadChunkFromStorage();
    const jsonText = JSON.stringify(updatedList, null, 2);

    const blob = new Blob([jsonText], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = "chunk-updated.txt";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  }

  /** -------------- Navigation & Scraping -------------- */

  function navigateAndWait(tabId, url) {
    return new Promise((resolve) => {
      chrome.tabs.update(tabId, { url }, () => {
        const listener = (updatedTabId, changeInfo) => {
          if (updatedTabId === tabId && changeInfo.status === "complete") {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
      });
    });
  }

  /**
   * Send a message telling the contentScript to do infinite scroll & gather data.
   * Wait for final response (the content script is only done if it calls sendResponse).
   */
  function scrapeTab(tabId, pageUrl) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(
        tabId,
        { action: "scrapeLinkedInPosts", pageUrl },
        (response) => {
          if (chrome.runtime.lastError) {
            // e.g. "no response because content script can't run on this page"
            return reject(chrome.runtime.lastError.message);
          }
          if (!response) {
            // No response => treat as an error
            return reject("No response from content script");
          }
          resolve(response.data || []);
        }
      );
    });
  }

  /** -------------- CSV Generation -------------- */

  /**
   * Build CSV from an array of objects with {pageUrl, pageName, content, postDate, likes, comments}
   */
  function generateCSV(dataArray) {
    const headers = ["PageURL", "PageName", "Content", "PostDate", "Likes", "Comments"];
    const rows = [headers.join(",")];

    dataArray.forEach((item) => {
      const row = [
        quoteCSV(item.pageUrl),
        quoteCSV(item.pageName),
        quoteCSV(item.content),
        quoteCSV(item.postDate),
        quoteCSV(item.likes),
        quoteCSV(item.comments),
      ];
      rows.push(row.join(","));
    });
    return rows.join("\n");
  }

  function quoteCSV(str) {
    const safe = str || "";
    return `"${safe.replace(/"/g, '""')}"`;
  }

  /**
   * Trigger a file download in the browser for the CSV content.
   */
  function downloadCSV(csvString, filename) {
    const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  }

  /** -------------- Download Checking -------------- */

  async function waitForFileDownload(filename) {
    const maxAttempts = 10;
    let attempts = 0;
    while (attempts < maxAttempts) {
      await sleep(3000);
      let found = false;
      try {
        found = await isFileDownloaded(filename);
      } catch (err) {
        console.warn("Error checking isFileDownloaded:", err);
      }
      if (found) return true;
      attempts++;
    }
    return false;
  }

  function isFileDownloaded(filename) {
    return new Promise((resolve) => {
      chrome.downloads.search({ query: [filename] }, (results) => {
        if (chrome.runtime.lastError) {
          console.warn("chrome.downloads.search error:", chrome.runtime.lastError);
          return resolve(false);
        }
        if (!Array.isArray(results)) {
          console.warn("Invalid downloads.search results:", results);
          return resolve(false);
        }
        const match = results.find((r) => r.filename && r.filename.includes(filename));
        resolve(!!match);
      });
    });
  }

  function getFilenameForUrl(url) {
    const parts = url.split("/").filter(Boolean);
    const last = parts.pop() || "linkedin_page";
    return last + ".csv";
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
});
