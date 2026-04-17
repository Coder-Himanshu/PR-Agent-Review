const STORAGE_KEY = "pra_settings";
const $ = (id) => document.getElementById(id);

function showToast(msg, type = "info") {
  const t = $("toast");
  t.textContent = msg;
  t.style.display = "block";
  t.style.borderColor = type === "error" ? "rgba(245,90,90,0.35)" : "rgba(255,255,255,0.16)";
  t.classList.add("show");
  setTimeout(() => {
    t.classList.remove("show");
    t.style.display = "none";
  }, 2200);
}

function setPill(text) {
  $("statusPill").textContent = text;
}

function normalizeOrigin(input) {
  try {
    const withProto = input.startsWith("http") ? input : `https://${input}`;
    const u = new URL(withProto);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

function requestOriginPermission(origin) {
  return new Promise((resolve) => {
    chrome.permissions.request({ origins: [`${origin}/*`] }, (granted) => resolve(Boolean(granted)));
  });
}

async function loadSettings() {
  const data = await chrome.storage.local.get([STORAGE_KEY]);
  return data[STORAGE_KEY] || {};
}

async function saveSettings(next) {
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
}

function renderOrigins(origins) {
  const box = $("originList");
  box.innerHTML = "";

  if (!origins.length) {
    box.innerHTML = `<div style="opacity:.8;">No internal origins added yet.</div>`;
    return;
  }

  origins.forEach((o) => {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.justifyContent = "space-between";
    row.style.gap = "10px";
    row.style.padding = "10px 12px";
    row.style.border = "1px solid rgba(172,192,211,0.25)";
    row.style.borderRadius = "12px";
    row.style.background = "rgba(15,27,31,0.45)";
    row.style.marginTop = "8px";

    row.innerHTML = `
      <div>
        <div style="font-weight:800;">${o}</div>
        <div style="opacity:.75;font-size:12px;">Permission: ${o}/*</div>
      </div>
      <button class="btn ghost" data-origin="${o}">Remove</button>
    `;

    box.appendChild(row);
  });

  box.querySelectorAll("button[data-origin]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const origin = btn.getAttribute("data-origin");
      const s = await loadSettings();
      const allowed = Array.isArray(s.allowedOrigins) ? s.allowedOrigins : [];
      const next = allowed.filter((x) => x !== origin);

      chrome.permissions.remove({ origins: [`${origin}/*`] }, async () => {
        await saveSettings({ ...s, allowedOrigins: next });
        renderOrigins(next);
        showToast("Origin removed");
        setPill("Saved");
      });
    });
  });
}

function applyLlmUI() {
  const p = $("llmProvider").value;
  $("openaiSection").style.display = p === "openai" ? "block" : "none";
  $("anthropicSection").style.display = p === "anthropic" ? "block" : "none";
  $("perplexitySection").style.display = p === "perplexity" ? "block" : "none";
  $("deepseekSection").style.display = p === "deepseek" ? "block" : "none";
  $("grokSection").style.display = p === "grok" ? "block" : "none";
  $("googleSection").style.display = p === "google" ? "block" : "none";
  $("ollamaSection").style.display = p === "ollama" ? "block" : "none";
  $("vitruvianSection").style.display = p === "vitruvian" ? "block" : "none";
}

