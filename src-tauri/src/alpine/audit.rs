//! Alpine NAT 127.0.0.1 零公网暴露实时连接统计与防外泄/定位域审计（单次 SSH 合并提速）

use super::config::{apply_alpine_json, extract_users_detail, sync_alpine_auth_rules};
use super::ssh::exec_alpine_script;
use crate::config::NatNodeConfig;
use crate::constants::{DEFAULT_NAT_CLASH_API_PORT, SUSPICIOUS_LOCATION_DOMAINS};
use crate::ssh_client::SshError;
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashMap};
use uuid::Uuid;

#[derive(Default)]
struct UserAuditAcc {
    active_conns: u64,
    upload: u64,
    download: u64,
    source_ips: BTreeSet<String>,
    suspicious_hosts: BTreeSet<String>,
}

fn is_suspicious_location_host(host: &str) -> bool {
    let lower = host.trim().to_ascii_lowercase();
    if lower.is_empty() {
        return false;
    }
    SUSPICIOUS_LOCATION_DOMAINS
        .iter()
        .any(|d| lower == *d || lower.ends_with(&format!(".{d}")))
}

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
        let root = sc
            .as_object_mut()
            .ok_or_else(|| SshError::new("JSON_ERR", "sing-box 配置根节点异常", None))?;
        if !root.get("experimental").is_some_and(Value::is_object) {
            root.insert("experimental".to_string(), json!({}));
        }
        let exp = root
            .get_mut("experimental")
            .and_then(Value::as_object_mut)
            .ok_or_else(|| SshError::new("JSON_ERR", "experimental 字段异常", None))?;
        if !exp.get("clash_api").is_some_and(Value::is_object) {
            exp.insert("clash_api".to_string(), json!({}));
        }
        let ca = exp
            .get_mut("clash_api")
            .and_then(Value::as_object_mut)
            .ok_or_else(|| SshError::new("JSON_ERR", "clash_api 字段异常", None))?;
        ca.insert("external_controller".to_string(), json!(addr));
        if ca.get("secret").and_then(Value::as_str).unwrap_or("").is_empty() {
            ca.insert("secret".to_string(), json!(secret));
        }
        format!(
            "已为 {} 开启本机统计（仅监听 127.0.0.1:{DEFAULT_NAT_CLASH_API_PORT}，公网零暴露）",
            node.name
        )
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

    sync_alpine_auth_rules(&mut sc)?;
    apply_alpine_json(node, fallback_key_path, &sc).await?;
    Ok(json!({ "ok": true, "message": msg }))
}

/// 单次 SSH 读取 NAT 配置与实时连接，并补齐疑似定位域名标注（与主 VPS 审计能力齐平）
pub async fn fetch_alpine_audit(
    node: &NatNodeConfig,
    fallback_key_path: &str,
) -> Result<Value, SshError> {
    let (bundle, _) = exec_alpine_script(node, fallback_key_path, "audit_bundle", None).await?;
    let (raw_cfg, raw_conn) = bundle
        .split_once("\n===NODEDECK_AUDIT===")
        .map(|(a, b)| (a.trim(), b.trim()))
        .unwrap_or((bundle.trim(), ""));

    let sc: Value = serde_json::from_str(raw_cfg)
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

    let controller = sc
        .get("experimental")
        .and_then(|e| e.get("clash_api"))
        .and_then(|c| c.get("external_controller"))
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

    let data: Value = serde_json::from_str(raw_conn).unwrap_or_else(|_| json!({}));

    let mut user_summary: HashMap<String, UserAuditAcc> = HashMap::new();
    for u in &configured_users {
        user_summary.insert(u.clone(), UserAuditAcc::default());
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
            if uname.is_empty()
                && !rule_payload.is_empty()
                && configured_users.iter().any(|x| x == rule_payload)
            {
                uname = rule_payload.to_string();
            }
            if uname.is_empty() {
                if let Some(pos) = rule_str.find("auth_user=") {
                    let rest = &rule_str[pos + 10..];
                    let cleaned = rest
                        .trim_start_matches('[')
                        .split([']', ',', ' '])
                        .next()
                        .unwrap_or("");
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

            let src_ip = meta
                .get("sourceIP")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
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
            let suspicious = is_suspicious_location_host(&host);

            let entry = user_summary.entry(uname.clone()).or_default();
            entry.active_conns += 1;
            entry.upload = entry.upload.saturating_add(up);
            entry.download = entry.download.saturating_add(down);
            if !src_ip.is_empty() {
                entry.source_ips.insert(src_ip.clone());
            }
            if suspicious {
                entry.suspicious_hosts.insert(host.clone());
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
                "suspicious": suspicious
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
    for (u, acc) in user_summary {
        summary_obj.insert(
            u,
            json!({
                "activeConnections": acc.active_conns,
                "upload": acc.upload,
                "download": acc.download,
                "sourceIPs": acc.source_ips.into_iter().collect::<Vec<_>>(),
                "suspiciousHosts": acc.suspicious_hosts.into_iter().collect::<Vec<_>>()
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

/// 单次 SSH 直接掐断 NAT 指定或全部连接
pub async fn close_alpine_conn(
    node: &NatNodeConfig,
    fallback_key_path: &str,
    conn_id: &str,
) -> Result<Value, SshError> {
    if conn_id.trim().is_empty() {
        return Err(SshError::new("VALIDATION_ERROR", "缺少连接 ID", None));
    }
    exec_alpine_script(node, fallback_key_path, "close_conn_auto", Some(conn_id.trim())).await?;
    Ok(json!({ "ok": true }))
}
