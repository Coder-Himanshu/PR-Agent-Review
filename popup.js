const $ = (id) => document.getElementById(id);

let detected = null; // { provider, ... }
let lastReview = "";
const STATE_KEY = "pra_popup_state";

// Load persisted state
async function loadState() {
  try {
    const data = await chrome.storage.local.get([STATE_KEY]);
    const state = data[STATE_KEY];
    if (state) {
      detected = state.detected;
      lastReview = state.lastReview || "";
      
      if (detected) {
        let url = "";
        if (detected.provider === "github") {
          url = `${detected.host}/${detected.owner}/${detected.repo}/pull/${detected.number}`;
        } else if (detected.provider === "gitlab") {
          url = `${detected.host}/${detected.projectPath}/-/merge_requests/${detected.iid}`;
        } else if (detected.provider === "bitbucket") {
          if (detected.isCloud) {
            url = `${detected.host}/${detected.workspace}/${detected.repo}/pull-requests/${detected.id}`;
          } else {
            url = `${detected.host}/projects/${detected.project}/repos/${detected.repo}/pull-requests/${detected.id}`;
          }
        }
        $("currentUrl").value = url;
        setEnabled(true);
        const providerName = detected.provider === "github" ? "GitHub" : detected.provider === "gitlab" ? "GitLab" : "Bitbucket";
        setStatus(`${providerName} detected`);
        
        if (lastReview) {
          renderMarkdown(lastReview);
        }
      }
    }
  } catch (e) {
    console.error("Failed to load state:", e);
  }
}

// Save state
async function saveState() {
  try {
    await chrome.storage.local.set({
      [STATE_KEY]: {
        detected,
        lastReview
      }
    });
  } catch (e) {
    console.error("Failed to save state:", e);
  }
}

// Clear state
async function clearState() {
  try {
    await chrome.storage.local.remove([STATE_KEY]);
  } catch (e) {
    console.error("Failed to clear state:", e);
  }
}

