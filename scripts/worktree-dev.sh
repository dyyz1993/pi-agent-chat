#!/bin/bash
# scripts/worktree-dev.sh
# 在 worktree 中启动开发服务器，自动分配不冲突的端口
#
# 用法:
#   ./scripts/worktree-dev.sh                    # 交互选择 worktree + 启动
#   ./scripts/worktree-dev.sh <worktree路径>      # 指定 worktree 启动
#   ./scripts/worktree-dev.sh <分支名>             # 按分支名查找
#   ./scripts/worktree-dev.sh list               # 列出所有 worktree
#
# 示例:
#   cd ../pi-agent-chat-ui_style
#   ../pi-agent-chat/scripts/worktree-dev.sh

set -e

# ────────────────────────── 颜色 ──────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { printf "${CYAN}ℹ${NC}  %s\n" "$1"; }
ok()    { printf "${GREEN}✔${NC}  %s\n" "$1"; }
warn()  { printf "${YELLOW}⚠${NC}  %s\n" "$1"; }
err()   { printf "${RED}✘${NC}  %s\n" "$1";  exit 1; }
header(){ printf "\n${BOLD}━━━ %s ━━━${NC}\n" "$1"; }

# 安全读取用户输入（支持非交互式管道输入）
prompt() {
  local msg="$1"
  local var_name="$2"
  if [ -t 0 ]; then
    read -r -p "$msg" "$var_name"
  else
    read -r "$var_name"
  fi
}

# 找到 ≥ start 的第一个空闲端口
find_free_port() {
  local start=$1
  local port=$start
  while lsof -i :$port -P 2>/dev/null | grep -q LISTEN; do
    port=$((port + 1))
  done
  echo "$port"
}

# ────────────────────────── 定位主仓库 ──────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 找到主仓库（不是 worktree）：从 git worktree list 取第一行
# worktree 的 .git 是文件，主仓库的 .git 才是目录
find_main_repo() {
  # 从当前目录向上找包含 .git 目录（不是文件）的目录
  local dir="$(pwd)"
  while [ "$dir" != "/" ]; do
    if [ -d "$dir/.git" ]; then
      echo "$dir"
      return 0
    fi
    dir=$(dirname "$dir")
  done
  return 1
}

# 先用 git worktree list 定位主仓库（第一行是主仓库）
if command -v git &>/dev/null; then
  MAIN_LINE=$(git worktree list 2>/dev/null | head -1)
  if [ -n "$MAIN_LINE" ]; then
    REPO_ROOT=$(echo "$MAIN_LINE" | awk '{print $1}')
    ok "定位到主仓库: ${REPO_ROOT}"
  else
    REPO_ROOT=$(find_main_repo) || err "找不到主仓库（没有 .git 目录）"
  fi
else
  REPO_ROOT=$(find_main_repo) || err "找不到主仓库（没有 .git 目录）"
fi

REPO_NAME=$(basename "$REPO_ROOT")
PARENT_DIR=$(dirname "$REPO_ROOT")

# ────────────────────────── 参数 ──────────────────────────
ACTION="${1:-}"

# list 模式
if [ "$ACTION" = "list" ]; then
  header "所有 Worktree"
  git -C "$REPO_ROOT" worktree list
  exit 0
fi

# ────────────────────────── 确定 worktree 路径 ──────────────────────────
if [ -n "$ACTION" ] && [ -d "$ACTION" ]; then
  WORKTREE_PATH="$ACTION"
elif [ -n "$ACTION" ] && [ -d "${PARENT_DIR}/${REPO_NAME}-${ACTION}" ]; then
  WORKTREE_PATH="${PARENT_DIR}/${REPO_NAME}-${ACTION}"
