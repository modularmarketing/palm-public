# PALM Setup: Claude Desktop (Advanced)

> **For most users, we recommend the Claude Code setup -- it's simpler and doesn't require downloading binaries.** See [SETUP-CLAUDE-CODE.md](SETUP-CLAUDE-CODE.md).

This guide is for technical users who prefer Claude Desktop over Claude Code. It involves downloading a binary, editing a JSON config file, and setting an environment variable.

**Time required:** ~5 minutes

---

## Before You Start

You need:
- Claude Desktop installed ([download](https://claude.ai/download))
- An Iterable API key (read-only key works)

---

## Step 1: Get Your Iterable API Key

1. Log in to Iterable
2. Go to **Settings > API Keys**
3. Copy an existing API key or create a new one (read-only permissions are sufficient)
4. Keep this key ready -- you'll paste it into a config file in Step 3

---

## Step 2: Download the PALM Binary

Go to the [PALM Releases page](https://github.com/modularmarketing/palm-public/releases/latest) and download the binary for your platform:

| Platform | File to download |
|----------|-----------------|
| macOS Apple Silicon (M1/M2/M3/M4) | `palm-mcp-darwin-arm64` |
| macOS Intel | `palm-mcp-darwin-x64` |
| Windows | `palm-mcp-windows-x64.exe` |

**macOS only:** After downloading, make the binary executable:
```bash
chmod +x ~/Downloads/palm-mcp-darwin-arm64
```
(Replace `arm64` with `x64` if you downloaded the Intel version.)

**macOS security note:** If macOS blocks the binary with "developer cannot be verified," go to **System Settings > Privacy & Security** and click **Allow Anyway** next to the PALM binary entry.

---

## Step 3: Add PALM to Claude Desktop Config

Open Claude Desktop's config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

If the file doesn't exist, create it. Add the `palm` entry to the `mcpServers` object:

**macOS config:**
```json
{
  "mcpServers": {
    "palm": {
      "command": "/Users/YourName/Downloads/palm-mcp-darwin-arm64",
      "env": {
        "ITERABLE_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

**Windows config:**
```json
{
  "mcpServers": {
    "palm": {
      "command": "C:\\Users\\YourName\\Downloads\\palm-mcp-windows-x64.exe",
      "env": {
        "ITERABLE_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

Replace `YourName` with your actual username and `your_api_key_here` with the key from Step 1.

---

## Step 4: Restart Claude Desktop

Fully quit and reopen Claude Desktop. The PALM tools load on startup.

---

## Step 5: Verify the Setup

In a new Claude conversation, type:
> "What can PALM do?"

You should see a response listing the three PALM tools and Modular Marketing attribution.

If you see an error about `ITERABLE_API_KEY`, check Step 3 -- the env variable must be exactly `ITERABLE_API_KEY` (all caps, underscore).

---

## Step 6: Pull Your First Metrics

> "Pull my Iterable metrics for Acme Corp."

Replace "Acme Corp" with your organization name. This becomes the name on your dashboard.

PALM will fetch workflows, campaigns, and per-campaign metrics. **This may take several minutes** depending on how many campaigns are in your account.

---

## Step 7: Generate the Dashboard

> "Build me a dashboard from the Acme Corp data."

PALM outputs a self-contained HTML file. Open it in your browser from Finder or File Explorer -- no internet connection required.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| PALM tools don't appear in Claude | Fully quit and reopen Claude Desktop. Check that the config JSON is valid (no trailing commas). |
| `ITERABLE_API_KEY is not set` error | Verify the env key is spelled exactly `ITERABLE_API_KEY` in the config file. |
| `command not found` or binary won't run | Check the full path to the binary in the config. On macOS, run `chmod +x /path/to/binary`. |
| macOS blocked the binary | Go to System Settings > Privacy & Security > Allow Anyway. |
| Metrics pull times out | Large accounts may take 10+ minutes. EU accounts: tell PALM you're on the EU data center. |
| Dashboard is blank | Make sure you pulled metrics first using the same organization name (Step 6). |

---

Built by [Modular Marketing](https://modularmarketing.com) -- lifecycle marketing specialists.
