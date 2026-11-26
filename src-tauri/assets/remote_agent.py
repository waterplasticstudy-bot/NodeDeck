"""NodeDeck 远端 VPS 采集与配置守护脚本（经持久加密 SSH 管道按行 JSON-RPC 运行，零远端落盘）。"""

import base64
import datetime
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
import uuid

# ---------- 集中常量定义（铁律 #2） ----------
SINGBOX_BIN = "/usr/local/bin/sing-box"          # VPS sing-box 可执行文件路径
SINGBOX_DIR = "/etc/sing-box"                    # sing-box 配置目录
CONFIG_PATH = "/etc/sing-box/config.json"        # sing-box 主配置文件
TMP_CONFIG_PATH = "/etc/sing-box/.config.json.tmp"  # 原子写入校验临时文件
DISABLED_USERS_PATH = "/etc/sing-box/disabled_users.json"  # 已暂停成员归档文件
BACKUP_PREFIX = "config.json.bak."               # 自动备份文件前缀
MAX_BACKUP_KEEP = 10                             # 自动滚动保留的备份份数
MAX_BACKUP_VIEW = 12                             # 前端界面展示的最近备份条数
SECURITY_CACHE_TTL_SEC = 60                      # 安全体检（UFW/fail2ban/last）缓存秒数
MAX_AUDIT_CONNECTIONS = 200                      # 审计接口返回的最大实时连接条数
DEFAULT_LISTEN_PORT = 8443                       # 默认主入站端口
DEFAULT_SNI = "www.microsoft.com"                # 默认 Reality 伪装域名
DEFAULT_VLESS_FLOW = "xtls-rprx-vision"          # 默认 VLESS 流控
SS2022_METHOD = "2022-blake3-aes-128-gcm"        # 新增 Shadowsocks-2022 加密套件
IPINFO_URL = "https://ipinfo.io/json"            # 出口 IP 主查询接口
IPAPI_URL = (
    "http://ip-api.com/json/?fields=status,country,countryCode,regionName,city,"
    "isp,org,as,timezone,lat,lon,mobile,proxy,hosting,query"
)                                                # 出口 IP 风险属性交叉校验接口

# 位置历史上报域名过滤规则（VPS 侧可选路由规则）
ANTI_CHINA_DOMAINS = [
    "locationhistory-pa.googleapis.com",
    "footprints-pa.googleapis.com",
    "timeline.google.com",
    "locationreporting-pa.googleapis.com",
    "geomobileservices-pa.googleapis.com",
]
SUSPICIOUS_LOCATION_RE = re.compile(
    r"(locationhistory|geolocation|geomobileservices|footprints-pa|timeline\.google|locationreporting)",
    re.I,
)

STATE = {
    "cpu_prev": None,
    "sec_cache": None,
    "sec_ts": 0.0,
    "os_name": None,
    "sb_ver": None,
    "iface": None,
}


def run_cmd(cmd, timeout=8):
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return proc.stdout.strip(), proc.stderr.strip(), proc.returncode
    except Exception as exc:
        return "", str(exc), 1


def read_cpu_stat():
    with open("/proc/stat", "r", encoding="utf-8") as f:
        parts = [int(x) for x in f.readline().split()[1:9]]
    return parts[3] + parts[4], sum(parts)


def get_cpu_pct():
    now = read_cpu_stat()
    prev = STATE["cpu_prev"]
    STATE["cpu_prev"] = now
    if prev is None:
        time.sleep(0.12)
        now2 = read_cpu_stat()
        STATE["cpu_prev"] = now2
        dt = max(1, now2[1] - now[1])
        return round(100.0 * (1.0 - (now2[0] - now[0]) / dt), 1)
    dt = max(1, now[1] - prev[1])
    return round(100.0 * (1.0 - (now[0] - prev[0]) / dt), 1)


def get_os_name():
    if STATE["os_name"]:
        return STATE["os_name"]
    name = "Ubuntu"
    if os.path.exists("/etc/os-release"):
        with open("/etc/os-release", "r", encoding="utf-8") as f:
            for line in f:
                if line.startswith("PRETTY_NAME="):
                    name = line.split("=", 1)[1].strip().strip('"')
                    break
    STATE["os_name"] = name
    return name


def get_sb_ver():
    if STATE["sb_ver"]:
        return STATE["sb_ver"]
    out, _, _ = run_cmd([SINGBOX_BIN, "version"])
    STATE["sb_ver"] = out.splitlines()[0] if out else "unknown"
    return STATE["sb_ver"]


def get_iface():
    if STATE["iface"]:
        return STATE["iface"]
    out, _, _ = run_cmd(["ip", "route", "get", "1.1.1.1"])
    match = re.search(r"dev\s+(\S+)", out)
    if match:
        STATE["iface"] = match.group(1)
    return STATE["iface"] or ""


def is_antichina_enabled(sc):
    for rule in sc.get("route", {}).get("rules", []):
        ds = rule.get("domain_suffix", [])
        if isinstance(ds, str):
            ds = [ds]
        if ANTI_CHINA_DOMAINS[0] in ds and rule.get("action") == "reject":
            return True
    return False


