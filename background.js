// background.js (MV3 service worker) - GitHub + GitLab + LLM router (PAT based)
const STORAGE_KEY = "pra_settings";

async function okJson(res) {
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.clone().json();
      detail = body?.message || body?.error || JSON.stringify(body);
    } catch (_) {
      try { detail = await res.text(); } catch (_) {}
    }
    throw new Error(`HTTP ${res.status}: ${res.statusText}${detail ? ` — ${detail}` : ""}`);
  }
  return res.json();
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

async function getSettings() {
  const data = await chrome.storage.local.get([STORAGE_KEY]);
  return data[STORAGE_KEY] || {};
}

async function setSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...patch };
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

// ----- Option B: dynamic content script registration for internal origins -----
async function registerContentScriptForOrigin(origin) {
  const id = `pra_${origin.replace(/https?:\/\//, "").replace(/[^a-z0-9]/gi, "_")}`;
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [id] });
  } catch (_) {}

  await chrome.scripting.registerContentScripts([
    {
      id,
      js: ["content_script.js"],
      matches: [`${origin}/*`],
      runAt: "document_idle"
    }
  ]);
  return id;
}

async function registerAllAllowedOrigins() {
  const s = await getSettings();
  const origins = Array.isArray(s.allowedOrigins) ? s.allowedOrigins : [];
  for (const o of origins) {
    try {
      await registerContentScriptForOrigin(o);
    } catch (_) {}
  }
}

chrome.runtime.onInstalled.addListener(() => registerAllAllowedOrigins());
chrome.runtime.onStartup.addListener(() => registerAllAllowedOrigins());

// Open popup as draggable window
let popupWindowId = null;
let settingsWindowId = null;

// Listen for window close to reset ID (but don't clear state automatically)
chrome.windows.onRemoved.addListener(async (closedWindowId) => {
  if (closedWindowId === popupWindowId) {
    popupWindowId = null;
    // Do NOT clear state here - only clear when explicitly requested via CLEAR_POPUP_STATE message
  }
  if (closedWindowId === settingsWindowId) {
    settingsWindowId = null;
  }
});

chrome.action.onClicked.addListener(async () => {
  // Check if window already exists
  if (popupWindowId) {
    try {
      const window = await chrome.windows.get(popupWindowId);
      if (window) {
        // Window exists, focus it
        await chrome.windows.update(popupWindowId, { focused: true });
        return;
      }
    } catch (e) {
      // Window doesn't exist, reset ID
      popupWindowId = null;
    }
  }

  // Create new window as draggable popup (non-resizable)
  const window = await chrome.windows.create({
    url: chrome.runtime.getURL('popup.html'),
    type: 'popup',
    width: 800,
    height: 600,
    focused: true,
    state: 'normal' // Prevent maximization
  });

  popupWindowId = window.id;
});

// ----- URL detection -----
function detectGitHubPR(tabUrl) {
  // https://github.com/{owner}/{repo}/pull/{number}
  // https://github.company.com/{owner}/{repo}/pull/{number}
  try {
    const u = new URL(tabUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length >= 4 && parts[2] === "pull") {
      const owner = parts[0];
      const repo = parts[1];
      const number = Number(parts[3]);
      if (!Number.isNaN(number)) {
        return { provider: "github", host: `${u.protocol}//${u.host}`, owner, repo, number };
      }
    }
  } catch (_) {}
  return null;
}

