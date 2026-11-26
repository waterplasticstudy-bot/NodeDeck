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
use std::fmt::Write as _;
use std::path::Path;
use std::time::{Duration, Instant};
use url::Url;

/// 校验并归一化自定义测速地址与超时时间（兼容 Zashboard DIY 测速设置）
fn resolve_delay_params(
    test_url: Option<&str>,
    timeout_ms: Option<u64>,
) -> Result<(String, u64), String> {
    let url_str = match test_url.map(str::trim).filter(|s| !s.is_empty()) {
        Some(custom) => {
            if custom.len() > 240 {
                return Err("测速地址长度不能超过 240 字符".to_string());
            }
            let parsed = Url::parse(custom).map_err(|_| "自定义测速地址格式无效".to_string())?;
            if !matches!(parsed.scheme(), "http" | "https") {
                return Err("测速地址仅支持 http:// 或 https://".to_string());
            }
            custom.to_string()
        }
        None => MIHOMO_DELAY_TEST_URL.to_string(),
    };
    let timeout = timeout_ms.unwrap_or(5_000).clamp(1_000, 15_000);
    Ok((url_str, timeout))
}

/// RFC 3986 路径段百分号编码（空格严格编码为 %20，绝不使用 form_urlencoded 的 '+'）
fn encode_path_segment(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len() * 2);
    for &b in raw.as_bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            out.push(b as char);
        } else {
            let _ = write!(out, "%{b:02X}");
        }
    }
    out
}

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
        let (fetched, providers_res) = tokio::join!(
            async {
                tokio::try_join!(
                    self.request(cfg, Method::GET, "/version", None, MIHOMO_TIMEOUT_MS),
                    self.request(cfg, Method::GET, "/configs", None, MIHOMO_TIMEOUT_MS),
                    self.request(cfg, Method::GET, "/proxies", None, MIHOMO_TIMEOUT_MS),
                    self.request(cfg, Method::GET, "/connections", None, MIHOMO_TIMEOUT_MS),
                )
            },
            self.request(cfg, Method::GET, "/providers/proxies", None, MIHOMO_TIMEOUT_MS),
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

        let mut raw_proxies = proxies_resp
            .get("proxies")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();

        // 合并 /providers/proxies 中的远程节点元数据（支持识别 proxy-providers + override.dialer-proxy 链式拓扑）
        if let Ok(providers_resp) = providers_res {
            if let Some(providers_map) = providers_resp.get("providers").and_then(Value::as_object) {
                for provider in providers_map.values() {
                    let vtype = provider.get("vehicleType").and_then(Value::as_str).unwrap_or("");
                    if vtype == "Compatible" {
                        continue;
                    }
                    if let Some(plist) = provider.get("proxies").and_then(Value::as_array) {
                        for item in plist {
                            let Some(pname) = item.get("name").and_then(Value::as_str) else {
                                continue;
                            };
                            if pname.is_empty() {
                                continue;
                            }
                            if let Some(existing) = raw_proxies.get_mut(pname).and_then(Value::as_object_mut) {
                                if !existing.contains_key("dialer-proxy") && !existing.contains_key("dialerProxy") {
                                    if let Some(dp) = item.get("dialer-proxy").or_else(|| item.get("dialerProxy")) {
                                        existing.insert("dialer-proxy".to_string(), dp.clone());
                                    }
                                }
                            } else {
                                raw_proxies.insert(pname.to_string(), item.clone());
                            }
                        }
                    }
                }
            }
        }

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
        let encoded_group = encode_path_segment(group);
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

    pub async fn test_delay(
        &self,
        cfg: &AppConfig,
        name: &str,
        test_url: Option<&str>,
        timeout_ms: Option<u64>,
    ) -> Result<Value, String> {
        if name.is_empty() {
            return Err("缺少节点名称".to_string());
        }
        let (target_url, timeout) = resolve_delay_params(test_url, timeout_ms)?;
        let encoded_name = encode_path_segment(name);
        let encoded_url: String =
            url::form_urlencoded::byte_serialize(target_url.as_bytes()).collect();
        let http_timeout = timeout.max(MIHOMO_DELAY_TIMEOUT_MS) + 2_000;
        let res = self
            .request(
                cfg,
                Method::GET,
                &format!("/proxies/{encoded_name}/delay?timeout={timeout}&url={encoded_url}"),
                None,
                http_timeout,
            )
            .await
            .map_err(|(_, msg)| msg)?;
        Ok(json!({ "ok": true, "name": name, "delay": res.get("delay").cloned().unwrap_or(Value::Null) }))
    }

    /// 并发测速整个策略组下所有节点（调用 Mihomo 原生 /group/{name}/delay 端点，支持自定义测速 URL 与超时）
    pub async fn test_group_delays(
        &self,
        cfg: &AppConfig,
        group: &str,
        test_url: Option<&str>,
        timeout_ms: Option<u64>,
    ) -> Result<Value, String> {
        if group.is_empty() {
            return Err("缺少策略组名称".to_string());
        }
        let (target_url, timeout) = resolve_delay_params(test_url, timeout_ms)?;
        let encoded_group = encode_path_segment(group);
        let encoded_url: String =
            url::form_urlencoded::byte_serialize(target_url.as_bytes()).collect();
        let http_timeout = timeout.max(MIHOMO_DELAY_TIMEOUT_MS) + 4_000;
        let res = self
            .request(
                cfg,
                Method::GET,
                &format!("/group/{encoded_group}/delay?timeout={timeout}&url={encoded_url}"),
                None,
                http_timeout,
            )
            .await
            .map_err(|(_, msg)| msg)?;
        let count = res.as_object().map(serde_json::Map::len).unwrap_or(0);
        Ok(json!({ "ok": true, "group": group, "testedCount": count, "delays": res }))
    }

    /// 只读获取当前 Mihomo 内核生效的分流规则与 rule-providers 清单（对齐 Zashboard 规则检视页）
    pub async fn get_rules(&self, cfg: &AppConfig) -> Result<Value, String> {
        let (rules_res, providers_res) = tokio::join!(
            self.request(cfg, Method::GET, "/rules", None, MIHOMO_TIMEOUT_MS),
            self.request(cfg, Method::GET, "/providers/rules", None, MIHOMO_TIMEOUT_MS),
        );
        let rules_resp = rules_res.map_err(|(_, msg)| msg)?;
        let rules_arr = rules_resp
            .get("rules")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let rules: Vec<Value> = rules_arr
            .into_iter()
            .enumerate()
            .map(|(idx, r)| {
                json!({
                    "index": idx + 1,
                    "type": r.get("type").and_then(Value::as_str).unwrap_or(""),
                    "payload": r.get("payload").and_then(Value::as_str).unwrap_or(""),
                    "proxy": r.get("proxy").and_then(Value::as_str).unwrap_or(""),
                })
            })
            .collect();

        let mut providers: Vec<Value> = providers_res
            .ok()
            .and_then(|v| v.get("providers").and_then(Value::as_object).cloned())
            .map(|map| {
                map.into_iter()
                    .map(|(name, p)| {
                        json!({
                            "name": name,
                            "behavior": p.get("behavior").and_then(Value::as_str).unwrap_or(""),
                            "format": p.get("format").and_then(Value::as_str).unwrap_or(""),
                            "ruleCount": p.get("ruleCount").and_then(Value::as_u64).unwrap_or(0),
                            "updatedAt": p.get("updatedAt").and_then(Value::as_str).unwrap_or(""),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        providers.sort_by(|a, b| {
            let na = a["name"].as_str().unwrap_or("");
            let nb = b["name"].as_str().unwrap_or("");
            na.cmp(nb)
        });

        Ok(json!({
            "ok": true,
            "totalRules": rules.len(),
            "rules": rules,
            "providers": providers
        }))
    }

    pub async fn close_connection(&self, cfg: &AppConfig, id: &str) -> Result<Value, String> {
        let ep = if id == "__ALL__" {
            "/connections".to_string()
        } else {
            let enc = encode_path_segment(id);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_path_segment_uses_percent20_for_spaces() {
        let enc = encode_path_segment("🤖 AI 服务");
        assert!(!enc.contains('+'), "path segment must never contain + for spaces");
        assert!(enc.contains("%20AI%20"));
        assert_eq!(encode_path_segment("a/b c+d"), "a%2Fb%20c%2Bd");
    }

    #[test]
    fn detect_chained_topology_finds_front_and_exit_groups() {
        let raw = json!({
            "前置代理": { "type": "Selector", "now": "JP-01", "all": ["JP-01", "HK-01"] },
            "落地出口": { "type": "Selector", "now": "落地-NAT", "all": ["落地-NAT"] },
            "GLOBAL": { "type": "Selector", "now": "落地出口", "all": ["前置代理", "落地出口", "落地-NAT"] },
            "落地-NAT": { "type": "Socks5", "dialer-proxy": "前置代理" },
            "JP-01": { "type": "Vless" }
        });
        let (front, exit) = detect_chained_topology(raw.as_object().unwrap());
        assert_eq!(front.as_deref(), Some("前置代理"));
        assert_eq!(exit.as_deref(), Some("落地出口"));
    }

    #[test]
    fn resolve_delay_params_validates_scheme_and_clamps_timeout() {
        let (u, t) = resolve_delay_params(None, Some(99_999)).unwrap();
        assert_eq!(u, MIHOMO_DELAY_TEST_URL);
        assert_eq!(t, 15_000);
        let (u2, t2) = resolve_delay_params(Some("https://cp.cloudflare.com/generate_204"), Some(200)).unwrap();
        assert_eq!(u2, "https://cp.cloudflare.com/generate_204");
        assert_eq!(t2, 1_000);
        assert!(resolve_delay_params(Some("file:///etc/passwd"), None).is_err());
    }
}
