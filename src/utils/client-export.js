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
const KEYWORD_CLEAN_RE = /^[a-z0-9._-]{2,64}$/i;
const PROCESS_CLEAN_RE = /^[a-z0-9._ -]{2,96}$/i;
const GO_RE2_UNSUPPORTED_RE = /(?:\(\?=|\(\?!|\(\?<=|\(\?<!)/;

/** 内置主流 APP / 服务分流预设目录（纯域名/关键字全平台通用，兼容鸿蒙卓易通/出境易/iOS/Win/Mac，零个人隐私） */
export const APP_ROUTE_CATALOG = [
  {
    id: 'bybit',
    category: 'finance',
    name: 'Bybit',
    icon: '🟡',
    domains: [
      'bybit.com', 'bytick.com', 'bybit-global.com', 'bybitglobal.com', 'bycsi.com',
      'byabcde.com', 'byapps.net', 'bybdc6.com', 'byd3c3.com', 'bycbe.com',
      'bymj.io', 'byapis.com', 'bybit.biz', 'bybit.cloud', 'bybit.ada.support',
      'bybit-exchange.github.io',
    ],
    keywords: ['bybit'],
    processes: [],
    ruleSet: { key: 'app_bybit', path: 'geosite/bybit.mrs' },
    defaultTargetMode: 'custom_group',
    defaultFallbackRegions: ['JP', 'KR', 'TW'],
    blockedRegions: ['US', 'HK', 'SG', 'CA', 'GB'],
    note: '严禁美国/香港/新加坡/加拿大/英国 IP；已内置 byd3c3/bybdc6 等轮换域名 + 官方每日更新 geosite/bybit.mrs 防漏',
  },
  {
    id: 'binance',
    category: 'finance',
    name: '币安 Binance',
    icon: '🟡',
    domains: [
      'binance.com', 'binance.me', 'binance.info', 'binance.org', 'binance.cloud',
      'binance.cc', 'binance.co', 'binance.net', 'binance.vision', 'binanceapi.com',
      'binancecnt.com', 'binancezh.com', 'binancezh.cc', 'binancezh.pro', 'binancezh.top',
      'binancezh.biz', 'bnbstatic.com', 'bnbchain.org', 'bnappzh.co', 'bnappweb.black',
      'bmwweb.solutions', 'bsappapi.cc', 'bsappapi.com', 'bscdnweb.com', 'bntrace.com',
      'nftstatic.com', 'saasexch.com', 'saasexch.co', 'saasexch.cc', 'saasexch.info', 'saasexch.io',
    ],
    keywords: ['binance'],
    processes: [],
    ruleSet: { key: 'app_binance', path: 'geosite/binance.mrs' },
    defaultTargetMode: 'custom_group',
    defaultFallbackRegions: ['TW', 'JP', 'KR'],
    blockedRegions: ['US', 'HK', 'SG', 'CA', 'GB'],
    note: '严禁美国/香港/新加坡/加拿大/英国 IP；已内置全套镜像域名 + 官方每日更新 geosite/binance.mrs 防漏',
  },
  {
    id: 'okx',
    category: 'finance',
    name: 'OKX 欧易',
    icon: '🪙',
    domains: ['okx.com', 'okex.com', 'oklink.com', 'okx-dns.com', 'okx-dns1.com', 'okx-dns2.com'],
    keywords: [],
    processes: [],
    ruleSet: { key: 'app_okx', path: 'geosite/okx.mrs' },
    defaultTargetMode: 'custom_group',
    defaultFallbackRegions: ['TW', 'JP', 'KR'],
    blockedRegions: ['US', 'HK', 'SG'],
    note: '避开美国/香港/新加坡禁区，含官方 geosite/okx.mrs 规则集',
  },
  {
    id: 'google_pay',
    category: 'finance',
    name: 'Google 钱包',
    icon: '💳',
    domains: ['pay.google.com', 'wallet.google.com', 'payments.google.com', 'payments-pa.googleapis.com', 'pay.googleapis.com'],
    keywords: [],
    processes: [],
    defaultTargetMode: 'custom_group',
    defaultFallbackRegions: ['US', 'JP'],
    blockedRegions: ['HK'],
    note: '推荐锁定与 Google 账号/发卡地一致的纯净节点',
  },
  {
    id: 'chatgpt',
    category: 'ai',
    name: 'ChatGPT',
    icon: '🤖',
    domains: ['openai.com', 'chatgpt.com', 'oaistatic.com', 'oaiusercontent.com', 'sora.com', 'livekit.cloud', 'auth0.com'],
    keywords: [],
    processes: [],
    defaultTargetMode: 'custom_group',
    defaultFallbackRegions: ['US', 'JP', 'KR'],
    blockedRegions: ['HK'],
    note: '严禁香港 IP，推荐美国/日本/韩国纯净家宽',
  },
  {
    id: 'claude',
    category: 'ai',
    name: 'Claude',
    icon: '🧠',
    domains: ['anthropic.com', 'claude.ai', 'claude.com', 'claudeusercontent.com', 'clau.de'],
    keywords: [],
    processes: [],
    defaultTargetMode: 'custom_group',
    defaultFallbackRegions: ['US', 'JP'],
    blockedRegions: ['HK'],
    note: '对 IP 纯净度敏感，严禁香港，推荐美/日家宽落地',
  },
  {
    id: 'gemini',
    category: 'ai',
    name: 'Gemini',
    icon: '✨',
    domains: ['gemini.google.com', 'aistudio.google.com', 'generativelanguage.googleapis.com', 'aicode.googleapis.com', 'makersuite.google.com', 'alkalimakersuite-pa.clients6.google.com', 'proactivebackend-pa.googleapis.com', 'robinfrontend-pa.googleapis.com', 'ai.google.dev', 'deepmind.google', 'notebooklm.google.com', 'labs.google', 'antigravity.google'],
    keywords: [],
    processes: [],
    defaultTargetMode: 'custom_group',
    defaultFallbackRegions: ['US', 'JP', 'KR'],
    blockedRegions: ['HK'],
    note: '严禁香港 IP，推荐美/日/韩纯净节点',
  },
  {
    id: 'grok',
    category: 'ai',
    name: 'Grok',
    icon: '⚡',
    domains: ['grok.com', 'x.ai', 'grok.x.ai'],
    keywords: [],
    processes: [],
    defaultTargetMode: 'custom_group',
    defaultFallbackRegions: ['US', 'JP'],
    blockedRegions: ['HK'],
    note: '可单独指定节点，严禁香港',
  },
  {
    id: 'youtube',
    category: 'social',
    name: 'YouTube',
    icon: '🎬',
    domains: ['youtube.com', 'youtu.be', 'googlevideo.com', 'ytimg.com', 'ggpht.com'],
    keywords: [],
    processes: [],
    defaultTargetMode: 'airport',
    defaultFallbackRegions: ['HK', 'TW', 'JP', 'SG'],
    blockedRegions: [],
    note: '大流量视频默认走机场直出省 NAT 配额，也可锁特定地区',
  },
  {
    id: 'telegram',
    category: 'social',
    name: 'Telegram',
    icon: '✈️',
    domains: ['t.me', 'telegram.org', 'telegram.me', 'tdesktop.com', 'telesco.pe'],
    keywords: [],
    processes: [],
    defaultTargetMode: 'airport',
    defaultFallbackRegions: ['SG', 'HK', 'JP'],
    blockedRegions: [],
    note: '推荐低延迟新加坡/香港/日本节点',
  },
  {
    id: 'x_twitter',
    category: 'social',
    name: 'X / Twitter',
    icon: '🐦',
    domains: ['x.com', 'twitter.com', 'twimg.com', 't.co'],
    keywords: [],
    processes: [],
    ruleSet: { key: 'app_twitter', path: 'geosite/twitter.mrs' },
    defaultTargetMode: 'airport',
    defaultFallbackRegions: ['JP', 'TW', 'US'],
    blockedRegions: [],
    note: '日常浏览走机场省流，养号可绑纯净落地（含 geosite/twitter.mrs）',
  },
  {
    id: 'instagram',
    category: 'social',
    name: 'Instagram',
    icon: '📸',
    domains: ['instagram.com', 'cdninstagram.com', 'ig.me'],
    keywords: [],
    processes: [],
    ruleSet: { key: 'app_instagram', path: 'geosite/instagram.mrs' },
    defaultTargetMode: 'airport',
    defaultFallbackRegions: ['JP', 'TW', 'US'],
    blockedRegions: [],
    note: '建议固定地区，减少异地登录风控验证（含 geosite/instagram.mrs）',
  },
  {
    id: 'gmail',
    category: 'social',
    name: 'Gmail',
    icon: '📧',
    domains: ['mail.google.com', 'gmail.com', 'accounts.google.com'],
    keywords: [],
    processes: [],
    defaultTargetMode: 'custom_group',
    defaultFallbackRegions: ['US', 'JP'],
    blockedRegions: [],
    note: '账号登录收码推荐锁定稳定纯净节点',
  },
  {
    id: 'tiktok',
    category: 'social',
    name: 'TikTok',
    icon: '🎵',
    domains: ['tiktok.com', 'tiktokv.com', 'tiktokcdn.com', 'tiktokcdn-us.com', 'musical.ly', 'byteoversea.com', 'ibytedtos.com'],
    keywords: [],
    processes: [],
    ruleSet: { key: 'app_tiktok', path: 'geosite/tiktok.mrs' },
    defaultTargetMode: 'custom_group',
    defaultFallbackRegions: ['JP', 'TW', 'US'],
    blockedRegions: ['HK'],
    note: '严禁香港 IP，推荐锁日本/台湾/美国（含 geosite/tiktok.mrs）',
  },
  {
    id: 'pixiv',
    category: 'acg',
    name: 'Pixiv',
    icon: '🎨',
    domains: ['pixiv.net', 'pximg.net', 'pixiv.org', 'fanbox.cc', 'booth.pm'],
    keywords: [],
    processes: [],
    ruleSet: { key: 'app_pixiv', path: 'geosite/pixiv.mrs' },
    defaultTargetMode: 'custom_group',
    defaultFallbackRegions: ['JP', 'TW'],
    blockedRegions: [],
    note: '推荐日本/台湾节点，载图更快（含 geosite/pixiv.mrs）',
  },
  {
    id: 'ehviewer',
    category: 'acg',
    name: 'EhViewer',
    icon: '📚',
    domains: ['e-hentai.org', 'exhentai.org', 'ehgt.org', 'hath.network'],
    keywords: [],
    processes: [],
    ruleSet: { key: 'app_ehentai', path: 'geosite/ehentai.mrs' },
    defaultTargetMode: 'custom_group',
    defaultFallbackRegions: ['JP', 'DE', 'US'],
    blockedRegions: ['HK'],
    note: '部分香港共享 IP 易被限制，推荐日本/德国/纯净节点（含 geosite/ehentai.mrs）',
  },
  {
    id: 'jmcomic',
    category: 'acg',
    name: 'JMComic',
    icon: '📖',
    domains: ['18comic.vip', '18comic.org', 'jmcomic.me', 'jmcomic1.me', 'jmcomic.one', 'jm365.work', 'jm-comic.cc', 'jm-comic1.cc', 'jm-comic2.cc', 'jm-comic3.cc'],
    keywords: ['18comic', 'jmcomic'],
    processes: [],
    defaultTargetMode: 'airport',
    defaultFallbackRegions: ['TW', 'HK', 'JP'],
    blockedRegions: [],
    note: '自带域名关键字防镜像漏网，推荐走机场高速节点',
  },
  {
    id: 'steam',
    category: 'acg',
    name: 'Steam 商店',
    icon: '🎮',
    domains: ['steampowered.com', 'steamcommunity.com', 'steamstatic.com', 'steamgames.com', 'steam-chat.com', 'steamusercontent.com'],
    keywords: [],
    processes: [],
    ruleSet: { key: 'app_steam', path: 'geosite/steam.mrs' },
    defaultTargetMode: 'custom_group',
    defaultFallbackRegions: ['HK', 'TW', 'JP'],
    blockedRegions: [],
    note: '仅分流商店/社区防跨区异常（含 geosite/steam.mrs）',
  },
];

const APP_CATALOG_MAP = new Map(APP_ROUTE_CATALOG.map((a) => [a.id, a]));
const BUILTIN_GROUP_NAMES = new Set([
  '前置代理', '⚡ 前置测速', '🛡️ 前置稳定', '落地出口', '🔧 运维通道',
  '🚀 机场直出', '🤖 AI 服务', '🔍 Google 服务', '🎬 YouTube & 流媒体',
  '💬 Telegram & 社交', '💻 GitHub & 开发', '🐟 漏网之鱼',
  'DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE', 'GLOBAL',
]);

export function parseCustomTokenList(raw, regex) {
  const tokens = Array.isArray(raw) ? raw : String(raw || '').split(/[\r\n,;，；]+/);
  const valid = [];
  const invalid = [];
  const seen = new Set();
  for (const tok of tokens) {
    const cleaned = String(tok || '').trim();
    if (!cleaned || cleaned.startsWith('#')) continue;
    const key = cleaned.toLowerCase();
    if (regex.test(cleaned)) {
      if (!seen.has(key)) {
        seen.add(key);
        valid.push(cleaned);
      }
    } else {
      invalid.push(cleaned);
    }
  }
  return { valid, invalid };
}

/** 根据已勾选节点自动为预设 APP 创建防风控初始分流条目（自动跳过禁区国家落地） */
export function createAppRouteFromPreset(presetId, selectedCtxs = []) {
  const preset = APP_CATALOG_MAP.get(presetId);
  if (!preset) return null;
  const blocked = new Set(preset.blockedRegions || []);
  const safeLandingKeys = [];
  for (const c of normalizeCtxList(selectedCtxs)) {
    const regs = inferRegionsFromCtxs([c]);
    if (regs.length > 0 && regs.every((r) => !blocked.has(r))) {
      if (c.key) safeLandingKeys.push(c.key);
    }
  }
  return {
    id: `app_${preset.id}_${Date.now().toString(36)}`,
    presetId: preset.id,
    name: preset.name,
    icon: preset.icon,
    domains: [...preset.domains],
    keywords: [...preset.keywords],
    processes: [...preset.processes],
    targetMode: preset.defaultTargetMode || 'custom_group',
    landingKeys: preset.defaultTargetMode === 'custom_group' ? safeLandingKeys : [],
    fallbackRegions: [...(preset.defaultFallbackRegions || [])],
    blockedRegions: [...(preset.blockedRegions || [])],
  };
}

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
  const keyToProxyName = new Map();
  const proxyNameToCtx = new Map();
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
    if (ctx.key) keyToProxyName.set(ctx.key, displayName);
    proxyNameToCtx.set(displayName, ctx);

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
  return { proxies, managedIps, keyToProxyName, proxyNameToCtx };
}

/** 解析并校验自定义 APP 专属分流列表（支持独立策略组、节点精确绑定、防风控禁区预警与防重名） */
export function resolveAppRoutes(rawRoutes, ctxs, landingBundle, opts = {}) {
  const routesIn = Array.isArray(rawRoutes) ? rawRoutes : [];
  const { proxies = [], keyToProxyName = new Map(), proxyNameToCtx = new Map() } = landingBundle || {};
  const validProxyNames = new Set(proxies.map((p) => p.name));
  const exitFb = resolveExitFallback(ctxs, opts);
  const frontReg = resolveFrontRegion(opts);
  const usedGroupNames = new Set(BUILTIN_GROUP_NAMES);

  const resolved = [];
  const errors = [];
  const warnings = [];
  let totalRuleEntries = 0;

  for (let i = 0; i < routesIn.length; i += 1) {
    const raw = routesIn[i];
    if (!raw || typeof raw !== 'object') continue;
    const baseName = String(raw.name || '').replace(/[\r\n,]+/g, ' ').trim();
    if (!baseName) {
      errors.push(`第 ${i + 1} 条 APP 分流缺少名称`);
      continue;
    }
    const icon = String(raw.icon || '').replace(/[\r\n,]+/g, '').trim();
    const domainsRes = parseCustomDomainLines(raw.domains);
    const keywordsRes = parseCustomTokenList(raw.keywords, KEYWORD_CLEAN_RE);
    const processesRes = parseCustomTokenList(raw.processes, PROCESS_CLEAN_RE);

    if (domainsRes.invalid.length) {
      errors.push(`APP「${baseName}」含非法域名：${domainsRes.invalid.slice(0, 3).join(', ')}`);
    }
    if (keywordsRes.invalid.length) {
      errors.push(`APP「${baseName}」含非法关键字：${keywordsRes.invalid.slice(0, 2).join(', ')}`);
    }
    if (processesRes.invalid.length) {
      errors.push(`APP「${baseName}」含非法进程名：${processesRes.invalid.slice(0, 2).join(', ')}`);
    }
    const ruleCount = domainsRes.valid.length + keywordsRes.valid.length + processesRes.valid.length;
    if (ruleCount === 0) {
      errors.push(`APP「${baseName}」至少需要填写 1 个域名、关键字或进程名`);
      continue;
    }

    const rawMode = String(raw.targetMode || 'custom_group').trim();
    const targetMode = ['custom_group', 'exit', 'airport', 'direct', 'reject'].includes(rawMode)
      ? rawMode
      : 'custom_group';

    let groupName = '';
    let groupTarget = '落地出口';
    if (targetMode === 'exit') {
      groupTarget = '落地出口';
    } else if (targetMode === 'airport') {
      groupTarget = '🚀 机场直出';
    } else if (targetMode === 'direct') {
      groupTarget = 'DIRECT';
    } else if (targetMode === 'reject') {
      groupTarget = 'REJECT';
    } else {
      const rawGroup = icon && !baseName.startsWith(icon) ? `${icon} ${baseName}` : baseName;
      let candidate = rawGroup;
      let seq = 2;
      while (usedGroupNames.has(candidate)) {
        candidate = `${rawGroup} (${seq++})`;
      }
      usedGroupNames.add(candidate);
      groupName = candidate;
      groupTarget = candidate;
    }

    const landingNames = [];
    for (const lk of (Array.isArray(raw.landingKeys) ? raw.landingKeys : [])) {
      const mapped = keyToProxyName.get(lk) || (validProxyNames.has(lk) ? lk : '');
      if (mapped && !landingNames.includes(mapped)) {
        landingNames.push(mapped);
      }
    }

    const fallbackRegions = EXPORT_REGIONS.map((r) => r.code).filter((c) => (raw.fallbackRegions || []).includes(c));
    const fallbackRe2 = buildRegionRe2(fallbackRegions, true);
    const fallbackRawPattern = buildRegionRe2(fallbackRegions, false);

    if (targetMode === 'custom_group' && !landingNames.length && !fallbackRegions.length) {
      warnings.push(`APP「${baseName}」未绑定任何自建落地或备选国家，将临时回退至「落地出口」`);
    }

    const blockedRegions = EXPORT_REGIONS.map((r) => r.code).filter((c) => (raw.blockedRegions || []).includes(c));
    if (blockedRegions.length) {
      const effectiveRegions = new Set();
      if (targetMode === 'custom_group') {
        for (const pname of landingNames) {
          const ctx = proxyNameToCtx.get(pname);
          if (ctx) inferRegionsFromCtxs([ctx]).forEach((r) => effectiveRegions.add(r));
        }
        fallbackRegions.forEach((r) => effectiveRegions.add(r));
        if (!landingNames.length && !fallbackRegions.length) {
          inferRegionsFromCtxs(ctxs).forEach((r) => effectiveRegions.add(r));
          exitFb.regions.forEach((r) => effectiveRegions.add(r));
        }
      } else if (targetMode === 'exit') {
        inferRegionsFromCtxs(ctxs).forEach((r) => effectiveRegions.add(r));
        exitFb.regions.forEach((r) => effectiveRegions.add(r));
      } else if (targetMode === 'airport') {
        if (frontReg.regions.length) frontReg.regions.forEach((r) => effectiveRegions.add(r));
        else blockedRegions.forEach((r) => effectiveRegions.add(r));
      }
      const hits = blockedRegions.filter((r) => effectiveRegions.has(r));
      if (hits.length) {
        warnings.push(`🚨 风控预警：「${baseName}」出口包含禁区 (${hits.join('/')})，易触发风控，建议改绑安全地区或专用节点`);
      }
    }

    const presetInfo = raw.presetId ? APP_CATALOG_MAP.get(raw.presetId) : null;
    const ruleSet = presetInfo?.ruleSet || null;

    totalRuleEntries += ruleCount + (ruleSet ? 1 : 0);
    resolved.push({
      id: raw.id || `app_${i + 1}`,
      presetId: raw.presetId || '',
      name: baseName,
      icon,
      groupName,
      groupTarget,
      targetMode,
      landingNames,
      fallbackRegions,
      fallbackRe2,
      fallbackRawPattern,
      fallbackIncludesUS: fallbackRegions.includes('US'),
      blockedRegions,
      ruleSet,
      domains: domainsRes.valid,
      keywords: keywordsRes.valid,
      processes: processesRes.valid,
    });
  }

  const ruleProviderMap = new Map();
  for (const r of resolved) {
    if (r.ruleSet && !ruleProviderMap.has(r.ruleSet.key)) {
      ruleProviderMap.set(r.ruleSet.key, r.ruleSet);
    }
  }
  return { routes: resolved, ruleProviders: [...ruleProviderMap.values()], errors, warnings, totalRuleEntries };
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
  const landingBundle = buildLandingProxyList(list, extraIps);
  const { proxies, managedIps } = landingBundle;
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
  const appResolved = resolveAppRoutes(opts.appRoutes, list, landingBundle, opts);
  errors.push(...appResolved.errors);
  warnings.push(...appResolved.warnings);

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
    appRouteCount: appResolved.routes.length,
    customRuleCount: exitDomains.valid.length + directDomains.valid.length + rejectDomains.valid.length + appResolved.totalRuleEntries,
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
  const landingBundle = buildLandingProxyList(list, extraIps);
  const { proxies: landingList, managedIps } = landingBundle;
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
  const appResolved = resolveAppRoutes(opts.appRoutes, list, landingBundle, opts);
  const hasProcessRules = appResolved.routes.some((r) => r.processes.length > 0);

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

  const appGroupsYaml = appResolved.routes
    .filter((r) => r.targetMode === 'custom_group')
    .map((r) => {
      const pList = r.landingNames.length
        ? r.landingNames
        : (!r.fallbackRe2 ? ['落地出口'] : []);
      const lines = [
        `  - name: ${JSON.stringify(r.groupName)}`,
        '    type: select',
      ];
      if (pList.length) {
        lines.push('    proxies:');
        pList.forEach((n) => lines.push(`      - ${JSON.stringify(n)}`));
      }
      if (r.fallbackRe2) {
        lines.push(
          '    use:',
          '      - front_airport',
          `    filter: ${JSON.stringify(r.fallbackRe2)}`,
        );
      }
      return `\n${lines.join('\n')}`;
    })
    .join('\n');

  const appRuleLines = [];
  for (const r of appResolved.routes) {
    r.processes.forEach((p) => appRuleLines.push(`  - PROCESS-NAME,${p},${r.groupTarget}`));
    r.keywords.forEach((k) => appRuleLines.push(`  - DOMAIN-KEYWORD,${k},${r.groupTarget}`));
    r.domains.forEach((d) => appRuleLines.push(`  - DOMAIN-SUFFIX,${d},${r.groupTarget}`));
    if (r.ruleSet) appRuleLines.push(`  - RULE-SET,${r.ruleSet.key},${r.groupTarget}`);
  }
  const appRulesYaml = appRuleLines.length ? `${appRuleLines.join('\n')}\n` : '';

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
find-process-mode: ${hasProcessRules ? 'strict' : 'off'}
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
${opsGroupYaml}${appGroupsYaml ? `${appGroupsYaml}\n` : ''}
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
    ...appResolved.ruleProviders.map((p) => rp(p.key, p.path, 'domain')),
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
${appRulesYaml}  - DOMAIN-SUFFIX,ipinfo.io,落地出口
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

/** 2. 生成 Bettbox / Clash Verge Rev 万能通用覆写脚本 v4.5 (.js)（支持多落地组合 + APP 专属分流 + 防风控护栏） */
export function buildBettboxUniversalJs(ctxs, opts = {}) {
  const list = normalizeCtxList(ctxs);
  const extraIps = opts.includeOpsChannel && opts.includeAllManagedIps ? (opts.extraManagedIps || []) : [];
  const landingBundle = buildLandingProxyList(list, extraIps);
  const { proxies: landingList, managedIps } = landingBundle;
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
  const appResolved = resolveAppRoutes(opts.appRoutes, list, landingBundle, opts);
  const appRoutesPayload = appResolved.routes.map((r) => ({
    groupName: r.groupName,
    targetMode: r.targetMode,
    groupTarget: r.groupTarget,
    landingNames: r.landingNames,
    fallbackPattern: r.fallbackRawPattern,
    fallbackIncludesUS: r.fallbackIncludesUS,
    ruleSetKey: r.ruleSet ? r.ruleSet.key : '',
    ruleSetPath: r.ruleSet ? r.ruleSet.path : '',
    domains: r.domains,
    keywords: r.keywords,
    processes: r.processes,
  }));

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
// 预设：${presetLabel} ｜ 落地备选：${exitFb.regions.length ? exitFb.regions.join('+') : '仅自建落地'} ｜ 前置优选：${frontReg.label}${appRoutesPayload.length ? ` ｜ 专属 APP 分流：${appRoutesPayload.length} 组` : ''}
// 版本：v4.5-DIY（纯本地离线生成 · APP 防风控分流 · 精准倍率识别 · 防崩防污染）
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
  appRoutes: ${JSON.stringify(appRoutesPayload, null, 2)},
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

  const customAppRouteList = Array.isArray(MEMBER_CONFIG.appRoutes) ? MEMBER_CONFIG.appRoutes : [];
  const RESERVED_NAMES = new Set([
    FRONT_GROUP, FRONT_SPEED, FRONT_STABLE, EXIT_GROUP, OPS_GROUP,
    AIRPORT_GROUP, AI_GROUP, GOOGLE_GROUP, MEDIA_GROUP,
    SOCIAL_GROUP, DEV_GROUP, FALLBACK_GROUP,
    ...customAppRouteList.filter((r) => r && r.targetMode === "custom_group" && r.groupName).map((r) => r.groupName),
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
  const landingNameSet = new Set(landingNames);
  const customAppGroups = [];
  const customAppRules = [];
  let hasAppProcessRule = false;
  for (const r of customAppRouteList) {
    if (!r || !r.groupTarget) continue;
    if (r.targetMode === "custom_group" && r.groupName) {
      const boundLandings = (Array.isArray(r.landingNames) ? r.landingNames : []).filter((n) => landingNameSet.has(n));
      let regMatched = [];
      if (r.fallbackPattern) {
        let regRe = null;
        try { regRe = new RegExp(r.fallbackPattern, "i"); } catch (_) { regRe = null; }
        const matchReg = (name) => {
          const text = String(name || "");
          if (regRe && regRe.test(text)) return true;
          if (r.fallbackIncludesUS) return /America/i.test(text) && !/South\\s*America|Latin\\s*America/i.test(text);
          return false;
        };
        regMatched = unique([
          ...normalNodes.filter((p) => matchReg(p.name)).map((p) => p.name),
          ...highMultNodes.filter((p) => matchReg(p.name)).map((p) => p.name),
        ]);
      }
      const groupProxies = unique([...boundLandings, ...regMatched]);
      const grp = { name: r.groupName, type: "select" };
      if (groupProxies.length > 0) {
        grp.proxies = groupProxies;
      }
      if (hasProxyProviders && regMatched.length === 0 && r.fallbackPattern) {
        grp.use = providerKeys;
        grp.filter = "(?i)" + r.fallbackPattern;
      }
      if (!grp.proxies && !grp.use) {
        grp.proxies = [EXIT_GROUP];
      }
      customAppGroups.push(grp);
    }
    for (const proc of (Array.isArray(r.processes) ? r.processes : [])) {
      hasAppProcessRule = true;
      customAppRules.push("PROCESS-NAME," + proc + "," + r.groupTarget);
    }
    for (const kw of (Array.isArray(r.keywords) ? r.keywords : [])) {
      customAppRules.push("DOMAIN-KEYWORD," + kw + "," + r.groupTarget);
    }
    for (const dom of (Array.isArray(r.domains) ? r.domains : [])) {
      customAppRules.push("DOMAIN-SUFFIX," + dom + "," + r.groupTarget);
    }
    if (r.ruleSetKey && r.ruleSetPath) {
      customAppRules.push("RULE-SET," + r.ruleSetKey + "," + r.groupTarget);
    }
  }
  if (hasAppProcessRule) {
    config["find-process-mode"] = "strict";
  }

  config["proxy-groups"] = [
    { name: FRONT_GROUP, type: "select", proxies: unique([FRONT_SPEED, FRONT_STABLE, ...frontManualList]), ...providerManualAttach },
    { name: FRONT_SPEED, type: "url-test", url: probeUrl, interval: 300, tolerance: 80, lazy: true, ...autoPoolSource },
    { name: FRONT_STABLE, type: "fallback", url: probeUrl, interval: 300, lazy: true, ...autoPoolSource },
    { name: EXIT_GROUP, type: "select", proxies: exitList.length > 0 ? exitList : [FRONT_GROUP] },
${opsGroupSnippet}    ...customAppGroups,
    { name: AI_GROUP, type: "select", proxies: unique([EXIT_GROUP, AIRPORT_GROUP, FRONT_GROUP]) },
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
  for (const r of customAppRouteList) {
    if (r && r.ruleSetKey && r.ruleSetPath && !config["rule-providers"][r.ruleSetKey]) {
      config["rule-providers"][r.ruleSetKey] = mrs(r.ruleSetKey, r.ruleSetPath, "domain");
    }
  }

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
    ...customAppRules,
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