function detectGitLabMR(tabUrl) {
  // https://host/group/project/-/merge_requests/125
  try {
    const u = new URL(tabUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    const dashIdx = parts.indexOf("-");
    if (dashIdx !== -1 && parts[dashIdx + 1] === "merge_requests") {
      const iid = Number(parts[dashIdx + 2]);
      if (Number.isNaN(iid)) return null;
      const projectPath = parts.slice(0, dashIdx).join("/");
      return { provider: "gitlab", host: `${u.protocol}//${u.host}`, projectPath, iid };
    }
  } catch (_) {}
  return null;
}

function detectBitbucketPR(tabUrl) {
  // https://bitbucket.org/{workspace}/{repo}/pull-requests/{id}
  // https://bitbucket.company.com/projects/{project}/repos/{repo}/pull-requests/{id}
  try {
    const u = new URL(tabUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    
    // Cloud format: /{workspace}/{repo}/pull-requests/{id}
    if (parts.length >= 4 && parts[2] === "pull-requests") {
      const workspace = parts[0];
      const repo = parts[1];
      const id = Number(parts[3]);
      if (!Number.isNaN(id)) {
        return { provider: "bitbucket", host: `${u.protocol}//${u.host}`, workspace, repo, id, isCloud: true };
      }
    }
    
    // Server format: /projects/{project}/repos/{repo}/pull-requests/{id}
    const projectIdx = parts.indexOf("projects");
    const reposIdx = parts.indexOf("repos");
    const prIdx = parts.indexOf("pull-requests");
    if (projectIdx !== -1 && reposIdx !== -1 && prIdx !== -1 && prIdx > reposIdx) {
      const project = parts[projectIdx + 1];
      const repo = parts[reposIdx + 1];
      const id = Number(parts[prIdx + 1]);
      if (!Number.isNaN(id)) {
        return { provider: "bitbucket", host: `${u.protocol}//${u.host}`, project, repo, id, isCloud: false };
      }
    }
  } catch (_) {}
  return null;
}

function detectFromUrl(tabUrl) {
  return detectGitHubPR(tabUrl) || detectGitLabMR(tabUrl) || detectBitbucketPR(tabUrl);
}

// ----- GitHub provider -----
async function githubFetchPRAndFiles(d, settings) {
  const { host, owner, repo, number } = d;

  // For self-hosted GitHub Enterprise: use configured API URL or default to host/api/v3
  // For github.com: use configured API URL or default to api.github.com
  const apiBase =
    settings.githubApiBaseUrl?.trim() ||
    (host.includes("github.com") && !host.includes("github.company") && !host.match(/^\d+\.\d+\.\d+\.\d+/) 
      ? "https://api.github.com" 
      : `${host}/api/v3`);

  const headers = { Accept: "application/vnd.github+json" };
  const token = (settings.githubToken || "").trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  const pr = await fetch(`${apiBase}/repos/${owner}/${repo}/pulls/${number}`, { headers }).then(okJson);

  const files = [];
  let page = 1;
  while (page <= 10) {
    const url = `${apiBase}/repos/${owner}/${repo}/pulls/${number}/files?per_page=100&page=${page}`;
    const batch = await fetch(url, { headers }).then(okJson);
    if (!Array.isArray(batch) || batch.length === 0) break;
    files.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }

  const changes = files.map((f) => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    patch: f.patch || ""
  }));

  return {
    meta: {
      provider: "github",
      title: pr.title,
      url: pr.html_url,
      author: pr.user?.login || "",
      baseRef: pr.base?.ref || "",
      headRef: pr.head?.ref || "",
      changedFiles: pr.changed_files || changes.length
    },
    changes
  };
}

async function githubPostComment(d, settings, bodyMarkdown) {
  const { host, owner, repo, number } = d;

  // For self-hosted GitHub Enterprise: use configured API URL or default to host/api/v3
  const apiBase =
    settings.githubApiBaseUrl?.trim() ||
    (host.includes("github.com") && !host.includes("github.company") && !host.match(/^\d+\.\d+\.\d+\.\d+/) 
      ? "https://api.github.com" 
      : `${host}/api/v3`);

  const token = (settings.githubToken || "").trim();
  if (!token) throw new Error("GitHub token missing. Add PAT in Settings to post comments.");

  const res = await fetch(`${apiBase}/repos/${owner}/${repo}/issues/${number}/comments`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ body: bodyMarkdown })
  });

  if (!res.ok) throw new Error(`GitHub comment failed: HTTP ${res.status}`);
  return true;
}

// ----- GitLab provider -----
function encodeGitLabProjectPath(projectPath) {
  return encodeURIComponent(projectPath);
}

