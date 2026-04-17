(function () {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg?.type === "GET_PAGE_URL") {
        sendResponse({ ok: true, url: location.href });
      }
    });
  
    // Optional: tiny “active” badge for supported pages
    const url = location.href;
    const isGitHubPR = /\/pull\/\d+/.test(url);
    const isGitLabMR = /\/-\/merge_requests\/\d+/.test(url);
    const isBitbucketPR = /\/pull-requests\/\d+/.test(url);
  
    if (!isGitHubPR && !isGitLabMR && !isBitbucketPR) return;
  
    if (document.getElementById("pra-badge")) return;
  
    const badge = document.createElement("div");
    badge.id = "pra-badge";
    badge.textContent = "PR Review Agent ready";
    badge.style.cssText = `
      position: fixed;
      right: 14px;
      bottom: 14px;
      z-index: 99999;
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid rgba(172,192,211,0.35);
      background: rgba(9,161,161,0.90);
      color: #fff;
      font-weight: 800;
      font-size: 12px;
      box-shadow: 0 12px 32px rgba(0,0,0,0.25);
    `;
    badge.title = "Open extension popup → Detect from tab";
    document.body.appendChild(badge);
  
    setTimeout(() => {
      badge.style.opacity = "0.65";
    }, 2500);
  })();
  