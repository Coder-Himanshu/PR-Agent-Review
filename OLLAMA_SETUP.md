# Using PR Review Agent for FREE with Ollama (No API Key Needed)

Don't want to spend money on OpenAI, Claude, or Gemini API keys?

Ollama lets you run powerful AI models **100% locally on your own machine** — free, private, and no internet required once the model is downloaded. Your code never leaves your laptop.

This guide covers how to install Ollama, pull a model, and connect it to the PR Review Agent Chrome extension.

---

## What is Ollama?

Ollama is an open-source tool that lets you run large language models (LLMs) locally. It works on macOS, Windows, and Linux. Once running, it exposes a local API at `http://localhost:11434` that the extension talks to directly.

---

## Step 1 — Install Ollama

### macOS
Download and install from the official site:
```
https://ollama.com/download
```
Or via Homebrew:
```bash
brew install ollama
```

### Windows
Download the installer from:
```
https://ollama.com/download/windows
```

### Linux
```bash
curl -fsSL https://ollama.com/install.sh | sh
```

---

## Step 2 — Start Ollama

After installation, start the Ollama server:

```bash
ollama serve
```

You should see:
```
Ollama is running on http://localhost:11434
```

On macOS, Ollama also runs automatically in the menu bar after installation — you may not need to run this manually.

---

## Step 3 — Pull a Model

Pull a model to your machine. The model is downloaded once and stored locally.

**Recommended models for code review (pick one based on your machine's RAM):**

| Model | Command | RAM Needed | Quality |
|---|---|---|---|
| Llama 3.1 8B | `ollama pull llama3.1:8b` | 8 GB | Good |
| Llama 3.1 70B | `ollama pull llama3.1:70b` | 40 GB | Excellent |
| CodeLlama 13B | `ollama pull codellama:13b` | 16 GB | Great for code |
| CodeLlama 7B | `ollama pull codellama:7b` | 8 GB | Good for code |
| Mistral 7B | `ollama pull mistral:7b` | 8 GB | Fast and good |
| DeepSeek Coder 6.7B | `ollama pull deepseek-coder:6.7b` | 8 GB | Great for code |

**Not sure which to pick?**
- 8 GB RAM or less → use `llama3.1:8b` or `mistral:7b`
- 16 GB RAM → use `codellama:13b` (best balance for code review)
- 32 GB+ RAM → use `llama3.1:70b` for best quality

Example:
```bash
ollama pull llama3.1:8b
```

Wait for the download to complete. You will see a progress bar. Model sizes range from 4 GB to 40 GB depending on what you pick.

---

## Step 4 — Verify Ollama is Working

Test that Ollama is running and the model is available:

```bash
ollama list
```

You should see your downloaded model listed:
```
NAME                ID              SIZE    MODIFIED
llama3.1:8b         ...             4.7 GB  just now
```

You can also do a quick test:
```bash
ollama run llama3.1:8b "explain what a pull request is in one sentence"
```

---

## Step 5 — Configure the PR Review Agent Extension

1. Click the **PR Review Agent** extension icon in Chrome
2. Click **Settings**
3. Scroll down to **LLM Provider**
4. Select **Ollama** from the dropdown
5. Set **Ollama URL** to:
   ```
   http://localhost:11434
   ```
6. Select your model from the **Model** dropdown (e.g. `llama3.1:8b`)
7. Click **Save Settings**

That's it. No API key needed.

---

## Step 6 — Run a Review

1. Open any PR/MR page in GitHub, GitLab, or Bitbucket
2. Click the **PR Review Agent** extension icon
3. Click **Detect from tab**
4. Click **AI Review**
5. Wait a few seconds (local models are slightly slower than cloud APIs but completely free)
6. Review output appears in the panel

---

## Tips for Best Results with Ollama

- **Larger models give better reviews** — if your machine can handle `llama3.1:70b` or `codellama:34b`, use those
- **Keep Ollama running in the background** — on macOS it starts automatically; on Linux/Windows run `ollama serve` in a terminal before using the extension
- **Review Mode matters** — use `Summary` mode for faster responses with local models; `Strict` mode sends more tokens which takes longer
- **Close other heavy apps** — local models use a lot of RAM; closing Chrome tabs, IDEs, or other tools helps speed up inference

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Ollama error: HTTP 404" | The model name in settings doesn't match what's installed. Run `ollama list` to see exact names. |
| Extension times out | Your machine may be too slow for the selected model. Try a smaller model like `llama3.1:8b` or `mistral:7b`. |
| "Connection refused" | Ollama is not running. Run `ollama serve` in a terminal. |
| Slow responses | Normal for local models. Larger models on lower-spec machines take 30–90 seconds. Use a smaller model. |
| Model not in dropdown | Type the model name manually if it's not listed, or pick the closest match from the dropdown. |

---

## Useful Ollama Commands

```bash
# List all downloaded models
ollama list

# Pull a new model
ollama pull codellama:13b

# Remove a model to free up disk space
ollama rm llama3.1:70b

# Run a model interactively in terminal
ollama run llama3.1:8b

# Check Ollama version
ollama --version

# Stop Ollama (macOS menu bar → Quit)
# On Linux: Ctrl+C in the terminal running ollama serve
```

---

## Why Use Ollama Instead of a Cloud API?

| | Cloud API (OpenAI / Claude / Gemini) | Ollama (Local) |
|---|---|---|
| Cost | Pay per token | Free |
| Privacy | Code sent to external servers | Code stays on your machine |
| Internet required | Yes | Only for model download (one time) |
| Speed | Fast | Depends on your hardware |
| Setup | Add API key | Install + pull model |
| Best for | Production teams, large PRs | Individual devs, private/sensitive code |

---

## Recommended Setup for Most Developers

If you have a MacBook with Apple Silicon (M1/M2/M3/M4) or a Windows machine with 16 GB+ RAM:

```bash
# Install Ollama
brew install ollama   # macOS

# Pull CodeLlama 13B — best balance of quality and speed for code review
ollama pull codellama:13b

# Start Ollama (if not already running)
ollama serve
```

Then in the extension: select **Ollama** → model `codellama:13b` → Save → done.

---

*For more information visit: https://ollama.com*
*PR Review Agent Chrome Extension: https://github.com/Coder-Himanshu/PR-Agent-Review*