def load_disabled_users():
    if not os.path.exists(DISABLED_USERS_PATH):
        return []
    try:
        with open(DISABLED_USERS_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def atomic_apply_config(sc, disabled_users=None, ufw_port_add=None, ufw_port_del=None):
    """备份 → 临时写入 → sing-box check 语法校验 → 原子替换 → 延迟平滑重启与失败自动回滚。"""
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    bak_path = f"{CONFIG_PATH}.bak.{ts}"
    shutil.copy2(CONFIG_PATH, bak_path)

    with open(TMP_CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(sc, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.chmod(TMP_CONFIG_PATH, 0o600)

    out, err, rc = run_cmd([SINGBOX_BIN, "check", "-c", TMP_CONFIG_PATH], timeout=10)
    if rc != 0:
        try:
            os.remove(TMP_CONFIG_PATH)
        except Exception:
            pass
        raise RuntimeError("sing-box 配置校验未通过，已取消修改：" + (err or out))

    os.replace(TMP_CONFIG_PATH, CONFIG_PATH)
    os.chmod(CONFIG_PATH, 0o600)

    if disabled_users is not None:
        with open(DISABLED_USERS_PATH, "w", encoding="utf-8") as f:
            json.dump(disabled_users, f, indent=2, ensure_ascii=False)
            f.write("\n")
        os.chmod(DISABLED_USERS_PATH, 0o600)

    if ufw_port_add:
        run_cmd(["ufw", "allow", f"{ufw_port_add}/tcp"], timeout=5)
    if ufw_port_del:
        run_cmd(["ufw", "delete", "allow", f"{ufw_port_del}/tcp"], timeout=5)

    # 延迟 0.3s 独立重启，保证当前 SSH JSON 响应先完整写回本机
    subprocess.Popen(
        [
            "bash",
            "-c",
            (
                f"sleep 0.3 && (systemctl restart sing-box && "
                f'[ "$(systemctl is-active sing-box)" = active ] || '
                f"(cp '{bak_path}' '{CONFIG_PATH}' && systemctl restart sing-box))"
            ),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )

    backups = sorted(
        f for f in os.listdir(SINGBOX_DIR) if f.startswith(BACKUP_PREFIX)
    )
    for old in backups[:-MAX_BACKUP_KEEP]:
        try:
            os.remove(os.path.join(SINGBOX_DIR, old))
        except Exception:
            pass

    return bak_path


def get_security_info(force=False):
    now = time.time()
    if not force and STATE["sec_cache"] and (now - STATE["sec_ts"] < SECURITY_CACHE_TTL_SEC):
        return STATE["sec_cache"]

    ufw_out, _, _ = run_cmd(["ufw", "status"])
    ufw_active = "Status: active" in ufw_out
    ufw_rules = [
        re.sub(r"\s+", " ", line.strip())
        for line in ufw_out.splitlines()
        if ("ALLOW" in line or "LIMIT" in line)
    ]

    f2b_out, _, f2b_rc = run_cmd(["fail2ban-client", "status", "sshd"])
    f2b_curr, f2b_total = 0, 0
    if f2b_rc == 0:
        mc = re.search(r"Currently banned:\s*(\d+)", f2b_out)
        mt = re.search(r"Total banned:\s*(\d+)", f2b_out)
        if mc:
            f2b_curr = int(mc.group(1))
        if mt:
            f2b_total = int(mt.group(1))

    last_out, _, _ = run_cmd(["last", "-n", "6", "-F", "-w"])
    recent_logins = [
        line.strip()
        for line in last_out.splitlines()
        if line.strip() and not line.startswith("wtmp")
    ]

    fail_out, _, _ = run_cmd(
        [
            "bash",
            "-c",
            "journalctl -u ssh -u sshd --since '24 hours ago' --no-pager 2>/dev/null "
            "| grep -Ec 'Failed password|Invalid user|authentication failure' || true",
        ]
    )
    failed_24h = int(fail_out) if fail_out.isdigit() else 0

    sec = {
        "ufwActive": ufw_active,
        "ufwRules": ufw_rules,
        "fail2banActive": f2b_rc == 0,
        "fail2banCurrent": f2b_curr,
        "fail2banTotal": f2b_total,
        "failedSsh24h": failed_24h,
        "recentLogins": recent_logins,
        "checkedAt": datetime.datetime.now().strftime("%H:%M:%S"),
    }
    STATE["sec_cache"] = sec
    STATE["sec_ts"] = now
    return sec


def handle_overview(params):
    cpu_pct = get_cpu_pct()
    mem = {}
    with open("/proc/meminfo", "r", encoding="utf-8") as f:
        for line in f:
            key, val = line.split(":", 1)
            mem[key] = int(val.strip().split()[0]) * 1024
    mem_total = mem.get("MemTotal", 0)
    mem_avail = mem.get("MemAvailable", mem.get("MemFree", 0))
    mem_used = max(0, mem_total - mem_avail)
    swap_total = mem.get("SwapTotal", 0)
    swap_used = max(0, swap_total - mem.get("SwapFree", 0))

    du = shutil.disk_usage("/")
    with open("/proc/uptime", "r", encoding="utf-8") as f:
        uptime_sec = int(float(f.read().split()[0]))
    load1, load5, load15 = os.getloadavg()

    iface = get_iface()
    rx_bytes, tx_bytes = 0, 0
    with open("/proc/net/dev", "r", encoding="utf-8") as f:
        for line in f.readlines()[2:]:
            if ":" not in line:
                continue
            name, rest = line.split(":", 1)
            name = name.strip()
            if not iface and name != "lo":
                iface = name
            if name == iface:
                cols = rest.split()
                rx_bytes = int(cols[0])
                tx_bytes = int(cols[8])
                break

    sb_show, _, _ = run_cmd(
        [
            "systemctl",
            "show",
            "sing-box",
            "-p",
            "ActiveState",
            "-p",
            "MainPID",
            "-p",
            "MemoryCurrent",
            "-p",
            "ActiveEnterTimestamp",
        ]
    )
    sb_meta = {}
    for line in sb_show.splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            sb_meta[k] = v
    sb_active = sb_meta.get("ActiveState", "unknown")

    cfg_summary = {
        "listenPort": None,
        "sni": "",
        "userCount": 0,
        "disabledCount": len(load_disabled_users()),
        "clashApiEnabled": False,
        "clashApiAddr": "",
        "antiChinaEnabled": False,
        "logLevel": "warn",
    }
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            sc = json.load(f)
        cfg_summary["logLevel"] = sc.get("log", {}).get("level", "warn")
        inbs = sc.get("inbounds", [])
        if inbs:
            cfg_summary["listenPort"] = inbs[0].get("listen_port")
            cfg_summary["userCount"] = len(inbs[0].get("users", []))
            cfg_summary["sni"] = inbs[0].get("tls", {}).get("server_name", "")
        ca = sc.get("experimental", {}).get("clash_api", {})
        if ca and ca.get("external_controller"):
            cfg_summary["clashApiEnabled"] = True
            cfg_summary["clashApiAddr"] = ca.get("external_controller")
        cfg_summary["antiChinaEnabled"] = is_antichina_enabled(sc)
    except Exception as exc:
        cfg_summary["error"] = str(exc)

    member_live = None
    if cfg_summary["clashApiEnabled"]:
        try:
            audit = handle_audit({})
            member_live = {
                "uploadTotal": audit.get("uploadTotal", 0),
                "downloadTotal": audit.get("downloadTotal", 0),
                "totalConnections": len(audit.get("connections", [])),
                "members": audit.get("userSummary", {}),
            }
        except Exception:
            member_live = None

    return {
        "hostname": socket.gethostname(),
        "os": get_os_name(),
        "kernel": os.uname().release,
        "uptimeSec": uptime_sec,
        "cpu": {
            "percent": cpu_pct,
            "cores": os.cpu_count() or 1,
            "load": [round(load1, 2), round(load5, 2), round(load15, 2)],
        },
        "memory": {
            "total": mem_total,
            "used": mem_used,
            "percent": round(100.0 * mem_used / max(1, mem_total), 1),
            "swapTotal": swap_total,
            "swapUsed": swap_used,
        },
        "disk": {
            "total": du.total,
            "used": du.used,
            "free": du.free,
            "percent": round(100.0 * du.used / max(1, du.total), 1),
        },
        "network": {
            "iface": iface,
            "rxBytes": rx_bytes,
            "txBytes": tx_bytes,
            "timestamp": time.time(),
        },
        "singbox": {
            "active": sb_active == "active",
            "status": sb_active,
            "version": get_sb_ver(),
            "pid": sb_meta.get("MainPID", ""),
            "memoryBytes": int(sb_meta["MemoryCurrent"])
            if sb_meta.get("MemoryCurrent", "").isdigit()
            else 0,
            "startedAt": sb_meta.get("ActiveEnterTimestamp", ""),
            "config": cfg_summary,
        },
        "memberLive": member_live,
        "security": get_security_info(force=bool(params.get("forceSecurity"))),
    }


def handle_users(_params):
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        sc = json.load(f)
    inb = sc["inbounds"][0]
    tls = inb.get("tls", {})
    reality = tls.get("reality", {})
    short_ids = reality.get("short_id", [])
    sid = (
        short_ids[0]
        if isinstance(short_ids, list) and short_ids
        else (short_ids if isinstance(short_ids, str) else "")
    )
    return {
        "listenPort": inb.get("listen_port", DEFAULT_LISTEN_PORT),
        "sni": tls.get("server_name", DEFAULT_SNI),
        "shortId": sid,
        "activeUsers": inb.get("users", []),
        "disabledUsers": load_disabled_users(),
        "antiChinaEnabled": is_antichina_enabled(sc),
    }


def sync_user_audit_rules(sc):
    rules = sc.setdefault("route", {}).setdefault("rules", [])
    rules[:] = [
        r
        for r in rules
        if not (
            isinstance(r.get("auth_user"), list)
            and len(r.get("auth_user")) == 1
            and r.get("outbound") == "direct"
            and set(r.keys()) == {"auth_user", "outbound"}
        )
    ]
    ca = sc.get("experimental", {}).get("clash_api", {})
    if ca and ca.get("external_controller"):
        users = sc.get("inbounds", [{}])[0].get("users", [])
        for user in users:
            uname = user.get("name")
            if uname:
                rules.append({"auth_user": [uname], "outbound": "direct"})


def handle_mutate(args):
    action = args["action"]
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        sc = json.load(f)
    disabled = load_disabled_users()
    inb = sc["inbounds"][0]
    users = inb.setdefault("users", [])
    result_msg = "操作成功"
    extra = {}

    if action == "add_user":
        name = args["name"].strip()
        uid = (args.get("uuid") or "").strip() or str(uuid.uuid4())
        if any(u.get("name") == name for u in users) or any(
            u.get("name") == name for u in disabled
        ):
            raise ValueError(f"成员名 {name} 已存在")
        if any(u.get("uuid") == uid for u in users) or any(
            u.get("uuid") == uid for u in disabled
        ):
            raise ValueError(f"UUID {uid} 已存在")
        users.append({"name": name, "uuid": uid, "flow": DEFAULT_VLESS_FLOW})
        result_msg = f"已新增成员 {name}"
        extra = {"name": name, "uuid": uid}
    elif action == "pause_user":
        uid = args["uuid"]
        idx = next((i for i, u in enumerate(users) if u.get("uuid") == uid), -1)
        if idx < 0:
            raise ValueError("未找到该活跃成员")
        if len(users) <= 1:
            raise ValueError("至少需要保留 1 个活跃成员")
        removed = users.pop(idx)
        removed["disabledAt"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        disabled.append(removed)
        result_msg = f"已暂停成员 {removed.get('name', uid)}"
    elif action == "resume_user":
        uid = args["uuid"]
        idx = next((i for i, u in enumerate(disabled) if u.get("uuid") == uid), -1)
        if idx < 0:
            raise ValueError("未找到该已暂停成员")
        restored = disabled.pop(idx)
        restored.pop("disabledAt", None)
        restored.setdefault("flow", DEFAULT_VLESS_FLOW)
        users.append(restored)
        result_msg = f"已恢复成员 {restored.get('name', uid)}"
    elif action == "delete_user":
        uid = args["uuid"]
        idx = next((i for i, u in enumerate(users) if u.get("uuid") == uid), -1)
        if idx >= 0:
            if len(users) <= 1:
                raise ValueError("至少需要保留 1 个活跃成员")
            removed = users.pop(idx)
            result_msg = f"已彻底删除成员 {removed.get('name', uid)}"
        else:
            idx2 = next((i for i, u in enumerate(disabled) if u.get("uuid") == uid), -1)
            if idx2 < 0:
                raise ValueError("未找到该成员")
            removed = disabled.pop(idx2)
            result_msg = f"已彻底删除已暂停成员 {removed.get('name', uid)}"
    elif action == "edit_user":
        uid = args["uuid"]
        new_name = (args.get("name") or "").strip()
        new_uid = (args.get("newUuid") or "").strip()
        target = next((u for u in users if u.get("uuid") == uid), None)
        if target is None:
            raise ValueError("未找到该活跃成员")
        if new_name and new_name != target.get("name"):
            if any(u.get("name") == new_name for u in users) or any(
                u.get("name") == new_name for u in disabled
            ):
                raise ValueError(f"成员名 {new_name} 已存在")
            target["name"] = new_name
        if new_uid and new_uid != uid:
            if any(u.get("uuid") == new_uid for u in users) or any(
                u.get("uuid") == new_uid for u in disabled
            ):
                raise ValueError(f"UUID {new_uid} 已存在")
            target["uuid"] = new_uid
        result_msg = f"已更新成员「{target.get('name', uid)}」"
    elif action == "toggle_antichina":
        enable = bool(args["enable"])
        rules = sc.setdefault("route", {}).setdefault("rules", [])
        rules[:] = [
            r
            for r in rules
            if not (
                isinstance(r.get("domain_suffix"), list)
                and ANTI_CHINA_DOMAINS[0] in r["domain_suffix"]
            )
        ]
        if enable:
            insert_pos = 1 if (rules and rules[0].get("action") == "sniff") else 0
            rules.insert(
                insert_pos, {"domain_suffix": ANTI_CHINA_DOMAINS, "action": "reject"}
            )
            result_msg = "已开启 VPS 侧位置历史上报域名过滤规则"
        else:
            result_msg = "已关闭 VPS 侧定位上报拦截规则"
    elif action == "configure_audit":
        enable = bool(args["enable"])
        port = int(args.get("port", 19090))
        log_level = args.get("logLevel")
        if enable:
            exp = sc.setdefault("experimental", {})
            ca = exp.setdefault("clash_api", {})
            ca["external_controller"] = f"127.0.0.1:{port}"
            if not ca.get("secret"):
                ca["secret"] = secrets.token_hex(16)
            result_msg = f"已安全开启本地统计接口（仅监听 127.0.0.1:{port}，公网零暴露）"
        else:
            if "experimental" in sc and "clash_api" in sc["experimental"]:
                del sc["experimental"]["clash_api"]
                if not sc["experimental"]:
                    del sc["experimental"]
            result_msg = "已关闭本地统计接口"
        if log_level in ("warn", "info", "error"):
            sc.setdefault("log", {})["level"] = log_level
    else:
        raise ValueError(f"未知操作: {action}")

    sync_user_audit_rules(sc)
    bak_path = atomic_apply_config(sc, disabled_users=disabled)
    return {
        "ok": True,
        "message": result_msg,
        "backup": bak_path,
        "restarting": True,
        **extra,
    }


def handle_audit(_params):
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        sc = json.load(f)
    log_level = sc.get("log", {}).get("level", "warn")
    users_list = []
    for inb in sc.get("inbounds", []):
        for u in inb.get("users", []):
            uname = u.get("name") or u.get("username") or u.get("uuid") or ""
            if uname and uname not in users_list:
                users_list.append(uname)
    ca = sc.get("experimental", {}).get("clash_api", {})
    controller = ca.get("external_controller", "")
    secret = ca.get("secret", "")
    out = {
        "enabled": bool(controller),
        "controller": controller,
        "logLevel": log_level,
        "configuredUsers": users_list,
        "uploadTotal": 0,
        "downloadTotal": 0,
        "connections": [],
        "userSummary": {},
        "recentLogSummary": {},
    }
    for uname in users_list:
        out["userSummary"][uname] = {
            "activeConnections": 0,
            "upload": 0,
            "download": 0,
            "sourceIPs": [],
            "suspiciousHosts": [],
        }

    if controller:
        try:
            req = urllib.request.Request(f"http://{controller}/connections")
            if secret:
                req.add_header("Authorization", f"Bearer {secret}")
            with urllib.request.urlopen(req, timeout=4) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            out["uploadTotal"] = data.get("uploadTotal", 0)
            out["downloadTotal"] = data.get("downloadTotal", 0)
            norm_conns, ip_sets, susp_sets = [], {}, {}
            for conn in data.get("connections") or []:
                meta = conn.get("metadata") or {}
                rule_str = str(conn.get("rule") or "")
                rule_payload = str(conn.get("rulePayload") or "")
                uname = (
                    meta.get("user")
                    or meta.get("inboundUser")
                    or meta.get("authUser")
                    or meta.get("auth_user")
                    or ""
                )
                if not uname:
                    rm = re.search(r"auth_user=\[?([^\]\s,]+)\]?", rule_str)
                    if rm:
                        uname = rm.group(1)
                    elif rule_payload in users_list:
                        uname = rule_payload
                if not uname:
                    uname = "未标注"
                src_ip = meta.get("sourceIP") or ""
                host = meta.get("host") or meta.get("destinationIP") or ""
                dport = str(meta.get("destinationPort") or "")
                up = int(conn.get("upload") or 0)
                down = int(conn.get("download") or 0)
                is_susp = bool(SUSPICIOUS_LOCATION_RE.search(host))
                norm_conns.append(
                    {
                        "id": conn.get("id", ""),
                        "user": uname,
                        "sourceIP": src_ip,
                        "host": host,
                        "port": dport,
                        "network": meta.get("network", ""),
                        "upload": up,
                        "download": down,
                        "start": conn.get("start", ""),
                        "rule": conn.get("rule", ""),
                        "suspicious": is_susp,
                    }
                )
                summary = out["userSummary"].setdefault(
                    uname,
                    {
                        "activeConnections": 0,
                        "upload": 0,
                        "download": 0,
                        "sourceIPs": [],
                        "suspiciousHosts": [],
                    },
                )
                summary["activeConnections"] += 1
                summary["upload"] += up
                summary["download"] += down
                if src_ip:
                    ip_sets.setdefault(uname, set()).add(src_ip)
                if is_susp:
                    susp_sets.setdefault(uname, set()).add(host)
            for u, ips in ip_sets.items():
                out["userSummary"][u]["sourceIPs"] = sorted(ips)
            for u, hosts in susp_sets.items():
                out["userSummary"][u]["suspiciousHosts"] = sorted(hosts)
            norm_conns.sort(key=lambda x: x["upload"] + x["download"], reverse=True)
            out["connections"] = norm_conns[:MAX_AUDIT_CONNECTIONS]
        except Exception as exc:
            out["apiError"] = str(exc)

    if log_level == "info":
        stdout, _, _ = run_cmd(
            ["journalctl", "-u", "sing-box", "-n", "400", "--no-pager"], timeout=5
        )
        log_stats = {}
        re_from = re.compile(
            r"inbound/vless\[[^\]]+\]:\s+\[([^\]]+)\]\s+inbound connection from\s+([0-9a-fA-F.:]+):\d+"
        )
        re_to = re.compile(
            r"inbound/vless\[[^\]]+\]:\s+\[([^\]]+)\]\s+inbound connection to\s+(\S+)"
        )
        for line in stdout.splitlines():
            mf = re_from.search(line)
            if mf:
                u, ip = mf.group(1), mf.group(2)
                st = log_stats.setdefault(
                    u, {"count": 0, "sourceIPs": set(), "suspiciousHosts": set()}
                )
                st["count"] += 1
                st["sourceIPs"].add(ip)
            mt = re_to.search(line)
            if mt:
                u, target = mt.group(1), mt.group(2)
                st = log_stats.setdefault(
                    u, {"count": 0, "sourceIPs": set(), "suspiciousHosts": set()}
                )
                if SUSPICIOUS_LOCATION_RE.search(target):
                    st["suspiciousHosts"].add(target)
        for u, st in log_stats.items():
            out["recentLogSummary"][u] = {
                "count": st["count"],
                "sourceIPs": sorted(st["sourceIPs"]),
                "suspiciousHosts": sorted(st["suspiciousHosts"]),
            }
    return out


def handle_close_conn(params):
    conn_id = params["id"]
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        sc = json.load(f)
    ca = sc.get("experimental", {}).get("clash_api", {})
    controller, secret = ca.get("external_controller", ""), ca.get("secret", "")
    if not controller:
        raise RuntimeError("clash_api 未开启")
    url = (
        f"http://{controller}/connections"
        if conn_id == "__ALL__"
        else f"http://{controller}/connections/{conn_id}"
    )
    req = urllib.request.Request(url, method="DELETE")
    if secret:
        req.add_header("Authorization", f"Bearer {secret}")
    with urllib.request.urlopen(req, timeout=4):
        pass
    return {"ok": True}


def handle_logs(params):
    lines = min(400, max(20, int(params.get("lines", 100))))
    out, _, _ = run_cmd(
        ["journalctl", "-u", "sing-box", "-n", str(lines), "--no-pager", "-o", "short-iso"],
        timeout=6,
    )
    return {"logs": out}


def handle_ipcheck(_params):
    info = {}
    ipapi = {}
    try:
        out, _, rc = run_cmd(["curl", "-4", "-s", "--max-time", "8", IPINFO_URL], timeout=10)
        if rc == 0 and out:
            info = json.loads(out)
    except Exception:
        pass
    try:
        out2, _, rc2 = run_cmd(["curl", "-4", "-s", "--max-time", "8", IPAPI_URL], timeout=10)
        if rc2 == 0 and out2:
            ipapi = json.loads(out2)
    except Exception:
        pass
    return {
        "ip": info.get("ip") or ipapi.get("query") or "",
        "country": ipapi.get("country") or info.get("country") or "",
        "countryCode": info.get("country") or ipapi.get("countryCode") or "",
        "region": info.get("region") or ipapi.get("regionName") or "",
        "city": info.get("city") or ipapi.get("city") or "",
        "org": info.get("org") or ipapi.get("as") or "",
        "isp": ipapi.get("isp") or "",
        "timezone": info.get("timezone") or ipapi.get("timezone") or "",
        "postal": info.get("postal") or "",
        "loc": info.get("loc")
        or (f"{ipapi.get('lat')},{ipapi.get('lon')}" if ipapi.get("lat") else ""),
        "hosting": ipapi.get("hosting"),
        "proxy": ipapi.get("proxy"),
        "mobile": ipapi.get("mobile"),
    }


def _extract_users_detail(raw_inb):
    detail = []
    itype = raw_inb.get("type", "")
    if isinstance(raw_inb.get("users"), list) and raw_inb["users"]:
        for u in raw_inb["users"]:
            detail.append(
                {
                    "name": u.get("name") or u.get("username") or "",
                    "username": u.get("username") or u.get("name") or "",
                    "uuid": u.get("uuid") or "",
                    "password": u.get("password") or "",
                    "flow": u.get("flow") or "",
                }
            )
    elif itype == "shadowsocks" and raw_inb.get("password"):
        detail.append(
            {
                "name": raw_inb.get("tag", "ss-user"),
                "username": raw_inb.get("tag", "ss-user"),
                "uuid": "",
                "password": raw_inb.get("password", ""),
                "flow": "",
            }
        )
    return detail


def handle_sb_config(_params):
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        sc = json.load(f)
    sanitized = json.loads(json.dumps(sc))
    inbounds_view = []
    for idx, inb in enumerate(sanitized.get("inbounds", [])):
        if inb.get("tls", {}).get("reality", {}).get("private_key"):
            inb["tls"]["reality"]["private_key"] = "***已隐藏（仅保存在VPS）***"
        raw_inb = sc["inbounds"][idx]
        sids = raw_inb.get("tls", {}).get("reality", {}).get("short_id", [])
        sid = (
            sids[0]
            if isinstance(sids, list) and sids
            else (sids if isinstance(sids, str) else "")
        )
        users_detail = _extract_users_detail(raw_inb)
        inbounds_view.append(
            {
                "index": idx,
                "tag": raw_inb.get("tag", f"inbound-{idx}"),
                "type": raw_inb.get("type", ""),
                "listenPort": raw_inb.get("listen_port"),
                "sni": raw_inb.get("tls", {}).get("server_name", ""),
                "shortId": sid,
                "method": raw_inb.get("method", ""),
                "password": raw_inb.get("password", ""),
                "userCount": len(users_detail),
                "users": [u["name"] or u["username"] or u["uuid"] for u in users_detail],
                "usersDetail": users_detail,
                "isPrimary": idx == 0,
            }
        )
        if inb.get("password"):
            inb["password"] = "***已隐藏***"
        if isinstance(inb.get("users"), list):
            for u in inb["users"]:
                if u.get("password"):
                    u["password"] = "***已隐藏***"
    if sanitized.get("experimental", {}).get("clash_api", {}).get("secret"):
        sanitized["experimental"]["clash_api"]["secret"] = "***已隐藏***"

    backups = sorted(
        (f for f in os.listdir(SINGBOX_DIR) if f.startswith(BACKUP_PREFIX)),
        reverse=True,
    )
    return {
        "inbounds": inbounds_view,
        "outbounds": sanitized.get("outbounds", []),
        "rules": sanitized.get("route", {}).get("rules", []),
        "dns": sanitized.get("dns", {}),
        "log": sanitized.get("log", {}),
        "backups": backups[:MAX_BACKUP_VIEW],
        "rawJson": json.dumps(sanitized, indent=2, ensure_ascii=False),
    }


def _build_vps_inbound(proto, tag, port, args, existing=None, base_vless=None):
    if proto == "vless":
        sni = (args.get("sni") or (existing or {}).get("tls", {}).get("server_name") or DEFAULT_SNI).strip()
        ref = existing if (existing and existing.get("type") == "vless") else (base_vless or {})
        priv_key = ref.get("tls", {}).get("reality", {}).get("private_key", "")
        sids = ref.get("tls", {}).get("reality", {}).get("short_id", [])
        sid = sids[0] if isinstance(sids, list) and sids else secrets.token_hex(8)
        if existing and existing.get("type") == "vless" and existing.get("users"):
            users_copy = json.loads(json.dumps(existing["users"]))
        elif base_vless and base_vless.get("users"):
            users_copy = json.loads(json.dumps(base_vless["users"]))
        else:
            uname = (args.get("username") or "me").strip()
            uid = (args.get("password") or "").strip() or str(uuid.uuid4())
            users_copy = [{"name": uname, "uuid": uid, "flow": DEFAULT_VLESS_FLOW}]
        return {
            "type": "vless",
            "tag": tag,
            "listen": "0.0.0.0",
            "listen_port": port,
            "users": users_copy,
            "tls": {
                "enabled": True,
                "server_name": sni,
                "reality": {
                    "enabled": True,
                    "handshake": {"server": sni, "server_port": 443},
                    "private_key": priv_key,
                    "short_id": [sid],
                },
            },
        }
    if proto == "shadowsocks":
        method = (args.get("method") or SS2022_METHOD).strip()
        raw_pwd = (args.get("password") or "").strip()
        if not raw_pwd:
            raw_pwd = base64.b64encode(os.urandom(16)).decode("ascii")
        elif method == SS2022_METHOD:
            try:
                if len(base64.b64decode(raw_pwd)) != 16:
                    raw_pwd = base64.b64encode(os.urandom(16)).decode("ascii")
            except Exception:
                raw_pwd = base64.b64encode(os.urandom(16)).decode("ascii")
        return {
            "type": "shadowsocks",
            "tag": tag,
            "listen": "0.0.0.0",
            "listen_port": port,
            "method": method,
            "password": raw_pwd,
        }
    if proto in ("socks", "http", "mixed"):
        uname = (args.get("username") or "user").strip()
        pwd = (args.get("password") or "").strip() or secrets.token_hex(12)
        existing_users = (
            existing.get("users", [])
            if (existing and existing.get("type") in ("socks", "http", "mixed") and isinstance(existing.get("users"), list))
            else []
        )
        if existing_users and not args.get("username") and not args.get("password"):
            users_arr = json.loads(json.dumps(existing_users))
        elif existing_users and args.get("replaceFirstUser"):
            users_arr = json.loads(json.dumps(existing_users))
            users_arr[0] = {"username": uname, "password": pwd}
        else:
            users_arr = [{"username": uname, "password": pwd}]
        return {
            "type": proto,
            "tag": tag,
            "listen": "0.0.0.0",
            "listen_port": port,
            "users": users_arr,
        }
    raise ValueError(f"不支持的协议类型: {proto}")


def handle_sb_inbound_mutate(args):
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        sc = json.load(f)
    op = args["op"]
    inbs = sc.setdefault("inbounds", [])
    ufw_port_add = None
    ufw_port_del = None
    extra = {}
    base_vless = next((i for i in inbs if i.get("type") == "vless"), inbs[0] if inbs else None)

    if op == "add":
        proto = args.get("proto", "vless")
        port = int(args["port"])
        tag = args["tag"].strip()
        if port < 1024 or port > 65535:
            raise ValueError("端口必须在 1024-65535 之间")
        if any(i.get("listen_port") == port for i in inbs):
            raise ValueError(f"端口 {port} 已被现有节点占用")
        if any(i.get("tag") == tag for i in inbs):
            raise ValueError(f"节点标识 {tag} 已存在")

        new_inb = _build_vps_inbound(proto, tag, port, args, existing=None, base_vless=base_vless)
        inbs.append(new_inb)
        ufw_port_add = port
        if proto == "shadowsocks":
            extra = {"method": new_inb["method"], "password": new_inb["password"], "port": port}
        msg = f"已新增 {proto.upper()} 节点「{tag}」(端口 {port})，请同步在云服务商网页安全组放行 TCP {port}"
    elif op == "edit":
        orig_tag = (args.get("origTag") or "").strip()
        idx = next((i for i, x in enumerate(inbs) if x.get("tag") == orig_tag), -1)
        if idx < 0:
            raise ValueError(f"未找到入站节点「{orig_tag}」")
        cur = inbs[idx]
        proto = (args.get("proto") or cur.get("type") or "vless").strip()
        port = int(args.get("port") or cur.get("listen_port"))
        tag = (args.get("tag") or orig_tag).strip()
        if port < 1024 or port > 65535:
            raise ValueError("端口必须在 1024-65535 之间")
        if any(i != idx and x.get("listen_port") == port for i, x in enumerate(inbs)):
            raise ValueError(f"端口 {port} 已被其他节点占用")
        if any(i != idx and x.get("tag") == tag for i, x in enumerate(inbs)):
            raise ValueError(f"节点标识「{tag}」已存在")
        if idx == 0 and proto != cur.get("type"):
            raise ValueError("主 VPS 首个主力入站受保护，请勿更改其协议类型（可新增独立端口节点）")

        old_port = cur.get("listen_port")
        args_edit = dict(args)
        args_edit["replaceFirstUser"] = True
        inbs[idx] = _build_vps_inbound(proto, tag, port, args_edit, existing=cur, base_vless=base_vless)
        if old_port != port:
            ufw_port_add = port
            ufw_port_del = old_port
        msg = f"已更新节点「{tag}」({proto.upper()} :{port})"
    elif op == "upsert_user":
        tag = (args.get("tag") or "").strip()
        idx = next((i for i, x in enumerate(inbs) if x.get("tag") == tag), -1)
        if idx < 0:
            raise ValueError(f"未找到入站节点「{tag}」")
        inb = inbs[idx]
        itype = inb.get("type", "")
        orig_name = (args.get("origName") or "").strip()
        uname = (args.get("username") or "").strip()
        pwd = (args.get("password") or "").strip()
        if not uname:
            raise ValueError("用户名不能为空")
        if itype == "vless":
            users = inb.setdefault("users", [])
            uid = pwd or str(uuid.uuid4())
            if orig_name:
                target = next((u for u in users if u.get("name") == orig_name), None)
                if not target:
                    raise ValueError(f"未找到用户 {orig_name}")
                target["name"] = uname
                if pwd:
                    target["uuid"] = pwd
            else:
                if any(u.get("name") == uname for u in users):
                    raise ValueError(f"用户 {uname} 已存在")
                users.append({"name": uname, "uuid": uid, "flow": DEFAULT_VLESS_FLOW})
            sync_user_audit_rules(sc)
            msg = f"已更新 VLESS 节点「{tag}」用户「{uname}」"
        elif itype in ("socks", "http", "mixed"):
            users = inb.setdefault("users", [])
            final_pwd = pwd or secrets.token_hex(12)
            if orig_name:
                target = next((u for u in users if u.get("username") == orig_name), None)
                if not target:
                    raise ValueError(f"未找到用户 {orig_name}")
                target["username"] = uname
                if pwd:
                    target["password"] = pwd
            else:
                if any(u.get("username") == uname for u in users):
                    raise ValueError(f"用户 {uname} 已存在")
                users.append({"username": uname, "password": final_pwd})
            msg = f"已更新 {itype.upper()} 节点「{tag}」用户「{uname}」"
        elif itype == "shadowsocks":
            if pwd:
                inb["password"] = pwd
            else:
                inb["password"] = base64.b64encode(os.urandom(16)).decode("ascii")
            msg = f"已更新 Shadowsocks 节点「{tag}」密码"
        else:
            raise ValueError(f"节点协议 {itype} 暂不支持独立用户编辑")
    elif op == "delete_user":
        tag = (args.get("tag") or "").strip()
        uname = (args.get("username") or "").strip()
        idx = next((i for i, x in enumerate(inbs) if x.get("tag") == tag), -1)
        if idx < 0:
            raise ValueError(f"未找到入站节点「{tag}」")
        inb = inbs[idx]
        users = inb.get("users", [])
        if len(users) <= 1:
            raise ValueError("每个节点至少保留 1 个有效用户")
        new_users = [u for u in users if (u.get("name") or u.get("username")) != uname]
        if len(new_users) == len(users):
            raise ValueError(f"未找到用户 {uname}")
        inb["users"] = new_users
        sync_user_audit_rules(sc)
        msg = f"已从节点「{tag}」移除用户「{uname}」"
    elif op == "delete":
        tag = args["tag"]
        idx = next((i for i, x in enumerate(inbs) if x.get("tag") == tag), -1)
        if idx < 0:
            raise ValueError("未找到该入站节点")
        if idx == 0:
            raise ValueError("主节点受保护，禁止直接删除（避免所有成员断连）")
        removed = inbs.pop(idx)
        ufw_port_del = removed.get("listen_port")
        msg = f"已删除入站节点「{tag}」(端口 {ufw_port_del})"
    elif op == "restore":
        bak_name = os.path.basename(args["backup"])
        if not bak_name.startswith(BACKUP_PREFIX):
            raise ValueError("非法备份文件名")
        bak_full = os.path.join(SINGBOX_DIR, bak_name)
        if not os.path.exists(bak_full):
            raise ValueError("备份文件不存在")
        with open(bak_full, "r", encoding="utf-8") as bf:
            sc = json.load(bf)
        msg = f"已恢复历史备份 {bak_name}"
    else:
        raise ValueError("未知操作")

    atomic_apply_config(sc, ufw_port_add=ufw_port_add, ufw_port_del=ufw_port_del)
    return {"ok": True, "message": msg, "restarting": True, **extra}


def handle_service(params):
    act = params.get("action", "")
    if act == "restart":
        subprocess.Popen(
            ["bash", "-c", "sleep 0.3 && systemctl restart sing-box"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        return {"output": "sing-box 正在平滑重启，2 秒后自动恢复连接", "restarting": True}
    if act == "reload":
        out, err, rc = run_cmd([SINGBOX_BIN, "check", "-c", CONFIG_PATH], timeout=8)
        if rc != 0:
            raise RuntimeError(err or out)
        subprocess.Popen(
            ["bash", "-c", "sleep 0.3 && systemctl reload-or-restart sing-box"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        return {"output": "配置语法校验通过，sing-box 正在重新加载", "restarting": True}
    if act == "check":
        out, err, rc = run_cmd([SINGBOX_BIN, "check", "-c", CONFIG_PATH], timeout=8)
        if rc != 0:
            raise RuntimeError(err or out)
        return {"output": "配置语法 100% 校验通过"}
    if act == "ports":
        out, _, _ = run_cmd(["ss", "-tulnp"], timeout=5)
        return {"output": out}
    raise ValueError("不支持的操作")


HANDLERS = {
    "ping": lambda _: {"pong": True},
    "overview": handle_overview,
    "users": handle_users,
    "mutate": handle_mutate,
    "audit": handle_audit,
    "close_conn": handle_close_conn,
    "logs": handle_logs,
    "ipcheck": handle_ipcheck,
    "sb_config": handle_sb_config,
    "sb_inbound": handle_sb_inbound_mutate,
    "service": handle_service,
}

sys.stdout.write(json.dumps({"ready": True}) + "\n")
sys.stdout.flush()

for raw in sys.stdin:
    raw = raw.strip()
    if not raw:
        continue
    req_id = None
    try:
        msg = json.loads(raw)
        req_id = msg.get("id")
        op = msg.get("op")
        params = msg.get("params") or {}
        if op not in HANDLERS:
            raise ValueError(f"Unknown op: {op}")
        res = HANDLERS[op](params)
        sys.stdout.write(
            json.dumps({"id": req_id, "ok": True, "result": res}, ensure_ascii=False)
            + "\n"
        )
    except Exception as exc:
        sys.stdout.write(
            json.dumps({"id": req_id, "ok": False, "error": str(exc)}, ensure_ascii=False)
            + "\n"
        )
    sys.stdout.flush()
