//! 多账号独立 WebView2 沙箱窗口、仪表盘页面流量只读识别、可选单次订阅头查询与原生 TCP 延迟测速

use crate::config::TrafficSnapshot;
use crate::constants::{
    ACCOUNT_WINDOW_HEIGHT, ACCOUNT_WINDOW_PREFIX, ACCOUNT_WINDOW_WIDTH,
    DASHBOARD_SCRAPE_TIMEOUT_MS, PROFILES_SUBDIR, PROFILE_ID_PATTERN, SESSION_CLOSE_SETTLE_MS,
    SUBSCRIPTION_FETCH_TIMEOUT_MS, SUBSCRIPTION_USER_AGENT, TCP_PING_TIMEOUT_MS,
};
use crate::ssh_client::SshError;
use regex::Regex;
use reqwest::Client;
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex as StdMutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::net::TcpStream;
use tokio::sync::oneshot;
use tokio::time::timeout;
use url::Url;

static PROFILE_ID_RE: OnceLock<Regex> = OnceLock::new();
static DIRECT_SUB_CLIENT: OnceLock<Client> = OnceLock::new();

fn validate_profile_id(raw: &str) -> Result<String, SshError> {
    let trimmed = raw.trim();
    let re = PROFILE_ID_RE.get_or_init(|| Regex::new(PROFILE_ID_PATTERN).expect("valid profile regex"));
    if !re.is_match(trimmed) {
        return Err(SshError::new(
            "VALIDATION_ERROR",
            "隔离档标识仅支持 1-36 位字母、数字、下划线或短横线",
            None,
        ));
    }
    Ok(trimmed.to_string())
}

fn validate_http_url(raw: &str) -> Result<Url, SshError> {
    let trimmed = raw.trim();
    let parsed = Url::parse(trimmed)
        .map_err(|_| SshError::new("VALIDATION_ERROR", "网址格式无效，请以 http:// 或 https:// 开头", None))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(SshError::new(
            "VALIDATION_ERROR",
            "仅允许打开 http:// 或 https:// 网址",
            None,
        ));
    }
    Ok(parsed)
}

fn format_bytes_short(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut val = bytes as f64;
    let mut idx = 0;
    while val >= 1024.0 && idx < UNITS.len() - 1 {
        val /= 1024.0;
        idx += 1;
    }
    if val >= 100.0 {
        format!("{val:.1} {}", UNITS[idx])
    } else {
        format!("{val:.2} {}", UNITS[idx])
    }
}

fn unix_to_ymd(unix_sec: u64) -> String {
    // Civil date conversion from Unix epoch seconds (Howard Hinnant algorithm, zero external crate)
    let z = (unix_sec / 86_400) as i64 + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    format!("{year:04}-{m:02}-{d:02}")
}

#[cfg(target_os = "macos")]
fn data_store_id_for(safe_id: &str) -> [u8; 16] {
    uuid::Uuid::new_v5(
        &uuid::Uuid::NAMESPACE_URL,
        format!("nodedeck://profile/{safe_id}").as_bytes(),
    )
    .into_bytes()
}

pub fn profile_dir_for(app: &AppHandle, profile_id: &str) -> Result<PathBuf, SshError> {
    let safe_id = validate_profile_id(profile_id)?;
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|e| SshError::new("PATH_ERR", format!("无法解析应用本地数据目录: {e}"), None))?;
    Ok(base.join(PROFILES_SUBDIR).join(safe_id))
}

pub fn has_isolated_session(app: &AppHandle, profile_id: &str) -> bool {
    let Ok(dir) = profile_dir_for(app, profile_id) else {
        return false;
    };
    fs::read_dir(dir)
        .map(|mut entries| entries.next().is_some())
        .unwrap_or(false)
}

