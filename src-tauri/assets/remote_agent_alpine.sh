#!/bin/sh
# NodeDeck Alpine / 轻量 NAT 零依赖 POSIX 采集、配置原子变更与宿主机多出口运维脚本（零远端落盘）
ACTION="${1:-overview}"
SB_CFG="${2:-/usr/local/etc/sing-box/config.json}"
EXTRA="${3:-}"
HOST_EXIT_API="http://10.10.0.1:19090/v1"

find_sb_bin() {
  for p in /usr/local/bin/sing-box /usr/bin/sing-box /root/sing-box; do
    if [ -x "$p" ]; then echo "$p"; return 0; fi
  done
  command -v sing-box 2>/dev/null || echo ""
}

resolve_sb_cfg() {
  if [ -f "$1" ]; then echo "$1"; return 0; fi
  for p in /usr/local/etc/sing-box/config.json /etc/sing-box/config.json; do
    if [ -f "$p" ]; then echo "$p"; return 0; fi
  done
  echo "$1"
}

http_get() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time "${2:-20}" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- -T "${2:-20}" "$1"
  else
    echo "ERROR: 容器缺少 curl/wget" >&2
    return 1
  fi
}

restart_sb() {
  if command -v rc-service >/dev/null 2>&1 && (rc-service -e sing-box >/dev/null 2>&1 || [ -x /etc/init.d/sing-box ]); then
    rc-service sing-box restart
  elif command -v systemctl >/dev/null 2>&1; then
    systemctl restart sing-box
  else
    echo "未检测到 OpenRC/systemd sing-box 服务，请通过官方 Web 终端手动重启" >&2
    return 1
  fi
}

check_sb_cfg() {
  SB_BIN=$(find_sb_bin)
  [ -z "$SB_BIN" ] && echo "ERROR: 未找到 sing-box 可执行文件" >&2 && return 1
  TARGET="$1"
  RELAY_CFG="$(dirname "$SB_CFG")/relay.json"
  if [ -f "$RELAY_CFG" ]; then
    "$SB_BIN" check -c "$TARGET" -c "$RELAY_CFG"
  else
    "$SB_BIN" check -c "$TARGET"
  fi
}

SB_CFG=$(resolve_sb_cfg "$SB_CFG")
SB_DIR=$(dirname "$SB_CFG")

