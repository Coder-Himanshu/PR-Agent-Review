# PR Review Agent — Step-by-Step Setup

# Rewritten LinkedIn Post (Code-Accurate)

**PR Review Agent** is a free Chrome extension that brings AI-powered PR/MR reviews directly into your browser.

It works with:
- GitHub (including enterprise/self-hosted)
- GitLab (cloud + self-hosted)
- Bitbucket (cloud + server)

You open a PR/MR page, click **Detect from tab**, run **AI Review**, and get a structured review output in seconds.

You can choose your LLM provider:
- OpenAI
- Anthropic (Claude)
- Perplexity
- DeepSeek
- Grok (xAI)
- Google (Gemini)
- Ollama (local)
- Vitruvian (OpenAI-compatible private endpoint)

For self-hosted GitHub/GitLab/Bitbucket, just add your server origin in **Allowed Internal Origins** and configure the matching base URL fields.

Built this to reduce manual review time and catch issues faster (bugs, quality, and maintainability signals) before merging.

GitHub repo link in comments.

#opensource #chromeextension #github #gitlab #bitbucket #ai #codereview #developertools #productivity

---

## Screenshots

### 1) Settings + Allowed Origins + GitHub
<img width="899" height="667" alt="S1" src="https://github.com/user-attachments/assets/85f5bc4b-6fcd-4657-b861-c39ab867e0ea" />


### 2) GitLab + Bitbucket
<img width="900" height="508" alt="S2" src="https://github.com/user-attachments/assets/2f0678bb-031e-4368-a8c0-9bf9eb452aae" />


### 3) LLM Provider Settings
<img width="893" height="418" alt="S3" src="https://github.com/user-attachments/assets/5551fdc3-aae4-46cd-a499-d9f9ec458e30" />


### 4) Main Popup (Detect + Review)
<img width="1598" height="1140" alt="S4" src="https://github.com/user-attachments/assets/969c3371-7a3f-4c8c-97b5-7277e0be5575" />

### 5) Click on Detect (it will detect the URL of MR or PR like https://gitlab-yourcompany.com/your-project/-/merge_requests/1)
<img width="1628" height="1124" alt="EDA0A57D-8B25-4C45-A515-D39CB7CD5E8F" src="https://github.com/user-attachments/assets/94289a8d-d4c1-41be-aa33-7153ad1c703c" />

### 6) Now one step to go just click on AI Review and you will see AI Review in progress... just wait for few seconds you will get the review.
<img width="1600" height="1140" alt="2B03231C-6B2D-47D4-B094-321F7D181049" src="https://github.com/user-attachments/assets/882fa4f3-2ce3-4814-aa5d-3771a2b752af" />

---

## Step-by-Step Setup

### Step 1: Install the extension in Chrome
1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `pr-review-agent` folder.

### Step 2: Open extension Settings
1. Click the extension icon.
2. Open the popup.
3. Click **Settings**.

### Step 3: Configure Git provider credentials

#### GitHub
- `GitHub Base URL`: keep `https://github.com` for public GitHub.
- `GitHub API Base URL`: keep `https://api.github.com` for public GitHub.
- Add `GitHub PAT`.
- Scope needed: `repo` (private) or `public_repo` (public).

#### GitLab
- `GitLab Base URL`: keep `https://gitlab.com` for public GitLab.
- Add `GitLab Token`.
- Scope needed: `api`.

#### Bitbucket
- `Bitbucket Base URL`: keep `https://bitbucket.org` for cloud.
- Add `Bitbucket Username` (required for cloud app password auth).
- Add `Bitbucket App Password / Token`.
- Scope needed (cloud): Pull requests read/write.

### Step 4: (If self-hosted) add internal origin permission
1. In **Allowed Internal Origins**, enter your server origin (example: `https://gitlab.company.com`).
2. Click **Add + Grant Permission**.
3. In provider section, set matching self-hosted base URL values.
4. Save settings.

### Step 5: Configure LLM provider
1. Select provider in **LLM Provider**:
   - OpenAI / Anthropic / Perplexity / DeepSeek / Grok / Google / Ollama / Vitruvian
2. Enter provider API key.
3. Select model.
4. Optionally customize API base URL (required for Vitruvian).

### Step 6: Save
1. Click **Save Settings**.
2. Confirm the status changes to saved.

### Step 7: Run a review
1. Open any PR/MR page in GitHub, GitLab, or Bitbucket.
2. Open extension popup.
3. Click **Detect from tab**.
4. Click **AI Review**.
5. Review output appears in the panel.
6. Click **Copy review** to copy and paste into your PR/MR discussion if needed.

---

## Notes

- `Review Mode` supports `Summary` and `Strict`.
- `localhost` and `127.0.0.1` are included in host permissions (useful for local dev/proxy setups).
- The codebase includes comment-posting API handlers for GitHub/GitLab/Bitbucket in `background.js`; if you expose a popup action later, posting can be made one-click from UI.

