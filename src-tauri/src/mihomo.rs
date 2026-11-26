//! 本机代理内核 (Mihomo / Clash Meta API) 通用客户端与外网 AI 真实连通性并发探针
//! 兼容 Clash Verge Rev / FlClash / Bettbox / Mihomo 等全部 Clash API 桌面内核

use crate::config::AppConfig;
use crate::constants::{
    CONNECTIVITY_PROBES, MAX_MIHOMO_CONNECTIONS, MIHOMO_DELAY_TEST_URL, MIHOMO_DELAY_TIMEOUT_MS,
    MIHOMO_GROUP_TYPES, MIHOMO_PRIORITY_GROUPS, MIHOMO_TIMEOUT_MS, PROBE_TIMEOUT_MS,
    PROBE_USER_AGENT,
};
use reqwest::{Client, Method, StatusCode};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::{Duration, Instant};
use url::Url;

fn resolve_group_leaf(raw_proxies: &serde_json::Map<String, Value>, start: &str) -> String {
    let mut current = start.to_string();
    let mut visited = HashSet::new();
    for _ in 0..8 {
        if current.is_empty() || !visited.insert(current.clone()) {
            break;
        }
        let next = raw_proxies
            .get(&current)
            .and_then(|v| v.get("now"))
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty());
        match next {
            Some(n) => current = n.to_string(),
            None => break,
        }
    }
    current
}

fn format_hop_display(raw_proxies: &serde_json::Map<String, Value>, direct_now: &str) -> String {
    if direct_now.is_empty() {
        return "--".to_string();
    }
    let leaf = resolve_group_leaf(raw_proxies, direct_now);
    if !leaf.is_empty() && leaf != direct_now {
        format!("{direct_now} → {leaf}")
    } else {
        direct_now.to_string()
    }
}