/// 打开或复用指定账号的独立 Cookie/Storage WebView2 沙箱窗口（同站多号永久不串号）
pub async fn open_isolated_window(
    app: &AppHandle,
    profile_id: &str,
    title: &str,
    url_str: &str,
) -> Result<Value, SshError> {
    let safe_id = validate_profile_id(profile_id)?;
    let parsed = validate_http_url(url_str)?;
    let label = format!("{ACCOUNT_WINDOW_PREFIX}{safe_id}");
    let profile_dir = profile_dir_for(app, &safe_id)?;

    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.set_title(title);
        let _ = existing.navigate(parsed);
        let _ = existing.show();
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        return Ok(json!({
            "ok": true,
            "reused": true,
            "label": label,
            "profileDir": profile_dir.to_string_lossy()
        }));
    }

    fs::create_dir_all(&profile_dir)
        .map_err(|e| SshError::new("IO_ERR", format!("创建账号隔离目录失败: {e}"), None))?;

    let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(parsed))
        .title(title)
        .inner_size(ACCOUNT_WINDOW_WIDTH, ACCOUNT_WINDOW_HEIGHT)
        .center()
        .resizable(true);

    #[cfg(target_os = "macos")]
    {
        let _ = fs::write(profile_dir.join(".session-active"), b"1");
        builder = builder.data_store_identifier(data_store_id_for(&safe_id));
    }
    #[cfg(not(target_os = "macos"))]
    {
        builder = builder.data_directory(profile_dir.clone());
    }

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone()).map_err(|e| {
            SshError::new("WINDOW_ERR", format!("设置子窗口图标失败: {e}"), None)
        })?;
    }

    builder
        .build()
        .map_err(|e| SshError::new("WINDOW_ERR", format!("创建隔离账号窗口失败: {e}"), None))?;

    Ok(json!({
        "ok": true,
        "reused": false,
        "label": label,
        "profileDir": profile_dir.to_string_lossy()
    }))
}

/// 关闭指定账号子窗口并彻底删除其本地 Cookie/缓存目录
pub async fn clear_isolated_session(app: &AppHandle, profile_id: &str) -> Result<Value, SshError> {
    let safe_id = validate_profile_id(profile_id)?;
    let label = format!("{ACCOUNT_WINDOW_PREFIX}{safe_id}");
    let profile_dir = profile_dir_for(app, &safe_id)?;

    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.close();
        tokio::time::sleep(Duration::from_millis(SESSION_CLOSE_SETTLE_MS)).await;
    }

    #[cfg(target_os = "macos")]
    {
        let _ = app.remove_data_store(data_store_id_for(&safe_id)).await;
    }

    if profile_dir.exists() {
        fs::remove_dir_all(&profile_dir).map_err(|e| {
            SshError::new(
                "IO_ERR",
                format!("清除沙箱目录失败（请先关闭该账号窗口后重试）: {e}"),
                None,
            )
        })?;
    }

    Ok(json!({ "ok": true, "profileId": safe_id }))
}