// Enhanced Markdown to HTML converter
function markdownToHtml(markdown) {
  if (!markdown) return '';
  
  let html = markdown;
  
  // Store code blocks with unique placeholders to avoid reprocessing
  const codeBlockData = [];
  let codeBlockIndex = 0;
  
  // Extract and replace code blocks with placeholders FIRST (before any other processing)
  // Use a more unique placeholder that won't conflict with anything
  // Ensure placeholder is on its own line to avoid being wrapped in paragraphs
  html = html.replace(/```(\w+)?\n?([\s\S]*?)```/gim, (match, lang, code) => {
    const language = lang ? lang.toLowerCase().trim() : '';
    const codeContent = code.trim();
    const placeholder = `\n\0__CODEBLOCK_${codeBlockIndex}__\0\n`;
    codeBlockData[codeBlockIndex] = { language, codeContent, placeholder: placeholder.trim() };
    codeBlockIndex++;
    return placeholder;
  });
  
  // Headers with IDs for file links
  html = html.replace(/^### (.*$)/gim, (match, content) => {
    const id = content.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `<h3 id="${id}">${content}</h3>`;
  });
  html = html.replace(/^#### (.*$)/gim, (match, content) => {
    const id = content.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    // Check if it's a file header (contains backticks or looks like a file path)
    const isFileHeader = content.includes('FILE') || content.includes('`') || content.includes('/');
    const className = isFileHeader ? ' class="file-header"' : '';
    return `<h4 id="${id}"${className}>${content}</h4>`;
  });
  html = html.replace(/^## (.*$)/gim, (match, content) => {
    const id = content.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `<h2 id="${id}">${content}</h2>`;
  });
  html = html.replace(/^# (.*$)/gim, (match, content) => {
    const id = content.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `<h1 id="${id}">${content}</h1>`;
  });
  
  // Process lists (handle nested lists)
  const lines = html.split('\n');
  const processed = [];
  let inList = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Skip code block placeholders - they're already HTML and should not be processed
    // Check for placeholder (may be on its own line or with newlines)
    if (trimmed.match(/^\0__CODEBLOCK_\d+__\0$/) || line.includes('\0__CODEBLOCK_') && line.includes('__\0')) {
      if (inList) {
        processed.push('</ul>');
        inList = false;
      }
      // Keep the placeholder as-is (with its newlines), will be replaced later
      processed.push(line);
      continue;
    }
    
    // Check if it's a list item
    const listMatch = trimmed.match(/^[\-\*] (.+)$/);
    const numberedMatch = trimmed.match(/^\d+\. (.+)$/);
    
    if (listMatch || numberedMatch) {
      const content = listMatch ? listMatch[1] : numberedMatch[1];
      
      if (!inList) {
        processed.push('<ul>');
        inList = true;
      }
      
      // Process inline formatting
      let itemContent = content;
      itemContent = itemContent.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      itemContent = itemContent.replace(/`([^`]+)`/g, '<code>$1</code>');
      
      processed.push('<li>' + itemContent + '</li>');
    } else {
      if (inList) {
        processed.push('</ul>');
        inList = false;
      }
      
      // Skip empty lines and already processed HTML elements
      // Check if line starts with HTML tags (h1-h6, p, pre, div, ul, li, or code block placeholder)
      if (trimmed && !trimmed.match(/^<(h[1-6]|p|pre|div|ul|li|code|span)/i) && !line.includes('\0__CODEBLOCK_')) {
        // Process inline formatting for paragraphs
        let paraContent = trimmed;
        paraContent = paraContent.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        paraContent = paraContent.replace(/`([^`]+)`/g, '<code>$1</code>');
        processed.push('<p>' + paraContent + '</p>');
      } else if (trimmed) {
        processed.push(line);
      }
    }
  }
  
  if (inList) {
    processed.push('</ul>');
  }
  
  html = processed.join('\n');
  
  // Process inline code and bold in headers
  html = html.replace(/(<h[1-6]>)(.*?)(<\/h[1-6]>)/g, (match, open, content, close) => {
    content = content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    content = content.replace(/`([^`]+)`/g, '<code>$1</code>');
    return open + content + close;
  });
  
  // Clean up empty paragraphs BEFORE replacing code blocks
  html = html.replace(/<p><\/p>/gim, '');
  
  // Remove paragraphs that wrap code block placeholders (they should never be in paragraphs)
  html = html.replace(/<p>\s*(\0__CODEBLOCK_\d+__\0)\s*<\/p>/gim, '$1');
  
  // NOW process code blocks and replace placeholders (do this absolutely last, after all processing)
  // This must happen AFTER all other regex processing to avoid breaking the HTML
  codeBlockData.forEach(({ language, codeContent, placeholder }) => {
    // Use self-contained syntax highlighter (no external dependencies)
    const highlighted = highlightCode(codeContent, language);
    const langClass = language ? `language-${language}` : 'language-text';
    
    const codeId = 'code-' + Math.random().toString(36).substr(2, 9);
    const codeBlockHtml = `<div class="code-block-wrapper"><button class="code-copy-btn" data-code-id="${codeId}" title="Copy code"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button><pre><code id="${codeId}" class="${langClass}">${highlighted}</code></pre></div>`;
    // Replace placeholder with actual HTML using split/join for reliable replacement
    // Use the trimmed placeholder for matching, but the actual placeholder includes newlines
    const placeholderWithNewlines = `\n${placeholder}\n`;
    html = html.split(placeholderWithNewlines).join(`\n${codeBlockHtml}\n`);
    // Also handle case where placeholder might be at start/end without newlines
    html = html.split(placeholder).join(codeBlockHtml);
  });
  
  // NO FURTHER PROCESSING after code blocks are inserted
  // The HTML is complete and ready to be inserted into the DOM
  
  return html;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Self-contained syntax highlighter (no external dependencies)
function highlightCode(code, language) {
  if (!code) return '';
  
  // Escape HTML first
  let text = escapeHtml(code);
  
  // Use placeholders to protect already-highlighted sections from being re-processed
  const chunks = [];
  let chunkIndex = 0;
  
  const protect = (html) => {
    const key = `\uE000__CHUNK_${chunkIndex++}__\uE000`;
    chunks.push({ key, html });
    return key;
  };
  
  const restore = (text) => {
    chunks.forEach(({ key, html }) => {
      text = text.split(key).join(html);
    });
    return text;
  };
  
  // Map language aliases
  const lang = (language || '').toLowerCase();
  const isJS = ['javascript', 'js', 'typescript', 'ts', 'jsx', 'tsx'].includes(lang);
  const isPython = ['python', 'py'].includes(lang);
  const isJava = ['java'].includes(lang);
  const isCSS = ['css'].includes(lang);
  const isHTML = ['html', 'xml'].includes(lang);
  
  // Step 1: Protect and highlight comments FIRST (they can contain anything)
  text = text.replace(/(\/\/.*$|\/\*[\s\S]*?\*\/|#.*$)/gm, (match) => {
    return protect(`<span class="hljs-comment">${match}</span>`);
  });
  
  // Step 2: Protect and highlight strings (they can contain keywords)
  text = text.replace(/(["'`])(?:(?=(\\?))\2.)*?\1/g, (match) => {
    return protect(`<span class="hljs-string">${match}</span>`);
  });
  
  // Step 3: Highlight numbers
  text = text.replace(/\b(\d+\.?\d*)\b/g, '<span class="hljs-number">$1</span>');
  
  // Step 4: Language-specific highlighting
  if (isJS) {
    // JavaScript/TypeScript keywords
    const jsKeywords = /\b(if|else|for|while|do|switch|case|break|continue|return|function|const|let|var|class|extends|implements|import|export|async|await|try|catch|finally|throw|new|this|super|static|public|private|protected|interface|type|enum|namespace|module|default|true|false|null|undefined|void|typeof|instanceof|in|of|from|as)\b/g;
    text = text.replace(jsKeywords, '<span class="hljs-keyword">$&</span>');
    
    // Built-in objects/functions
    text = text.replace(/\b(console|window|document|Array|Object|String|Number|Boolean|Date|Math|JSON|Promise|Error|RegExp|Map|Set|WeakMap|WeakSet)\b/g, '<span class="hljs-built_in">$&</span>');
    
    // Functions (before variable names)
    text = text.replace(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?=\()/g, '<span class="hljs-function">$1</span>');
  } else if (isPython) {
    // Python keywords
    text = text.replace(/\b(def|class|if|elif|else|for|while|try|except|finally|with|import|from|as|return|yield|lambda|pass|break|continue|True|False|None|and|or|not|in|is|raise|assert|del|global|nonlocal)\b/g, '<span class="hljs-keyword">$&</span>');
    
    // Functions
    text = text.replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?=\()/g, '<span class="hljs-function">$1</span>');
  } else if (isJava) {
    // Java keywords
    text = text.replace(/\b(public|private|protected|static|final|abstract|class|interface|extends|implements|import|package|if|else|for|while|do|switch|case|break|continue|return|try|catch|finally|throw|new|this|super|void|int|long|float|double|boolean|char|String|Object|true|false|null)\b/g, '<span class="hljs-keyword">$&</span>');
  } else if (isCSS) {
    // CSS properties
    text = text.replace(/([a-zA-Z-]+)(?=\s*:)/g, '<span class="hljs-property">$1</span>');
    // CSS values
    text = text.replace(/(:\s*)([^;]+)(;)/g, '$1<span class="hljs-value">$2</span>$3');
  } else if (isHTML) {
    // HTML/XML tags
    text = text.replace(/&lt;(\/?)([\w-]+)/g, '<span class="hljs-tag">&lt;$1$2</span>');
    text = text.replace(/&gt;/g, '<span class="hljs-tag">&gt;</span>');
    // Attributes
    text = text.replace(/([\w-]+)(=)(&quot;|&apos;)([^&]*?)(\3)/g, '<span class="hljs-attribute">$1</span><span class="hljs-punctuation">$2</span><span class="hljs-string">$3$4$5</span>');
  } else {
    // Generic keywords for other languages
    text = text.replace(/\b(if|else|for|while|do|switch|case|break|continue|return|function|const|let|var|class|import|export|try|catch|finally|throw|new|this|true|false|null)\b/g, '<span class="hljs-keyword">$&</span>');
  }
  
  // Step 5: Restore protected chunks
  text = restore(text);
  
  return text;
}