else
  header "选择 Worktree"
  WORKTREES=()
  while IFS= read -r line; do
    path=$(echo "$line" | awk '{print $1}')
    # 排除主仓库自身
    if [ "$(cd "$path" 2>/dev/null && pwd)" != "$REPO_ROOT" ]; then
      branch=$(echo "$line" | awk 'NF>2 && $(NF-1) ~ /^\[/ { gsub(/[[\]]/,"",$(NF-1)); print $(NF-1); next } { print $2 }')
      # fallback: get branch name differently
      branch=$(git -C "$path" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
      WORKTREES+=("$path|$branch")
    fi
  done < <(git -C "$REPO_ROOT" worktree list 2>/dev/null)

  [ ${#WORKTREES[@]} -eq 0 ] && err "没有找到 worktree。先用 ./scripts/worktree-create.sh 创建一个"

  echo ""
  for i in "${!WORKTREES[@]}"; do
    IFS='|' read -r wt_path wt_branch <<< "${WORKTREES[$i]}"
    wt_name=$(basename "$wt_path")
    echo "  $((i+1))) ${CYAN}${wt_name}${NC}  (${wt_branch})"
  done
  echo ""
  prompt "  选择 worktree [1-${#WORKTREES[@]}]: " CHOICE
  echo ""

  if ! [[ "$CHOICE" =~ ^[0-9]+$ ]] || [ "$CHOICE" -lt 1 ] || [ "$CHOICE" -gt "${#WORKTREES[@]}" ]; then
    err "无效选择"
  fi

  IFS='|' read -r WORKTREE_PATH _ <<< "${WORKTREES[$((CHOICE-1))]}"
fi

[ ! -d "$WORKTREE_PATH" ] && err "目录不存在: $WORKTREE_PATH"
cd "$WORKTREE_PATH"

WORKTREE_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
WORKTREE_NAME=$(basename "$WORKTREE_PATH")

header "启动: ${WORKTREE_NAME}（${WORKTREE_BRANCH}）"

# ────────────────────────── 依赖检查 ──────────────────────────
MAIN_NM="$REPO_ROOT/node_modules"
MAIN_YALC="$REPO_ROOT/.yalc"

if [ ! -d "node_modules" ] || [ "$(ls -A node_modules 2>/dev/null | wc -l)" -eq 0 ]; then
  warn "node_modules 为空！"
  echo ""

  if [ -d "$MAIN_NM" ]; then
    echo "  [L] 软链主仓库（0 秒，推荐）"
    echo "  [I] bun install（几秒）"
    echo "  [S] 取消"
    prompt "  选择 [L/i/s]: " DEP_CHOICE
    echo ""
    case "$(echo "$DEP_CHOICE" | tr '[:upper:]' '[:lower:]')" in
      i)
        info "复制 .yalc/ + bun install ..."
        [ -d "$MAIN_YALC" ] && cp -R "$MAIN_YALC" "$WORKTREE_PATH/.yalc"
        bun install 2>&1 || warn "bun install 有问题"
        ;;
      s) err "已取消" ;;
      *)
        [ -d "$MAIN_YALC" ] && ln -sf "$MAIN_YALC" "$WORKTREE_PATH/.yalc"
        ln -sf "$MAIN_NM" "$WORKTREE_PATH/node_modules"
        ok "已软链主仓库依赖"
        ;;
    esac
  else
    err "主仓库也没有 node_modules，请先在主仓库 bun install"
  fi
  echo ""
fi

# ────────────────────────── 准备 .env ──────────────────────────
# 从主仓库复制完整 .env，只改端口
MAIN_ENV="$REPO_ROOT/.env"
[ ! -f "$MAIN_ENV" ] && err "主仓库缺少 .env"

# 读取主仓库端口
MAIN_PORT=$(grep -E '^PORT=' "$MAIN_ENV" | head -1 | cut -d= -f2)
MAIN_PORT=${MAIN_PORT:-3100}

# 检查 worktree 已有的 .env
HAS_DOTENV=false
[ -f "$WORKTREE_PATH/.env" ] && HAS_DOTENV=true

# 分配 API 端口
ENV_API_PORT=$(grep -E '^PORT=' "$WORKTREE_PATH/.env" 2>/dev/null | head -1 | cut -d= -f2 || echo "")
if [ -n "$ENV_API_PORT" ] && [ "$ENV_API_PORT" != "$MAIN_PORT" ] && ! lsof -i :$ENV_API_PORT -P 2>/dev/null | grep -q LISTEN; then
  API_PORT=$ENV_API_PORT
else
  API_PORT=$(find_free_port $((MAIN_PORT + 1)))
fi

# 分配 Vite 端口
VITE_PORT=$(find_free_port 5174)

