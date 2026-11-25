//! 本机配置读写、多节点 NAT 档案、多账号与订阅台账（零个人预设，全手动引入）

use crate::constants::{
    CONFIG_FILE_NAME, DEFAULT_CLASH_API_PORT, DEFAULT_HOST, DEFAULT_KEY_PATH,
    DEFAULT_MIHOMO_API_URL, DEFAULT_MONTHLY_QUOTA_GB, DEFAULT_NAT_SINGBOX_CONFIG,
    DEFAULT_SERVER_NAME, DEFAULT_SNI, DEFAULT_SSH_PORT, DEFAULT_SSH_USER, DEFAULT_VLESS_FLOW,
    DEFAULT_VLESS_FP, WIN_OPENSSH_BIN, WIN_OPENSSH_KEYGEN_BIN,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use url::form_urlencoded;

/// 仪表盘识别、宿主机原生计费或单次订阅头同步的本地持久化流量快照
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TrafficSnapshot {
    pub used_bytes: u64,
    pub total_bytes: u64,
    pub used_text: String,
    pub total_text: String,
    pub percent: f64,
    pub cycle_text: String,
    pub expires_at: String,
    pub synced_at: String,
    pub source: String,
}

/// 轻量 LXC / Alpine NAT 实例配置（同时服务节点控制面板与续费台账）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct NatNodeConfig {
    pub id: String,
    pub name: String,
    pub region: String,
    pub plan: String,
    pub provider_profile_id: String,
    pub portal_url: String,
    pub public_ip: String,
    pub service_port: u16,
    #[serde(rename = "monthlyQuotaGB")]
    pub monthly_quota_gb: u64,
    pub billing_cycle: String,
    pub price_cny: f64,
    pub expires_at: String,
    pub auto_renew: bool,
    pub share_link: String,
    pub ssh_port: u16,
    pub ssh_user: String,
    pub ssh_key_path: String,
    pub singbox_config_path: String,
    pub reality_public_key: String,
    pub traffic_snapshot: Option<TrafficSnapshot>,
    pub notes: String,
}

impl Default for NatNodeConfig {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            region: "JP".to_string(),
            plan: String::new(),
            provider_profile_id: "provider_1".to_string(),
            portal_url: String::new(),
            public_ip: String::new(),
            service_port: 0,
            monthly_quota_gb: 100,
            billing_cycle: "monthly".to_string(),
            price_cny: 0.0,
            expires_at: String::new(),
            auto_renew: false,
            share_link: String::new(),
            ssh_port: 0,
            ssh_user: DEFAULT_SSH_USER.to_string(),
            ssh_key_path: String::new(),
            singbox_config_path: DEFAULT_NAT_SINGBOX_CONFIG.to_string(),
            reality_public_key: String::new(),
            traffic_snapshot: None,
            notes: String::new(),
        }
    }
}

/// 服务商 / 订阅多账号卡片配置（绝不存密码；支持仪表盘识别 + 可选单次订阅头查询）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProviderAccountConfig {
    pub id: String,
    pub profile_id: String,
    pub name: String,
    pub category: String,
    pub accent_color: String,
    pub account_label: String,
    pub portal_url: String,
    pub renew_url: String,
    pub subscription_url: String,
    pub plan_name: String,
    pub billing_cycle: String,
    pub price_cny: f64,
    pub expires_at: String,
    pub auto_renew: bool,
    pub traffic_snapshot: Option<TrafficSnapshot>,
    pub notes: String,
}

