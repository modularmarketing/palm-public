# PALM Setup: Claude Code

This guide walks you through installing PALM as a set of Claude Code skills. Once installed, the skills persist across all your Claude Code sessions -- you only do this once.

**Time required:** ~5 minutes

---

## Before You Start

You need two things:

- **Claude Code** -- if you don't have it yet, follow the [install guide](https://code.claude.com/docs/en/) (this also installs Node.js, which PALM needs)
- **An Iterable API key** -- log in to Iterable, go to **Settings > API Keys**, and copy your key. A read-only key works fine.

---

## Step 1: Install PALM

Open Claude Code and paste this prompt:

```
Delete the folders ~/palm-public, ~/.claude/skills/palm-get-metrics, ~/.claude/skills/palm-dashboard, and ~/.claude/skills/palm-info. Then clone https://github.com/modularmarketing/palm-public.git to ~/palm-public, run npm install, and copy the three skill folders from ~/palm-public/.claude/skills/ into ~/.claude/skills/.
```

This downloads PALM and installs three skills globally. Claude Code will ask for permission to run some terminal commands -- just approve them.

---

## Step 2: Restart Claude Code

Close and reopen Claude Code. The skills load on startup.

---

## Step 3: Set Your API Key

When you run `/palm:get-metrics` for the first time, PALM will ask you to paste your Iterable API key right into the conversation. That's it -- just paste it in.

If you prefer, you can also set it as an environment variable before starting Claude Code:

```bash
export ITERABLE_API_KEY=your_key_here
```

To make this permanent, add that line to your shell profile (`~/.zshrc` on Mac, `~/.bashrc` on Linux).

---

## Step 4: Pull Your Metrics

Type `/palm:get-metrics` and PALM will walk you through it conversationally. It will ask for:

- **Your organization name** -- this becomes the title on your dashboard (e.g., "Acme Corp")
- **Your data center** -- US or EU (defaults to US if you're not sure)

PALM pulls the last 90 days of campaign data automatically.

---

## Step 5: Generate Your Dashboard

Type `/palm:dashboard` and tell PALM which organization to build the dashboard for. It creates a single HTML file you can open in any browser -- no internet needed.

Share it in meetings, attach it to emails, or drop it in Dropbox. It works everywhere.

---

## Step 6: Learn More

Type `/palm:info` to see what PALM can do and which version you're running.

---

## Updating PALM

To update to the latest version, just paste the same install prompt from Step 1 again. It removes the old version and installs fresh.

---

## CLI Usage (Without Claude)

If you want to run the pipeline directly from the command line:

```bash
# Pull metrics
node ~/palm-public/bin/palm-metrics.js \
  --api-key "$ITERABLE_API_KEY" \
  --base-url "https://api.iterable.com" \
  --client-name "acme_corp" \
  --output-dir "output"

# Generate dashboard
node ~/palm-public/lib/generate-dashboard.js --client-name "acme_corp"
```

The `--client-name` flag is the organization name you used when pulling metrics (lowercase, spaces replaced with underscores). For EU data centers, use `--base-url "https://api.eu.iterable.com"`.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| PALM skills not recognized | Restart Claude Code. Skills load on startup. |
| API key not set | PALM will ask for it when you run `/palm:get-metrics`. Just paste it in. |
| Metrics pull fails with 401 | Your API key may be expired. Generate a new one in Iterable > Settings > API Keys. |
| Dashboard is blank | Make sure you pulled metrics first with `/palm:get-metrics` using the same organization name. |

---

Built by [Modular Marketing](https://modularmarketing.com) -- lifecycle marketing specialists.
