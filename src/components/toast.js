/**
 * 统一底部胶囊轻提示组件（铁律 #1）
 */

import { TOAST_DURATION_MS } from '../constants/ui-constants.js';

let hideTimer = null;

export function showToast(msg, isErr = false) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('is-error', Boolean(isErr));
  el.classList.add('show');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => el.classList.remove('show'), TOAST_DURATION_MS);
}
