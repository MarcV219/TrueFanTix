#!/bin/bash
# Log API usage to memory/api-usage.log

LOGFILE="/home/marc/.openclaw/workspace/memory/api-usage.log"
DATE=$(date '+%Y-%m-%d %H:%M:%S')

# Get current status via openclaw CLI (if available) or note the session
# This is a placeholder - actual implementation would parse session data

echo "[$DATE] API usage snapshot" >> "$LOGFILE"
echo "[$DATE] Note: Run 'openclaw status' or check session for current usage" >> "$LOGFILE"
echo "---" >> "$LOGFILE"
