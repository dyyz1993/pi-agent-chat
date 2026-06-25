#!/bin/bash
# scripts/worktree-create.sh
# 交互式 worktree 创建工具 — 自动处理依赖选择 + 端口分配
#
# 用法:
#   ./scripts/worktree-create.sh <分支名>
#   ./scripts/worktree-create.sh <分支名> --code       # 自动打开 VS Code
#   ./scripts/worktree-create.sh <分支名> --link       # 直接软链依赖（非交互）
#   ./scripts/worktree-create.sh <分支名> --install    # 直接 bun install（非交互）
#   ./scripts/worktree-create.sh <分支名> --dev        # 软链 + 分配端口 + 生成 .env
#   ./scripts/worktree-create.sh <分支名> --dev --start # 软链 + 分配端口 + 生成 .env + 直接启动
#   ./scripts/worktree-create.sh <分支名> --skip-deps  # 跳过依赖处理
#
# 示例:
#   ./scripts/worktree-create.sh ui-dark --dev
#   → 创建 worktree，软链依赖，分配 3101/5174 端口，生成 .env

set -e

# ────────────────────────── 颜色 ──────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

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

# ────────────────────────── 路径 ──────────────────────────
# worktree 的 .git 是文件，用 rev-parse 或 fallback 检测
if command -v git &>/dev/null && git rev-parse --git-dir &>/dev/null 2>&1; then
  REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
else
  find_repo_root() {
    local dir="$(pwd)"
    while [ "$dir" != "/" ]; do
      [ -e "$dir/.git" ] && echo "$dir" && return 0
      dir=$(dirname "$dir")
    done
    return 1
  }
  REPO_ROOT=$(find_repo_root) || err "不在 git 仓库中"
fi
REPO_NAME=$(basename "$REPO_ROOT")
PARENT_DIR=$(dirname "$REPO_ROOT")
WORKTREE_BASE="${PARENT_DIR}/${REPO_NAME}"
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

# ────────────────────────── 参数解析 ──────────────────────────
BRANCH=""
OPEN_CODE=false
NON_INTERACTIVE=""
SKIP_DEPS=false
SETUP_DEV=false
START_NOW=false

for arg in "$@"; do
  case "$arg" in
    --code)    OPEN_CODE=true  ;;
    --link)    NON_INTERACTIVE="link" ;;
    --install) NON_INTERACTIVE="install" ;;
    --skip-deps) SKIP_DEPS=true ;;
    --dev)     NON_INTERACTIVE="link"; SETUP_DEV=true ;;
    --start)   START_NOW=true ;;
    --*|-)     err "未知选项: $arg" ;;
    *)
      if [ -z "$BRANCH" ]; then
        BRANCH="$arg"
      else
        err "未知参数: $arg"
      fi
      ;;
  esac
done

[ -z "$BRANCH" ] && err "请指定分支名\n用法: ./scripts/worktree-create.sh <分支名> [--code|--link|--install|--dev|--start|--skip-deps]"

WORKTREE_PATH="${WORKTREE_BASE}-${BRANCH}"

# ────────────────────────── 端口工具 ──────────────────────────
# 找到 ≥ start 的第一个空闲端口
find_free_port() {
  local start=$1
  local port=$start
  while lsof -i :$port -P 2>/dev/null | grep -q LISTEN; do
    port=$((port + 1))
  done
  echo "$port"
}

# ────────────────────────── 检查主仓库状态 ──────────────────────────
MAIN_YALC="$REPO_ROOT/.yalc"
MAIN_NM="$REPO_ROOT/node_modules"
MAIN_ENV="$REPO_ROOT/.env"

check_source() {
  local missing=0
  [ ! -d "$MAIN_YALC" ] && warn "主仓库没有 .yalc/（yalc 本地包可能没 publish）" && missing=1
  [ ! -d "$MAIN_NM" ]   && warn "主仓库没有 node_modules/（请先在主仓库跑 bun install）" && missing=1
  [ ! -f "$MAIN_ENV" ]  && warn "主仓库没有 .env（缺少配置模板）" && missing=1
  [ "$missing" -ne 0 ] && err "主仓库缺少依赖源，请先在主仓库准备好"
}
check_source

# 检查是否已有 worktree
if [ -d "$WORKTREE_PATH" ]; then
  warn "路径已存在: $WORKTREE_PATH"
  exit 1
fi

