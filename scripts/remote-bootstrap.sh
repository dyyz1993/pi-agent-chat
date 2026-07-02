#!/usr/bin/env bash
# =============================================================================
# pi remote-bootstrap - one-command remote machine setup + verification
# Usage: bash scripts/remote-bootstrap.sh <ssh-host>
# =============================================================================

set -u

RED="\033[0;31m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
CYAN="\033[0;36m"
NC="\033[0m"

PASS=0
FAIL=0
WARN=0

HOST="${1:-}"
if [ -z "$HOST" ]; then
  echo "Usage: $0 <ssh-host>"
  exit 1
fi

# Public knobs. Tests use these to replace ssh/scp/ping with fake commands; real
# operators can use them to point the setup at a non-default app env file.
SSH_BIN="${PI_REMOTE_BOOTSTRAP_SSH_BIN:-ssh}"
SCP_BIN="${PI_REMOTE_BOOTSTRAP_SCP_BIN:-scp}"
PING_BIN="${PI_REMOTE_BOOTSTRAP_PING_BIN:-ping}"
SSH_CONNECT_TIMEOUT="${PI_REMOTE_BOOTSTRAP_SSH_TIMEOUT:-5}"

REMOTE_PI_VERSION="${PI_REMOTE_BOOTSTRAP_PI_VERSION:-0.74.61}"
REMOTE_NODE_VERSION="${PI_REMOTE_BOOTSTRAP_NODE_VERSION:-v22.15.0}"
LOCAL_PI_DIR="${PI_REMOTE_BOOTSTRAP_LOCAL_PI_DIR:-$HOME/.pi/agent}"
CONFIG_FILES="${PI_REMOTE_BOOTSTRAP_CONFIG_FILES:-auth.json models.json settings.json}"

SERVER_ENV_DIR="${PI_REMOTE_BOOTSTRAP_SERVER_ENV_DIR:-$PWD}"
ENV_FILE="${PI_REMOTE_BOOTSTRAP_ENV_FILE:-$SERVER_ENV_DIR/.env}"
REMOTE_PROJECT_PATH="${PI_REMOTE_BOOTSTRAP_REMOTE_PROJECT_PATH:-${REMOTE_PROJECT_PATH:-~}}"
REMOTE_RUNTIME_DIR="${PI_REMOTE_BOOTSTRAP_REMOTE_RUNTIME_DIR:-~/.pi/agent/remote-runtime/child}"
REMOTE_AGENT_DIR="${PI_REMOTE_BOOTSTRAP_REMOTE_AGENT_DIR:-~/.pi/agent}"

REMOTE_PATH_PREFIX='export PATH="$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:$HOME/.npm-global/bin:$PATH"'
INSTALL_NODE=false
INSTALL_PI=false
NODE_ARCH=""

step() {
  echo ""
  echo -e "${CYAN}═══════════════════════════════════════${NC}"
  echo -e "${CYAN}  $1${NC}"
  echo -e "${CYAN}═══════════════════════════════════════${NC}"
}

pass() {
  echo -e "${GREEN}PASS${NC}"
  PASS=$((PASS + 1))
}

record_fail() {
  echo -e "${RED}FAIL${NC}"
  FAIL=$((FAIL + 1))
}

warn() {
  echo -e "  ${YELLOW}!${NC} $1"
  WARN=$((WARN + 1))
}

info() {
  echo -e "  ${YELLOW}i${NC} $1"
}

ok() {
  echo -e "  ${GREEN}OK${NC} $1"
}

check_cmd() {
  local desc="$1"
  shift
  echo -n "  [...] $desc ... "
  if "$@" >/dev/null 2>&1; then
    pass
    return 0
  fi
  record_fail
  return 1
}

check_eval() {
  local desc="$1"
  local cmd="$2"
  echo -n "  [...] $desc ... "
  if eval "$cmd" >/dev/null 2>&1; then
    pass
    return 0
  fi
  record_fail
  return 1
}

ssh_run() {
  "$SSH_BIN" \
    -o BatchMode=yes \
    -o ConnectTimeout="$SSH_CONNECT_TIMEOUT" \
    -o StrictHostKeyChecking=accept-new \
    "$HOST" \
    "$@"
}

scp_copy() {
  local local_path="$1"
  local remote_path="$2"
  "$SCP_BIN" \
    -o BatchMode=yes \
    -o StrictHostKeyChecking=accept-new \
    "$local_path" \
    "$HOST:$remote_path"
}

ping_host() {
  "$PING_BIN" -c 1 -W 3 "$HOST" >/dev/null 2>&1
}