function renderMarkdown(markdown) {
  const preview = $("output");
  const placeholder = $("outputPlaceholder");
  
  if (!markdown || !markdown.trim()) {
    preview.style.display = 'none';
    placeholder.style.display = 'flex';
    return;
  }
  
  preview.innerHTML = markdownToHtml(markdown);
  preview.style.display = 'block';
  placeholder.style.display = 'none';
  
  // Syntax highlighting is already applied during markdown conversion
  // No additional processing needed
  
  // Add click handlers for file links
  setupFileLinks(preview);
  
  // Add copy buttons to code blocks
  setupCodeCopyButtons(preview);
}

// Setup copy buttons for code blocks
function setupCodeCopyButtons(container) {
  const copyButtons = container.querySelectorAll('.code-copy-btn');
  copyButtons.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const codeId = btn.getAttribute('data-code-id');
      const codeElement = document.getElementById(codeId);
      if (codeElement) {
        // Get plain text from code (remove HTML tags)
        const codeText = codeElement.textContent || codeElement.innerText;
        await navigator.clipboard.writeText(codeText);
        
        // Visual feedback
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        btn.style.background = 'rgba(79, 195, 247, 0.3)';
        btn.style.borderColor = 'var(--accent-teal)';
        btn.querySelector('svg').style.stroke = 'var(--accent-teal)';
        setTimeout(() => {
          btn.innerHTML = originalHTML;
          btn.style.background = '';
          btn.style.borderColor = '';
        }, 2000);
        
        toast("Code copied");
      }
    });
  });
}

