//! 跨平台原生 PTY 交互式 SSH 终端管理（Windows ConPTY / macOS PTY，支持多标签、动态缩放与退出清理）

use crate::config::{get_ssh_bin, resolve_key_path};
use crate::constants::{
    SSH_CONNECT_TIMEOUT_SECS, SSH_SERVER_ALIVE_COUNT_MAX, SSH_SERVER_ALIVE_INTERVAL,
};
use crate::ssh_client::SshError;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

pub const EVENT_PTY_DATA: &str = "nodedeck://pty-data";
pub const EVENT_PTY_EXIT: &str = "nodedeck://pty-exit";

pub struct PtyTarget {
    pub node_id: String,
    pub node_name: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub key_path: String,
}

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

pub struct TerminalManager {
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
}

impl TerminalManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn open_session(
        &self,
        app: &AppHandle,
        target: PtyTarget,
        cols: u16,
        rows: u16,
    ) -> Result<Value, SshError> {
        let host = target.host.trim();
        if host.is_empty() || target.port == 0 {
            return Err(SshError::new(
                "VALIDATION_ERROR",
                "目标节点尚未配置公网 IP 或 SSH 端口",
                None,
            ));
        }
        let key_file = resolve_key_path(&target.key_path);
        if key_file.as_os_str().is_empty() || !key_file.exists() {
            return Err(SshError::new(
                "NO_SSH_KEY",
                format!("未找到 SSH 私钥文件: {}", key_file.display()),
                None,
            ));
        }

        let user = if target.user.trim().is_empty() {
            "root"
        } else {
            target.user.trim()
        };

        let pty_system = native_pty_system();
        let size = PtySize {
            rows: rows.clamp(10, 200),
            cols: cols.clamp(40, 400),
            pixel_width: 0,
            pixel_height: 0,
        };
        let pair = pty_system
            .openpty(size)
            .map_err(|e| SshError::new("PTY_ERR", format!("创建本地伪终端失败: {e}"), None))?;

        let mut cmd = CommandBuilder::new(get_ssh_bin());
        cmd.args([
            "-tt",
            "-i",
            &key_file.to_string_lossy(),
            "-p",
            &target.port.to_string(),
            "-o",
            "BatchMode=yes",
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
            &format!("{user}@{host}"),
        ]);
        cmd.env("TERM", "xterm-256color");

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| SshError::new("PTY_ERR", format!("启动交互式 SSH 终端失败: {e}"), None))?;
        drop(pair.slave);

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| SshError::new("PTY_ERR", format!("无法读取伪终端输出流: {e}"), None))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| SshError::new("PTY_ERR", format!("无法获取伪终端输入流: {e}"), None))?;

        let session_id = format!("pty_{}", &Uuid::new_v4().simple().to_string()[..12]);
        {
            let mut map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
            map.insert(
                session_id.clone(),
                PtySession {
                    master: pair.master,
                    writer,
                    child,
                },
            );
        }

        let app_clone = app.clone();
        let sid_clone = session_id.clone();
        let map_clone = Arc::clone(&self.sessions);
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let b64 = B64.encode(&buf[..n]);
                        let _ = app_clone.emit(
                            EVENT_PTY_DATA,
                            json!({ "sessionId": sid_clone, "data": b64 }),
                        );
                    }
                    Err(_) => break,
                }
            }
            if let Ok(mut map) = map_clone.lock() {
                if let Some(mut sess) = map.remove(&sid_clone) {
                    let _ = sess.child.kill();
                }
            }
            let _ = app_clone.emit(EVENT_PTY_EXIT, json!({ "sessionId": sid_clone }));
        });

        Ok(json!({
            "ok": true,
            "sessionId": session_id,
            "nodeId": target.node_id,
            "nodeName": target.node_name,
            "host": host,
            "port": target.port
        }))
    }

    pub fn write(&self, session_id: &str, data: &str) -> Result<(), SshError> {
        let mut map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let Some(sess) = map.get_mut(session_id) else {
            return Err(SshError::new("PTY_CLOSED", "终端会话已关闭", None));
        };
        sess.writer
            .write_all(data.as_bytes())
            .map_err(|e| SshError::new("PTY_WRITE_ERR", format!("写入终端失败: {e}"), None))?;
        let _ = sess.writer.flush();
        Ok(())
    }

    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), SshError> {
        let map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let Some(sess) = map.get(session_id) else {
            return Ok(());
        };
        let _ = sess.master.resize(PtySize {
            rows: rows.clamp(10, 200),
            cols: cols.clamp(40, 400),
            pixel_width: 0,
            pixel_height: 0,
        });
        Ok(())
    }

    pub fn close(&self, session_id: &str) {
        let mut map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(mut sess) = map.remove(session_id) {
            let _ = sess.child.kill();
        }
    }

    pub fn close_all(&self) {
        let mut map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        for (_, mut sess) in map.drain() {
            let _ = sess.child.kill();
        }
    }
}
