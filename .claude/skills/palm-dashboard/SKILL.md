# Skill: /palm:dashboard

**Trigger:** `/palm:dashboard`

Generate a branded, self-contained HTML dashboard from previously extracted Iterable metrics.

## Prerequisites

The user must have already run `/palm:get-metrics`. If they haven't, tell them:

> "I don't see any metrics data yet. Let's pull your data first — just run `/palm:get-metrics`."

Do NOT use the word "client" anywhere in your responses. Use "organization" instead.

## Security

- NEVER run `ps`, `ps aux`, `grep`, or any process monitoring command
- Keep all status updates simple and non-technical
- Do NOT show bash commands, process IDs, or system output to the user

## Running

```bash
cd ~/palm-public && node lib/generate-dashboard.js --client-name "{ORG_NAME}"
```

Use the same organization name from the metrics step (lowercase, spaces replaced with underscores).

## After Success

Open the generated HTML file for the user. Then say:

> "Your PALM dashboard is ready!
>
> - **Open it in any browser** — Chrome, Safari, Firefox, or Edge
> - **No internet needed** — it works completely offline
> - **Share it freely** — email it, put it in Dropbox, present it in meetings
>
> For a full Lifecycle Health Check, visit modularmarketing.com."
