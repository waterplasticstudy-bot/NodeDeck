//! Alpine / 轻量 NAT 零 Python 依赖 POSIX SSH 深度适配器（配置四协议增删改、自动备份回滚、本地统计与宿主机多出口控制）

use crate::config::{get_ssh_bin, resolve_key_path, NatNodeConfig, TrafficSnapshot};
use crate::constants::{
    ALPINE_CONFIG_PATH_PATTERN, ALPINE_LATENCY_TIMEOUT_MS, ALPINE_LONG_TIMEOUT_MS,
    ALPINE_SSH_TIMEOUT_MS, CREATE_NO_WINDOW, DEFAULT_NAT_CLASH_API_PORT,
    DEFAULT_NAT_SINGBOX_CONFIG, DEFAULT_SNI, DEFAULT_VLESS_FLOW, RESIDENTIAL_EXIT_CODES,
    INBOUND_TAG_PATTERN, NAT_BACKUP_NAME_PATTERN, NODE_USERNAME_PATTERN, SS2022_DEFAULT_METHOD,
    SSH_CONNECT_TIMEOUT_SECS, SUPPORTED_INBOUND_PROTOS,
};
use crate::ssh_client::SshError;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashMap};
use std::process::Stdio;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::time::timeout;
use uuid::Uuid;

/// 编译期静态内嵌 POSIX /bin/sh 采集与运维脚本（兼容 Alpine 3.21 / OpenRC，无需 Python）
const ALPINE_AGENT_SH: &str = include_str!("../assets/remote_agent_alpine.sh");

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InboundMutateInput {
    pub op: String,
    pub orig_tag: Option<String>,
    pub tag: Option<String>,
    pub proto: Option<String>,
    pub port: Option<u16>,
    pub sni: Option<String>,
    pub method: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub orig_name: Option<String>,
}

fn validate_alpine_cfg_path(raw: &str) -> Result<String, SshError> {
    let trimmed = raw.trim();
    let candidate = if trimmed.is_empty() {
        DEFAULT_NAT_SINGBOX_CONFIG
    } else {
        trimmed
    };
    let re = Regex::new(ALPINE_CONFIG_PATH_PATTERN).expect("valid alpine path regex");
    if candidate.contains("..") || !re.is_match(candidate) {
        return Err(SshError::new(
            "VALIDATION_ERROR",
            "Alpine sing-box 配置文件路径格式无效（仅允许以 / 开头的安全路径字符）",
            None,
        ));
    }
    Ok(candidate.to_string())
}

fn validate_safe_extra(raw: &str) -> Result<(), SshError> {
    if raw.contains('\'') || raw.contains('\n') || raw.contains('\r') {
        return Err(SshError::new("VALIDATION_ERROR", "远端参数包含非法控制字符", None));
    }
    Ok(())
}

async fn exec_alpine_script_timeout(
    node: &NatNodeConfig,
    fallback_key_path: &str,
    action: &str,
    extra_arg: Option<&str>,
    timeout_ms: u64,
) -> Result<(String, u64), SshError> {
    if node.public_ip.trim().is_empty() || node.ssh_port == 0 {
        return Err(SshError::new(
            "NAT_SSH_UNCONFIGURED",
            "该 NAT 节点尚未配置公网 SSH 映射端口（可在节点编辑中补充，或直接使用官方 Web 终端）",
            None,
        ));
    }

    let raw_key = if node.ssh_key_path.trim().is_empty() {
        fallback_key_path
    } else {
        node.ssh_key_path.as_str()
    };
    let key_file = resolve_key_path(raw_key);
    if key_file.as_os_str().is_empty() || !key_file.exists() {
        return Err(SshError::new(
            "NO_SSH_KEY",
            format!("未找到 SSH 私钥文件: {}", key_file.display()),
            None,
        ));
    }

    let cfg_path = validate_alpine_cfg_path(&node.singbox_config_path)?;
    if let Some(arg) = extra_arg {
        validate_safe_extra(arg)?;
    }

    let user = if node.ssh_user.trim().is_empty() {
        "root"
    } else {
        node.ssh_user.trim()
    };
    let remote_sh = match extra_arg {
        Some(arg) => format!("sh -s -- {action} '{cfg_path}' '{arg}'"),
        None => format!("sh -s -- {action} '{cfg_path}'"),
    };

    let mut cmd = Command::new(get_ssh_bin());
    cmd.args([
        "-T",
        "-i",
        &key_file.to_string_lossy(),
        "-p",
        &node.ssh_port.to_string(),
        "-o",
        "BatchMode=yes",
        "-o",
        &format!("ConnectTimeout={SSH_CONNECT_TIMEOUT_SECS}"),
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        "LogLevel=ERROR",
        &format!("{user}@{}", node.public_ip.trim()),
        &remote_sh,
    ])
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .kill_on_drop(true);

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let started = Instant::now();
    let mut child = cmd
        .spawn()
        .map_err(|e| SshError::new("SSH_ERROR", format!("无法启动 ssh 进程: {e}"), None))?;

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(ALPINE_AGENT_SH.as_bytes()).await;
        let _ = stdin.shutdown().await;
    }

    let output = timeout(Duration::from_millis(timeout_ms), child.wait_with_output())
        .await
        .map_err(|_| SshError::new("SSH_TIMEOUT", "连接 NAT SSH 超时，请检查端口映射或远端响应", None))?
        .map_err(|e| SshError::new("SSH_ERROR", format!("读取 NAT SSH 输出失败: {e}"), None))?;

    let elapsed_ms = started.elapsed().as_millis() as u64;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        let msg = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("远端命令返回非零状态 ({})", output.status)
        };
        return Err(SshError::new("ALPINE_SSH_ERR", msg, None));
    }

    Ok((stdout, elapsed_ms))
}

async fn exec_alpine_script(
    node: &NatNodeConfig,
    fallback_key_path: &str,
    action: &str,
    extra_arg: Option<&str>,
) -> Result<(String, u64), SshError> {
    exec_alpine_script_timeout(node, fallback_key_path, action, extra_arg, ALPINE_SSH_TIMEOUT_MS)
        .await
}