function setupFileLinks(container) {
  // Find all h4 elements with file-header class
  const fileHeaders = container.querySelectorAll('h4.file-header');
  
  // Create a map of file names to their IDs
  const fileMap = new Map();
  fileHeaders.forEach(header => {
    const text = header.textContent;
    // Extract file path from header text (e.g., "FILE 1: `path/to/file.ts`")
    const fileMatch = text.match(/FILE \d+:\s*`?([^`]+)`?/i);
    if (fileMatch) {
      const filePath = fileMatch[1].trim();
      fileMap.set(filePath, header.id);
    }
  });
  
  // Find all code elements that might be file paths
  const codeElements = container.querySelectorAll('code');
  codeElements.forEach(code => {
    const text = code.textContent.trim();
    // Check if this looks like a file path
    if (fileMap.has(text)) {
      const fileId = fileMap.get(text);
      const link = document.createElement('a');
      link.href = `#${fileId}`;
      link.className = 'file-link';
      link.textContent = text;
      link.onclick = (e) => {
        e.preventDefault();
        const target = document.getElementById(fileId);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          // Add a highlight effect
          target.style.transition = 'background-color 0.3s ease';
          target.style.backgroundColor = 'rgba(168, 220, 171, 0.3)';
          setTimeout(() => {
            target.style.backgroundColor = '';
          }, 2000);
        }
      };
      code.parentNode.replaceChild(link, code);
    }
  });
  
  // Also make file headers clickable to scroll to them
  fileHeaders.forEach(header => {
    header.style.cursor = 'pointer';
    header.onclick = () => {
      header.scrollIntoView({ behavior: 'smooth', block: 'start' });
      header.style.transition = 'background-color 0.3s ease';
      header.style.backgroundColor = 'rgba(168, 220, 171, 0.3)';
      setTimeout(() => {
        header.style.backgroundColor = '';
      }, 2000);
    };
  });
}

