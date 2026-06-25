#!/bin/bash
# scripts/worktree-dev.sh
# Start an existing pi-agent-chat worktree with isolated ports/config and optional paired agent fork.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { printf "${CYAN}i${NC}  %s\n" "$1"; }
ok()    { printf "${GREEN}OK${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}!!${NC} %s\n" "$1"; }
err()   { printf "${RED}XX${NC} %s\n" "$1"; exit 1; }
header(){ printf "\n${BOLD}== %s ==${NC}\n" "$1"; }

prompt() {
  local msg="$1"
  local var_name="$2"
  if [ -t 0 ]; then
    read -r -p "$msg" "$var_name"
  else
    read -r "$var_name"
  fi
}

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=scripts/worktree-common.sh
. "$SCRIPT_DIR/worktree-common.sh"

usage() {
  cat <<EOF
Usage:
  ./scripts/worktree-dev.sh [worktree-path|branch|list] [options]

Options:
  --link                Link app .yalc and node_modules from the main repo if missing. Default.
  --install             Copy app .yalc and run bun install if missing.
  --skip-deps           Do not prepare app dependencies.
  --with-agent-fork     Create/reuse paired pi-momo-fork worktree and point PI_CLI_PATH to it.
  --agent-source <dir>  Source pi-momo-fork repo. Default: $DEFAULT_AGENT_SOURCE_ROOT
  --agent-path <dir>    Target paired fork worktree path.
  --agent-branch <name> Branch for paired fork. Default: app branch or worktree name.
  --agent-link          Link agent node_modules from source fork. Default.
  --agent-install       Run npm install in paired fork.
  --agent-skip-deps     Do not prepare agent dependencies.
  --agent-build         Build packages/coding-agent.
  --no-agent-build      Skip agent build. Default unless --with-agent-fork needs a missing dist.
  --no-start            Prepare env/registry only.

Registry:
  Ports and config dirs are tracked under:
    $WORKTREE_REGISTRY_ROOT
EOF
}

find_main_repo() {
  if command -v git >/dev/null 2>&1; then
    local line
    line=$(git worktree list 2>/dev/null | head -1)
    [ -n "$line" ] && echo "$line" | awk '{ print $1 }' && return 0
  fi

  local dir
  dir="$(pwd)"
  while [ "$dir" != "/" ]; do
    if [ -d "$dir/.git" ]; then
      echo "$dir"
      return 0
    fi
    dir=$(dirname "$dir")
  done
  return 1
}

REPO_ROOT=$(find_main_repo) || err "Cannot locate main repository"
REPO_NAME=$(basename "$REPO_ROOT")
PARENT_DIR=$(dirname "$REPO_ROOT")

ACTION=""
APP_DEPS_STRATEGY="link"
WITH_AGENT_FORK=false
AGENT_SOURCE_ROOT="$DEFAULT_AGENT_SOURCE_ROOT"
AGENT_PATH=""
AGENT_BRANCH=""
AGENT_DEPS_STRATEGY="link"
AGENT_BUILD=""
START_SERVER=true

while [ $# -gt 0 ]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --link) APP_DEPS_STRATEGY="link"; shift ;;
    --install) APP_DEPS_STRATEGY="install"; shift ;;
    --skip-deps) APP_DEPS_STRATEGY="skip"; shift ;;
    --with-agent-fork) WITH_AGENT_FORK=true; shift ;;
    --agent-source) AGENT_SOURCE_ROOT="$2"; shift 2 ;;
    --agent-source=*) AGENT_SOURCE_ROOT="${1#*=}"; shift ;;
    --agent-path) AGENT_PATH="$2"; shift 2 ;;
    --agent-path=*) AGENT_PATH="${1#*=}"; shift ;;
    --agent-branch) AGENT_BRANCH="$2"; shift 2 ;;
    --agent-branch=*) AGENT_BRANCH="${1#*=}"; shift ;;
    --agent-link) AGENT_DEPS_STRATEGY="link"; shift ;;
    --agent-install) AGENT_DEPS_STRATEGY="install"; shift ;;
    --agent-skip-deps) AGENT_DEPS_STRATEGY="skip"; shift ;;
    --agent-build) AGENT_BUILD="true"; shift ;;
    --no-agent-build) AGENT_BUILD="false"; shift ;;
    --no-start) START_SERVER=false; shift ;;
    --*|-) err "Unknown option: $1" ;;
    *)
      if [ -z "$ACTION" ]; then
        ACTION="$1"
      else
        err "Unknown argument: $1"
      fi
      shift
      ;;
  esac
done

