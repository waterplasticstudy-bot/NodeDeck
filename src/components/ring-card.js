/**
 * Apple Activity Ring 与健康胶囊渲染公共组件（铁律 #1 & #3）
 */

import { RING_CIRCUMFERENCE } from '../constants/ui-constants.js';

export function setRing(el, pct, colorOverride = null) {
  if (!el) return;
  const clamped = Math.min(100, Math.max(0, Number(pct || 0)));
  el.style.strokeDashoffset = (RING_CIRCUMFERENCE * (1 - clamped / 100)).toFixed(2);
  if (colorOverride) el.style.stroke = colorOverride;
}

export function setHealthPill(el, text, tone) {
  if (!el) return;
  el.textContent = text;
  el.className = `pill ${tone}`;
}
