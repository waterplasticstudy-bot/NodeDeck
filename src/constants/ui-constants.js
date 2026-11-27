/**
 * NodeDeck 前端集中常量、业务阈值、标注规则与文案枚举
 */

/** 主 VPS 节点固定标识 */
export const MAIN_VPS_NODE_ID = 'vps_main';

/** Apple Activity Ring 圆周长（半径 r=29） */
export const RING_CIRCUMFERENCE = 2 * Math.PI * 29;

/** 成员区分色板（映射 Design Tokens 变量名） */
export const MEMBER_COLORS = [
  'var(--blue)',
  'var(--green)',
  'var(--orange)',
  'var(--purple)',
  'var(--teal)',
  'var(--red)',
];

/** 侧边栏与主标题映射 */
export const TAB_TITLES = {
  overview: '节点总览',
  mihomo: '本机 Mihomo · 全链路与分流',
  terminal: '交互式 SSH 终端与 sing-box 脚本',
  singbox: 'sing-box 节点与协议管理',
  audit: '成员流量与在线监控',
  users: '全节点用户与门禁',
  logs: '日志与运维',
  assets: '续费与多账号中心',
  settings: '本机与节点配置',
};

/** 轮询与图表采样参数 */
export const DEFAULT_POLL_MS = 10000;
export const MAX_HISTORY_POINTS = 28;
export const POST_MUTATION_REFRESH_MS = 1100;
export const TOAST_DURATION_MS = 3200;
/** Alpine NAT 自动轮询最小 SSH 采集间隔，避免频繁短连小内存容器 */
export const NAT_ALPINE_MIN_POLL_MS = 30000;

/** 展示兜底默认值 */
export const DEFAULT_PORT_BANDWIDTH_MBPS = 300;
export const DEFAULT_MONTHLY_QUOTA_GB = 2000;
export const DEFAULT_MIHOMO_URL = 'http://127.0.0.1:9090';
export const DEFAULT_SNI = 'www.microsoft.com';
export const DEFAULT_NAT_PORTAL_URL = '';
export const DEFAULT_NAT_SINGBOX_CONFIG = '/usr/local/etc/sing-box/config.json';
export const THEME_STORAGE_KEY = 'nodedeck_theme';
export const DEMO_STORAGE_KEY = 'nodedeck_demo';
export const TRAY_REFRESH_EVENT = 'nodedeck://tray-refresh';

/** 各类指标健康状态评估阈值 */
export const HEALTH_THRESHOLDS = {
  latencyGoodMs: 280,
  latencyWarnMs: 480,
  cpuWarnPct: 55,
  cpuDangerPct: 80,
  memWarnPct: 70,
  memDangerPct: 85,
  diskDangerPct: 85,
  trafficWarnPct: 80,
  /** 同一成员并发不同 /24 网段达到该值即触发疑似外泄预警 */
  suspiciousSubnetCount: 3,
  /** AI 连通性延迟分级阈值 (ms) */
  probeGoodMs: 600,
  probeWarnMs: 1400,
  probeMaxScaleMs: 2500,
  /** NAT TCP 端口延迟分级阈值 (ms) */
  natPingGoodMs: 140,
  natPingWarnMs: 320,
  /** 到期续费预警天数阈值 */
  expiryDangerDays: 3,
  expiryWarnDays: 7,
};

/** 计费周期中文标签与折算月均除数 */
export const BILLING_CYCLE_LABELS = {
  monthly: '月付',
  quarterly: '季付',
  yearly: '年付',
  onetime: '按量/不限时',
};

export const BILLING_MONTHLY_DIVISOR = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
  onetime: 0,
};

/** 服务商分类标签 */
export const ACCOUNT_CATEGORY_LABELS = {
  airport: '代理订阅',
  vps: '独享 VPS',
  nat: '家宽 NAT',
};

/** 卡片主题强调色映射 */
export const ACCENT_COLOR_MAP = {
  blue: 'var(--blue)',
  purple: 'var(--purple)',
  teal: 'var(--teal)',
  orange: 'var(--orange)',
  green: 'var(--green)',
  red: 'var(--red)',
};

/** Mihomo / Clash 出站模式中文映射 */
export const MIHOMO_MODE_LABELS = {
  rule: '规则',
  global: '全局',
  direct: '直连',
};