if [ "$ACTION" = "overview" ]; then
  OS_NAME=$(grep -m1 '^PRETTY_NAME=' /etc/os-release 2>/dev/null | cut -d= -f2- | tr -d '"')
  [ -z "$OS_NAME" ] && OS_NAME="Alpine Linux"
  KERNEL=$(uname -r 2>/dev/null || echo "unknown")
  UPTIME_SEC=$(awk '{print int($1)}' /proc/uptime 2>/dev/null || echo 0)
  LOAD=$(awk '{print $1" "$2" "$3}' /proc/loadavg 2>/dev/null || echo "0 0 0")

  CPU1=$(awk '/^cpu / {print $5, $2+$3+$4+$5+$6+$7+$8+$9}' /proc/stat)
  sleep 0.15
  CPU2=$(awk '/^cpu / {print $5, $2+$3+$4+$5+$6+$7+$8+$9}' /proc/stat)
  CPU_PCT=$(awk -v c1="$CPU1" -v c2="$CPU2" 'BEGIN {
    split(c1,a," "); split(c2,b," ");
    dt = b[2] - a[2]; if (dt <= 0) dt = 1;
    di = b[1] - a[1];
    printf "%.1f", 100.0 * (1.0 - di / dt);
  }')

  MEM_LINE=$(awk '
    /^MemTotal:/ {t=$2}
    /^MemAvailable:/ {a=$2}
    /^MemFree:/ {f=$2}
    END { if (!a) a=f; u=t-a; if (u<0) u=0; printf "%d %d", t*1024, u*1024 }
  ' /proc/meminfo)
  MEM_TOTAL=$(echo "$MEM_LINE" | awk '{print $1}')
  MEM_USED=$(echo "$MEM_LINE" | awk '{print $2}')

  DISK_LINE=$(df -k / 2>/dev/null | awk 'NR==2 {printf "%d %d %d", $2*1024, $3*1024, $4*1024}')
  DISK_TOTAL=$(echo "$DISK_LINE" | awk '{print $1}')
  DISK_USED=$(echo "$DISK_LINE" | awk '{print $2}')
  DISK_FREE=$(echo "$DISK_LINE" | awk '{print $3}')

  NET_LINE=$(awk 'NR>2 && $1 !~ /^lo:/ {gsub(/:/,"",$1); printf "%s %s %s", $1, $2, $10; exit}' /proc/net/dev)
  IFACE=$(echo "$NET_LINE" | awk '{print $1}')
  RX_BYTES=$(echo "$NET_LINE" | awk '{print $2}')
  TX_BYTES=$(echo "$NET_LINE" | awk '{print $3}')

  SB_BIN=$(find_sb_bin)
  SB_PID=$(pidof sing-box 2>/dev/null | awk '{print $1}')
  SB_ACTIVE="false"
  SB_RSS=0
  if [ -n "$SB_PID" ]; then
    SB_ACTIVE="true"
    SB_RSS=$(awk '/^VmRSS:/ {print $2*1024}' "/proc/$SB_PID/status" 2>/dev/null || echo 0)
  fi
  SB_VER="未检测到"
  if [ -n "$SB_BIN" ]; then
    SB_VER=$("$SB_BIN" version 2>/dev/null | head -n 1)
  fi
  CFG_EXISTS="false"
  [ -f "$SB_CFG" ] && CFG_EXISTS="true"

  echo "OS=$OS_NAME"
  echo "KERNEL=$KERNEL"
  echo "UPTIME=$UPTIME_SEC"
  echo "LOAD=$LOAD"
  echo "CPU_PCT=$CPU_PCT"
  echo "MEM_TOTAL=${MEM_TOTAL:-0}"
  echo "MEM_USED=${MEM_USED:-0}"
  echo "DISK_TOTAL=${DISK_TOTAL:-0}"
  echo "DISK_USED=${DISK_USED:-0}"
  echo "DISK_FREE=${DISK_FREE:-0}"
  echo "IFACE=${IFACE:-eth0}"
  echo "RX_BYTES=${RX_BYTES:-0}"
  echo "TX_BYTES=${TX_BYTES:-0}"
  echo "SB_ACTIVE=$SB_ACTIVE"
  echo "SB_PID=${SB_PID:-}"
  echo "SB_RSS=${SB_RSS:-0}"
  echo "SB_VER=$SB_VER"
  echo "CFG_EXISTS=$CFG_EXISTS"
  echo "CFG_PATH=$SB_CFG"
  exit 0
fi

if [ "$ACTION" = "config" ]; then
  if [ ! -f "$SB_CFG" ]; then
    echo "ERROR: 配置文件不存在 ($SB_CFG)" >&2
    exit 1
  fi
  cat "$SB_CFG"
  exit 0
fi

if [ "$ACTION" = "config_bundle" ]; then
  if [ ! -f "$SB_CFG" ]; then
    echo "ERROR: 配置文件不存在 ($SB_CFG)" >&2
    exit 1
  fi
  cat "$SB_CFG"
  printf '\n===NODEDECK_BACKUPS===\n'
  ls -1r "$SB_DIR"/config.json.bak.* 2>/dev/null | head -n 12 | while read -r f; do
    basename "$f"
  done
  exit 0
fi

extract_clash_field() {
  # 从 sing-box config.json 的 clash_api 段提取 external_controller / secret（纯 POSIX awk）
  awk -v key="$1" '
    /"clash_api"/ { in_ca=1 }
    in_ca && $0 ~ ("\"" key "\"") {
      line=$0
      sub(".*\"" key "\"[ \t]*:[ \t]*\"", "", line)
      sub("\".*", "", line)
      print line
      exit
    }
    in_ca && /}/ { in_ca=0 }
  ' "$SB_CFG" 2>/dev/null
}

if [ "$ACTION" = "clash_info" ]; then
  if [ ! -f "$SB_CFG" ]; then
    echo "ERROR: 配置文件不存在 ($SB_CFG)" >&2
    exit 1
  fi
  echo "ADDR=$(extract_clash_field "external_controller")"
  echo "SECRET=$(extract_clash_field "secret")"
  exit 0
fi

