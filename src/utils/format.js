/**
 * 纯函数格式化、账单折算、到期计算、多协议分享链接与安全转义公共工具
 */

import {
  ACCENT_COLOR_MAP,
  BILLING_CYCLE_LABELS,
  BILLING_MONTHLY_DIVISOR,
  COUNTRY_FLAGS,
  DEFAULT_DIALER_PROXY,
  DEFAULT_SNI,
  HEALTH_THRESHOLDS,
  HOST_TAG_RULES,
  PORT_ANNOTATIONS,
} from '../constants/ui-constants.js';

export function fmtBytes(bytes) {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let idx = 0;
  let val = Number(bytes);
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx += 1;
  }
  return `${val.toFixed(val >= 100 ? 0 : val >= 10 ? 1 : 2)} ${units[idx]}`;
}

export function fmtMbpsNum(bps) {
  return (Number(bps || 0) * 8) / 1e6;
}

export function fmtMbps(bps) {
  const val = fmtMbpsNum(bps);
  return `${val.toFixed(val >= 10 ? 1 : 2)} Mbps`;
}

/** 统一格式化毫秒延迟（<1 ms 避免显示 0 ms） */
export function fmtPingMs(ms) {
  const val = Number(ms || 0);
  if (val < 1) return '<1 ms';
  return `${val >= 10 ? Math.round(val) : val.toFixed(1)} ms`;
}

export function fmtUptime(sec) {
  const total = Math.max(0, Number(sec || 0));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const mins = Math.floor((total % 3600) / 60);
  return days > 0 ? `${days}天 ${hours}小时` : `${hours}小时 ${mins}分`;
}

export function nowTimeStr() {
  return new Date().toTimeString().slice(0, 8);
}