fn detect_chained_topology(
    raw_proxies: &serde_json::Map<String, Value>,
) -> (Option<String>, Option<String>) {
    let mut chained_nodes: HashMap<String, String> = HashMap::new();
    for (name, proxy) in raw_proxies {
        let ptype = proxy.get("type").and_then(Value::as_str).unwrap_or("");
        if MIHOMO_GROUP_TYPES.contains(&ptype) {
            continue;
        }
        let dialer = proxy
            .get("dialer-proxy")
            .or_else(|| proxy.get("dialerProxy"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty());
        if let Some(d) = dialer {
            chained_nodes.insert(name.clone(), d.to_string());
        }
    }
    if chained_nodes.is_empty() {
        return (None, None);
    }

    // 优先选取当前已选中链式节点且成员最聚焦（all 最少）的非 GLOBAL Selector 作为落地组
    let mut best_active: Option<(usize, String, String)> = None;
    let mut best_candidate: Option<(usize, String, String)> = None;

    for (gname, proxy) in raw_proxies {
        if gname == "GLOBAL" {
            continue;
        }
        let ptype = proxy.get("type").and_then(Value::as_str).unwrap_or("");
        if ptype != "Selector" {
            continue;
        }
        let Some(all) = proxy.get("all").and_then(Value::as_array) else {
            continue;
        };
        let now = proxy.get("now").and_then(Value::as_str).unwrap_or("");
        if let Some(dialer) = chained_nodes.get(now) {
            let score = all.len();
            if best_active.as_ref().is_none_or(|(s, _, _)| score < *s) {
                best_active = Some((score, gname.clone(), dialer.clone()));
            }
        }
        for item in all.iter().filter_map(Value::as_str) {
            if let Some(dialer) = chained_nodes.get(item) {
                let score = all.len();
                if best_candidate.as_ref().is_none_or(|(s, _, _)| score < *s) {
                    best_candidate = Some((score, gname.clone(), dialer.clone()));
                }
                break;
            }
        }
    }

    if let Some((_, exit_grp, front_grp)) = best_active.or(best_candidate) {
        let valid_front = raw_proxies.contains_key(&front_grp).then_some(front_grp);
        return (valid_front, Some(exit_grp));
    }

    let first_front = chained_nodes
        .values()
        .find(|d| raw_proxies.contains_key(*d))
        .cloned();
    (first_front, None)
}

pub struct MihomoClient {
    /// 强制禁用系统代理，防止 127.0.0.1:9090 被代理端口回环拦截
    local_http: Client,
    /// 使用系统/TUN 代理通道执行真实外网连通性探测
    probe_http: Client,
}

impl MihomoClient {
    pub fn new() -> Self {
        let local_http = Client::builder()
            .no_proxy()
            .build()
            .expect("build local mihomo http client");
        let probe_http = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .user_agent(PROBE_USER_AGENT)
            .build()
            .expect("build probe http client");
        Self {
            local_http,
            probe_http,
        }
    }

    fn validate_base(cfg: &AppConfig) -> Result<String, String> {
        let raw = cfg.mihomo_api_url.trim().trim_end_matches('/');
        let parsed = Url::parse(raw).map_err(|_| "外部控制地址格式无效".to_string())?;
        let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
        if host != "127.0.0.1" && host != "localhost" {
            return Err("为保证安全，外部控制地址仅允许本机 127.0.0.1 / localhost".to_string());
        }
        Ok(raw.to_string())
    }

    async fn request(
        &self,
        cfg: &AppConfig,
        method: Method,
        api_path: &str,
        body: Option<Value>,
        timeout_ms: u64,
    ) -> Result<Value, (Option<StatusCode>, String)> {
        let base = Self::validate_base(cfg).map_err(|e| (None, e))?;
        let url = format!("{base}{api_path}");
        let mut req = self
            .local_http
            .request(method, &url)
            .timeout(Duration::from_millis(timeout_ms));

        if !cfg.mihomo_secret.trim().is_empty() {
            req = req.header("Authorization", format!("Bearer {}", cfg.mihomo_secret.trim()));
        }
        if let Some(payload) = body {
            req = req.json(&payload);
        }

        let resp = req
            .send()
            .await
            .map_err(|e| (None, format!("请求本地代理 API 失败: {e}")))?;
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        let parsed: Value = if text.trim().is_empty() {
            json!({})
        } else {
            serde_json::from_str(&text).unwrap_or_else(|_| json!({ "raw": text }))
        };
        if !status.is_success() {
            let msg = parsed
                .get("message")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| format!("Clash API HTTP {}", status.as_u16()));
            return Err((Some(status), msg));
        }
        Ok(parsed)
    }

    pub async fn get_status(&self, cfg: &AppConfig) -> Value {
        let api_url = cfg.mihomo_api_url.clone();
        let fetched = tokio::try_join!(
            self.request(cfg, Method::GET, "/version", None, MIHOMO_TIMEOUT_MS),
            self.request(cfg, Method::GET, "/configs", None, MIHOMO_TIMEOUT_MS),
            self.request(cfg, Method::GET, "/proxies", None, MIHOMO_TIMEOUT_MS),
            self.request(cfg, Method::GET, "/connections", None, MIHOMO_TIMEOUT_MS),
        );

        let (ver, conf, proxies_resp, conns_resp) = match fetched {
            Ok(tuple) => tuple,
            Err((status, _)) => {
                let err_msg = if status == Some(StatusCode::UNAUTHORIZED) {
                    "控制密钥 (Secret) 不匹配，请在设置或下方输入本机代理内核的 Secret"
                } else {
                    "未检测到本机 Mihomo / Clash 外部控制端口（默认 127.0.0.1:9090 未开启）"
                };
                return json!({
                    "ok": true,
                    "connected": false,
                    "apiUrl": api_url,
                    "error": err_msg
                });
            }
        };

        let raw_proxies = proxies_resp
            .get("proxies")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();

        let mut groups: Vec<Value> = raw_proxies
            .iter()
            .filter_map(|(name, proxy)| {
                let ptype = proxy.get("type").and_then(Value::as_str)?;
                if !MIHOMO_GROUP_TYPES.contains(&ptype) {
                    return None;
                }
                let all = proxy.get("all").and_then(Value::as_array)?;
                let nodes: Vec<Value> = all
                    .iter()
                    .filter_map(Value::as_str)
                    .map(|node_name| {
                        let np = raw_proxies.get(node_name);
                        let ntype = np
                            .and_then(|v| v.get("type"))
                            .and_then(Value::as_str)
                            .unwrap_or("");
                        let delay = np
                            .and_then(|v| v.get("history"))
                            .and_then(Value::as_array)
                            .and_then(|hist| hist.last())
                            .and_then(|entry| entry.get("delay"))
                            .and_then(Value::as_u64)
                            .filter(|&d| d > 0);
                        json!({ "name": node_name, "type": ntype, "delay": delay })
                    })
                    .collect();
                Some(json!({
                    "name": name,
                    "type": ptype,
                    "now": proxy.get("now").and_then(Value::as_str).unwrap_or(""),
                    "nodes": nodes
                }))
            })
            .collect();

        let (detected_front, detected_exit) = detect_chained_topology(&raw_proxies);

        let group_rank = |name: &str| -> (u8, usize) {
            if detected_front.as_deref() == Some(name) {
                return (0, 0);
            }
            if detected_exit.as_deref() == Some(name) {
                return (1, 0);
            }
            if name == "GLOBAL" {
                return (5, 0);
            }
            if let Some(pos) = MIHOMO_PRIORITY_GROUPS
                .iter()
                .filter(|&&x| x != "GLOBAL")
                .position(|&x| x == name)
            {
                return (2, pos);
            }
            let lower = name.to_ascii_lowercase();
            if lower.contains("ai")
                || lower.contains("运维")
                || lower.contains("ops")
                || lower.contains("落地")
                || lower.contains("exit")
                || lower.contains("漏网")
                || lower.contains("兜底")
                || lower.contains("fallback")
                || lower.contains("节点选择")
            {
                return (3, 0);
            }
            (4, 0)
        };

        groups.sort_by(|a, b| {
            let na = a.get("name").and_then(Value::as_str).unwrap_or("");
            let nb = b.get("name").and_then(Value::as_str).unwrap_or("");
            (group_rank(na), na).cmp(&(group_rank(nb), nb))
        });

        let mut conns: Vec<Value> = conns_resp
            .get("connections")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .map(|c| {
                let meta = c.get("metadata").cloned().unwrap_or(Value::Null);
                let proc_name = meta
                    .get("process")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
                    .or_else(|| {
                        meta.get("processPath")
                            .and_then(Value::as_str)
                            .and_then(|p| Path::new(p).file_name())
                            .map(|f| f.to_string_lossy().to_string())
                    })
                    .unwrap_or_default();
                let host = meta
                    .get("host")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                    .or_else(|| meta.get("destinationIP").and_then(Value::as_str))
                    .unwrap_or("");
                let dport = meta
                    .get("destinationPort")
                    .map(|v| match v {
                        Value::String(s) => s.clone(),
                        Value::Number(n) => n.to_string(),
                        _ => String::new(),
                    })
                    .unwrap_or_default();
                json!({
                    "id": c.get("id").and_then(Value::as_str).unwrap_or(""),
                    "host": host,
                    "port": dport,
                    "network": meta.get("network").and_then(Value::as_str).unwrap_or(""),
                    "process": proc_name,
                    "rule": c.get("rule").and_then(Value::as_str).unwrap_or(""),
                    "rulePayload": c.get("rulePayload").and_then(Value::as_str).unwrap_or(""),
                    "chains": c.get("chains").and_then(Value::as_array).cloned().unwrap_or_default(),
                    "upload": c.get("upload").and_then(Value::as_u64).unwrap_or(0),
                    "download": c.get("download").and_then(Value::as_u64).unwrap_or(0),
                    "start": c.get("start").and_then(Value::as_str).unwrap_or("")
                })
            })
            .collect();

        conns.sort_by(|a, b| {
            let ta = a["upload"].as_u64().unwrap_or(0) + a["download"].as_u64().unwrap_or(0);
            let tb = b["upload"].as_u64().unwrap_or(0) + b["download"].as_u64().unwrap_or(0);
            tb.cmp(&ta)
        });
        let total_conns = conns.len();
        conns.truncate(MAX_MIHOMO_CONNECTIONS);

        let primary_group = detected_front
            .as_deref()
            .and_then(|target| groups.iter().find(|g| g["name"].as_str() == Some(target)))
            .or_else(|| groups.iter().find(|g| g["name"].as_str() != Some("GLOBAL")));
        let primary_name_str = primary_group.and_then(|g| g["name"].as_str());
        let secondary_group = detected_exit
            .as_deref()
            .and_then(|target| groups.iter().find(|g| g["name"].as_str() == Some(target)))
            .or_else(|| {
                groups
                    .iter()
                    .find(|g| g["name"].as_str() != Some("GLOBAL") && g["name"].as_str() != primary_name_str)
            });
        let fallback_group = groups
            .iter()
            .find(|g| {
                let n = g["name"].as_str().unwrap_or("").to_ascii_lowercase();
                n.contains("fallback") || n.contains("兜底") || n.contains("漏网")
            })
            .or_else(|| groups.iter().find(|g| g["name"].as_str() == Some("GLOBAL")));

        let primary_now_raw = primary_group.and_then(|g| g["now"].as_str()).unwrap_or("");
        let secondary_now_raw = secondary_group.and_then(|g| g["now"].as_str()).unwrap_or("");
        let fallback_now_raw = fallback_group.and_then(|g| g["now"].as_str()).unwrap_or("");
        let chain_detected = detected_front.is_some() && detected_exit.is_some();

        let mode = conf.get("mode").and_then(Value::as_str).unwrap_or("rule");

        json!({
            "ok": true,
            "connected": true,
            "apiUrl": api_url,
            "hasSecret": !cfg.mihomo_secret.trim().is_empty(),
            "version": ver.get("version").and_then(Value::as_str).unwrap_or("Mihomo"),
            "mode": mode,
            "allowLan": conf.get("allow-lan").and_then(Value::as_bool).unwrap_or(false),
            "tunEnabled": conf.get("tun").and_then(|t| t.get("enable")).and_then(Value::as_bool).unwrap_or(false),
            "mixedPort": conf.get("mixed-port").or_else(|| conf.get("port")).and_then(Value::as_u64).unwrap_or(7890),
            "uploadTotal": conns_resp.get("uploadTotal").and_then(Value::as_u64).unwrap_or(0),
            "downloadTotal": conns_resp.get("downloadTotal").and_then(Value::as_u64).unwrap_or(0),
            "memoryBytes": conns_resp.get("memory").and_then(Value::as_u64).unwrap_or(0),
            "totalConnections": total_conns,
            "chainSummary": {
                "mode": mode,
                "chainDetected": chain_detected,
                "primaryName": primary_name_str.unwrap_or("主力策略组"),
                "primaryNow": format_hop_display(&raw_proxies, primary_now_raw),
                "secondaryName": secondary_group.and_then(|g| g["name"].as_str()).unwrap_or("次级策略组"),
                "secondaryNow": format_hop_display(&raw_proxies, secondary_now_raw),
                "fallbackName": fallback_group.and_then(|g| g["name"].as_str()).unwrap_or("兜底分流"),
                "fallback": format_hop_display(&raw_proxies, fallback_now_raw)
            },
            "groups": groups,
            "connections": conns
        })
    }

    pub async fn set_mode(&self, cfg: &AppConfig, mode: &str) -> Result<Value, String> {
        let lower = mode.trim().to_ascii_lowercase();
        if !matches!(lower.as_str(), "rule" | "global" | "direct") {
            return Err("无效的出站模式".to_string());
        }
        self.request(
            cfg,
            Method::PATCH,
            "/configs",
            Some(json!({ "mode": lower })),
            MIHOMO_TIMEOUT_MS,
        )
        .await
        .map_err(|(_, msg)| msg)?;
        Ok(json!({ "ok": true, "mode": lower }))
    }

    pub async fn select_node(
        &self,
        cfg: &AppConfig,
        group: &str,
        name: &str,
    ) -> Result<Value, String> {
        if group.is_empty() || name.is_empty() {
            return Err("缺少策略组或节点名称".to_string());
        }
        let encoded_group: String =
            url::form_urlencoded::byte_serialize(group.as_bytes()).collect();
        self.request(
            cfg,
            Method::PUT,
            &format!("/proxies/{encoded_group}"),
            Some(json!({ "name": name })),
            MIHOMO_TIMEOUT_MS,
        )
        .await
        .map_err(|(_, msg)| msg)?;
        Ok(json!({ "ok": true, "group": group, "name": name }))
    }

    pub async fn test_delay(&self, cfg: &AppConfig, name: &str) -> Result<Value, String> {
        if name.is_empty() {
            return Err("缺少节点名称".to_string());
        }
        let encoded_name: String = url::form_urlencoded::byte_serialize(name.as_bytes()).collect();
        let encoded_url: String =
            url::form_urlencoded::byte_serialize(MIHOMO_DELAY_TEST_URL.as_bytes()).collect();
        let res = self
            .request(
                cfg,
                Method::GET,
                &format!("/proxies/{encoded_name}/delay?timeout=5000&url={encoded_url}"),
                None,
                MIHOMO_DELAY_TIMEOUT_MS,
            )
            .await
            .map_err(|(_, msg)| msg)?;
        Ok(json!({ "ok": true, "name": name, "delay": res.get("delay").cloned().unwrap_or(Value::Null) }))
    }

    pub async fn close_connection(&self, cfg: &AppConfig, id: &str) -> Result<Value, String> {
        let ep = if id == "__ALL__" {
            "/connections".to_string()
        } else {
            let enc: String = url::form_urlencoded::byte_serialize(id.as_bytes()).collect();
            format!("/connections/{enc}")
        };
        self.request(cfg, Method::DELETE, &ep, None, MIHOMO_TIMEOUT_MS)
            .await
            .map_err(|(_, msg)| msg)?;
        Ok(json!({ "ok": true }))
    }

    pub async fn detect_mixed_port(&self, cfg: &AppConfig) -> Option<u16> {
        let conf = self
            .request(cfg, Method::GET, "/configs", None, MIHOMO_TIMEOUT_MS)
            .await
            .ok()?;
        let port = conf
            .get("mixed-port")
            .or_else(|| conf.get("port"))
            .and_then(Value::as_u64)
            .filter(|&p| p > 0 && p <= u16::MAX as u64)?;
        Some(port as u16)
    }

    pub async fn probe_connectivity(&self) -> Value {
        let mut handles = Vec::with_capacity(CONNECTIVITY_PROBES.len());
        for &(id, name, target_url) in CONNECTIVITY_PROBES {
            let client = self.probe_http.clone();
            handles.push(tokio::spawn(async move {
                let started = Instant::now();
                let res = client
                    .get(target_url)
                    .timeout(Duration::from_millis(PROBE_TIMEOUT_MS))
                    .send()
                    .await;
                let ms = started.elapsed().as_millis() as u64;
                match res {
                    Ok(resp) => json!({
                        "id": id,
                        "name": name,
                        "url": target_url,
                        "ok": true,
                        "status": resp.status().as_u16(),
                        "ms": ms
                    }),
                    Err(err) => json!({
                        "id": id,
                        "name": name,
                        "url": target_url,
                        "ok": false,
                        "status": 0,
                        "ms": ms,
                        "error": if err.is_timeout() { "超时" } else { "不可达" }
                    }),
                }
            }));
        }

        let mut results = Vec::with_capacity(handles.len());
        for handle in handles {
            if let Ok(item) = handle.await {
                results.push(item);
            }
        }
        json!({ "ok": true, "results": results })
    }
}
