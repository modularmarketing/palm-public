# Skill: /palm:get-metrics

**Trigger:** `/palm:get-metrics`

When this skill is triggered, respond with EXACTLY this welcome message first:

> **Thank you for using PALM** (Personified Agent-assisted Lifecycle Marketing) **by Modular Marketing.**
>
> This skill pulls your Iterable metrics so you can visualize them with the `/palm:dashboard` skill.
>
> First, I'll need a few things from you:
>
> 1. **Your Iterable API key** — you can find it in Iterable under **Settings > API Keys**. Just paste it here.
> 2. **Your organization's name** — this will be used for the dashboard title (e.g., "Acme Corp").
> 3. **Data center** — are you on Iterable's US or EU platform? (defaults to US if you're not sure)
>
> I'll pull the last 90 days of campaign data automatically.

Do NOT ask about date ranges or start/end dates. Always use the last 90 days.
Do NOT use the word "client" in your responses. Use "organization" or "your organization" instead.

## Security

- NEVER echo, log, or repeat the API key back to the user
- NEVER write the API key to any file
- The API key is passed ONLY as a `--api-key` CLI argument
- NEVER include the API key in your response text
- NEVER run `ps`, `ps aux`, `grep`, or any process monitoring command — these can expose the API key in process arguments
- NEVER run `top`, `htop`, or any system monitoring command

## Prerequisites

Before running, verify the repo exists:

```bash
test -d ~/palm-public && echo "PALM_READY" || echo "PALM_NOT_INSTALLED"
```

If PALM_NOT_INSTALLED, run:

```bash
git clone https://github.com/modularmarketing/palm-public.git ~/palm-public && cd ~/palm-public && npm install
```

## Running

Construct the base URL:
- US data center: `https://api.iterable.com`
- EU data center: `https://api.eu.iterable.com`

### Step 1: Fetch workflows and campaigns (fast — gives us filtered counts for time estimate)

Run Steps 1-2 of the pipeline to get the real filtered campaign count. This takes under a minute:

```bash timeout=120000
cd ~/palm-public && node -e "
const { run: runWorkflows } = require('./lib/fetch-workflows');
const { run: runCampaigns } = require('./lib/fetch-campaigns');
const path = require('path');
const fs = require('fs');
(async () => {
  const opts = {
    apiKey: '{API_KEY}',
    baseUrl: '{BASE_URL}',
    outputDir: path.join('output', '{ORG_NAME}'),
    clientName: '{ORG_NAME}'
  };
  fs.mkdirSync(opts.outputDir, { recursive: true });
  const wf = await runWorkflows(opts);
  const camp = await runCampaigns({ ...opts, activeWorkflowsFile: wf.activeWorkflowIdsPath });
  console.log(JSON.stringify({
    workflows: wf.workflowCount,
    blastCampaigns: camp.blastCount,
    triggeredCampaigns: camp.triggeredCount,
    totalEligible: camp.blastCount + camp.triggeredCount
  }));
})().catch(e => { console.error(e.message); process.exit(1); });
"
```

### Step 2: Calculate and share time estimate

From the Step 1 output, use the **filtered** campaign counts (NOT total from API) to estimate:

- **windows** = 13 (90 days ÷ 7 days)
- **blast_batches** = ceil(blastCampaigns / 50)
- **triggered_batches** = ceil(triggeredCampaigns / 50)
- **estimated_minutes** = ceil((13 × (blast_batches + triggered_batches) × 0.8) / 60) + 1

Tell the user in plain language:

> "This should take approximately **{estimated_minutes} minutes**. I'll run it in the background and let you know when it's done — feel free to keep chatting."

### Step 3: Run the full metrics pull

Since Steps 1-2 already ran (workflows and campaigns are saved), the pipeline will detect the existing files and only run Step 3 (metrics). Run in background:

```bash run_in_background=true
cd ~/palm-public && node bin/palm-metrics.js \
  --api-key "{API_KEY}" \
  --base-url "{BASE_URL}" \
  --client-name "{ORG_NAME}" \
  --output-dir "output"
```

While it runs, tell the user you'll let them know when it's done. Do NOT poll, check status, run `ps`, or monitor the process in any way — just wait for the background task notification. When it completes, report the results.

Keep your status updates simple and non-technical. Do NOT show bash commands, process IDs, or system output to the user.

Replace `{API_KEY}`, `{BASE_URL}`, and `{ORG_NAME}` with the user's values. For org name, lowercase it and replace spaces with underscores.

Do NOT pass --start-date or --end-date. The pipeline defaults to the last 90 days.

## Exit Codes

- 0 = success
- 1 = success with warnings (report warnings but continue)
- 2 = fatal error (report error to user)

## After Success

Report workflow count, campaign count, and metric rows. Then ask:

> "Your metrics are ready! Would you like me to generate the dashboard now?"
