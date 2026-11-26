//! 宿主机原生多出口单选切换、计费解析与落地 IP/AI 诊断

use super::ssh::{exec_alpine_script, exec_alpine_script_timeout};
use crate::config::{NatNodeConfig, TrafficSnapshot};
use crate::constants::{ALPINE_LATENCY_TIMEOUT_MS, ALPINE_LONG_TIMEOUT_MS, RESIDENTIAL_EXIT_CODES};
use crate::ssh_client::SshError;
use regex::Regex;
use serde_json::{json, Value};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

static SIZE_RE: OnceLock<Regex> = OnceLock::new();

fn parse_size_to_bytes(text: &str) -> u64 {
    let re = SIZE_RE.get_or_init(|| Regex::new(r"([\d.]+)\s*(TB|GB|MB|KB|B)").expect("size regex"));
    let Some(cap) = re.captures(text) else {
        return 0;
    };
    let val: f64 = cap[1].parse().unwrap_or(0.0);
    let mult: f64 = match cap[2].to_ascii_uppercase().as_str() {
        "TB" => 1_099_511_627_776.0,
        "GB" => 1_073_741_824.0,
        "MB" => 1_048_576.0,
        "KB" => 1024.0,
        _ => 1.0,
    };
    (val * mult).round() as u64
}

fn map_exit_label_to_code(label: &str) -> &'static str {
    let lower = label.to_ascii_lowercase();
    if lower.contains("america") || lower.contains("at&t") {
        "us"
    } else if lower.contains("australia") {
        "au"
    } else if lower.contains("hgc") {
        "hgc"
    } else if lower.contains("hkt") {
        "hkt"
    } else if lower.contains("japan") || lower.contains("softbank") {
        "jp"
    } else if lower.contains("korea") {
        "kr"
    } else if lower.contains("特价") {
        "mos"
    } else if lower.contains("macau") || lower.contains("ctm") {
        "mo"
    } else if lower.contains("malaysia") {
        "my"
    } else if lower.contains("singapore") || lower.contains("viewqwest") {
        "sgv"
    } else if lower.contains("直连") || lower.contains("direct") {
        "direct"
    } else {
        ""
    }
}

pub async fn fetch_nat_exit_status(
    node: &NatNodeConfig,
    fallback_key_path: &str,
) -> Result<(Value, Option<TrafficSnapshot>), SshError> {
    let (stdout, _) = exec_alpine_script(node, fallback_key_path, "exit_status", None).await?;
    let mut lines = stdout.lines();
    let kind_line = lines.next().unwrap_or("KIND=none").trim();
    let kind = kind_line.strip_prefix("KIND=").unwrap_or("none");
    let body: Vec<&str> = lines.collect();

    if kind == "global" {
        let mut current_exit = String::new();
        let mut multiplier = String::new();
        let mut plan = String::new();
        let mut cycle = String::new();
        let mut expires_at = String::new();
        let mut billed_text = String::new();
        let mut total_text = String::new();
        let mut remain_text = String::new();
        let mut quota_status = String::new();
        let mut breakdown: Vec<Value> = Vec::new();

        for raw_line in &body {
            let line = raw_line.trim();
            if let Some(v) = line.strip_prefix("当前出口：") {
                current_exit = v.trim().to_string();
            } else if let Some(v) = line.strip_prefix("当前倍率：") {
                multiplier = v.trim().to_string();
            } else if let Some(v) = line.strip_prefix("套餐：") {
                plan = v.trim().to_string();
            } else if let Some(v) = line.strip_prefix("计费周期：") {
                cycle = v.trim().to_string();
            } else if let Some(v) = line.strip_prefix("到期时间：") {
                expires_at = v.trim().to_string();
            } else if let Some(v) = line.strip_prefix("已计费流量：") {
                billed_text = v.trim().to_string();
            } else if let Some(v) = line.strip_prefix("套餐总额度：") {
                total_text = v.trim().to_string();
            } else if let Some(v) = line.strip_prefix("剩余流量：") {
                remain_text = v.trim().to_string();
            } else if let Some(v) = line.strip_prefix("额度状态：") {
                quota_status = v.trim().to_string();
            } else if let Some((left, right)) = line.split_once("实际流量：") {
                let label = left.trim().to_string();
                let code = map_exit_label_to_code(&label);
                let (usage_part, mult_part) = right
                    .split_once('×')
                    .map(|(a, b)| (a.trim().to_string(), b.trim().to_string()))
                    .unwrap_or_else(|| (right.trim().to_string(), "1".to_string()));
                breakdown.push(json!({
                    "label": label,
                    "code": code,
                    "usageText": usage_part,
                    "multiplier": mult_part
                }));
            }
        }

        let used_bytes = parse_size_to_bytes(&billed_text);
        let total_bytes = parse_size_to_bytes(&total_text);
        let percent = if total_bytes > 0 {
            ((used_bytes as f64 * 100.0 / total_bytes as f64) * 10.0).round() / 10.0
        } else {
            0.0
        };
        let short_exp = expires_at.split_whitespace().next().unwrap_or("").to_string();
        let now_ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs().to_string())
            .unwrap_or_default();

        let snapshot = if total_bytes > 0 {
            Some(TrafficSnapshot {
                used_bytes,
                total_bytes,
                used_text: billed_text.clone(),
                total_text: total_text.clone(),
                percent,
                cycle_text: cycle.clone(),
                expires_at: short_exp.clone(),
                synced_at: now_ts,
                source: "host-billing".to_string(),
            })
        } else {
            None
        };

        return Ok((
            json!({
                "ok": true,
                "kind": "global",
                "currentExit": current_exit,
                "currentExitCode": map_exit_label_to_code(&current_exit),
                "multiplier": multiplier,
                "plan": plan,
                "cycle": cycle,
                "expiresAt": short_exp,
                "billedText": billed_text,
                "totalText": total_text,
                "remainText": remain_text,
                "usedBytes": used_bytes,
                "totalBytes": total_bytes,
                "percent": percent,
                "quotaStatus": quota_status,
                "breakdown": breakdown
            }),
            snapshot,
        ));
    }

    if kind == "jp" {
        let joined = body.join("\n");
        let parsed: Value = serde_json::from_str(joined.trim()).unwrap_or_else(|_| json!({}));
        let mode = parsed.get("mode").and_then(Value::as_str).unwrap_or("jp");
        let label = parsed
            .get("label")
            .and_then(Value::as_str)
            .unwrap_or("Japan SoftBank 家宽");
        let billing = parsed
            .get("billing")
            .and_then(Value::as_str)
            .unwrap_or("panel-native");
        return Ok((
            json!({
                "ok": true,
                "kind": "jp",
                "currentExit": label,
                "currentExitCode": mode,
                "billing": billing
            }),
            None,
        ));
    }

    Ok((json!({ "ok": true, "kind": "none" }), None))
}