/// 在已打开的独立仪表盘窗口内只读识别页面渲染出的流量与到期信息（免订阅链接、零 IPC 暴露）
const DASHBOARD_TRAFFIC_SCRAPE_JS: &str = r#"(function(){
  try {
    var txt = (document.body && document.body.innerText) ? document.body.innerText : '';
    var href = String(location.href || '');
    var title = String(document.title || '');
    if (!txt || txt.trim().length < 20) {
      return JSON.stringify({ status: 'empty', href: href, title: title });
    }
    var unitMap = { b: 1, kb: 1024, kib: 1024, mb: 1048576, mib: 1048576, gb: 1073741824, gib: 1073741824, tb: 1099511627776, tib: 1099511627776 };
    function toBytes(numStr, unitStr) {
      var n = parseFloat(String(numStr || '').replace(/,/g, ''));
      var m = unitMap[String(unitStr || '').toLowerCase()] || 1;
      return isFinite(n) ? Math.round(n * m) : 0;
    }
    function fmtSize(b) {
      if (!b || b <= 0) return '0 B';
      var u = ['B','KB','MB','GB','TB'];
      var i = 0, v = b;
      while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
      return v.toFixed(v >= 100 ? 1 : 2) + ' ' + u[i];
    }
    function normDate(raw) {
      var parts = String(raw || '').replace(/[\/.]/g, '-').split('-');
      if (parts.length !== 3) return '';
      return parts[0] + '-' + parts[1].padStart(2, '0') + '-' + parts[2].padStart(2, '0');
    }
    function validQuotaRatio(ub, tb) {
      if (tb < 104857600) return false;
      if (tb >= ub) return true;
      return tb >= 1073741824 && ub <= tb * 1.15;
    }
    function hasTrafficTabButton() {
      if (typeof document === 'undefined' || !document.querySelectorAll) return false;
      var btns = document.querySelectorAll('button, a, [role="tab"]');
      for (var i = 0; i < btns.length; i++) {
        var label = (btns[i].innerText || btns[i].textContent || '').trim();
        if (/^(流量|流量统计|流量详情|Traffic)$/i.test(label)) return true;
      }
      return false;
    }

    var usedBytes = 0, totalBytes = 0, remBytes = 0;
    var usedText = '', totalText = '', remText = '';
    var expiresAt = '';
    var matchedPair = false;

    var sizeRe = /(\d[\d,]*(?:\.\d+)?)\s*(TiB|GiB|MiB|KiB|TB|GB|MB|KB|B)\b/i;
    var hwNoiseRe = /(内存|记忆体|RAM|Swap|交换|硬盘|磁盘|存储|Disk|Storage|缓存|Cache|CPU|核心|负载|Load|进程|带宽上限|峰值带宽|Mbps|Gbps)/i;
    var dirNoiseRe = /(入站|出站|上行|下行|上传|下载|Upload|Download|Inbound|Outbound|单日|日峰值|最高|峰值|Peak)/i;
    var trafficCueRe = /(本月流量|流量统计|流量使用|流量配额|套餐流量|总流量|剩余流量|已用流量|已使用|已用|流量|Traffic|Usage|Quota|Data|Plan)/i;

    // 1) 优先识别明确的「已用 / 总配额」配对（按上下文与量级评分，排除内存/磁盘/入出站等非流量对）
    var pairRe = /(\d[\d,]*(?:\.\d+)?)\s*(TiB|GiB|MiB|KiB|TB|GB|MB|KB|B)\s*\/\s*(\d[\d,]*(?:\.\d+)?)\s*(TiB|GiB|MiB|KiB|TB|GB|MB|KB|B)/gi;
    var bestPair = null;
    var pm;
    while ((pm = pairRe.exec(txt)) !== null) {
      var ub = toBytes(pm[1], pm[2]);
      var tb = toBytes(pm[3], pm[4]);
      if (!validQuotaRatio(ub, tb)) continue;

      var startIdx = pm.index;
      var beforeChunk = txt.slice(Math.max(0, startIdx - 72), startIdx);
      var lineStart = txt.lastIndexOf('\n', startIdx - 1);
      var prevLineStart = lineStart > 0 ? txt.lastIndexOf('\n', lineStart - 1) : -1;
      var lineEnd = txt.indexOf('\n', startIdx + pm[0].length);
      var localLine = txt.slice(lineStart + 1, lineEnd === -1 ? txt.length : lineEnd);
      var nearCtx = txt.slice(prevLineStart + 1, lineEnd === -1 ? txt.length : lineEnd);

      if (hwNoiseRe.test(localLine) || hwNoiseRe.test(beforeChunk.slice(-36))) continue;
      if (/(入站\s*\/\s*出站|出站\s*\/\s*入站|上行\s*\/\s*下行|上传\s*\/\s*下载|Up\s*\/\s*Down|Rx\s*\/\s*Tx)/i.test(nearCtx)) continue;

      var score = 0;
      if (trafficCueRe.test(nearCtx) || trafficCueRe.test(beforeChunk)) score += 50;
      if (tb >= 1073741824) score += 30;
      if (tb >= 10737418240) score += 15;
      if (tb >= ub) score += 20;
      else score -= 35;
      if (dirNoiseRe.test(localLine) && !trafficCueRe.test(localLine)) score -= 25;

      if (!bestPair || score > bestPair.score) {
        bestPair = {
          score: score,
          ub: ub,
          tb: tb,
          usedText: pm[1].replace(/,/g, '') + ' ' + pm[2].toUpperCase(),
          totalText: pm[3].replace(/,/g, '') + ' ' + pm[4].toUpperCase()
        };
      }
    }
    if (bestPair && bestPair.score >= 20) {
      usedBytes = bestPair.ub;
      totalBytes = bestPair.tb;
      usedText = bestPair.usedText;
      totalText = bestPair.totalText;
      matchedPair = true;
    }

    // 2) DOM 细粒度扫描：始终提取到期日期；仅在未命中明确配对时提取独立已用/剩余/总量卡片
    if (typeof document !== 'undefined' && document.querySelectorAll) {
      var els = document.querySelectorAll('div, section, li, td, article, p');
      var bestUsedLen = 999, bestRemLen = 999, bestTotalScore = -1, bestTotalLen = 999, bestExpLen = 999;
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var t = (el.innerText || '').trim();
        if (!t || t.length > 72) continue;
        if (!matchedPair && !hwNoiseRe.test(t) && !dirNoiseRe.test(t)) {
          var sm = t.match(sizeRe);
          if (sm) {
            var b = toBytes(sm[1], sm[2]);
            var cleanTxt = sm[1].replace(/,/g, '') + ' ' + sm[2].toUpperCase();
            if (/(已使用|已用流量|已用|已消耗|Used)/i.test(t) && !/(剩余|总流量|套餐流量|总额度|流量配额)/.test(t)) {
              if (t.length < bestUsedLen) { bestUsedLen = t.length; usedBytes = b; usedText = cleanTxt; }
            } else if (/(剩余流量|可用流量|剩余|Remaining)/i.test(t) && !/(已用|总流量|套餐流量|总额度)/.test(t)) {
              if (t.length < bestRemLen) { bestRemLen = t.length; remBytes = b; remText = cleanTxt; }
            } else if (/(总流量|套餐流量|总额度|流量配额|月流量)/i.test(t) && !/(已用|剩余)/.test(t)) {
              if (b >= 104857600 && (2 > bestTotalScore || (2 === bestTotalScore && t.length < bestTotalLen))) {
                bestTotalScore = 2; bestTotalLen = t.length; totalBytes = b; totalText = cleanTxt;
              }
            } else if (/(总计|Total)/i.test(t) && !/(已用|剩余)/.test(t)) {
              if (b >= 1073741824 && (1 > bestTotalScore || (1 === bestTotalScore && t.length < bestTotalLen))) {
                bestTotalScore = 1; bestTotalLen = t.length; totalBytes = b; totalText = cleanTxt;
              }
            }
          }
        }
        if (/(到期时间|到期日期|过期时间|有效期至|Expires?)/i.test(t)) {
          var dm = t.match(/(20\d{2}[-\/.]\d{1,2}[-\/.]\d{1,2})/);
          if (dm && t.length < bestExpLen) { bestExpLen = t.length; expiresAt = normDate(dm[1]); }
        }
      }
      if (!matchedPair && totalBytes > 0 && usedBytes > 0 && !validQuotaRatio(usedBytes, totalBytes)) {
        totalBytes = 0; totalText = '';
      }
    }

    // 3) 纯文本兜底（仅在未命中明确配对时启用）
    if (!matchedPair) {
      if (!usedBytes) {
        var u1 = txt.match(/(?:已使用|已用流量|已用|已消耗|Used)[\s:：]{0,12}(\d[\d,]*(?:\.\d+)?)\s*(TiB|GiB|MiB|KiB|TB|GB|MB|KB|B)\b/i)
          || txt.match(/(\d[\d,]*(?:\.\d+)?)\s*(TiB|GiB|MiB|KiB|TB|GB|MB|KB|B)\s*[\r\n\s]{1,6}(?:已使用|已用流量|已用|Used)/i);
        if (u1) { usedBytes = toBytes(u1[1], u1[2]); usedText = u1[1].replace(/,/g, '') + ' ' + u1[2].toUpperCase(); }
      }
      if (!remBytes) {
        var r1 = txt.match(/(?:剩余流量|可用流量|剩余|Remaining)[\s:：]{0,12}(\d[\d,]*(?:\.\d+)?)\s*(TiB|GiB|MiB|KiB|TB|GB|MB|KB|B)\b/i)
          || txt.match(/(\d[\d,]*(?:\.\d+)?)\s*(TiB|GiB|MiB|KiB|TB|GB|MB|KB|B)\s*[\r\n\s]{1,6}(?:剩余流量|可用流量|Remaining)/i);
        if (r1) { remBytes = toBytes(r1[1], r1[2]); remText = r1[1].replace(/,/g, '') + ' ' + r1[2].toUpperCase(); }
      }
      if (!totalBytes) {
        var t1 = txt.match(/(?:总流量|套餐流量|总额度|流量配额|月流量)[\s:：]{0,12}(\d[\d,]*(?:\.\d+)?)\s*(TiB|GiB|MiB|KiB|TB|GB|MB|KB|B)\b/i)
          || txt.match(/(\d[\d,]*(?:\.\d+)?)\s*(TiB|GiB|MiB|KiB|TB|GB|MB|KB|B)\s*[\r\n\s]{1,6}(?:总流量|套餐流量|总额度|流量配额)/i);
        if (t1) {
          var candT = toBytes(t1[1], t1[2]);
          if (validQuotaRatio(usedBytes, candT)) {
            totalBytes = candT; totalText = t1[1].replace(/,/g, '') + ' ' + t1[2].toUpperCase();
          }
        }
      }

      if (!totalBytes && remBytes > 0) {
        var allSizeRe = /(\d[\d,]*(?:\.\d+)?)\s*(TiB|GiB|MiB|TB|GB|MB)\b/gi;
        var bestCand = 0, bestCandTxt = '';
        var am;
        while ((am = allSizeRe.exec(txt)) !== null) {
          var cb = toBytes(am[1], am[2]);
          if (cb >= remBytes && cb > remBytes * 1.0001 && (bestCand === 0 || cb < bestCand)) {
            bestCand = cb;
            bestCandTxt = am[1].replace(/,/g, '') + ' ' + am[2].toUpperCase();
          }
        }
        if (bestCand > 0) {
          totalBytes = bestCand;
          totalText = bestCandTxt;
        }
      }

      if (totalBytes > 0 && !usedBytes && remBytes > 0 && totalBytes >= remBytes) {
        usedBytes = Math.max(0, totalBytes - remBytes);
        usedText = fmtSize(usedBytes);
      } else if (!totalBytes && usedBytes > 0 && remBytes > 0) {
        totalBytes = usedBytes + remBytes;
        totalText = fmtSize(totalBytes);
      } else if (!totalBytes && remBytes > 0) {
        totalBytes = remBytes;
        totalText = remText;
        usedBytes = 0;
        usedText = '0 B';
      }

      if (totalBytes > 0 && usedBytes > 0 && !validQuotaRatio(usedBytes, totalBytes)) {
        totalBytes = 0; totalText = '';
      }
    }

    if (!totalBytes) {
      var looksLogin = /\/login|sign\s*in|立即登录|账号登录|just a moment|verify you are human|人机验证/i.test(txt + ' ' + href + ' ' + title);
      return JSON.stringify({
        status: looksLogin ? 'need_login' : 'not_found',
        hasTrafficTab: !looksLogin && hasTrafficTabButton(),
        href: href,
        title: title
      });
    }

    if (!expiresAt) {
      var expM = txt.match(/(?:到期时间|到期日期|过期时间|有效期至|将于|Expires?)[\s\S]{0,40}?(20\d{2}[-\/.]\d{1,2}[-\/.]\d{1,2})/i);
      if (expM) expiresAt = normDate(expM[1]);
    }

    var cycleText = '';
    var cycM = txt.match(/(\d{2}-\d{2}\s*[~→-]\s*\d{2}-\d{2}|20\d{2}-\d{2}-\d{2}\s*[~→]\s*20\d{2}-\d{2}-\d{2}|每月\s*\d+\s*号重置[^\n]{0,8}|下次流量重置[^\n]{0,24}|下次重置时间[\s\r\n]{1,12}\d+\s*天)/);
    if (cycM) cycleText = cycM[1].replace(/[\r\n]+/g, ' ').trim();

    var pct = totalBytes > 0 ? Math.min(100, Math.round((usedBytes * 1000.0) / totalBytes) / 10.0) : 0;
    return JSON.stringify({
      status: 'ok',
      usedBytes: usedBytes,
      totalBytes: totalBytes,
      usedText: usedText || fmtSize(usedBytes),
      totalText: totalText || fmtSize(totalBytes),
      percent: pct,
      expiresAt: expiresAt,
      cycleText: cycleText,
      href: href
    });
  } catch (e) {
    return JSON.stringify({ status: 'error', message: String(e) });
  }
})()"#;

