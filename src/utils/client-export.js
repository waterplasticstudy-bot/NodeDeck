/**
 * 纯本地客户端配置生成器（零个人硬编码、全离线按当前节点与成员实时拼装）
 * 支持三种导出形态：
 *   1. bettbox_js       -> Bettbox / Clash Verge Rev 万能通用覆写脚本 v4.3 (.js)
 *   2. all_platform_yaml -> 全平台单链 YAML（iOS 蓝猫 Clash / Stash / Bettbox 通用，含 50MB 内存护栏）
 *   3. nat_provider_yaml -> 云端独立落地清单片段（用于 GitHub Secret Gist / proxy-providers 热更新）
 */

import { DEFAULT_DIALER_PROXY, DEFAULT_SNI } from '../constants/ui-constants.js';

const MRS_MIRROR = 'https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo';

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
  '+.stun.*.*',
  '+.stun.*.*.*',
  '+.stun.*.*.*.*',
  'connectivitycheck.gstatic.com',
  'captive.apple.com',
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

function buildLandingProxyObject(ctx, { includeDialer = true } = {}) {
  const proto = String(ctx.proto || 'vless').toLowerCase();
  const displayName = ctx.landingName || `落地-${ctx.nodeName || '自建节点'}(链式)`;
  const dialer = ctx.dialerProxy || DEFAULT_DIALER_PROXY;
  const base = {
    name: displayName,
    server: ctx.host || '198.51.100.10',
    port: Number(ctx.port || 8443),
  };

  if (proto === 'vless') {
    const obj = {
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
    };
    if (includeDialer) obj['dialer-proxy'] = dialer;
    return obj;
  }

  if (proto === 'shadowsocks') {
    const obj = {
      ...base,
      type: 'ss',
      cipher: ctx.method || '2022-blake3-aes-128-gcm',
      password: ctx.credential || 'REPLACE_PASSWORD',
      udp: true,
    };
    if (includeDialer) obj['dialer-proxy'] = dialer;
    return obj;
  }

  if (proto === 'socks' || proto === 'mixed') {
    const obj = {
      ...base,
      type: 'socks5',
      username: ctx.username || '',
      password: ctx.credential || '',
      udp: true,
    };
    if (includeDialer) obj['dialer-proxy'] = dialer;
    return obj;
  }

  const obj = {
    ...base,
    type: 'http',
    username: ctx.username || '',
    password: ctx.credential || '',
  };
  if (includeDialer) obj['dialer-proxy'] = dialer;
  return obj;
}