impl Default for ProviderAccountConfig {
    fn default() -> Self {
        Self {
            id: String::new(),
            profile_id: String::new(),
            name: String::new(),
            category: "airport".to_string(),
            accent_color: "blue".to_string(),
            account_label: String::new(),
            portal_url: String::new(),
            renew_url: String::new(),
            subscription_url: String::new(),
            plan_name: String::new(),
            billing_cycle: "monthly".to_string(),
            price_cny: 0.0,
            expires_at: String::new(),
            auto_renew: false,
            traffic_snapshot: None,
            notes: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppConfig {
    pub name: String,
    pub host: String,
    pub ssh_port: u16,
    pub user: String,
    pub key_path: String,
    pub reality_public_key: String,
    #[serde(rename = "monthlyQuotaGB")]
    pub monthly_quota_gb: u64,
    pub clash_api_port: u16,
    #[serde(alias = "bettboxApiUrl")]
    pub mihomo_api_url: String,
    #[serde(alias = "bettboxSecret")]
    pub mihomo_secret: String,
    pub close_to_tray: bool,
    #[serde(default)]
    pub nat_nodes: Vec<NatNodeConfig>,
    #[serde(default)]
    pub provider_accounts: Vec<ProviderAccountConfig>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            name: DEFAULT_SERVER_NAME.to_string(),
            host: DEFAULT_HOST.to_string(),
            ssh_port: DEFAULT_SSH_PORT,
            user: DEFAULT_SSH_USER.to_string(),
            key_path: DEFAULT_KEY_PATH.to_string(),
            reality_public_key: String::new(),
            monthly_quota_gb: DEFAULT_MONTHLY_QUOTA_GB,
            clash_api_port: DEFAULT_CLASH_API_PORT,
            mihomo_api_url: DEFAULT_MIHOMO_API_URL.to_string(),
            mihomo_secret: String::new(),
            close_to_tray: true,
            nat_nodes: Vec::new(),
            provider_accounts: Vec::new(),
        }
    }
}

/// 定位配置文件目录：优先可执行文件同目录，开发期向上回溯
pub fn resolve_panel_dir() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            if dir.join(CONFIG_FILE_NAME).exists() {
                return dir.to_path_buf();
            }
            for ancestor in dir.ancestors().skip(1).take(4) {
                if ancestor.join(CONFIG_FILE_NAME).exists() {
                    return ancestor.to_path_buf();
                }
            }
            return dir.to_path_buf();
        }
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

pub fn config_file_path() -> PathBuf {
    resolve_panel_dir().join(CONFIG_FILE_NAME)
}

pub fn load_config() -> AppConfig {
    let path = config_file_path();
    match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str::<AppConfig>(&raw).unwrap_or_default(),
        Err(_) => AppConfig::default(),
    }
}

pub fn save_config(next: &AppConfig) -> Result<AppConfig, String> {
    let path = config_file_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {e}"))?;
    }
    let body = serde_json::to_string_pretty(next)
        .map_err(|e| format!("序列化配置失败: {e}"))?
        + "\n";
    fs::write(&path, body).map_err(|e| format!("写入配置文件失败: {e}"))?;
    Ok(next.clone())
}

/// 解析含 %USERPROFILE% 或 ~ 前缀的私钥路径
pub fn resolve_key_path(raw: &str) -> PathBuf {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return PathBuf::new();
    }
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_default();

    let mut expanded = trimmed.to_string();
    if !home.is_empty() {
        let lower = expanded.to_ascii_lowercase();
        if let Some(pos) = lower.find("%userprofile%") {
            expanded.replace_range(pos..pos + "%userprofile%".len(), &home);
        } else if expanded == "~" {
            expanded = home.clone();
        } else if expanded.starts_with("~/") || expanded.starts_with("~\\") {
            expanded = format!("{home}{}", &expanded[1..]);
        }
    }
    PathBuf::from(expanded)
}

pub fn get_ssh_bin() -> String {
    if Path::new(WIN_OPENSSH_BIN).exists() {
        WIN_OPENSSH_BIN.to_string()
    } else {
        "ssh".to_string()
    }
}

pub fn get_ssh_keygen_bin() -> String {
    if Path::new(WIN_OPENSSH_KEYGEN_BIN).exists() {
        WIN_OPENSSH_KEYGEN_BIN.to_string()
    } else {
        "ssh-keygen".to_string()
    }
}

/// 拼接标准 VLESS + Reality 分享链接
pub fn build_vless_link(
    cfg: &AppConfig,
    name: &str,
    uuid: &str,
    flow: &str,
    port: u64,
    sni: &str,
    short_id: &str,
) -> String {
    let effective_flow = if flow.is_empty() { DEFAULT_VLESS_FLOW } else { flow };
    let effective_sni = if sni.is_empty() { DEFAULT_SNI } else { sni };
    let query: String = form_urlencoded::Serializer::new(String::new())
        .append_pair("encryption", "none")
        .append_pair("flow", effective_flow)
        .append_pair("security", "reality")
        .append_pair("sni", effective_sni)
        .append_pair("fp", DEFAULT_VLESS_FP)
        .append_pair("pbk", &cfg.reality_public_key)
        .append_pair("sid", short_id)
        .append_pair("type", "tcp")
        .finish();
    let label_raw = format!(
        "{}-{}",
        if cfg.name.trim().is_empty() { "VPS" } else { cfg.name.trim() },
        if name.is_empty() { "user" } else { name }
    );
    let tag: String = url::form_urlencoded::byte_serialize(label_raw.as_bytes()).collect();
    format!("vless://{uuid}@{}:{port}?{query}#{tag}", cfg.host)
}