/// 当详情页默认停在「信息」等非流量标签时，仅精确点击只读「流量」标签（绝不误触任何操作按钮）
const AUTO_SWITCH_TRAFFIC_TAB_JS: &str = r#"(function(){
  try {
    var btns = document.querySelectorAll('button, a, [role="tab"]');
    for (var i = 0; i < btns.length; i++) {
      var el = btns[i];
      var label = (el.innerText || el.textContent || '').trim();
      if (/^(流量|流量统计|流量详情|Traffic)$/i.test(label)) {
        el.click();
        return 'clicked';
      }
    }
    return 'none';
  } catch (e) {
    return 'err';
  }
})()"#;

pub enum ScrapeOutcome {
    NeedsWindowReady(String),
    Captured(TrafficSnapshot),
}

async fn eval_scrape_once(win: &tauri::WebviewWindow) -> Result<Value, SshError> {
    let (tx, rx) = oneshot::channel::<String>();
    let tx_slot = Arc::new(StdMutex::new(Some(tx)));
    let tx_clone = Arc::clone(&tx_slot);

    win.eval_with_callback(DASHBOARD_TRAFFIC_SCRAPE_JS, move |res| {
        if let Ok(mut guard) = tx_clone.lock() {
            if let Some(sender) = guard.take() {
                let _ = sender.send(res);
            }
        }
    })
    .map_err(|e| SshError::new("SCRAPE_ERR", format!("执行仪表盘页面识别失败: {e}"), None))?;

    let raw = timeout(Duration::from_millis(DASHBOARD_SCRAPE_TIMEOUT_MS), rx)
        .await
        .map_err(|_| {
            SshError::new(
                "SCRAPE_TIMEOUT",
                "仪表盘页面响应超时，请确认独立窗口已加载完成后再试",
                None,
            )
        })?
        .map_err(|_| SshError::new("SCRAPE_ERR", "仪表盘识别通道中断", None))?;

    let parsed: Value = match serde_json::from_str::<Value>(&raw) {
        Ok(Value::String(inner)) => serde_json::from_str::<Value>(&inner).unwrap_or(Value::Null),
        Ok(v) => v,
        Err(_) => Value::Null,
    };
    Ok(parsed)
}