if [ "$ACTION" = "audit_bundle" ]; then
  if [ ! -f "$SB_CFG" ]; then
    echo "ERROR: 配置文件不存在 ($SB_CFG)" >&2
    exit 1
  fi
  cat "$SB_CFG"
  printf '\n===NODEDECK_AUDIT===\n'
  ADDR=$(extract_clash_field "external_controller")
  SEC=$(extract_clash_field "secret")
  if [ -n "$ADDR" ] && command -v curl >/dev/null 2>&1; then
    if [ -n "$SEC" ]; then
      curl -fsS --max-time 4 -H "Authorization: Bearer $SEC" "http://${ADDR}/connections" 2>/dev/null || echo "{}"
    else
      curl -fsS --max-time 4 "http://${ADDR}/connections" 2>/dev/null || echo "{}"
    fi
  fi
  printf '\n===NODEDECK_LEDGER===\n'
  L_INST="false"
  L_ACT="false"
  [ -x /usr/local/bin/nodedeck-ledger.sh ] && [ -x /etc/init.d/nodedeck-ledger ] && L_INST="true"
  if command -v rc-service >/dev/null 2>&1 && rc-service nodedeck-ledger status >/dev/null 2>&1; then
    L_ACT="true"
  elif [ -f /run/nodedeck-ledger.pid ] && kill -0 "$(cat /run/nodedeck-ledger.pid 2>/dev/null)" 2>/dev/null; then
    L_ACT="true"
  fi
  echo "INSTALLED=$L_INST"
  echo "ACTIVE=$L_ACT"
  printf '\n===NODEDECK_LEDGER_JSON===\n'
  LEDGER_JSON="${SB_DIR}/traffic_ledger.json"
  if [ -f "$LEDGER_JSON" ]; then
    cat "$LEDGER_JSON"
  else
    echo "{}"
  fi
  exit 0
fi

if [ "$ACTION" = "ledger_install" ]; then
  [ ! -f "$SB_CFG" ] && echo "ERROR: 配置文件不存在 ($SB_CFG)" >&2 && exit 1
  ADDR=$(extract_clash_field "external_controller")
  [ -z "$ADDR" ] && echo "ERROR: 请先开启该 NAT 的 127.0.0.1 本地统计接口" >&2 && exit 1
  mkdir -p /usr/local/bin /etc/init.d /run 2>/dev/null || true

  cat <<'NODEDECK_LEDGER_EOF' > /usr/local/bin/nodedeck-ledger.sh
#!/bin/sh
SB_CFG="${1:-/usr/local/etc/sing-box/config.json}"
SB_DIR=$(dirname "$SB_CFG")
TSV="${SB_DIR}/.nodedeck_ledger.tsv"
META="${SB_DIR}/.nodedeck_ledger.meta"
JSON="${SB_DIR}/traffic_ledger.json"
PREV="/run/nodedeck-ledger.prev"
CUR_FILE="/run/nodedeck-ledger.cur"
POLL_SEC=10
FLUSH_TICKS=3

mkdir -p /run 2>/dev/null || true

extract_clash_field() {
  awk -v key="$1" '
    /"clash_api"/ { in_ca=1 }
    in_ca && $0 ~ ("\"" key "\"") {
      line=$0
      sub(".*\"" key "\"[ \t]*:[ \t]*\"", "", line)
      sub("\".*", "", line)
      print line
      exit
    }
    in_ca && /}/ { in_ca=0 }
  ' "$SB_CFG" 2>/dev/null
}

write_json() {
  NOW_TS=$(date +%s)
  CUR_DAY=$(date +%Y-%m-%d)
  CUR_MON=$(date +%Y-%m)
  TMP="${JSON}.tmp"
  awk -F'\t' -v now="$NOW_TS" -v day="$CUR_DAY" -v mon="$CUR_MON" '
    function jesc(s) {
      gsub(/\\/, "\\\\", s)
      gsub(/"/, "\\\"", s)
      return s
    }
    BEGIN {
      printf "{\"version\":1,\"updatedAt\":%s,\"day\":\"%s\",\"month\":\"%s\",\"users\":{", now, day, mon
      first = 1
    }
    NF >= 7 && $1 != "" {
      if (!first) printf ","
      first = 0
      printf "\"%s\":{\"todayUp\":%.0f,\"todayDown\":%.0f,\"monthUp\":%.0f,\"monthDown\":%.0f,\"totalUp\":%.0f,\"totalDown\":%.0f}",
        jesc($1), $2+0, $3+0, $4+0, $5+0, $6+0, $7+0
    }
    END { printf "}}\n" }
  ' "$TSV" > "$TMP" 2>/dev/null && chmod 600 "$TMP" 2>/dev/null && mv -f "$TMP" "$JSON"
  printf '%s\t%s\t%s\n' "$CUR_DAY" "$CUR_MON" "$NOW_TS" > "${META}.tmp" && mv -f "${META}.tmp" "$META"
}