pub async fn fetch_nat_exit_latency(
    node: &NatNodeConfig,
    fallback_key_path: &str,
) -> Result<Value, SshError> {
    let (stdout, _) = exec_alpine_script_timeout(
        node,
        fallback_key_path,
        "exit_latency",
        None,
        ALPINE_LATENCY_TIMEOUT_MS,
    )
    .await?;

    let mut items: Vec<Value> = Vec::new();
    for raw_line in stdout.lines() {
        let line = raw_line.trim();
        if let Some((left, right)) = line.split_once(':') {
            let label = left.trim().to_string();
            let val = right.trim().to_string();
            let code = map_exit_label_to_code(&label);
            let ms = val
                .strip_suffix("ms")
                .and_then(|s| s.trim().parse::<f64>().ok());
            items.push(json!({
                "label": label,
                "code": code,
                "reachable": ms.is_some(),
                "ms": ms,
                "rawText": val
            }));
        }
    }
    Ok(json!({ "ok": true, "items": items }))
}

pub async fn switch_nat_exit(
    node: &NatNodeConfig,
    fallback_key_path: &str,
    exit_code: &str,
) -> Result<(Value, Option<TrafficSnapshot>), SshError> {
    let code = exit_code.trim();
    if !RESIDENTIAL_EXIT_CODES.contains(&code) {
        return Err(SshError::new("VALIDATION_ERROR", format!("不支持的出口代号: {code}"), None));
    }
    exec_alpine_script_timeout(
        node,
        fallback_key_path,
        "exit_switch",
        Some(code),
        ALPINE_LATENCY_TIMEOUT_MS,
    )
    .await?;
    fetch_nat_exit_status(node, fallback_key_path).await
}

pub async fn run_nat_exit_diagnostics(
    node: &NatNodeConfig,
    fallback_key_path: &str,
) -> Result<Value, SshError> {
    let (stdout, elapsed_ms) = exec_alpine_script_timeout(
        node,
        fallback_key_path,
        "exit_diag",
        None,
        ALPINE_LONG_TIMEOUT_MS,
    )
    .await?;
    Ok(json!({
        "ok": true,
        "elapsedMs": elapsed_ms,
        "rawText": stdout
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_billing_sizes_and_exit_codes() {
        assert_eq!(parse_size_to_bytes("300.00 GB"), 322_122_547_200);
        assert_eq!(parse_size_to_bytes("10.5 MB"), 11_010_048);
        assert_eq!(map_exit_label_to_code("Korea 家宽"), "kr");
        assert_eq!(map_exit_label_to_code("Japan SoftBank"), "jp");
        assert_eq!(map_exit_label_to_code("Macau CTM 特价"), "mos");
    }
}
