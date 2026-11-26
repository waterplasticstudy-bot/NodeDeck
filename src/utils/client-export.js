/**
 * 纯本地离线客户端配置生成器（零个人硬编码、零在线托管、支持单节点或多节点组合打包）
 * 支持两种离线生成形态：
 *   1. all_platform_yaml -> 全平台单文件离线配置 (.yaml)（Win10/11 · iOS 蓝猫/Stash · 鸿蒙 4/7 通用，含 iOS 50MB 防崩护栏）
 *   2. bettbox_js        -> Bettbox / Clash Verge Rev 万能通用覆写脚本 v4.3 (.js)（Win10/11 · 鸿蒙 4/7 · 安卓通用）
 */

import { DEFAULT_DIALER_PROXY, DEFAULT_SNI } from '../constants/ui-constants.js';

const MRS_MIRROR = 'https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo';
export const DEFAULT_TEST_URL = 'https://www.gstatic.com/generate_204';

// 精准匹配 >1.0x 高倍率节点（兼容 Go RE2 与 JS 正则）：
// - 精准命中：1.05x / 1.2x / 1.5x / 1.8x / 2x / 2.5x / 3x / 8x / 10x / 2倍 / 3倍率 / ×2 / x3 / 倍率:2.5
// - 严格放行：0.01x / 0.1倍率 / 0.5x / 0.9x 神秘优化 / 1x / 1.0x / 1倍 / 带任意 emoji 图标 / x86 / x64 / v6 / 香港1
export const HIGH_MULT_RE2 = '(?:^|[^0-9.])(?:1\\.(?:[1-9]\\d*|0+[1-9]\\d*)|(?:[2-9]|[1-9]\\d)(?:\\.\\d+)?)\\s*(?:x|×|倍)|(?:倍率\\s*[:：=]?\\s*|×\\s*|(?:^|[^a-zA-Z0-9.])x)(?:1\\.(?:[1-9]\\d*|0+[1-9]\\d*)|(?:[2-9]|1\\d|20)(?:\\.\\d+)?)(?:$|[^a-zA-Z0-9.])';
const APAC_FILTER_RE2 = '(?i)香港|台湾|日本|东京|大阪|新加坡|韩国|澳门|Hong\\s*Kong|Taiwan|Japan|Tokyo|Osaka|Singapore|Korea|Macau|HK|TW|JP|SG|KR|MO';

/** 标准化地区词典（全量严格 Go RE2 + JS 双引擎兼容，零前瞻/后顾断言） */
export const EXPORT_REGIONS = [
  { code: 'US', flag: '🇺🇸', label: '美国', re2: '美国|美西|美东|洛杉矶|硅谷|圣何塞|西雅图|纽约|芝加哥|达拉斯|凤凰城|华盛顿|旧金山|United\\s*States|Los\\s*Angeles|San\\s*Jose|Seattle|Silicon|New\\s*York|Dallas|Chicago|Phoenix|San\\s*Francisco|(?:^|[^a-zA-Z])(?:US|USA)(?:$|[^a-zA-Z])|🇺🇸' },
  { code: 'JP', flag: '🇯🇵', label: '日本', re2: '日本|东京|大阪|埼玉|福冈|Japan|Tokyo|Osaka|(?:^|[^a-zA-Z])JP(?:$|[^a-zA-Z])|🇯🇵' },
  { code: 'KR', flag: '🇰🇷', label: '韩国', re2: '韩国|首尔|釜山|春川|Korea|Seoul|(?:^|[^a-zA-Z])KR(?:$|[^a-zA-Z])|🇰🇷' },
  { code: 'SG', flag: '🇸🇬', label: '新加坡', re2: '新加坡|狮城|Singapore|(?:^|[^a-zA-Z])SG(?:$|[^a-zA-Z])|🇸🇬' },
  { code: 'HK', flag: '🇭🇰', label: '香港', re2: '香港|Hong\\s*Kong|(?:^|[^a-zA-Z])HK(?:$|[^a-zA-Z])|🇭🇰' },
  { code: 'TW', flag: '🇹🇼', label: '台湾', re2: '台湾|台北|新北|彰化|Taiwan|Taipei|(?:^|[^a-zA-Z])TW(?:$|[^a-zA-Z])|🇹🇼' },
  { code: 'GB', flag: '🇬🇧', label: '英国', re2: '英国|伦敦|United\\s*Kingdom|Britain|London|(?:^|[^a-zA-Z])(?:UK|GB)(?:$|[^a-zA-Z])|🇬🇧' },
  { code: 'DE', flag: '🇩🇪', label: '德国', re2: '德国|法兰克福|Germany|Frankfurt|(?:^|[^a-zA-Z])DE(?:$|[^a-zA-Z])|🇩🇪' },
  { code: 'AU', flag: '🇦🇺', label: '澳洲', re2: '澳大利亚|澳洲|悉尼|墨尔本|Australia|Sydney|Melbourne|(?:^|[^a-zA-Z])AU(?:$|[^a-zA-Z])|🇦🇺' },
  { code: 'CA', flag: '🇨🇦', label: '加拿大', re2: '加拿大|多伦多|温哥华|蒙特利尔|Canada|Toronto|Vancouver|(?:^|[^a-zA-Z])CA(?:$|[^a-zA-Z])|🇨🇦' },
];

