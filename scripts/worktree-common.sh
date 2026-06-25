#!/bin/bash
# Shared helpers for pi-agent-chat worktree development.

WORKTREE_REGISTRY_ROOT="${PI_WORKTREE_REGISTRY_DIR:-${HOME}/.pi-agent-chat/worktrees/registry}"
DEFAULT_AGENT_SOURCE_ROOT="${PI_MOMO_FORK_ROOT:-/Users/xuyingzhou/Project/temporary/pi-momo-fork}"

wt_now() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

wt_sanitize() {
  printf "%s" "$1" | tr -c 'A-Za-z0-9._-' '_'
}

wt_hash() {
  if command -v shasum >/dev/null 2>&1; then
    printf "%s" "$1" | shasum -a 1 | awk '{ print substr($1, 1, 12) }'
  else
    printf "%s" "$1" | cksum | awk '{ print $1 }'
  fi
}

wt_id_for_path() {
  local path="$1"
  local name
  name=$(basename "$path")
  printf "%s-%s" "$(wt_sanitize "$name")" "$(wt_hash "$path")"
}

wt_registry_file() {
  local id="$1"
  printf "%s/%s.env" "$WORKTREE_REGISTRY_ROOT" "$id"
}

wt_read_value() {
  local file="$1"
  local key="$2"
  [ -f "$file" ] || return 1
  grep -E "^${key}=" "$file" 2>/dev/null | tail -1 | cut -d= -f2-
}

wt_registry_get() {
  local id="$1"
  local key="$2"
  wt_read_value "$(wt_registry_file "$id")" "$key"
}

wt_port_listens() {
  local port="$1"
  lsof -i :"$port" -P 2>/dev/null | grep -q LISTEN
}

wt_port_owned_by_worktree() {
  local port="$1"
  local app_path="$2"
  local pid_file="$app_path/.worktree-dev.pid"
  local child_file="$app_path/.worktree-dev.children"
  local pids pid owned
  pids=$(lsof -nP -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
  [ -n "$pids" ] || return 1
  owned=" $(cat "$pid_file" "$child_file" 2>/dev/null | tr '\n' ' ') "
  for pid in $pids; do
    case "$owned" in
      *" $pid "*) return 0 ;;
    esac
  done
  return 1
}

