#!/bin/bash
# Permission hook script for Claude Code Chat
# This script intercepts tool usage and requests approval from the web UI

# Debug log
echo "[permission-hook] Script called at $(date)" >> /tmp/permission-hook.log

# Read JSON input from stdin
INPUT=$(cat)
echo "[permission-hook] Input: $INPUT" >> /tmp/permission-hook.log

# Server URL - default to localhost:3000
SERVER_URL="${CLAUDE_CHAT_SERVER:-http://localhost:3000}"

# Send permission request to server and wait for response (long-polling)
# Timeout after 5 minutes (300 seconds)
RESPONSE=$(curl -s -X POST \
  -H "Content-Type: application/json" \
  -d "$INPUT" \
  --max-time 300 \
  "${SERVER_URL}/api/permission-request")

CURL_EXIT=$?
echo "[permission-hook] Curl exit code: $CURL_EXIT" >> /tmp/permission-hook.log
echo "[permission-hook] Response: $RESPONSE" >> /tmp/permission-hook.log

# Check if curl succeeded
if [ $CURL_EXIT -ne 0 ]; then
  # Block the tool use if we can't reach the server
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Failed to connect to permission server"}}'
  exit 0
fi

# Output the response (should be the decision JSON)
echo "$RESPONSE"
exit 0