/** 已知 UFW 防火墙端口语义标注 */
export const PORT_ANNOTATIONS = [
  { prefix: '22/', desc: 'SSH 管理 · 防爆限速', tone: 'blue' },
  { prefix: '8443/', desc: 'VLESS 主力节点', tone: 'green' },
  { prefix: '443/', desc: 'HTTPS / TLS 端口', tone: 'gray' },
];

/** 连接目标域名服务识别规则 */
export const HOST_TAG_RULES = [
  { regex: /googleapis\.com|gemini\.google|deepmind|aistudio|generativelanguage|cloudcode/i, label: 'Google / Gemini', cls: 'blue' },
  { regex: /openai\.com|chatgpt\.com|oaistatic/i, label: 'OpenAI / GPT', cls: 'green' },
  { regex: /anthropic\.com|claude\.ai|claude\.com/i, label: 'Claude', cls: 'orange' },
  { regex: /x\.ai|grok\.com|x\.com/i, label: 'Grok / X', cls: 'purple' },
  { regex: /notion\.com/i, label: 'Notion', cls: 'gray' },
  { regex: /github\.com|githubusercontent\.com/i, label: 'GitHub', cls: 'gray' },
];

/** 本机连接筛选中的 AI 域名匹配正则 */
export const AI_DOMAIN_REGEX = /(google|gemini|openai|chatgpt|anthropic|claude|x\.ai|grok|deepmind)/i;

/** 新增 sing-box 入站节点默认模板参数（四大主力协议全覆盖） */
export const INBOUND_PRESETS = {
  socks: { tag: 'socks-in-25000', port: 25000, sni: '', username: 'user' },
  vless: { tag: 'vless-reality-in', port: 9443, sni: DEFAULT_SNI, username: 'user' },
  shadowsocks: { tag: 'ss2022-in', port: 9444, sni: '', username: '' },
  http: { tag: 'http-in', port: 25001, sni: '', username: 'user' },
  mixed: { tag: 'mixed-in', port: 25002, sni: '', username: 'user' },
};

/** Mihomo / Clash 链式代理默认前置策略组名 */
export const DEFAULT_DIALER_PROXY = 'Proxy';

/** 宿主机全球家宽 10 出口元数据（严格单选互斥） */
export const RESIDENTIAL_GLOBAL_EXITS = [
  { code: 'us', flag: '🇺🇸', label: 'America AT&T 家宽', mult: '1x' },
  { code: 'jp', flag: '🇯🇵', label: 'Japan SoftBank 家宽', mult: '1.5x' },
  { code: 'hkt', flag: '🇭🇰', label: 'Hong Kong HKT 家宽', mult: '0.4x' },
  { code: 'hgc', flag: '🇭🇰', label: 'Hong Kong HGC 家宽', mult: '0.7x' },
  { code: 'sgv', flag: '🇸🇬', label: 'Singapore ViewQwest 家宽', mult: '4x' },
  { code: 'au', flag: '🇦🇺', label: 'Australia 家宽', mult: '3x' },
  { code: 'kr', flag: '🇰🇷', label: 'Korea 家宽', mult: '2.5x' },
  { code: 'my', flag: '🇲🇾', label: 'Malaysia 家宽', mult: '1x' },
  { code: 'mo', flag: '🇲🇴', label: 'Macau CTM 家宽', mult: '2x' },
  { code: 'mos', flag: '🇲🇴', label: 'Macau CTM 特价', mult: '0.1x' },
];

/** 宿主机日本家宽 2 出口元数据 */
export const RESIDENTIAL_JP_EXITS = [
  { code: 'jp', flag: '🇯🇵', label: 'Japan SoftBank 家宽', mult: '原生计费' },
  { code: 'direct', flag: '🌐', label: '默认直连', mult: '原生计费' },
];

/** 出口 IP 交叉体检外部网站清单 */
export const EXTERNAL_IP_CHECKERS = [
  { label: '打开 IPPure', buildUrl: () => 'https://ippure.com/' },
  { label: '打开 ipure.dev', buildUrl: (ip) => `https://ipure.dev/ip/${encodeURIComponent(ip)}` },
  { label: 'Scamalytics', buildUrl: (ip) => `https://scamalytics.com/ip/${encodeURIComponent(ip)}` },
];

/** 常用国家/地区代码到旗帜 Emoji 映射 */
export const COUNTRY_FLAGS = {
  US: '🇺🇸',
  JP: '🇯🇵',
  HK: '🇭🇰',
  SG: '🇸🇬',
  TW: '🇹🇼',
  GB: '🇬🇧',
  DE: '🇩🇪',
  AU: '🇦🇺',
  CN: '🇨🇳',
};