# 生成 .env：复制主仓库全部内容，只改 PORT
echo "$(grep -v -E '^#|^$|^PORT=' "$MAIN_ENV" 2>/dev/null)" > "$WORKTREE_PATH/.env.tmp"
echo "" >> "$WORKTREE_PATH/.env.tmp"
# 把 PORT 放在最后，明显标注
echo "# worktree: 端口自动偏移（主仓库:${MAIN_PORT}）" >> "$WORKTREE_PATH/.env.tmp"
echo "PORT=${API_PORT}" >> "$WORKTREE_PATH/.env.tmp"
mv "$WORKTREE_PATH/.env.tmp" "$WORKTREE_PATH/.env"
ok ".env 已配置（主仓库基础配置 + 端口 ${API_PORT}）"

echo ""

# ────────────────────────── 端口信息 ──────────────────────────
header "端口信息"
echo ""
echo "  ${BOLD}服务${NC}           ${BOLD}主仓库${NC}    ${BOLD}当前 worktree${NC}"
echo "  ───────────────────────────────"
echo "  Server API    : ${YELLOW}${MAIN_PORT}${NC}        ${GREEN}${API_PORT}${NC}"
echo "  Vite HMR      : ${YELLOW}5173${NC}          ${GREEN}${VITE_PORT}${NC}"
echo ""

# ────────────────────────── 启动 ──────────────────────────
header "启动"

echo "  访问地址:"
echo "    ${BOLD}API${NC}        ${CYAN}http://localhost:${API_PORT}${NC}"
echo "    ${BOLD}Vite${NC}       ${CYAN}http://localhost:${VITE_PORT}${NC}"
echo "    ${BOLD}Health${NC}     ${CYAN}http://localhost:${API_PORT}/health${NC}"
echo ""

prompt "  启动开发服务器？[Y/n]: " START_CHOICE
echo ""

case "$(echo "$START_CHOICE" | tr '[:upper:]' '[:lower:]')" in
  n|no)
    info "可手动启动："
    info "  cd ${WORKTREE_PATH}"
    info "  PORT=${API_PORT} dotenv -e .env -- bun src/server.ts &"
    info "  VITE_PORT=${VITE_PORT} VITE_API_TARGET=http://localhost:${API_PORT} VITE_STRICT_PORT=false vite"
    exit 0
    ;;
esac

info "正在启动（后台），日志输出到 $WORKTREE_PATH/logs/ ..."

mkdir -p "$WORKTREE_PATH/logs"

# worktree 独立 config 目录（隔离 activeProject/Tab/Session）
WORKTREE_CONFIG_DIR="${HOME}/.pi-agent-chat/worktrees/${WORKTREE_NAME}"

# 传递正确端口给 vite（proxy target + port）
PORT=${API_PORT} \
PI_APP_CONFIG_DIR="${WORKTREE_CONFIG_DIR}" \
VITE_API_TARGET="http://localhost:${API_PORT}" \
VITE_PORT=${VITE_PORT} \
VITE_STRICT_PORT=false \
dotenv -e "$WORKTREE_PATH/.env" -- \
  concurrently \
    -n "api,vite" \
    -c "blue,green" \
    "bun --bun src/server.ts" \
    "vite --port ${VITE_PORT}" \
  > "$WORKTREE_PATH/logs/dev.log" 2>&1 &

PID=$!
echo $PID > "$WORKTREE_PATH/.worktree-dev.pid"

sleep 3

# 检查是否启动成功
if kill -0 $PID 2>/dev/null; then
  ok "开发服务器已启动（PID: ${PID}）"
  echo ""
  echo "  ${BOLD}API${NC}        ${CYAN}http://localhost:${API_PORT}${NC}"
  echo "  ${BOLD}Vite${NC}       ${CYAN}http://localhost:${VITE_PORT}${NC}"
  echo "  ${BOLD}日志${NC}       ${WORKTREE_PATH}/logs/dev.log"
  echo ""
  info "停止：kill \$(cat ${WORKTREE_PATH}/.worktree-dev.pid)"
else
  warn "启动可能有问题，查看日志:"
  tail -20 "$WORKTREE_PATH/logs/dev.log"
fi
