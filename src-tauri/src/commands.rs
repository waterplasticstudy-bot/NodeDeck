//! NodeDeck Tauri IPC 命令层：三端统一协议增删改、跨节点用户归属矩阵、双模按需流量同步与通用 Mihomo 联动

use crate::accounts::{
    clear_isolated_session, fetch_subscription_snapshot, has_isolated_session,
    open_isolated_window, scrape_window_traffic, tcp_ping, ScrapeOutcome,
};
use crate::alpine_ssh::{
    close_alpine_conn, configure_alpine_audit, fetch_alpine_audit, fetch_alpine_config,
    fetch_alpine_logs, fetch_alpine_overview, fetch_nat_exit_latency, fetch_nat_exit_status,
    mutate_alpine_inbound, restore_alpine_backup, run_alpine_service_action,
    run_nat_exit_diagnostics, switch_nat_exit, InboundMutateInput,
};
use crate::config::{
    build_vless_link, load_config, resolve_key_path, resolve_panel_dir, save_config, AppConfig,
    NatNodeConfig, ProviderAccountConfig,
};
use crate::constants::{
    DEFAULT_MIHOMO_MIXED_PORT, DEFAULT_SNI, INBOUND_TAG_PATTERN, MAIN_WINDOW_LABEL,
    MEMBER_NAME_PATTERN, SSH_DEFAULT_CALL_TIMEOUT_MS, SSH_MUTATE_CALL_TIMEOUT_MS,
};
use crate::mihomo::MihomoClient;
use crate::ssh_client::{launch_ssh_key_wizard, PersistentSshClient, SshError};
use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use tauri::{AppHandle, Manager, State, Theme};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::Mutex;
use uuid::Uuid;

pub struct NetSample {
    pub iface: String,
    pub rx_bytes: u64,
    pub tx_bytes: u64,
    pub timestamp: f64,
}

pub struct AppState {
    pub ssh: PersistentSshClient,
    pub mihomo: MihomoClient,
    pub prev_net: Mutex<Option<NetSample>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            ssh: PersistentSshClient::new(),
            mihomo: MihomoClient::new(),
            prev_net: Mutex::new(None),
        }
    }
}

fn bad_request(msg: impl Into<String>) -> SshError {
    SshError::new("VALIDATION_ERROR", msg, None)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PartialConfigInput {
    pub name: Option<String>,
    pub host: Option<String>,
    pub ssh_port: Option<u16>,
    pub user: Option<String>,
    pub key_path: Option<String>,
    pub reality_public_key: Option<String>,
    #[serde(rename = "monthlyQuotaGB")]
    pub monthly_quota_gb: Option<u64>,
    pub clash_api_port: Option<u16>,
    pub mihomo_api_url: Option<String>,
    pub mihomo_secret: Option<String>,
    pub dialer_proxy: Option<String>,
    pub close_to_tray: Option<bool>,
}

#[tauri::command]
pub fn get_config() -> Value {
    let cfg = load_config();
    let resolved_key = resolve_key_path(&cfg.key_path);
    json!({
        "ok": true,
        "config": cfg,
        "keyExists": resolved_key.exists(),
        "resolvedKeyPath": resolved_key.to_string_lossy(),
        "panelDir": resolve_panel_dir().to_string_lossy()
    })
}

#[tauri::command]
pub async fn save_config_cmd(
    input: PartialConfigInput,
    state: State<'_, AppState>,
) -> Result<Value, SshError> {
    let current = load_config();
    let ssh_changed = input.host.as_ref().is_some_and(|h| h.trim() != current.host)
        || input.ssh_port.is_some_and(|p| p != current.ssh_port)
        || input.user.as_ref().is_some_and(|u| u.trim() != current.user)
        || input
            .key_path
            .as_ref()
            .is_some_and(|k| k.trim() != current.key_path);

    let next = AppConfig {
        name: input
            .name
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.trim().to_string())
            .unwrap_or(current.name),
        host: input
            .host
            .map(|s| s.trim().to_string())
            .unwrap_or(current.host),
        ssh_port: input.ssh_port.filter(|&p| p > 0).unwrap_or(current.ssh_port),
        user: input
            .user
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.trim().to_string())
            .unwrap_or(current.user),
        key_path: input
            .key_path
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.trim().to_string())
            .unwrap_or(current.key_path),
        reality_public_key: input
            .reality_public_key
            .map(|s| s.trim().to_string())
            .unwrap_or(current.reality_public_key),
        monthly_quota_gb: input
            .monthly_quota_gb
            .filter(|&q| q > 0)
            .unwrap_or(current.monthly_quota_gb),
        clash_api_port: input
            .clash_api_port
            .filter(|&p| p > 1024)
            .unwrap_or(current.clash_api_port),
        mihomo_api_url: input
            .mihomo_api_url
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.trim().to_string())
            .unwrap_or(current.mihomo_api_url),
        mihomo_secret: input
            .mihomo_secret
            .map(|s| s.trim().to_string())
            .unwrap_or(current.mihomo_secret),
        dialer_proxy: input
            .dialer_proxy
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.trim().to_string())
            .unwrap_or(current.dialer_proxy),
        close_to_tray: input.close_to_tray.unwrap_or(current.close_to_tray),
        nat_nodes: current.nat_nodes,
        provider_accounts: current.provider_accounts,
    };

    let saved = save_config(&next).map_err(|e| SshError::new("CONFIG_SAVE_ERR", e, None))?;
    if ssh_changed {
        *state.prev_net.lock().await = None;
        state.ssh.reset().await;
    }
    Ok(json!({ "ok": true, "config": saved }))
}