# ────────────────────────── 1. 创建 Worktree ──────────────────────────
header "创建 Worktree"
echo "  路径: ${CYAN}${WORKTREE_PATH}${NC}"
echo "  分支: ${CYAN}${BRANCH}${NC}"
echo ""

git worktree add -b "$BRANCH" "$WORKTREE_PATH" 2>&1 | sed 's/^/  /'
ok "Worktree 创建成功"
echo ""

# ────────────────────────── 2. 依赖处理 ──────────────────────────
cd "$WORKTREE_PATH"

if [ "$SKIP_DEPS" = true ]; then
  info "跳过依赖处理（--skip-deps）"
  echo ""
else
  header "依赖处理"

  if [ -n "$NON_INTERACTIVE" ]; then
    CHOICE="$NON_INTERACTIVE"
  else
    echo "  ${BOLD}worktree 需要 node_modules 才能运行。怎么处理？${NC}"
    echo ""
    echo "  ${BOLD}[L]${NC} 软链 — 从主仓库软链 .yalc/ 和 node_modules（${GREEN}0 秒${NC}）"
    echo "       最适合不改 package.json 的场景。如果改了依赖，断开软链重新装即可"
    echo ""
    echo "  ${BOLD}[I]${NC} 安装 — 从主仓库复制 .yalc/ + bun install（${YELLOW}几秒${NC}）"
    echo "       完全独立，无后顾之忧。bun 从缓存硬链接，也很快"
    echo ""
    echo "  ${BOLD}[S]${NC} 跳过 — 什么都不做，我自己后面再搞"
    echo ""
    prompt "  你的选择 [L/i/s]: " CHOICE
    echo ""
    CHOICE=${CHOICE:-L}
  fi

  case "$(echo "$CHOICE" | tr '[:upper:]' '[:lower:]')" in
    i|install)
      info "选项 I：复制 .yalc/ + bun install（独立安装）"
      echo ""

      if [ -d "$MAIN_YALC" ]; then
        info "正在复制 .yalc/ ..."
        cp -R "$MAIN_YALC" "$WORKTREE_PATH/.yalc"
        ok ".yalc/ 复制完成"
      fi

      info "正在 bun install ..."
      if bun install 2>&1; then
        ok "bun install 完成"
      else
        warn "bun install 遇到问题，请检查"
      fi
      ;;

    s|skip)
      info "跳过依赖安装，需要时再处理"
      ;;

    *) # link (默认)
      info "选项 L：软链主仓库依赖（0 秒）"
      echo ""

      if [ -d "$MAIN_YALC" ]; then
        ln -sf "$MAIN_YALC" "$WORKTREE_PATH/.yalc"
        ok "软链 .yalc/ → ${MAIN_YALC}"
      fi

      if [ -d "$MAIN_NM" ]; then
        ln -sf "$MAIN_NM" "$WORKTREE_PATH/node_modules"
        ok "软链 node_modules/ → ${MAIN_NM}"
      fi

      cat > "$WORKTREE_PATH/.worktree-deps.json" <<- JSONEOF
{
  "strategy": "symlink",
  "source": "$REPO_ROOT",
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "warning": "如果修改了 package.json，请删掉软链并重新 bun install"
}
JSONEOF
      ok "已记录依赖来源 → .worktree-deps.json"
      echo ""
      info "${YELLOW}提示${NC}: 如果之后修改了 package.json，运行以下命令断开软链并独立安装："
      info "  cd ${WORKTREE_PATH} && rm -f node_modules .yalc && bun install"
      ;;
  esac
  echo ""
fi