trap 'write_json; exit 0' TERM INT

[ -f "$TSV" ] || : > "$TSV"
chmod 600 "$TSV" 2>/dev/null || true

SEED_ONLY=0
if [ -f "$META" ]; then
  LAST_TS=$(awk -F'\t' 'NR==1{print $3+0}' "$META" 2>/dev/null)
  NOW_BOOT=$(date +%s)
  if [ -n "$LAST_TS" ] && [ $((NOW_BOOT - LAST_TS)) -lt 120 ] && [ $((NOW_BOOT - LAST_TS)) -ge 0 ]; then
    SEED_ONLY=1
  fi
fi
: > "$PREV"
write_json

SINCE_FLUSH=3
DIRTY=0
while true; do
  ADDR=$(extract_clash_field "external_controller")
  SEC=$(extract_clash_field "secret")
  CUR_DAY=$(date +%Y-%m-%d)
  CUR_MON=$(date +%Y-%m)
  PREV_DAY=$(awk -F'\t' 'NR==1{print $1}' "$META" 2>/dev/null)
  PREV_MON=$(awk -F'\t' 'NR==1{print $2}' "$META" 2>/dev/null)

  if [ -n "$PREV_DAY" ] && [ "$PREV_DAY" != "$CUR_DAY" ]; then
    RESET_MON=0
    [ "$PREV_MON" != "$CUR_MON" ] && RESET_MON=1
    awk -F'\t' -v OFS='\t' -v reset_mon="$RESET_MON" '
      NF >= 7 {
        $2=0; $3=0
        if (reset_mon == 1) { $4=0; $5=0 }
        print $1,$2,$3,$4,$5,$6,$7
      }
    ' "$TSV" > "${TSV}.tmp" && mv -f "${TSV}.tmp" "$TSV"
    write_json
    DIRTY=0
    SINCE_FLUSH=0
  fi

  if [ -n "$ADDR" ] && command -v curl >/dev/null 2>&1; then
    if [ -n "$SEC" ]; then
      BODY=$(curl -fsS --max-time 4 -H "Authorization: Bearer $SEC" "http://${ADDR}/connections" 2>/dev/null)
    else
      BODY=$(curl -fsS --max-time 4 "http://${ADDR}/connections" 2>/dev/null)
    fi
    if [ -n "$BODY" ]; then
      printf '%s\n' "$BODY" | awk '
        function jstr(src, key,   p, r, q) {
          p = index(src, "\"" key "\":\"")
          if (p == 0) return ""
          r = substr(src, p + length(key) + 4)
          q = index(r, "\"")
          if (q <= 1) return ""
          return substr(r, 1, q - 1)
        }
        function jnum(src, key,   p, r) {
          p = index(src, "\"" key "\":")
          if (p == 0) return 0
          r = substr(src, p + length(key) + 3)
          if (match(r, /^[0-9]+/)) return substr(r, 1, RLENGTH) + 0
          return 0
        }
        {
          s = $0
          pos = index(s, "\"connections\":[")
          if (pos == 0) exit
          s = substr(s, pos + 15)
          depth = 0; in_str = 0; esc_ch = 0; obj_start = 0; slen = length(s)
          for (k = 1; k <= slen; k++) {
            ch = substr(s, k, 1)
            if (in_str) {
              if (esc_ch) { esc_ch = 0 }
              else if (ch == "\\") { esc_ch = 1 }
              else if (ch == "\"") { in_str = 0 }
              continue
            }
            if (ch == "\"") { in_str = 1; continue }
            if (ch == "]" && depth == 0) break
            if (ch == "{") {
              if (depth == 0) obj_start = k
              depth++
            } else if (ch == "}") {
              depth--
              if (depth == 0 && obj_start > 0) {
                c = substr(s, obj_start, k - obj_start + 1)
                obj_start = 0
                cid = jstr(c, "id")
                if (cid == "") continue
                up = jnum(c, "upload")
                dn = jnum(c, "download")
                u = jstr(c, "user")
                if (u == "") u = jstr(c, "inboundUser")
                if (u == "") u = jstr(c, "authUser")
                if (u == "") {
                  ap = index(c, "auth_user=")
                  if (ap > 0) {
                    rest = substr(c, ap + 10)
                    if (substr(rest, 1, 1) == "[") rest = substr(rest, 2)
                    split(rest, utmp, "\""); rest = utmp[1]
                    split(rest, utmp, "]"); rest = utmp[1]
                    split(rest, utmp, ","); rest = utmp[1]
                    split(rest, utmp, " "); u = utmp[1]
                  }
                }
                if (u == "") {
                  rp = jstr(c, "rulePayload")
                  if (rp != "" && index(rp, "/") == 0 && rp !~ /^[0-9.:]+$/) u = rp
                }
                if (u == "") u = "默认用户"
                printf "%s\t%s\t%.0f\t%.0f\n", cid, u, up, dn
              }
            }
          }
        }
      ' > "$CUR_FILE"

      if [ "$SEED_ONLY" = "1" ]; then
        awk -F'\t' -v OFS='\t' '{print $1,$3,$4}' "$CUR_FILE" > "$PREV"
        SEED_ONLY=0
      else
        CHANGED=$(awk -F'\t' -v OFS='\t' -v out_tsv="${TSV}.tmp" '
          FILENAME == ARGV[1] {
            if (NF >= 3) { pu[$1] = $2 + 0; pd[$1] = $3 + 0; seen[$1] = 1 }
            next
          }
          FILENAME == ARGV[2] {
            if (NF >= 7 && $1 != "") {
              tu[$1]=$2+0; td[$1]=$3+0; mu[$1]=$4+0; md[$1]=$5+0; au[$1]=$6+0; ad[$1]=$7+0; uk[$1]=1
            }
            next
          }
          {
            cid=$1; u=$2; cu=$3+0; cd=$4+0
            if (seen[cid]) {
              du = (cu >= pu[cid]) ? (cu - pu[cid]) : cu
              dd = (cd >= pd[cid]) ? (cd - pd[cid]) : cd
            } else {
              du = cu; dd = cd
            }
            if (du > 0 || dd > 0) {
              tu[u] += du; td[u] += dd
              mu[u] += du; md[u] += dd
              au[u] += du; ad[u] += dd
              uk[u] = 1
              chg = 1
            }
          }
          END {
            for (u in uk) {
              printf "%s\t%.0f\t%.0f\t%.0f\t%.0f\t%.0f\t%.0f\n", u, tu[u], td[u], mu[u], md[u], au[u], ad[u] > out_tsv
            }
            print (chg ? "1" : "0")
          }
        ' "$PREV" "$TSV" "$CUR_FILE" 2>/dev/null)
        if [ -f "${TSV}.tmp" ]; then
          mv -f "${TSV}.tmp" "$TSV"
          chmod 600 "$TSV" 2>/dev/null || true
        fi
        awk -F'\t' -v OFS='\t' '{print $1,$3,$4}' "$CUR_FILE" > "$PREV"
        [ "$CHANGED" = "1" ] && DIRTY=1
      fi
    fi
  fi

  SINCE_FLUSH=$((SINCE_FLUSH + 1))
  if [ "$DIRTY" = "1" ] && [ "$SINCE_FLUSH" -ge "$FLUSH_TICKS" ]; then
    write_json
    DIRTY=0
    SINCE_FLUSH=0
  fi
  sleep "$POLL_SEC"
done
NODEDECK_LEDGER_EOF
  chmod 700 /usr/local/bin/nodedeck-ledger.sh

  cat <<NODEDECK_INIT_EOF > /etc/init.d/nodedeck-ledger
#!/sbin/openrc-run
description="NodeDeck Per-Member Persistent Traffic Ledger"
command="/bin/sh"
command_args="/usr/local/bin/nodedeck-ledger.sh ${SB_CFG}"
supervisor="supervise-daemon"
respawn_delay=5
respawn_max=0
pidfile="/run/nodedeck-ledger.pid"

depend() {
    need net
    after sing-box
}
NODEDECK_INIT_EOF
  chmod 755 /etc/init.d/nodedeck-ledger

  if command -v rc-update >/dev/null 2>&1; then
    rc-update add nodedeck-ledger default >/dev/null 2>&1 || true
  fi
  if command -v rc-service >/dev/null 2>&1; then
    rc-service nodedeck-ledger restart >/dev/null 2>&1 || rc-service nodedeck-ledger start
  else
    echo "ERROR: 未检测到 OpenRC rc-service" >&2
    exit 1
  fi
  echo "已安装并启动 Alpine 超轻持久化流量账本（BusyBox sh+awk，常驻内存 <1.5 MB）"
  exit 0
fi

if [ "$ACTION" = "ledger_disable" ]; then
  if command -v rc-service >/dev/null 2>&1 && [ -x /etc/init.d/nodedeck-ledger ]; then
    rc-service nodedeck-ledger stop >/dev/null 2>&1 || true
  fi
  if command -v rc-update >/dev/null 2>&1; then
    rc-update del nodedeck-ledger default >/dev/null 2>&1 || true
  fi
  echo "已停用 Alpine 持久化流量账本（历史统计文件已保留）"
  exit 0
fi

if [ "$ACTION" = "ledger_reset" ]; then
  SCOPE=$(printf '%s' "$EXTRA" | cut -d'|' -f1)
  UNAME=$(printf '%s' "$EXTRA" | cut -d'|' -f2-)
  [ -z "$UNAME" ] && echo "ERROR: 缺少要清零的用户名" >&2 && exit 1
  TSV="${SB_DIR}/.nodedeck_ledger.tsv"
  JSON="${SB_DIR}/traffic_ledger.json"
  META="${SB_DIR}/.nodedeck_ledger.meta"
  WAS_ACTIVE=0
  if command -v rc-service >/dev/null 2>&1 && rc-service nodedeck-ledger status >/dev/null 2>&1; then
    WAS_ACTIVE=1
    rc-service nodedeck-ledger stop >/dev/null 2>&1 || true
  fi
  if [ -f "$TSV" ]; then
    awk -F'\t' -v OFS='\t' -v target="$UNAME" -v scope="$SCOPE" '
      NF >= 7 {
        if (target == "__ALL__" || $1 == target) {
          $2=0; $3=0; $4=0; $5=0
          if (scope == "all") { $6=0; $7=0 }
        }
        print $1,$2,$3,$4,$5,$6,$7
      }
    ' "$TSV" > "${TSV}.tmp" && mv -f "${TSV}.tmp" "$TSV"
  else
    : > "$TSV"
  fi
  NOW_TS=$(date +%s)
  CUR_DAY=$(date +%Y-%m-%d)
  CUR_MON=$(date +%Y-%m)
  awk -F'\t' -v now="$NOW_TS" -v day="$CUR_DAY" -v mon="$CUR_MON" '
    function jesc(s) { gsub(/\\/, "\\\\", s); gsub(/"/, "\\\"", s); return s }
    BEGIN { printf "{\"version\":1,\"updatedAt\":%s,\"day\":\"%s\",\"month\":\"%s\",\"users\":{", now, day, mon; first=1 }
    NF >= 7 && $1 != "" {
      if (!first) printf ","; first=0
      printf "\"%s\":{\"todayUp\":%.0f,\"todayDown\":%.0f,\"monthUp\":%.0f,\"monthDown\":%.0f,\"totalUp\":%.0f,\"totalDown\":%.0f}",
        jesc($1), $2+0, $3+0, $4+0, $5+0, $6+0, $7+0
    }
    END { printf "}}\n" }
  ' "$TSV" > "${JSON}.tmp" && mv -f "${JSON}.tmp" "$JSON"
  printf '%s\t%s\t%s\n' "$CUR_DAY" "$CUR_MON" "$NOW_TS" > "${META}.tmp" && mv -f "${META}.tmp" "$META"
  if [ "$WAS_ACTIVE" = "1" ]; then
    rc-service nodedeck-ledger start >/dev/null 2>&1 || true
  fi
  if [ "$UNAME" = "__ALL__" ]; then
    echo "已清零全部成员的账本统计"
  else
    echo "已清零成员「${UNAME}」的账本统计"
  fi
  exit 0
fi

if [ "$ACTION" = "close_conn_auto" ]; then
  if [ ! -f "$SB_CFG" ]; then
    echo "ERROR: 配置文件不存在 ($SB_CFG)" >&2
    exit 1
  fi
  ADDR=$(extract_clash_field "external_controller")
  SEC=$(extract_clash_field "secret")
  CID="$EXTRA"
  [ -z "$ADDR" ] && echo "ERROR: 本机统计接口未开启" >&2 && exit 1
  if [ "$CID" = "__ALL__" ]; then
    TARGET_URL="http://${ADDR}/connections"
  else
    TARGET_URL="http://${ADDR}/connections/${CID}"
  fi
  if command -v curl >/dev/null 2>&1; then
    if [ -n "$SEC" ]; then
      curl -fsS --max-time 4 -X DELETE -H "Authorization: Bearer $SEC" "$TARGET_URL"
    else
      curl -fsS --max-time 4 -X DELETE "$TARGET_URL"
    fi
  else
    echo "ERROR: 容器缺少 curl" >&2
    exit 1
  fi
  exit $?
fi

if [ "$ACTION" = "backups" ]; then
  ls -1r "$SB_DIR"/config.json.bak.* 2>/dev/null | head -n 12 | while read -r f; do
    basename "$f"
  done
  exit 0
fi

if [ "$ACTION" = "gen_reality" ]; then
  SB_BIN=$(find_sb_bin)
  [ -z "$SB_BIN" ] && echo "ERROR: 未找到 sing-box 可执行文件" >&2 && exit 1
  "$SB_BIN" generate reality-keypair
  exit $?
fi

if [ "$ACTION" = "apply_config" ]; then
  [ -z "$EXTRA" ] && echo "ERROR: 缺少配置内容" >&2 && exit 1
  [ ! -f "$SB_CFG" ] && echo "ERROR: 目标配置文件不存在 ($SB_CFG)" >&2 && exit 1
  TS=$(date +%Y%m%d_%H%M%S)
  BAK="${SB_CFG}.bak.${TS}"
  TMP="${SB_DIR}/.config.json.tmp"
  cp -p "$SB_CFG" "$BAK" || { echo "ERROR: 创建备份失败" >&2; exit 1; }
  printf '%s' "$EXTRA" | base64 -d > "$TMP" 2>/dev/null || { rm -f "$TMP"; echo "ERROR: 解码配置失败" >&2; exit 1; }
  chmod 600 "$TMP" 2>/dev/null || true

  if ! check_sb_cfg "$TMP"; then
    rm -f "$TMP"
    echo "ERROR: sing-box 语法校验未通过，已取消本次修改" >&2
    exit 1
  fi

  mv -f "$TMP" "$SB_CFG"
  chmod 600 "$SB_CFG" 2>/dev/null || true

  if ! restart_sb; then
    cp -p "$BAK" "$SB_CFG"
    restart_sb >/dev/null 2>&1 || true
    echo "ERROR: sing-box 重启失败，已自动回滚至 $(basename "$BAK")" >&2
    exit 1
  fi

  # 自动滚动清理，仅保留最近 10 份历史备份
  CNT=0
  for bf in $(ls -1r "$SB_DIR"/config.json.bak.* 2>/dev/null); do
    CNT=$((CNT + 1))
    if [ "$CNT" -gt 10 ]; then
      rm -f "$bf" 2>/dev/null || true
    fi
  done

  echo "BACKUP=$(basename "$BAK")"
  exit 0
fi

if [ "$ACTION" = "restore_backup" ]; then
  BAK_NAME=$(basename "$EXTRA")
  case "$BAK_NAME" in
    config.json.bak.*) ;;
    *) echo "ERROR: 非法备份文件名" >&2; exit 1 ;;
  esac
  BAK_FULL="${SB_DIR}/${BAK_NAME}"
  [ ! -f "$BAK_FULL" ] && echo "ERROR: 备份文件不存在 ($BAK_NAME)" >&2 && exit 1
  if ! check_sb_cfg "$BAK_FULL"; then
    echo "ERROR: 该备份语法校验失败，已取消回滚" >&2
    exit 1
  fi
  cp -p "$BAK_FULL" "$SB_CFG"
  chmod 600 "$SB_CFG" 2>/dev/null || true
  restart_sb || exit 1
  echo "已恢复历史备份 $BAK_NAME 并重启 sing-box"
  exit 0