function toast(msg, isError = false) {
  const t = $("toast");
  t.textContent = msg;
  t.style.borderColor = isError ? "rgba(245,90,90,0.5)" : "rgba(168,220,171,0.5)";
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}

function setStatus(text) {
  $("statusPill").textContent = text;
}

function setEnabled(state) {
  $("reviewBtn").disabled = !state;
  $("copyBtn").disabled = !state;
}

async function openSettings() {
  // Open settings as a draggable popup window
  try {
    await chrome.runtime.sendMessage({ type: "OPEN_SETTINGS" });
  } catch (e) {
    console.error("Failed to open settings:", e);
    // Fallback to default options page
    await chrome.runtime.openOptionsPage();
  }
}

async function refreshStatusFromSettings() {
    // Just check storage directly instead of sending a background message
    const data = await chrome.storage.local.get(["pra_settings"]);
    const s = data.pra_settings || {};
  
    const hasOpenAI = Boolean((s.openaiKey || "").trim());
    const hasOllama = (s.llmProvider === "ollama") && Boolean((s.ollamaUrl || "").trim());
  
    if (!hasOpenAI && !hasOllama) setStatus("Add LLM key");
    else setStatus("Ready");
  }
  

async function detectFromTab() {
  setStatus("Detecting…");
  const res = await chrome.runtime.sendMessage({ type: "DETECT_FROM_TAB" });
  if (!res?.ok) {
    setStatus("Ready");
    toast(res?.error || "Could not detect PR/MR", true);
    return;
  }

  detected = res.detected;
  let url = "";
  if (detected.provider === "github") {
    url = `${detected.host}/${detected.owner}/${detected.repo}/pull/${detected.number}`;
  } else if (detected.provider === "gitlab") {
    url = `${detected.host}/${detected.projectPath}/-/merge_requests/${detected.iid}`;
  } else if (detected.provider === "bitbucket") {
    if (detected.isCloud) {
      url = `${detected.host}/${detected.workspace}/${detected.repo}/pull-requests/${detected.id}`;
    } else {
      url = `${detected.host}/projects/${detected.project}/repos/${detected.repo}/pull-requests/${detected.id}`;
    }
  }
  $("currentUrl").value = url;

  setEnabled(true);
  const providerName = detected.provider === "github" ? "GitHub" : detected.provider === "gitlab" ? "GitLab" : "Bitbucket";
  toast(`${providerName} PR/MR detected`);
  setStatus(`${providerName} detected`);
  await saveState();
}

function setLoadingState(isLoading) {
  const btn = $("reviewBtn");
  const overlay = $("loadingOverlay");
  
  if (isLoading) {
    btn.classList.add("loading");
    btn.disabled = true;
    overlay.style.display = 'flex';
  } else {
    btn.classList.remove("loading");
    overlay.style.display = 'none';
    if (detected) {
      btn.disabled = false;
    }
  }
}

async function runReview() {
  if (!detected) return toast("Please detect a PR/MR first", true);

  renderMarkdown("");
  setStatus("Reviewing…");
  setLoadingState(true);
  toast("Analyzing code changes…");

  try {
    const res = await chrome.runtime.sendMessage({ type: "RUN_REVIEW" });
    if (!res?.ok) {
      setStatus("Ready");
      toast(res?.error || "Review failed", true);
      setLoadingState(false);
      return;
    }

    lastReview = res.review || "";
    renderMarkdown(lastReview);
    setStatus("Review ready");
    toast("Review complete");
    await saveState();
  } catch (error) {
    setStatus("Ready");
    toast(error?.message || "Review failed", true);
  } finally {
    setLoadingState(false);
  }
}