async function gitlabFetchMRAndChanges(d, settings) {
  const { host, projectPath, iid } = d;
  // For self-hosted GitLab: use configured base URL or detected host
  // normalizeOrigin ensures proper protocol/host format (handles IPs and custom domains)
  const base = settings.gitlabBaseUrl?.trim() || host;
  const origin = normalizeOrigin(base) || host;

  const token = (settings.gitlabToken || "").trim();
  if (!token) throw new Error("GitLab token missing. Add a GitLab PAT in Settings.");

  const headers = { "Authorization": `Bearer ${token}` };
  const projectEnc = encodeGitLabProjectPath(projectPath);

  const mr = await fetch(`${origin}/api/v4/projects/${projectEnc}/merge_requests/${iid}`, { headers }).then(okJson);

  // /changes is deprecated since GitLab 15.7 and removed in 16.0; use /diffs instead.
  // Fall back to /changes for older self-hosted instances.
  let rawDiffs = [];
  try {
    let page = 1;
    while (page <= 20) {
      const batch = await fetch(
        `${origin}/api/v4/projects/${projectEnc}/merge_requests/${iid}/diffs?per_page=50&page=${page}`,
        { headers }
      ).then(okJson);
      if (!Array.isArray(batch) || batch.length === 0) break;
      rawDiffs.push(...batch);
      if (batch.length < 50) break;
      page += 1;
    }
  } catch (_) {
    // Older GitLab: fall back to legacy /changes endpoint
    const mrChanges = await fetch(
      `${origin}/api/v4/projects/${projectEnc}/merge_requests/${iid}/changes`,
      { headers }
    ).then(okJson);
    rawDiffs = mrChanges?.changes || [];
  }

  const changes = rawDiffs.map((c) => ({
    filename: c.new_path || c.old_path || "",
    status: c.new_file ? "added" : c.deleted_file ? "removed" : "modified",
    additions: null,
    deletions: null,
    patch: c.diff || ""
  }));

  return {
    meta: {
      provider: "gitlab",
      title: mr.title,
      url: mr.web_url,
      author: mr.author?.username || "",
      baseRef: mr.target_branch || "",
      headRef: mr.source_branch || "",
      changedFiles: mr.changes_count || changes.length
    },
    changes
  };
}