fi

if [ "$ACTION" = "check" ]; then
  RELAY_CFG="${SB_DIR}/relay.json"
  if check_sb_cfg "$SB_CFG"; then
    if [ -f "$RELAY_CFG" ]; then
      echo "Alpine sing-box 配置语法 100% 校验通过（含 relay.json）"
    else
      echo "Alpine sing-box 配置语法 100% 校验通过"
    fi
    exit 0
  fi
  exit 1
fi

if [ "$ACTION" = "restart" ]; then
  restart_sb
  exit $?
fi

if [ "$ACTION" = "ports" ]; then
  (ss -tulnp 2>/dev/null || netstat -tulnp 2>/dev/null)
  exit 0
fi

if [ "$ACTION" = "logs" ]; then
  LINES="${EXTRA:-150}"
  case "$LINES" in ''|*[!0-9]*) LINES=150 ;; esac
  for lf in /var/log/sing-box.log /var/log/sing-box/sing-box.log; do
    if [ -f "$lf" ]; then
      tail -n "$LINES" "$lf"
      exit 0
    fi
  done
  if command -v journalctl >/dev/null 2>&1; then
    journalctl -u sing-box -n "$LINES" --no-pager 2>/dev/null && exit 0
  fi
  echo "(未找到 /var/log/sing-box.log，可点击上方按钮打开官方 Web 终端查看实时输出)"
  exit 0