// Convert markdown to plain text
function markdownToPlainText(markdown) {
  if (!markdown) return '';
  
  let text = markdown;
  
  // Remove code blocks (keep content, preserve language info if present)
  text = text.replace(/```(\w+)?\n?([\s\S]*?)```/g, (match, lang, code) => {
    const codeContent = code.trim();
    return lang ? `[${lang}]\n${codeContent}\n[/${lang}]` : codeContent;
  });
  
  // Remove inline code backticks
  text = text.replace(/`([^`]+)`/g, '$1');
  
  // Remove headers (# ## ###) - keep text, add spacing
  text = text.replace(/^#{1,6}\s+(.*)$/gm, (match, content) => {
    return '\n' + content + '\n';
  });
  
  // Remove bold (**text** or __text__)
  text = text.replace(/\*\*(.*?)\*\*/g, '$1');
  text = text.replace(/__(.*?)__/g, '$1');
  
  // Remove italic (*text* or _text_) - but be careful not to remove list markers
  text = text.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '$1');
  text = text.replace(/(?<!_)_([^_\n]+?)_(?!_)/g, '$1');
  
  // Remove strikethrough
  text = text.replace(/~~(.*?)~~/g, '$1');
  
  // Remove links [text](url) -> text
  text = text.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
  
  // Remove images ![alt](url) -> alt
  text = text.replace(/!\[([^\]]*)\]\([^\)]+\)/g, '$1');
  
  // Convert list items to plain text (keep bullet points)
  text = text.replace(/^[\-\*]\s+(.*)$/gm, '• $1');
  text = text.replace(/^\d+\.\s+(.*)$/gm, (match, content) => {
    const num = match.match(/^\d+/)[0];
    return `${num}. ${content}`;
  });
  
  // Remove horizontal rules
  text = text.replace(/^---+$/gm, '');
  text = text.replace(/^\*\*\*+$/gm, '');
  
  // Remove blockquotes
  text = text.replace(/^>\s+(.*)$/gm, '$1');
  
  // Clean up extra whitespace
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.replace(/[ \t]+$/gm, ''); // Remove trailing spaces
  
  return text.trim();
}

async function copyReview() {
  const text = lastReview || "";
  if (!text) return toast("No review to copy", true);
  const plainText = markdownToPlainText(text);
  await navigator.clipboard.writeText(plainText);
  toast("Copied to clipboard");
}

function clearAll() {
  renderMarkdown("");
  $("currentUrl").value = "";
  detected = null;
  lastReview = "";
  setEnabled(false);
  setStatus("Ready");
  toast("Cleared");
  clearState();
}

async function closePopup() {
  // Clear state when closing via popup close button
  await clearState();
  // Also notify background to clear state
  try {
    await chrome.runtime.sendMessage({ type: "CLEAR_POPUP_STATE" });
  } catch (e) {
    // Ignore errors if background is not available
  }
  window.close();
}

document.addEventListener("DOMContentLoaded", async () => {
  $("closeBtn").addEventListener("click", closePopup);
  $("settingsBtn").addEventListener("click", openSettings);
  $("detectBtn").addEventListener("click", detectFromTab);
  $("reviewBtn").addEventListener("click", runReview);
  $("copyBtn").addEventListener("click", copyReview);
  $("clearBtn").addEventListener("click", clearAll);

  setEnabled(false);
  await refreshStatusFromSettings();
  await loadState();
  
  // Make window draggable
  makeDraggable();
  
  // Prevent window resizing and maximizing
  preventResizeAndMaximize();
  
  // Do NOT clear state on beforeunload - only clear when user explicitly clicks close/clear buttons
  // This preserves state if window closes accidentally or loses focus
});

// Prevent window from being resized or maximized
function preventResizeAndMaximize() {
  const targetWidth = 800;
  const targetHeight = 600;
  
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

// Make the window draggable
function makeDraggable() {
  const topBar = document.querySelector('.top');
  if (!topBar) return;

  let isDragging = false;
  let startX, startY, startLeft, startTop;

  // Get initial window position
  chrome.windows.getCurrent((window) => {
    if (window) {
      startLeft = window.left || 0;
      startTop = window.top || 0;
    }
  });

  topBar.addEventListener('mousedown', (e) => {
    // Don't start dragging if clicking on buttons or interactive elements
    if (e.target.closest('button') || e.target.closest('.pill-btn')) {
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