#[tauri::command]
pub fn save_nat_nodes(nodes: Vec<NatNodeConfig>) -> Result<Value, SshError> {
    let mut cfg = load_config();
    cfg.nat_nodes = nodes;
    let saved = save_config(&cfg).map_err(|e| SshError::new("CONFIG_SAVE_ERR", e, None))?;
    Ok(json!({ "ok": true, "natNodes": saved.nat_nodes }))
}

#[tauri::command]
pub fn save_provider_accounts(accounts: Vec<ProviderAccountConfig>) -> Result<Value, SshError> {
    let mut cfg = load_config();
    cfg.provider_accounts = accounts;
    let saved = save_config(&cfg).map_err(|e| SshError::new("CONFIG_SAVE_ERR", e, None))?;
    Ok(json!({ "ok": true, "providerAccounts": saved.provider_accounts }))
}

#[tauri::command]
pub fn launch_ssh_wizard() -> Result<Value, SshError> {
    let msg = launch_ssh_key_wizard()?;
    Ok(json!({ "ok": true, "message": msg }))
}

// ---------- 主 VPS (Ubuntu / Debian systemd) 管理命令 ----------

#[tauri::command]
pub async fn get_overview(
    force_security: bool,
    state: State<'_, AppState>,
) -> Result<Value, SshError> {
    let cfg = load_config();
    let (mut data, elapsed_ms) = state
        .ssh
        .call(
            "overview",
            json!({ "forceSecurity": force_security }),
            SSH_DEFAULT_CALL_TIMEOUT_MS,
        )
        .await?;

    let iface = data["network"]["iface"].as_str().unwrap_or("").to_string();
    let rx_bytes = data["network"]["rxBytes"].as_u64().unwrap_or(0);
    let tx_bytes = data["network"]["txBytes"].as_u64().unwrap_or(0);
    let ts = data["network"]["timestamp"].as_f64().unwrap_or(0.0);

    let (mut rx_bps, mut tx_bps) = (0u64, 0u64);
    let mut prev_guard = state.prev_net.lock().await;
    if let Some(prev) = prev_guard.as_ref() {
        if prev.iface == iface && ts > prev.timestamp {
            let dt = ts - prev.timestamp;
            rx_bps = ((rx_bytes.saturating_sub(prev.rx_bytes)) as f64 / dt).round() as u64;
            tx_bps = ((tx_bytes.saturating_sub(prev.tx_bytes)) as f64 / dt).round() as u64;
        }
    }
    *prev_guard = Some(NetSample {
        iface,
        rx_bytes,
        tx_bytes,
        timestamp: ts,
    });
    drop(prev_guard);

    if let Some(net_obj) = data.get_mut("network").and_then(Value::as_object_mut) {
        net_obj.insert("rxBps".to_string(), json!(rx_bps));
        net_obj.insert("txBps".to_string(), json!(tx_bps));
    }
    if let Some(root) = data.as_object_mut() {
        root.insert("sshLatencyMs".to_string(), json!(elapsed_ms));
        root.insert("monthlyQuotaGB".to_string(), json!(cfg.monthly_quota_gb));
        root.insert("serverName".to_string(), json!(cfg.name));
        root.insert("host".to_string(), json!(cfg.host));
    }
    Ok(json!({ "ok": true, "data": data }))
}

