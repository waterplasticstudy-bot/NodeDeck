// ============================================================================
// NodeDeck Universal Mihomo / Clash Meta JS Override Template (Zero-Privacy Example)
// Version: v4.3-Universal | Compatible with: Bettbox, Clash Verge Rev, FlClash, Mihomo v1.19+
//
// Design Principles:
//   1. Provider-Agnostic & Crash-Proof: Sanitizes upstream hosts/sub-rules/geodata-mode,
//      auto-renames colliding proxy names, handles inline & proxy-providers subscriptions.
//   2. Zero SSH / Management Loopback Deadlock: Dedicated "🔧 运维通道" routes self-hosted
//      VPS/NAT management IPs via 1-hop Front-Hop (with DIRECT emergency fallback).
//   3. Dual Front-Hop Strategy: "⚡ 前置测速" (url-test, excludes gecko Hy2 & CF-WS CDN)
//      + "🛡️ 前置稳定" (fallback, zero-drift battery-saving failover for mobile).
//   4. Anti-Leak & Shared Cache: 17 MetaCubeX .mrs with shared ./ruleset/ cache,
//      proxy_domain before cn_domain, safe SNI sniffer, dns.ipv6=false, fine-grained QUIC.
// ============================================================================

const USER_CONFIG = {
  // 1. Your self-hosted VPS / NAT management IPs (RFC 5737 placeholders — replace with yours)
  managedServerIps: [
    "198.51.100.10",
    "203.0.113.21",
  ],

  // 2. Your primary self-hosted chained landing node (dialer-proxy binds automatically)
  landingNodes: [
    {
      name: "落地-自建VPS(链式)",
      type: "vless",
      server: "198.51.100.10",
      port: 8443,
      uuid: "00000000-0000-4000-8000-000000000000",
      network: "tcp",
      tls: true,
      udp: true,
      flow: "xtls-rprx-vision",
      servername: "www.microsoft.com",
      "client-fingerprint": "chrome",
      "reality-opts": {
        "public-key": "REPLACE_WITH_YOUR_REALITY_PUBLIC_KEY",
        "short-id": "REPLACE_WITH_SHORT_ID",
      },
      "dialer-proxy": "前置代理",
    },
  ],

  // 3. Default exit mode for general non-CN traffic: "landing" (strict single IP) | "airport"
  defaultOutboundMode: "landing",

  // 4. MetaCubeX .mrs mirror prefix
  // Fallback 1: "https://fastly.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo"
  // Fallback 2: "https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo"
  mrsMirror: "https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo",
};