async function gitlabPostComment(d, settings, bodyMarkdown) {
  const { host, projectPath, iid } = d;
  // For self-hosted GitLab: use configured base URL or detected host
  const base = settings.gitlabBaseUrl?.trim() || host;
  const origin = normalizeOrigin(base) || host;

  const token = (settings.gitlabToken || "").trim();
  if (!token) throw new Error("GitLab token missing. Add a GitLab PAT in Settings.");

  const headers = { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" };
  const projectEnc = encodeGitLabProjectPath(projectPath);

  const res = await fetch(`${origin}/api/v4/projects/${projectEnc}/merge_requests/${iid}/notes`, {
    method: "POST",
    headers,
    body: JSON.stringify({ body: bodyMarkdown })
  });

  if (!res.ok) throw new Error(`GitLab note failed: HTTP ${res.status}`);
  return true;
}

// ----- Bitbucket provider -----
async function bitbucketFetchPRAndFiles(d, settings) {
  const { host, workspace, repo, project, id, isCloud } = d;
  
  // Bitbucket Cloud API MUST use api.bitbucket.org, not bitbucket.org
  // For self-hosted Bitbucket Server: use configured base URL or detected host
  const apiBase = isCloud 
    ? "https://api.bitbucket.org"
    : (settings.bitbucketBaseUrl?.trim() || host);
  const origin = normalizeOrigin(apiBase) || apiBase;
  
  const token = (settings.bitbucketToken || "").trim();
  const username = (settings.bitbucketUsername || "").trim();
  
  if (!token) throw new Error("Bitbucket token missing. Add a Bitbucket App Password in Settings.");
  
  // Bitbucket Cloud uses Basic auth: username:app_password
  // Bitbucket Server can use Bearer token or Basic auth (username:token)
  let headers;
  if (isCloud && username) {
    // Cloud: Basic auth with username:app_password
    headers = {
      Authorization: `Basic ${btoa(`${username}:${token}`)}`,
      Accept: "application/json"
    };
  } else if (!isCloud && username) {
    // Server with username: use Basic auth (username:token)
    headers = {
      Authorization: `Basic ${btoa(`${username}:${token}`)}`,
      Accept: "application/json"
    };
  } else {
    // Server without username: use Bearer token
    // Some Bitbucket Server instances accept Bearer tokens
    headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    };
  }
  
  let prUrl, diffstatUrl;
  if (isCloud) {
    // Cloud API: /2.0/repositories/{workspace}/{repo}/pullrequests/{id}
    prUrl = `${origin}/2.0/repositories/${workspace}/${repo}/pullrequests/${id}`;
    diffstatUrl = `${origin}/2.0/repositories/${workspace}/${repo}/pullrequests/${id}/diffstat`;
  } else {
    // Server API: /rest/api/1.0/projects/{project}/repos/{repo}/pull-requests/{id}
    prUrl = `${origin}/rest/api/1.0/projects/${project}/repos/${repo}/pull-requests/${id}`;
    diffstatUrl = `${origin}/rest/api/1.0/projects/${project}/repos/${repo}/pull-requests/${id}/changes`;
  }
  
  const pr = await fetch(prUrl, { headers }).then(okJson);
  
  // Fetch file changes
  let changes = [];
  if (isCloud) {
    // Cloud: Get diffstat (list of changed files)
    const diffstat = await fetch(diffstatUrl, { headers }).then(okJson);
    const files = diffstat.values || [];
    
    // Get the diff endpoint for the PR (Cloud API uses api.bitbucket.org)
    const diffUrl = `${origin}/2.0/repositories/${workspace}/${repo}/pullrequests/${id}/diff`;
    
    try {
      // Fetch the full diff
      const diffText = await fetch(diffUrl, { headers }).then(res => res.ok ? res.text() : "");
      
      // Parse diff to extract individual files
      // Bitbucket diff format: diff --git a/path b/path
      const fileDiffs = diffText.split(/^diff --git /m).filter(Boolean);
      
      for (const fileDiff of fileDiffs) {
        const fileMatch = fileDiff.match(/^a\/(.+?)\s+b\/(.+?)$/m);
        if (fileMatch) {
          const filePath = fileMatch[2];
          const fileInfo = files.find(f => f.new?.path === filePath || f.old?.path === filePath);
          
          changes.push({
            filename: filePath,
            status: fileInfo?.status || (fileDiff.includes('new file') ? 'added' : fileDiff.includes('deleted') ? 'removed' : 'modified'),
            additions: fileInfo?.lines_added || 0,
            deletions: fileInfo?.lines_removed || 0,
            patch: fileDiff.split('\n').slice(1).join('\n') // Remove the diff --git line
          });
        }
      }
    } catch (e) {
      // Fallback: use diffstat info only
      for (const file of files) {
        const filePath = file.new?.path || file.old?.path || "";
        if (filePath) {
          changes.push({
            filename: filePath,
            status: file.status || "modified",
            additions: file.lines_added || 0,
            deletions: file.lines_removed || 0,
            patch: ""
          });
        }
      }
    }
  } else {
    // Server: Get changes directly
    const changesData = await fetch(diffstatUrl, { headers }).then(okJson);
    const values = changesData.values || [];
    
    for (const change of values) {
      const filePath = change.path?.toString || change.path || "";
      if (!filePath) continue;
      
      // Fetch diff for this file
      const diffUrl = `${origin}/rest/api/1.0/projects/${project}/repos/${repo}/pull-requests/${id}/diff/${encodeURIComponent(filePath)}`;
      
      try {
        const diffText = await fetch(diffUrl, { headers }).then(res => res.ok ? res.text() : "");
        changes.push({
          filename: filePath,
          status: change.type || "modified",
          additions: null,
          deletions: null,
          patch: diffText || ""
        });
      } catch (e) {
        changes.push({
          filename: filePath,
          status: change.type || "modified",
          additions: null,
          deletions: null,
          patch: ""
        });
      }
    }
  }
  
  return {
    meta: {
      provider: "bitbucket",
      title: pr.title || "",
      url: pr.links?.html?.href || (isCloud ? `${host}/${workspace}/${repo}/pull-requests/${id}` : `${host}/projects/${project}/repos/${repo}/pull-requests/${id}`),
      author: pr.author?.username || pr.author?.user?.name || "",
      baseRef: isCloud ? (pr.destination?.branch?.name || "") : (pr.toRef?.displayId || ""),
      headRef: isCloud ? (pr.source?.branch?.name || "") : (pr.fromRef?.displayId || ""),
      changedFiles: changes.length
    },
    changes
  };
}

