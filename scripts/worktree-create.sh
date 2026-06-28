#!/bin/bash
# scripts/worktree-create.sh
# Create an isolated pi-agent-chat worktree, with optional paired pi-momo-fork worktree.

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
  ./scripts/worktree-create.sh <branch> [options]

App options:
  --dev                 Generate .env, allocate ports, and register the worktree.
  --start               Start after setup. Implies --dev.
  --code                Open VS Code after setup.
  --link                Link app .yalc and node_modules from the main repo. Default for --dev.
  --install             Copy app .yalc and run bun install.
  --skip-deps           Do not prepare app dependencies.

Paired coding-agent fork options:
  --with-agent-fork     Create/reuse a paired pi-momo-fork worktree and point PI_CLI_PATH to it.
  --agent-source <dir>  Source pi-momo-fork repo. Default: $DEFAULT_AGENT_SOURCE_ROOT
  --agent-path <dir>    Target paired fork worktree path.
  --agent-branch <name> Branch for paired fork. Default: same as app branch.
  --agent-link          Link agent node_modules from source fork. Default.
  --agent-install       Run npm install in paired fork.
  --agent-skip-deps     Do not prepare agent dependencies.
  --agent-build         Build packages/coding-agent. Default with --with-agent-fork.
  --no-agent-build      Skip agent build.

Examples:
  ./scripts/worktree-create.sh ui-dark --dev --with-agent-fork
  ./scripts/worktree-create.sh ui-dark --dev --start --with-agent-fork --agent-install
EOF
}

find_repo_root() {
  local dir
  dir="$(pwd)"
  while [ "$dir" != "/" ]; do
    [ -e "$dir/.git" ] && echo "$dir" && return 0
    dir=$(dirname "$dir")
  done
  return 1
}

if command -v git >/dev/null 2>&1 && git rev-parse --git-dir >/dev/null 2>&1; then
  REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
else
  REPO_ROOT=$(find_repo_root) || err "Not inside a git repository"
fi

REPO_NAME=$(basename "$REPO_ROOT")
PARENT_DIR=$(dirname "$REPO_ROOT")
WORKTREE_BASE="${PARENT_DIR}/${REPO_NAME}"

BRANCH=""
OPEN_CODE=false
APP_DEPS_STRATEGY=""
SETUP_DEV=false
START_NOW=false
WITH_AGENT_FORK=false
AGENT_SOURCE_ROOT="$DEFAULT_AGENT_SOURCE_ROOT"
AGENT_PATH=""
AGENT_BRANCH=""
AGENT_DEPS_STRATEGY="link"
AGENT_BUILD=""

while [ $# -gt 0 ]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --code) OPEN_CODE=true; shift ;;
    --link) APP_DEPS_STRATEGY="link"; shift ;;
    --install) APP_DEPS_STRATEGY="install"; shift ;;
    --skip-deps) APP_DEPS_STRATEGY="skip"; shift ;;
    --dev) SETUP_DEV=true; [ -z "$APP_DEPS_STRATEGY" ] && APP_DEPS_STRATEGY="link"; shift ;;
    --start) START_NOW=true; SETUP_DEV=true; [ -z "$APP_DEPS_STRATEGY" ] && APP_DEPS_STRATEGY="link"; shift ;;
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
    --*|-) err "Unknown option: $1" ;;
    *)
      if [ -z "$BRANCH" ]; then
        BRANCH="$1"
      else
        err "Unknown argument: $1"
      fi
      shift
      ;;
  esac
done

[ -n "$BRANCH" ] || { usage; exit 1; }
[ -n "$APP_DEPS_STRATEGY" ] || APP_DEPS_STRATEGY="prompt"
[ -n "$AGENT_BRANCH" ] || AGENT_BRANCH="$BRANCH"
[ -n "$AGENT_BUILD" ] || { [ "$WITH_AGENT_FORK" = true ] && AGENT_BUILD="true" || AGENT_BUILD="false"; }

WORKTREE_SLUG=$(wt_sanitize "$BRANCH")
WORKTREE_PATH="${WORKTREE_BASE}-${WORKTREE_SLUG}"
MAIN_YALC="$REPO_ROOT/.yalc"
MAIN_NM="$REPO_ROOT/node_modules"
MAIN_ENV="$REPO_ROOT/.env"

[ -f "$MAIN_ENV" ] || err "Main repo missing .env: $MAIN_ENV"
[ -d "$MAIN_NM" ] || warn "Main repo missing node_modules. --link will not work until dependencies exist."
[ -d "$MAIN_YALC" ] || warn "Main repo missing .yalc. Local packages may not be available."
[ ! -d "$WORKTREE_PATH" ] || err "Path already exists: $WORKTREE_PATH"

header "Create App Worktree"
echo "  path:   ${CYAN}${WORKTREE_PATH}${NC}"
echo "  branch: ${CYAN}${BRANCH}${NC}"
git worktree add -b "$BRANCH" "$WORKTREE_PATH" 2>&1 | sed 's/^/  /'
ok "App worktree created"

cd "$WORKTREE_PATH"

if [ "$APP_DEPS_STRATEGY" = "prompt" ]; then
  header "App Dependencies"
  echo "  [L] Link .yalc and node_modules from main repo (fast, shared deps)"
  echo "  [I] Copy .yalc and run bun install (more isolated)"
  echo "  [S] Skip dependency setup"
  prompt "  Choice [L/i/s]: " APP_CHOICE
  case "$(echo "${APP_CHOICE:-L}" | tr '[:upper:]' '[:lower:]')" in
    i) APP_DEPS_STRATEGY="install" ;;
    s) APP_DEPS_STRATEGY="skip" ;;
    *) APP_DEPS_STRATEGY="link" ;;
  esac
