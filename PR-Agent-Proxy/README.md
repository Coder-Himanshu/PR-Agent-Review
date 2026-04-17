# PR-Agent-Proxy

A lightweight, zero-dependency Node.js proxy layer for the **PR Review Agent** Chrome extension.

It solves one core problem: **browsers block cross-origin requests (CORS)**. When the Chrome extension tries to call GitLab/GitHub APIs or an LLM API directly from the browser, the browser may reject the response. These local proxy servers sit in between, add the correct CORS headers, and forward the request transparently.

---

## Why Do You Need This?

| Situation | Problem | Solution |
|---|---|---|
| Self-hosted GitLab / GitHub Enterprise | Your Git server may not send CORS headers that Chrome accepts from an extension | Run `git-proxy.js` locally; point the extension at `http://localhost:8080` |
| Custom / private LLM endpoint | Your internal LLM API (e.g. a private OpenAI-compatible server) blocks browser origins | Run `your-custom-llm-proxy.js` locally; point the extension at `http://localhost:8081` |
| Ollama (local model) | Ollama's default server doesn't always return the right CORS headers for Chrome extensions | Run the LLM proxy in front of Ollama |

If you are using **public GitHub** (`github.com`), **public GitLab** (`gitlab.com`), **Bitbucket Cloud**, or a **hosted LLM** like OpenAI / Anthropic / Gemini directly, you most likely **do not need these proxies** — the extension handles those natively.

---

## Architecture Overview

```
Chrome Extension (popup)
        │
        │  HTTP request (localhost)
        ▼
┌──────────────────────┐        ┌────────────────────────────┐
│   git-proxy.js       │ ──────▶│  Self-hosted GitLab /      │
│   :8080              │        │  GitHub Enterprise / etc.  │
└──────────────────────┘        └────────────────────────────┘

┌──────────────────────┐        ┌────────────────────────────┐
│  your-custom-llm-    │ ──────▶│  Private LLM API /         │
│  proxy.js  :8081     │        │  Ollama / Custom Endpoint  │
└──────────────────────┘        └────────────────────────────┘
```

Both proxies:
- Accept HTTP requests from the extension on localhost
- Strip the browser `Origin` / `Host` headers that can cause upstream rejections
- Forward the request (with all other headers, including `Authorization`) to the real upstream
- Strip conflicting CORS headers from the upstream response
- Add clean, correct CORS headers before returning the response to the extension

---

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or later (uses native `http`/`https` — no `npm install` needed)

---

## Step-by-Step Setup

### Step 1 — Clone or download the proxy folder

If you already have the PR Review Agent extension folder, the `PR-Agent-Proxy` folder is inside it. Navigate into it:

```bash
cd PR-Agent-Proxy
```

### Step 2 — Install dependencies

There are **no third-party dependencies**. The proxies use only Node.js built-in modules (`http`, `https`). You can optionally run:

```bash
npm install
```

But it will install nothing — the `package.json` has no `dependencies` block. This step is purely optional.

### Step 3 — Start the Git proxy (for self-hosted Git servers)

Run this if your Git provider is a **self-hosted GitLab, GitHub Enterprise, or Bitbucket Server**:

```bash
node git-proxy.js
```

Default behaviour:
- Listens on `http://localhost:8080`
- Forwards all requests to `https://gitlab.com`

You will see:

```
Git proxy listening on http://localhost:8080 -> https://gitlab.com
Allowed origins: http://localhost:3000, http://localhost:5173, http://localhost:8080
```

### Step 4 — Start the LLM proxy (for custom / private LLM endpoints)

Run this if you are using **Ollama, a private OpenAI-compatible API, or any LLM endpoint** that has CORS issues:

```bash
node your-custom-llm-proxy.js
```

Default behaviour:
- Listens on `http://localhost:8081`
- Forwards all requests to `https://api.openai.com/v1`

You will see:

```
Custom LLM proxy listening on http://localhost:8081 -> https://api.openai.com/v1
Allowed origins: http://localhost:3000, http://localhost:5173, http://localhost:8080
```

### Step 5 — Configure environment variables (optional but important)

Both proxies are fully controlled via environment variables. Set them before starting the proxy.

#### Git Proxy variables

| Variable | Default | Description |
|---|---|---|
| `GIT_PROXY_TARGET` | `https://gitlab.com` | The upstream Git server URL to proxy to |
| `GIT_PROXY_PORT` | `8080` | The local port to listen on |
| `GIT_PROXY_ALLOWED_ORIGINS` | `http://localhost:3000,...` | Comma-separated allowed CORS origins. Use `*` to allow all. |
| `GIT_PROXY_INSECURE_TLS` | `false` | Set to `true` to accept self-signed TLS certificates on the upstream |

Example — pointing to a self-hosted GitLab:

```bash
GIT_PROXY_TARGET=https://gitlab.mycompany.com \
GIT_PROXY_PORT=8080 \
GIT_PROXY_ALLOWED_ORIGINS=* \
node git-proxy.js
```

#### LLM Proxy variables