if [ "$ACTION" = "list" ]; then
  header "Git Worktrees"
  git -C "$REPO_ROOT" worktree list
  header "Registered Dev Worktrees"
  if [ -d "$WORKTREE_REGISTRY_ROOT" ]; then
    for file in "$WORKTREE_REGISTRY_ROOT"/*.env; do
      [ -f "$file" ] || continue
      app=$(wt_read_value "$file" "APP_PATH" || true)
      api=$(wt_read_value "$file" "API_PORT" || true)
      vite=$(wt_read_value "$file" "VITE_PORT" || true)
      agent=$(wt_read_value "$file" "AGENT_WORKTREE_PATH" || true)
      echo "  $(basename "$file" .env)"
      echo "    app:   $app"
      echo "    ports: api=$api vite=$vite"
      [ -n "$agent" ] && echo "    agent: $agent"
    done
  else
    echo "  (none)"
  fi
  exit 0
fi

if [ -n "$ACTION" ] && [ -d "$ACTION" ]; then
  WORKTREE_PATH=$(cd "$ACTION" && pwd)
elif [ -n "$ACTION" ] && [ -d "${PARENT_DIR}/${REPO_NAME}-${ACTION}" ]; then
  WORKTREE_PATH=$(cd "${PARENT_DIR}/${REPO_NAME}-${ACTION}" && pwd)
else
  header "Select Worktree"
  WORKTREES=()
  while IFS= read -r line; do
    path=$(echo "$line" | awk '{ print $1 }')
    if [ "$(cd "$path" 2>/dev/null && pwd)" != "$REPO_ROOT" ]; then
      branch=$(git -C "$path" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)
      WORKTREES+=("$path|$branch")
    fi
  done < <(git -C "$REPO_ROOT" worktree list 2>/dev/null)

  [ ${#WORKTREES[@]} -gt 0 ] || err "No worktrees found. Create one with scripts/worktree-create.sh"

  for i in "${!WORKTREES[@]}"; do
    IFS='|' read -r wt_path wt_branch <<< "${WORKTREES[$i]}"
    echo "  $((i + 1))) ${CYAN}$(basename "$wt_path")${NC} (${wt_branch})"
  done
  prompt "  Select [1-${#WORKTREES[@]}]: " CHOICE
  if ! [[ "$CHOICE" =~ ^[0-9]+$ ]] || [ "$CHOICE" -lt 1 ] || [ "$CHOICE" -gt "${#WORKTREES[@]}" ]; then
    err "Invalid selection"
  fi
  IFS='|' read -r WORKTREE_PATH _ <<< "${WORKTREES[$((CHOICE - 1))]}"
fi

[ -d "$WORKTREE_PATH" ] || err "Directory does not exist: $WORKTREE_PATH"
cd "$WORKTREE_PATH"

WORKTREE_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)
WORKTREE_NAME=$(basename "$WORKTREE_PATH")
WORKTREE_ID=$(wt_id_for_path "$WORKTREE_PATH")
REGISTRY_FILE=$(wt_registry_file "$WORKTREE_ID")
MAIN_ENV="$REPO_ROOT/.env"
MAIN_YALC="$REPO_ROOT/.yalc"
MAIN_NM="$REPO_ROOT/node_modules"

[ -f "$MAIN_ENV" ] || err "Main repo missing .env: $MAIN_ENV"

header "Prepare $WORKTREE_NAME ($WORKTREE_BRANCH)"

if [ "$START_SERVER" = true ]; then
  wt_stop_existing_dev "$WORKTREE_PATH"
fi

if [ ! -d "node_modules" ] || [ "$(ls -A node_modules 2>/dev/null | wc -l)" -eq 0 ]; then
  header "App Dependencies"
  wt_prepare_app_deps "$WORKTREE_PATH" "$MAIN_YALC" "$MAIN_NM" "$APP_DEPS_STRATEGY"
  ok "App dependency strategy: $APP_DEPS_STRATEGY"
fi

AGENT_CLI_PATH=$(wt_read_value "$WORKTREE_PATH/.env" "PI_CLI_PATH" || true)
REGISTERED_AGENT_PATH=$(wt_registry_get "$WORKTREE_ID" "AGENT_WORKTREE_PATH" || true)
REGISTERED_AGENT_CLI=$(wt_registry_get "$WORKTREE_ID" "AGENT_CLI_PATH" || true)
[ -z "$AGENT_CLI_PATH" ] && AGENT_CLI_PATH="$REGISTERED_AGENT_CLI"

if [ "$WITH_AGENT_FORK" = true ]; then
  header "Paired Agent Fork"
  AGENT_SOURCE_ROOT=$(cd "$AGENT_SOURCE_ROOT" && pwd)
  if [ -z "$AGENT_BRANCH" ]; then
    if [ "$WORKTREE_BRANCH" = "HEAD" ] || [ "$WORKTREE_BRANCH" = "unknown" ]; then
      AGENT_BRANCH="$WORKTREE_NAME"
    else
      AGENT_BRANCH="$WORKTREE_BRANCH"
    fi
  fi
  [ -n "$AGENT_PATH" ] || AGENT_PATH="${REGISTERED_AGENT_PATH:-$(wt_default_agent_worktree_path "$WORKTREE_PATH" "$AGENT_BRANCH" "$AGENT_SOURCE_ROOT")}"
  [ -n "$AGENT_BUILD" ] || AGENT_BUILD="true"

  if [ -n "$(git -C "$AGENT_SOURCE_ROOT" status --porcelain 2>/dev/null)" ]; then
    warn "Agent source has uncommitted changes. The paired worktree uses committed git content."
  fi

  echo "  source: ${CYAN}${AGENT_SOURCE_ROOT}${NC}"
  echo "  path:   ${CYAN}${AGENT_PATH}${NC}"
  echo "  branch: ${CYAN}${AGENT_BRANCH}${NC}"
  AGENT_CLI_PATH=$(wt_setup_agent_worktree "$AGENT_SOURCE_ROOT" "$AGENT_BRANCH" "$AGENT_PATH" "$AGENT_DEPS_STRATEGY" "$AGENT_BUILD")
  ok "PI_CLI_PATH: $AGENT_CLI_PATH"
else
  AGENT_PATH="$REGISTERED_AGENT_PATH"
  AGENT_SOURCE_ROOT=$(wt_registry_get "$WORKTREE_ID" "AGENT_SOURCE_ROOT" || true)
  AGENT_BRANCH=$(wt_registry_get "$WORKTREE_ID" "AGENT_BRANCH" || true)
fi

MAIN_PORT=$(wt_main_port "$MAIN_ENV")
ENV_API_PORT=$(wt_read_value "$WORKTREE_PATH/.env" "PORT" || true)
if [ "$ENV_API_PORT" = "$MAIN_PORT" ]; then
  ENV_API_PORT=""
fi
API_PORT=$(wt_pick_port "$WORKTREE_PATH" "API_PORT" "$((MAIN_PORT + 1))" "$ENV_API_PORT")
VITE_PORT=$(wt_pick_port "$WORKTREE_PATH" "VITE_PORT" 5174)
CONFIG_DIR=$(wt_registry_get "$WORKTREE_ID" "CONFIG_DIR" || true)
[ -n "$CONFIG_DIR" ] || CONFIG_DIR=$(wt_app_config_dir "$WORKTREE_PATH")
AGENT_DIR="$CONFIG_DIR/agent"

wt_write_app_env "$MAIN_ENV" "$WORKTREE_PATH/.env" "$API_PORT" "$AGENT_CLI_PATH" "$AGENT_DIR"
wt_write_registry "$WORKTREE_PATH" "$API_PORT" "$VITE_PORT" "$CONFIG_DIR" "$AGENT_SOURCE_ROOT" "$AGENT_PATH" "$AGENT_BRANCH" "$AGENT_CLI_PATH" "$AGENT_DIR"

header "Ports"
echo "  API:        ${CYAN}http://localhost:${API_PORT}${NC}"
echo "  Vite:       ${CYAN}http://localhost:${VITE_PORT}/${NC}"
echo "  Health:     ${CYAN}http://localhost:${API_PORT}/health${NC}"
echo "  Config dir: ${CYAN}${CONFIG_DIR}${NC}"
echo "  Agent dir:  ${CYAN}${AGENT_DIR}${NC}"
[ -n "$AGENT_CLI_PATH" ] && echo "  Agent CLI:  ${CYAN}${AGENT_CLI_PATH}${NC}"

if [ "$START_SERVER" = false ]; then
  ok "Prepared env and registry without starting"
  exit 0
fi

header "Start"
wt_start_dev_server "$WORKTREE_PATH" "$API_PORT" "$VITE_PORT" "$CONFIG_DIR" "$AGENT_DIR"
sleep 4

PID=$(cat "$WORKTREE_PATH/.worktree-dev.pid" 2>/dev/null || true)
API_READY=false
VITE_READY=false
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [ "$API_READY" = true ] || curl -sS "http://localhost:${API_PORT}/health" >/dev/null 2>&1 && API_READY=true
  [ "$VITE_READY" = true ] || curl -sS -I "http://localhost:${VITE_PORT}/" >/dev/null 2>&1 && VITE_READY=true
  [ "$API_READY" = true ] && [ "$VITE_READY" = true ] && break
  sleep 1
done

if [ "$API_READY" = true ] && [ "$VITE_READY" = true ]; then
  if [ -n "$PID" ]; then
    ok "Started dev server (PID $PID)"
  else
    ok "Started dev server"
  fi
  ok "Health checks passed"
elif [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
  ok "Started dev server (PID $PID)"
  warn "Server is running, but health checks did not respond yet"
else
  warn "Startup may have failed. Last log lines:"
  tail -60 "$WORKTREE_PATH/logs/dev.log" 2>/dev/null || true
  exit 0
fi

if [ -f "$WORKTREE_PATH/.worktree-dev.labels" ]; then
  STOP_HINT="xargs -n1 launchctl remove < ${WORKTREE_PATH}/.worktree-dev.labels"
else
  STOP_HINT="kill \$(cat ${WORKTREE_PATH}/.worktree-dev.pid)"
fi

if [ "$API_READY" = true ] || [ "$VITE_READY" = true ] || { [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; }; then
  echo ""
  echo "  Vite: ${CYAN}http://localhost:${VITE_PORT}/${NC}"
  echo "  API:  ${CYAN}http://localhost:${API_PORT}${NC}"
  echo "  Log:  ${WORKTREE_PATH}/logs/dev.log"
  echo ""
  info "Stop: $STOP_HINT"
fi