async function bitbucketPostComment(d, settings, bodyMarkdown) {
  const { host, workspace, repo, project, id, isCloud } = d;
  // Bitbucket Cloud API MUST use api.bitbucket.org, not bitbucket.org
  // For self-hosted Bitbucket Server: use configured base URL or detected host
  const apiBase = isCloud 
    ? "https://api.bitbucket.org"
    : (settings.bitbucketBaseUrl?.trim() || host);
  const origin = normalizeOrigin(apiBase) || apiBase;
  
  const token = (settings.bitbucketToken || "").trim();
  const username = (settings.bitbucketUsername || "").trim();
  if (!token) throw new Error("Bitbucket token missing. Add a Bitbucket App Password in Settings.");
  
  let headers;
  if (isCloud && username) {
    // Cloud: Basic auth with username:app_password
    headers = {
      Authorization: `Basic ${btoa(`${username}:${token}`)}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    };
  } else if (!isCloud && username) {
    // Server with username: use Basic auth (username:token)
    headers = {
      Authorization: `Basic ${btoa(`${username}:${token}`)}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    };
  } else {
    // Server without username: use Bearer token
    headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    };
  }
  
  let commentUrl;
  if (isCloud) {
    commentUrl = `${origin}/2.0/repositories/${workspace}/${repo}/pullrequests/${id}/comments`;
  } else {
    commentUrl = `${origin}/rest/api/1.0/projects/${project}/repos/${repo}/pull-requests/${id}/comments`;
  }
  
  const body = isCloud 
    ? { content: { raw: bodyMarkdown } }
    : { text: bodyMarkdown };
  
  const res = await fetch(commentUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  
  if (!res.ok) throw new Error(`Bitbucket comment failed: HTTP ${res.status}`);
  return true;
}

// ----- LLM -----
function buildReviewPrompt(meta, changes, mode = "summary") {
  // Limit total prompt size to prevent 504 Gateway Timeout errors
  const MAX_TOTAL_PROMPT_SIZE = 15000; // chars
  const MAX_FILE_PATCH_SIZE = 3000; // chars per file (reduced to prevent timeouts)
  
  const totalFiles = changes.length;
  let totalSize = 0;
  
  const diffText = changes
    .map((c, i) => {
      // Limit individual patch size to prevent timeouts
      const patch = (c.patch || "").slice(0, MAX_FILE_PATCH_SIZE);
      const additions = c.additions || 0;
      const deletions = c.deletions || 0;
      const fileSection = `FILE ${i + 1}/${totalFiles}: ${c.filename}\nSTATUS: ${c.status}\nCHANGES: +${additions} -${deletions}\nDIFF:\n${patch}\n`;
      
      // Stop adding files if we're approaching the limit
      if (totalSize + fileSection.length > MAX_TOTAL_PROMPT_SIZE) {
        return null; // Signal to stop
      }
      totalSize += fileSection.length;
      return fileSection;
    })
    .filter(Boolean) // Remove null entries
    .join("\n---\n");

  // Removed redundant instruction text - system message already covers this
  const instruction = mode === "strict"
    ? "Review these code changes. Be strict and detailed. Call out code smells, security issues, performance and correctness problems."
    : "Review these code changes. Be practical and concise. Focus on meaningful improvements, bugs, and best practices.";

  const prompt = `${instruction}\n\nDiffs:\n${diffText}`;
  
  // Warn if we had to truncate files
  if (changes.length > diffText.split("FILE").length - 1) {
    console.warn(`Prompt truncated: Only showing ${diffText.split("FILE").length - 1} of ${totalFiles} files to prevent timeout`);
  }
  
  return prompt;
}

async function callOpenAI(settings, prompt) {
  const apiKey = (settings.openaiKey || "").trim();
  if (!apiKey) throw new Error("OpenAI API key missing in Settings.");

  const base = (settings.openaiBaseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = settings.model || "gpt-4o-mini";

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `OpenAI error: HTTP ${res.status}`);
  return data?.choices?.[0]?.message?.content?.trim() || "(No response)";
}

