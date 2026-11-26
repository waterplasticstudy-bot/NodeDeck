//! Alpine NAT SSH 传输层与基础运维采集（总览、日志、校验/重启/端口、备份恢复）

use crate::config::{get_ssh_bin, resolve_key_path, NatNodeConfig};
use crate::constants::{
    ALPINE_CONFIG_PATH_PATTERN, ALPINE_SSH_TIMEOUT_MS, CREATE_NO_WINDOW,
    DEFAULT_NAT_SINGBOX_CONFIG, NAT_BACKUP_NAME_PATTERN, SSH_CONNECT_TIMEOUT_SECS,
};
use crate::ssh_client::SshError;
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::time::timeout;

/// 编译期静态内嵌 POSIX /bin/sh 采集与运维脚本（兼容 Alpine 3.21 / OpenRC，无需 Python）
const ALPINE_AGENT_SH: &str = include_str!("../../assets/remote_agent_alpine.sh");

static ALPINE_CFG_PATH_RE: OnceLock<Regex> = OnceLock::new();
static NAT_BACKUP_RE: OnceLock<Regex> = OnceLock::new();

fn validate_alpine_cfg_path(raw: &str) -> Result<String, SshError> {
    let trimmed = raw.trim();
    let candidate = if trimmed.is_empty() {
        DEFAULT_NAT_SINGBOX_CONFIG
    } else {
        trimmed
    };
    let re = ALPINE_CFG_PATH_RE
        .get_or_init(|| Regex::new(ALPINE_CONFIG_PATH_PATTERN).expect("valid alpine path regex"));
    if candidate.contains("..") || !re.is_match(candidate) {
        return Err(SshError::new(
            "VALIDATION_ERROR",
            "Alpine sing-box 配置文件路径格式无效（仅允许以 / 开头的安全路径字符）",
            None,
        ));
    }
    Ok(candidate.to_string())
}

fn validate_safe_extra(raw: &str) -> Result<(), SshError> {
    if raw.contains('\'') || raw.contains('\n') || raw.contains('\r') {
        return Err(SshError::new("VALIDATION_ERROR", "远端参数包含非法控制字符", None));
    }
    Ok(())
}

pub(crate) async fn exec_alpine_script_timeout(
    node: &NatNodeConfig,
    fallback_key_path: &str,
    action: &str,
    extra_arg: Option<&str>,
    timeout_ms: u64,
) -> Result<(String, u64), SshError> {
    if node.public_ip.trim().is_empty() || node.ssh_port == 0 {
        return Err(SshError::new(
            "NAT_SSH_UNCONFIGURED",
            "该 NAT 节点尚未配置公网 SSH 映射端口（可在节点编辑中补充，或直接使用官方 Web 终端）",
            None,
        ));
    }

    let raw_key = if node.ssh_key_path.trim().is_empty() {
        fallback_key_path
    } else {
        node.ssh_key_path.as_str()
    };
    let key_file = resolve_key_path(raw_key);
    if key_file.as_os_str().is_empty() || !key_file.exists() {
        return Err(SshError::new(
            "NO_SSH_KEY",
            format!("未找到 SSH 私钥文件: {}", key_file.display()),
            None,
        ));
    }

    let cfg_path = validate_alpine_cfg_path(&node.singbox_config_path)?;
    if let Some(arg) = extra_arg {
        validate_safe_extra(arg)?;
    }

    let user = if node.ssh_user.trim().is_empty() {
        "root"
    } else {
        node.ssh_user.trim()
    };
    let remote_sh = match extra_arg {
        Some(arg) => format!("sh -s -- {action} '{cfg_path}' '{arg}'"),
        None => format!("sh -s -- {action} '{cfg_path}'"),
    };

    let mut cmd = Command::new(get_ssh_bin());
    cmd.args([
        "-T",
        "-i",
        &key_file.to_string_lossy(),
        "-p",
        &node.ssh_port.to_string(),
        "-o",
        "BatchMode=yes",
        "-o",
        &format!("ConnectTimeout={SSH_CONNECT_TIMEOUT_SECS}"),
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        "LogLevel=ERROR",
        &format!("{user}@{}", node.public_ip.trim()),
        &remote_sh,
    ])
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .kill_on_drop(true);

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let started = Instant::now();
    let mut child = cmd
        .spawn()
        .map_err(|e| SshError::new("SSH_ERROR", format!("无法启动 ssh 进程: {e}"), None))?;

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(ALPINE_AGENT_SH.as_bytes()).await;
        let _ = stdin.shutdown().await;
    }

    let output = timeout(Duration::from_millis(timeout_ms), child.wait_with_output())
        .await
        .map_err(|_| SshError::new("SSH_TIMEOUT", "连接 NAT SSH 超时，请检查端口映射或远端响应", None))?
        .map_err(|e| SshError::new("SSH_ERROR", format!("读取 NAT SSH 输出失败: {e}"), None))?;

    let elapsed_ms = started.elapsed().as_millis() as u64;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        let msg = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("远端命令返回非零状态 ({})", output.status)
        };
        return Err(SshError::new("ALPINE_SSH_ERR", msg, None));
    }

    Ok((stdout, elapsed_ms))
}