#[tauri::command]
pub async fn get_users(state: State<'_, AppState>) -> Result<Value, SshError> {
    let cfg = load_config();
    let (data, _) = state
        .ssh
        .call("users", json!({}), SSH_DEFAULT_CALL_TIMEOUT_MS)
        .await?;

    let port = data["listenPort"].as_u64().unwrap_or(8443);
    let sni = data["sni"].as_str().unwrap_or(DEFAULT_SNI);
    let short_id = data["shortId"].as_str().unwrap_or("");

    let enrich = |arr: Option<&Vec<Value>>| -> Vec<Value> {
        arr.cloned()
            .unwrap_or_default()
            .into_iter()
            .map(|mut u| {
                let name = u["name"].as_str().unwrap_or("").to_string();
                let uid = u["uuid"].as_str().unwrap_or("").to_string();
                let flow = u["flow"].as_str().unwrap_or("").to_string();
                let link = build_vless_link(&cfg, &name, &uid, &flow, port, sni, short_id);
                if let Some(obj) = u.as_object_mut() {
                    obj.insert("vlessLink".to_string(), json!(link));
                }
                u
            })
            .collect()
    };

    Ok(json!({
        "ok": true,
        "listenPort": port,
        "sni": sni,
        "shortId": short_id,
        "publicKeySet": !cfg.reality_public_key.is_empty(),
        "antiChinaEnabled": data["antiChinaEnabled"].as_bool().unwrap_or(false),
        "activeUsers": enrich(data["activeUsers"].as_array()),
        "disabledUsers": enrich(data["disabledUsers"].as_array())
    }))
}

#[tauri::command]
pub async fn add_user(
    name: String,
    uuid: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, SshError> {
    let trimmed = name.trim();
    let name_re = Regex::new(MEMBER_NAME_PATTERN).expect("valid member regex");
    if !name_re.is_match(trimmed) {
        return Err(bad_request("成员名称仅支持 1-24 位中英文、数字、下划线或短横线"));
    }
    let uid = match uuid.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(raw) => {
            Uuid::parse_str(raw).map_err(|_| bad_request("UUID 格式无效"))?;
            raw.to_string()
        }
        None => Uuid::new_v4().to_string(),
    };

    let (res, _) = state
        .ssh
        .call(
            "mutate",
            json!({ "action": "add_user", "name": trimmed, "uuid": uid }),
            SSH_MUTATE_CALL_TIMEOUT_MS,
        )
        .await?;
    Ok(res)
}

#[tauri::command]
pub async fn edit_vps_user(
    uuid: String,
    name: String,
    new_uuid: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, SshError> {
    let trimmed = name.trim();
    let name_re = Regex::new(MEMBER_NAME_PATTERN).expect("valid member regex");
    if !name_re.is_match(trimmed) {
        return Err(bad_request("成员名称仅支持 1-24 位中英文、数字、下划线或短横线"));
    }
    let validated_new_uid = match new_uuid.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(raw) => {
            Uuid::parse_str(raw).map_err(|_| bad_request("新 UUID 格式无效"))?;
            Some(raw.to_string())
        }
        None => None,
    };
    let (res, _) = state
        .ssh
        .call(
            "mutate",
            json!({
                "action": "edit_user",
                "uuid": uuid,
                "name": trimmed,
                "newUuid": validated_new_uid
            }),
            SSH_MUTATE_CALL_TIMEOUT_MS,
        )
        .await?;
    Ok(res)
}

#[tauri::command]
pub async fn toggle_user(
    uuid: String,
    enable: bool,
    state: State<'_, AppState>,
) -> Result<Value, SshError> {
    let action = if enable { "resume_user" } else { "pause_user" };
    let (res, _) = state
        .ssh
        .call(
            "mutate",
            json!({ "action": action, "uuid": uuid }),
            SSH_MUTATE_CALL_TIMEOUT_MS,
        )
        .await?;
    Ok(res)
}