fi

header "App Dependencies"
wt_prepare_app_deps "$WORKTREE_PATH" "$MAIN_YALC" "$MAIN_NM" "$APP_DEPS_STRATEGY"
ok "App dependency strategy: $APP_DEPS_STRATEGY"

AGENT_CLI_PATH=""
if [ "$WITH_AGENT_FORK" = true ]; then
  header "Paired Agent Fork"
  AGENT_SOURCE_ROOT=$(cd "$AGENT_SOURCE_ROOT" && pwd)
  [ -n "$AGENT_PATH" ] || AGENT_PATH=$(wt_default_agent_worktree_path "$WORKTREE_PATH" "$BRANCH" "$AGENT_SOURCE_ROOT")

  if [ -n "$(git -C "$AGENT_SOURCE_ROOT" status --porcelain 2>/dev/null)" ]; then
    warn "Agent source has uncommitted changes. The paired worktree is created from git commits, not dirty files."
  fi

  echo "  source: ${CYAN}${AGENT_SOURCE_ROOT}${NC}"
  echo "  path:   ${CYAN}${AGENT_PATH}${NC}"
  echo "  branch: ${CYAN}${AGENT_BRANCH}${NC}"
  echo "  deps:   ${CYAN}${AGENT_DEPS_STRATEGY}${NC}"
  echo "  build:  ${CYAN}${AGENT_BUILD}${NC}"
  AGENT_CLI_PATH=$(wt_setup_agent_worktree "$AGENT_SOURCE_ROOT" "$AGENT_BRANCH" "$AGENT_PATH" "$AGENT_DEPS_STRATEGY" "$AGENT_BUILD")
  ok "PI_CLI_PATH will use $AGENT_CLI_PATH"
fi

API_PORT=""
VITE_PORT=""
CONFIG_DIR=""
AGENT_DIR=""
if [ "$SETUP_DEV" = true ]; then
  header "Ports And Env"
  MAIN_PORT=$(wt_main_port "$MAIN_ENV")
  API_PORT=$(wt_pick_port "$WORKTREE_PATH" "API_PORT" "$((MAIN_PORT + 1))")
  VITE_PORT=$(wt_pick_port "$WORKTREE_PATH" "VITE_PORT" 5174)
  CONFIG_DIR=$(wt_app_config_dir "$WORKTREE_PATH")
  AGENT_DIR="$CONFIG_DIR/agent"

  wt_write_app_env "$MAIN_ENV" "$WORKTREE_PATH/.env" "$API_PORT" "$AGENT_CLI_PATH" "$AGENT_DIR"
  wt_write_registry "$WORKTREE_PATH" "$API_PORT" "$VITE_PORT" "$CONFIG_DIR" "$AGENT_SOURCE_ROOT" "$AGENT_PATH" "$AGENT_BRANCH" "$AGENT_CLI_PATH" "$AGENT_DIR"

  echo "  API:        ${YELLOW}${MAIN_PORT}${NC} -> ${GREEN}${API_PORT}${NC}"
  echo "  Vite:       ${YELLOW}5173${NC} -> ${GREEN}${VITE_PORT}${NC}"
  echo "  config dir: ${CYAN}${CONFIG_DIR}${NC}"
  echo "  agent dir:  ${CYAN}${AGENT_DIR}${NC}"
  [ -n "$AGENT_CLI_PATH" ] && echo "  agent cli:  ${CYAN}${AGENT_CLI_PATH}${NC}"
  ok ".env and registry are ready"
fi

if [ "$START_NOW" = true ]; then
  header "Start"
  wt_stop_existing_dev "$WORKTREE_PATH"
  wt_start_dev_server "$WORKTREE_PATH" "$API_PORT" "$VITE_PORT" "$CONFIG_DIR" "$AGENT_DIR"
  sleep 3
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
    ok "Started dev server"
    info "Vite: http://localhost:${VITE_PORT}/"
    info "API:  http://localhost:${API_PORT}"
  elif [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    ok "Started dev server (PID $PID)"
    warn "Server is running, but health checks did not respond yet"
  else
    warn "Startup may have failed. Last log lines:"
    tail -40 "$WORKTREE_PATH/logs/dev.log" 2>/dev/null || true
  fi
fi

header "Done"
echo "  app:      ${CYAN}${WORKTREE_PATH}${NC}"
echo "  branch:   ${CYAN}${BRANCH}${NC}"
echo "  deps:     ${CYAN}${APP_DEPS_STRATEGY}${NC}"
[ -n "$AGENT_PATH" ] && echo "  agent:    ${CYAN}${AGENT_PATH}${NC}"
[ -n "$API_PORT" ] && echo "  API:      ${CYAN}http://localhost:${API_PORT}${NC}"
[ -n "$VITE_PORT" ] && echo "  Vite:     ${CYAN}http://localhost:${VITE_PORT}/${NC}"
echo ""
info "Start later with: $SCRIPT_DIR/worktree-dev.sh $WORKTREE_PATH"

if [ "$OPEN_CODE" = true ]; then
  code "$WORKTREE_PATH" 2>/dev/null || warn "code command is not available"
fi

ok "Ready"