async function init() {
  const s = await loadSettings();

  $("githubBaseUrl").value = s.githubBaseUrl || "https://github.com";
  $("githubApiBaseUrl").value = s.githubApiBaseUrl || "https://api.github.com";
  $("githubToken").value = s.githubToken || "";

  $("gitlabBaseUrl").value = s.gitlabBaseUrl || "https://gitlab.com";
  $("gitlabToken").value = s.gitlabToken || "";

  $("llmProvider").value = s.llmProvider || "openai";
  $("reviewMode").value = s.reviewMode || "summary";

  // OpenAI
  $("openaiKey").value = s.openaiKey || "";
  $("model").value = s.model || "gpt-4o-mini";
  // If model is not in the dropdown, add it as a custom option
  if ($("model").options.length > 0 && !Array.from($("model").options).some(opt => opt.value === s.model)) {
    const option = document.createElement("option");
    option.value = s.model;
    option.textContent = `${s.model} (custom)`;
    $("model").appendChild(option);
    $("model").value = s.model;
  }
  $("openaiBaseUrl").value = s.openaiBaseUrl || "https://api.openai.com/v1";

  // Anthropic
  $("anthropicKey").value = s.anthropicKey || "";
  $("anthropicModel").value = s.anthropicModel || "claude-3-5-sonnet-20241022";
  if (!Array.from($("anthropicModel").options).some(opt => opt.value === s.anthropicModel)) {
    const option = document.createElement("option");
    option.value = s.anthropicModel;
    option.textContent = `${s.anthropicModel} (custom)`;
    $("anthropicModel").appendChild(option);
  }
  $("anthropicBaseUrl").value = s.anthropicBaseUrl || "https://api.anthropic.com";

  // Perplexity
  $("perplexityKey").value = s.perplexityKey || "";
  $("perplexityModel").value = s.perplexityModel || "llama-3.1-sonar-large-128k-online";
  if (!Array.from($("perplexityModel").options).some(opt => opt.value === s.perplexityModel)) {
    const option = document.createElement("option");
    option.value = s.perplexityModel;
    option.textContent = `${s.perplexityModel} (custom)`;
    $("perplexityModel").appendChild(option);
  }
  $("perplexityBaseUrl").value = s.perplexityBaseUrl || "https://api.perplexity.ai";

  // DeepSeek
  $("deepseekKey").value = s.deepseekKey || "";
  $("deepseekModel").value = s.deepseekModel || "deepseek-chat";
  if (!Array.from($("deepseekModel").options).some(opt => opt.value === s.deepseekModel)) {
    const option = document.createElement("option");
    option.value = s.deepseekModel;
    option.textContent = `${s.deepseekModel} (custom)`;
    $("deepseekModel").appendChild(option);
  }
  $("deepseekBaseUrl").value = s.deepseekBaseUrl || "https://api.deepseek.com/v1";

  // Grok
  $("grokKey").value = s.grokKey || "";
  $("grokModel").value = s.grokModel || "grok-beta";
  if (!Array.from($("grokModel").options).some(opt => opt.value === s.grokModel)) {
    const option = document.createElement("option");
    option.value = s.grokModel;
    option.textContent = `${s.grokModel} (custom)`;
    $("grokModel").appendChild(option);
  }
  $("grokBaseUrl").value = s.grokBaseUrl || "https://api.x.ai/v1";

  // Google
  $("googleKey").value = s.googleKey || "";
  $("googleModel").value = s.googleModel || "gemini-1.5-pro";
  if (!Array.from($("googleModel").options).some(opt => opt.value === s.googleModel)) {
    const option = document.createElement("option");
    option.value = s.googleModel;
    option.textContent = `${s.googleModel} (custom)`;
    $("googleModel").appendChild(option);
  }
  $("googleBaseUrl").value = s.googleBaseUrl || "https://generativelanguage.googleapis.com/v1beta";

  // Ollama
  $("ollamaUrl").value = s.ollamaUrl || "http://localhost:11434";
  $("ollamaModel").value = s.ollamaModel || "llama3.1:8b";
  if (!Array.from($("ollamaModel").options).some(opt => opt.value === s.ollamaModel)) {
    const option = document.createElement("option");
    option.value = s.ollamaModel;
    option.textContent = `${s.ollamaModel} (custom)`;
    $("ollamaModel").appendChild(option);
  }

  // Vitruvian
  $("vitruvianKey").value = s.vitruvianKey || "";
  $("vitruvianModel").value = s.vitruvianModel || "";
  $("vitruvianBaseUrl").value = s.vitruvianBaseUrl || "";

  applyLlmUI();

  const origins = Array.isArray(s.allowedOrigins) ? s.allowedOrigins : [];
  renderOrigins(origins);

  $("llmProvider").addEventListener("change", applyLlmUI);

  $("addOriginBtn").addEventListener("click", async () => {
    const raw = $("originInput").value.trim();
    const origin = normalizeOrigin(raw);
    if (!origin) return showToast("Invalid origin URL", "error");

    const granted = await requestOriginPermission(origin);
    if (!granted) return showToast("Permission denied for this origin", "error");

    const cur = await loadSettings();
    const allowed = new Set(Array.isArray(cur.allowedOrigins) ? cur.allowedOrigins : []);
    allowed.add(origin);

    const next = { ...cur, allowedOrigins: Array.from(allowed) };
    await saveSettings(next);

    chrome.runtime.sendMessage({ type: "REGISTER_ORIGIN", origin }, (res) => {
      if (!res?.ok) showToast(res?.error || "Failed to register content script", "error");
    });

    $("originInput").value = "";
    renderOrigins(next.allowedOrigins);
    showToast("Origin added + permission granted ✅");
    setPill("Saved");
  });

  $("saveBtn").addEventListener("click", async () => {
    const cur = await loadSettings();
    const next = {
      ...cur,
      githubBaseUrl: $("githubBaseUrl").value.trim() || "https://github.com",
      githubApiBaseUrl: $("githubApiBaseUrl").value.trim() || "https://api.github.com",
      githubToken: $("githubToken").value.trim(),

      gitlabBaseUrl: $("gitlabBaseUrl").value.trim() || "https://gitlab.com",
      gitlabToken: $("gitlabToken").value.trim(),
      
      bitbucketBaseUrl: $("bitbucketBaseUrl").value.trim() || "https://bitbucket.org",
      bitbucketUsername: $("bitbucketUsername").value.trim(),
      bitbucketToken: $("bitbucketToken").value.trim(),

      llmProvider: $("llmProvider").value,
      reviewMode: $("reviewMode").value,

      // OpenAI
      openaiKey: $("openaiKey").value.trim(),
      model: $("model").value.trim() || "gpt-4o-mini",
      openaiBaseUrl: $("openaiBaseUrl").value.trim() || "https://api.openai.com/v1",

      // Anthropic
      anthropicKey: $("anthropicKey").value.trim(),
      anthropicModel: $("anthropicModel").value.trim() || "claude-3-5-sonnet-20241022",
      anthropicBaseUrl: $("anthropicBaseUrl").value.trim() || "https://api.anthropic.com",

      // Perplexity
      perplexityKey: $("perplexityKey").value.trim(),
      perplexityModel: $("perplexityModel").value.trim() || "llama-3.1-sonar-large-128k-online",
      perplexityBaseUrl: $("perplexityBaseUrl").value.trim() || "https://api.perplexity.ai",

      // DeepSeek
      deepseekKey: $("deepseekKey").value.trim(),
      deepseekModel: $("deepseekModel").value.trim() || "deepseek-chat",
      deepseekBaseUrl: $("deepseekBaseUrl").value.trim() || "https://api.deepseek.com/v1",

      // Grok
      grokKey: $("grokKey").value.trim(),
      grokModel: $("grokModel").value.trim() || "grok-beta",
      grokBaseUrl: $("grokBaseUrl").value.trim() || "https://api.x.ai/v1",

      // Google
      googleKey: $("googleKey").value.trim(),
      googleModel: $("googleModel").value.trim() || "gemini-1.5-pro",
      googleBaseUrl: $("googleBaseUrl").value.trim() || "https://generativelanguage.googleapis.com/v1beta",

      // Ollama
      ollamaUrl: $("ollamaUrl").value.trim() || "http://localhost:11434",
      ollamaModel: $("ollamaModel").value.trim() || "llama3.1:8b",

      // Vitruvian
      vitruvianKey: $("vitruvianKey").value.trim(),
      vitruvianModel: $("vitruvianModel").value.trim(),
      vitruvianBaseUrl: $("vitruvianBaseUrl").value.trim()
    };

    await saveSettings(next);
    showToast("Saved ✅");
    setPill("Saved");
  });

  setPill("Loaded");
  
  // Make settings window draggable
  makeDraggable();
  
  // Prevent window resizing and maximizing
  preventResizeAndMaximize();
  
  // Close button handler
  const closeBtn = document.getElementById("closeSettingsBtn");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      window.close();
    });
  }
}