#[tauri::command]
pub async fn delete_user(uuid: String, state: State<'_, AppState>) -> Result<Value, SshError> {
    let (res, _) = state
        .ssh
        .call(
            "mutate",
            json!({ "action": "delete_user", "uuid": uuid }),
            SSH_MUTATE_CALL_TIMEOUT_MS,
        )
        .await?;
    Ok(res)
}

#[tauri::command]
pub async fn toggle_antichina(
    enable: bool,
    state: State<'_, AppState>,
) -> Result<Value, SshError> {
    let (res, _) = state
        .ssh
        .call(
            "mutate",
            json!({ "action": "toggle_antichina", "enable": enable }),
            SSH_MUTATE_CALL_TIMEOUT_MS,
        )
        .await?;
    Ok(res)
}

#[tauri::command]
pub async fn get_audit(state: State<'_, AppState>) -> Result<Value, SshError> {
    let (data, _) = state
        .ssh
        .call("audit", json!({}), SSH_DEFAULT_CALL_TIMEOUT_MS)
        .await?;
    Ok(json!({ "ok": true, "data": data }))
}

#[tauri::command]
pub async fn configure_audit(
    enable: bool,
    log_level: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, SshError> {
    let cfg = load_config();
    let (res, _) = state
        .ssh
        .call(
            "mutate",
            json!({
                "action": "configure_audit",
                "enable": enable,
                "port": cfg.clash_api_port,
                "logLevel": log_level
            }),
            SSH_MUTATE_CALL_TIMEOUT_MS,
        )
        .await?;
    Ok(res)
}

#[tauri::command]
pub async fn close_vps_conn(id: String, state: State<'_, AppState>) -> Result<Value, SshError> {
    if id.trim().is_empty() {
        return Err(bad_request("缺少连接 ID"));
    }
    let (res, _) = state
        .ssh
        .call("close_conn", json!({ "id": id }), SSH_DEFAULT_CALL_TIMEOUT_MS)
        .await?;
    Ok(res)
}

#[tauri::command]
pub async fn get_logs(lines: u64, state: State<'_, AppState>) -> Result<Value, SshError> {
    let clamped = lines.clamp(20, 400);
    let (res, _) = state
        .ssh
        .call("logs", json!({ "lines": clamped }), SSH_DEFAULT_CALL_TIMEOUT_MS)
        .await?;
    Ok(json!({ "ok": true, "logs": res["logs"] }))
}

#[tauri::command]
pub async fn run_service_action(
    action: String,
    state: State<'_, AppState>,
) -> Result<Value, SshError> {
    let (res, _) = state
        .ssh
        .call(
            "service",
            json!({ "action": action }),
            SSH_MUTATE_CALL_TIMEOUT_MS,
        )
        .await?;
    Ok(json!({ "ok": true, "output": res["output"] }))
}

#[tauri::command]
pub async fn check_vps_ip(state: State<'_, AppState>) -> Result<Value, SshError> {
    let (data, _) = state
        .ssh
        .call("ipcheck", json!({}), SSH_DEFAULT_CALL_TIMEOUT_MS)
        .await?;
    Ok(json!({ "ok": true, "data": data }))
}

#[tauri::command]
pub async fn get_singbox_config(state: State<'_, AppState>) -> Result<Value, SshError> {
    let cfg = load_config();
    let (mut data, _) = state
        .ssh
        .call("sb_config", json!({}), SSH_DEFAULT_CALL_TIMEOUT_MS)
        .await?;
    if let Some(obj) = data.as_object_mut() {
        obj.insert("host".to_string(), json!(cfg.host));
        obj.insert("publicKey".to_string(), json!(cfg.reality_public_key));
    }
    Ok(json!({ "ok": true, "data": data }))
}

#[tauri::command]
pub async fn restore_singbox_backup(
    backup: String,
    state: State<'_, AppState>,
) -> Result<Value, SshError> {
    let (res, _) = state
        .ssh
        .call(
            "sb_inbound",
            json!({ "op": "restore", "backup": backup }),
            SSH_MUTATE_CALL_TIMEOUT_MS,
        )
        .await?;
    Ok(res)
}

// ---------- 三端统一入站协议增删改 & 跨节点用户归属矩阵 ----------

fn find_nat_node(cfg: &AppConfig, node_id: &str) -> Result<NatNodeConfig, SshError> {
    cfg.nat_nodes
        .iter()
        .find(|n| n.id == node_id)
        .cloned()
        .ok_or_else(|| bad_request("未找到指定的 NAT 节点"))
}

#[tauri::command]
pub async fn mutate_node_inbound(
    node_id: String,
    payload: InboundMutateInput,
    state: State<'_, AppState>,
) -> Result<Value, SshError> {
    if node_id == "vps_main" {
        if matches!(payload.op.as_str(), "add" | "edit") {
            if let Some(ref tag) = payload.tag {
                let tag_re = Regex::new(INBOUND_TAG_PATTERN).expect("valid inbound tag regex");
                if !tag_re.is_match(tag.trim()) {
                    return Err(bad_request(
                        "节点标识仅支持 2-32 位英文字母、数字、下划线或短横线",
                    ));
                }
            }
        }
        let (res, _) = state
            .ssh
            .call(
                "sb_inbound",
                json!({
                    "op": payload.op,
                    "origTag": payload.orig_tag,
                    "tag": payload.tag,
                    "proto": payload.proto,
                    "port": payload.port,
                    "sni": payload.sni.unwrap_or_else(|| DEFAULT_SNI.to_string()),
                    "method": payload.method,
                    "username": payload.username,
                    "password": payload.password,
                    "origName": payload.orig_name
                }),
                SSH_MUTATE_CALL_TIMEOUT_MS,
            )
            .await?;
        return Ok(res);
    }

    let mut cfg = load_config();
    let node = find_nat_node(&cfg, &node_id)?;
    let (res, derived_pbk) = mutate_alpine_inbound(&node, &cfg.key_path, &payload).await?;
    if let Some(pbk) = derived_pbk {
        if let Some(target) = cfg.nat_nodes.iter_mut().find(|n| n.id == node_id) {
            target.reality_public_key = pbk;
            let _ = save_config(&cfg);
        }
    }
    Ok(res)
}

#[tauri::command]
pub async fn get_all_nodes_users(state: State<'_, AppState>) -> Result<Value, SshError> {
    let cfg = load_config();
    let mut nodes = Vec::new();

    if !cfg.host.trim().is_empty() {
        let vps_item = match state
            .ssh
            .call("sb_config", json!({}), SSH_DEFAULT_CALL_TIMEOUT_MS)
            .await
        {
            Ok((data, _)) => json!({
                "nodeId": "vps_main",
                "nodeKind": "vps",
                "name": cfg.name,
                "region": "US",
                "host": cfg.host,
                "publicKey": cfg.reality_public_key,
                "ok": true,
                "inbounds": data.get("inbounds").cloned().unwrap_or_else(|| json!([]))
            }),
            Err(err) => json!({
                "nodeId": "vps_main",
                "nodeKind": "vps",
                "name": cfg.name,
                "region": "US",
                "host": cfg.host,
                "ok": false,
                "error": err.error,
                "inbounds": []
            }),
        };
        nodes.push(vps_item);
    }

    let mut nat_handles = Vec::with_capacity(cfg.nat_nodes.len());
    for nat in cfg.nat_nodes.clone() {
        let fallback_key = cfg.key_path.clone();
        nat_handles.push(tokio::spawn(async move {
            if nat.ssh_port == 0 || nat.public_ip.trim().is_empty() {
                return json!({
                    "nodeId": nat.id,
                    "nodeKind": "nat",
                    "name": nat.name,
                    "region": nat.region,
                    "host": nat.public_ip,
                    "publicKey": nat.reality_public_key,
                    "ok": false,
                    "error": "未配置 SSH 映射端口",
                    "inbounds": []
                });
            }
            match fetch_alpine_config(&nat, &fallback_key).await {
                Ok(data) => json!({
                    "nodeId": nat.id,
                    "nodeKind": "nat",
                    "name": nat.name,
                    "region": nat.region,
                    "host": nat.public_ip,
                    "publicKey": nat.reality_public_key,
                    "ok": true,
                    "inbounds": data.get("inbounds").cloned().unwrap_or_else(|| json!([]))
                }),
                Err(err) => json!({
                    "nodeId": nat.id,
                    "nodeKind": "nat",
                    "name": nat.name,
                    "region": nat.region,
                    "host": nat.public_ip,
                    "ok": false,
                    "error": err.error,
                    "inbounds": []
                }),
            }
        }));
    }

    for h in nat_handles {
        if let Ok(item) = h.await {
            nodes.push(item);
        }
    }

    Ok(json!({ "ok": true, "nodes": nodes }))
}

// ---------- Alpine NAT 深度托管、备份、实时审计与宿主机多出口控制命令 ----------

#[tauri::command]
pub async fn get_nat_alpine_overview(node_id: String) -> Result<Value, SshError> {
    let cfg = load_config();
    let node = find_nat_node(&cfg, &node_id)?;
    fetch_alpine_overview(&node, &cfg.key_path).await
}

#[tauri::command]
pub async fn get_nat_alpine_config(node_id: String) -> Result<Value, SshError> {
    let cfg = load_config();
    let node = find_nat_node(&cfg, &node_id)?;
    fetch_alpine_config(&node, &cfg.key_path).await
}

#[tauri::command]
pub async fn get_nat_alpine_logs(node_id: String, lines: u64) -> Result<Value, SshError> {
    let cfg = load_config();
    let node = find_nat_node(&cfg, &node_id)?;
    fetch_alpine_logs(&node, &cfg.key_path, lines).await
}

#[tauri::command]
pub async fn run_nat_alpine_action(node_id: String, action: String) -> Result<Value, SshError> {
    let cfg = load_config();
    let node = find_nat_node(&cfg, &node_id)?;
    run_alpine_service_action(&node, &cfg.key_path, &action).await
}

#[tauri::command]
pub async fn restore_nat_alpine_backup(node_id: String, backup: String) -> Result<Value, SshError> {
    let cfg = load_config();
    let node = find_nat_node(&cfg, &node_id)?;
    restore_alpine_backup(&node, &cfg.key_path, &backup).await
}

#[tauri::command]
pub async fn get_nat_alpine_audit(node_id: String) -> Result<Value, SshError> {
    let cfg = load_config();
    let node = find_nat_node(&cfg, &node_id)?;
    fetch_alpine_audit(&node, &cfg.key_path).await
}

#[tauri::command]
pub async fn configure_nat_alpine_audit(
    node_id: String,
    enable: bool,
) -> Result<Value, SshError> {
    let cfg = load_config();
    let node = find_nat_node(&cfg, &node_id)?;
    configure_alpine_audit(&node, &cfg.key_path, enable).await
}

#[tauri::command]
pub async fn close_nat_alpine_conn(node_id: String, id: String) -> Result<Value, SshError> {
    let cfg = load_config();
    let node = find_nat_node(&cfg, &node_id)?;
    close_alpine_conn(&node, &cfg.key_path, &id).await
}

#[tauri::command]
pub async fn get_nat_exit_status(node_id: String) -> Result<Value, SshError> {
    let mut cfg = load_config();
    let node = find_nat_node(&cfg, &node_id)?;
    let (data, snapshot) = fetch_nat_exit_status(&node, &cfg.key_path).await?;
    if let Some(snap) = snapshot {
        if let Some(target) = cfg.nat_nodes.iter_mut().find(|n| n.id == node_id) {
            target.traffic_snapshot = Some(snap);
            let _ = save_config(&cfg);
        }
    }
    Ok(data)
}

#[tauri::command]
pub async fn get_nat_exit_latency(node_id: String) -> Result<Value, SshError> {
    let cfg = load_config();
    let node = find_nat_node(&cfg, &node_id)?;
    fetch_nat_exit_latency(&node, &cfg.key_path).await
}

#[tauri::command]
pub async fn switch_nat_exit_cmd(node_id: String, exit_code: String) -> Result<Value, SshError> {
    let mut cfg = load_config();
    let node = find_nat_node(&cfg, &node_id)?;
    let (data, snapshot) = switch_nat_exit(&node, &cfg.key_path, &exit_code).await?;
    if let Some(snap) = snapshot {
        if let Some(target) = cfg.nat_nodes.iter_mut().find(|n| n.id == node_id) {
            target.traffic_snapshot = Some(snap);
            let _ = save_config(&cfg);
        }
    }
    Ok(data)
}

#[tauri::command]
pub async fn run_nat_exit_diag(node_id: String) -> Result<Value, SshError> {
    let cfg = load_config();
    let node = find_nat_node(&cfg, &node_id)?;
    run_nat_exit_diagnostics(&node, &cfg.key_path).await
}

// ---------- 多账号独立沙箱窗口、双模按需流量同步与 TCP 测速命令 ----------

#[tauri::command]
pub async fn open_account_window(
    profile_id: String,
    title: String,
    url: String,
    app: AppHandle,
) -> Result<Value, SshError> {
    open_isolated_window(&app, &profile_id, &title, &url).await
}

#[tauri::command]
pub async fn clear_account_session(profile_id: String, app: AppHandle) -> Result<Value, SshError> {
    clear_isolated_session(&app, &profile_id).await
}

#[tauri::command]
pub fn get_account_sessions_status(profile_ids: Vec<String>, app: AppHandle) -> Value {
    let mut map = HashMap::new();
    for pid in profile_ids {
        map.insert(pid.clone(), has_isolated_session(&app, &pid));
    }
    json!({ "ok": true, "sessions": map })
}

#[tauri::command]
pub async fn sync_dashboard_traffic(
    target_kind: String,
    target_id: String,
    app: AppHandle,
) -> Result<Value, SshError> {
    let mut cfg = load_config();
    let (profile_id, title, url) = match target_kind.as_str() {
        "account" => {
            let acc = cfg
                .provider_accounts
                .iter()
                .find(|a| a.id == target_id)
                .ok_or_else(|| bad_request("未找到指定服务商账号"))?;
            (
                acc.profile_id.clone(),
                format!("{} · 独立隔离窗口", acc.name),
                acc.portal_url.clone(),
            )
        }
        "nat" => {
            let nat = find_nat_node(&cfg, &target_id)?;
            (
                nat.provider_profile_id.clone(),
                format!("{} · NAT 控制台", nat.name),
                nat.portal_url.clone(),
            )
        }
        _ => return Err(bad_request("无效的识别目标类型")),
    };

    match scrape_window_traffic(&app, &profile_id, &title, &url).await? {
        ScrapeOutcome::NeedsWindowReady(msg) => Ok(json!({
            "ok": true,
            "needsWindowReady": true,
            "message": msg
        })),
        ScrapeOutcome::Captured(snap) => {
            if target_kind == "account" {
                if let Some(acc) = cfg.provider_accounts.iter_mut().find(|a| a.id == target_id) {
                    if !snap.expires_at.is_empty() && acc.expires_at.is_empty() {
                        acc.expires_at = snap.expires_at.clone();
                    }
                    acc.traffic_snapshot = Some(snap.clone());
                }
            } else if let Some(nat) = cfg.nat_nodes.iter_mut().find(|n| n.id == target_id) {
                if !snap.expires_at.is_empty() && nat.expires_at.is_empty() {
                    nat.expires_at = snap.expires_at.clone();
                }
                nat.traffic_snapshot = Some(snap.clone());
            }
            let saved = save_config(&cfg).map_err(|e| SshError::new("CONFIG_SAVE_ERR", e, None))?;
            Ok(json!({
                "ok": true,
                "needsWindowReady": false,
                "snapshot": snap,
                "config": saved
            }))
        }
    }
}

#[tauri::command]
pub async fn sync_subscription_traffic(
    account_id: String,
    state: State<'_, AppState>,
) -> Result<Value, SshError> {
    let mut cfg = load_config();
    let sub_url = cfg
        .provider_accounts
        .iter()
        .find(|a| a.id == account_id)
        .map(|a| a.subscription_url.trim().to_string())
        .ok_or_else(|| bad_request("未找到指定服务商账号"))?;
    if sub_url.is_empty() {
        return Err(bad_request("该卡片尚未填写订阅链接，请点「编辑」填写或改用「识别流量」"));
    }

    let (snap, via_proxy) = match fetch_subscription_snapshot(&sub_url, None).await {
        Ok(res) => res,
        Err(direct_err) if direct_err.code == "SUB_ERR" => {
            let port = state
                .mihomo
                .detect_mixed_port(&cfg)
                .await
                .unwrap_or(DEFAULT_MIHOMO_MIXED_PORT);
            let proxy_url = format!("http://127.0.0.1:{port}");
            fetch_subscription_snapshot(&sub_url, Some(&proxy_url))
                .await
                .map_err(|_| {
                    SshError::new(
                        "SUB_ERR",
                        format!("直连与本机代理(:{port})均未拉通：{}", direct_err.error),
                        None,
                    )
                })?
        }
        Err(err) => return Err(err),
    };

    if let Some(acc) = cfg.provider_accounts.iter_mut().find(|a| a.id == account_id) {
        if !snap.expires_at.is_empty() && acc.expires_at.is_empty() {
            acc.expires_at = snap.expires_at.clone();
        }
        acc.traffic_snapshot = Some(snap.clone());
    }
    let saved = save_config(&cfg).map_err(|e| SshError::new("CONFIG_SAVE_ERR", e, None))?;
    Ok(json!({
        "ok": true,
        "viaProxy": via_proxy,
        "snapshot": snap,
        "config": saved
    }))
}

#[tauri::command]
pub async fn tcp_ping_host(host: String, port: u16) -> Result<Value, SshError> {
    tcp_ping(&host, port).await
}

// ---------- 本机 Mihomo / Clash API 联动命令 ----------

#[tauri::command]
pub async fn get_mihomo_status(state: State<'_, AppState>) -> Result<Value, SshError> {
    let cfg = load_config();
    Ok(state.mihomo.get_status(&cfg).await)
}

#[tauri::command]
pub async fn probe_connectivity(state: State<'_, AppState>) -> Result<Value, SshError> {
    Ok(state.mihomo.probe_connectivity().await)
}

#[tauri::command]
pub async fn set_mihomo_mode(
    mode: String,
    state: State<'_, AppState>,
) -> Result<Value, SshError> {
    let cfg = load_config();
    state
        .mihomo
        .set_mode(&cfg, &mode)
        .await
        .map_err(|e| SshError::new("MIHOMO_ERR", e, None))
}

#[tauri::command]
pub async fn select_mihomo_node(
    group: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<Value, SshError> {
    let cfg = load_config();
    state
        .mihomo
        .select_node(&cfg, &group, &name)
        .await
        .map_err(|e| SshError::new("MIHOMO_ERR", e, None))
}

#[tauri::command]
pub async fn test_mihomo_delay(
    name: String,
    state: State<'_, AppState>,
) -> Result<Value, SshError> {
    let cfg = load_config();
    state
        .mihomo
        .test_delay(&cfg, &name)
        .await
        .map_err(|e| SshError::new("MIHOMO_ERR", e, None))
}

#[tauri::command]
pub async fn close_mihomo_conn(
    id: String,
    state: State<'_, AppState>,
) -> Result<Value, SshError> {
    let cfg = load_config();
    state
        .mihomo
        .close_connection(&cfg, &id)
        .await
        .map_err(|e| SshError::new("MIHOMO_ERR", e, None))
}

// ---------- 原生桌面体验命令 ----------

#[tauri::command]
pub fn set_window_theme(theme: String, app: AppHandle) -> Result<(), SshError> {
    let win = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| SshError::new("WINDOW_ERR", "主窗口不可用", None))?;
    let target = if theme == "dark" {
        Theme::Dark
    } else {
        Theme::Light
    };
    win.set_theme(Some(target))
        .map_err(|e| SshError::new("THEME_ERR", format!("同步标题栏主题失败: {e}"), None))
}

#[tauri::command]
pub fn open_external_url(url: String, app: AppHandle) -> Result<(), SshError> {
    let trimmed = url.trim();
    if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
        return Err(bad_request("仅允许打开 http:// 或 https:// 外部链接"));
    }
    app.opener()
        .open_url(trimmed, None::<&str>)
        .map_err(|e| SshError::new("OPENER_ERR", format!("打开系统浏览器失败: {e}"), None))
}