/// 采集 Alpine NAT 实时系统指标与 sing-box 进程状态
pub async fn fetch_alpine_overview(
    node: &NatNodeConfig,
    fallback_key_path: &str,
) -> Result<Value, SshError> {
    let (stdout, elapsed_ms) = exec_alpine_script(node, fallback_key_path, "overview", None).await?;
    let mut kv = HashMap::new();
    for line in stdout.lines() {
        if let Some((k, v)) = line.split_once('=') {
            kv.insert(k.trim().to_string(), v.trim().to_string());
        }
    }

    let parse_u64 = |k: &str| kv.get(k).and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
    let parse_f64 = |k: &str| kv.get(k).and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);

    let mem_total = parse_u64("MEM_TOTAL");
    let mem_used = parse_u64("MEM_USED");
    let mem_pct = if mem_total > 0 {
        (mem_used as f64 * 100.0 / mem_total as f64 * 10.0).round() / 10.0
    } else {
        0.0
    };
    let disk_total = parse_u64("DISK_TOTAL");
    let disk_used = parse_u64("DISK_USED");
    let disk_free = parse_u64("DISK_FREE");
    let disk_pct = if disk_total > 0 {
        (disk_used as f64 * 100.0 / disk_total as f64 * 10.0).round() / 10.0
    } else {
        0.0
    };

    Ok(json!({
        "ok": true,
        "sshLatencyMs": elapsed_ms,
        "os": kv.get("OS").cloned().unwrap_or_else(|| "Alpine Linux".to_string()),
        "kernel": kv.get("KERNEL").cloned().unwrap_or_default(),
        "uptimeSec": parse_u64("UPTIME"),
        "load": kv.get("LOAD").cloned().unwrap_or_else(|| "0 0 0".to_string()),
        "cpuPercent": parse_f64("CPU_PCT"),
        "memory": { "total": mem_total, "used": mem_used, "percent": mem_pct },
        "disk": { "total": disk_total, "used": disk_used, "free": disk_free, "percent": disk_pct },
        "network": {
            "iface": kv.get("IFACE").cloned().unwrap_or_default(),
            "rxBytes": parse_u64("RX_BYTES"),
            "txBytes": parse_u64("TX_BYTES")
        },
        "singbox": {
            "active": kv.get("SB_ACTIVE").map(|s| s == "true").unwrap_or(false),
            "pid": kv.get("SB_PID").cloned().unwrap_or_default(),
            "memoryBytes": parse_u64("SB_RSS"),
            "version": kv.get("SB_VER").cloned().unwrap_or_default(),
            "configExists": kv.get("CFG_EXISTS").map(|s| s == "true").unwrap_or(false),
            "configPath": kv.get("CFG_PATH").cloned().unwrap_or_default()
        }
    }))
}

fn sanitize_singbox_json(val: &mut Value) {
    match val {
        Value::Object(map) => {
            for (k, v) in map.iter_mut() {
                if matches!(k.as_str(), "private_key" | "password" | "secret") && v.is_string() {
                    *v = Value::String("***已脱敏隐藏***".to_string());
                } else {
                    sanitize_singbox_json(v);
                }
            }
        }
        Value::Array(arr) => {
            for item in arr.iter_mut() {
                sanitize_singbox_json(item);
            }
        }
        _ => {}
    }
}

