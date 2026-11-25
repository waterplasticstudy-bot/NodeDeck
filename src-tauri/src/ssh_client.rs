//! 持久加密 SSH 长连接 JSON-RPC 客户端与免密向导

use crate::config::{get_ssh_bin, get_ssh_keygen_bin, load_config, resolve_key_path};
use crate::constants::{
    CREATE_NO_WINDOW, SSHD_PUBKEY_CONF_NAME, SSH_CONNECT_TIMEOUT_SECS, SSH_HANDSHAKE_TIMEOUT_MS,
    SSH_KEY_COMMENT, SSH_SERVER_ALIVE_COUNT_MAX, SSH_SERVER_ALIVE_INTERVAL, SSH_STDERR_MAX_LEN,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::Serialize;
use serde_json::{json, Value};
use std::fs;
use std::process::Stdio;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;
use tokio::time::timeout;

/// 编译期静态内嵌独立远端 Python RPC 守护脚本（零远端落盘）
const REMOTE_AGENT_PY: &str = include_str!("../assets/remote_agent.py");

#[derive(Debug, Clone, Serialize)]
pub struct SshError {
    pub code: String,
    pub error: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw: Option<String>,
}

impl SshError {
    pub fn new(code: &str, error: impl Into<String>, raw: Option<String>) -> Self {
        Self {
            code: code.to_string(),
            error: error.into(),
            raw,
        }
    }
}

struct ActiveSession {
    child: Child,
    stdin: ChildStdin,
    reader: BufReader<ChildStdout>,
    stderr_buf: Arc<StdMutex<String>>,
    seq: u64,
}

impl ActiveSession {
    fn stderr_snapshot(&self) -> String {
        self.stderr_buf
            .lock()
            .map(|s| s.clone())
            .unwrap_or_default()
    }
}

pub struct PersistentSshClient {
    session: Mutex<Option<ActiveSession>>,
}

impl PersistentSshClient {
    pub fn new() -> Self {
        Self {
            session: Mutex::new(None),
        }
    }

    /// 主动重置并终止现有 SSH 通道（配置变更或应用退出时调用）
    pub async fn reset(&self) {
        let mut guard = self.session.lock().await;
        if let Some(mut sess) = guard.take() {
            let _ = sess.child.kill().await;
        }
    }

    fn classify_error(raw_msg: &str) -> SshError {
        let msg = raw_msg.trim();
        let lower = msg.to_ascii_lowercase();
        if lower.contains("permission denied") {
            return SshError::new(
                "AUTH_FAILED",
                "SSH 免密认证失败，请在「本机配置」中点击「一键配置 SSH 免密向导」上传公钥",
                Some(msg.to_string()),
            );
        }
        if lower.contains("timed out") || lower.contains("etimedout") {
            return SshError::new(
                "SSH_TIMEOUT",
                "连接目标 VPS 超时，请检查本机网络或代理状态",
                Some(msg.to_string()),
            );
        }
        if lower.contains("connection refused") {
            return SshError::new(
                "SSH_REFUSED",
                "SSH 连接被拒绝，请检查服务器 IP 与 SSH 端口是否正确",
                Some(msg.to_string()),
            );
        }
        SshError::new(
            "SSH_ERROR",
            if msg.is_empty() {
                "SSH 长连接已断开"
            } else {
                msg
            },
            if msg.is_empty() {
                None
            } else {
                Some(msg.to_string())
            },
        )
    }

    async fn connect_fresh() -> Result<ActiveSession, SshError> {
        let cfg = load_config();
        if cfg.host.trim().is_empty() {
            return Err(SshError::new(
                "NO_HOST",
                "尚未填写服务器公网 IP，请先在「本机配置」中保存目标主机",
                None,
            ));
        }

        let key_file = resolve_key_path(&cfg.key_path);
        if key_file.as_os_str().is_empty() || !key_file.exists() {
            return Err(SshError::new(
                "NO_SSH_KEY",
                format!(
                    "未找到 SSH 私钥文件（{}），请在「本机配置」中点击「一键配置 SSH 免密向导」",
                    key_file.display()
                ),
                None,
            ));
        }

        let mut cmd = Command::new(get_ssh_bin());
        cmd.args([
            "-T",
            "-i",
            &key_file.to_string_lossy(),
            "-p",
            &cfg.ssh_port.to_string(),
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
            &format!("{}@{}", cfg.user, cfg.host),
            r#"python3 -u -c "import base64,sys;exec(base64.b64decode(sys.stdin.readline().strip()))""#,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let mut child = cmd
            .spawn()
            .map_err(|e| SshError::new("SSH_ERROR", format!("无法启动 ssh 进程: {e}"), None))?;

        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| SshError::new("SSH_ERROR", "无法获取 SSH stdin 管道", None))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| SshError::new("SSH_ERROR", "无法获取 SSH stdout 管道", None))?;
        let mut stderr = child
            .stderr
            .take()
            .ok_or_else(|| SshError::new("SSH_ERROR", "无法获取 SSH stderr 管道", None))?;

        let stderr_buf = Arc::new(StdMutex::new(String::new()));
        let stderr_clone = Arc::clone(&stderr_buf);
        tokio::spawn(async move {
            let mut chunk = [0u8; 1024];
            while let Ok(n) = stderr.read(&mut chunk).await {
                if n == 0 {
                    break;
                }
                let text = String::from_utf8_lossy(&chunk[..n]);
                if let Ok(mut buf) = stderr_clone.lock() {
                    buf.push_str(&text);
                    if buf.len() > SSH_STDERR_MAX_LEN {
                        let keep_from = buf.len() - SSH_STDERR_MAX_LEN;
                        let drained: String = buf.chars().skip(keep_from).collect();
                        *buf = drained;
                    }
                }
            }
        });

        let payload = format!("{}\n", B64.encode(REMOTE_AGENT_PY.as_bytes()));
        if let Err(e) = stdin.write_all(payload.as_bytes()).await {
            let _ = child.kill().await;
            return Err(SshError::new(
                "SSH_ERROR",
                format!("向远端推送守护脚本失败: {e}"),
                None,
            ));
        }
        let _ = stdin.flush().await;

        let mut reader = BufReader::new(stdout);
        let handshake = timeout(Duration::from_millis(SSH_HANDSHAKE_TIMEOUT_MS), async {
            let mut line = String::new();
            loop {
                line.clear();
                let n = reader.read_line(&mut line).await?;
                if n == 0 {
                    return Ok::<bool, std::io::Error>(false);
                }
                if let Ok(val) = serde_json::from_str::<Value>(line.trim()) {
                    if val.get("ready").and_then(Value::as_bool) == Some(true) {
                        return Ok(true);
                    }
                }
            }
        })
        .await;

        match handshake {
            Ok(Ok(true)) => Ok(ActiveSession {
                child,
                stdin,
                reader,
                stderr_buf,
                seq: 0,
            }),
            Ok(Ok(false)) => {
                let _ = child.kill().await;
                tokio::time::sleep(Duration::from_millis(60)).await;
                let err_text = stderr_buf.lock().map(|s| s.clone()).unwrap_or_default();
                Err(Self::classify_error(&err_text))
            }
            Ok(Err(e)) => {
                let _ = child.kill().await;
                Err(SshError::new("SSH_ERROR", format!("读取 SSH 握手失败: {e}"), None))
            }
            Err(_) => {
                let _ = child.kill().await;
                Err(SshError::new(
                    "SSH_TIMEOUT",
                    "SSH 长连接握手超时，请检查网络或代理状态",
                    None,
                ))
            }
        }
    }

    /// 串行执行一次远端 JSON-RPC 调用；若连接断开自动销毁以便下次重建
    pub async fn call(
        &self,
        op: &str,
        params: Value,
        timeout_ms: u64,
    ) -> Result<(Value, u64), SshError> {
        let mut guard = self.session.lock().await;
        if guard.is_none() {
            *guard = Some(Self::connect_fresh().await?);
        }

        let sess = guard.as_mut().expect("session initialized");
        sess.seq += 1;
        let req_id = sess.seq;
        let req_line = format!(
            "{}\n",
            json!({ "id": req_id, "op": op, "params": params })
        );
        let started = Instant::now();

        let io_result = timeout(Duration::from_millis(timeout_ms), async {
            sess.stdin.write_all(req_line.as_bytes()).await?;
            sess.stdin.flush().await?;
            let mut line = String::new();
            loop {
                line.clear();
                let n = sess.reader.read_line(&mut line).await?;
                if n == 0 {
                    return Ok::<Option<Value>, std::io::Error>(None);
                }
                if let Ok(val) = serde_json::from_str::<Value>(line.trim()) {
                    if val.get("id").and_then(Value::as_u64) == Some(req_id) {
                        return Ok(Some(val));
                    }
                }
            }
        })
        .await;

        let elapsed_ms = started.elapsed().as_millis() as u64;
        match io_result {
            Ok(Ok(Some(msg))) => {
                if msg.get("ok").and_then(Value::as_bool) == Some(true) {
                    Ok((msg.get("result").cloned().unwrap_or(Value::Null), elapsed_ms))
                } else {
                    let err_str = msg
                        .get("error")
                        .and_then(Value::as_str)
                        .unwrap_or("远端执行失败");
                    Err(SshError::new("REMOTE_ERROR", err_str, None))
                }
            }
            Ok(Ok(None)) => {
                let stderr_text = sess.stderr_snapshot();
                if let Some(mut dead) = guard.take() {
                    let _ = dead.child.kill().await;
                }
                Err(Self::classify_error(&stderr_text))
            }
            Ok(Err(e)) => {
                if let Some(mut dead) = guard.take() {
                    let _ = dead.child.kill().await;
                }
                Err(SshError::new(
                    "SSH_ERROR",
                    format!("SSH 通信异常，已重置连接: {e}"),
                    None,
                ))
            }
            Err(_) => {
                if let Some(mut dead) = guard.take() {
                    let _ = dead.child.kill().await;
                }
                Err(SshError::new(
                    "SSH_TIMEOUT",
                    "远端响应超时，已自动重置长连接，请重试",
                    None,
                ))
            }
        }
    }
}

/// 一键启动交互式 SSH 免密配置向导（自动生成 Ed25519 密钥并打开交互终端输入 1 次 root 密码上传公钥）
pub fn launch_ssh_key_wizard() -> Result<String, SshError> {
    let cfg = load_config();
    if cfg.host.trim().is_empty() {
        return Err(SshError::new("NO_HOST", "请先填写并保存服务器公网 IP", None));
    }
    let key_path = resolve_key_path(&cfg.key_path);
    if let Some(parent) = key_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| SshError::new("IO_ERROR", format!("创建 .ssh 目录失败: {e}"), None))?;
    }

    // 若本机尚未生成专用私钥，先静默生成 Ed25519 密钥
    if !key_path.exists() {
        let mut kg = std::process::Command::new(get_ssh_keygen_bin());
        kg.args([
            "-t",
            "ed25519",
            "-f",
            &key_path.to_string_lossy(),
            "-N",
            "",
            "-C",
            SSH_KEY_COMMENT,
        ]);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            kg.creation_flags(CREATE_NO_WINDOW);
        }
        let status = kg
            .status()
            .map_err(|e| SshError::new("SSH_KEYGEN_ERR", format!("执行 ssh-keygen 失败: {e}"), None))?;
        if !status.success() {
            return Err(SshError::new("SSH_KEYGEN_ERR", "生成 Ed25519 密钥失败", None));
        }
    }

    let pub_path = format!("{}.pub", key_path.to_string_lossy());
    let pub_key = fs::read_to_string(&pub_path)
        .map_err(|e| SshError::new("NO_SSH_KEY", format!("读取公钥文件失败: {e}"), None))?;
    let pub_b64 = B64.encode(pub_key.trim().as_bytes());

    // 远端指令：写入 authorized_keys 并确保 sshd 开启公钥认证
    let remote_cmd = format!(
        "set -e && mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && PUBKEY=$(echo '{pub_b64}' | base64 -d) && (grep -qxF \"$PUBKEY\" ~/.ssh/authorized_keys || echo \"$PUBKEY\" >> ~/.ssh/authorized_keys) && mkdir -p /etc/ssh/sshd_config.d && printf 'PubkeyAuthentication yes\\nPermitRootLogin yes\\nAuthorizedKeysFile .ssh/authorized_keys\\n' > /etc/ssh/sshd_config.d/{SSHD_PUBKEY_CONF_NAME} && sed -i -E 's/^[[:space:]]*PubkeyAuthentication[[:space:]]+no/#PubkeyAuthentication no/Ig' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null || true && sshd -t && (systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || systemctl restart ssh 2>/dev/null || systemctl restart sshd) && echo '=== SSH_KEY_UPLOAD_SUCCESS ==='"
    );

    let ssh_bin = get_ssh_bin();
    let ps_script = format!(
        "$Host.UI.RawUI.WindowTitle = 'NodeDeck SSH 免密配置向导'; \
         Write-Host '======================================================' -ForegroundColor Cyan; \
         Write-Host '  正在上传本机公钥至 {}@{}:{}' -ForegroundColor Cyan; \
         Write-Host '  请按提示输入 1 次服务器 root 密码（输入不显示星号，输完回车）' -ForegroundColor Yellow; \
         Write-Host '======================================================' -ForegroundColor Cyan; \
         & '{}' -p {} -o StrictHostKeyChecking=accept-new '{}@{}' \"{}\"; \
         Write-Host ''; Read-Host '配置完成！按回车关闭此窗口并回到面板点刷新'",
        cfg.user,
        cfg.host,
        cfg.ssh_port,
        ssh_bin,
        cfg.ssh_port,
        cfg.user,
        cfg.host,
        remote_cmd.replace('"', "`\"")
    );

    std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &ps_script])
        .spawn()
        .map_err(|e| SshError::new("LAUNCH_ERR", format!("拉起配置窗口失败: {e}"), None))?;

    Ok("已弹出 SSH 免密配置终端，按提示输入 1 次密码后回到面板点击「测试免密连接」即可".to_string())
}
