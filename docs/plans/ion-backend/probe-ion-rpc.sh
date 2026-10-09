#!/usr/bin/env bash
# probe-ion-rpc.sh — Phase 0 契约矩阵探针（只读 pi-agent-chat，不碰 ion 仓）
#
# 目的：对隔离 ion host 逐方法探测 RPC 响应形状 + 抓取事件流类型名，
#       产出 evidence JSONL，供 contract-matrix.md 回填。
# 隔离铁律（照抄 ion 仓 tests/subscribe_protocol_ci.sh）：私有 HOME + 私有
#       ION_HOST_SOCKET + 私有 ION_SESSION_DIR，绝不碰真实 ~/.ion 与正在跑的 host；
#       只 kill 自己启动的精确 PID。faux provider，零 token。
#
# 用法：bash docs/plans/ion-backend/probe-ion-rpc.sh [output.jsonl]
#       结果默认写 /tmp/ion-probe-evidence.jsonl

set -uo pipefail

ION_BIN="${ION_BIN:-$HOME/Project/study-rust/ion/target/debug/ion}"
OUT="${1:-/tmp/ion-probe-evidence.jsonl}"
: > "$OUT"

TEST_DIR="$(mktemp -d /tmp/ion-probe-XXXXXX)"
export HOME="$TEST_DIR/home"
mkdir -p "$HOME" "$TEST_DIR/proj"
export ION_HOST_SOCKET="$TEST_DIR/host.sock"
export ION_SESSION_DIR="$TEST_DIR/sessions"
export ION_FAUX_REPLY="phase0 contract probe reply"
printf '# probe\n' > "$TEST_DIR/proj/README.md"

cleanup() {
    [ -n "${HOST_PID:-}" ] && kill "$HOST_PID" 2>/dev/null
    [ -n "${HOST_PID:-}" ] && wait "$HOST_PID" 2>/dev/null
    rm -rf "$TEST_DIR"
}
trap cleanup EXIT

rpc()  { local p="${2:-}"; [ -z "$p" ] && p='{}'; "$ION_BIN" rpc --method "$1" --params "$p" 2>&1; }
wrpc() { local p="${2:-}"; [ -z "$p" ] && p='{}'; "$ION_BIN" rpc --session "$SID" --method "$1" --params "$p" 2>&1; }

log_ev() { # log_ev <kind> <name> <status> <detail>
    jq -cn --arg k "$1" --arg n "$2" --arg s "$3" --arg d "$4" \
        '{kind:$k, name:$n, status:$s, detail:$d}' >> "$OUT"
}