fn extract_users_detail(raw_inb: &Value) -> Vec<Value> {
    let mut out = Vec::new();
    let itype = raw_inb.get("type").and_then(Value::as_str).unwrap_or("");
    if let Some(users) = raw_inb.get("users").and_then(Value::as_array) {
        for u in users {
            let name = u
                .get("name")
                .or_else(|| u.get("username"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let username = u
                .get("username")
                .or_else(|| u.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let uuid = u.get("uuid").and_then(Value::as_str).unwrap_or("");
            let password = u.get("password").and_then(Value::as_str).unwrap_or("");
            let flow = u.get("flow").and_then(Value::as_str).unwrap_or("");
            out.push(json!({
                "name": name,
                "username": username,
                "uuid": uuid,
                "password": password,
                "flow": flow
            }));
        }
    } else if itype == "shadowsocks" {
        if let Some(pwd) = raw_inb.get("password").and_then(Value::as_str) {
            let tag = raw_inb.get("tag").and_then(Value::as_str).unwrap_or("ss-user");
            out.push(json!({
                "name": tag,
                "username": tag,
                "uuid": "",
                "password": pwd,
                "flow": ""
            }));
        }
    }
    out
}

fn build_inbounds_view(parsed: &Value) -> Vec<Value> {
    let Some(arr) = parsed.get("inbounds").and_then(Value::as_array) else {
        return Vec::new();
    };
    arr.iter()
        .enumerate()
        .map(|(idx, inb)| {
            let itype = inb.get("type").and_then(Value::as_str).unwrap_or("");
            let tag = inb
                .get("tag")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| format!("inbound-{idx}"));
            let listen_port = inb.get("listen_port").and_then(Value::as_u64).unwrap_or(0);
            let sni = inb
                .get("tls")
                .and_then(|t| t.get("server_name"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let sid = inb
                .get("tls")
                .and_then(|t| t.get("reality"))
                .and_then(|r| r.get("short_id"))
                .and_then(|s| match s {
                    Value::Array(a) => a.first().and_then(Value::as_str),
                    Value::String(st) => Some(st.as_str()),
                    _ => None,
                })
                .unwrap_or("");
            let method = inb.get("method").and_then(Value::as_str).unwrap_or("");
            let password = inb.get("password").and_then(Value::as_str).unwrap_or("");
            let users_detail = extract_users_detail(inb);
            let users_names: Vec<String> = users_detail
                .iter()
                .filter_map(|u| {
                    let n = u["name"].as_str().unwrap_or("");
                    let un = u["username"].as_str().unwrap_or("");
                    let uid = u["uuid"].as_str().unwrap_or("");
                    if !n.is_empty() {
                        Some(n.to_string())
                    } else if !un.is_empty() {
                        Some(un.to_string())
                    } else if !uid.is_empty() {
                        Some(uid.to_string())
                    } else {
                        None
                    }
                })
                .collect();
            json!({
                "index": idx,
                "tag": tag,
                "type": itype,
                "listenPort": listen_port,
                "sni": sni,
                "shortId": sid,
                "method": method,
                "password": password,
                "userCount": users_detail.len(),
                "users": users_names,
                "usersDetail": users_detail,
                "isPrimary": idx == 0
            })
        })
        .collect()
}

/// 读取并结构化解析 Alpine NAT 中的 sing-box 配置与历史备份清单
pub async fn fetch_alpine_config(
    node: &NatNodeConfig,
    fallback_key_path: &str,
) -> Result<Value, SshError> {
    let (raw, _) = exec_alpine_script(node, fallback_key_path, "config", None).await?;
    let parsed: Value = serde_json::from_str(&raw)
        .map_err(|e| SshError::new("JSON_ERR", format!("解析 NAT sing-box 配置失败: {e}"), None))?;

    let inbounds_view = build_inbounds_view(&parsed);
    let clash_addr = parsed
        .get("experimental")
        .and_then(|e| e.get("clash_api"))
        .and_then(|c| c.get("external_controller"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    let mut sanitized = parsed.clone();
    sanitize_singbox_json(&mut sanitized);
    let pretty = serde_json::to_string_pretty(&sanitized).unwrap_or(raw);

    let backups: Vec<String> = match exec_alpine_script(node, fallback_key_path, "backups", None).await {
        Ok((out, _)) => out
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .map(str::to_string)
            .collect(),
        Err(_) => Vec::new(),
    };

    Ok(json!({
        "ok": true,
        "host": node.public_ip,
        "publicKey": node.reality_public_key,
        "inbounds": inbounds_view,
        "rules": sanitized.get("route").and_then(|r| r.get("rules")).cloned().unwrap_or_else(|| json!([])),
        "dns": sanitized.get("dns").cloned().unwrap_or_else(|| json!({})),
        "log": sanitized.get("log").cloned().unwrap_or_else(|| json!({})),
        "backups": backups,
        "clashApiEnabled": !clash_addr.is_empty(),
        "clashApiAddr": clash_addr,
        "rawJson": pretty
    }))
}

fn gen_ss2022_password() -> String {
    B64.encode(Uuid::new_v4().as_bytes())
}

fn gen_hex_password() -> String {
    Uuid::new_v4().simple().to_string()[..24].to_string()
}

fn sync_alpine_auth_rules(sc: &mut Value) {
    let clash_enabled = sc
        .get("experimental")
        .and_then(|e| e.get("clash_api"))
        .and_then(|c| c.get("external_controller"))
        .and_then(Value::as_str)
        .is_some_and(|s| !s.is_empty());

    let mut user_names: BTreeSet<String> = BTreeSet::new();
    if let Some(inbs) = sc.get("inbounds").and_then(Value::as_array) {
        for inb in inbs {
            if let Some(users) = inb.get("users").and_then(Value::as_array) {
                for u in users {
                    if let Some(n) = u
                        .get("name")
                        .or_else(|| u.get("username"))
                        .and_then(Value::as_str)
                        .filter(|s| !s.is_empty())
                    {
                        user_names.insert(n.to_string());
                    }
                }
            }
        }
    }

    let route = sc
        .as_object_mut()
        .expect("root object")
        .entry("route")
        .or_insert_with(|| json!({ "rules": [], "final": "direct" }));
    let rules = route
        .as_object_mut()
        .expect("route object")
        .entry("rules")
        .or_insert_with(|| json!([]))
        .as_array_mut()
        .expect("rules array");

    rules.retain(|r| {
        let Some(obj) = r.as_object() else { return true };
        !(obj.len() == 2
            && obj.get("outbound").and_then(Value::as_str) == Some("direct")
            && obj
                .get("auth_user")
                .and_then(Value::as_array)
                .is_some_and(|a| a.len() == 1))
    });

    if clash_enabled {
        for uname in user_names {
            rules.push(json!({ "auth_user": [uname], "outbound": "direct" }));
        }
    }
}

async fn apply_alpine_json(
    node: &NatNodeConfig,
    fallback_key_path: &str,
    sc: &Value,
) -> Result<String, SshError> {
    let pretty = serde_json::to_string_pretty(sc)
        .map_err(|e| SshError::new("JSON_ERR", format!("序列化配置失败: {e}"), None))?
        + "\n";
    let encoded = B64.encode(pretty.as_bytes());
    let (out, _) =
        exec_alpine_script(node, fallback_key_path, "apply_config", Some(&encoded)).await?;
    Ok(out)
}

async fn generate_alpine_reality_keypair(
    node: &NatNodeConfig,
    fallback_key_path: &str,
) -> Result<(String, String), SshError> {
    let (out, _) = exec_alpine_script(node, fallback_key_path, "gen_reality", None).await?;
    let mut priv_k = String::new();
    let mut pub_k = String::new();
    for line in out.lines() {
        if let Some((k, v)) = line.split_once(':') {
            let key = k.trim().to_ascii_lowercase();
            let val = v.trim().to_string();
            if key.contains("private") {
                priv_k = val;
            } else if key.contains("public") {
                pub_k = val;
            }
        }
    }
    if priv_k.is_empty() || pub_k.is_empty() {
        return Err(SshError::new(
            "REALITY_KEY_ERR",
            format!("无法生成 Reality 密钥对: {out}"),
            None,
        ));
    }
    Ok((priv_k, pub_k))
}

async fn build_alpine_inbound(
    node: &NatNodeConfig,
    fallback_key_path: &str,
    proto: &str,
    tag: &str,
    port: u16,
    req: &InboundMutateInput,
    existing: Option<&Value>,
) -> Result<(Value, Option<String>), SshError> {
    let mut derived_pub_key: Option<String> = None;
    let built = match proto {
        "socks" | "http" | "mixed" => {
            let uname = req
                .username
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("user");
            let pwd = req
                .password
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .unwrap_or_else(gen_hex_password);

            let mut users_arr: Vec<Value> = existing
                .filter(|e| {
                    matches!(
                        e.get("type").and_then(Value::as_str),
                        Some("socks" | "http" | "mixed")
                    )
                })
                .and_then(|e| e.get("users").and_then(Value::as_array))
                .cloned()
                .unwrap_or_default();

            if users_arr.is_empty() {
                users_arr.push(json!({ "username": uname, "password": pwd }));
            } else if req.username.is_some() || req.password.is_some() {
                let first_name = req
                    .username
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .or_else(|| users_arr[0].get("username").and_then(Value::as_str))
                    .unwrap_or("user")
                    .to_string();
                let first_pwd = req
                    .password
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
                    .or_else(|| {
                        users_arr[0]
                            .get("password")
                            .and_then(Value::as_str)
                            .map(str::to_string)
                    })
                    .unwrap_or_else(gen_hex_password);
                users_arr[0] = json!({ "username": first_name, "password": first_pwd });
            }

            json!({
                "type": proto,
                "tag": tag,
                "listen": "::",
                "listen_port": port,
                "users": users_arr
            })
        }
        "shadowsocks" => {
            let method = req
                .method
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or(SS2022_DEFAULT_METHOD);
            let raw_pwd = req
                .password
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty());
            let final_pwd = match raw_pwd {
                Some(p) if method != SS2022_DEFAULT_METHOD => p.to_string(),
                Some(p) => match B64.decode(p) {
                    Ok(bytes) if bytes.len() == 16 => p.to_string(),
                    _ => gen_ss2022_password(),
                },
                None => gen_ss2022_password(),
            };
            json!({
                "type": "shadowsocks",
                "tag": tag,
                "listen": "::",
                "listen_port": port,
                "method": method,
                "password": final_pwd
            })
        }
        "vless" => {
            let sni = req
                .sni
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .or_else(|| {
                    existing
                        .and_then(|e| e.get("tls"))
                        .and_then(|t| t.get("server_name"))
                        .and_then(Value::as_str)
                })
                .unwrap_or(DEFAULT_SNI);

            let existing_priv = existing
                .and_then(|e| e.get("tls"))
                .and_then(|t| t.get("reality"))
                .and_then(|r| r.get("private_key"))
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(str::to_string);

            let priv_key = match existing_priv {
                Some(pk) => pk,
                None => {
                    let (sk, pk) = generate_alpine_reality_keypair(node, fallback_key_path).await?;
                    derived_pub_key = Some(pk);
                    sk
                }
            };
            let sid = existing
                .and_then(|e| e.get("tls"))
                .and_then(|t| t.get("reality"))
                .and_then(|r| r.get("short_id"))
                .and_then(|s| s.as_array())
                .and_then(|a| a.first())
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| Uuid::new_v4().simple().to_string()[..16].to_string());

            let users_arr: Vec<Value> = existing
                .filter(|e| e.get("type").and_then(Value::as_str) == Some("vless"))
                .and_then(|e| e.get("users").and_then(Value::as_array))
                .filter(|a| !a.is_empty())
                .cloned()
                .unwrap_or_else(|| {
                    let uname = req
                        .username
                        .as_deref()
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .unwrap_or("nat-user");
                    let uid = req
                        .password
                        .as_deref()
                        .map(str::trim)
                        .filter(|s| Uuid::parse_str(s).is_ok())
                        .map(str::to_string)
                        .unwrap_or_else(|| Uuid::new_v4().to_string());
                    vec![json!({ "name": uname, "uuid": uid, "flow": DEFAULT_VLESS_FLOW })]
                });

            json!({
                "type": "vless",
                "tag": tag,
                "listen": "::",
                "listen_port": port,
                "users": users_arr,
                "tls": {
                    "enabled": true,
                    "server_name": sni,
                    "reality": {
                        "enabled": true,
                        "handshake": { "server": sni, "server_port": 443 },
                        "private_key": priv_key,
                        "short_id": [sid]
                    }
                }
            })
        }
        _ => {
            return Err(SshError::new(
                "VALIDATION_ERROR",
                format!("不支持的协议类型: {proto}"),
                None,
            ))
        }
    };
    Ok((built, derived_pub_key))
}

/// 在 Alpine NAT 执行入站节点或用户的增/删/改（自动备份 + sing-box check + 失败自动回滚）
pub async fn mutate_alpine_inbound(
    node: &NatNodeConfig,
    fallback_key_path: &str,
    req: &InboundMutateInput,
) -> Result<(Value, Option<String>), SshError> {
    let (raw, _) = exec_alpine_script(node, fallback_key_path, "config", None).await?;
    let mut sc: Value = serde_json::from_str(&raw)
        .map_err(|e| SshError::new("JSON_ERR", format!("解析 NAT sing-box 配置失败: {e}"), None))?;

    let tag_re = Regex::new(INBOUND_TAG_PATTERN).expect("valid inbound tag regex");
    let user_re = Regex::new(NODE_USERNAME_PATTERN).expect("valid username regex");
    let mut derived_pub_key: Option<String> = None;

    let inbs_len = sc
        .get("inbounds")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0);

    let msg: String;

    match req.op.as_str() {
        "add" => {
            let proto = req.proto.as_deref().unwrap_or("socks").trim();
            if !SUPPORTED_INBOUND_PROTOS.contains(&proto) {
                return Err(SshError::new("VALIDATION_ERROR", "不支持的入站协议", None));
            }
            let tag = req.tag.as_deref().unwrap_or("").trim();
            if !tag_re.is_match(tag) {
                return Err(SshError::new(
                    "VALIDATION_ERROR",
                    "节点标识仅支持 2-32 位英文字母、数字、下划线或短横线",
                    None,
                ));
            }
            let port = req.port.unwrap_or(0);
            if port < 1024 {
                return Err(SshError::new("VALIDATION_ERROR", "监听端口必须在 1024-65535 之间", None));
            }
            if let Some(inbs) = sc.get("inbounds").and_then(Value::as_array) {
                if inbs.iter().any(|x| x.get("listen_port").and_then(Value::as_u64) == Some(u64::from(port))) {
                    return Err(SshError::new("VALIDATION_ERROR", format!("端口 {port} 已被占用"), None));
                }
                if inbs.iter().any(|x| x.get("tag").and_then(Value::as_str) == Some(tag)) {
                    return Err(SshError::new("VALIDATION_ERROR", format!("节点标识「{tag}」已存在"), None));
                }
            }
            let (new_inb, pk) = build_alpine_inbound(
                node,
                fallback_key_path,
                proto,
                tag,
                port,
                req,
                None,
            )
            .await?;
            if pk.is_some() {
                derived_pub_key = pk;
            }
            sc.as_object_mut()
                .expect("root obj")
                .entry("inbounds")
                .or_insert_with(|| json!([]))
                .as_array_mut()
                .expect("inbounds arr")
                .push(new_inb);
            let port_tip = if port != node.service_port {
                format!("（若公网端口未映射 {port}，请在 NAT 控制面板 → 端口映射补充）")
            } else {
                String::new()
            };
            msg = format!("已在 {} 新增 {} 节点「{}」(:{}){}", node.name, proto.to_uppercase(), tag, port, port_tip);
        }
        "edit" => {
            let orig_tag = req.orig_tag.as_deref().unwrap_or("").trim();
            let existing = sc
                .get("inbounds")
                .and_then(Value::as_array)
                .and_then(|arr| arr.iter().position(|x| x.get("tag").and_then(Value::as_str) == Some(orig_tag)))
                .ok_or_else(|| SshError::new("NOT_FOUND", format!("未找到节点「{orig_tag}」"), None))?;
            let cur_clone = sc["inbounds"][existing].clone();
            let proto = req
                .proto
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| cur_clone.get("type").and_then(Value::as_str).unwrap_or("socks"));
            if !SUPPORTED_INBOUND_PROTOS.contains(&proto) {
                return Err(SshError::new("VALIDATION_ERROR", "不支持的入站协议", None));
            }
            let tag = req
                .tag
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or(orig_tag);
            if !tag_re.is_match(tag) {
                return Err(SshError::new(
                    "VALIDATION_ERROR",
                    "节点标识仅支持 2-32 位英文字母、数字、下划线或短横线",
                    None,
                ));
            }
            let port = req
                .port
                .filter(|&p| p >= 1024)
                .unwrap_or_else(|| cur_clone.get("listen_port").and_then(Value::as_u64).unwrap_or(25000) as u16);

            if let Some(inbs) = sc.get("inbounds").and_then(Value::as_array) {
                for (i, x) in inbs.iter().enumerate() {
                    if i == existing {
                        continue;
                    }
                    if x.get("listen_port").and_then(Value::as_u64) == Some(u64::from(port)) {
                        return Err(SshError::new("VALIDATION_ERROR", format!("端口 {port} 已被其他节点占用"), None));
                    }
                    if x.get("tag").and_then(Value::as_str) == Some(tag) {
                        return Err(SshError::new("VALIDATION_ERROR", format!("节点标识「{tag}」已存在"), None));
                    }
                }
            }
            let (updated, pk) = build_alpine_inbound(
                node,
                fallback_key_path,
                proto,
                tag,
                port,
                req,
                Some(&cur_clone),
            )
            .await?;
            if pk.is_some() {
                derived_pub_key = pk;
            }
            sc["inbounds"][existing] = updated;
            msg = format!("已更新 {} 节点「{}」({} :{})", node.name, tag, proto.to_uppercase(), port);
        }
        "delete" => {
            let tag = req.tag.as_deref().unwrap_or("").trim();
            if inbs_len <= 1 {
                return Err(SshError::new(
                    "VALIDATION_ERROR",
                    "至少保留 1 个有效入站节点（如需更换协议请直接点击「编辑」）",
                    None,
                ));
            }
            let arr = sc
                .get_mut("inbounds")
                .and_then(Value::as_array_mut)
                .ok_or_else(|| SshError::new("NOT_FOUND", "配置中无入站节点", None))?;
            let before = arr.len();
            arr.retain(|x| x.get("tag").and_then(Value::as_str) != Some(tag));
            if arr.len() == before {
                return Err(SshError::new("NOT_FOUND", format!("未找到节点「{tag}」"), None));
            }
            msg = format!("已从 {} 删除节点「{}」", node.name, tag);
        }
        "upsert_user" => {
            let tag = req.tag.as_deref().unwrap_or("").trim();
            let uname = req.username.as_deref().unwrap_or("").trim();
            let orig_name = req.orig_name.as_deref().unwrap_or("").trim();
            let pwd = req.password.as_deref().unwrap_or("").trim();
            if !user_re.is_match(uname) {
                return Err(SshError::new(
                    "VALIDATION_ERROR",
                    "用户名需为 1-32 位有效字符（不可含冒号/引号/斜杠）",
                    None,
                ));
            }
            let arr = sc
                .get_mut("inbounds")
                .and_then(Value::as_array_mut)
                .ok_or_else(|| SshError::new("NOT_FOUND", "配置中无入站节点", None))?;
            let inb = arr
                .iter_mut()
                .find(|x| x.get("tag").and_then(Value::as_str) == Some(tag))
                .ok_or_else(|| SshError::new("NOT_FOUND", format!("未找到节点「{tag}」"), None))?;
            let itype = inb.get("type").and_then(Value::as_str).unwrap_or("").to_string();

            match itype.as_str() {
                "socks" | "http" | "mixed" => {
                    let users = inb
                        .as_object_mut()
                        .expect("inb obj")
                        .entry("users")
                        .or_insert_with(|| json!([]))
                        .as_array_mut()
                        .expect("users arr");
                    if !orig_name.is_empty() {
                        let target = users
                            .iter_mut()
                            .find(|u| u.get("username").and_then(Value::as_str) == Some(orig_name))
                            .ok_or_else(|| SshError::new("NOT_FOUND", format!("未找到用户 {orig_name}"), None))?;
                        target["username"] = json!(uname);
                        if !pwd.is_empty() {
                            target["password"] = json!(pwd);
                        }
                    } else {
                        if users.iter().any(|u| u.get("username").and_then(Value::as_str) == Some(uname)) {
                            return Err(SshError::new("VALIDATION_ERROR", format!("用户「{uname}」已存在"), None));
                        }
                        let final_pwd = if pwd.is_empty() { gen_hex_password() } else { pwd.to_string() };
                        users.push(json!({ "username": uname, "password": final_pwd }));
                    }
                    msg = format!("已更新 {} [{}] 用户「{}」", node.name, tag, uname);
                }
                "vless" => {
                    let users = inb
                        .as_object_mut()
                        .expect("inb obj")
                        .entry("users")
                        .or_insert_with(|| json!([]))
                        .as_array_mut()
                        .expect("users arr");
                    let next_uid = if pwd.is_empty() {
                        Uuid::new_v4().to_string()
                    } else {
                        Uuid::parse_str(pwd)
                            .map_err(|_| SshError::new("VALIDATION_ERROR", "VLESS 密码必须为标准 UUID 格式", None))?;
                        pwd.to_string()
                    };
                    if !orig_name.is_empty() {
                        let target = users
                            .iter_mut()
                            .find(|u| u.get("name").and_then(Value::as_str) == Some(orig_name))
                            .ok_or_else(|| SshError::new("NOT_FOUND", format!("未找到用户 {orig_name}"), None))?;
                        target["name"] = json!(uname);
                        if !pwd.is_empty() {
                            target["uuid"] = json!(next_uid);
                        }
                    } else {
                        if users.iter().any(|u| u.get("name").and_then(Value::as_str) == Some(uname)) {
                            return Err(SshError::new("VALIDATION_ERROR", format!("用户「{uname}」已存在"), None));
                        }
                        users.push(json!({ "name": uname, "uuid": next_uid, "flow": DEFAULT_VLESS_FLOW }));
                    }
                    msg = format!("已更新 {} [{}] VLESS 用户「{}」", node.name, tag, uname);
                }
                "shadowsocks" => {
                    let next_pwd = if pwd.is_empty() { gen_ss2022_password() } else { pwd.to_string() };
                    inb["password"] = json!(next_pwd);
                    msg = format!("已更新 {} [{}] Shadowsocks 密码", node.name, tag);
                }
                _ => {
                    return Err(SshError::new("VALIDATION_ERROR", format!("协议 {itype} 不支持独立用户编辑"), None));
                }
            }
        }
        "delete_user" => {
            let tag = req.tag.as_deref().unwrap_or("").trim();
            let uname = req.username.as_deref().unwrap_or("").trim();
            let arr = sc
                .get_mut("inbounds")
                .and_then(Value::as_array_mut)
                .ok_or_else(|| SshError::new("NOT_FOUND", "配置中无入站节点", None))?;
            let inb = arr
                .iter_mut()
                .find(|x| x.get("tag").and_then(Value::as_str) == Some(tag))
                .ok_or_else(|| SshError::new("NOT_FOUND", format!("未找到节点「{tag}」"), None))?;
            let users = inb
                .get_mut("users")
                .and_then(Value::as_array_mut)
                .ok_or_else(|| SshError::new("VALIDATION_ERROR", "该协议不支持按用户移除", None))?;
            if users.len() <= 1 {
                return Err(SshError::new("VALIDATION_ERROR", "每个节点至少保留 1 个有效用户", None));
            }
            let before = users.len();
            users.retain(|u| {
                u.get("username")
                    .or_else(|| u.get("name"))
                    .and_then(Value::as_str)
                    != Some(uname)
            });
            if users.len() == before {
                return Err(SshError::new("NOT_FOUND", format!("未找到用户「{uname}」"), None));
            }
            msg = format!("已从 {} [{}] 移除用户「{}」", node.name, tag, uname);
        }
        _ => return Err(SshError::new("VALIDATION_ERROR", "未知的节点操作", None)),
    }

    sync_alpine_auth_rules(&mut sc);
    let apply_out = apply_alpine_json(node, fallback_key_path, &sc).await?;

    Ok((
        json!({
            "ok": true,
            "message": msg,
            "backup": apply_out,
            "realityPublicKey": derived_pub_key
        }),
        derived_pub_key,
    ))
}

/// 恢复 Alpine NAT 历史配置备份
pub async fn restore_alpine_backup(
    node: &NatNodeConfig,
    fallback_key_path: &str,
    backup: &str,
) -> Result<Value, SshError> {
    let trimmed = backup.trim();
    let re = Regex::new(NAT_BACKUP_NAME_PATTERN).expect("valid backup regex");
    if !re.is_match(trimmed) {
        return Err(SshError::new("VALIDATION_ERROR", "非法备份文件名", None));
    }
    let (out, _) = exec_alpine_script(node, fallback_key_path, "restore_backup", Some(trimmed)).await?;
    Ok(json!({ "ok": true, "message": out }))
}

/// 读取 Alpine NAT 的 sing-box 运行日志（/var/log/sing-box.log）
pub async fn fetch_alpine_logs(
    node: &NatNodeConfig,
    fallback_key_path: &str,
    lines: u64,
) -> Result<Value, SshError> {
    let clamped = lines.clamp(20, 400).to_string();
    let (out, _) = exec_alpine_script(node, fallback_key_path, "logs", Some(&clamped)).await?;
    Ok(json!({ "ok": true, "logs": out }))
}

/// 在 Alpine NAT 执行只读诊断或重启（check / restart / ports）
pub async fn run_alpine_service_action(
    node: &NatNodeConfig,
    fallback_key_path: &str,
    action: &str,
) -> Result<Value, SshError> {
    if !matches!(action, "check" | "restart" | "ports") {
        return Err(SshError::new("VALIDATION_ERROR", "不支持的 Alpine NAT 运维动作", None));
    }
    let (out, _) = exec_alpine_script(node, fallback_key_path, action, None).await?;
    Ok(json!({ "ok": true, "output": out }))
}

// ---------- Alpine NAT 可选本地 127.0.0.1 实时连接与用户在线统计（零公网暴露） ----------

pub async fn configure_alpine_audit(
    node: &NatNodeConfig,
    fallback_key_path: &str,
    enable: bool,
) -> Result<Value, SshError> {
    let (raw, _) = exec_alpine_script(node, fallback_key_path, "config", None).await?;
    let mut sc: Value = serde_json::from_str(&raw)
        .map_err(|e| SshError::new("JSON_ERR", format!("解析 NAT sing-box 配置失败: {e}"), None))?;

    let msg = if enable {
        let secret = Uuid::new_v4().simple().to_string();
        let addr = format!("127.0.0.1:{DEFAULT_NAT_CLASH_API_PORT}");
        let exp = sc
            .as_object_mut()
            .expect("root")
            .entry("experimental")
            .or_insert_with(|| json!({}));
        let ca = exp
            .as_object_mut()
            .expect("exp")
            .entry("clash_api")
            .or_insert_with(|| json!({}));
        ca["external_controller"] = json!(addr);
        if ca.get("secret").and_then(Value::as_str).unwrap_or("").is_empty() {
            ca["secret"] = json!(secret);
        }
        format!("已为 {} 开启本机统计（仅监听 127.0.0.1:{DEFAULT_NAT_CLASH_API_PORT}，公网零暴露）", node.name)
    } else {
        if let Some(exp) = sc.get_mut("experimental").and_then(Value::as_object_mut) {
            exp.remove("clash_api");
            if exp.is_empty() {
                if let Some(root) = sc.as_object_mut() {
                    root.remove("experimental");
                }
            }
        }
        format!("已关闭 {} 本机统计接口", node.name)
    };

    sync_alpine_auth_rules(&mut sc);
    apply_alpine_json(node, fallback_key_path, &sc).await?;
    Ok(json!({ "ok": true, "message": msg }))
}

pub async fn fetch_alpine_audit(
    node: &NatNodeConfig,
    fallback_key_path: &str,
) -> Result<Value, SshError> {
    let (raw, _) = exec_alpine_script(node, fallback_key_path, "config", None).await?;
    let sc: Value = serde_json::from_str(&raw)
        .map_err(|e| SshError::new("JSON_ERR", format!("解析 NAT sing-box 配置失败: {e}"), None))?;

    let mut configured_users: Vec<String> = Vec::new();
    if let Some(inbs) = sc.get("inbounds").and_then(Value::as_array) {
        for inb in inbs {
            for u in extract_users_detail(inb) {
                let name = u["name"].as_str().unwrap_or("");
                if !name.is_empty() && !configured_users.iter().any(|x| x == name) {
                    configured_users.push(name.to_string());
                }
            }
        }
    }

    let ca = sc.get("experimental").and_then(|e| e.get("clash_api"));
    let controller = ca
        .and_then(|c| c.get("external_controller"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let secret = ca
        .and_then(|c| c.get("secret"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    if controller.is_empty() {
        return Ok(json!({
            "ok": true,
            "data": {
                "enabled": false,
                "controller": "",
                "configuredUsers": configured_users,
                "uploadTotal": 0,
                "downloadTotal": 0,
                "connections": [],
                "userSummary": {}
            }
        }));
    }

    let param = format!("{controller}|{secret}");
    let (conn_raw, _) = exec_alpine_script(node, fallback_key_path, "audit", Some(&param)).await?;
    let data: Value = serde_json::from_str(&conn_raw).unwrap_or_else(|_| json!({}));

    let mut user_summary: HashMap<String, (u64, u64, u64, BTreeSet<String>)> = HashMap::new();
    for u in &configured_users {
        user_summary.insert(u.clone(), (0, 0, 0, BTreeSet::new()));
    }

    let mut norm_conns: Vec<Value> = Vec::new();
    if let Some(arr) = data.get("connections").and_then(Value::as_array) {
        for c in arr {
            let meta = c.get("metadata").cloned().unwrap_or(Value::Null);
            let rule_str = c.get("rule").and_then(Value::as_str).unwrap_or("");
            let rule_payload = c.get("rulePayload").and_then(Value::as_str).unwrap_or("");
            let mut uname = meta
                .get("user")
                .or_else(|| meta.get("inboundUser"))
                .or_else(|| meta.get("authUser"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if uname.is_empty() && !rule_payload.is_empty() && configured_users.iter().any(|x| x == rule_payload) {
                uname = rule_payload.to_string();
            }
            if uname.is_empty() {
                if let Some(pos) = rule_str.find("auth_user=") {
                    let rest = &rule_str[pos + 10..];
                    let cleaned = rest.trim_start_matches('[').split([']', ',', ' ']).next().unwrap_or("");
                    if !cleaned.is_empty() {
                        uname = cleaned.to_string();
                    }
                }
            }
            if uname.is_empty() {
                uname = configured_users
                    .first()
                    .cloned()
                    .unwrap_or_else(|| "默认用户".to_string());
            }

            let src_ip = meta.get("sourceIP").and_then(Value::as_str).unwrap_or("").to_string();
            let host = meta
                .get("host")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .or_else(|| meta.get("destinationIP").and_then(Value::as_str))
                .unwrap_or("")
                .to_string();
            let port = meta
                .get("destinationPort")
                .map(|v| match v {
                    Value::String(s) => s.clone(),
                    Value::Number(n) => n.to_string(),
                    _ => String::new(),
                })
                .unwrap_or_default();
            let up = c.get("upload").and_then(Value::as_u64).unwrap_or(0);
            let down = c.get("download").and_then(Value::as_u64).unwrap_or(0);

            let entry = user_summary
                .entry(uname.clone())
                .or_insert_with(|| (0, 0, 0, BTreeSet::new()));
            entry.0 += 1;
            entry.1 = entry.1.saturating_add(up);
            entry.2 = entry.2.saturating_add(down);
            if !src_ip.is_empty() {
                entry.3.insert(src_ip.clone());
            }

            norm_conns.push(json!({
                "id": c.get("id").and_then(Value::as_str).unwrap_or(""),
                "user": uname,
                "sourceIP": src_ip,
                "host": host,
                "port": port,
                "network": meta.get("network").and_then(Value::as_str).unwrap_or(""),
                "upload": up,
                "download": down,
                "suspicious": false
            }));
        }
    }

    norm_conns.sort_by(|a, b| {
        let ta = a["upload"].as_u64().unwrap_or(0) + a["download"].as_u64().unwrap_or(0);
        let tb = b["upload"].as_u64().unwrap_or(0) + b["download"].as_u64().unwrap_or(0);
        tb.cmp(&ta)
    });
    norm_conns.truncate(150);

    let mut summary_obj = serde_json::Map::new();
    for (u, (cnt, up, down, ips)) in user_summary {
        summary_obj.insert(
            u,
            json!({
                "activeConnections": cnt,
                "upload": up,
                "download": down,
                "sourceIPs": ips.into_iter().collect::<Vec<_>>(),
                "suspiciousHosts": []
            }),
        );
    }

    Ok(json!({
        "ok": true,
        "data": {
            "enabled": true,
            "controller": controller,
            "logLevel": "warn",
            "configuredUsers": configured_users,
            "uploadTotal": data.get("uploadTotal").and_then(Value::as_u64).unwrap_or(0),
            "downloadTotal": data.get("downloadTotal").and_then(Value::as_u64).unwrap_or(0),
            "connections": norm_conns,
            "userSummary": Value::Object(summary_obj),
            "recentLogSummary": {}
        }
    }))
}

pub async fn close_alpine_conn(
    node: &NatNodeConfig,
    fallback_key_path: &str,
    conn_id: &str,
) -> Result<Value, SshError> {
    let (raw, _) = exec_alpine_script(node, fallback_key_path, "config", None).await?;
    let sc: Value = serde_json::from_str(&raw)
        .map_err(|e| SshError::new("JSON_ERR", format!("解析 NAT 配置失败: {e}"), None))?;
    let ca = sc.get("experimental").and_then(|e| e.get("clash_api"));
    let controller = ca
        .and_then(|c| c.get("external_controller"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let secret = ca.and_then(|c| c.get("secret")).and_then(Value::as_str).unwrap_or("");
    if controller.is_empty() {
        return Err(SshError::new("AUDIT_OFF", "本机统计接口未开启", None));
    }
    let param = format!("{controller}|{secret}|{conn_id}");
    exec_alpine_script(node, fallback_key_path, "close_conn", Some(&param)).await?;
    Ok(json!({ "ok": true }))
}

// ---------- 宿主机原生多出口切换、计费解析与诊断（自动探测） ----------

fn parse_size_to_bytes(text: &str) -> u64 {
    let re = Regex::new(r"([\d.]+)\s*(TB|GB|MB|KB|B)").expect("size regex");
    let Some(cap) = re.captures(text) else {
        return 0;
    };
    let val: f64 = cap[1].parse().unwrap_or(0.0);
    let mult: f64 = match cap[2].to_ascii_uppercase().as_str() {
        "TB" => 1099511627776.0,
        "GB" => 1073741824.0,
        "MB" => 1048576.0,
        "KB" => 1024.0,
        _ => 1.0,
    };
    (val * mult).round() as u64
}

fn map_exit_label_to_code(label: &str) -> &'static str {
    let lower = label.to_ascii_lowercase();
    if lower.contains("america") || lower.contains("at&t") {
        "us"
    } else if lower.contains("australia") {
        "au"
    } else if lower.contains("hgc") {
        "hgc"
    } else if lower.contains("hkt") {
        "hkt"
    } else if lower.contains("japan") || lower.contains("softbank") {
        "jp"
    } else if lower.contains("korea") {
        "kr"
    } else if lower.contains("特价") {
        "mos"
    } else if lower.contains("macau") || lower.contains("ctm") {
        "mo"
    } else if lower.contains("malaysia") {
        "my"
    } else if lower.contains("singapore") || lower.contains("viewqwest") {
        "sgv"
    } else if lower.contains("直连") || lower.contains("direct") {
        "direct"
    } else {
        ""
    }
}

pub async fn fetch_nat_exit_status(
    node: &NatNodeConfig,
    fallback_key_path: &str,
) -> Result<(Value, Option<TrafficSnapshot>), SshError> {
    let (stdout, _) = exec_alpine_script(node, fallback_key_path, "exit_status", None).await?;
    let mut lines = stdout.lines();
    let kind_line = lines.next().unwrap_or("KIND=none").trim();
    let kind = kind_line.strip_prefix("KIND=").unwrap_or("none");
    let body: Vec<&str> = lines.collect();

    if kind == "global" {
        let mut current_exit = String::new();
        let mut multiplier = String::new();
        let mut plan = String::new();
        let mut cycle = String::new();
        let mut expires_at = String::new();
        let mut billed_text = String::new();
        let mut total_text = String::new();
        let mut remain_text = String::new();
        let mut quota_status = String::new();
        let mut breakdown: Vec<Value> = Vec::new();

        for raw_line in &body {
            let line = raw_line.trim();
            if let Some(v) = line.strip_prefix("当前出口：") {
                current_exit = v.trim().to_string();
            } else if let Some(v) = line.strip_prefix("当前倍率：") {
                multiplier = v.trim().to_string();
            } else if let Some(v) = line.strip_prefix("套餐：") {
                plan = v.trim().to_string();
            } else if let Some(v) = line.strip_prefix("计费周期：") {
                cycle = v.trim().to_string();
            } else if let Some(v) = line.strip_prefix("到期时间：") {
                expires_at = v.trim().to_string();
            } else if let Some(v) = line.strip_prefix("已计费流量：") {
                billed_text = v.trim().to_string();
            } else if let Some(v) = line.strip_prefix("套餐总额度：") {
                total_text = v.trim().to_string();
            } else if let Some(v) = line.strip_prefix("剩余流量：") {
                remain_text = v.trim().to_string();
            } else if let Some(v) = line.strip_prefix("额度状态：") {
                quota_status = v.trim().to_string();
            } else if let Some((left, right)) = line.split_once("实际流量：") {
                let label = left.trim().to_string();
                let code = map_exit_label_to_code(&label);
                let (usage_part, mult_part) = right
                    .split_once('×')
                    .map(|(a, b)| (a.trim().to_string(), b.trim().to_string()))
                    .unwrap_or_else(|| (right.trim().to_string(), "1".to_string()));
                breakdown.push(json!({
                    "label": label,
                    "code": code,
                    "usageText": usage_part,
                    "multiplier": mult_part
                }));
            }
        }

        let used_bytes = parse_size_to_bytes(&billed_text);
        let total_bytes = parse_size_to_bytes(&total_text);
        let percent = if total_bytes > 0 {
            ((used_bytes as f64 * 100.0 / total_bytes as f64) * 10.0).round() / 10.0
        } else {
            0.0
        };
        let short_exp = expires_at.split_whitespace().next().unwrap_or("").to_string();
        let now_ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs().to_string())
            .unwrap_or_default();

        let snapshot = if total_bytes > 0 {
            Some(TrafficSnapshot {
                used_bytes,
                total_bytes,
                used_text: billed_text.clone(),
                total_text: total_text.clone(),
                percent,
                cycle_text: cycle.clone(),
                expires_at: short_exp.clone(),
                synced_at: now_ts,
                source: "host-billing".to_string(),
            })
        } else {
            None
        };

        return Ok((
            json!({
                "ok": true,
                "kind": "global",
                "currentExit": current_exit,
                "currentExitCode": map_exit_label_to_code(&current_exit),
                "multiplier": multiplier,
                "plan": plan,
                "cycle": cycle,
                "expiresAt": short_exp,
                "billedText": billed_text,
                "totalText": total_text,
                "remainText": remain_text,
                "usedBytes": used_bytes,
                "totalBytes": total_bytes,
                "percent": percent,
                "quotaStatus": quota_status,
                "breakdown": breakdown
            }),
            snapshot,
        ));
    }

    if kind == "jp" {
        let joined = body.join("\n");
        let parsed: Value = serde_json::from_str(joined.trim()).unwrap_or_else(|_| json!({}));
        let mode = parsed.get("mode").and_then(Value::as_str).unwrap_or("jp");
        let label = parsed
            .get("label")
            .and_then(Value::as_str)
            .unwrap_or("Japan SoftBank 家宽");
        let billing = parsed
            .get("billing")
            .and_then(Value::as_str)
            .unwrap_or("panel-native");
        return Ok((
            json!({
                "ok": true,
                "kind": "jp",
                "currentExit": label,
                "currentExitCode": mode,
                "billing": billing
            }),
            None,
        ));
    }

    Ok((json!({ "ok": true, "kind": "none" }), None))
}

pub async fn fetch_nat_exit_latency(
    node: &NatNodeConfig,
    fallback_key_path: &str,
) -> Result<Value, SshError> {
    let (stdout, _) = exec_alpine_script_timeout(
        node,
        fallback_key_path,
        "exit_latency",
        None,
        ALPINE_LATENCY_TIMEOUT_MS,
    )
    .await?;

    let mut items: Vec<Value> = Vec::new();
    for raw_line in stdout.lines() {
        let line = raw_line.trim();
        if let Some((left, right)) = line.split_once(':') {
            let label = left.trim().to_string();
            let val = right.trim().to_string();
            let code = map_exit_label_to_code(&label);
            let ms = val
                .strip_suffix("ms")
                .and_then(|s| s.trim().parse::<f64>().ok());
            items.push(json!({
                "label": label,
                "code": code,
                "reachable": ms.is_some(),
                "ms": ms,
                "rawText": val
            }));
        }
    }
    Ok(json!({ "ok": true, "items": items }))
}

pub async fn switch_nat_exit(
    node: &NatNodeConfig,
    fallback_key_path: &str,
    exit_code: &str,
) -> Result<(Value, Option<TrafficSnapshot>), SshError> {
    let code = exit_code.trim();
    if !RESIDENTIAL_EXIT_CODES.contains(&code) {
        return Err(SshError::new("VALIDATION_ERROR", format!("不支持的出口代号: {code}"), None));
    }
    exec_alpine_script_timeout(
        node,
        fallback_key_path,
        "exit_switch",
        Some(code),
        ALPINE_LATENCY_TIMEOUT_MS,
    )
    .await?;
    fetch_nat_exit_status(node, fallback_key_path).await
}

pub async fn run_nat_exit_diagnostics(
    node: &NatNodeConfig,
    fallback_key_path: &str,
) -> Result<Value, SshError> {
    let (stdout, elapsed_ms) = exec_alpine_script_timeout(
        node,
        fallback_key_path,
        "exit_diag",
        None,
        ALPINE_LONG_TIMEOUT_MS,
    )
    .await?;
    Ok(json!({
        "ok": true,
        "elapsedMs": elapsed_ms,
        "rawText": stdout
    }))
}