wt_port_reserved() {
  local port="$1"
  local exclude_id="${2:-}"
  local file id
  [ -d "$WORKTREE_REGISTRY_ROOT" ] || return 1
  for file in "$WORKTREE_REGISTRY_ROOT"/*.env; do
    [ -f "$file" ] || continue
    id=$(basename "$file" .env)
    [ "$id" = "$exclude_id" ] && continue
    if grep -Eq "^(API_PORT|VITE_PORT)=${port}$" "$file"; then
      return 0
    fi
  done
  return 1
}

wt_find_free_port() {
  local start="$1"
  local exclude_id="${2:-}"
  local port="$start"
  while wt_port_listens "$port" || wt_port_reserved "$port" "$exclude_id"; do
    port=$((port + 1))
  done
  echo "$port"
}

wt_main_port() {
  local main_env="$1"
  local port
  port=$(wt_read_value "$main_env" "PORT" || true)
  echo "${port:-3100}"
}

wt_pick_port() {
  local app_path="$1"
  local key="$2"
  local start="$3"
  local preferred="${4:-}"
  local id
  local registered
  id=$(wt_id_for_path "$app_path")
  registered=$(wt_registry_get "$id" "$key" || true)

  if [ -n "$preferred" ] && ! wt_port_reserved "$preferred" "$id"; then
    if ! wt_port_listens "$preferred" || wt_port_owned_by_worktree "$preferred" "$app_path"; then
      echo "$preferred"
      return
    fi
  fi

  if [ -n "$registered" ] && ! wt_port_reserved "$registered" "$id"; then
    if ! wt_port_listens "$registered" || wt_port_owned_by_worktree "$registered" "$app_path"; then
      echo "$registered"
      return
    fi
  fi

  wt_find_free_port "$start" "$id"
}

wt_app_config_dir() {
  local app_path="$1"
  local id
  id=$(wt_id_for_path "$app_path")
  printf "%s/%s" "${HOME}/.pi-agent-chat/worktrees" "$id"
}

wt_write_registry() {
  local app_path="$1"
  local api_port="$2"
  local vite_port="$3"
  local config_dir="$4"
  local agent_source_root="${5:-}"
  local agent_worktree_path="${6:-}"
  local agent_branch="${7:-}"
  local agent_cli_path="${8:-}"
  local id
  id=$(wt_id_for_path "$app_path")

  mkdir -p "$WORKTREE_REGISTRY_ROOT"
  cat > "$(wt_registry_file "$id")" <<EOF
WORKTREE_ID=$id
APP_PATH=$app_path
APP_NAME=$(basename "$app_path")
APP_BRANCH=$(git -C "$app_path" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)
API_PORT=$api_port
VITE_PORT=$vite_port
CONFIG_DIR=$config_dir
AGENT_SOURCE_ROOT=$agent_source_root
AGENT_WORKTREE_PATH=$agent_worktree_path
AGENT_BRANCH=$agent_branch
AGENT_CLI_PATH=$agent_cli_path
UPDATED_AT=$(wt_now)
EOF
}

wt_write_app_env() {
  local main_env="$1"
  local target_env="$2"
  local api_port="$3"
  local agent_cli_path="${4:-}"
  local main_port
  main_port=$(wt_main_port "$main_env")

  grep -v -E '^(#|$|PORT=|PI_CLI_PATH=|PI_APP_CONFIG_DIR=|VITE_API_TARGET=|VITE_PORT=|VITE_STRICT_PORT=)' "$main_env" 2>/dev/null > "${target_env}.tmp"
  echo "" >> "${target_env}.tmp"
  echo "# worktree: generated from $(basename "$(dirname "$main_env")") at $(wt_now)" >> "${target_env}.tmp"
  echo "# worktree: main PORT=${main_port}" >> "${target_env}.tmp"
  echo "PORT=${api_port}" >> "${target_env}.tmp"
  if [ -n "$agent_cli_path" ]; then
    echo "PI_CLI_PATH=${agent_cli_path}" >> "${target_env}.tmp"
  fi
  mv "${target_env}.tmp" "$target_env"
}

wt_seed_app_config() {
  local config_dir="$1"
  local source_dir="${PI_APP_CONFIG_SOURCE_DIR:-${HOME}/.pi-agent-chat}"
  local source_config="$source_dir/config.json"
  local target_config="$config_dir/config.json"

  mkdir -p "$config_dir"
  [ "$source_config" != "$target_config" ] || return 0
  [ -f "$source_config" ] || return 0
  [ -f "$target_config" ] && return 0

  cp "$source_config" "$target_config"
  [ -f "$source_dir/config.json.bak" ] && cp "$source_dir/config.json.bak" "$config_dir/config.json.bak"
}

wt_load_env_file() {
  local env_file="$1"
  [ -f "$env_file" ] || return 0
  set -a
  # shellcheck disable=SC1090
  . "$env_file"
  set +a
}

wt_prepare_app_deps() {
  local worktree_path="$1"
  local source_yalc="$2"
  local source_node_modules="$3"
  local strategy="$4"

  case "$strategy" in
    install)
      [ -d "$source_yalc" ] && cp -R "$source_yalc" "$worktree_path/.yalc"
      (cd "$worktree_path" && bun install)
      ;;
    skip)
      ;;
    link|*)
      [ -d "$source_yalc" ] && ln -sfn "$source_yalc" "$worktree_path/.yalc"
      [ -d "$source_node_modules" ] && ln -sfn "$source_node_modules" "$worktree_path/node_modules"
      cat > "$worktree_path/.worktree-deps.json" <<EOF
{
  "strategy": "symlink",
  "source": "$source_node_modules",
  "createdAt": "$(wt_now)",
  "note": "Remove node_modules and .yalc, then run bun install if this worktree changes package dependencies."
}
EOF
      ;;
  esac
}

wt_default_agent_worktree_path() {
  local app_path="$1"
  local branch="$2"
  local source_root="$3"
  local app_parent app_name source_parent source_name
  app_parent=$(dirname "$app_path")
  app_name=$(basename "$app_path")
  source_parent=$(dirname "$source_root")
  source_name=$(basename "$source_root")

  if [ "$app_name" = "pi-agent-chat" ]; then
    printf "%s/pi-momo-fork" "$app_parent"
  else
    printf "%s/%s-%s" "$source_parent" "$source_name" "$branch"
  fi
}

wt_prepare_agent_deps() {
  local source_root="$1"
  local agent_root="$2"
  local strategy="$3"
  local source_pkg="$source_root/packages/coding-agent"
  local agent_pkg="$agent_root/packages/coding-agent"

  case "$strategy" in
    install)
      (cd "$agent_root" && npm install) >&2
      ;;
    skip)
      ;;
    link|*)
      [ -d "$source_root/node_modules" ] && ln -sfn "$source_root/node_modules" "$agent_root/node_modules"
      [ -d "$source_pkg/node_modules" ] && ln -sfn "$source_pkg/node_modules" "$agent_pkg/node_modules"
      ;;
  esac
}

wt_setup_agent_worktree() {
  local source_root="$1"
  local agent_branch="$2"
  local agent_path="$3"
  local deps_strategy="$4"
  local build_agent="$5"
  local agent_pkg="$agent_path/packages/coding-agent"

  [ -d "$source_root/.git" ] || {
    echo "Agent source is not a git repository: $source_root" >&2
    return 1
  }
  [ -f "$source_root/packages/coding-agent/package.json" ] || {
    echo "Agent source missing packages/coding-agent/package.json: $source_root" >&2
    return 1
  }

  if [ ! -d "$agent_path" ]; then
    mkdir -p "$(dirname "$agent_path")"
    if git -C "$source_root" show-ref --verify --quiet "refs/heads/${agent_branch}"; then
      git -C "$source_root" worktree add "$agent_path" "$agent_branch" >&2
    else
      git -C "$source_root" worktree add -b "$agent_branch" "$agent_path" >&2
    fi
  fi

  wt_prepare_agent_deps "$source_root" "$agent_path" "$deps_strategy"

  if [ "$build_agent" = "true" ]; then
    npm --prefix "$agent_pkg" run build >&2
  fi

  printf "%s/dist/cli.js" "$agent_pkg"
}

wt_stop_existing_dev() {
  local worktree_path="$1"
  local pid_file="$worktree_path/.worktree-dev.pid"
  local child_file="$worktree_path/.worktree-dev.children"
  local pid
  local child
  [ -f "$pid_file" ] || return 0
  pid=$(cat "$pid_file" 2>/dev/null || true)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    sleep 1
  fi
  if [ -f "$child_file" ]; then
    for child in $(cat "$child_file" 2>/dev/null); do
      [ -n "$child" ] && kill "$child" 2>/dev/null || true
    done
  fi
}

wt_start_dev_server() {
  local worktree_path="$1"
  local api_port="$2"
  local vite_port="$3"
  local config_dir="$4"
  local env_file="$worktree_path/.env"
  local vite_bin="$worktree_path/node_modules/.bin/vite"
  local bun_bin

  [ -x "$vite_bin" ] || {
    echo "Missing executable: $vite_bin" >&2
    return 1
  }
  bun_bin=$(command -v bun || true)
  [ -n "$bun_bin" ] || {
    echo "Missing executable: bun" >&2
    return 1
  }

  mkdir -p "$worktree_path/logs" "$config_dir"
  wt_seed_app_config "$config_dir"
  wt_load_env_file "$env_file"

  (
    cd "$worktree_path"
    export PORT="$api_port"
    export PI_APP_CONFIG_DIR="$config_dir"
    export VITE_API_TARGET="http://localhost:${api_port}"
    export VITE_PORT="$vite_port"
    export VITE_STRICT_PORT=false
    export VITE_AUTH_TOKEN="${AUTH_TOKEN:-}"
    export WORKTREE_DEV_LOG="$worktree_path/logs/dev.log"
    export WORKTREE_DEV_CHILDREN="$worktree_path/.worktree-dev.children"
    export WORKTREE_DEV_BUN_BIN="$bun_bin"
    export WORKTREE_DEV_VITE_BIN="$vite_bin"
    nohup bash -c '
      set -m
      : > "$WORKTREE_DEV_LOG"
      "$WORKTREE_DEV_BUN_BIN" --bun src/server.ts >> "$WORKTREE_DEV_LOG" 2>&1 &
      api_pid=$!
      "$WORKTREE_DEV_VITE_BIN" --port "$VITE_PORT" >> "$WORKTREE_DEV_LOG" 2>&1 &
      vite_pid=$!
      echo "$api_pid $vite_pid" > "$WORKTREE_DEV_CHILDREN"
      cleanup() {
        kill "$api_pid" "$vite_pid" 2>/dev/null || true
      }
      trap cleanup INT TERM EXIT
      wait "$api_pid" "$vite_pid"
    ' >/dev/null 2>&1 &
    echo $! > "$worktree_path/.worktree-dev.pid"
  )
}
