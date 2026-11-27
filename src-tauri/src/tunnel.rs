//! 零公网暴露远端 sing-box 面板加密 SSH 回环隧道管理与实时采集

use crate::config::{get_ssh_bin, resolve_key_path};
#[cfg(target_os = "windows")]
use crate::constants::CREATE_NO_WINDOW;
use crate::constants::{
    SINGBOX_PANEL_WINDOW_HEIGHT, SINGBOX_PANEL_WINDOW_PREFIX, SINGBOX_PANEL_WINDOW_WIDTH,
    SSH_CONNECT_TIMEOUT_SECS, SSH_SERVER_ALIVE_COUNT_MAX, SSH_SERVER_ALIVE_INTERVAL,
    TUNNEL_HTTP_TIMEOUT_MS, TUNNEL_READY_TIMEOUT_MS,
};
use crate::ssh_client::SshError;
use reqwest::Client;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::TcpListener;
use std::process::Stdio;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::net::TcpStream;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::time::timeout;

pub struct TunnelTarget {
    pub node_id: String,
    pub node_name: String,
    pub ssh_host: String,
    pub ssh_port: u16,
    pub ssh_user: String,
    pub ssh_key_path: String,
    pub remote_controller: String,
    pub secret: String,
}

struct ActiveTunnel {
    child: Child,
    window_label: String,
    node_name: String,
    local_port: u16,
    remote_port: u16,
    secret: String,
}

pub struct TunnelManager {
    tunnels: Mutex<HashMap<String, ActiveTunnel>>,
    http: Client,
}

fn sanitize_label_id(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .take(40)
        .collect();
    if cleaned.is_empty() {
        "node".to_string()
    } else {
        cleaned
    }
}

pub fn panel_window_label(node_id: &str) -> String {
    format!("{SINGBOX_PANEL_WINDOW_PREFIX}{}", sanitize_label_id(node_id))
}

fn parse_loopback_controller(raw: &str) -> Result<u16, SshError> {
    let trimmed = raw
        .trim()
        .trim_start_matches("http://")
        .trim_start_matches("https://")
        .trim_end_matches('/');
    let Some((host, port_str)) = trimmed.rsplit_once(':') else {
        return Err(SshError::new(
            "TUNNEL_ERR",
            format!("远端 clash_api 地址格式无效: {raw}"),
            None,
        ));
    };
    let host_clean = host.trim_matches(|c| c == '[' || c == ']');
    if !matches!(host_clean, "127.0.0.1" | "localhost" | "::1" | "0.0.0.0" | "") {
        return Err(SshError::new(
            "TUNNEL_ERR",
            format!("安全护栏：仅允许转发远端本机回环地址，拒绝转发 {host_clean}"),
            None,
        ));
    }
    let port: u16 = port_str
        .parse()
        .map_err(|_| SshError::new("TUNNEL_ERR", format!("远端端口无效: {port_str}"), None))?;
    if port < 1024 {
        return Err(SshError::new(
            "TUNNEL_ERR",
            format!("远端控制端口必须 >= 1024（当前 {port}）"),
            None,
        ));
    }
    Ok(port)
}

fn pick_free_local_port() -> Result<u16, SshError> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|e| SshError::new("TUNNEL_ERR", format!("无法分配本机临时回环端口: {e}"), None))?;
    let port = listener
        .local_addr()
        .map_err(|e| SshError::new("TUNNEL_ERR", format!("无法读取临时端口: {e}"), None))?
        .port();
    Ok(port)
}

impl TunnelManager {
    pub fn new() -> Self {
        let http = Client::builder()
            .timeout(Duration::from_millis(TUNNEL_HTTP_TIMEOUT_MS))
            .no_proxy()
            .build()
            .expect("build loopback tunnel http client");
        Self {
            tunnels: Mutex::new(HashMap::new()),
            http,
        }
    }

