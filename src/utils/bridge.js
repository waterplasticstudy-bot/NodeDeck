/**
 * Tauri v2 原生通信桥与 Demo Mode 透明分流封装（所有后端调用、主题同步、外链与剪贴板唯一入口）
 */

import { DEMO_STORAGE_KEY, TRAY_REFRESH_EVENT } from '../constants/ui-constants.js';
import { demoInvoke } from './demo-mock.js';

let demoUrlForced = false;
try {
  demoUrlForced = new URLSearchParams(window.location.search).get('demo') === '1';
} catch {
  demoUrlForced = false;
}

function getTauriCore() {
  return window.__TAURI__?.core || null;
}

export function isDemoMode() {
  if (demoUrlForced) return true;
  if (localStorage.getItem(DEMO_STORAGE_KEY) === '1') return true;
  return !getTauriCore()?.invoke;
}

export function setDemoMode(enabled) {
  demoUrlForced = false;
  localStorage.setItem(DEMO_STORAGE_KEY, enabled ? '1' : '0');
}

/** 统一调用 Rust #[tauri::command]，演示模式下透明路由至内存模拟器 */
export async function invokeCmd(cmd, args = {}) {
  if (isDemoMode()) {
    return demoInvoke(cmd, args);
  }
  const core = getTauriCore();
  if (!core?.invoke) {
    throw Object.assign(new Error('当前未在 NodeDeck 原生桌面环境中运行'), { code: 'NO_TAURI_RUNTIME' });
  }
  try {
    return await core.invoke(cmd, args);
  } catch (raw) {
    if (raw && typeof raw === 'object') {
      const err = new Error(raw.error || raw.message || JSON.stringify(raw));
      err.code = raw.code || 'INVOKE_ERROR';
      err.raw = raw.raw;
      throw err;
    }
    throw Object.assign(new Error(String(raw || '未知桌面调用错误')), { code: 'INVOKE_ERROR' });
  }
}

/** 同步浅/深色主题至 Windows 原生标题栏 */
export async function syncNativeTheme(theme) {
  if (!getTauriCore()?.invoke) return;
  try {
    await getTauriCore().invoke('set_window_theme', { theme });
  } catch {
    // 非桌面环境或旧版系统静默忽略
  }
}

/** 调用系统默认浏览器安全打开外部网址 */
export async function openExternal(url) {
  if (!url) return;
  if (!getTauriCore()?.invoke) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  try {
    await getTauriCore().invoke('open_external_url', { url });
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

/** 监听托盘菜单触发的全局刷新事件 */
export async function onTrayRefresh(callback) {
  const listen = window.__TAURI__?.event?.listen;
  if (typeof listen === 'function') {
    await listen(TRAY_REFRESH_EVENT, () => callback());
  }
}

/** 可靠复制到系统剪贴板（绝不使用原生 prompt() 降级） */
export async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(ta);
  if (!ok) throw new Error('系统剪贴板写入受限，请手动选中复制');
}

/** 统一异步按钮加载态锁定，防止重复点击 */
export async function withButtonLoading(btn, task) {
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  btn.classList.add('is-loading');
  try {
    return await task();
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-loading');
  }
}