async function callAnthropic(settings, prompt) {
  const apiKey = (settings.anthropicKey || "").trim();
  if (!apiKey) throw new Error("Anthropic API key missing in Settings.");

  const base = (settings.anthropicBaseUrl || "https://api.anthropic.com").replace(/\/$/, "");
  const model = settings.anthropicModel || "claude-3-5-sonnet-20241022";
  
  // Anthropic API endpoint is /v1/messages
  const endpoint = base.includes("/v1") ? `${base}/messages` : `${base}/v1/messages`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }]
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Anthropic error: HTTP ${res.status}`);
  return data?.content?.[0]?.text?.trim() || "(No response)";
}

async function callPerplexity(settings, prompt) {
  const apiKey = (settings.perplexityKey || "").trim();
  if (!apiKey) throw new Error("Perplexity API key missing in Settings.");

  const base = (settings.perplexityBaseUrl || "https://api.perplexity.ai").replace(/\/$/, "");
  const model = settings.perplexityModel || "llama-3.1-sonar-large-128k-online";

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Perplexity error: HTTP ${res.status}`);
  return data?.choices?.[0]?.message?.content?.trim() || "(No response)";
}

async function callDeepSeek(settings, prompt) {
  const apiKey = (settings.deepseekKey || "").trim();
  if (!apiKey) throw new Error("DeepSeek API key missing in Settings.");

  const base = (settings.deepseekBaseUrl || "https://api.deepseek.com/v1").replace(/\/$/, "");
  const model = settings.deepseekModel || "deepseek-chat";

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `DeepSeek error: HTTP ${res.status}`);
  return data?.choices?.[0]?.message?.content?.trim() || "(No response)";
}

async function callGrok(settings, prompt) {
  const apiKey = (settings.grokKey || "").trim();
  if (!apiKey) throw new Error("Grok API key missing in Settings.");

  const base = (settings.grokBaseUrl || "https://api.x.ai/v1").replace(/\/$/, "");
  const model = settings.grokModel || "grok-beta";

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Grok error: HTTP ${res.status}`);
  return data?.choices?.[0]?.message?.content?.trim() || "(No response)";
}

async function callGoogle(settings, prompt) {
  const apiKey = (settings.googleKey || "").trim();
  if (!apiKey) throw new Error("Google API key missing in Settings.");

  const base = (settings.googleBaseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
  const model = settings.googleModel || "gemini-1.5-pro";
  
  // Google Gemini API uses /models/{model}:generateContent endpoint
  const endpoint = `${base}/models/${model}:generateContent`;

  const res = await fetch(`${endpoint}?key=${apiKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: prompt
        }]
      }]
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Google error: HTTP ${res.status}`);
  
  // Google returns text in candidates[0].content.parts[0].text
  return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "(No response)";
}

async function callOllama(settings, prompt) {
  const base = (settings.ollamaUrl || "http://localhost:11434").replace(/\/$/, "");
  const model = settings.ollamaModel || "llama3.1:8b";

  const res = await fetch(`${base}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, stream: false })
  });

  if (!res.ok) throw new Error(`Ollama error: HTTP ${res.status}`);
  const data = await res.json();
  return (data?.response || "").trim() || "(No response)";
}

