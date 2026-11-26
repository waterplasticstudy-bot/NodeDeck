//! Alpine NAT sing-box 配置读取（单次 SSH 合并）、四协议增删改与无 Panic 安全回滚

use super::ssh::exec_alpine_script;
use crate::config::NatNodeConfig;
use crate::constants::{
    DEFAULT_SNI, DEFAULT_VLESS_FLOW, INBOUND_TAG_PATTERN, NODE_USERNAME_PATTERN,
    SS2022_DEFAULT_METHOD, SUPPORTED_INBOUND_PROTOS,
};
use crate::ssh_client::SshError;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashMap};
use std::sync::{Arc, Mutex as StdMutex, OnceLock};
use tokio::sync::Mutex as AsyncMutex;
use uuid::Uuid;

static INBOUND_TAG_RE: OnceLock<Regex> = OnceLock::new();
static NODE_USER_RE: OnceLock<Regex> = OnceLock::new();
static NODE_MUTATE_LOCKS: OnceLock<StdMutex<HashMap<String, Arc<AsyncMutex<()>>>>> =
    OnceLock::new();

fn node_mutate_lock(node_id: &str) -> Arc<AsyncMutex<()>> {
    let map = NODE_MUTATE_LOCKS.get_or_init(|| StdMutex::new(HashMap::new()));
    let mut guard = map.lock().unwrap_or_else(|e| e.into_inner());
    guard
        .entry(node_id.to_string())
        .or_insert_with(|| Arc::new(AsyncMutex::new(())))
        .clone()
}

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