fi

if [ "$ACTION" = "audit" ]; then
  ADDR=$(printf '%s' "$EXTRA" | cut -d'|' -f1)
  SEC=$(printf '%s' "$EXTRA" | cut -d'|' -f2)
  [ -z "$ADDR" ] && echo "ERROR: 缺少本地统计地址" >&2 && exit 1
  if command -v curl >/dev/null 2>&1; then
    if [ -n "$SEC" ]; then
      curl -fsS --max-time 4 -H "Authorization: Bearer $SEC" "http://${ADDR}/connections"
    else
      curl -fsS --max-time 4 "http://${ADDR}/connections"
    fi
  else
    echo "ERROR: 容器缺少 curl，无法查询本地统计接口" >&2
    exit 1
  fi
  exit $?
fi

if [ "$ACTION" = "close_conn" ]; then
  ADDR=$(printf '%s' "$EXTRA" | cut -d'|' -f1)
  SEC=$(printf '%s' "$EXTRA" | cut -d'|' -f2)
  CID=$(printf '%s' "$EXTRA" | cut -d'|' -f3)
  [ -z "$ADDR" ] && echo "ERROR: 缺少本地统计地址" >&2 && exit 1
  if [ "$CID" = "__ALL__" ]; then
    TARGET_URL="http://${ADDR}/connections"
  else
    TARGET_URL="http://${ADDR}/connections/${CID}"
  fi
  if command -v curl >/dev/null 2>&1; then
    if [ -n "$SEC" ]; then
      curl -fsS --max-time 4 -X DELETE -H "Authorization: Bearer $SEC" "$TARGET_URL"
    else
      curl -fsS --max-time 4 -X DELETE "$TARGET_URL"
    fi
  else
    echo "ERROR: 容器缺少 curl" >&2
    exit 1
  fi
  exit $?
