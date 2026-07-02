#!/bin/bash
# Shared helpers for pi-agent-chat worktree development.
#
# IMPORTANT: The worktree root directory (~/.pi/worktrees by default) should be
# excluded from CleanMyMac, Time Machine, and similar cleanup tools to prevent
# active worktrees from being deleted. Run:
#   tmutil addexclusion ~/.pi/worktrees/   # Time Machine
# And add ~/.pi/worktrees/ to CleanMyMac > Settings > Exclusions.

PI_HOME="${PI_HOME:-${HOME}/.pi}"
PI_CHAT_HOME="${PI_CHAT_HOME:-${PI_HOME}/chat}"
PI_WORKTREE_STATE_DIR="${PI_WORKTREE_STATE_DIR:-${PI_CHAT_HOME}/worktrees}"
WORKTREE_REGISTRY_ROOT="${PI_WORKTREE_REGISTRY_DIR:-${PI_WORKTREE_STATE_DIR}/registry}"
DEFAULT_AGENT_SOURCE_ROOT="${PI_MOMO_FORK_ROOT:-/Users/xuyingzhou/Project/temporary/pi-momo-fork}"
PI_WORKTREE_ROOT="${PI_WORKTREE_ROOT:-${HOME}/.pi/worktrees}"

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
  printf "%s/%s" "$PI_WORKTREE_STATE_DIR" "$id"
}

wt_write_stack_manifest() {
  local app_path="$1"
  local api_port="$2"
  local vite_port="$3"
  local config_dir="$4"
  local agent_source_root="${5:-}"
  local agent_worktree_path="${6:-}"
  local agent_branch="${7:-}"
  local agent_cli_path="${8:-}"
  local agent_dir="${9:-}"
  local id app_name app_branch app_repo_root manifest_path
  id=$(wt_id_for_path "$app_path")
  app_name=$(basename "$app_path")
  app_branch=$(git -C "$app_path" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)
  app_repo_root=$(git -C "$app_path" rev-parse --show-toplevel 2>/dev/null || echo "$app_path")
  manifest_path="$config_dir/manifest.json"

  mkdir -p "$config_dir"
  node - "$manifest_path" "$id" "$app_name" "$app_path" "$app_repo_root" "$app_branch" "$api_port" "$vite_port" "$config_dir" "$agent_dir" "$agent_source_root" "$agent_worktree_path" "$agent_branch" "$agent_cli_path" <<'NODE'
const fs = require("fs");
const path = require("path");

const [
  manifestPath,
  id,
  appName,
  appPath,
  appRepoRoot,
  appBranch,
  apiPort,
  vitePort,
  configDir,
  agentDir,
  agentSourceRoot,
  agentWorktreePath,
  agentBranch,
  agentCliPath,
] = process.argv.slice(2);

const now = new Date().toISOString();
const repos = [
  {
    name: appName,
    role: "app",
    repoPath: appRepoRoot,
    worktreePath: appPath,
    branch: appBranch,
  },
];

if (agentWorktreePath) {
  repos.push({
    name: path.basename(agentWorktreePath),
    role: "runtime-fork",
    repoPath: agentSourceRoot || agentWorktreePath,
    worktreePath: agentWorktreePath,
    branch: agentBranch || "",
  });
}

const services = [
  {
    name: `${appName}-api`,
    role: "api",
    cwd: appPath,
    command: "bun --bun src/server.ts",
    port: Number(apiPort),
    healthUrl: `http://localhost:${apiPort}/health`,
  },
  {
    name: `${appName}-vite`,
    role: "web",
    cwd: appPath,
    command: "vite",
    port: Number(vitePort),
    healthUrl: `http://localhost:${vitePort}/`,
  },
];

const manifest = {
  version: 1,
  id,
  kind: "paired-worktree-stack",
  name: appName,
  createdAt: now,
  updatedAt: now,
  repos,
  services,
  appConfigDir: configDir,
  agentDir,
  runtime: {
    piCliPath: agentCliPath || "",
  },
  orchestration: {
    leaderSessionId: null,
    batches: [],
    issues: [],
    workers: [],
    cleanup: {
      removeWorktrees: false,
      removeRegistry: false,
    },
  },
};

try {
  const existing = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.createdAt = existing.createdAt || manifest.createdAt;
  manifest.orchestration = existing.orchestration || manifest.orchestration;
} catch {}

fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
NODE
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
  local agent_dir="${9:-}"
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
AGENT_DIR=$agent_dir
AGENT_SOURCE_ROOT=$agent_source_root
AGENT_WORKTREE_PATH=$agent_worktree_path
AGENT_BRANCH=$agent_branch
AGENT_CLI_PATH=$agent_cli_path
UPDATED_AT=$(wt_now)
EOF
  wt_write_stack_manifest "$app_path" "$api_port" "$vite_port" "$config_dir" "$agent_source_root" "$agent_worktree_path" "$agent_branch" "$agent_cli_path" "$agent_dir"
}

