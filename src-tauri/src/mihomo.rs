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
use std::path::Path;
use std::time::{Duration, Instant};
use url::Url;

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

        groups.sort_by(|a, b| {
            let na = a.get("name").and_then(Value::as_str).unwrap_or("");
            let nb = b.get("name").and_then(Value::as_str).unwrap_or("");
            let ia = MIHOMO_PRIORITY_GROUPS.iter().position(|&x| x == na);
            let ib = MIHOMO_PRIORITY_GROUPS.iter().position(|&x| x == nb);
            match (ia, ib) {
                (Some(x), Some(y)) => x.cmp(&y),
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => na.cmp(nb),
            }
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

        let primary_group = groups.iter().find(|g| g["name"].as_str() != Some("GLOBAL"));
        let secondary_group = groups
            .iter()
            .filter(|g| g["name"].as_str() != Some("GLOBAL"))
            .nth(1);
        let fallback_group = groups
            .iter()
            .find(|g| {
                let n = g["name"].as_str().unwrap_or("").to_ascii_lowercase();
                n.contains("fallback") || n.contains("兜底") || n.contains("漏网")
            })
            .or_else(|| groups.iter().find(|g| g["name"].as_str() == Some("GLOBAL")));

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
                "primaryName": primary_group.and_then(|g| g["name"].as_str()).unwrap_or("主力策略组"),
                "primaryNow": primary_group.and_then(|g| g["now"].as_str()).unwrap_or("--"),
                "secondaryName": secondary_group.and_then(|g| g["name"].as_str()).unwrap_or("次级策略组"),
                "secondaryNow": secondary_group.and_then(|g| g["now"].as_str()).unwrap_or("--"),
                "fallback": fallback_group.and_then(|g| g["now"].as_str()).unwrap_or("--")
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
