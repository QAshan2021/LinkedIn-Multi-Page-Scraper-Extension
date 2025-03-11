// contentScript.js

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "scrapeLinkedInPosts") {
    const pageUrl = request.pageUrl || window.location.href;
    scrapeAllPosts(pageUrl)
      .then((finalData) => {
        sendResponse({ data: finalData });
      })
      .catch((err) => {
        console.warn("Content script error:", err);
        // Return an empty array on error so popup can produce "no post" CSV
        sendResponse({ data: [] });
      });
    return true; // Keep the message channel open
  }
});

/**
 * The main flow:
 *  - Attempt to click "Posts" link.
 *  - If none found => return a special "no post" item so the popup can record that.
 *  - If found => infinite scroll, sending "heartbeat" after each scroll iteration.
 *  - Finally extract all posts, returning them with pageUrl included.
 */
async function scrapeAllPosts(pageUrl) {
  // Check if there's a "Posts" link:
  const postsLink = document.querySelector("a[href*='/posts/']");
  if (!postsLink) {
    // No "Posts" link => no page or unclaimed
    // Return a single record that says "no post"
    return [
      {
        pageUrl,
        pageName: "not found",
        content: "no post",
        postDate: "",
        likes: "",
        comments: "",
      },
    ];
  }

  // If we do have a link but are not on /posts, click it:
  if (!window.location.href.includes("/posts/")) {
    postsLink.click();
    await sleep(3000); // Wait for reload
  }

  // Now do infinite scrolling with heartbeats
  await infiniteScrollWithHeartbeat();

  // Finally, extract all posts in the DOM
  return scrapePosts(pageUrl);
}

/**
 * Repeatedly scroll the page. After each scroll, send a "heartbeat"
 * so the popup knows we're alive and won't skip us.
 */
async function infiniteScrollWithHeartbeat() {
  let attemptsSinceLastHeightChange = 0;
  let lastHeight = 0;
  const maxAttempts = 3;

  while (attemptsSinceLastHeightChange < maxAttempts) {
    // Send "heartbeat" so the popup resets its 30-second timer
    chrome.runtime.sendMessage({ action: "heartbeat" })
      .catch(() => {/* ignore errors if popup is closed */});

    // Scroll to bottom
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(3000);

    const newHeight = document.body.scrollHeight;
    if (newHeight === lastHeight) {
      attemptsSinceLastHeightChange++;
    } else {
      attemptsSinceLastHeightChange = 0;
      lastHeight = newHeight;
    }
  }
}

/**
 * Extract all posts from the DOM, returning an array with pageUrl, pageName, content, etc.
 */
function scrapePosts(pageUrl) {
  const results = [];
  const postElements = document.querySelectorAll("div.feed-shared-update-v2");
  const pageName = getCompanyName();

  postElements.forEach((postEl) => {
    try {
      // Basic text content
      const contentEl = postEl.querySelector(".update-components-text");
      let content = contentEl ? contentEl.innerText.trim() : "No content found";
      content = removeNonAscii(content);

      // Relative time
      const timeEl = postEl.querySelector(".update-components-actor__sub-description span");
      let rawTime = timeEl ? timeEl.innerText.trim() : "Unknown";
      rawTime = removeNonAscii(rawTime);
      const postDate = convertRelativeTime(rawTime);

      // Likes
      const likesEl = postEl.querySelector(".social-details-social-counts__reactions-count");
      let likes = likesEl ? likesEl.innerText.trim() : "0";
      likes = removeNonAscii(likes);

      // Comments
      const commentsEl = postEl.querySelector(".social-details-social-counts__comments");
      let comments = "0";
      if (commentsEl) {
        comments = commentsEl.innerText.replace(" comments", "").replace(" comment", "").trim();
        comments = removeNonAscii(comments);
      }

      results.push({
        pageUrl,
        pageName,
        content,
        postDate,
        likes,
        comments,
      });
    } catch (err) {
      console.warn("Error parsing a post:", err);
    }
  });

  // If we have no posts, we might return an empty array. The popup
  // will produce a one-row CSV for that scenario.
  return results;
}

/**
 * Try to get the company's name from known LinkedIn elements,
 * else fallback to <title>.
 */
function getCompanyName() {
  const titleEl = document.querySelector(
    ".org-top-card-summary__title, .org-top-card-primary-content__title"
  );
  if (titleEl) {
    return removeNonAscii(titleEl.innerText.trim());
  }
  let docTitle = removeNonAscii(document.title);
  docTitle = docTitle.replace("| LinkedIn", "").trim();
  return docTitle;
}

/**
 * Convert "9mo", "3w", "2d", "1y", etc. => "YYYY-MM-DD HH:MM:SS" (approx).
 */
function convertRelativeTime(timeString) {
  const cleaned = timeString.toLowerCase().replace(/[^\da-z\s]/g, "");
  const match = cleaned.match(/(\d+)\s*(mo|m|w|d|y|h)/i);
  if (!match) return "Unknown";

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const now = new Date();

  switch (unit) {
    case "mo":
      now.setMonth(now.getMonth() - value);
      break;
    case "m":
      now.setMinutes(now.getMinutes() - value);
      break;
    case "w":
      now.setDate(now.getDate() - value * 7);
      break;
    case "d":
      now.setDate(now.getDate() - value);
      break;
    case "y":
      now.setFullYear(now.getFullYear() - value);
      break;
    case "h":
      now.setHours(now.getHours() - value);
      break;
    default:
      return "Unknown";
  }
  return formatDate(now);
}

/**
 * Format Date => "YYYY-MM-DD HH:MM:SS".
 */
function formatDate(dateObj) {
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
  const dd = String(dateObj.getDate()).padStart(2, "0");
  const hh = String(dateObj.getHours()).padStart(2, "0");
  const min = String(dateObj.getMinutes()).padStart(2, "0");
  const ss = String(dateObj.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

/**
 * Removes weird non-ASCII characters, e.g. ðŸ...
 */
function removeNonAscii(str) {
  return str.replace(/[^\x00-\x7F]/g, "");
}

/** Sleep helper. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