pub(crate) async fn exec_alpine_script(
    node: &NatNodeConfig,
    fallback_key_path: &str,
    action: &str,
    extra_arg: Option<&str>,
) -> Result<(String, u64), SshError> {
    exec_alpine_script_timeout(node, fallback_key_path, action, extra_arg, ALPINE_SSH_TIMEOUT_MS)
        .await
}

/// 采集 Alpine NAT 实时系统指标与 sing-box 进程状态
pub async fn fetch_alpine_overview(
    node: &NatNodeConfig,
    fallback_key_path: &str,
) -> Result<Value, SshError> {
    let (stdout, elapsed_ms) = exec_alpine_script(node, fallback_key_path, "overview", None).await?;
    let mut kv = HashMap::new();
    for line in stdout.lines() {
        if let Some((k, v)) = line.split_once('=') {
            kv.insert(k.trim().to_string(), v.trim().to_string());
        }
    }

    let parse_u64 = |k: &str| kv.get(k).and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
    let parse_f64 = |k: &str| kv.get(k).and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);

    let mem_total = parse_u64("MEM_TOTAL");
    let mem_used = parse_u64("MEM_USED");
    let mem_pct = if mem_total > 0 {
        (mem_used as f64 * 100.0 / mem_total as f64 * 10.0).round() / 10.0
    } else {
        0.0
    };
    let disk_total = parse_u64("DISK_TOTAL");
    let disk_used = parse_u64("DISK_USED");
    let disk_free = parse_u64("DISK_FREE");
    let disk_pct = if disk_total > 0 {
        (disk_used as f64 * 100.0 / disk_total as f64 * 10.0).round() / 10.0
    } else {
        0.0
    };

    Ok(json!({
        "ok": true,
        "sshLatencyMs": elapsed_ms,
        "os": kv.get("OS").cloned().unwrap_or_else(|| "Alpine Linux".to_string()),
        "kernel": kv.get("KERNEL").cloned().unwrap_or_default(),
        "uptimeSec": parse_u64("UPTIME"),
        "load": kv.get("LOAD").cloned().unwrap_or_else(|| "0 0 0".to_string()),
        "cpuPercent": parse_f64("CPU_PCT"),
        "memory": { "total": mem_total, "used": mem_used, "percent": mem_pct },
        "disk": { "total": disk_total, "used": disk_used, "free": disk_free, "percent": disk_pct },
        "network": {
            "iface": kv.get("IFACE").cloned().unwrap_or_default(),
            "rxBytes": parse_u64("RX_BYTES"),
            "txBytes": parse_u64("TX_BYTES")
        },
        "singbox": {
            "active": kv.get("SB_ACTIVE").map(|s| s == "true").unwrap_or(false),
            "pid": kv.get("SB_PID").cloned().unwrap_or_default(),
            "memoryBytes": parse_u64("SB_RSS"),
            "version": kv.get("SB_VER").cloned().unwrap_or_default(),
            "configExists": kv.get("CFG_EXISTS").map(|s| s == "true").unwrap_or(false),
            "configPath": kv.get("CFG_PATH").cloned().unwrap_or_default()
        }
    }))
}

/// 恢复 Alpine NAT 历史配置备份
pub async fn restore_alpine_backup(
    node: &NatNodeConfig,
    fallback_key_path: &str,
    backup: &str,
) -> Result<Value, SshError> {
    let trimmed = backup.trim();
    let re = NAT_BACKUP_RE
        .get_or_init(|| Regex::new(NAT_BACKUP_NAME_PATTERN).expect("valid backup regex"));
    if !re.is_match(trimmed) {
        return Err(SshError::new("VALIDATION_ERROR", "非法备份文件名", None));
    }
    let (out, _) =
        exec_alpine_script(node, fallback_key_path, "restore_backup", Some(trimmed)).await?;
    Ok(json!({ "ok": true, "message": out }))
}

/// 读取 Alpine NAT 的 sing-box 运行日志（/var/log/sing-box.log）
pub async fn fetch_alpine_logs(
    node: &NatNodeConfig,
    fallback_key_path: &str,
    lines: u64,
) -> Result<Value, SshError> {
    let clamped = lines.clamp(20, 400).to_string();
    let (out, _) = exec_alpine_script(node, fallback_key_path, "logs", Some(&clamped)).await?;
    Ok(json!({ "ok": true, "logs": out }))
}

/// 在 Alpine NAT 执行只读诊断或重启（check / restart / ports）
pub async fn run_alpine_service_action(
    node: &NatNodeConfig,
    fallback_key_path: &str,
    action: &str,
) -> Result<Value, SshError> {
    if !matches!(action, "check" | "restart" | "ports") {
        return Err(SshError::new("VALIDATION_ERROR", "不支持的 Alpine NAT 运维动作", None));
    }
    let (out, _) = exec_alpine_script(node, fallback_key_path, action, None).await?;
    Ok(json!({ "ok": true, "output": out }))
}
