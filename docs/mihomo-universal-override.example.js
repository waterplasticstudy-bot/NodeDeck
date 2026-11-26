// ============================================================================
// NodeDeck Universal Mihomo / Clash Meta JS Override Template (Zero-Privacy Example)
// Compatible with: Bettbox, Clash Verge Rev, FlClash, Mihomo Meta (v1.19+)
//
// Design Principles:
//   1. Provider-Agnostic ("Airport as Raw Node Pool"): Completely replaces messy
//      upstream proxy-groups & rules with one clean, consistent MetaCubeX .mrs
//      ruleset so switching subscriptions never changes your groups or breaks chains.
//   2. Zero SSH / Management Loopback Deadlock: Dedicated "🔧 运维通道" group
//      routes your self-hosted VPS/NAT management IPs via DIRECT by default (with
//      optional 1-hop Front-Hop fallback), preventing SSH-through-self deadlocks.
//   3. Clean Asia-Pacific Front-Hop Pool: Excludes info nodes & >1x high-multiplier
//      nodes from url-test speed pool, prefers TCP protocols, uses tolerance=80ms.
//   4. Idempotent & Non-Intrusive: Safe across repeated reloads; never overwrites
//      client-managed `tun` toggles across desktop/mobile devices.
// ============================================================================

const USER_CONFIG = {
  // 1. Your self-hosted VPS / NAT management IPs (RFC 5737 placeholders — replace with yours)
  managedServerIps: [
    "198.51.100.10",
    "203.0.113.21",
  ],

  // 2. Your self-hosted chained landing node(s) (dialer-proxy will bind automatically)
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

  // 3. Default exit mode for general non-CN traffic:
  //    "landing" -> Lock ALL non-CN traffic to your landing exit (strict single IP)
  //    "airport" -> Only AI & Google Account lock to landing; streaming/general use provider
  defaultOutboundMode: "landing",

  // 4. MetaCubeX .mrs mirror prefix
  mrsMirror: "https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo",
};