function main(config) {
  const FRONT_GROUP = "前置代理";
  const FRONT_SPEED = "⚡ 前置测速";
  const FRONT_STABLE = "🛡️ 前置稳定";
  const EXIT_GROUP = "落地出口";
  const OPS_GROUP = "🔧 运维通道";
  const DIRECT_AIRPORT_GROUP = "🚀 节点直出";
  const AI_GROUP = "🤖 AI 服务";
  const GOOGLE_GROUP = "🔍 Google 服务";
  const MEDIA_GROUP = "🎬 YouTube & 流媒体";
  const SOCIAL_GROUP = "💬 Telegram & 社交";
  const DEV_GROUP = "💻 GitHub & 开发";
  const FALLBACK_GROUP = "🐟 漏网之鱼";

  const RESERVED_NAMES = new Set([
    FRONT_GROUP, FRONT_SPEED, FRONT_STABLE, EXIT_GROUP, OPS_GROUP,
    DIRECT_AIRPORT_GROUP, AI_GROUP, GOOGLE_GROUP, MEDIA_GROUP,
    SOCIAL_GROUP, DEV_GROUP, FALLBACK_GROUP,
    "DIRECT", "REJECT", "REJECT-DROP", "PASS", "COMPATIBLE", "GLOBAL",
  ]);

  const INFO_RE = /剩余|到期|重置|官网|套餐|流量|订阅|续费|更新|公告|网址|群组|客服|故障|说明|过期|Expire|Traffic|Reset|Website/i;
  const INFO_FILTER_STR = "剩余|到期|重置|官网|套餐|流量|订阅|续费|更新|公告|网址|群组|客服|故障|说明|过期|Expire|Traffic|Reset|Website";
  const HIGH_MULT_FILTER_STR = "2x|3x|4x|5x|8x|10x|2X|3X|5X|2倍|3倍|5倍";
  const APAC_RE = /香港|台湾|日本|东京|大阪|新加坡|韩国|澳门|Hong\s*Kong|Taiwan|Japan|Tokyo|Osaka|Singapore|Korea|Macau|(?:^|[^a-zA-Z])(?:HK|TW|JP|SG|KR|MO)(?![a-zA-Z])|🇭🇰|🇹🇼|🇯🇵|🇸🇬|🇰🇷|🇲🇴/i;
  const US_RE = /美国|美西|美东|洛杉矶|硅谷|圣何塞|西雅图|纽约|芝加哥|达拉斯|凤凰城|United\s*States|Los\s*Angeles|San\s*Jose|Seattle|(?:^|[^a-zA-Z])(?:US|USA)(?![a-zA-Z])|🇺🇸/i;

  function getMultiplier(name) {
    const cleaned = String(name || "").replace(/\b(?:x86|x64|amd64|arm64|v[246])\b/gi, " ");
    const patterns = [
      /(?:^|[^\d.])(\d+(?:\.\d+)?)\s*(?:[xX×]|倍)(?![a-zA-Z0-9])/g,
      /倍率\s*[:：=]?\s*(\d+(?:\.\d+)?)/g,
      /×\s*(\d+(?:\.\d+)?)(?![a-zA-Z0-9.])/g,
      /(?:^|[^a-zA-Z0-9])[xX]([1-9](?:\.\d+)?|1\d(?:\.\d+)?|20|0\.\d+)(?![a-zA-Z0-9.])/g,
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

  const isIpLiteral = (host) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(String(host || "").trim()) || String(host || "").includes(":");
  const isBrokenHy2 = (p) => String(p?.type || "").toLowerCase() === "hysteria2" && Boolean(p?.obfs) && String(p.obfs).toLowerCase() !== "salamander";
  const isCfWs = (p) => String(p?.network || "").toLowerCase() === "ws" && (/(?:^|\.)cf[a-z0-9-]*\./i.test(String(p?.server || "")) || /cloudflare|workers\.dev|pages\.dev/i.test(String(p?.server || "")));
  const isDedicatedLine = (p) => /专线|家宽|IEPL|IPLC|BGP|专属/i.test(String(p?.name || ""));
  const isUdpProto = (p) => /^(hysteria|hysteria2|tuic|wireguard|quic)/i.test(String(p?.type || ""));
  const sortFrontPriority = (arr) =>
    [...arr].sort((a, b) => {
      const score = (x) => (isBrokenHy2(x) ? 100 : 0) + (isCfWs(x) ? 40 : 0) + (isDedicatedLine(x) ? 0 : 10) + (isUdpProto(x) ? 2 : 0);
      return score(a) - score(b);
    });
  const unique = (arr) => Array.from(new Set(arr.filter(Boolean)));

  // Sanitize polluted upstream top-level keys (never touches client-managed tun/ipv6/secret)
  delete config.hosts;
  delete config["sub-rules"];
  config["geodata-mode"] = false;
  config.profile = {
    ...(config.profile && typeof config.profile === "object" ? config.profile : {}),
    "store-selected": true,
    "store-fake-ip": true,
  };

  const managedNames = new Set(USER_CONFIG.landingNodes.map((n) => n.name));
  const managedTargets = new Set(USER_CONFIG.landingNodes.map((n) => `${String(n.server || "").toLowerCase()}:${Number(n.port || 0)}`));
  const rawProxies = Array.isArray(config.proxies) ? config.proxies : [];
  const extraChainedNodes = [];
  const providerProxies = [];
  const seenNames = new Set(managedNames);

  const safeUniqueName = (rawName) => {
    let base = String(rawName || "").trim();
    if (RESERVED_NAMES.has(base)) base = "[机场] " + base;
    let candidate = base;
    let idx = 2;
    while (seenNames.has(candidate) || RESERVED_NAMES.has(candidate)) candidate = `${base} (${idx++})`;
    seenNames.add(candidate);
    return candidate;
  };

  for (const p of rawProxies) {
    if (!p || !p.name) continue;
    const rawName = String(p.name).trim();
    const targetKey = `${String(p.server || "").toLowerCase()}:${Number(p.port || 0)}`;
    if (managedNames.has(rawName) || managedTargets.has(targetKey)) continue;
    if (INFO_RE.test(rawName)) continue;
    const cleanName = safeUniqueName(rawName);
    if (p["dialer-proxy"] || p.dialerProxy) {
      extraChainedNodes.push({ ...p, name: cleanName, "dialer-proxy": FRONT_GROUP });
      continue;
    }
    providerProxies.push(
      isIpLiteral(p.server)
        ? { ...p, name: cleanName }
        : { ...p, name: cleanName, "ip-version": p["ip-version"] || "ipv4-prefer" }
    );
  }

  const hasProxyProviders = Boolean(config["proxy-providers"] && Object.keys(config["proxy-providers"]).length > 0);
  const providerKeys = hasProxyProviders ? Object.keys(config["proxy-providers"]) : [];

  const normalNodes = sortFrontPriority(providerProxies.filter((p) => getMultiplier(p.name) <= 1));
  const highMultNodes = sortFrontPriority(providerProxies.filter((p) => getMultiplier(p.name) > 1));
  const apacNormal = normalNodes.filter((p) => APAC_RE.test(p.name));
  const apacClean = apacNormal.filter((p) => !isBrokenHy2(p) && !isCfWs(p));
  const apacNoGecko = apacNormal.filter((p) => !isBrokenHy2(p));
  const cleanNormal = normalNodes.filter((p) => !isBrokenHy2(p) && !isCfWs(p));
  const noGeckoNormal = normalNodes.filter((p) => !isBrokenHy2(p));
  const noGeckoAll = providerProxies.filter((p) => !isBrokenHy2(p));

  const candidatePools = [
    apacClean.length >= 2 ? apacClean : [],
    apacClean,
    apacNoGecko,
    cleanNormal,
    noGeckoNormal,
    noGeckoAll,
    normalNodes,
    providerProxies,
  ];
  const speedPool = (candidatePools.find((arr) => arr.length > 0) || []).map((p) => p.name);

  const frontManualList = unique([
    ...apacClean.map((p) => p.name),
    ...apacNormal.map((p) => p.name),
    ...normalNodes.map((p) => p.name),
    ...highMultNodes.map((p) => p.name),
  ]);
  const usFallbackNodes = unique([
    ...normalNodes.filter((p) => US_RE.test(p.name)).map((p) => p.name),
    ...highMultNodes.filter((p) => US_RE.test(p.name)).map((p) => p.name),
  ]);

  const injectedLandings = [
    ...USER_CONFIG.landingNodes.map((n) => ({ ...n, "dialer-proxy": FRONT_GROUP })),
    ...extraChainedNodes,
  ];
  config.proxies = [...injectedLandings, ...providerProxies];

  const landingNames = injectedLandings.map((n) => n.name);
  const exitList = unique([...landingNames, ...usFallbackNodes, ...frontManualList.slice(0, 6)]);
  const defaultGeneral = USER_CONFIG.defaultOutboundMode === "landing"
    ? [EXIT_GROUP, DIRECT_AIRPORT_GROUP, FRONT_GROUP, "DIRECT"]
    : [DIRECT_AIRPORT_GROUP, EXIT_GROUP, FRONT_GROUP, "DIRECT"];

  const autoPoolSource = speedPool.length > 0
    ? { proxies: speedPool }
    : hasProxyProviders
      ? { use: providerKeys, "exclude-filter": `${INFO_FILTER_STR}|${HIGH_MULT_FILTER_STR}` }
      : { proxies: ["DIRECT"] };

  const providerManualAttach = frontManualList.length === 0 && hasProxyProviders
    ? { use: providerKeys, "exclude-filter": INFO_FILTER_STR }
    : {};

  config["proxy-groups"] = [
    {
      name: FRONT_GROUP,
      type: "select",
      proxies: unique([FRONT_SPEED, FRONT_STABLE, ...frontManualList]),
      ...providerManualAttach,
    },
    {
      name: FRONT_SPEED,
      type: "url-test",
      url: "https://www.gstatic.com/generate_204",
      interval: 300,
      tolerance: 80,
      lazy: true,
      ...autoPoolSource,
    },
    {
      name: FRONT_STABLE,
      type: "fallback",
      url: "https://www.gstatic.com/generate_204",
      interval: 300,
      lazy: true,
      ...autoPoolSource,
    },
    {
      name: EXIT_GROUP,
      type: "select",
      proxies: exitList.length ? exitList : [FRONT_GROUP],
    },
    {
      name: OPS_GROUP,
      type: "select",
      proxies: [FRONT_GROUP, "DIRECT"],
    },
    {
      name: AI_GROUP,
      type: "select",
      proxies: unique([EXIT_GROUP, DIRECT_AIRPORT_GROUP, FRONT_GROUP]),
    },
    {
      name: GOOGLE_GROUP,
      type: "select",
      proxies: unique([EXIT_GROUP, DIRECT_AIRPORT_GROUP, FRONT_GROUP]),
    },
    {
      name: MEDIA_GROUP,
      type: "select",
      proxies: unique(defaultGeneral),
    },
    {
      name: SOCIAL_GROUP,
      type: "select",
      proxies: unique(defaultGeneral),
    },
    {
      name: DEV_GROUP,
      type: "select",
      proxies: unique(defaultGeneral),
    },
    {
      name: DIRECT_AIRPORT_GROUP,
      type: "select",
      proxies: unique([FRONT_SPEED, FRONT_STABLE, ...frontManualList, EXIT_GROUP, "DIRECT"]),
      ...providerManualAttach,
    },
    {
      name: FALLBACK_GROUP,
      type: "select",
      proxies: unique(defaultGeneral),
    },
  ];

  const mrs = (key, subPath, behavior = "domain") => ({
    type: "http",
    behavior,
    format: "mrs",
    url: `${USER_CONFIG.mrsMirror}/${subPath}`,
    path: `./ruleset/${key}.mrs`,
    interval: 86400,
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

  const serverBypassRules = USER_CONFIG.managedServerIps
    .filter(Boolean)
    .map((ip) => `IP-CIDR,${ip}/32,${OPS_GROUP},no-resolve`);

  config.rules = [
    // 1. Managed VPS / NAT SSH bypass (prevents self-loop deadlock)
    ...serverBypassRules,

    // 2. Private & LAN direct
    "RULE-SET,private_domain,DIRECT",
    "RULE-SET,private_ip,DIRECT,no-resolve",

    // 3. Local-side location reporting guard
    "DOMAIN-SUFFIX,locationhistory-pa.googleapis.com,REJECT",
    "DOMAIN-SUFFIX,footprints-pa.googleapis.com,REJECT",
    "DOMAIN-SUFFIX,timeline.google.com,REJECT",
    "DOMAIN-SUFFIX,locationreporting-pa.googleapis.com,REJECT",

    // 4. Fine-grained QUIC (UDP 443): allow CN/Apple/Microsoft, block overseas QUIC to prevent drops
    "AND,((NETWORK,UDP),(DST-PORT,443),(NOT,((OR,((RULE-SET,private_domain),(RULE-SET,private_ip,no-resolve),(RULE-SET,cn_domain),(RULE-SET,cn_ip,no-resolve),(RULE-SET,apple_domain),(RULE-SET,microsoft_domain)))))),REJECT",

    // 5. Core AI, Leak-Check & Account Identity (strict landing exit)
    "DOMAIN-SUFFIX,ipinfo.io," + EXIT_GROUP,
    "DOMAIN-SUFFIX,ippure.com," + EXIT_GROUP,
    "DOMAIN-SUFFIX,ipure.dev," + EXIT_GROUP,
    "DOMAIN-SUFFIX,scamalytics.com," + EXIT_GROUP,
    "DOMAIN-SUFFIX,ipqualityscore.com," + EXIT_GROUP,
    "DOMAIN-SUFFIX,ping0.cc," + EXIT_GROUP,
    "DOMAIN-SUFFIX,browserleaks.com," + EXIT_GROUP,
    "DOMAIN-SUFFIX,ipleak.net," + EXIT_GROUP,
    "DOMAIN-SUFFIX,whoer.net," + EXIT_GROUP,
    "DOMAIN-SUFFIX,ip.net.coffee," + EXIT_GROUP,
    "DOMAIN-SUFFIX,ip.sb," + EXIT_GROUP,
    "DOMAIN-SUFFIX,accounts.google.com," + EXIT_GROUP,
    "DOMAIN-SUFFIX,aicode.googleapis.com," + AI_GROUP,
    "DOMAIN-SUFFIX,generativelanguage.googleapis.com," + AI_GROUP,
    "DOMAIN-SUFFIX,aistudio.google.com," + AI_GROUP,
    "DOMAIN-SUFFIX,antigravity.google," + AI_GROUP,
    "DOMAIN-SUFFIX,openai.com," + AI_GROUP,
    "DOMAIN-SUFFIX,chatgpt.com," + AI_GROUP,
    "DOMAIN-SUFFIX,claude.ai," + AI_GROUP,
    "DOMAIN-SUFFIX,anthropic.com," + AI_GROUP,
    "DOMAIN-SUFFIX,x.ai," + AI_GROUP,
    "DOMAIN-SUFFIX,grok.com," + AI_GROUP,
    "RULE-SET,openai_domain," + AI_GROUP,
    "RULE-SET,anthropic_domain," + AI_GROUP,
    "RULE-SET,gemini_domain," + AI_GROUP,
    "RULE-SET,ai_domain," + AI_GROUP,

    // 6. Media, Google, Dev, Social
    "DOMAIN-SUFFIX,googlevideo.com," + MEDIA_GROUP,
    "RULE-SET,youtube_domain," + MEDIA_GROUP,
    "RULE-SET,netflix_domain," + MEDIA_GROUP,
    "RULE-SET,google_domain," + GOOGLE_GROUP,
    "RULE-SET,github_domain," + DEV_GROUP,
    "RULE-SET,telegram_domain," + SOCIAL_GROUP,
    "RULE-SET,telegram_ip," + SOCIAL_GROUP + ",no-resolve",

    // 7. Apple, Microsoft, Overseas-before-CN, Domestic CN, Fallback
    "RULE-SET,apple_domain,DIRECT",
    "RULE-SET,microsoft_domain,DIRECT",
    "RULE-SET,proxy_domain," + FALLBACK_GROUP,
    "RULE-SET,cn_domain,DIRECT",
    "RULE-SET,cn_ip,DIRECT",
    "MATCH," + FALLBACK_GROUP,
  ];

  // 8. Safe SNI sniffer
  config.sniffer = {
    enable: true,
    "force-dns-mapping": true,
    "parse-pure-ip": true,
    "override-destination": false,
    sniff: {
      HTTP: {
        ports: [80, "8080-8880"],
        "override-destination": true,
      },
      TLS: {
        ports: [443, 8443],
      },
      QUIC: {
        ports: [443, 8443],
      },
    },
    "force-domain": ["+.v2ex.com"],
    "skip-domain": ["Mijia Cloud", "+.push.apple.com"],
    "skip-dst-address": unique([
      ...USER_CONFIG.managedServerIps.filter(Boolean).map((ip) => `${ip}/32`),
      "91.105.192.0/23",
      "91.108.4.0/22",
      "91.108.8.0/21",
      "91.108.16.0/21",
      "91.108.56.0/22",
      "95.161.64.0/20",
      "149.154.160.0/20",
      "185.76.151.0/24",
      "2001:67c:4e0::/44",
      "2001:b28:f230::/44",
      "2a0a:f280::/29",
    ]),
  };

  // 9. Clean encrypted DNS (dns.ipv6=false avoids AAAA fallback stalls while keeping dual-stack dialer)
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
    "fake-ip-filter": [
      "*.lan",
      "*.local",
      "localhost.ptlogin2.qq.com",
      "+.msftconnecttest.com",
      "+.msftncsi.com",
      "time.*.com",
      "ntp.*.com",
      "+.pool.ntp.org",
      "+.stun.*.*",
      "+.stun.*.*.*",
      "connect.rom.miui.com",
      "connectivitycheck.gstatic.com",
      "connectivitycheck.platform.hicloud.com",
      "+.hicloud.com",
      "captive.apple.com",
    ],
  };

  return config;
}
