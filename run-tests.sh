#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SUITES="$ROOT/test-suites.json"
COLOR_GREEN="\033[32m"
COLOR_YELLOW="\033[33m"
COLOR_RED="\033[31m"
COLOR_CYAN="\033[36m"
COLOR_BOLD="\033[1m"
COLOR_RESET="\033[0m"

usage() {
  cat <<EOF
${COLOR_BOLD}Usage:${COLOR_RESET} $(basename "$0") <command> [target]

${COLOR_BOLD}Commands:${COLOR_RESET}
  list                  列出所有测试分类和业务模块
  run <target>          运行指定分类/模块的测试
  smoke                 快速冒烟：只跑 util + handler（最快）
  store                 跑所有 store 测试
  handler               跑所有 handler 测试
  ui                    跑所有 UI 组件测试
  check                 检查 vitest 配置 + 文件是否存在
  failed                只重跑上次失败的测试文件

${COLOR_BOLD}分类目标 (run 命令):${COLOR_RESET}
  store / handler / util / ui / integration

${COLOR_BOLD}业务模块目标 (run 命令):${COLOR_RESET}
  chat / bash / session / git / memory / theme / settings / agent / project

${COLOR_BOLD}Examples:${COLOR_RESET}
  $(basename "$0") run store          # 跑所有 store 测试
  $(basename "$0") run chat           # 跑 chat 相关所有测试（跨 store/handler/ui）
  $(basename "$0") run git            # 跑 git 模块测试（仅 2 个文件，秒出结果）
  $(basename "$0") smoke              # 快速冒烟：util + handler（~30 个文件）
  $(basename "$0") list               # 查看所有分类
EOF
}

log_header() {
  echo -e "\n${COLOR_CYAN}${COLOR_BOLD}▶ $1${COLOR_RESET}\n"
}

log_ok() {
  echo -e "  ${COLOR_GREEN}✓${COLOR_RESET} $1"
}

log_warn() {
  echo -e "  ${COLOR_YELLOW}!${COLOR_RESET} $1"
}

log_err() {
  echo -e "  ${COLOR_RED}✗${COLOR_RESET} $1"
}

get_files() {
  local key="$1"
  node -e "
    const key = process.argv[1];
    const s = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
    const files = key.includes('.') ? key.split('.').reduce((o, k) => o?.[k], s) : s[key];
    if (!files) { console.error('Unknown: ' + key); process.exit(1); }
    const list = files.files || files;
    (Array.isArray(list) ? list : []).forEach(f => console.log('test/' + f));
  " "$key" "$SUITES"
}

get_desc() {
  local key="$1"
  node -e "
    const key = process.argv[1];
    const s = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
    const entry = key.includes('.') ? key.split('.').reduce((o, k) => o?.[k], s) : s[key];
    console.log(entry?.desc || '');
  " "$key" "$SUITES"
}

do_list() {
  log_header "测试分类"
  for cat in store handler util ui integration; do
    local desc
    desc=$(get_desc "$cat")
    local count
    count=$(get_files "$cat" | wc -l | tr -d ' ')
    echo -e "  ${COLOR_BOLD}$cat${COLOR_RESET} ($count 文件) — $desc"
  done

  log_header "业务模块"
  for mod in chat bash session git memory theme settings agent project; do
    local desc
    desc=$(get_desc "module.$mod")
    local count
    count=$(get_files "module.$mod" | wc -l | tr -d ' ')
    echo -e "  ${COLOR_BOLD}$mod${COLOR_RESET} ($count 文件) — $desc"
  done
}

do_run() {
  local target="$1"
  local files=""

  files=$(get_files "$target" 2>/dev/null) || true

  if [ -z "$files" ]; then
    files=$(get_files "module.$target" 2>/dev/null) || true
    target="module.$target"
  fi

  if [ -z "$files" ]; then
    log_err "未知目标: $1"
    echo "  运行 '$(basename "$0") list' 查看可用分类"
    exit 1
  fi

  local desc
  desc=$(get_desc "$target")
  local count
  count=$(echo "$files" | wc -l | tr -d ' ')
  log_header "▶ $target ($count 文件) — $desc"

  echo "$files" | while read -r f; do
    if [ ! -f "$ROOT/$f" ]; then
      log_warn "文件不存在: $f"
    fi
  done

  echo "$files" | xargs bun test --isolate 2>&1
}

do_smoke() {
  log_header "冒烟测试：util + handler（最快验证）"
  local files=""
  files=$(get_files "util")
  files="$files
$(get_files "handler")"
  echo "$files" | grep -v '^$' | xargs bun test --isolate 2>&1
}

do_check() {
  log_header "环境检查"

  if command -v bun &>/dev/null; then
    log_ok "bun: $(bun --version)"
  else
    log_err "bun 未安装"
  fi

  local total=0
  local missing=0
  for cat in store handler util ui integration; do
    while IFS= read -r f; do
      total=$((total + 1))
      if [ -f "$ROOT/$f" ]; then
        log_ok "$f"
      else
        missing=$((missing + 1))
        log_err "$f (missing)"
      fi
    done < <(get_files "$cat")
  done

  log_header "统计: $total 文件, $missing 缺失"
}

do_failed() {
  log_header "重跑上次失败文件"
  local result
  result=$(bun test --isolate 2>&1) || true
  echo "$result" | grep -oE 'test/[^ ]+\.test\.(ts|tsx)' | sort -u | while read -r f; do
    if [ -f "$ROOT/$f" ]; then
      echo -e "  ${COLOR_RED}→${COLOR_RESET} $f"
    fi
  done

  local failed_files
  failed_files=$(echo "$result" | grep -oE 'test/[^ ]+\.test\.(ts|tsx)' | sort -u | tr '\n' ' ')
  if [ -n "$failed_files" ]; then
    log_header "重新运行失败文件..."
    bun test --isolate $failed_files 2>&1
  else
    log_ok "没有失败的测试文件"
  fi
}

cmd="${1:-}"
case "$cmd" in
  list)   do_list ;;
  run)    [ -z "${2:-}" ] && { echo "Error: run needs a target"; usage; exit 1; }; do_run "$2" ;;
  smoke)  do_smoke ;;
  store)  do_run "store" ;;
  handler) do_run "handler" ;;
  ui)     do_run "ui" ;;
  check)  do_check ;;
  failed) do_failed ;;
  -h|--help|help) usage ;;
  "")     usage ;;
  *)      echo "Unknown command: $cmd"; usage; exit 1 ;;
esac