function main(config) {
  const FRONT_GROUP = "前置代理";
  const FRONT_SPEED = "⚡ 前置测速";
  const EXIT_GROUP = "落地出口";
  const OPS_GROUP = "🔧 运维通道";
  const DIRECT_AIRPORT_GROUP = "🚀 节点直出";
  const AI_GROUP = "🤖 AI 服务";
  const GOOGLE_GROUP = "🔍 Google 服务";
  const MEDIA_GROUP = "🎬 YouTube & 流媒体";
  const SOCIAL_GROUP = "💬 Telegram & 社交";
  const DEV_GROUP = "💻 GitHub & 开发";
  const FALLBACK_GROUP = "🐟 漏网之鱼";

  const INFO_RE = /剩余|到期|重置|官网|套餐|流量|订阅|续费|更新|公告|网址|群组|客服|故障|说明|过期|Expire|Traffic|Reset|Website/i;
  const APAC_RE = /香港|台湾|日本|东京|大阪|新加坡|韩国|澳门|Hong\s*Kong|Taiwan|Japan|Tokyo|Osaka|Singapore|Korea|Macau|(?:^|[^a-zA-Z])(?:HK|TW|JP|SG|KR|MO)(?![a-zA-Z])|🇭🇰|🇹🇼|🇯🇵|🇸🇬|🇰🇷|🇲🇴/i;
  const US_RE = /美国|美西|美东|洛杉矶|硅谷|圣何塞|西雅图|纽约|芝加哥|达拉斯|凤凰城|United\s*States|Los\s*Angeles|San\s*Jose|Seattle|(?:^|[^a-zA-Z])(?:US|USA)(?![a-zA-Z])|🇺🇸/i;

  function getMultiplier(name) {
    const patterns = [
      /(?:^|[^\d.])(\d+(?:\.\d+)?)\s*(?:[xX×]|倍)(?![a-zA-Z0-9])/g,
      /倍率\s*[:：=]?\s*(\d+(?:\.\d+)?)/g,
      /(?:^|[^a-zA-Z0-9])[xX]([1-9]\d*(?:\.\d+)?|0\.\d+)(?![a-zA-Z0-9.])/g,
    ];
    const vals = [];
    for (const re of patterns) {
      let m;
      while ((m = re.exec(name)) !== null) {
        const v = parseFloat(m[1]);
        if (!Number.isNaN(v)) vals.push(v);
      }
    }
    return vals.length ? Math.max(...vals) : 1;
  }

  const isUdpProto = (p) => /^(hysteria|hysteria2|tuic|wireguard|quic)/i.test(String(p?.type || ""));
  const sortTcpFirst = (arr) => [...arr].sort((a, b) => Number(isUdpProto(a)) - Number(isUdpProto(b)));
  const unique = (arr) => Array.from(new Set(arr.filter(Boolean)));

  const managedNames = new Set(USER_CONFIG.landingNodes.map((n) => n.name));
  const rawProxies = Array.isArray(config.proxies) ? config.proxies : [];
  const providerProxies = rawProxies.filter(
    (p) => p && p.name && !managedNames.has(p.name) && !INFO_RE.test(p.name)
  );
  const hasProxyProviders = config["proxy-providers"] && Object.keys(config["proxy-providers"]).length > 0;
  const providerKeys = hasProxyProviders ? Object.keys(config["proxy-providers"]) : [];

  const normalNodes = sortTcpFirst(providerProxies.filter((p) => getMultiplier(p.name) <= 1));
  const highMultNodes = sortTcpFirst(providerProxies.filter((p) => getMultiplier(p.name) > 1));
  const apacNormal = normalNodes.filter((p) => APAC_RE.test(p.name));
  const apacTcp = apacNormal.filter((p) => !isUdpProto(p));
  const speedPool = (apacTcp.length >= 2 ? apacTcp : apacNormal.length ? apacNormal : normalNodes.length ? normalNodes : providerProxies)
    .map((p) => p.name);
  const frontManualList = unique([
    ...apacNormal.map((p) => p.name),
    ...normalNodes.map((p) => p.name),
    ...highMultNodes.map((p) => p.name),
  ]);
  const usFallbackNodes = unique([
    ...normalNodes.filter((p) => US_RE.test(p.name)).map((p) => p.name),
    ...highMultNodes.filter((p) => US_RE.test(p.name)).map((p) => p.name),
  ]);

  const injectedLandings = USER_CONFIG.landingNodes.map((n) => ({
    ...n,
    "dialer-proxy": FRONT_GROUP,
  }));
  config.proxies = [...injectedLandings, ...providerProxies];

  const landingNames = injectedLandings.map((n) => n.name);
  const exitList = unique([...landingNames, ...usFallbackNodes, ...frontManualList.slice(0, 6)]);
  const defaultGeneral = USER_CONFIG.defaultOutboundMode === "landing"
    ? [EXIT_GROUP, DIRECT_AIRPORT_GROUP, FRONT_GROUP, "DIRECT"]
    : [DIRECT_AIRPORT_GROUP, EXIT_GROUP, FRONT_GROUP, "DIRECT"];

  const speedGroupObj = {
    name: FRONT_SPEED,
    type: "url-test",
    url: "https://www.gstatic.com/generate_204",
    interval: 300,
    tolerance: 80,
    lazy: true,
    ...(speedPool.length ? { proxies: speedPool } : { use: providerKeys, "exclude-filter": "剩余|到期|官网|套餐|2x|3x|5x" }),
  };

  config["proxy-groups"] = [
    {
      name: FRONT_GROUP,
      type: "select",
      proxies: unique([FRONT_SPEED, ...frontManualList]),
      ...(frontManualList.length === 0 && hasProxyProviders ? { use: providerKeys } : {}),
    },
    speedGroupObj,
    {
      name: EXIT_GROUP,
      type: "select",
      proxies: exitList.length ? exitList : [FRONT_GROUP],
    },
    {
      name: OPS_GROUP,
      type: "select",
      proxies: ["DIRECT", FRONT_GROUP],
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
      proxies: unique([FRONT_SPEED, ...frontManualList, EXIT_GROUP, "DIRECT"]),
      ...(frontManualList.length === 0 && hasProxyProviders ? { use: providerKeys } : {}),
    },
    {
      name: FALLBACK_GROUP,
      type: "select",
      proxies: unique(defaultGeneral),
    },
  ];

  const mrs = (subPath, behavior = "domain") => ({
    type: "http",
    behavior,
    format: "mrs",
    url: `${USER_CONFIG.mrsMirror}/${subPath}`,
    interval: 86400,
  });

  config["rule-providers"] = {
    private_domain: mrs("geosite/private.mrs", "domain"),
    private_ip: mrs("geoip/private.mrs", "ipcidr"),
    ai_domain: mrs("geosite/category-ai-!cn.mrs", "domain"),
    openai_domain: mrs("geosite/openai.mrs", "domain"),
    anthropic_domain: mrs("geosite/anthropic.mrs", "domain"),
    gemini_domain: mrs("geosite/google-gemini.mrs", "domain"),
    google_domain: mrs("geosite/google.mrs", "domain"),
    youtube_domain: mrs("geosite/youtube.mrs", "domain"),
    github_domain: mrs("geosite/github.mrs", "domain"),
    telegram_domain: mrs("geosite/telegram.mrs", "domain"),
    telegram_ip: mrs("geoip/telegram.mrs", "ipcidr"),
    netflix_domain: mrs("geosite/netflix.mrs", "domain"),
    apple_domain: mrs("geosite/apple.mrs", "domain"),
    microsoft_domain: mrs("geosite/microsoft.mrs", "domain"),
    cn_domain: mrs("geosite/cn.mrs", "domain"),
    cn_ip: mrs("geoip/cn.mrs", "ipcidr"),
    proxy_domain: mrs("geosite/geolocation-!cn.mrs", "domain"),
  };

  const serverBypassRules = USER_CONFIG.managedServerIps
    .filter(Boolean)
    .map((ip) => `IP-CIDR,${ip}/32,${OPS_GROUP},no-resolve`);

  config.rules = [
    // 1. Loopback protection
    "AND,((DST-PORT,7890),(IP-CIDR,127.0.0.0/8,no-resolve)),REJECT",
    "AND,((DST-PORT,7890),(IP-CIDR,::1/128,no-resolve)),REJECT",

    // 2. Managed VPS / NAT SSH bypass (prevents self-loop deadlock)
    ...serverBypassRules,

    // 3. Private & LAN direct
    "RULE-SET,private_domain,DIRECT",
    "RULE-SET,private_ip,DIRECT,no-resolve",

    // 4. Local-side location reporting guard
    "DOMAIN-SUFFIX,locationhistory-pa.googleapis.com,REJECT",
    "DOMAIN-SUFFIX,footprints-pa.googleapis.com,REJECT",
    "DOMAIN-SUFFIX,timeline.google.com,REJECT",
    "DOMAIN-SUFFIX,locationreporting-pa.googleapis.com,REJECT",

    // 5. Fine-grained QUIC (UDP 443): allow CN/Apple/Microsoft, block overseas QUIC to prevent drops
    "AND,((NETWORK,UDP),(DST-PORT,443),(NOT,((OR,((RULE-SET,private_domain),(RULE-SET,private_ip,no-resolve),(RULE-SET,cn_domain),(RULE-SET,cn_ip,no-resolve),(RULE-SET,apple_domain),(RULE-SET,microsoft_domain)))))),REJECT",

    // 6. Core AI, Leak-Check & Account Identity (strict landing exit)
    "DOMAIN-SUFFIX,ipinfo.io," + EXIT_GROUP,
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

    // 7. Media, Google, Dev, Social
    "DOMAIN-SUFFIX,googlevideo.com," + MEDIA_GROUP,
    "RULE-SET,youtube_domain," + MEDIA_GROUP,
    "RULE-SET,netflix_domain," + MEDIA_GROUP,
    "RULE-SET,google_domain," + GOOGLE_GROUP,
    "RULE-SET,github_domain," + DEV_GROUP,
    "RULE-SET,telegram_domain," + SOCIAL_GROUP,
    "RULE-SET,telegram_ip," + SOCIAL_GROUP + ",no-resolve",

    // 8. Apple, Microsoft, Overseas-before-CN (avoids ~149 unblocked overseas sites inside cn.mrs), Domestic CN, Fallback
    "RULE-SET,apple_domain,DIRECT",
    "RULE-SET,microsoft_domain,DIRECT",
    "RULE-SET,proxy_domain," + FALLBACK_GROUP,
    "RULE-SET,cn_domain,DIRECT",
    "RULE-SET,cn_ip,DIRECT",
    "MATCH," + FALLBACK_GROUP,
  ];

  // 9. Safe SNI sniffer (catches apps bypassing Fake-IP; skips Telegram IPs, Apple Push & managed servers)
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

  // 10. Clean encrypted DNS (dns.ipv6=false avoids AAAA fallback stalls while letting dual-stack front hops stay usable)
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
      "captive.apple.com",
    ],
  };

  return config;
}
