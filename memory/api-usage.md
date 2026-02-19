# API Usage Logging

## Option 1: Manual Logging (Immediate)
When you want to capture current usage, just ask me:
> "Log my API usage"

I'll run `session_status` and save the results here with a timestamp.

## Option 2: Session-based Logging (Automatic)
Every time we have a significant conversation, I'll append a usage summary to this file.

## Option 3: Hourly via Script (Background)
Add this to your crontab (`crontab -e`):
```
0 * * * * cd /home/marc/.openclaw/workspace && /usr/bin/node -e "
const fs = require('fs');
const log = fs.existsSync('memory/api-usage.log') ? fs.readFileSync('memory/api-usage.log') : '';
const entry = '[' + new Date().toISOString() + '] Hourly check-in\n';
fs.appendFileSync('memory/api-usage.log', entry);
" 2>/dev/null
```

## Today's Usage Log

### 2026-02-19 13:47 EST
**Session:** Main (Telegram)
**Model:** ollama/mistral (currently), anthropic/claude-3-opus-latest (tested)
**Tokens:** 15k context used / 262k window
**Notes:** Updated Anthropic models to -latest tags, added Opus. GPT-4o-latest update in progress.

