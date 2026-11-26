/**
 * 纯离线节点二维码弹窗组件（零外网请求，直接展示可扫码的高对比度 SVG）
 */

import { copyToClipboard } from '../utils/bridge.js';
import { renderQrSvg } from '../utils/qrcode.js';
import { closeModal, openModal } from './modal.js';
import { showToast } from './toast.js';

const $ = (id) => document.getElementById(id);
let activeQrLink = '';

export function openQrModal({ title = '节点二维码', subtitle = '', link = '' }) {
  if (!link) {
    showToast('当前节点分享链接为空，无法生成二维码', true);
    return;
  }
  activeQrLink = link;
  $('qrModalTitle').textContent = title;
  $('qrModalSub').textContent = subtitle || '纯本机离线渲染，零网络上传 · 支持 Shadowrocket / v2rayNG / 蓝猫扫码';
  $('qrModalLink').textContent = link;
  try {
    $('qrSvgBox').innerHTML = renderQrSvg(link, 236);
  } catch (err) {
    $('qrSvgBox').innerHTML = `<div class="notice-box">${err.message}</div>`;
  }
  openModal('qrCodeModal');
}

export function initQrModalEvents() {
  $('closeQrModalBtn')?.addEventListener('click', () => closeModal('qrCodeModal'));
  $('copyQrLinkBtn')?.addEventListener('click', async () => {
    if (!activeQrLink) return;
    try {
      await copyToClipboard(activeQrLink);
      showToast('已复制节点分享链接');
    } catch (err) {
      showToast(err.message, true);
    }
  });
}