async function callVitruvian(settings, prompt) {
  const apiKey = (settings.vitruvianKey || "").trim();
  if (!apiKey) throw new Error("Vitruvian API key missing in Settings.");

  const base = (settings.vitruvianBaseUrl || "").replace(/\/$/, "");
  if (!base) throw new Error("Vitruvian API base URL missing in Settings.");

  const model = (settings.vitruvianModel || "").trim();
  if (!model) throw new Error("Vitruvian model name missing in Settings.");

  // Vitruvian OpenAI-compatible chat completions API
  // Add timeout to prevent 504 Gateway Timeout errors
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000); // 120 seconds timeout

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: "You are a senior software engineer performing code reviews."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.2,
        max_tokens: 2000, // Reduced from 4000 to help with timeout issues
        stream: false
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    // Check content-type before parsing
    const contentType = res.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");

    if (!res.ok) {
      // If response is HTML (error page), read as text
      if (!isJson) {
        const text = await res.text();
        // Try to extract error message from HTML
        const errorMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i) || 
                          text.match(/<h1[^>]*>([^<]+)<\/h1>/i) ||
                          text.match(/<p[^>]*>([^<]+)<\/p>/i);
        const errorMsg = errorMatch ? errorMatch[1].trim() : `HTTP ${res.status}: ${res.statusText}`;
        if (res.status === 504) {
          throw new Error(`Vitruvian request timed out (504 Gateway Timeout). The code review prompt may be too long. Try reviewing fewer files or use a different LLM provider.`);
        }
        throw new Error(`Vitruvian error: ${errorMsg} (received HTML instead of JSON). Check API base URL: ${base}`);
      }
      // If JSON, parse normally
      const data = await res.json();
      throw new Error(data?.error?.message || `Vitruvian error: HTTP ${res.status}`);
    }

    // Parse JSON response
    if (!isJson) {
      let text;
      try {
        text = await res.text();
      } catch (e) {
        throw new Error(`Vitruvian returned non-JSON response (${contentType || 'unknown'}). Failed to read response body. Status: ${res.status}`);
      }
      
      // Check if response is empty or just whitespace
      if (!text || text.trim().length === 0) {
        throw new Error(`Vitruvian returned empty response (${contentType || 'unknown'}). Status: ${res.status}`);
      }
      
      // Check if it looks like HTML
      if (text.trim().startsWith('<')) {
        const errorMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i) || 
                          text.match(/<h1[^>]*>([^<]+)<\/h1>/i);
        const errorMsg = errorMatch ? errorMatch[1].trim() : 'HTML error page';
        throw new Error(`Vitruvian returned HTML instead of JSON: ${errorMsg}. Status: ${res.status}`);
      }
      
      // For other non-JSON responses, show a clean preview
      const preview = text.substring(0, 100).replace(/[^\x20-\x7E]/g, '?'); // Only printable ASCII
      throw new Error(`Vitruvian returned non-JSON response (${contentType || 'unknown'}): ${preview}... Status: ${res.status}`);
    }

    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() || "(No response)";
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Vitruvian request timed out after 120 seconds. The prompt may be too long. Try reviewing fewer files at once.');
    }
    // Re-throw other errors
    throw error;
  }
}

async function runLLM(settings, prompt) {
  const p = settings.llmProvider || "openai";
  switch (p) {
    case "anthropic":
      return callAnthropic(settings, prompt);
    case "perplexity":
      return callPerplexity(settings, prompt);
    case "deepseek":
      return callDeepSeek(settings, prompt);
    case "grok":
      return callGrok(settings, prompt);
    case "google":
      return callGoogle(settings, prompt);
    case "ollama":
      return callOllama(settings, prompt);
    case "vitruvian":
      return callVitruvian(settings, prompt);
    case "openai":
    default:
      return callOpenAI(settings, prompt);
  }
}

// ----- State -----
let lastDetection = null;
let lastReviewMarkdown = "";