| Variable | Default | Description |
|---|---|---|
| `LLM_PROXY_TARGET` | `https://api.openai.com/v1` | The upstream LLM API base URL |
| `LLM_PROXY_PORT` | `8081` | The local port to listen on |
| `LLM_PROXY_ALLOWED_ORIGINS` | `http://localhost:3000,...` | Comma-separated allowed CORS origins. Use `*` to allow all. |
| `LLM_PROXY_INSECURE_TLS` | `false` | Set to `true` to accept self-signed TLS certificates on the upstream |

Example — pointing to a local Ollama instance:

```bash
LLM_PROXY_TARGET=http://localhost:11434 \
LLM_PROXY_PORT=8081 \
LLM_PROXY_ALLOWED_ORIGINS=* \
node your-custom-llm-proxy.js
```

### Step 6 — Configure the Chrome extension to use the proxy

1. Open Chrome and click the **PR Review Agent** extension icon.
2. Click **Settings**.
3. Under your Git provider section:
   - Set **GitLab Base URL** (or GitHub/Bitbucket equivalent) to `http://localhost:8080`
4. Under the **LLM Provider** section:
   - Select your provider (e.g. `Vitruvian` for a custom OpenAI-compatible endpoint, or `Ollama`)
   - Set **API Base URL** to `http://localhost:8081`
5. Click **Save Settings**.

### Step 7 — Run a review

1. Open any PR/MR page in your browser.
2. Click the extension popup.
3. Click **Detect from tab** — it reads the current tab URL.
4. Click **AI Review** — the extension calls the proxy, which calls your upstream API, and streams the review back.
5. Review output appears in the panel. Use **Copy review** to paste it into your PR discussion.

---

## Using npm scripts (shortcut)

The `package.json` includes convenience scripts:

```bash
# Start the Git proxy
npm run git-proxy

# Start the custom LLM proxy
npm run custom-llm-proxy
```

---

## Common Use Cases

### Ollama (local AI model)

```bash
LLM_PROXY_TARGET=http://localhost:11434 \
LLM_PROXY_PORT=8081 \
LLM_PROXY_ALLOWED_ORIGINS=* \
node your-custom-llm-proxy.js
```

Then in extension settings, set LLM provider to **Ollama** and API Base URL to `http://localhost:8081`.

### Self-hosted GitLab with a self-signed certificate

```bash
GIT_PROXY_TARGET=https://gitlab.internal.mycompany.com \
GIT_PROXY_INSECURE_TLS=true \
GIT_PROXY_ALLOWED_ORIGINS=* \
node git-proxy.js
```

### GitHub Enterprise Server

```bash
GIT_PROXY_TARGET=https://github.mycompany.com \
GIT_PROXY_PORT=8080 \
GIT_PROXY_ALLOWED_ORIGINS=* \
node git-proxy.js
```

---

## How the CORS Fix Works (Technical Detail)

Browsers enforce the **Same-Origin Policy**. A Chrome extension has its own origin (`chrome-extension://...`). When it makes a direct `fetch()` to `https://gitlab.internal.com`, the browser checks the response for an `Access-Control-Allow-Origin` header that matches the extension origin. Self-hosted servers rarely include this header.

These proxies work by:

1. Receiving the request on `localhost` (which the extension is allowed to call via `host_permissions` in `manifest.json`)
2. Stripping the `Origin` and `Host` headers so the upstream server doesn't see the browser origin
3. Forwarding the request to the real upstream server
4. Receiving the upstream response and removing any conflicting CORS headers it may have returned
5. Injecting fresh `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, and `Access-Control-Allow-Headers` headers that Chrome accepts
6. Returning the patched response to the extension

This is a standard and widely-used pattern for local browser-to-API communication.

---

## Security Notes

- These proxies are designed to run **locally on your machine only**. Do not expose them on a public network or bind them to `0.0.0.0` on a shared server.
- Your API keys and tokens are passed through transparently in the `Authorization` header — the proxy never reads or logs them.
- The `GIT_PROXY_INSECURE_TLS=true` / `LLM_PROXY_INSECURE_TLS=true` flag disables TLS certificate validation. Only use this on trusted internal networks.

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| `ECONNREFUSED` in extension | Proxy is not running | Start `git-proxy.js` or `your-custom-llm-proxy.js` |
| `502 Bad Gateway` from proxy | Upstream server is unreachable | Check `GIT_PROXY_TARGET` / `LLM_PROXY_TARGET` value |
| `CORS error` still appears | Extension is not pointing to the proxy | Set the base URL in Settings to `http://localhost:808x` |
| `self-signed certificate` error | Upstream uses self-signed TLS | Set `GIT_PROXY_INSECURE_TLS=true` or `LLM_PROXY_INSECURE_TLS=true` |
| Proxy starts but no response | Wrong port configured in extension | Match `GIT_PROXY_PORT` / `LLM_PROXY_PORT` to what extension is calling |

---

## File Reference

| File | Purpose |
|---|---|
| `git-proxy.js` | CORS proxy for Git providers (GitLab, GitHub, Bitbucket) |
| `your-custom-llm-proxy.js` | CORS proxy for LLM APIs (OpenAI-compatible, Ollama, private endpoints) |
| `package.json` | npm scripts for convenience startup |

---

## License

MIT