remote_single_quote() {
  printf "'%s'" "$(printf "%s" "$1" | sed "s/'/'\\\\''/g")"
}

detect_remote_platform() {
  REMOTE_PLATFORM="$(ssh_run "uname -s" 2>/dev/null | tr '[:upper:]' '[:lower:]')"
  REMOTE_ARCH="$(ssh_run "uname -m" 2>/dev/null | tr '[:upper:]' '[:lower:]')"
  info "platform: $REMOTE_PLATFORM"
  info "arch: $REMOTE_ARCH"

  case "$REMOTE_PLATFORM:$REMOTE_ARCH" in
    linux:x86_64) NODE_ARCH="linux-x64" ;;
    linux:aarch64|linux:arm64) NODE_ARCH="linux-arm64" ;;
    darwin:x86_64) NODE_ARCH="darwin-x64" ;;
    darwin:arm64|darwin:aarch64) NODE_ARCH="darwin-arm64" ;;
    *)
      echo -n "  [...] supported platform ... "
      record_fail
      warn "Unsupported remote platform: $REMOTE_PLATFORM/$REMOTE_ARCH"
      return 1
      ;;
  esac

  echo -n "  [...] supported platform ... "
  pass
}

install_remote_node() {
  if [ -z "$NODE_ARCH" ]; then
    return 1
  fi

  local archive="node-$REMOTE_NODE_VERSION-$NODE_ARCH.tar.gz"
  local dirname="node-$REMOTE_NODE_VERSION-$NODE_ARCH"
  local command
  command=$(cat <<EOF
set -e
mkdir -p "\$HOME/.local/bin" "\$HOME/.local/pi-node"
cd /tmp
curl -fsSL "https://nodejs.org/dist/$REMOTE_NODE_VERSION/$archive" -o "$archive"
tar xzf "$archive"
rm -rf "\$HOME/.local/pi-node/$dirname"
mv "$dirname" "\$HOME/.local/pi-node/$dirname"
ln -sf "\$HOME/.local/pi-node/$dirname/bin/node" "\$HOME/.local/bin/node"
ln -sf "\$HOME/.local/pi-node/$dirname/bin/npm" "\$HOME/.local/bin/npm"
ln -sf "\$HOME/.local/pi-node/$dirname/bin/npx" "\$HOME/.local/bin/npx"
rm -f "$archive"
EOF
)

  ssh_run "$command"
}

install_remote_pi() {
  local command
  command=$(cat <<EOF
set -e
$REMOTE_PATH_PREFIX
npm install -g --prefix "\$HOME/.local" "@dyyz1993/pi-coding-agent@$REMOTE_PI_VERSION"
EOF
)

  ssh_run "$command"
}

sync_config_files() {
  if ! ssh_run "mkdir -p ~/.pi/agent" >/dev/null 2>&1; then
    echo -n "  [...] create remote config dir ... "
    record_fail
    warn "Failed to create ~/.pi/agent on $HOST"
    return 1
  fi

  local file
  for file in $CONFIG_FILES; do
    echo -n "  [...] sync $file ... "
    if [ -f "$LOCAL_PI_DIR/$file" ] && scp_copy "$LOCAL_PI_DIR/$file" "~/.pi/agent/$file" >/dev/null 2>&1; then
      pass
    else
      record_fail
      warn "Missing or failed to copy $LOCAL_PI_DIR/$file"
    fi
  done
}

write_env_registration() {
  local remote_pi_path="$1"
  local remote_node_path="$2"

  echo -n "  [...] local env registration ... "
  if [ ! -f "$ENV_FILE" ]; then
    record_fail
    warn "$ENV_FILE does not exist. Set PI_REMOTE_BOOTSTRAP_ENV_FILE or create the file first."
    return 1
  fi

  local start="# Remote: $HOST (managed by scripts/remote-bootstrap.sh)"
  local end="# End remote: $HOST"
  local tmp_file
  tmp_file="$(mktemp)"

  awk -v start="$start" -v end="$end" '
    $0 == start { skip = 1; next }
    $0 == end { skip = 0; next }
    skip != 1 { print }
  ' "$ENV_FILE" > "$tmp_file"

  cat >> "$tmp_file" <<EOF

$start
REMOTE_CHILD_ENABLED=true
REMOTE_SSH_TARGET=$HOST
REMOTE_CHILD_PROJECT_PATH=$REMOTE_PROJECT_PATH
REMOTE_CHILD_REMOTE_RUNTIME_DIR=$REMOTE_RUNTIME_DIR
REMOTE_PI_AGENT_DIR=$REMOTE_AGENT_DIR
REMOTE_RESOURCE_SYNC=true
REMOTE_CHILD_AUTO_UPLOAD=false
REMOTE_CHILD_NODE_PATH=$remote_node_path
REMOTE_CHILD_PI_CLI_PATH=$remote_pi_path
REMOTE_CHILD_SHELL=sh -lc
$end
EOF

  mv "$tmp_file" "$ENV_FILE"
  pass
}

