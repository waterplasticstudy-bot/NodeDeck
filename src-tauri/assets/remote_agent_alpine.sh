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