fi

if [ "$ACTION" = "exit_status" ]; then
  OUT=$(http_get "${HOST_EXIT_API}/usage" 10 2>/dev/null || true)
  if [ -n "$OUT" ] && printf '%s' "$OUT" | grep -q '当前出口'; then
    echo "KIND=global"
    printf '%s\n' "$OUT"
    exit 0
  fi
  OUT2=$(http_get "${HOST_EXIT_API}/status" 10 2>/dev/null || true)
  if [ -n "$OUT2" ] && printf '%s' "$OUT2" | grep -q '"mode"'; then
    echo "KIND=jp"
    printf '%s\n' "$OUT2"
    exit 0
  fi
  echo "KIND=none"
  exit 0
fi

if [ "$ACTION" = "exit_latency" ]; then
  http_get "${HOST_EXIT_API}/latency" 20
  exit $?
fi

if [ "$ACTION" = "exit_switch" ]; then
  case "$EXTRA" in
    au|my|hgc|hkt|kr|jp|mo|us|mos|sgv|direct) ;;
    *) echo "ERROR: 不支持的出口代号 $EXTRA" >&2; exit 2 ;;
  esac
  RES=$(http_get "${HOST_EXIT_API}/switch/${EXTRA}" 20)
  printf '%s' "$RES" | grep -q '"ok"[ ]*:[ ]*true' || { echo "ERROR: 宿主机返回切换失败: $RES" >&2; exit 1; }
  echo "$RES"
  exit 0
fi

if [ "$ACTION" = "exit_diag" ]; then
  OUT=$(http_get "${HOST_EXIT_API}/diagnostics" 120 2>/dev/null || true)
  if [ -n "$OUT" ]; then
    printf '%s\n' "$OUT"
    exit 0
  fi
  http_get "${HOST_EXIT_API}/test" 120
  exit $?
fi

echo "ERROR: 未知动作 $ACTION" >&2
exit 1