shape() { # shape <raw-line> → 顶层形状摘要（keys 或错误特征）
    printf '%s' "$1" | jq -r '
      if type == "object" then
        if has("success") then
          (if .success then
             (if has("data") and (.data|type=="object") then "ok data{" + ((.data|keys)|join(",")) + "}"
              elif has("data") then "ok data=" + (.data|type)
              else "ok {" + (keys|join(",")) + "}" end)
           else "err " + ((.error // .message // "?") | tostring | .[0:120]) end)
        else "{" + (keys|join(",")) + "}"
      else tostring | .[0:120] end' 2>/dev/null || printf '%s' "$1" | head -c 120
}

stof() { # stof <raw-line> → ok|fail|missing（统一状态判定，避免引号地狱）
    if printf '%s' "$1" | grep -qi "unknown command\|not supported\|unrecognized"; then printf missing; return; fi
    printf '%s' "$1" | jq -r 'if (.success == true) then "ok" else "fail" end' 2>/dev/null || printf fail
}

# ── 1. 起 host ──
echo "=== start isolated host (sock=$ION_HOST_SOCKET) ===" >&2
"$ION_BIN" serve > "$TEST_DIR/host.log" 2>&1 &
HOST_PID=$!
READY=0
for _ in $(seq 1 20); do
    sleep 1
    if rpc list_sessions 2>/dev/null | grep -q "sessions"; then READY=1; break; fi
done
[ "$READY" = 1 ] || { echo "host not ready, log:" >&2; tail -5 "$TEST_DIR/host.log" >&2; exit 1; }

# hello（hostId 证据）
H=$(rpc hello | head -1)
log_ev host hello ok "$(shape "$H")"

# ── 2. manager 级 ──
for m in list_sessions get_overview; do
    R=$(rpc "$m" | head -1)
    log_ev manager "$m" "$(stof "$R")" "$(shape "$R")"
done

# ── 3. create session + faux prompt（让消息树非空）──
CS=$(rpc create_session '{"agent":"developer"}' | head -1)
SID=$(printf '%s' "$CS" | jq -r '.data.session_id // .session_id // empty')
[ -z "$SID" ] && { echo "no session_id: $CS" >&2; exit 1; }
log_ev manager create_session ok "sid=$SID"

# 订阅流（后台抓事件名，先订后发）
python3 - "$ION_HOST_SOCKET" "$TEST_DIR/events.raw" "$SID" <<'PY' &
import socket, sys, time
sock, out, sid = sys.argv[1], sys.argv[2], sys.argv[3]
s = socket.socket(socket.AF_UNIX); s.settimeout(20)
s.connect(sock)
s.sendall(('{"method":"subscribe","session":"%s","replay":0}\n' % sid).encode())
buf=b""
with open(out,"wb") as f:
    deadline=time.time()+25
    while time.time()<deadline:
        try: d=s.recv(65536)
        except socket.timeout: break
        if not d: break
        buf+=d
        while b"\n" in buf:
            raw,buf=buf.split(b"\n",1)
            if raw.strip(): f.write(raw+b"\n"); f.flush()
PY
EV_PID=$!
sleep 1

P=$(wrpc prompt '{"text":"probe round one"}' | head -1)
log_ev rpc prompt "$(stof "$P")" "$(shape "$P")"
sleep 6   # 等 faux 跑完 agent_start..agent_end

# ── 4. 实例级方法批量探测 ──
# 只读方法
READ_METHODS=(
  get_state get_session_stats get_messages get_full_messages get_last_assistant_text
  get_session_messages list_inputs get_tree get_tree_with_leaf navigate_tree
  get_commands get_skills get_extensions get_tools get_all_tools get_active_tools
  get_available_models get_tier_models get_settings get_context_usage get_system_prompt
  get_queue get_flags get_flag_values get_agents get_current_agent get_agent_detail
  get_mcp_servers get_overview
)
for m in "${READ_METHODS[@]}"; do
    R=$(wrpc "$m" | head -1)
    ST=$(stof "$R")
    # 未知命令识别
    if printf '%s' "$R" | grep -qi "unknown command\|not supported\|unrecognized"; then ST="missing"; fi
    log_ev rpc "$m" "$ST" "$(shape "$R")"
done

# 带 params 的只读
R=$(wrpc get_file_diff '{}'); log_ev rpc get_file_diff "$(stof "$R")" "$(shape "$R")"
R=$(wrpc get_modified_files '{}'); log_ev rpc get_modified_files "$(stof "$R")" "$(shape "$R")"
R=$(wrpc get_batch_diffs '{}'); log_ev rpc get_batch_diffs "$(stof "$R")" "$(shape "$R")"
R=$(wrpc get_file_history '{}'); log_ev rpc get_file_history "$(stof "$R")" "$(shape "$R")"

# 写方法（throwaway 会话，直接打）
WRITE_PROBES=(
  "set_session_name|{\"name\":\"probe\"}"
  "set_thinking_level|{\"level\":\"low\"}"
  "cycle_thinking_level|{}"
  "set_steering_mode|{\"mode\":\"one-at-a-time\"}"
  "set_follow_up_mode|{\"mode\":\"one-at-a-time\"}"
  "clear_queue|{}"
  "promote_follow_up|{}"
  "set_auto_compaction|{\"enabled\":false}"
  "set_auto_retry|{\"enabled\":false}"
  "set_active_tools|{\"tools\":[\"read\",\"bash\"]}"
  "set_permission_mode|{\"mode\":\"blacklist\"}"
  "set_cwd|{\"cwd\":\"$TEST_DIR/proj\"}"
  "steer|{\"text\":\"steer probe\"}"
  "follow_up|{\"text\":\"fu probe\"}"
  "abort|{}"
  "reload|{}"
  "compact|{}"
  "delete_entries|{\"targetIds\":[\"nonexistent\"]}"
  "summarize_entries|{\"targetIds\":[\"nonexistent\"]}"
  "fork|{\"entryId\":\"nonexistent\"}"
  "clone|{}"
  "navigate_tree|{\"targetId\":\"nonexistent\"}"
  "preview_rollback|{\"targetId\":\"nonexistent\"}"
  "set_flag|{\"name\":\"probeFlag\",\"value\":true}"
  "append_session_name|{\"name\":\"probe2\"}"
)
for entry in "${WRITE_PROBES[@]}"; do
    m="${entry%%|*}"; p="${entry#*|}"
    R=$(wrpc "$m" "$p" | head -1)
    ST=$(stof "$R")
    if printf '%s' "$R" | grep -qi "unknown command\|not supported\|unrecognized"; then ST="missing"; fi
    log_ev rpc "$m" "$ST" "$(shape "$R")"
done

# tier/models
R=$(wrpc get_tier_models '{}'); log_ev rpc get_tier_models "$(stof "$R")" "$(shape "$R")"
R=$(wrpc set_tier_models '{"fast":"x","pro":"y","max":"z"}'); log_ev rpc set_tier_models "$(stof "$R")" "$(shape "$R")"
R=$(wrpc cycle_model '{}'); log_ev rpc cycle_model "$(stof "$R")" "$(shape "$R")"

# ── 4b. 第二批补测：pi 面上有、首轮漏测/需特殊参数的 ──
PROBE2=(
  "get_fork_messages|{}"
  "export_html|{}"
  "export|{}"
  "bash|{\"command\":\"echo probe\"}"
  "abort_bash|{}"
  "get_process_snapshot|{}"
  "get_messages|{\"from\":\"head\",\"limit\":1}"
  "get_messages|{\"limit\":1}"
  "get_turn_detail|{}"
  "turn_changes|{}"
  "get_agents_files|{}"
  "respond_ui|{}"
  "ui_respond|{}"
  "register_remote_tool|{}"
  "new_session|{}"
  "switch_session|{}"
  "set_model|{\"modelId\":\"glm-4.6\",\"provider\":\"zhipuai\"}"
  "append_custom_entry|{\"type\":\"probe\",\"data\":{}}"
)
for entry in "${PROBE2[@]}"; do
    m="${entry%%|*}"; p="${entry#*|}"
    R=$(wrpc "$m" "$p" | head -1)
    log_ev rpc2 "$m|$p" "$(stof "$R")" "$(shape "$R")"
done

# ui_respond 独立连接（G4：未 subscribe{ui:true} 的连接应被拒）
UR=$(python3 -c '
import socket, os, json
s = socket.socket(socket.AF_UNIX); s.settimeout(5)
s.connect(os.environ["ION_HOST_SOCKET"])
s.sendall(b"{\"method\":\"ui_respond\",\"params\":{\"request_id\":\"probe\",\"response\":{\"approved\":true}}}\n")
print(s.recv(65536).decode(errors="replace").strip())
')
log_ev ui ui_respond_cross_conn "$(printf '%s' "$UR" | grep -qi reject && echo rejected || echo accepted)" "$(printf '%s' "$UR" | head -c 200)"

# 扩展实名清单（get_extensions 全量）
EXT_NAMES=$(wrpc get_extensions | head -1 | jq -r '.data.extensions[].name' 2>/dev/null | sort | tr '\n' ' ')
log_ev ext names ok "$EXT_NAMES"

# ── 5. 扩展面（extension_rpc 路由存在性）──
for ext in memory rules-engine file-approval monitor hooks; do
    R=$(wrpc extension_rpc "{\"extension\":\"$ext\",\"method\":\"list\",\"args\":{}}" | head -1)
    ST=$(printf '%s' "$R" | grep -qi "not found\|no extension\|unknown" && echo missing || echo probed)
    log_ev ext "$ext" "$ST" "$(shape "$R")"
done

# ── 6. 事件流证据 ──
wait $EV_PID 2>/dev/null
if [ -s "$TEST_DIR/events.raw" ]; then
    # 提取事件类型名（instance_event 帧取嵌套 event.type；直接事件行取 .type）
    ET=$(jq -r 'select(.type=="instance_event") | .event.type // empty' "$TEST_DIR/events.raw" 2>/dev/null | sort -u)
    ET2=$(jq -r 'select(.type? and .type != "instance_event" and .type != "subscribed" and .type != "response") | .type' "$TEST_DIR/events.raw" 2>/dev/null | sort -u)
    log_ev events stream ok "instance_event: $(echo "$ET" | tr '\n' ' ')|direct: $(echo "$ET2" | tr '\n' ' ')"
    log_ev events stream_detail ok "$(head -3 "$TEST_DIR/events.raw" | jq -c '{type, keys:(keys)}' 2>/dev/null | tr '\n' ' ')"
else
    log_ev events stream empty "no events captured"
fi

echo "=== done: $OUT ===" >&2
wc -l "$OUT" >&2