export function esc(val) {
  return String(val ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

export function countSubnets24(ips) {
  const set = new Set((ips || []).map((ip) => {
    const parts = String(ip).split('.');
    return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}` : ip;
  }));
  return set.size;
}

export function annotatePort(ruleLine) {
  const match = String(ruleLine).match(/^(\d+\/\w+)/);
  const port = match ? match[1] : String(ruleLine);
  const hit = PORT_ANNOTATIONS.find((item) => port.startsWith(item.prefix));
  return hit ? { port, desc: hit.desc, tone: hit.tone } : { port, desc: '自定义放行', tone: 'orange' };
}

export function annotateHost(host, port) {
  if (String(port) === '22') return { label: '本机面板 SSH', cls: 'gray' };
  const hit = HOST_TAG_RULES.find((rule) => rule.regex.test(String(host || '')));
  return hit ? { label: hit.label, cls: hit.cls } : null;
}

export function describeSingboxRule(rule) {
  if (rule.action === 'sniff') {
    return { title: '协议流量嗅探 (sniff)', desc: '自动识别 HTTPS/QUIC 域名供后续规则匹配', tone: 'blue' };
  }
  if (rule.protocol === 'quic') {
    return { title: '禁用 QUIC 协议 (reject)', desc: '强制回退 TCP 443，防止 UDP 断流与泄露', tone: 'green' };
  }
  if (rule.network === 'udp' && Array.isArray(rule.port) && rule.port.includes(443)) {
    return { title: '拦截 UDP 443 (reject)', desc: '双重禁用 HTTP/3 QUIC', tone: 'green' };
  }
  if (Array.isArray(rule.domain_suffix) && rule.domain_suffix.includes('locationhistory-pa.googleapis.com')) {
    return { title: '防定位泄露拦截 (reject)', desc: `屏蔽 ${rule.domain_suffix.length} 个 Google 位置历史上报域名`, tone: 'green' };
  }
  if (Array.isArray(rule.auth_user)) {
    return { title: `成员归属标记 · ${rule.auth_user.join(', ')}`, desc: `命中后走 ${rule.outbound || 'direct'}，供防外泄审计分人统计`, tone: 'purple' };
  }
  return { title: JSON.stringify(rule), desc: '自定义规则', tone: 'gray' };
}

export function countryFlag(countryCode) {
  return COUNTRY_FLAGS[String(countryCode || '').toUpperCase()] || '🌐';
}

/** 加密安全随机凭据生成（供弹窗一键生成密码 / UUID / SS-2022 密钥） */
export function randomHex(len = 24) {
  const bytes = new Uint8Array(Math.ceil(len / 2));
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, len);
}

export function randomSs2022Key() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export function randomUuidV4() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** UTF-8 安全 Base64 编码（兼容中文用户名，绝不触发 btoa InvalidCharacterError） */
function toBase64Utf8(str) {
  const bytes = new TextEncoder().encode(String(str ?? ''));
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

/** 无填充 UTF-8 Base64（避免尾部 '=' 被部分 URL 解析器转义成 %3D 污染密码） */
function toBase64RawUtf8(str) {
  return toBase64Utf8(str).replace(/=+$/, '');
}

/** RFC 4648 URL 安全无填充 Base64（兼容 Mihomo/SIP002 的 ss:// RawURLEncoding） */
function toBase64UrlUtf8(str) {
  return toBase64RawUtf8(str).replace(/\+/g, '-').replace(/\//g, '_');
}

/** 构造清晰不重复的节点备注名 */
function buildNodeRemark(nodeName, tag, userName) {
  const base = String(nodeName || tag || 'node').trim();
  const uname = String(userName || '').trim();
  if (!uname || base === uname || base.endsWith(uname)) return base;
  return `${base}-${uname}`;
}

/** 统一构造多协议标准节点分享链接（严格对齐 Mihomo、v2rayN、Shadowrocket 解析规则） */
export function buildStandardNodeLink(inb, host, publicKey = '', nodeName = '', user = null) {
  const type = String(inb.type || '').toLowerCase();
  const port = inb.listenPort || 0;
  const u = user || (Array.isArray(inb.usersDetail) && inb.usersDetail[0]) || {};
  const rawUser = u.username || u.name || '';
  const rawPass = u.password || inb.password || '';
  const remark = buildNodeRemark(nodeName, inb.tag, u.name || u.username);
  const hash = encodeURIComponent(remark);

  if (type === 'vless') {
    const uid = u.uuid || '';
    const q = new URLSearchParams({
      encryption: 'none',
      flow: u.flow || 'xtls-rprx-vision',
      security: 'reality',
      sni: inb.sni || DEFAULT_SNI,
      fp: 'chrome',
      pbk: publicKey || '',
      sid: inb.shortId || '',
      type: 'tcp',
    });
    return `vless://${uid}@${host}:${port}?${q.toString()}#${hash}`;
  }
  if (type === 'shadowsocks') {
    const method = inb.method || '2022-blake3-aes-128-gcm';
    const cred = toBase64UrlUtf8(`${method}:${rawPass}`);
    return `ss://${cred}@${host}:${port}#${hash}`;
  }
  if (type === 'socks' || type === 'mixed') {
    if (!rawUser && !rawPass) {
      return `socks://${host}:${port}#${hash}`;
    }
    const b64 = toBase64RawUtf8(`${rawUser}:${rawPass}`);
    return `socks://${b64}@${host}:${port}#${hash}`;
  }
  if (type === 'http') {
    if (!rawUser && !rawPass) {
      return `http://${host}:${port}#${hash}`;
    }
    const b64 = toBase64RawUtf8(`${rawUser}:${rawPass}`);
    return `http://${b64}@${host}:${port}#${hash}`;
  }
  return `${host}:${port}`;
}

/** 一键构造 Mihomo / Clash 链式落地节点 YAML 片段（自带 dialer-proxy） */
export function buildMihomoYaml(
  inb,
  host,
  publicKey = '',
  nodeName = '',
  user = null,
  dialerProxy = DEFAULT_DIALER_PROXY,
) {
  const type = String(inb.type || '').toLowerCase();
  const port = inb.listenPort || 0;
  const u = user || (Array.isArray(inb.usersDetail) && inb.usersDetail[0]) || {};
  const displayName = buildNodeRemark(nodeName, inb.tag, u.name || u.username);
  const q = (s) => JSON.stringify(String(s ?? ''));

  if (type === 'vless') {
    return [
      `- name: ${q(displayName)}`,
      '  type: vless',
      `  server: ${q(host)}`,
      `  port: ${port}`,
      `  uuid: ${q(u.uuid || '')}`,
      '  network: tcp',
      '  tls: true',
      '  udp: true',
      `  flow: ${q(u.flow || 'xtls-rprx-vision')}`,
      `  servername: ${q(inb.sni || DEFAULT_SNI)}`,
      '  client-fingerprint: chrome',
      '  reality-opts:',
      `    public-key: ${q(publicKey || '')}`,
      `    short-id: ${q(inb.shortId || '')}`,
      `  dialer-proxy: ${q(dialerProxy)}`,
    ].join('\n');
  }
  if (type === 'shadowsocks') {
    return [
      `- name: ${q(displayName)}`,
      '  type: ss',
      `  server: ${q(host)}`,
      `  port: ${port}`,
      `  cipher: ${q(inb.method || '2022-blake3-aes-128-gcm')}`,
      `  password: ${q(u.password || inb.password || '')}`,
      '  udp: true',
      `  dialer-proxy: ${q(dialerProxy)}`,
    ].join('\n');
  }
  if (type === 'socks' || type === 'mixed') {
    return [
      `- name: ${q(displayName)}`,
      '  type: socks5',
      `  server: ${q(host)}`,
      `  port: ${port}`,
      `  username: ${q(u.username || u.name || '')}`,
      `  password: ${q(u.password || '')}`,
      '  udp: true',
      `  dialer-proxy: ${q(dialerProxy)}`,
    ].join('\n');
  }
  return [
    `- name: ${q(displayName)}`,
    '  type: http',
    `  server: ${q(host)}`,
    `  port: ${port}`,
    `  username: ${q(u.username || u.name || '')}`,
    `  password: ${q(u.password || '')}`,
    `  dialer-proxy: ${q(dialerProxy)}`,
  ].join('\n');
}

export function fmtSyncedTime(unixSecStr) {
  const sec = Number(unixSecStr || 0);
  if (!sec) return '';
  const d = new Date(sec * 1000);
  if (Number.isNaN(d.getTime())) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${mi}`;
}

/** 将周期价格折算为月均金额（按量/不限时返回 0） */
export function calcMonthlyCost(priceCny, billingCycle) {
  const price = Number(priceCny || 0);
  const div = BILLING_MONTHLY_DIVISOR[billingCycle] ?? 1;
  if (!price || price <= 0 || div <= 0) return 0;
  return price / div;
}

export function billingCycleLabel(cycle) {
  return BILLING_CYCLE_LABELS[cycle] || '月付';
}

export function accentColorVar(key) {
  return ACCENT_COLOR_MAP[key] || 'var(--blue)';
}

/** 计算距离到期日 YYYY-MM-DD 的剩余天数（无日期返回 null） */
export function daysUntilExpiry(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}/.test(String(dateStr).trim())) return null;
  const target = new Date(`${String(dateStr).trim().slice(0, 10)}T23:59:59`);
  if (Number.isNaN(target.getTime())) return null;
  const diffMs = target.getTime() - Date.now();
  return Math.ceil(diffMs / 86400000);
}

/** 生成统一到期状态徽标元数据 */
export function getExpiryMeta(dateStr, autoRenew = false) {
  const days = daysUntilExpiry(dateStr);
  if (days === null) {
    return { days: null, text: '未设到期日', tone: 'gray', urgent: false, cardClass: '' };
  }
  if (days < 0) {
    return { days, text: `已过期 ${Math.abs(days)} 天`, tone: 'red', urgent: true, cardClass: 'danger' };
  }
  if (days <= HEALTH_THRESHOLDS.expiryDangerDays) {
    return {
      days,
      text: `${days} 天后到期${autoRenew ? ' · 自动续费' : ''}`,
      tone: 'red',
      urgent: true,
      cardClass: 'danger',
    };
  }
  if (days <= HEALTH_THRESHOLDS.expiryWarnDays) {
    return {
      days,
      text: `${days} 天后到期${autoRenew ? ' · 自动续费' : ''}`,
      tone: 'orange',
      urgent: true,
      cardClass: 'warn',
    };
  }
  return {
    days,
    text: `剩 ${days} 天${autoRenew ? ' · 自动续费' : ''}`,
    tone: 'green',
    urgent: false,
    cardClass: '',
  };
}