const REGION_MAP = new Map(EXPORT_REGIONS.map((r) => [r.code, r]));
const DOMAIN_CLEAN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const GO_RE2_UNSUPPORTED_RE = /(?:\(\?=|\(\?!|\(\?<=|\(\?<!)/;

export function inferRegionsFromCtxs(ctxs) {
  const list = Array.isArray(ctxs) ? ctxs.filter(Boolean) : ctxs ? [ctxs] : [];
  const found = new Set();
  for (const c of list) {
    const text = `${c.landingName || ''} ${c.nodeName || ''}`;
    let matchedByName = false;
    for (const r of EXPORT_REGIONS) {
      if (new RegExp(r.re2, 'i').test(text)) {
        found.add(r.code);
        matchedByName = true;
      }
    }
    const rawCode = String(c.region || '').trim().toUpperCase();
    const normCode = rawCode === 'UK' ? 'GB' : rawCode;
    if (!matchedByName && REGION_MAP.has(normCode)) {
      found.add(normCode);
    }
  }
  return EXPORT_REGIONS.map((r) => r.code).filter((code) => found.has(code));
}

export function buildRegionRe2(codes, withCaseFlag = true) {
  const valid = (Array.isArray(codes) ? codes : [])
    .map((c) => String(c || '').trim().toUpperCase())
    .map((c) => (c === 'UK' ? 'GB' : c))
    .filter((c) => REGION_MAP.has(c));
  const uniqueCodes = Array.from(new Set(valid));
  if (!uniqueCodes.length) return '';
  const body = uniqueCodes.map((c) => REGION_MAP.get(c).re2).join('|');
  return withCaseFlag ? `(?i)(?:${body})` : `(?:${body})`;
}

export function parseCustomDomainLines(raw) {
  const tokens = Array.isArray(raw)
    ? raw
    : String(raw || '').split(/[\r\n,;，；\s]+/);
  const valid = [];
  const invalid = [];
  const seen = new Set();
  for (const tok of tokens) {
    const trimmed = String(tok || '').trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const cleaned = trimmed
      .replace(/^https?:\/\//i, '')
      .replace(/^(\*\.|\+\.|\.)+/, '')
      .replace(/[/?#].*$/, '')
      .replace(/:\d+$/, '')
      .toLowerCase();
    if (!cleaned) continue;
    if (DOMAIN_CLEAN_RE.test(cleaned)) {
      if (!seen.has(cleaned)) {
        seen.add(cleaned);
        valid.push(cleaned);
      }
    } else {
      invalid.push(trimmed);
    }
  }
  return { valid, invalid };
}

export function normalizeTestUrl(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return { ok: true, url: DEFAULT_TEST_URL };
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, url: DEFAULT_TEST_URL, error: '测速地址仅支持 http:// 或 https://' };
    }
    return { ok: true, url: trimmed };
  } catch {
    return { ok: false, url: DEFAULT_TEST_URL, error: '自定义测速地址格式无效' };
  }
}

function resolveExitFallback(ctxs, opts = {}) {
  const mode = opts.exitFallbackMode || 'auto';
  if (mode === 'none') return { mode: 'none', regions: [], re2: '', rawPattern: '' };
  const regions = mode === 'custom'
    ? EXPORT_REGIONS.map((r) => r.code).filter((c) => (opts.exitFallbackRegions || []).includes(c))
    : inferRegionsFromCtxs(ctxs);
  const finalRegions = mode === 'auto' && !regions.length ? ['US'] : regions;
  return {
    mode,
    regions: finalRegions,
    re2: buildRegionRe2(finalRegions, true),
    rawPattern: buildRegionRe2(finalRegions, false),
  };
}

function resolveFrontRegion(opts = {}) {
  const mode = opts.frontRegionMode || (opts.preferApac === false ? 'all' : 'apac');
  if (mode === 'all') {
    return { mode: 'all', regions: [], re2: '', rawPattern: '', label: '全部地区' };
  }
  if (mode === 'custom') {
    const regions = EXPORT_REGIONS.map((r) => r.code).filter((c) => (opts.frontRegions || []).includes(c));
    return {
      mode: 'custom',
      regions,
      re2: buildRegionRe2(regions, true),
      rawPattern: buildRegionRe2(regions, false),
      label: regions.length ? regions.join('+') : '全部地区',
    };
  }
  return {
    mode: 'apac',
    regions: ['HK', 'TW', 'JP', 'SG', 'KR'],
    re2: APAC_FILTER_RE2,
    rawPattern: APAC_FILTER_RE2.replace(/^\(\?i\)/, ''),
    label: '亚太低延迟',
  };
}

const FAKE_IP_BASE = [
  '*.lan',
  '*.local',
  '*.localdomain',
  '*.localhost',
  '+.lan',
  '+.local',
  '+.localdomain',
  '+.home.arpa',
  'localhost.ptlogin2.qq.com',
  'localhost.sec.qq.com',
  'time.*.com',
  'time.*.gov',
  'time.*.edu.cn',
  'time.*.apple.com',
  'ntp.*.com',
  '+.pool.ntp.org',
  '+.ntp.org.cn',
  'connectivitycheck.gstatic.com',
  'captive.apple.com',
  'mesu.apple.com',
  'swscan.apple.com',
  '+.push.apple.com',
  '+.weixin.qq.com',
  '+.alipay.com',
  '+.alipayobjects.com',
  '+.95516.com',
  '+.cmbchina.com',
  '+.icbc.com.cn',
  '+.ccb.com',
  '+.boc.cn',
  '+.abchina.com',
];

const FAKE_IP_WIN = [
  '+.msftconnecttest.com',
  '+.msftncsi.com',
  'dns.msftncsi.com',
  'time.windows.com',
  'WORKGROUP',
];

const FAKE_IP_HARMONY = [
  'connectivitycheck.platform.hicloud.com',
  '+.hicloud.com',
  '+.hispace.hicloud.com',
  '+.dbankcloud.cn',
  '+.harmonyos.com',
  '+.vmall.com',
];

const FAKE_IP_VIVO = [
  'wifi.vivo.com.cn',
  '+.vivo.com.cn',
  '+.vivoglobal.com',
  '+.vivo.com',
];

const FAKE_IP_XIAOMI = [
  'connect.rom.miui.com',
  '+.market.xiaomi.com',
];

function getFakeIpList(preset = 'universal') {
  const arr = [...FAKE_IP_BASE];
  if (preset === 'harmony') {
    arr.push(...FAKE_IP_HARMONY, ...FAKE_IP_WIN);
  } else if (preset === 'vivo_win') {
    arr.push(...FAKE_IP_VIVO, ...FAKE_IP_WIN);
  } else {
    arr.push(...FAKE_IP_WIN, ...FAKE_IP_HARMONY, ...FAKE_IP_VIVO, ...FAKE_IP_XIAOMI);
  }
  return Array.from(new Set(arr));
}

function normalizeCtxList(ctxs) {
  const arr = Array.isArray(ctxs) ? ctxs.filter(Boolean) : ctxs ? [ctxs] : [];
  return arr;
}

function buildLandingProxyList(ctxs, extraManagedIps = []) {
  const list = normalizeCtxList(ctxs);
  const nodeNameCount = new Map();
  for (const c of list) {
    const k = String(c.nodeName || '自建节点').trim();
    nodeNameCount.set(k, (nodeNameCount.get(k) || 0) + 1);
  }

  const usedNames = new Set();
  const proxies = [];
  const managedIps = [];
  const pushIp = (raw) => {
    const ip = String(raw || '').trim();
    if (ip && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip) && !managedIps.includes(ip)) {
      managedIps.push(ip);
    }
  };

  for (const ctx of list) {
    const proto = String(ctx.proto || 'vless').toLowerCase();
    const nodeBase = String(ctx.nodeName || '自建节点').trim();
    const userPart = String(ctx.username || '').trim();
    const multiSameNode = (nodeNameCount.get(nodeBase) || 0) > 1;
    const rawDisplay = ctx.landingName
      || (multiSameNode && userPart ? `落地-${nodeBase}-${userPart}(链式)` : `落地-${nodeBase}(链式)`);

    let displayName = rawDisplay;
    let seq = 2;
    while (usedNames.has(displayName)) {
      displayName = `${rawDisplay}-${seq++}`;
    }
    usedNames.add(displayName);

    const dialer = ctx.dialerProxy || DEFAULT_DIALER_PROXY;
    const host = String(ctx.host || '').trim();
    pushIp(host);

    const base = {
      name: displayName,
      server: host || '198.51.100.10',
      port: Number(ctx.port || 8443),
    };

    if (proto === 'vless') {
      proxies.push({
        ...base,
        type: 'vless',
        uuid: ctx.credential || '00000000-0000-4000-8000-000000000000',
        network: 'tcp',
        tls: true,
        udp: true,
        flow: ctx.flow || 'xtls-rprx-vision',
        servername: ctx.sni || DEFAULT_SNI,
        'client-fingerprint': 'chrome',
        'reality-opts': {
          'public-key': ctx.publicKey || 'REPLACE_WITH_PUBLIC_KEY',
          'short-id': ctx.shortId || '',
        },
        'dialer-proxy': dialer,
      });
    } else if (proto === 'shadowsocks') {
      proxies.push({
        ...base,
        type: 'ss',
        cipher: ctx.method || '2022-blake3-aes-128-gcm',
        password: ctx.credential || 'REPLACE_PASSWORD',
        udp: true,
        'dialer-proxy': dialer,
      });
    } else if (proto === 'socks' || proto === 'socks5' || proto === 'mixed') {
      proxies.push({
        ...base,
        type: 'socks5',
        username: ctx.username || '',
        password: ctx.credential || '',
        udp: true,
        'dialer-proxy': dialer,
      });
    } else {
      proxies.push({
        ...base,
        type: 'http',
        username: ctx.username || '',
        password: ctx.credential || '',
        'dialer-proxy': dialer,
      });
    }
  }

  for (const ip of (Array.isArray(extraManagedIps) ? extraManagedIps : [])) {
    pushIp(ip);
  }
  return { proxies, managedIps };
}

function renderProxyYamlBlock(obj, indent = '  ') {
  const q = (v) => JSON.stringify(String(v ?? ''));
  const lines = [
    `${indent}- name: ${q(obj.name)}`,
    `${indent}  type: ${obj.type}`,
    `${indent}  server: ${q(obj.server)}`,
    `${indent}  port: ${obj.port}`,
  ];
  if (obj.type === 'vless') {
    lines.push(
      `${indent}  uuid: ${q(obj.uuid)}`,
      `${indent}  network: tcp`,
      `${indent}  tls: true`,
      `${indent}  udp: true`,
      `${indent}  flow: ${q(obj.flow)}`,
      `${indent}  servername: ${q(obj.servername)}`,
      `${indent}  client-fingerprint: chrome`,
      `${indent}  reality-opts:`,
      `${indent}    public-key: ${q(obj['reality-opts']['public-key'])}`,
      `${indent}    short-id: ${q(obj['reality-opts']['short-id'])}`,
    );
  } else if (obj.type === 'ss') {
    lines.push(
      `${indent}  cipher: ${q(obj.cipher)}`,
      `${indent}  password: ${q(obj.password)}`,
      `${indent}  udp: true`,
    );
  } else {
    if (obj.username) lines.push(`${indent}  username: ${q(obj.username)}`);
    if (obj.password) lines.push(`${indent}  password: ${q(obj.password)}`);
    if (obj.udp) lines.push(`${indent}  udp: true`);
  }
  if (obj['dialer-proxy']) {
    lines.push(`${indent}  dialer-proxy: ${q(obj['dialer-proxy'])}`);
  }
  return lines.join('\n');
}

/** 供单节点复制复用的 Mihomo / Clash 链式落地 YAML 渲染器（消除与 format.js 的重复代码） */
export function renderSingleProxyYaml(ctx) {
  const { proxies } = buildLandingProxyList([ctx]);
  return proxies.length ? renderProxyYamlBlock(proxies[0], '') : '';
}

/** 导出前离线静态校验（4 重防出错护栏：正则/Go RE2 兼容、域名清洗、测速 URL、隐私防误发预警） */
export function validateExportDraft(ctxs, opts = {}) {
  const list = normalizeCtxList(ctxs);
  const extraIps = opts.includeOpsChannel && opts.includeAllManagedIps ? (opts.extraManagedIps || []) : [];
  const { proxies, managedIps } = buildLandingProxyList(list, extraIps);
  const isYaml = (opts.format || 'all_platform_yaml') === 'all_platform_yaml';
  const errors = [];
  const warnings = [];

  if (!list.length) {
    errors.push('请先勾选至少 1 个落地节点');
  }
  const customExclude = String(opts.customExclude || '').trim();
  if (customExclude) {
    try {
      // eslint-disable-next-line no-new
      new RegExp(customExclude, 'i');
    } catch {
      errors.push('自定义排除正则语法无效，请检查括号或转义符号');
    }
    if (isYaml && GO_RE2_UNSUPPORTED_RE.test(customExclude)) {
      errors.push('自定义排除正则包含 (?= / (?! / (?<= 等 JS 语法，Go RE2 (Mihomo/iOS) 不支持');
    }
  }
  const testUrlCheck = normalizeTestUrl(opts.testUrl);
  if (!testUrlCheck.ok) {
    errors.push(testUrlCheck.error);
  }

  const exitDomains = parseCustomDomainLines(opts.customExitDomains);
  const directDomains = parseCustomDomainLines(opts.customDirectDomains);
  const rejectDomains = parseCustomDomainLines(opts.customRejectDomains);
  const badDomains = [...exitDomains.invalid, ...directDomains.invalid, ...rejectDomains.invalid];
  if (badDomains.length) {
    errors.push(`自定义规则含非法域名：${badDomains.slice(0, 3).join(', ')}`);
  }

  if (isYaml && !String(opts.frontSubUrl || '').trim()) {
    warnings.push('前置机场订阅为空，将输出占位符（发给朋友作模板时可直接导出）');
  }
  if (list.some((c) => !c.host || c.host === '198.51.100.10')) {
    warnings.push('存在未配置公网 IP 的节点');
  }
  if (list.some((c) => String(c.proto || '').toLowerCase() === 'vless' && !String(c.publicKey || '').trim())) {
    warnings.push('存在未填写 Reality PublicKey 的 VLESS 节点，将输出占位符');
  }
  const exitFb = resolveExitFallback(list, opts);
  const frontReg = resolveFrontRegion(opts);
  if (opts.exitFallbackMode === 'custom' && !exitFb.regions.length) {
    warnings.push('「落地出口备选」为自定义模式但未选国家，将仅保留自建落地');
  }
  if (opts.frontRegionMode === 'custom' && !frontReg.regions.length) {
    warnings.push('「前置地区」为自定义模式但未选国家，将回退为全部地区');
  }
  const hasNonOwnerUser = list.some((c) => c.username && !/^(me|ss2022-|admin|owner)/i.test(String(c.username)));
  if (opts.includeOpsChannel && hasNonOwnerUser) {
    warnings.push('已勾选「运维通道」，若发给他人使用建议取消勾选以防泄露运维 IP');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    nodeCount: proxies.length,
    ipCount: managedIps.length,
    ips: managedIps,
    resolvedExitRegions: exitFb.regions,
    resolvedExitMode: exitFb.mode,
    resolvedFrontLabel: frontReg.label,
    customRuleCount: exitDomains.valid.length + directDomains.valid.length + rejectDomains.valid.length,
  };
}

/** 推荐导出文件名（安全无特殊符号） */
export function suggestExportFilename(ctxs, format = 'all_platform_yaml', devicePreset = 'universal') {
  const list = normalizeCtxList(ctxs);
  const sanitize = (s) => String(s || '')
    .trim()
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  let tag = 'config';
  if (list.length === 1) {
    tag = sanitize(`${list[0].nodeName || 'node'}-${list[0].username || 'user'}`) || 'member';
  } else if (list.length > 1) {
    const names = list.slice(0, 2).map((c) => sanitize(c.nodeName || c.username)).filter(Boolean);
    tag = names.length ? `${names.join('_')}_${list.length}nodes` : `combo_${list.length}nodes`;
  }
  if (format === 'bettbox_js') {
    return `nodedeck-v4.3-${tag}-${devicePreset}.js`;
  }
  return `nodedeck-all-platform-${tag}.yaml`;
}

/** 1. 生成全平台单文件离线配置 (.yaml)（Win10/11 · iOS 蓝猫/Stash · 鸿蒙 4/7 通用） */
export function buildAllPlatformYaml(ctxs, opts = {}) {
  // 全平台单文件内建策略组固定为「前置代理」，强制对齐 dialer-proxy 杜绝 "dialer-proxy not found" 报错
  const list = normalizeCtxList(ctxs).map((c) => ({ ...c, dialerProxy: '前置代理' }));
  const extraIps = opts.includeOpsChannel && opts.includeAllManagedIps ? (opts.extraManagedIps || []) : [];
  const { proxies: landingList, managedIps } = buildLandingProxyList(list, extraIps);
  const frontUrl = String(opts.frontSubUrl || '').trim() || 'REPLACE_WITH_FRONT_AIRPORT_SUB_URL';
  const devicePreset = opts.devicePreset || 'universal';
  const includeOps = Boolean(opts.includeOpsChannel);
  const excludeHighMult = opts.excludeHighMult !== false;
  const customExclude = String(opts.customExclude || '').trim();
  const defaultOutboundMode = opts.defaultOutboundMode === 'airport' ? 'airport' : 'landing';
  const testUrl = normalizeTestUrl(opts.testUrl).url;
  const fakeIpList = getFakeIpList(devicePreset);

  const frontReg = resolveFrontRegion(opts);
  const exitFb = resolveExitFallback(list, opts);
  const exitDomains = parseCustomDomainLines(opts.customExitDomains).valid;
  const directDomains = parseCustomDomainLines(opts.customDirectDomains).valid;
  const rejectDomains = parseCustomDomainLines(opts.customRejectDomains).valid;

  const excludeParts = [];
  if (excludeHighMult) excludeParts.push(HIGH_MULT_RE2);
  if (customExclude) excludeParts.push(customExclude);
  const excludeFilter = excludeParts.length ? `(?i)(?:${excludeParts.join('|')})` : '';
  const frontFilterLine = frontReg.re2 ? `\n    filter: ${JSON.stringify(frontReg.re2)}` : '';
  const excludeFilterLine = excludeFilter ? `\n    exclude-filter: ${JSON.stringify(excludeFilter)}` : '';

  const proxiesYaml = landingList.map((obj) => renderProxyYamlBlock(obj, '  ')).join('\n\n');
  const exitNamesYaml = landingList.map((obj) => `      - ${JSON.stringify(obj.name)}`).join('\n');
  const exitUseYaml = exitFb.re2
    ? `\n    use:\n      - front_airport\n    filter: ${JSON.stringify(exitFb.re2)}`
    : '';
  const generalProxiesYaml = defaultOutboundMode === 'airport'
    ? '      - "🚀 机场直出"\n      - "落地出口"\n      - "前置代理"\n      - DIRECT'
    : '      - "落地出口"\n      - "🚀 机场直出"\n      - "前置代理"\n      - DIRECT';

  const customRuleLines = [
    ...rejectDomains.map((d) => `  - DOMAIN-SUFFIX,${d},REJECT`),
    ...directDomains.map((d) => `  - DOMAIN-SUFFIX,${d},DIRECT`),
    ...exitDomains.map((d) => `  - DOMAIN-SUFFIX,${d},落地出口`),
  ];
  const customRulesYaml = customRuleLines.length ? `${customRuleLines.join('\n')}\n` : '';

  const opsGroupYaml = includeOps
    ? `
  - name: "🔧 运维通道"
    type: select
    proxies:
      - "前置代理"
      - DIRECT
`
    : '';

  const opsTarget = includeOps ? '🔧 运维通道' : '前置代理';
  const opsRuleYaml = managedIps.length
    ? `${managedIps.map((ip) => `  - IP-CIDR,${ip}/32,${opsTarget},no-resolve`).join('\n')}\n`
    : '';

  const skipHostYaml = managedIps.length
    ? `${managedIps.map((ip) => `    - "${ip}/32"`).join('\n')}\n`
    : '';

  const rp = (key, subPath, behavior = 'domain') => [
    `  ${key}:`,
    '    type: http',
    `    behavior: ${behavior}`,
    '    format: mrs',
    `    url: "${MRS_MIRROR}/${subPath}"`,
    `    path: ./ruleset/${key}.mrs`,
    '    interval: 86400',
  ].join('\n');

  const summaryNames = landingList.map((p) => p.name).join(' / ') || '未选择落地';

  return `# ============================================================================
# NodeDeck 全平台离线单文件配置（Win10/11 · iOS 蓝猫 Clash / Stash · 鸿蒙 4/7 通用）
# 包含落地：${summaryNames}
# 生成方式：纯本机离线生成（零云端托管 · 内置 50MB iOS 防崩护栏 · 7 大体检站锁落地）
# ============================================================================

mode: rule
allow-lan: false
ipv6: true
log-level: error
unified-delay: true
tcp-concurrent: true
find-process-mode: off
keep-alive-interval: 30
keep-alive-idle: 15
geodata-mode: false
geodata-loader: memconservative

profile:
  store-selected: true
  store-fake-ip: true

proxies:
${proxiesYaml}

proxy-providers:
  front_airport:
    type: http
    url: ${JSON.stringify(frontUrl)}
    path: ./proxies/front_airport.yaml
    interval: 86400
    proxy: DIRECT
    header:
      User-Agent:
        - "clash.meta/v1.19.34"
    exclude-filter: "(?i)剩余|到期|重置|官网|套餐|流量|订阅|续费|更新|公告|网址|群组|客服|故障|说明|过期|Expire|Traffic|Reset|Website"
    override:
      ip-version: ipv4-prefer
    health-check:
      enable: true
      url: ${JSON.stringify(testUrl)}
      interval: 600
      lazy: true

proxy-groups:
  - name: "前置代理"
    type: select
    proxies:
      - "🛡️ 前置稳定"
      - "⚡ 前置测速"
    use:
      - front_airport

  - name: "🛡️ 前置稳定"
    type: fallback
    url: ${JSON.stringify(testUrl)}
    interval: 300
    lazy: true
    use:
      - front_airport${frontFilterLine}${excludeFilterLine}

  - name: "⚡ 前置测速"
    type: url-test
    url: ${JSON.stringify(testUrl)}
    interval: 300
    tolerance: 80
    lazy: true
    use:
      - front_airport${frontFilterLine}${excludeFilterLine}

  - name: "落地出口"
    type: select
    proxies:
${exitNamesYaml}${exitUseYaml}
${opsGroupYaml}
  - name: "🤖 AI 服务"
    type: select
    proxies:
      - "落地出口"
      - "🚀 机场直出"
      - "前置代理"

  - name: "🔍 Google 服务"
    type: select
    proxies:
      - "落地出口"
      - "🚀 机场直出"
      - "前置代理"

  - name: "🎬 YouTube & 流媒体"
    type: select
    proxies:
${generalProxiesYaml}

  - name: "💬 Telegram & 社交"
    type: select
    proxies:
${generalProxiesYaml}

  - name: "💻 GitHub & 开发"
    type: select
    proxies:
${generalProxiesYaml}

  - name: "🚀 机场直出"
    type: select
    proxies:
      - "🛡️ 前置稳定"
      - "⚡ 前置测速"
      - "落地出口"
      - DIRECT
    use:
      - front_airport

  - name: "🐟 漏网之鱼"
    type: select
    proxies:
${generalProxiesYaml}

rule-providers:
${[
    rp('private_domain', 'geosite/private.mrs', 'domain'),
    rp('private_ip', 'geoip/private.mrs', 'ipcidr'),
    rp('ai_domain', 'geosite/category-ai-!cn.mrs', 'domain'),
    rp('google_domain', 'geosite/google.mrs', 'domain'),
    rp('youtube_domain', 'geosite/youtube.mrs', 'domain'),
    rp('netflix_domain', 'geosite/netflix.mrs', 'domain'),
    rp('github_domain', 'geosite/github.mrs', 'domain'),
    rp('telegram_domain', 'geosite/telegram.mrs', 'domain'),
    rp('telegram_ip', 'geoip/telegram.mrs', 'ipcidr'),
    rp('apple_domain', 'geosite/apple.mrs', 'domain'),
    rp('microsoft_domain', 'geosite/microsoft.mrs', 'domain'),
    rp('proxy_domain', 'geosite/geolocation-!cn.mrs', 'domain'),
    rp('cn_domain', 'geosite/cn.mrs', 'domain'),
    rp('cn_ip', 'geoip/cn.mrs', 'ipcidr'),
  ].join('\n')}

rules:
${opsRuleYaml}  - RULE-SET,private_domain,DIRECT
  - RULE-SET,private_ip,DIRECT,no-resolve
${customRulesYaml}  - DOMAIN-SUFFIX,locationhistory-pa.googleapis.com,REJECT
  - DOMAIN-SUFFIX,footprints-pa.googleapis.com,REJECT
  - DOMAIN-SUFFIX,timeline.google.com,REJECT
  - DOMAIN-SUFFIX,locationreporting-pa.googleapis.com,REJECT
  - DOMAIN-SUFFIX,geomobileservices-pa.googleapis.com,REJECT
  - DOMAIN-SUFFIX,stun.miwifi.com,REJECT
  - DOMAIN-SUFFIX,stun.qq.com,REJECT
  - DOMAIN-SUFFIX,stun.chat.bilibili.com,REJECT
  - DOMAIN-SUFFIX,stun.hitv.com,REJECT
  - DOMAIN-SUFFIX,stun.cdnbye.com,REJECT
  - DOMAIN-SUFFIX,stun.l.google.com,落地出口
  - DOMAIN-SUFFIX,stun.cloudflare.com,落地出口
  - DOMAIN-SUFFIX,global.stun.twilio.com,落地出口
  - DOMAIN-SUFFIX,stun.stunprotocol.org,落地出口
  - DOMAIN-SUFFIX,stun.nextcloud.com,落地出口
  - DOMAIN-SUFFIX,stun.sipgate.net,落地出口
  - "AND,((NETWORK,UDP),(DST-PORT,443),(NOT,((OR,((RULE-SET,private_domain),(RULE-SET,private_ip,no-resolve),(RULE-SET,cn_domain),(RULE-SET,cn_ip,no-resolve),(RULE-SET,apple_domain),(RULE-SET,microsoft_domain)))))),REJECT"
  - DOMAIN-SUFFIX,ipinfo.io,落地出口
  - DOMAIN-SUFFIX,ippure.com,落地出口
  - DOMAIN-SUFFIX,ipure.dev,落地出口
  - DOMAIN-SUFFIX,scamalytics.com,落地出口
  - DOMAIN-SUFFIX,ipqualityscore.com,落地出口
  - DOMAIN-SUFFIX,browserleaks.com,落地出口
  - DOMAIN-SUFFIX,ipleak.net,落地出口
  - DOMAIN-SUFFIX,whoer.net,落地出口
  - DOMAIN-SUFFIX,ip.net.coffee,落地出口
  - DOMAIN-SUFFIX,ip.sb,落地出口
  - DOMAIN-SUFFIX,ip.skk.moe,落地出口
  - DOMAIN-SUFFIX,ping0.cc,落地出口
  - DOMAIN-SUFFIX,accounts.google.com,落地出口
  - DOMAIN-SUFFIX,apis.google.com,落地出口
  - DOMAIN-SUFFIX,aicode.googleapis.com,🤖 AI 服务
  - DOMAIN-SUFFIX,generativelanguage.googleapis.com,🤖 AI 服务
  - DOMAIN-SUFFIX,aistudio.google.com,🤖 AI 服务
  - DOMAIN-SUFFIX,makersuite.google.com,🤖 AI 服务
  - DOMAIN-SUFFIX,alkalimakersuite-pa.clients6.google.com,🤖 AI 服务
  - DOMAIN-SUFFIX,proactivebackend-pa.googleapis.com,🤖 AI 服务
  - DOMAIN-SUFFIX,robinfrontend-pa.googleapis.com,🤖 AI 服务
  - DOMAIN-SUFFIX,ai.google.dev,🤖 AI 服务
  - DOMAIN-SUFFIX,deepmind.com,🤖 AI 服务
  - DOMAIN-SUFFIX,deepmind.google,🤖 AI 服务
  - DOMAIN-SUFFIX,notebooklm.google.com,🤖 AI 服务
  - DOMAIN-SUFFIX,labs.google,🤖 AI 服务
  - DOMAIN-SUFFIX,jules.google.com,🤖 AI 服务
  - DOMAIN-SUFFIX,antigravity.google,🤖 AI 服务
  - DOMAIN-SUFFIX,openai.com,🤖 AI 服务
  - DOMAIN-SUFFIX,chatgpt.com,🤖 AI 服务
  - DOMAIN-SUFFIX,oaistatic.com,🤖 AI 服务
  - DOMAIN-SUFFIX,oaiusercontent.com,🤖 AI 服务
  - DOMAIN-SUFFIX,auth0.com,🤖 AI 服务
  - DOMAIN-SUFFIX,sora.com,🤖 AI 服务
  - DOMAIN-SUFFIX,livekit.cloud,🤖 AI 服务
  - DOMAIN-SUFFIX,ai.com,🤖 AI 服务
  - DOMAIN-SUFFIX,anthropic.com,🤖 AI 服务
  - DOMAIN-SUFFIX,claude.ai,🤖 AI 服务
  - DOMAIN-SUFFIX,claude.com,🤖 AI 服务
  - DOMAIN-SUFFIX,claudeusercontent.com,🤖 AI 服务
  - DOMAIN-SUFFIX,clau.de,🤖 AI 服务
  - DOMAIN-SUFFIX,x.ai,🤖 AI 服务
  - DOMAIN-SUFFIX,grok.com,🤖 AI 服务
  - DOMAIN-SUFFIX,perplexity.ai,🤖 AI 服务
  - DOMAIN-SUFFIX,cursor.sh,🤖 AI 服务
  - DOMAIN-SUFFIX,cursor.com,🤖 AI 服务
  - RULE-SET,ai_domain,🤖 AI 服务
  - DOMAIN-SUFFIX,googlevideo.com,🎬 YouTube & 流媒体
  - DOMAIN-SUFFIX,youtube.com,🎬 YouTube & 流媒体
  - DOMAIN-SUFFIX,youtu.be,🎬 YouTube & 流媒体
  - DOMAIN-SUFFIX,ytimg.com,🎬 YouTube & 流媒体
  - DOMAIN-SUFFIX,ggpht.com,🎬 YouTube & 流媒体
  - RULE-SET,youtube_domain,🎬 YouTube & 流媒体
  - RULE-SET,netflix_domain,🎬 YouTube & 流媒体
  - RULE-SET,google_domain,🔍 Google 服务
  - RULE-SET,github_domain,💻 GitHub & 开发
  - RULE-SET,telegram_domain,💬 Telegram & 社交
  - RULE-SET,telegram_ip,💬 Telegram & 社交,no-resolve
  - DOMAIN-SUFFIX,zoom.com.cn,DIRECT
  - DOMAIN-SUFFIX,amazon.cn,DIRECT
  - DOMAIN-SUFFIX,amazonaws.com.cn,DIRECT
  - RULE-SET,apple_domain,DIRECT
  - RULE-SET,microsoft_domain,DIRECT
  - RULE-SET,proxy_domain,🐟 漏网之鱼
  - RULE-SET,cn_domain,DIRECT
  - RULE-SET,cn_ip,DIRECT
  - MATCH,🐟 漏网之鱼

sniffer:
  enable: true
  force-dns-mapping: true
  parse-pure-ip: true
  override-destination: false
  sniff:
    HTTP:
      ports: [80, "8080-8880"]
      override-destination: true
    TLS:
      ports: [443, 8443]
    QUIC:
      ports: [443, 8443]
  force-domain:
    - "+.v2ex.com"
  skip-domain:
    - "Mijia Cloud"
    - "+.push.apple.com"
  skip-dst-address:
${skipHostYaml}    - "91.105.192.0/23"
    - "91.108.4.0/22"
    - "91.108.8.0/21"
    - "91.108.16.0/21"
    - "91.108.56.0/22"
    - "95.161.64.0/20"
    - "149.154.160.0/20"
    - "185.76.151.0/24"
    - "2001:67c:4e0::/44"
    - "2001:b28:f230::/44"
    - "2a0a:f280::/29"

dns:
  enable: true
  ipv6: false
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  respect-rules: true
  default-nameserver:
    - 223.5.5.5
    - 119.29.29.29
  proxy-server-nameserver:
    - https://223.5.5.5/dns-query
    - https://1.12.12.12/dns-query
  direct-nameserver:
    - https://223.5.5.5/dns-query
    - https://1.12.12.12/dns-query
  nameserver:
    - https://1.1.1.1/dns-query
    - https://8.8.8.8/dns-query
  nameserver-policy:
    "rule-set:private_domain,apple_domain,microsoft_domain,cn_domain":
      - https://223.5.5.5/dns-query
      - https://1.12.12.12/dns-query
  fake-ip-filter:
${fakeIpList.map((d) => `    - ${JSON.stringify(d)}`).join('\n')}
`;
}

/** 2. 生成 Bettbox / Clash Verge Rev 万能通用覆写脚本 v4.4 (.js)（支持多落地组合 + DIY 地区与规则） */
export function buildBettboxUniversalJs(ctxs, opts = {}) {
  const list = normalizeCtxList(ctxs);
  const extraIps = opts.includeOpsChannel && opts.includeAllManagedIps ? (opts.extraManagedIps || []) : [];
  const { proxies: landingList, managedIps } = buildLandingProxyList(list, extraIps);
  const devicePreset = opts.devicePreset || 'universal';
  const includeOps = Boolean(opts.includeOpsChannel);
  const excludeHighMult = opts.excludeHighMult !== false;
  const customExclude = String(opts.customExclude || '').trim();
  const defaultOutboundMode = opts.defaultOutboundMode === 'airport' ? 'airport' : 'landing';
  const testUrl = normalizeTestUrl(opts.testUrl).url;
  const fakeIpList = getFakeIpList(devicePreset);

  const frontReg = resolveFrontRegion(opts);
  const exitFb = resolveExitFallback(list, opts);
  const exitDomains = parseCustomDomainLines(opts.customExitDomains).valid;
  const directDomains = parseCustomDomainLines(opts.customDirectDomains).valid;
  const rejectDomains = parseCustomDomainLines(opts.customRejectDomains).valid;

  const presetLabel = devicePreset === 'harmony'
    ? '鸿蒙 4/7 + Windows 专优'
    : devicePreset === 'vivo_win'
      ? 'vivo + Windows 双端'
      : '全平台通用 (Win10/11 · 鸿蒙 4/7 · 安卓)';

  const summaryNames = landingList.map((p) => p.name).join(' / ') || '未选择落地';
  const opsGroupSnippet = includeOps
    ? `    {\n      name: OPS_GROUP,\n      type: "select",\n      proxies: [FRONT_GROUP, "DIRECT"],\n    },\n`
    : '';
  const opsRuleLine = includeOps
    ? `    ...MEMBER_CONFIG.managedServerIps.filter(Boolean).map((ip) => "IP-CIDR," + ip + "/32," + OPS_GROUP + ",no-resolve"),`
    : `    ...MEMBER_CONFIG.managedServerIps.filter(Boolean).map((ip) => "IP-CIDR," + ip + "/32," + FRONT_GROUP + ",no-resolve"),`;

  return `// ============================================================================
// NodeDeck 万能通用覆写脚本（Bettbox / Clash Verge Rev / FlClash）
// 包含落地：${summaryNames}
// 预设：${presetLabel} ｜ 落地备选：${exitFb.regions.length ? exitFb.regions.join('+') : '仅自建落地'} ｜ 前置优选：${frontReg.label}
// 版本：v4.4-DIY（纯本地离线生成 · 精准倍率识别 · 防崩防污染 · 7大体检站锁落地）
// ============================================================================

const MEMBER_CONFIG = {
  managedServerIps: ${JSON.stringify(managedIps, null, 4)},
  landingNodes: ${JSON.stringify(landingList, null, 4)},
  defaultOutboundMode: ${JSON.stringify(defaultOutboundMode)},
  excludeHighMult: ${JSON.stringify(excludeHighMult)},
  frontRegionPattern: ${JSON.stringify(frontReg.rawPattern)},
  exitFallbackMode: ${JSON.stringify(exitFb.mode)},
  exitFallbackPattern: ${JSON.stringify(exitFb.rawPattern)},
  exitFallbackIncludesUS: ${JSON.stringify(exitFb.regions.includes('US'))},
  customExcludePattern: ${JSON.stringify(customExclude)},
  testUrl: ${JSON.stringify(testUrl)},
  customRejectDomains: ${JSON.stringify(rejectDomains)},
  customDirectDomains: ${JSON.stringify(directDomains)},
  customExitDomains: ${JSON.stringify(exitDomains)},
  // 备用镜像: "https://fastly.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo"
  mrsMirror: "${MRS_MIRROR}",
  fakeIpFilter: ${JSON.stringify(fakeIpList, null, 4)},
};

function main(config) {
  const FRONT_GROUP = "前置代理";
  const FRONT_SPEED = "⚡ 前置测速";
  const FRONT_STABLE = "🛡️ 前置稳定";
  const EXIT_GROUP = "落地出口";
  const OPS_GROUP = "🔧 运维通道";
  const AIRPORT_GROUP = "🚀 机场直出";
  const AI_GROUP = "🤖 AI 服务";
  const GOOGLE_GROUP = "🔍 Google 服务";
  const MEDIA_GROUP = "🎬 YouTube & 流媒体";
  const SOCIAL_GROUP = "💬 Telegram & 社交";
  const DEV_GROUP = "💻 GitHub & 开发";
  const FALLBACK_GROUP = "🐟 漏网之鱼";

  const RESERVED_NAMES = new Set([
    FRONT_GROUP, FRONT_SPEED, FRONT_STABLE, EXIT_GROUP, OPS_GROUP,
    AIRPORT_GROUP, AI_GROUP, GOOGLE_GROUP, MEDIA_GROUP,
    SOCIAL_GROUP, DEV_GROUP, FALLBACK_GROUP,
    "DIRECT", "REJECT", "REJECT-DROP", "PASS", "COMPATIBLE", "GLOBAL",
  ]);

  const INFO_RE = /剩余|到期|重置|官网|套餐|流量|订阅|续费|更新|公告|网址|群组|客服|故障|说明|过期|Expire|Traffic|Reset|Website/i;
  const INFO_FILTER_STR = "剩余|到期|重置|官网|套餐|流量|订阅|续费|更新|公告|网址|群组|客服|故障|说明|过期|Expire|Traffic|Reset|Website";
  const HIGH_MULT_FILTER_STR = ${JSON.stringify(HIGH_MULT_RE2)};
  let frontRegionRe = null;
  if (MEMBER_CONFIG.frontRegionPattern) {
    try { frontRegionRe = new RegExp(MEMBER_CONFIG.frontRegionPattern, "i"); } catch (_) { frontRegionRe = null; }
  }
  let exitFallbackRe = null;
  if (MEMBER_CONFIG.exitFallbackMode !== "none" && MEMBER_CONFIG.exitFallbackPattern) {
    try { exitFallbackRe = new RegExp(MEMBER_CONFIG.exitFallbackPattern, "i"); } catch (_) { exitFallbackRe = null; }
  }
  let customExcludeRe = null;
  if (MEMBER_CONFIG.customExcludePattern) {
    try { customExcludeRe = new RegExp(MEMBER_CONFIG.customExcludePattern, "i"); } catch (_) { customExcludeRe = null; }
  }

  function isExitFallbackNode(name) {
    if (MEMBER_CONFIG.exitFallbackMode === "none") return false;
    const text = String(name || "");
    if (exitFallbackRe && exitFallbackRe.test(text)) return true;
    if (MEMBER_CONFIG.exitFallbackIncludesUS) {
      return /America/i.test(text) && !/South\\s*America|Latin\\s*America/i.test(text);
    }
    return false;
  }

  function getMultiplier(name) {
    const cleaned = String(name || "").replace(/\\b(?:x86|x64|amd64|arm64|v[246])\\b/gi, " ");
    const patterns = [
      /(?:^|[^\\d.])(\\d+(?:\\.\\d+)?)\\s*(?:[xX×]|倍)(?![a-zA-Z0-9])/g,
      /倍率\\s*[:：=]?\\s*(\\d+(?:\\.\\d+)?)/g,
      /×\\s*(\\d+(?:\\.\\d+)?)(?![a-zA-Z0-9.])/g,
      /(?:^|[^a-zA-Z0-9])[xX]([1-9](?:\\.\\d+)?|1\\d(?:\\.\\d+)?|20|0\\.\\d+)(?![a-zA-Z0-9.])/g,
    ];
    const vals = [];
    for (const re of patterns) {
      let m;
      while ((m = re.exec(cleaned)) !== null) {
        const v = parseFloat(m[1]);
        if (!Number.isNaN(v) && v > 0 && v <= 20) vals.push(v);
      }
    }
    return vals.length ? Math.max(...vals) : 1;
  }

  const isIpLiteral = (host) => /^\\d{1,3}(?:\\.\\d{1,3}){3}$/.test(String(host || "").trim()) || String(host || "").includes(":");
  const isBrokenHy2 = (p) => String(p && p.type || "").toLowerCase() === "hysteria2" && Boolean(p && p.obfs) && String(p.obfs).toLowerCase() !== "salamander";
  const isCfWs = (p) => String(p && p.network || "").toLowerCase() === "ws" && (/(?:^|\\.)cf[a-z0-9-]*\\./i.test(String(p && p.server || "")) || /cloudflare|workers\\.dev|pages\\.dev/i.test(String(p && p.server || "")));
  const isDedicatedLine = (p) => /专线|家宽|IEPL|IPLC|BGP|专属/i.test(String(p && p.name || ""));
  const isUdpProto = (p) => /^(hysteria|hysteria2|tuic|wireguard|quic)/i.test(String(p && p.type || ""));
  const sortFrontPriority = (arr) =>
    [...arr].sort((a, b) => {
      const score = (x) => (isBrokenHy2(x) ? 100 : 0) + (isCfWs(x) ? 40 : 0) + (isDedicatedLine(x) ? 0 : 10) + (isUdpProto(x) ? 2 : 0);
      return score(a) - score(b);
    });
  const unique = (arr) => Array.from(new Set(arr.filter(Boolean)));

  delete config.hosts;
  delete config["sub-rules"];
  config["geodata-mode"] = false;
  config.profile = {
    ...(config.profile && typeof config.profile === "object" ? config.profile : {}),
    "store-selected": true,
    "store-fake-ip": true,
  };

  const managedLandingNames = new Set(MEMBER_CONFIG.landingNodes.map((n) => n.name));
  const managedLandingTargets = new Set(MEMBER_CONFIG.landingNodes.map((n) => \`\${String(n.server || "").toLowerCase()}:\${Number(n.port || 0)}\`));
  const rawProxies = Array.isArray(config.proxies) ? config.proxies : [];
  const extraChainedNodes = [];
  const airportProxies = [];
  const seenNames = new Set(managedLandingNames);

  const safeUniqueName = (rawName) => {
    let base = String(rawName || "").trim();
    if (RESERVED_NAMES.has(base)) base = "[机场] " + base;
    let candidate = base;
    let idx = 2;
    while (seenNames.has(candidate) || RESERVED_NAMES.has(candidate)) candidate = \`\${base} (\${idx++})\`;
    seenNames.add(candidate);
    return candidate;
  };

  for (const p of rawProxies) {
    if (!p || !p.name) continue;
    const rawName = String(p.name).trim();
    const targetKey = \`\${String(p.server || "").toLowerCase()}:\${Number(p.port || 0)}\`;
    if (managedLandingNames.has(rawName) || managedLandingTargets.has(targetKey)) continue;
    if (INFO_RE.test(rawName)) continue;
    const cleanName = safeUniqueName(rawName);
    if (p["dialer-proxy"] || p.dialerProxy) {
      extraChainedNodes.push({ ...p, name: cleanName, "dialer-proxy": FRONT_GROUP });
      continue;
    }
    airportProxies.push(
      isIpLiteral(p.server)
        ? { ...p, name: cleanName }
        : { ...p, name: cleanName, "ip-version": p["ip-version"] || "ipv4-prefer" }
    );
  }

  const hasProxyProviders = Boolean(config["proxy-providers"] && Object.keys(config["proxy-providers"]).length > 0);
  const providerKeys = hasProxyProviders ? Object.keys(config["proxy-providers"]) : [];
  const baseEligible = MEMBER_CONFIG.excludeHighMult
    ? airportProxies.filter((p) => getMultiplier(p.name) <= 1)
    : airportProxies;
  const normalNodes = sortFrontPriority(baseEligible);
  const highMultNodes = sortFrontPriority(
    MEMBER_CONFIG.excludeHighMult ? airportProxies.filter((p) => getMultiplier(p.name) > 1) : []
  );
  const notCustomExcluded = (p) => !(customExcludeRe && customExcludeRe.test(String(p && p.name || "")));
  const preferredPool = normalNodes.filter(notCustomExcluded);
  const apacPreferred = frontRegionRe ? preferredPool.filter((p) => frontRegionRe.test(p.name)) : preferredPool;
  const apacNormal = frontRegionRe ? normalNodes.filter((p) => frontRegionRe.test(p.name)) : normalNodes;
  const apacClean = apacPreferred.filter((p) => !isBrokenHy2(p) && !isCfWs(p));
  const apacNoGecko = apacPreferred.filter((p) => !isBrokenHy2(p));
  const cleanPreferred = preferredPool.filter((p) => !isBrokenHy2(p) && !isCfWs(p));
  const cleanNormal = normalNodes.filter((p) => !isBrokenHy2(p) && !isCfWs(p));
  const noGeckoNormal = normalNodes.filter((p) => !isBrokenHy2(p));
  const noGeckoAll = airportProxies.filter((p) => !isBrokenHy2(p));

  const candidatePools = [
    apacClean.length >= 2 ? apacClean : [],
    apacClean, apacNoGecko, cleanPreferred, cleanNormal, noGeckoNormal, noGeckoAll, normalNodes, airportProxies,
  ];
  const speedPool = (candidatePools.find((arr) => arr.length > 0) || []).map((p) => p.name);

  const frontManualList = unique([
    ...apacClean.map((p) => p.name),
    ...apacNormal.map((p) => p.name),
    ...normalNodes.map((p) => p.name),
    ...highMultNodes.map((p) => p.name),
  ]);
  const exitFallbackNodes = unique([
    ...normalNodes.filter((p) => isExitFallbackNode(p.name)).map((p) => p.name),
    ...highMultNodes.filter((p) => isExitFallbackNode(p.name)).map((p) => p.name),
  ]);

  const injectedLandings = [
    ...MEMBER_CONFIG.landingNodes.map((n) => ({ ...n, "dialer-proxy": FRONT_GROUP })),
    ...extraChainedNodes,
  ];
  config.proxies = [...injectedLandings, ...airportProxies];

  const landingNames = injectedLandings.map((n) => n.name);
  const exitList = unique([...landingNames, ...exitFallbackNodes]);
  const defaultGeneral = MEMBER_CONFIG.defaultOutboundMode === "landing"
    ? [EXIT_GROUP, AIRPORT_GROUP, FRONT_GROUP, "DIRECT"]
    : [AIRPORT_GROUP, EXIT_GROUP, FRONT_GROUP, "DIRECT"];

  const autoPoolSource = speedPool.length > 0
    ? { proxies: speedPool }
    : hasProxyProviders
      ? { use: providerKeys, "exclude-filter": \`\${INFO_FILTER_STR}|\${HIGH_MULT_FILTER_STR}\` }
      : { proxies: ["DIRECT"] };

  const providerManualAttach = frontManualList.length === 0 && hasProxyProviders
    ? { use: providerKeys, "exclude-filter": INFO_FILTER_STR }
    : {};

  const probeUrl = MEMBER_CONFIG.testUrl || "https://www.gstatic.com/generate_204";
  config["proxy-groups"] = [
    { name: FRONT_GROUP, type: "select", proxies: unique([FRONT_SPEED, FRONT_STABLE, ...frontManualList]), ...providerManualAttach },
    { name: FRONT_SPEED, type: "url-test", url: probeUrl, interval: 300, tolerance: 80, lazy: true, ...autoPoolSource },
    { name: FRONT_STABLE, type: "fallback", url: probeUrl, interval: 300, lazy: true, ...autoPoolSource },
    { name: EXIT_GROUP, type: "select", proxies: exitList.length > 0 ? exitList : [FRONT_GROUP] },
${opsGroupSnippet}    { name: AI_GROUP, type: "select", proxies: unique([EXIT_GROUP, AIRPORT_GROUP, FRONT_GROUP]) },
    { name: GOOGLE_GROUP, type: "select", proxies: unique([EXIT_GROUP, AIRPORT_GROUP, FRONT_GROUP]) },
    { name: MEDIA_GROUP, type: "select", proxies: unique(defaultGeneral) },
    { name: SOCIAL_GROUP, type: "select", proxies: unique(defaultGeneral) },
    { name: DEV_GROUP, type: "select", proxies: unique(defaultGeneral) },
    { name: AIRPORT_GROUP, type: "select", proxies: unique([FRONT_SPEED, FRONT_STABLE, ...frontManualList, EXIT_GROUP, "DIRECT"]), ...providerManualAttach },
    { name: FALLBACK_GROUP, type: "select", proxies: unique(defaultGeneral) },
  ];

  const mrs = (key, subPath, behavior = "domain") => ({
    type: "http", behavior, format: "mrs", url: MEMBER_CONFIG.mrsMirror + "/" + subPath, path: "./ruleset/" + key + ".mrs", interval: 86400,
  });

  config["rule-providers"] = {
    private_domain: mrs("private_domain", "geosite/private.mrs", "domain"),
    private_ip: mrs("private_ip", "geoip/private.mrs", "ipcidr"),
    ai_domain: mrs("ai_domain", "geosite/category-ai-!cn.mrs", "domain"),
    openai_domain: mrs("openai_domain", "geosite/openai.mrs", "domain"),
    anthropic_domain: mrs("anthropic_domain", "geosite/anthropic.mrs", "domain"),
    gemini_domain: mrs("gemini_domain", "geosite/google-gemini.mrs", "domain"),
    google_domain: mrs("google_domain", "geosite/google.mrs", "domain"),
    youtube_domain: mrs("youtube_domain", "geosite/youtube.mrs", "domain"),
    github_domain: mrs("github_domain", "geosite/github.mrs", "domain"),
    telegram_domain: mrs("telegram_domain", "geosite/telegram.mrs", "domain"),
    telegram_ip: mrs("telegram_ip", "geoip/telegram.mrs", "ipcidr"),
    netflix_domain: mrs("netflix_domain", "geosite/netflix.mrs", "domain"),
    apple_domain: mrs("apple_domain", "geosite/apple.mrs", "domain"),
    microsoft_domain: mrs("microsoft_domain", "geosite/microsoft.mrs", "domain"),
    cn_domain: mrs("cn_domain", "geosite/cn.mrs", "domain"),
    cn_ip: mrs("cn_ip", "geoip/cn.mrs", "ipcidr"),
    proxy_domain: mrs("proxy_domain", "geosite/geolocation-!cn.mrs", "domain"),
  };

  config.rules = [
${opsRuleLine}
    "RULE-SET,private_domain,DIRECT",
    "RULE-SET,private_ip,DIRECT,no-resolve",
    ...(MEMBER_CONFIG.customRejectDomains || []).map((d) => "DOMAIN-SUFFIX," + d + ",REJECT"),
    ...(MEMBER_CONFIG.customDirectDomains || []).map((d) => "DOMAIN-SUFFIX," + d + ",DIRECT"),
    ...(MEMBER_CONFIG.customExitDomains || []).map((d) => "DOMAIN-SUFFIX," + d + "," + EXIT_GROUP),
    "DOMAIN-SUFFIX,locationhistory-pa.googleapis.com,REJECT",
    "DOMAIN-SUFFIX,footprints-pa.googleapis.com,REJECT",
    "DOMAIN-SUFFIX,timeline.google.com,REJECT",
    "DOMAIN-SUFFIX,locationreporting-pa.googleapis.com,REJECT",
    "DOMAIN-SUFFIX,geomobileservices-pa.googleapis.com,REJECT",
    "DOMAIN-SUFFIX,stun.miwifi.com,REJECT",
    "DOMAIN-SUFFIX,stun.qq.com,REJECT",
    "DOMAIN-SUFFIX,stun.chat.bilibili.com,REJECT",
    "DOMAIN-SUFFIX,stun.hitv.com,REJECT",
    "DOMAIN-SUFFIX,stun.cdnbye.com,REJECT",
    "DOMAIN-SUFFIX,stun.l.google.com," + EXIT_GROUP,
    "DOMAIN-SUFFIX,stun.cloudflare.com," + EXIT_GROUP,
    "DOMAIN-SUFFIX,global.stun.twilio.com," + EXIT_GROUP,
    "DOMAIN-SUFFIX,stun.stunprotocol.org," + EXIT_GROUP,
    "DOMAIN-SUFFIX,stun.nextcloud.com," + EXIT_GROUP,
    "DOMAIN-SUFFIX,stun.sipgate.net," + EXIT_GROUP,
    "AND,((NETWORK,UDP),(DST-PORT,443),(NOT,((OR,((RULE-SET,private_domain),(RULE-SET,private_ip,no-resolve),(RULE-SET,cn_domain),(RULE-SET,cn_ip,no-resolve),(RULE-SET,apple_domain),(RULE-SET,microsoft_domain)))))),REJECT",
    "DOMAIN-SUFFIX,ipinfo.io," + EXIT_GROUP,
    "DOMAIN-SUFFIX,ippure.com," + EXIT_GROUP,
    "DOMAIN-SUFFIX,ipure.dev," + EXIT_GROUP,
    "DOMAIN-SUFFIX,scamalytics.com," + EXIT_GROUP,
    "DOMAIN-SUFFIX,ipqualityscore.com," + EXIT_GROUP,
    "DOMAIN-SUFFIX,browserleaks.com," + EXIT_GROUP,
    "DOMAIN-SUFFIX,ipleak.net," + EXIT_GROUP,
    "DOMAIN-SUFFIX,whoer.net," + EXIT_GROUP,
    "DOMAIN-SUFFIX,ip.net.coffee," + EXIT_GROUP,
    "DOMAIN-SUFFIX,ip.sb," + EXIT_GROUP,
    "DOMAIN-SUFFIX,ip.skk.moe," + EXIT_GROUP,
    "DOMAIN-SUFFIX,ping0.cc," + EXIT_GROUP,
    "DOMAIN-SUFFIX,accounts.google.com," + EXIT_GROUP,
    "DOMAIN-SUFFIX,apis.google.com," + EXIT_GROUP,
    "DOMAIN-SUFFIX,aicode.googleapis.com," + AI_GROUP,
    "DOMAIN-SUFFIX,generativelanguage.googleapis.com," + AI_GROUP,
    "DOMAIN-SUFFIX,aistudio.google.com," + AI_GROUP,
    "DOMAIN-SUFFIX,makersuite.google.com," + AI_GROUP,
    "DOMAIN-SUFFIX,alkalimakersuite-pa.clients6.google.com," + AI_GROUP,
    "DOMAIN-SUFFIX,proactivebackend-pa.googleapis.com," + AI_GROUP,
    "DOMAIN-SUFFIX,robinfrontend-pa.googleapis.com," + AI_GROUP,
    "DOMAIN-SUFFIX,ai.google.dev," + AI_GROUP,
    "DOMAIN-SUFFIX,deepmind.com," + AI_GROUP,
    "DOMAIN-SUFFIX,deepmind.google," + AI_GROUP,
    "DOMAIN-SUFFIX,notebooklm.google.com," + AI_GROUP,
    "DOMAIN-SUFFIX,labs.google," + AI_GROUP,
    "DOMAIN-SUFFIX,jules.google.com," + AI_GROUP,
    "DOMAIN-SUFFIX,antigravity.google," + AI_GROUP,
    "DOMAIN-SUFFIX,openai.com," + AI_GROUP,
    "DOMAIN-SUFFIX,chatgpt.com," + AI_GROUP,
    "DOMAIN-SUFFIX,oaistatic.com," + AI_GROUP,
    "DOMAIN-SUFFIX,oaiusercontent.com," + AI_GROUP,
    "DOMAIN-SUFFIX,auth0.com," + AI_GROUP,
    "DOMAIN-SUFFIX,sora.com," + AI_GROUP,
    "DOMAIN-SUFFIX,livekit.cloud," + AI_GROUP,
    "DOMAIN-SUFFIX,ai.com," + AI_GROUP,
    "DOMAIN-SUFFIX,anthropic.com," + AI_GROUP,
    "DOMAIN-SUFFIX,claude.ai," + AI_GROUP,
    "DOMAIN-SUFFIX,claude.com," + AI_GROUP,
    "DOMAIN-SUFFIX,claudeusercontent.com," + AI_GROUP,
    "DOMAIN-SUFFIX,clau.de," + AI_GROUP,
    "DOMAIN-SUFFIX,x.ai," + AI_GROUP,
    "DOMAIN-SUFFIX,grok.com," + AI_GROUP,
    "DOMAIN-SUFFIX,perplexity.ai," + AI_GROUP,
    "DOMAIN-SUFFIX,cursor.sh," + AI_GROUP,
    "DOMAIN-SUFFIX,cursor.com," + AI_GROUP,
    "RULE-SET,openai_domain," + AI_GROUP,
    "RULE-SET,anthropic_domain," + AI_GROUP,
    "RULE-SET,gemini_domain," + AI_GROUP,
    "RULE-SET,ai_domain," + AI_GROUP,
    "DOMAIN-SUFFIX,googlevideo.com," + MEDIA_GROUP,
    "DOMAIN-SUFFIX,youtube.com," + MEDIA_GROUP,
    "DOMAIN-SUFFIX,youtu.be," + MEDIA_GROUP,
    "DOMAIN-SUFFIX,ytimg.com," + MEDIA_GROUP,
    "DOMAIN-SUFFIX,ggpht.com," + MEDIA_GROUP,
    "RULE-SET,youtube_domain," + MEDIA_GROUP,
    "RULE-SET,netflix_domain," + MEDIA_GROUP,
    "RULE-SET,google_domain," + GOOGLE_GROUP,
    "RULE-SET,github_domain," + DEV_GROUP,
    "RULE-SET,telegram_domain," + SOCIAL_GROUP,
    "RULE-SET,telegram_ip," + SOCIAL_GROUP + ",no-resolve",
    "DOMAIN-SUFFIX,zoom.com.cn,DIRECT",
    "DOMAIN-SUFFIX,amazon.cn,DIRECT",
    "DOMAIN-SUFFIX,amazonaws.com.cn,DIRECT",
    "RULE-SET,apple_domain,DIRECT",
    "RULE-SET,microsoft_domain,DIRECT",
    "RULE-SET,proxy_domain," + FALLBACK_GROUP,
    "RULE-SET,cn_domain,DIRECT",
    "RULE-SET,cn_ip,DIRECT",
    "MATCH," + FALLBACK_GROUP,
  ];

  config.sniffer = {
    enable: true,
    "force-dns-mapping": true,
    "parse-pure-ip": true,
    "override-destination": false,
    sniff: {
      HTTP: { ports: [80, "8080-8880"], "override-destination": true },
      TLS: { ports: [443, 8443] },
      QUIC: { ports: [443, 8443] },
    },
    "force-domain": ["+.v2ex.com"],
    "skip-domain": ["Mijia Cloud", "+.push.apple.com"],
    "skip-dst-address": unique([
      ...MEMBER_CONFIG.managedServerIps.filter(Boolean).map((ip) => ip + "/32"),
      "91.105.192.0/23", "91.108.4.0/22", "91.108.8.0/21", "91.108.16.0/21",
      "91.108.56.0/22", "95.161.64.0/20", "149.154.160.0/20", "185.76.151.0/24",
      "2001:67c:4e0::/44", "2001:b28:f230::/44", "2a0a:f280::/29",
    ]),
  };

  config.dns = {
    enable: true,
    ipv6: false,
    "enhanced-mode": "fake-ip",
    "fake-ip-range": "198.18.0.1/16",
    "respect-rules": true,
    "default-nameserver": ["223.5.5.5", "119.29.29.29"],
    "proxy-server-nameserver": ["https://223.5.5.5/dns-query", "https://1.12.12.12/dns-query"],
    "direct-nameserver": ["https://223.5.5.5/dns-query", "https://1.12.12.12/dns-query"],
    nameserver: ["https://1.1.1.1/dns-query", "https://8.8.8.8/dns-query"],
    "nameserver-policy": {
      "rule-set:private_domain,apple_domain,microsoft_domain,cn_domain": [
        "https://223.5.5.5/dns-query",
        "https://1.12.12.12/dns-query",
      ],
    },
    "fake-ip-filter": MEMBER_CONFIG.fakeIpFilter,
  };

  return config;
}
`;
}