function renderProxyYamlBlock(obj, indent = '  ') {
  const q = (v) => JSON.stringify(String(v ?? ''));
  const lines = [`${indent}- name: ${q(obj.name)}`, `${indent}  type: ${obj.type}`, `${indent}  server: ${q(obj.server)}`, `${indent}  port: ${obj.port}`];
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

/** 1. 生成 Bettbox / Clash Verge Rev 万能通用覆写脚本 v4.3 (.js) */
export function buildBettboxUniversalJs(ctx, opts = {}) {
  const devicePreset = opts.devicePreset || 'universal';
  const includeOps = Boolean(opts.includeOpsChannel);
  const landingObj = buildLandingProxyObject(ctx, { includeDialer: true });
  const hostIp = String(ctx.host || '').trim();
  const fakeIpList = getFakeIpList(devicePreset);
  const presetLabel = devicePreset === 'harmony'
    ? '鸿蒙 4/7 专优'
    : devicePreset === 'vivo_win'
      ? 'vivo + Windows 双端'
      : '全平台通用';

  const managedIps = hostIp ? [hostIp] : [];
  const opsGroupSnippet = includeOps
    ? `    {\n      name: OPS_GROUP,\n      type: "select",\n      proxies: [FRONT_GROUP, "DIRECT"],\n    },\n`
    : '';
  const opsRuleLine = includeOps
    ? `    ...MEMBER_CONFIG.managedServerIps.filter(Boolean).map((ip) => "IP-CIDR," + ip + "/32," + OPS_GROUP + ",no-resolve"),`
    : `    ...MEMBER_CONFIG.managedServerIps.filter(Boolean).map((ip) => "IP-CIDR," + ip + "/32," + FRONT_GROUP + ",no-resolve"),`;

  return `// ============================================================================
// NodeDeck 万能通用覆写脚本（Bettbox / Clash Verge Rev / FlClash）
// 成员：${ctx.username || 'member'} · 节点：${ctx.nodeName || 'Self-Hosted'} · 预设：${presetLabel}
// 版本：v4.3-Universal（纯本地生成 · 防崩防污染 · 双模式前置 · 7大体检站锁落地）
// ============================================================================

const MEMBER_CONFIG = {
  managedServerIps: ${JSON.stringify(managedIps, null, 4)},
  landingNodes: [
${JSON.stringify(landingObj, null, 4).split('\n').map((l) => `    ${l}`).join('\n')}
  ],
  defaultOutboundMode: "landing",
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
  const HIGH_MULT_FILTER_STR = "2x|3x|4x|5x|8x|10x|2X|3X|5X|2倍|3倍|5倍";
  const APAC_RE = /香港|台湾|日本|东京|大阪|新加坡|韩国|澳门|Hong\\s*Kong|Taiwan|Japan|Tokyo|Osaka|Singapore|Korea|Macau|(?:^|[^a-zA-Z])(?:HK|TW|JP|SG|KR|MO)(?![a-zA-Z])|🇭🇰|🇹🇼|🇯🇵|🇸🇬|🇰🇷|🇲🇴/i;
  const US_RE = /美国|美西|美东|洛杉矶|硅谷|圣何塞|西雅图|纽约|芝加哥|达拉斯|凤凰城|华盛顿|旧金山|United\\s*States|Los\\s*Angeles|San\\s*Jose|Seattle|Silicon|New\\s*York|Dallas|Chicago|Phoenix|San\\s*Francisco|(?:^|[^a-zA-Z])(?:US|USA)(?![a-zA-Z])|🇺🇸/i;

  function isUSNode(name) {
    if (US_RE.test(name)) return true;
    return /America/i.test(name) && !/South\\s*America|Latin\\s*America/i.test(name);
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
  const normalNodes = sortFrontPriority(airportProxies.filter((p) => getMultiplier(p.name) <= 1));
  const highMultNodes = sortFrontPriority(airportProxies.filter((p) => getMultiplier(p.name) > 1));
  const apacNormal = normalNodes.filter((p) => APAC_RE.test(p.name));
  const apacClean = apacNormal.filter((p) => !isBrokenHy2(p) && !isCfWs(p));
  const apacNoGecko = apacNormal.filter((p) => !isBrokenHy2(p));
  const cleanNormal = normalNodes.filter((p) => !isBrokenHy2(p) && !isCfWs(p));
  const noGeckoNormal = normalNodes.filter((p) => !isBrokenHy2(p));
  const noGeckoAll = airportProxies.filter((p) => !isBrokenHy2(p));

  const candidatePools = [
    apacClean.length >= 2 ? apacClean : [],
    apacClean, apacNoGecko, cleanNormal, noGeckoNormal, noGeckoAll, normalNodes, airportProxies,
  ];
  const speedPool = (candidatePools.find((arr) => arr.length > 0) || []).map((p) => p.name);

  const frontManualList = unique([
    ...apacClean.map((p) => p.name),
    ...apacNormal.map((p) => p.name),
    ...normalNodes.map((p) => p.name),
    ...highMultNodes.map((p) => p.name),
  ]);
  const usFallbackNodes = unique([
    ...normalNodes.filter((p) => isUSNode(p.name)).map((p) => p.name),
    ...highMultNodes.filter((p) => isUSNode(p.name)).map((p) => p.name),
  ]);

  const injectedLandings = [
    ...MEMBER_CONFIG.landingNodes.map((n) => ({ ...n, "dialer-proxy": FRONT_GROUP })),
    ...extraChainedNodes,
  ];
  config.proxies = [...injectedLandings, ...airportProxies];

  const landingNames = injectedLandings.map((n) => n.name);
  const exitList = unique([...landingNames, ...usFallbackNodes]);
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

  config["proxy-groups"] = [
    { name: FRONT_GROUP, type: "select", proxies: unique([FRONT_SPEED, FRONT_STABLE, ...frontManualList]), ...providerManualAttach },
    { name: FRONT_SPEED, type: "url-test", url: "https://www.gstatic.com/generate_204", interval: 300, tolerance: 80, lazy: true, ...autoPoolSource },
    { name: FRONT_STABLE, type: "fallback", url: "https://www.gstatic.com/generate_204", interval: 300, lazy: true, ...autoPoolSource },
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
    "DOMAIN-SUFFIX,locationhistory-pa.googleapis.com,REJECT",
    "DOMAIN-SUFFIX,footprints-pa.googleapis.com,REJECT",
    "DOMAIN-SUFFIX,timeline.google.com,REJECT",
    "DOMAIN-SUFFIX,locationreporting-pa.googleapis.com,REJECT",
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

/** 2. 生成全平台单链 YAML（iOS 蓝猫 Clash / Stash / Bettbox 通用） */
export function buildAllPlatformYaml(ctx, opts = {}) {
  const frontUrl = String(opts.frontSubUrl || '').trim() || 'REPLACE_WITH_FRONT_AIRPORT_SUB_URL';
  const cloudNatUrl = String(opts.cloudLandingUrl || '').trim();
  const useCloudLanding = Boolean(cloudNatUrl);
  const devicePreset = opts.devicePreset || 'universal';
  const includeOps = Boolean(opts.includeOpsChannel);
  const excludeYueGecko = opts.excludeGecko !== false;
  const hostIp = String(ctx.host || '').trim();
  const landingObj = buildLandingProxyObject(ctx, { includeDialer: true });
  const fakeIpList = getFakeIpList(devicePreset);
  const excludeFilter = excludeYueGecko
    ? '(?i)(1💎|[^0-9]1$|2x|3x|4x|5x|8x|10x|2倍|3倍|5倍)'
    : '(?i)(2x|3x|4x|5x|8x|10x|2倍|3倍|5倍)';

  const inlineProxiesSection = useCloudLanding
    ? ''
    : `proxies:\n${renderProxyYamlBlock(landingObj, '  ')}\n\n`;

  const cloudProviderSection = useCloudLanding
    ? `
  # 云端落地池（修改云端清单后全平台自动热同步；override 自动套上前置代理）
  landing_cloud:
    type: http
    url: ${JSON.stringify(cloudNatUrl)}
    path: ./proxies/landing_cloud.yaml
    interval: 3600
    proxy: "前置代理"
    override:
      dialer-proxy: "前置代理"
      udp: true
    health-check:
      enable: true
      url: "https://www.gstatic.com/generate_204"
      interval: 600
      lazy: true
`
    : '';

  const exitGroupBody = useCloudLanding
    ? `    use:\n      - landing_cloud`
    : `    proxies:\n      - ${JSON.stringify(landingObj.name)}`;

  const opsGroupYaml = includeOps
    ? `
  - name: "🔧 运维通道"
    type: select
    proxies:
      - "前置代理"
      - DIRECT
`
    : '';

  const opsRuleYaml = hostIp
    ? `  - IP-CIDR,${hostIp}/32,${includeOps ? '🔧 运维通道' : '前置代理'},no-resolve\n`
    : '';

  const skipHostYaml = hostIp ? `    - "${hostIp}/32"\n` : '';

  const rp = (key, subPath, behavior = 'domain') => [
    `  ${key}:`,
    '    type: http',
    `    behavior: ${behavior}`,
    '    format: mrs',
    `    url: "${MRS_MIRROR}/${subPath}"`,
    `    path: ./ruleset/${key}.mrs`,
    '    interval: 86400',
  ].join('\n');

  return `# ============================================================================
# NodeDeck 全平台单链配置（iOS 蓝猫 Clash / Stash / Bettbox 通用）
# 成员：${ctx.username || 'member'} · 落地模式：${useCloudLanding ? '云端双 Provider 自动热同步' : '内置专属落地节点'}
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

${inlineProxiesSection}proxy-providers:
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
      url: "https://www.gstatic.com/generate_204"
      interval: 600
      lazy: true
${cloudProviderSection}
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
    url: "https://www.gstatic.com/generate_204"
    interval: 300
    lazy: true
    use:
      - front_airport
    filter: "(?i)香港|台湾|日本|新加坡|韩国|澳门|HK|TW|JP|SG|KR|MO"
    exclude-filter: ${JSON.stringify(excludeFilter)}

  - name: "⚡ 前置测速"
    type: url-test
    url: "https://www.gstatic.com/generate_204"
    interval: 300
    tolerance: 80
    lazy: true
    use:
      - front_airport
    filter: "(?i)香港|台湾|日本|新加坡|韩国|澳门|HK|TW|JP|SG|KR|MO"
    exclude-filter: ${JSON.stringify(excludeFilter)}

  - name: "落地出口"
    type: select
${exitGroupBody}
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
      - "落地出口"
      - "🚀 机场直出"
      - "前置代理"
      - DIRECT

  - name: "💬 Telegram & 社交"
    type: select
    proxies:
      - "落地出口"
      - "🚀 机场直出"
      - "前置代理"
      - DIRECT

  - name: "💻 GitHub & 开发"
    type: select
    proxies:
      - "落地出口"
      - "🚀 机场直出"
      - "前置代理"
      - DIRECT

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
      - "落地出口"
      - "🚀 机场直出"
      - "前置代理"
      - DIRECT

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
  - DOMAIN-SUFFIX,locationhistory-pa.googleapis.com,REJECT
  - DOMAIN-SUFFIX,footprints-pa.googleapis.com,REJECT
  - DOMAIN-SUFFIX,timeline.google.com,REJECT
  - DOMAIN-SUFFIX,locationreporting-pa.googleapis.com,REJECT
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

/** 3. 生成云端 nat-landing.yaml 节点清单片段（不含 dialer-proxy，供 proxy-providers override 自动链式） */
export function buildCloudLandingSnippet(ctx) {
  const obj = buildLandingProxyObject(ctx, { includeDialer: false });
  return [
    '# 云端落地节点清单片段（适用于 GitHub Secret Gist / Mihomo proxy-providers）',
    '# 无需写 dialer-proxy：主配置里的 override.dialer-proxy 会自动将其套上「前置代理」',
    'proxies:',
    renderProxyYamlBlock(obj, '  '),
    '',
  ].join('\n');
}

/** 触发本地浏览器 Blob 下载（纯离线，零额外权限） */
export function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