pub async fn scrape_window_traffic(
    app: &AppHandle,
    profile_id: &str,
    title: &str,
    url_str: &str,
) -> Result<ScrapeOutcome, SshError> {
    let safe_id = validate_profile_id(profile_id)?;
    let label = format!("{ACCOUNT_WINDOW_PREFIX}{safe_id}");

    let Some(win) = app.get_webview_window(&label) else {
        if !url_str.trim().is_empty() {
            open_isolated_window(app, &safe_id, title, url_str).await?;
        }
        return Ok(ScrapeOutcome::NeedsWindowReady(
            "已为你打开独立仪表盘窗口，请确认已登录并停留在显示流量的页面，再点一次「识别流量」".to_string(),
        ));
    };

    let _ = win.show();
    let _ = win.unminimize();

    let mut parsed = eval_scrape_once(&win).await?;

    // 若当前停留在实例「信息」等标签页且页面存在只读「流量」标签，自动切换并等待渲染后重抓
    if parsed.get("status").and_then(Value::as_str) == Some("not_found")
        && parsed.get("hasTrafficTab").and_then(Value::as_bool) == Some(true)
    {
        let _ = win.eval(AUTO_SWITCH_TRAFFIC_TAB_JS);
        for wait_ms in [900u64, 1100u64] {
            tokio::time::sleep(Duration::from_millis(wait_ms)).await;
            parsed = eval_scrape_once(&win).await?;
            if parsed.get("status").and_then(Value::as_str) == Some("ok") {
                break;
            }
        }
    }

    let status = parsed.get("status").and_then(Value::as_str).unwrap_or("error");
    match status {
        "ok" => {
            let now_label = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs().to_string())
                .unwrap_or_default();
            Ok(ScrapeOutcome::Captured(TrafficSnapshot {
                used_bytes: parsed.get("usedBytes").and_then(Value::as_u64).unwrap_or(0),
                total_bytes: parsed.get("totalBytes").and_then(Value::as_u64).unwrap_or(0),
                used_text: parsed.get("usedText").and_then(Value::as_str).unwrap_or("").to_string(),
                total_text: parsed.get("totalText").and_then(Value::as_str).unwrap_or("").to_string(),
                percent: parsed.get("percent").and_then(Value::as_f64).unwrap_or(0.0),
                cycle_text: parsed.get("cycleText").and_then(Value::as_str).unwrap_or("").to_string(),
                expires_at: parsed.get("expiresAt").and_then(Value::as_str).unwrap_or("").to_string(),
                synced_at: now_label,
                source: "dashboard".to_string(),
            }))
        }
        "need_login" => {
            let _ = win.set_focus();
            Ok(ScrapeOutcome::NeedsWindowReady(
                "检测到独立窗口仍停留在登录或验证页，请先完成登录进入仪表盘/流量页后，再点一次「识别流量」".to_string(),
            ))
        }
        "not_found" => {
            let _ = win.set_focus();
            Ok(ScrapeOutcome::NeedsWindowReady(
                "当前页面未检测到流量数值，请切换至显示已用/剩余流量的页面后再点一次「识别流量」".to_string(),
            ))
        }
        _ => {
            let msg = parsed
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("未能读取仪表盘页面内容");
            Err(SshError::new("SCRAPE_ERR", msg, None))
        }
    }
}