verify_remote_rpc() {
  local quoted_project
  quoted_project="$(remote_single_quote "$REMOTE_PROJECT_PATH")"
  local command
  command=$(cat <<EOF
set -e
$REMOTE_PATH_PREFIX
mkdir -p $quoted_project
cd $quoted_project
printf '%s\n' '{"id":"remote-bootstrap","type":"get_state"}' | pi --mode rpc | grep -m 1 -q '"command":"get_state".*"success":true'
EOF
)
  ssh_run "$command"
}

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║     pi remote-bootstrap                                 ║"
echo "║     Target: $HOST"
echo "╚══════════════════════════════════════════════════════════╝"

step "1. SSH connectivity"
check_eval "ssh echo" "ssh_run 'echo ok'"
check_eval "hostname resolution" "ping_host || ssh_run hostname"

step "2. Remote platform"
detect_remote_platform || true

step "3. Runtime detection"
REMOTE_NODE="$(ssh_run "$REMOTE_PATH_PREFIX && command -v node" 2>/dev/null || true)"
if [ -n "$REMOTE_NODE" ]; then
  NODE_VER="$(ssh_run "$REMOTE_PATH_PREFIX && node --version" 2>/dev/null || echo unknown)"
  echo -n "  [...] node present ... "
  pass
  ok "node: $REMOTE_NODE -> $NODE_VER"
else
  echo -n "  [...] node present ... "
  echo -e "${YELLOW}MISSING${NC}"
  WARN=$((WARN + 1))
  INSTALL_NODE=true
fi

REMOTE_PI="$(ssh_run "$REMOTE_PATH_PREFIX && command -v pi" 2>/dev/null || true)"
if [ -n "$REMOTE_PI" ]; then
  PI_VER="$(ssh_run "$REMOTE_PATH_PREFIX && pi --version" 2>/dev/null || echo unknown)"
  echo -n "  [...] pi present ... "
  pass
  ok "pi: $REMOTE_PI -> $PI_VER"
else
  echo -n "  [...] pi present ... "
  echo -e "${YELLOW}MISSING${NC}"
  WARN=$((WARN + 1))
  INSTALL_PI=true
fi

step "4. Install missing components"
if [ "$INSTALL_NODE" = true ]; then
  check_cmd "install Node.js $REMOTE_NODE_VERSION" install_remote_node
else
  ok "Node install skipped"
fi

if [ "$INSTALL_PI" = true ]; then
  check_cmd "install pi $REMOTE_PI_VERSION" install_remote_pi
else
  ok "pi install skipped"
fi

step "5. Configuration sync"
sync_config_files

step "6. Local app registration"
REMOTE_NODE_PATH="$(ssh_run "$REMOTE_PATH_PREFIX && command -v node" 2>/dev/null || echo node)"
REMOTE_PI_PATH="$(ssh_run "$REMOTE_PATH_PREFIX && command -v pi" 2>/dev/null || echo pi)"
write_env_registration "$REMOTE_PI_PATH" "$REMOTE_NODE_PATH"

step "7. Remote CLI verification"
check_eval "pi --version" "ssh_run '$REMOTE_PATH_PREFIX && pi --version'"
check_eval "model list not empty" "ssh_run '$REMOTE_PATH_PREFIX && pi --list-models 2>/dev/null | grep -Eq \"[[:alnum:]]\"'"
check_eval "auth.json non-empty" "ssh_run 'test -s ~/.pi/agent/auth.json'"
check_eval "models.json non-empty" "ssh_run 'test -s ~/.pi/agent/models.json'"

step "8. RPC verification"
check_cmd "pi --mode rpc get_state" verify_remote_rpc

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo -e "║  ${GREEN}$PASS passed${NC}  ${RED}$FAIL failed${NC}  ${YELLOW}$WARN warnings${NC}"
echo "╚══════════════════════════════════════════════════════════╝"

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}Remote bootstrap did not complete. Review the failed items above.${NC}"
  exit 1
fi

echo -e "${GREEN}Remote machine is ready: $HOST${NC}"
exit 0