pub(crate) fn extract_users_detail(raw_inb: &Value) -> Vec<Value> {
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

fn assemble_config_response(node: &NatNodeConfig, parsed: Value, raw: String, backups: Vec<String>) -> Value {
    let inbounds_view = build_inbounds_view(&parsed);
    let clash_addr = parsed
        .get("experimental")
        .and_then(|e| e.get("clash_api"))
        .and_then(|c| c.get("external_controller"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    let mut sanitized = parsed;
    sanitize_singbox_json(&mut sanitized);
    let pretty = serde_json::to_string_pretty(&sanitized).unwrap_or(raw);

    json!({
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
    })
}

/// 单次 SSH 读取 Alpine NAT sing-box 配置与备份清单（告别二次握手）
pub async fn fetch_alpine_config(
    node: &NatNodeConfig,
    fallback_key_path: &str,
) -> Result<Value, SshError> {
    let (bundle, _) = exec_alpine_script(node, fallback_key_path, "config_bundle", None).await?;
    let (raw_cfg, raw_baks) = bundle
        .split_once("\n===NODEDECK_BACKUPS===")
        .map(|(a, b)| (a.trim(), b))
        .unwrap_or((bundle.trim(), ""));

    let parsed: Value = serde_json::from_str(raw_cfg)
        .map_err(|e| SshError::new("JSON_ERR", format!("解析 NAT sing-box 配置失败: {e}"), None))?;

    let backups: Vec<String> = raw_baks
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(str::to_string)
        .collect();

    Ok(assemble_config_response(node, parsed, raw_cfg.to_string(), backups))
}

/// 轻量读取（仅拉 config.json，供全节点用户矩阵并发提速使用）
pub async fn fetch_alpine_config_fast(
    node: &NatNodeConfig,
    fallback_key_path: &str,
) -> Result<Value, SshError> {
    let (raw, _) = exec_alpine_script(node, fallback_key_path, "config", None).await?;
    let parsed: Value = serde_json::from_str(&raw)
        .map_err(|e| SshError::new("JSON_ERR", format!("解析 NAT sing-box 配置失败: {e}"), None))?;
    Ok(assemble_config_response(node, parsed, raw, Vec::new()))
}

fn gen_ss2022_password() -> String {
    B64.encode(Uuid::new_v4().as_bytes())
}

fn gen_hex_password() -> String {
    Uuid::new_v4().simple().to_string()[..24].to_string()
}

/// 安全同步 auth_user 审计规则（彻底移除 .expect()，兼容 route/rules 缺失或为 null 的畸形配置）
pub(crate) fn sync_alpine_auth_rules(sc: &mut Value) -> Result<(), SshError> {
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

    let root = sc
        .as_object_mut()
        .ok_or_else(|| SshError::new("JSON_ERR", "sing-box 配置根节点不是有效 JSON 对象", None))?;
    if !root.get("route").is_some_and(Value::is_object) {
        root.insert("route".to_string(), json!({ "rules": [], "final": "direct" }));
    }
    let route = root
        .get_mut("route")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| SshError::new("JSON_ERR", "sing-box route 字段异常", None))?;
    if !route.get("rules").is_some_and(Value::is_array) {
        route.insert("rules".to_string(), json!([]));
    }
    let rules = route
        .get_mut("rules")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| SshError::new("JSON_ERR", "sing-box route.rules 字段异常", None))?;

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
    Ok(())
}

pub(crate) async fn apply_alpine_json(
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

fn ensure_users_array(inb: &mut Value) -> Result<&mut Vec<Value>, SshError> {
    let obj = inb
        .as_object_mut()
        .ok_or_else(|| SshError::new("JSON_ERR", "入站节点结构异常", None))?;
    if !obj.get("users").is_some_and(Value::is_array) {
        obj.insert("users".to_string(), json!([]));
    }
    obj.get_mut("users")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| SshError::new("JSON_ERR", "入站 users 数组结构异常", None))
}

/// 在 Alpine NAT 执行入站节点或用户的增/删/改（按节点加锁防竞态 + 自动备份 + sing-box check + 失败回滚）
pub async fn mutate_alpine_inbound(
    node: &NatNodeConfig,
    fallback_key_path: &str,
    req: &InboundMutateInput,
) -> Result<(Value, Option<String>), SshError> {
    let lock = node_mutate_lock(&node.id);
    let _guard = lock.lock().await;

    let (raw, _) = exec_alpine_script(node, fallback_key_path, "config", None).await?;
    let mut sc: Value = serde_json::from_str(&raw)
        .map_err(|e| SshError::new("JSON_ERR", format!("解析 NAT sing-box 配置失败: {e}"), None))?;

    let tag_re =
        INBOUND_TAG_RE.get_or_init(|| Regex::new(INBOUND_TAG_PATTERN).expect("valid tag regex"));
    let user_re =
        NODE_USER_RE.get_or_init(|| Regex::new(NODE_USERNAME_PATTERN).expect("valid user regex"));
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
            let root = sc
                .as_object_mut()
                .ok_or_else(|| SshError::new("JSON_ERR", "sing-box 配置根节点异常", None))?;
            if !root.get("inbounds").is_some_and(Value::is_array) {
                root.insert("inbounds".to_string(), json!([]));
            }
            let inbs_arr = root
                .get_mut("inbounds")
                .and_then(Value::as_array_mut)
                .ok_or_else(|| SshError::new("JSON_ERR", "inbounds 字段异常", None))?;
            inbs_arr.push(new_inb);

            let port_tip = if port != node.service_port {
                format!("（若公网端口未映射 {port}，请在 NAT 控制面板 → 端口映射补充）")
            } else {
                String::new()
            };
            msg = format!(
                "已在 {} 新增 {} 节点「{}」(:{}){}",
                node.name,
                proto.to_uppercase(),
                tag,
                port,
                port_tip
            );
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
                .unwrap_or_else(|| {
                    cur_clone.get("listen_port").and_then(Value::as_u64).unwrap_or(25000) as u16
                });

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
                    let users = ensure_users_array(inb)?;
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
                    let users = ensure_users_array(inb)?;
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

    sync_alpine_auth_rules(&mut sc)?;
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