wt_write_app_env() {
  local main_env="$1"
  local target_env="$2"
  local api_port="$3"
  local agent_cli_path="${4:-}"
  local agent_dir="${5:-}"
  local main_port
  main_port=$(wt_main_port "$main_env")

  grep -v -E '^(#|$|PORT=|PI_CLI_PATH=|PI_CODING_AGENT_DIR=|PI_APP_CONFIG_DIR=|VITE_API_TARGET=|VITE_PORT=|VITE_STRICT_PORT=)' "$main_env" 2>/dev/null > "${target_env}.tmp"
  echo "" >> "${target_env}.tmp"
  echo "# worktree: generated from $(basename "$(dirname "$main_env")") at $(wt_now)" >> "${target_env}.tmp"
  echo "# worktree: main PORT=${main_port}" >> "${target_env}.tmp"
  echo "PORT=${api_port}" >> "${target_env}.tmp"
  if [ -n "$agent_cli_path" ]; then
    echo "PI_CLI_PATH=${agent_cli_path}" >> "${target_env}.tmp"
  fi
  if [ -n "$agent_dir" ]; then
    echo "PI_CODING_AGENT_DIR=${agent_dir}" >> "${target_env}.tmp"
  fi
  mv "${target_env}.tmp" "$target_env"
}

wt_seed_app_config() {
  local config_dir="$1"
  local worktree_path="$2"
  local source_dir="${PI_APP_CONFIG_SOURCE_DIR:-${PI_CHAT_HOME}}"
  local source_config="$source_dir/config.json"
  local target_config="$config_dir/config.json"
  local marker="$config_dir/.worktree-config-prepared"

  mkdir -p "$config_dir"
  if [ "$source_config" != "$target_config" ] && [ -f "$source_config" ] && [ ! -f "$target_config" ]; then
    cp "$source_config" "$target_config"
    [ -f "$source_dir/config.json.bak" ] && cp "$source_dir/config.json.bak" "$config_dir/config.json.bak"
  fi

  [ -f "$marker" ] && return 0

  node - "$target_config" "$worktree_path" <<'NODE'
const fs = require("fs");
const path = require("path");

const [configPath, worktreePath] = process.argv.slice(2);
let config = {};
try {
  config = JSON.parse(fs.readFileSync(configPath, "utf8"));
} catch {
  config = {};
}

const now = Date.now();
const name = path.basename(worktreePath);
config.recentProjects = [
  {
    path: worktreePath,
    name,
    lastOpened: now,
    pinned: false,
    sessionCount: 0,
  },
];
config.activeProject = worktreePath;
config.openTabs = [];
config.activeTabId = null;
config.pinnedSessionIds = [];
config.configuredPaths = [];
config.favoriteFolders = [];

fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
NODE
  echo "prepared_at=$(wt_now)" > "$marker"
  echo "worktree_path=$worktree_path" >> "$marker"
}

wt_prepare_agent_runtime_dir() {
  local config_dir="$1"
  local agent_dir="$2"
  local source_dir="${PI_CODING_AGENT_SOURCE_DIR:-${HOME}/.pi/agent}"
  local item

  mkdir -p "$agent_dir"

  for item in auth.json oauth.json models.json; do
    if [ -e "$source_dir/$item" ] && [ ! -e "$agent_dir/$item" ]; then
      ln -s "$source_dir/$item" "$agent_dir/$item"
    fi
  done

  for item in settings.json keybindings.json; do
    if [ -f "$source_dir/$item" ] && [ ! -e "$agent_dir/$item" ]; then
      cp "$source_dir/$item" "$agent_dir/$item"
    fi
  done

  for item in skills agents rules prompts themes tools bin; do
    if [ -e "$source_dir/$item" ] && [ ! -e "$agent_dir/$item" ]; then
      ln -s "$source_dir/$item" "$agent_dir/$item"
    fi
  done

  mkdir -p "$config_dir"
  cat > "$config_dir/agent-runtime.env" <<EOF
PI_CODING_AGENT_DIR=$agent_dir
SOURCE_AGENT_DIR=$source_dir
UPDATED_AT=$(wt_now)
EOF
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
  local source_name branch_slug
  source_name=$(basename "$source_root")
  branch_slug=$(wt_sanitize "$branch")

  printf "%s/%s-%s" "$PI_WORKTREE_ROOT" "$source_name" "$branch_slug"
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
  local label_file="$worktree_path/.worktree-dev.labels"
  local pid
  local child
  local label
  if [ -f "$label_file" ]; then
    while IFS= read -r label; do
      [ -n "$label" ] && launchctl remove "$label" 2>/dev/null || true
    done < "$label_file"
  fi
  if [ -f "$pid_file" ]; then
    pid=$(cat "$pid_file" 2>/dev/null || true)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      sleep 1
    fi
  fi
  if [ -f "$child_file" ]; then
    for child in $(cat "$child_file" 2>/dev/null); do
      [ -n "$child" ] && kill "$child" 2>/dev/null || true
    done
  fi
  rm -f "$pid_file" "$child_file" "$label_file"
}