    async fn spawn_tunnel(target: &TunnelTarget) -> Result<ActiveTunnel, SshError> {
        let remote_port = parse_loopback_controller(&target.remote_controller)?;
        let key_file = resolve_key_path(&target.ssh_key_path);
        if key_file.as_os_str().is_empty() || !key_file.exists() {
            return Err(SshError::new(
                "NO_SSH_KEY",
                format!("未找到 SSH 私钥文件: {}", key_file.display()),
                None,
            ));
        }

        let local_port = pick_free_local_port()?;
        let forward_spec = format!("127.0.0.1:{local_port}:127.0.0.1:{remote_port}");
        let ssh_user = if target.ssh_user.trim().is_empty() {
            "root"
        } else {
            target.ssh_user.trim()
        };

        let mut cmd = Command::new(get_ssh_bin());
        cmd.args([
            "-N",
            "-T",
            "-i",
            &key_file.to_string_lossy(),
            "-p",
            &target.ssh_port.to_string(),
            "-o",
            "BatchMode=yes",
            "-o",
            "ExitOnForwardFailure=yes",
            "-o",
            &format!("ConnectTimeout={SSH_CONNECT_TIMEOUT_SECS}"),
            "-o",
            &format!("ServerAliveInterval={SSH_SERVER_ALIVE_INTERVAL}"),
            "-o",
            &format!("ServerAliveCountMax={SSH_SERVER_ALIVE_COUNT_MAX}"),
            "-o",
            "StrictHostKeyChecking=accept-new",
            "-o",
            "LogLevel=ERROR",
            "-L",
            &forward_spec,
            &format!("{ssh_user}@{}", target.ssh_host.trim()),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let mut child = cmd
            .spawn()
            .map_err(|e| SshError::new("TUNNEL_ERR", format!("无法启动 SSH 隧道进程: {e}"), None))?;

        let deadline = Instant::now() + Duration::from_millis(TUNNEL_READY_TIMEOUT_MS);
        let mut ready = false;
        while Instant::now() < deadline {
            if let Ok(Some(status)) = child.try_wait() {
                let msg = format!("SSH 加密隧道异常退出 ({status})，请检查节点 SSH 连通性");
                return Err(SshError::new("TUNNEL_ERR", msg, None));
            }
            if timeout(
                Duration::from_millis(250),
                TcpStream::connect(("127.0.0.1", local_port)),
            )
            .await
            .is_ok_and(|r| r.is_ok())
            {
                ready = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(120)).await;
        }

        if !ready {
            let _ = child.kill().await;
            return Err(SshError::new(
                "TUNNEL_TIMEOUT",
                "等待 SSH 加密隧道就绪超时，请确认本机网络与目标节点可连",
                None,
            ));
        }

        Ok(ActiveTunnel {
            child,
            window_label: panel_window_label(&target.node_id),
            node_name: target.node_name.clone(),
            local_port,
            remote_port,
            secret: target.secret.clone(),
        })
    }

    /// 打开或复用零公网暴露远端 sing-box 面板窗口与本地加密 SSH 回环隧道
    pub async fn open_panel(
        &self,
        app: &AppHandle,
        target: TunnelTarget,
        theme: &str,
    ) -> Result<Value, SshError> {
        let label = panel_window_label(&target.node_id);

        // 若已有活隧道则直接复用；已失效则自动重建
        let (local_port, remote_port) = {
            let mut guard = self.tunnels.lock().await;
            let alive = match guard.get_mut(&target.node_id) {
                Some(t) => !matches!(t.child.try_wait(), Ok(Some(_))),
                None => false,
            };
            if !alive {
                if let Some(mut dead) = guard.remove(&target.node_id) {
                    let _ = dead.child.kill().await;
                }
                let fresh = Self::spawn_tunnel(&target).await?;
                let lp = fresh.local_port;
                let rp = fresh.remote_port;
                guard.insert(target.node_id.clone(), fresh);
                (lp, rp)
            } else {
                let t = guard.get(&target.node_id).expect("alive tunnel");
                (t.local_port, t.remote_port)
            }
        };

        let title = format!(
            "📊 {} · 远端 sing-box 面板 (127.0.0.1:{local_port})",
            target.node_name
        );

        if let Some(existing) = app.get_webview_window(&label) {
            let _ = existing.set_title(&title);
            let _ = existing.show();
            let _ = existing.unminimize();
            let _ = existing.set_focus();
            return Ok(json!({
                "ok": true,
                "reused": true,
                "nodeId": target.node_id,
                "label": label,
                "localPort": local_port,
                "remotePort": remote_port
            }));
        }

        let norm_theme = if theme == "dark" { "dark" } else { "light" };
        let encoded_id: String =
            url::form_urlencoded::byte_serialize(target.node_id.as_bytes()).collect();
        let app_url = format!("remote-panel.html?nodeId={encoded_id}&theme={norm_theme}");

        let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(app_url.into()))
            .title(&title)
            .inner_size(SINGBOX_PANEL_WINDOW_WIDTH, SINGBOX_PANEL_WINDOW_HEIGHT)
            .min_inner_size(760.0, 520.0)
            .center()
            .resizable(true);

        if let Some(icon) = app.default_window_icon() {
            builder = builder.icon(icon.clone()).map_err(|e| {
                SshError::new("WINDOW_ERR", format!("设置面板窗口图标失败: {e}"), None)
            })?;
        }

        builder.build().map_err(|e| {
            SshError::new("WINDOW_ERR", format!("打开远端 sing-box 面板窗口失败: {e}"), None)
        })?;

        Ok(json!({
            "ok": true,
            "reused": false,
            "nodeId": target.node_id,
            "label": label,
            "localPort": local_port,
            "remotePort": remote_port
        }))
    }

    /// 经本机 127.0.0.1 加密隧道实时轮询远端 sing-box 的 version / connections / rules
    pub async fn poll_panel(&self, node_id: &str, include_rules: bool) -> Result<Value, SshError> {
        let (local_port, remote_port, secret, node_name) = {
            let mut guard = self.tunnels.lock().await;
            let Some(t) = guard.get_mut(node_id) else {
                return Err(SshError::new(
                    "TUNNEL_CLOSED",
                    "SSH 加密隧道已关闭，请重新从主面板打开",
                    None,
                ));
            };
            if matches!(t.child.try_wait(), Ok(Some(_))) {
                let mut dead = guard.remove(node_id).unwrap();
                let _ = dead.child.kill().await;
                return Err(SshError::new(
                    "TUNNEL_CLOSED",
                    "SSH 加密隧道已断开，请关闭窗口后重新打开",
                    None,
                ));
            }
            (t.local_port, t.remote_port, t.secret.clone(), t.node_name.clone())
        };

        let base = format!("http://127.0.0.1:{local_port}");
        let fetch_json = |path: &str| {
            let url = format!("{base}{path}");
            let mut req = self.http.get(url);
            if !secret.is_empty() {
                req = req.header("Authorization", format!("Bearer {secret}"));
            }
            async move {
                let resp = req
                    .send()
                    .await
                    .map_err(|e| SshError::new("TUNNEL_HTTP_ERR", format!("隧道请求失败: {e}"), None))?;
                if !resp.status().is_success() {
                    return Err(SshError::new(
                        "TUNNEL_HTTP_ERR",
                        format!("远端 clash_api 返回 HTTP {}", resp.status().as_u16()),
                        None,
                    ));
                }
                resp.json::<Value>()
                    .await
                    .map_err(|e| SshError::new("JSON_ERR", format!("解析响应失败: {e}"), None))
            }
        };

        let (conn_res, ver_res, rules_opt) = if include_rules {
            let (c, v, r) = tokio::join!(
                fetch_json("/connections"),
                fetch_json("/version"),
                fetch_json("/rules")
            );
            (c, v, r.ok())
        } else {
            let (c, v) = tokio::join!(fetch_json("/connections"), fetch_json("/version"));
            (c, v, None)
        };

        let conns = conn_res?;
        let version = ver_res.unwrap_or_else(|_| json!({}));

        Ok(json!({
            "ok": true,
            "nodeId": node_id,
            "nodeName": node_name,
            "localPort": local_port,
            "remotePort": remote_port,
            "secret": secret,
            "version": version.get("version").and_then(Value::as_str).unwrap_or("sing-box"),
            "memory": conns.get("memory").and_then(Value::as_u64).unwrap_or(0),
            "uploadTotal": conns.get("uploadTotal").and_then(Value::as_u64).unwrap_or(0),
            "downloadTotal": conns.get("downloadTotal").and_then(Value::as_u64).unwrap_or(0),
            "connections": conns.get("connections").cloned().unwrap_or_else(|| json!([])),
            "rules": rules_opt.and_then(|r| r.get("rules").cloned()).unwrap_or_else(|| json!([]))
        }))
    }

    pub async fn close_panel_conn(&self, node_id: &str, conn_id: &str) -> Result<Value, SshError> {
        let (local_port, secret) = {
            let guard = self.tunnels.lock().await;
            let Some(t) = guard.get(node_id) else {
                return Err(SshError::new("TUNNEL_CLOSED", "隧道未激活", None));
            };
            (t.local_port, t.secret.clone())
        };
        let url = if conn_id == "__ALL__" {
            format!("http://127.0.0.1:{local_port}/connections")
        } else {
            format!("http://127.0.0.1:{local_port}/connections/{}", conn_id.trim())
        };
        let mut req = self.http.delete(url);
        if !secret.is_empty() {
            req = req.header("Authorization", format!("Bearer {secret}"));
        }
        req.send()
            .await
            .map_err(|e| SshError::new("TUNNEL_HTTP_ERR", format!("掐断连接失败: {e}"), None))?;
        Ok(json!({ "ok": true }))
    }

    pub async fn close_node(&self, node_id: &str) {
        let mut guard = self.tunnels.lock().await;
        if let Some(mut t) = guard.remove(node_id) {
            let _ = t.child.kill().await;
        }
    }

    pub async fn close_by_window_label(&self, label: &str) {
        let mut guard = self.tunnels.lock().await;
        let target_key = guard
            .iter()
            .find(|(_, t)| t.window_label == label)
            .map(|(k, _)| k.clone());
        if let Some(key) = target_key {
            if let Some(mut t) = guard.remove(&key) {
                let _ = t.child.kill().await;
            }
        }
    }

    pub async fn close_all(&self) {
        let mut guard = self.tunnels.lock().await;
        for (_, mut t) in guard.drain() {
            let _ = t.child.kill().await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_loopback_controller_rejects_public_hosts() {
        assert_eq!(parse_loopback_controller("127.0.0.1:19090").unwrap(), 19090);
        assert_eq!(parse_loopback_controller("http://127.0.0.1:19091/").unwrap(), 19091);
        assert!(parse_loopback_controller("198.51.100.10:19090").is_err());
        assert!(parse_loopback_controller("127.0.0.1:80").is_err());
    }
}