# ────────────────────────── 3. 端口分配 + .env 生成（--dev） ──────────────────────────
if [ "$SETUP_DEV" = true ]; then
  header "端口分配"

  # 从主仓库复制完整 .env 内容，只改 PORT
  MAIN_PORT=$(grep -E '^PORT=' "$MAIN_ENV" 2>/dev/null | head -1 | cut -d= -f2)
  MAIN_PORT=${MAIN_PORT:-3100}

  # 找空闲端口：从主仓库 port+1 开始找
  API_PORT=$(find_free_port $((MAIN_PORT + 1)))
  # Vite 端口：从 5174 开始找
  VITE_PORT=$(find_free_port 5174)

  echo "  ${BOLD}端口分配${NC}"
  echo ""
  echo "  Server API    ${YELLOW}${MAIN_PORT}${NC} → ${GREEN}${API_PORT}${NC}  (API/WebSocket)"
  echo "  Vite HMR      ${YELLOW}5173${NC}        → ${GREEN}${VITE_PORT}${NC}       (前端开发服务器)"
  echo ""

  # 生成 .env：复制主仓库全部内容，只改 PORT
  grep -v -E '^#|^$|^PORT=' "$MAIN_ENV" 2>/dev/null > "$WORKTREE_PATH/.env.tmp"
  echo "" >> "$WORKTREE_PATH/.env.tmp"
  echo "# worktree: 端口已偏移（主仓库:${MAIN_PORT}）" >> "$WORKTREE_PATH/.env.tmp"
  echo "PORT=${API_PORT}" >> "$WORKTREE_PATH/.env.tmp"
  mv "$WORKTREE_PATH/.env.tmp" "$WORKTREE_PATH/.env"
  ok ".env 已生成（继承主仓库全量配置，仅 PORT 改为 ${API_PORT}）"
  echo ""

  # 提示如何启动
  info "启动："
  info "  ${SCRIPT_DIR}/worktree-dev.sh ${WORKTREE_PATH}"
  echo ""
fi

# ────────────────────────── 4. 启动（--start）= --dev + 直接启动 ──────────────────────────
if [ "$START_NOW" = true ]; then
  # --start 暗示 --dev
  if [ "$SETUP_DEV" != true ]; then
    MAIN_PORT=$(grep -E '^PORT=' "$MAIN_ENV" 2>/dev/null | head -1 | cut -d= -f2)
    MAIN_PORT=${MAIN_PORT:-3100}
    API_PORT=$(find_free_port $((MAIN_PORT + 1)))
    VITE_PORT=$(find_free_port 5174)
    grep -v -E '^#|^$|^PORT=' "$MAIN_ENV" 2>/dev/null > "$WORKTREE_PATH/.env.tmp"
    echo "" >> "$WORKTREE_PATH/.env.tmp"
    echo "# worktree: 端口已偏移（主仓库:${MAIN_PORT}）" >> "$WORKTREE_PATH/.env.tmp"
    echo "PORT=${API_PORT}" >> "$WORKTREE_PATH/.env.tmp"
    mv "$WORKTREE_PATH/.env.tmp" "$WORKTREE_PATH/.env"
  fi

  header "启动"
  info "正在启动开发服务器（API=${API_PORT}, Vite=${VITE_PORT}）..."
  echo ""

  cd "$WORKTREE_PATH"
  PI_APP_CONFIG_DIR="${HOME}/.pi-agent-chat/worktrees/${BRANCH}" \
  PORT=${API_PORT} \
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
  sleep 2

  ok "开发服务器已启动（PID: ${PID}）"
  info "  API:      http://localhost:${API_PORT}"
  info "  Vite HMR: http://localhost:${VITE_PORT}"
  info "  停止: kill \$(cat ${WORKTREE_PATH}/.worktree-dev.pid)"
  sleep 1
fi

# ────────────────────────── 5. 完成 ──────────────────────────
header "完成"

echo ""
echo "  📂 ${CYAN}cd ${WORKTREE_PATH}${NC}"
echo "  🌿 分支: ${CYAN}${BRANCH}${NC}"

DEP_STRATEGY="未安装"
if [ -L "$WORKTREE_PATH/node_modules" ]; then
  DEP_STRATEGY="软链（主仓库）"
elif [ -d "$WORKTREE_PATH/node_modules" ] && [ "$(ls -A "$WORKTREE_PATH/node_modules" 2>/dev/null | wc -l)" -gt 0 ]; then
  DEP_STRATEGY="已独立安装"
fi
echo "  📦 依赖: ${CYAN}${DEP_STRATEGY}${NC}"
echo ""

# 打开编辑器（仅交互模式）
if [ -z "$NON_INTERACTIVE" ] || [ "$OPEN_CODE" = true ]; then
  if [ "$OPEN_CODE" != true ]; then
    prompt "  打开 VS Code？[Y/n]: " OPEN_CHOICE
    echo ""
    case "$(echo "$OPEN_CHOICE" | tr '[:upper:]' '[:lower:]')" in
      n|no) ;;
      *) OPEN_CODE=true ;;
    esac
  fi

  if [ "$OPEN_CODE" = true ]; then
    info "正在打开 VS Code ..."
    code "$WORKTREE_PATH" 2>/dev/null || warn "code 命令不可用，请手动打开"
    ok "已打开 VS Code"
  fi
fi

echo ""
ok "一切就绪！"