wt_start_dev_server() {
  local worktree_path="$1"
  local api_port="$2"
  local vite_port="$3"
  local config_dir="$4"
  local agent_dir="$5"
  local env_file="$worktree_path/.env"
  local vite_bin="$worktree_path/node_modules/.bin/vite"
  local bun_bin
  local node_bin
  local inherited_path
  local api_script="$worktree_path/.worktree-dev.api.sh"
  local vite_script="$worktree_path/.worktree-dev.vite.sh"
  local label_file="$worktree_path/.worktree-dev.labels"

  [ -x "$vite_bin" ] || {
    echo "Missing executable: $vite_bin" >&2
    return 1
  }
  bun_bin=$(command -v bun || true)
  [ -n "$bun_bin" ] || {
    echo "Missing executable: bun" >&2
    return 1
  }
  node_bin=$(command -v node || true)
  [ -n "$node_bin" ] || {
    echo "Missing executable: node" >&2
    return 1
  }
  inherited_path=$(printf "%q" "${PATH:-/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin}")

  mkdir -p "$worktree_path/logs" "$config_dir"
  [ -n "$agent_dir" ] || agent_dir="$config_dir/agent"
  wt_seed_app_config "$config_dir" "$worktree_path"
  wt_prepare_agent_runtime_dir "$config_dir" "$agent_dir"
  wt_load_env_file "$env_file"
  : > "$worktree_path/logs/dev.log"

  cat > "$api_script" <<EOF
#!/bin/bash
cd "$worktree_path"
set -a
. "$env_file"
set +a
export PATH=$inherited_path
export PORT="$api_port"
export PI_APP_CONFIG_DIR="$config_dir"
export PI_CODING_AGENT_DIR="$agent_dir"
exec "$bun_bin" --bun src/server.ts
EOF
  cat > "$vite_script" <<EOF
#!/bin/bash
cd "$worktree_path"
set -a
. "$env_file"
set +a
export PATH=$inherited_path
export PORT="$api_port"
export PI_APP_CONFIG_DIR="$config_dir"
export PI_CODING_AGENT_DIR="$agent_dir"
export VITE_API_TARGET="http://localhost:${api_port}"
export VITE_PORT="$vite_port"
export VITE_STRICT_PORT=false
export VITE_AUTH_TOKEN="\${AUTH_TOKEN:-}"
exec "$node_bin" "$vite_bin" --port "$vite_port"
EOF
  chmod +x "$api_script" "$vite_script"

  if [ "$(uname -s 2>/dev/null)" = "Darwin" ] && command -v launchctl >/dev/null 2>&1; then
    local id api_label vite_label
    id=$(wt_id_for_path "$worktree_path")
    api_label="com.pi-agent-chat.worktree.${id}.api"
    vite_label="com.pi-agent-chat.worktree.${id}.vite"
    launchctl remove "$api_label" 2>/dev/null || true
    launchctl remove "$vite_label" 2>/dev/null || true
    launchctl submit -l "$api_label" -o "$worktree_path/logs/dev.log" -e "$worktree_path/logs/dev.log" -- "$api_script"
    launchctl submit -l "$vite_label" -o "$worktree_path/logs/dev.log" -e "$worktree_path/logs/dev.log" -- "$vite_script"
    printf "%s\n%s\n" "$api_label" "$vite_label" > "$label_file"
    : > "$worktree_path/.worktree-dev.pid"
    : > "$worktree_path/.worktree-dev.children"
    return 0
  fi

  nohup "$api_script" >> "$worktree_path/logs/dev.log" 2>&1 &
  api_pid=$!
  nohup "$vite_script" >> "$worktree_path/logs/dev.log" 2>&1 &
  vite_pid=$!
  echo "$api_pid" > "$worktree_path/.worktree-dev.pid"
  echo "$api_pid $vite_pid" > "$worktree_path/.worktree-dev.children"
}