// Prevent window from being resized or maximized
function preventResizeAndMaximize() {
  const targetWidth = 900;
  const targetHeight = 700;
  
  // Get current window and enforce size
  chrome.windows.getCurrent((win) => {
    if (win) {
      // If window is maximized or fullscreen, restore to normal size
      if (win.state === 'maximized' || win.state === 'fullscreen') {
        chrome.windows.update(win.id, {
          state: 'normal',
          width: targetWidth,
          height: targetHeight
        });
      }
      
      // If size doesn't match, reset it
      if (win.width !== targetWidth || win.height !== targetHeight) {
        chrome.windows.update(win.id, {
          width: targetWidth,
          height: targetHeight
        });
      }
    }
  });
  
  // Monitor for size changes and reset
  const checkSize = () => {
    chrome.windows.getCurrent((win) => {
      if (win) {
        // If maximized or fullscreen, restore
        if (win.state === 'maximized' || win.state === 'fullscreen') {
          chrome.windows.update(win.id, {
            state: 'normal',
            width: targetWidth,
            height: targetHeight
          });
        }
        // If size changed, reset it
        else if (win.width !== targetWidth || win.height !== targetHeight) {
          chrome.windows.update(win.id, {
            width: targetWidth,
            height: targetHeight
          });
        }
      }
    });
  };
  
  // Check periodically to prevent resizing
  setInterval(checkSize, 100);
  
  // Also check on window focus
  window.addEventListener('focus', checkSize);
}

// Make the settings window draggable
function makeDraggable() {
  const topBar = document.querySelector('.top');
  if (!topBar) return;

  let isDragging = false;
  let startX, startY, startLeft, startTop;

  topBar.addEventListener('mousedown', (e) => {
    // Don't start dragging if clicking on interactive elements
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.closest('button') || e.target.closest('input') || e.target.closest('.pill')) {
      return;
    }

    isDragging = true;
    startX = e.screenX;
    startY = e.screenY;

    chrome.windows.getCurrent((window) => {
      if (window) {
        startLeft = window.left || 0;
        startTop = window.top || 0;
      }
    });

    topBar.style.cursor = 'grabbing';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;

    const deltaX = e.screenX - startX;
    const deltaY = e.screenY - startY;

    chrome.windows.getCurrent((window) => {
      if (window) {
        chrome.windows.update(window.id, {
          left: startLeft + deltaX,
          top: startTop + deltaY
        });
      }
    });
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      topBar.style.cursor = 'grab';
    }
  });
}

init();