// ----- Messages -----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "GET_SETTINGS_SUMMARY") {
        const s = await getSettings();
        sendResponse({
          ok: true,
          hasOpenAI: Boolean((s.openaiKey || "").trim()),
          hasAnthropic: Boolean((s.anthropicKey || "").trim()),
          hasPerplexity: Boolean((s.perplexityKey || "").trim()),
          hasDeepSeek: Boolean((s.deepseekKey || "").trim()),
          hasGrok: Boolean((s.grokKey || "").trim()),
          hasGoogle: Boolean((s.googleKey || "").trim()),
          hasOllama: (s.llmProvider || "openai") === "ollama",
          hasGitlabToken: Boolean((s.gitlabToken || "").trim()),
          hasGithubToken: Boolean((s.githubToken || "").trim()),
          hasBitbucketToken: Boolean((s.bitbucketToken || "").trim()),
          llmProvider: s.llmProvider || "openai",
          reviewMode: s.reviewMode || "summary"
        });
        return;
      }

      if (msg?.type === "REGISTER_ORIGIN" && msg.origin) {
        const origin = normalizeOrigin(msg.origin) || msg.origin;
        const settings = await getSettings();
        const allowed = new Set(Array.isArray(settings.allowedOrigins) ? settings.allowedOrigins : []);
        allowed.add(origin);

        await setSettings({ allowedOrigins: Array.from(allowed) });
        const scriptId = await registerContentScriptForOrigin(origin);

        sendResponse({ ok: true, scriptId, origin });
        return;
      }

      if (msg?.type === "DETECT_FROM_TAB") {
        // Query all tabs to find GitHub/GitLab PR/MR pages
        // Exclude extension pages (chrome-extension://)
        const allTabs = await chrome.tabs.query({});
        
        // Filter out extension pages and find GitHub/GitLab tabs
        const candidateTabs = allTabs.filter(tab => 
          tab.url && 
          !tab.url.startsWith('chrome-extension://') &&
          !tab.url.startsWith('chrome://') &&
          !tab.url.startsWith('edge://') &&
          (tab.url.includes('/pull/') || tab.url.includes('/merge_requests/') || tab.url.includes('/pull-requests/'))
        );
        
        // Try to find a matching PR/MR in candidate tabs
        for (const tab of candidateTabs) {
          const detected = detectFromUrl(tab.url);
          if (detected) {
            lastDetection = detected;
            sendResponse({ ok: true, detected });
            return;
          }
        }
        
        // If no PR/MR found, check active tabs in all windows
        const activeTabs = await chrome.tabs.query({ active: true });
        for (const tab of activeTabs) {
          if (tab.url && !tab.url.startsWith('chrome-extension://')) {
            const detected = detectFromUrl(tab.url);
            if (detected) {
              lastDetection = detected;
              sendResponse({ ok: true, detected });
              return;
            }
          }
        }
        
        throw new Error("Not a supported PR/MR page (GitHub PR, GitLab MR, or Bitbucket PR). Please open a GitHub Pull Request, GitLab Merge Request, or Bitbucket Pull Request page in a browser tab.");
      }

      if (msg?.type === "RUN_REVIEW") {
        if (!lastDetection) throw new Error("Nothing detected yet. Click Detect from tab first.");
        const settings = await getSettings();
        const mode = settings.reviewMode || "summary";

        const data =
          lastDetection.provider === "github"
            ? await githubFetchPRAndFiles(lastDetection, settings)
            : lastDetection.provider === "gitlab"
            ? await gitlabFetchMRAndChanges(lastDetection, settings)
            : await bitbucketFetchPRAndFiles(lastDetection, settings);

        const prompt = buildReviewPrompt(data.meta, data.changes, mode);
        const review = await runLLM(settings, prompt);
        lastReviewMarkdown = review;

        sendResponse({ ok: true, meta: data.meta, review });
        return;
      }

      if (msg?.type === "POST_COMMENT") {
        if (!lastDetection) throw new Error("Nothing detected yet. Click Detect from tab first.");
        const settings = await getSettings();
        const body = (msg.bodyMarkdown || lastReviewMarkdown || "").trim();
        if (!body) throw new Error("No review text to post.");

        if (lastDetection.provider === "github") await githubPostComment(lastDetection, settings, body);
        else if (lastDetection.provider === "gitlab") await gitlabPostComment(lastDetection, settings, body);
        else await bitbucketPostComment(lastDetection, settings, body);

        sendResponse({ ok: true });
        return;
      }

      if (msg?.type === "CLEAR_POPUP_STATE") {
        await chrome.storage.local.remove(["pra_popup_state"]);
        sendResponse({ ok: true });
        return;
      }

      if (msg?.type === "OPEN_SETTINGS") {
        // Check if settings window already exists
        if (settingsWindowId) {
          try {
            const window = await chrome.windows.get(settingsWindowId);
            if (window) {
              // Window exists, focus it
              await chrome.windows.update(settingsWindowId, { focused: true });
              sendResponse({ ok: true });
              return;
            }
          } catch (e) {
            // Window doesn't exist, reset ID
            settingsWindowId = null;
          }
        }

        // Create new settings window as draggable popup (non-resizable)
        const window = await chrome.windows.create({
          url: chrome.runtime.getURL('options.html'),
          type: 'popup',
          width: 900,
          height: 700,
          focused: true,
          state: 'normal' // Prevent maximization
        });
        
        // Ensure window cannot be resized (popup type already prevents this, but we'll be explicit)
        // Note: Chrome extension popup windows are already non-resizable by default

        settingsWindowId = window.id;
        sendResponse({ ok: true });
        return;
      }

      sendResponse({ ok: false, error: "Unknown message type." });
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();

  return true;
});
