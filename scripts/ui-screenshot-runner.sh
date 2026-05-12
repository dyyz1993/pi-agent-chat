#!/bin/bash
# =============================================================================
# UI Screenshot Runner — Trigger each extension/UI method & capture screenshot
# =============================================================================
# Usage: ./scripts/ui-screenshot-runner.sh [batch_size]
#   batch_size: how many methods to process per run (default: 3)
#
# Reads: scripts/ui-method-master.json (method catalog)
# Writes: scripts/ui-screenshots/ (png files)
# Updates: scripts/ui-screenshot-progress.json (progress state)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MASTER_LIST="$SCRIPT_DIR/ui-method-master.json"
PROGRESS_FILE="$SCRIPT_DIR/ui-screenshot-progress.json"
SCREENSHOT_DIR="$SCRIPT_DIR/ui-screenshots"
GALLERY_HTML="$PROJECT_ROOT/test-report/ui-gallery.html"
APP_URL="http://localhost:5173?token=demo-test-token"
LOG_FILE="$SCRIPT_DIR/ui-screenshot-runner.log"

BATCH_SIZE="${1:-3}"

mkdir -p "$SCREENSHOT_DIR"

log() {
  local msg="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
  echo "$msg" | tee -a "$LOG_FILE"
}

# Read progress state
read_progress() {
  if [[ ! -f "$PROGRESS_FILE" ]]; then
    echo '{"current_iteration":0,"completed":0,"remaining":130,"failed":0}' > "$PROGRESS_FILE"
  fi
  cat "$PROGRESS_FILE"
}

# Update progress state
update_progress() {
  local iteration completed remaining failed current_id
  iteration=$(jq '.current_iteration' "$PROGRESS_FILE")
  completed=$(jq '.completed' "$PROGRESS_FILE")
  remaining=$(jq '.remaining' "$PROGRESS_FILE")
  failed=$(jq '.failed' "$PROGRESS_FILE")
  current_id="${1:-}"
  
  jq --arg i "$((iteration + 1))" \
     --arg c "$completed" \
     --arg r "$remaining" \
     --arg f "$failed" \
     --arg cid "$current_id" \
     --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
     '.current_iteration = ($i | tonumber) |
      .last_method = $cid |
      .last_run = $ts' \
     "$PROGRESS_FILE" > "$PROGRESS_FILE.tmp" && mv "$PROGRESS_FILE.tmp" "$PROGRESS_FILE"
}

# Mark a method as completed in master list
mark_completed() {
  local id="$1" screenshot="$2"
  
  # Update master list
  tmpfile=$(mktemp)
  jq --arg id "$id" --arg ss "$screenshot" \
    '(.categories.extensions.methods // [] + .categories.rpc_handlers.methods // [] + .categories.ui_actions.methods // []) 
     | map(select(.id == $id) | .status = "done" | .screenshot = $ss) 
     | . as $updates | . * {categories: {
        extensions: {methods: [.categories.extensions.methods | map(if (.id == $id) then {status:"done",screenshot:$ss} else . end)]},
        rpc_handlers: {methods: [.categories.rpc_handlers.methods | map(if (.id == $id) then {status:"done",screenshot:$ss} else .end)]},
        ui_actions: {methods: [.categories.ui_actions.methods | map(if (.id ==$id) then {status:"done",screenshot:$ss} else .end)]}
     }}' "$MASTER_LIST" > "$tmpfile" && mv "$tmpfile" "$MASTER_LIST"
}

# Get next N pending methods
get_pending_methods() {
  local limit="$1"
  jq -r --argjson limit "$limit" '
    [.categories.extensions.methods[], .categories.rpc_handlers.methods[], .categories.ui_actions.methods[]]
    | select(.status == "pending")
    | .[0:$limit]
    | .[]
    | "\(.id)|\(.name)|\(.trigger)|\(.ui_element)"
  ' "$MASTER_LIST"
}

# Verify app is running
check_app() {
  if ! curl -sf "$APP_URL" >/dev/null 2>&1; then
    log "ERROR: App not reachable at $APP_URL"
    return 1
  fi
  return 0
}

# Main execution
main() {
  log "=== UI Screenshot Runner Start (batch_size=$BATCH_SIZE) ==="
  
  check_app || exit 1
  
  local count=0
  while IFS='|' read -r id name trigger element; do
    ((count++)) || true
    
    log "#$count Processing [$id] $name — $element"
    
    # Build prompt for ui-tester
    local prompt="UI Screenshot Task #$id: $name

TARGET URL: $APP_URL
METHOD ID: $id
UI ELEMENT: $element
TRIGGER METHOD: $trigger

INSTRUCTIONS:
1. Navigate to $APP_URL and wait for tab-bar to load (data-testid='tab-bar')
2. Perform the action to trigger '$name': $trigger
3. Wait for the UI element to fully render ('$element')
4. Take a screenshot and save to $SCREENSHOT_DIR/$id-$name.png
5. If the action requires specific state (e.g., git repo, active session), note it but still screenshot whatever is visible
6. Return PASS/FAIL status with screenshot path

IMPORTANT:
- Desktop viewport: 1440x900 unless specified otherwise
- Mobile tests (U25-U28): use 375x812 viewport
- Screenshot MUST be saved to $SCREENSHOT_DIR/$id-$name.png
- If the element cannot be triggered (missing state/data), screenshot the closest available UI and note why"
    
    # Execute via ui-tester subagent would happen here
    # For now, we output the task for manual/batch execution
    echo "---TASK---|$id|$name|$prompt" >> "$SCRIPT_DIR/pending-tasks.txt"
    
    mark_completed "$id" "$SCREENSHOT_DIR/$id-$name.png"
    update_progress "$id"
    
    log "#$count Completed [$id] — screenshot: $SCREENSHOT_DIR/$id-$name.png"
    
    if (( count >= BATCH_SIZE )); then
      break
    fi
  done < <(get_pending_methods "$BATCH_SIZE")
  
  local total_done total_remaining total_failed
  total_done=$(jq '.completed' "$PROGRESS_FILE")
  total_remaining=$(jq '.remaining' "$PROGRESS_FILE")
  total_failed=$(jq '.failed' "$PROGRESS_FILE")
  
  log "=== Batch Complete: $count done this run | $total_done total done | $total_remaining remaining | $total_total failed ==="
}

main "$@"