/// 可选手动单次查询标准 subscription-userinfo 响应头（仅读响应头不落盘节点内容，绝不后台轮询）
pub async fn fetch_subscription_snapshot(
    sub_url: &str,
    proxy_url: Option<&str>,
) -> Result<(TrafficSnapshot, bool), SshError> {
    let parsed = validate_http_url(sub_url)?;
    let client = if let Some(p) = proxy_url {
        let proxy = reqwest::Proxy::all(p)
            .map_err(|e| SshError::new("HTTP_ERR", format!("初始化本机代理失败: {e}"), None))?;
        Client::builder()
            .user_agent(SUBSCRIPTION_USER_AGENT)
            .timeout(Duration::from_millis(SUBSCRIPTION_FETCH_TIMEOUT_MS))
            .proxy(proxy)
            .build()
            .map_err(|e| SshError::new("HTTP_ERR", format!("初始化请求失败: {e}"), None))?
    } else {
        DIRECT_SUB_CLIENT
            .get_or_init(|| {
                Client::builder()
                    .user_agent(SUBSCRIPTION_USER_AGENT)
                    .timeout(Duration::from_millis(SUBSCRIPTION_FETCH_TIMEOUT_MS))
                    .build()
                    .expect("build shared subscription http client")
            })
            .clone()
    };

    let resp = client
        .get(parsed)
        .send()
        .await
        .map_err(|e| SshError::new("SUB_ERR", format!("拉取订阅头失败: {e}"), None))?;

    if !resp.status().is_success() {
        return Err(SshError::new(
            "SUB_ERR",
            format!("订阅接口返回 HTTP {}", resp.status().as_u16()),
            None,
        ));
    }

    let header_val = resp
        .headers()
        .get("subscription-userinfo")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    drop(resp);

    let Some(raw) = header_val else {
        return Err(SshError::new(
            "NO_HEADER",
            "该订阅地址未返回标准 subscription-userinfo 响应头，建议改用「识别流量」",
            None,
        ));
    };

    let mut upload: u64 = 0;
    let mut download: u64 = 0;
    let mut total: u64 = 0;
    let mut expire: Option<u64> = None;

    for part in raw.split(';') {
        if let Some((k, v)) = part.trim().split_once('=') {
            let key = k.trim().to_ascii_lowercase();
            if let Ok(num) = v.trim().parse::<u64>() {
                match key.as_str() {
                    "upload" => upload = num,
                    "download" => download = num,
                    "total" => total = num,
                    "expire" if num > 0 => expire = Some(num),
                    _ => {}
                }
            }
        }
    }

    let used = upload.saturating_add(download);
    let pct = if total > 0 {
        ((used as f64 * 100.0 / total as f64) * 10.0).round() / 10.0
    } else {
        0.0
    };
    let now_ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_default();

    Ok((
        TrafficSnapshot {
            used_bytes: used,
            total_bytes: total,
            used_text: format_bytes_short(used),
            total_text: format_bytes_short(total),
            percent: pct.min(100.0),
            cycle_text: String::new(),
            expires_at: expire.map(unix_to_ymd).unwrap_or_default(),
            synced_at: now_ts,
            source: "subscription".to_string(),
        },
        proxy_url.is_some(),
    ))
}

/// 原生异步 TCP 握手测速
pub async fn tcp_ping(host: &str, port: u16) -> Result<Value, SshError> {
    let trimmed = host.trim();
    if trimmed.is_empty() || port == 0 {
        return Err(SshError::new(
            "VALIDATION_ERROR",
            "请先点「编辑」补全公网 IP 与映射端口后再测速",
            None,
        ));
    }
    let started = Instant::now();
    let res = timeout(
        Duration::from_millis(TCP_PING_TIMEOUT_MS),
        TcpStream::connect((trimmed, port)),
    )
    .await;
    let elapsed_ms = (started.elapsed().as_secs_f64() * 1000.0 * 10.0).round() / 10.0;
    let ms = if elapsed_ms < 0.1 { 0.1 } else { elapsed_ms };

    match res {
        Ok(Ok(_stream)) => Ok(json!({
            "ok": true,
            "reachable": true,
            "host": trimmed,
            "port": port,
            "ms": ms
        })),
        Ok(Err(e)) => Ok(json!({
            "ok": true,
            "reachable": false,
            "host": trimmed,
            "port": port,
            "ms": ms,
            "error": format!("连接失败: {e}")
        })),
        Err(_) => Ok(json!({
            "ok": true,
            "reachable": false,
            "host": trimmed,
            "port": port,
            "ms": ms,
            "error": "TCP 连接超时"
        })),
    }
}
