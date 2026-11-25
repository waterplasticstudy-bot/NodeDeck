/**
 * NodeDeck 零隐私交互式演示模式 (Demo Mode) 内存模拟引擎
 * 全部使用 RFC 5737 国际文档保留 IP（198.51.100.x / 203.0.113.x）与虚构示例数据，绝不读取本机 config.json
 */

import { RESIDENTIAL_GLOBAL_EXITS } from '../constants/ui-constants.js';
import { randomHex, randomSs2022Key, randomUuidV4 } from './format.js';

function futureDate(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function nowUnixStr() {
  return String(Math.floor(Date.now() / 1000));
}

function createInitialDemoState() {
  const synced = nowUnixStr();
  return {
    config: {
      name: 'Demo US VPS · 洛杉矶',
      host: '198.51.100.10',
      sshPort: 22,
      user: 'root',
      keyPath: '%USERPROFILE%\\.ssh\\id_ed25519',
      realityPublicKey: 'DemoPublicKeyX25519Placeholder1234567890ABCD',
      monthlyQuotaGB: 2000,
      clashApiPort: 19090,
      mihomoApiUrl: 'http://127.0.0.1:9090',
      mihomoSecret: '',
      closeToTray: true,
      natNodes: [
        {
          id: 'nat_demo_global',
          name: 'Demo Global NAT',
          region: 'HK',
          plan: '全球家宽多出口 (LXC NAT)',
          providerProfileId: 'relay_main',
          portalUrl: 'https://panel.example.com/instances/101',
          publicIp: '203.0.113.50',
          servicePort: 25000,
          monthlyQuotaGB: 300,
          billingCycle: 'monthly',
          priceCny: 18,
          expiresAt: futureDate(18),
          autoRenew: true,
          shareLink: '',
          sshPort: 25022,
          sshUser: 'root',
          sshKeyPath: '',
          singboxConfigPath: '/usr/local/etc/sing-box/config.json',
          realityPublicKey: '',
          trafficSnapshot: {
            usedBytes: 41467904000,
            totalBytes: 322122547200,
            usedText: '38.62 GB',
            totalText: '300.00 GB',
            percent: 12.9,
            cycleText: '2026-11-01 → 2026-12-01',
            expiresAt: futureDate(18),
            syncedAt: synced,
            source: 'host-billing',
          },
          notes: 'Alpine 3.21 · 支持 10 地区宿主机家宽单选切换与独立计费',
        },
        {
          id: 'nat_demo_jp',
          name: 'Demo Tokyo NAT',
          region: 'JP',
          plan: '东京 SoftBank 家宽 mini (LXC NAT)',
          providerProfileId: 'relay_main',
          portalUrl: 'https://panel.example.com/instances/102',
          publicIp: '203.0.113.21',
          servicePort: 25000,
          monthlyQuotaGB: 100,
          billingCycle: 'monthly',
          priceCny: 9.9,
          expiresAt: futureDate(24),
          autoRenew: true,
          shareLink: '',
          sshPort: 25022,
          sshUser: 'root',
          sshKeyPath: '',
          singboxConfigPath: '/usr/local/etc/sing-box/config.json',
          realityPublicKey: '',
          trafficSnapshot: {
            usedBytes: 13314398617,
            totalBytes: 107374182400,
            usedText: '12.40 GB',
            totalText: '100.00 GB',
            percent: 12.4,
            cycleText: '仪表盘识别 · 每月 1 号重置',
            expiresAt: futureDate(24),
            syncedAt: synced,
            source: 'dashboard',
          },
          notes: 'Alpine 3.21 · 东京原生低延迟落地机',
        },
      ],
      providerAccounts: [
        {
          id: 'acc_demo_1',
          profileId: 'cloudnet_main',
          name: 'CloudNet Pro',
          category: 'airport',
          accentColor: 'blue',
          accountLabel: 'demo-user@example.com',
          portalUrl: 'https://cloudnet.example.com/dashboard',
          renewUrl: 'https://cloudnet.example.com/plans',
          subscriptionUrl: '',
          planName: 'Pro · 2000GB 高速专线',
          billingCycle: 'monthly',
          priceCny: 29.9,
          expiresAt: futureDate(185),
          autoRenew: false,
          trafficSnapshot: {
            usedBytes: 148240797696,
            totalBytes: 2147483648000,
            usedText: '138.06 GB',
            totalText: '2000 GB',
            percent: 6.9,
            cycleText: '下次重置 7 天后',
            expiresAt: futureDate(185),
            syncedAt: synced,
            source: 'dashboard',
          },
          notes: '免订阅链接，直接从独立窗口仪表盘识别流量',
        },
        {
          id: 'acc_demo_4',
          profileId: 'swift_sub',
          name: 'SwiftRoute 轻量包',
          category: 'airport',
          accentColor: 'teal',
          accountLabel: 'demo-sub-card',
          portalUrl: 'https://swift.example.com/#/dashboard',
          renewUrl: 'https://swift.example.com/#/shop',
          subscriptionUrl: 'https://swift.example.com/api/v1/client/subscribe?token=demo_token_only',
          planName: '100GB 按月流量包',
          billingCycle: 'monthly',
          priceCny: 12.0,
          expiresAt: futureDate(16),
          autoRenew: false,
          trafficSnapshot: {
            usedBytes: 45634027520,
            totalBytes: 107374182400,
            usedText: '42.50 GB',
            totalText: '100.00 GB',
            percent: 42.5,
            cycleText: '按需单次拉取（绝不后台轮询）',
            expiresAt: futureDate(16),
            syncedAt: synced,
            source: 'subscription',
          },
          notes: '同时演示「🪞 识别流量」与可选「↻ 订阅查流」双模切换',
        },
        {
          id: 'acc_demo_3',
          profileId: 'relay_alt',
          name: 'RelayCloud 备用副号',
          category: 'nat',
          accentColor: 'orange',
          accountLabel: 'alt-sandbox',
          portalUrl: 'https://panel.example.com/dashboard',
          renewUrl: 'https://panel.example.com/shop',
          subscriptionUrl: '',
          planName: '独立备用测试实例',
          billingCycle: 'monthly',
          priceCny: 9.9,
          expiresAt: futureDate(5),
          autoRenew: false,
          trafficSnapshot: null,
          notes: '临期 5 天预警示例（同站物理隔离不串号）',
        },
      ],
    },
    antiChinaEnabled: true,
    clashApiEnabled: true,
    auditLogLevel: 'warn',
    natAuditEnabled: { nat_demo_global: true, nat_demo_jp: false },
    vpsUsers: [
      { name: 'Alice', uuid: '11111111-4444-4aaa-8bbb-000000000001', flow: 'xtls-rprx-vision' },
      { name: 'Bob', uuid: '22222222-4444-4aaa-8bbb-000000000002', flow: 'xtls-rprx-vision' },
      { name: 'Charlie', uuid: '33333333-4444-4aaa-8bbb-000000000003', flow: 'xtls-rprx-vision' },
    ],
    vpsDisabledUsers: [
      { name: 'Guest_01', uuid: '99999999-4444-4aaa-8bbb-000000000099', flow: 'xtls-rprx-vision', disabledAt: '2026-11-20 14:22' },
    ],
    vpsExtraInbounds: [
      {
        tag: 'ss2022-backup',
        type: 'shadowsocks',
        listenPort: 9444,
        isPrimary: false,
        method: '2022-blake3-aes-128-gcm',
        password: 'RGVtb1NzMjAyMktleVBsYWNlaG9sZGVyMTI=',
        userCount: 1,
        users: ['ss2022-backup'],
        usersDetail: [{ name: 'ss2022-backup', password: 'RGVtb1NzMjAyMktleVBsYWNlaG9sZGVyMTI=' }],
      },
    ],
    natInbounds: {
      nat_demo_global: [
        {
          tag: 'socks-in-25000',
          type: 'socks',
          listenPort: 25000,
          isPrimary: true,
          userCount: 2,
          users: ['Alice', 'Team_Global'],
          usersDetail: [
            { username: 'Alice', name: 'Alice', password: 'demo_global_pass_a1b2c3d4' },
            { username: 'Team_Global', name: 'Team_Global', password: 'demo_global_pass_e5f6g7h8' },
          ],
        },
      ],
      nat_demo_jp: [
        {
          tag: 'socks-in-25000',
          type: 'socks',
          listenPort: 25000,
          isPrimary: true,
          userCount: 1,
          users: ['Bob'],
          usersDetail: [
            { username: 'Bob', name: 'Bob', password: 'demo_tokyo_pass_99887766' },
          ],
        },
      ],
    },
    natExits: {
      nat_demo_global: {
        ok: true,
        kind: 'global',
        currentExitCode: 'jp',
        currentExit: 'Japan SoftBank 家宽',
        multiplier: '1.5x',
        plan: '全球家宽',
        cycle: '2026-11-01 00:00 → 2026-12-01 00:00',
        expiresAt: futureDate(18),
        billedText: '38.62 GB',
        totalText: '300.00 GB',
        remainText: '261.38 GB',
        usedBytes: 41467904000,
        totalBytes: 322122547200,
        percent: 12.9,
        quotaStatus: '正常',
        breakdown: [
          { code: 'us', label: 'America AT&T', usageText: '34.20 GB', multiplier: '1' },
          { code: 'jp', label: 'Japan SoftBank', usageText: '2.80 GB', multiplier: '1.5' },
          { code: 'au', label: 'Australia', usageText: '71.91 MB', multiplier: '3' },
          { code: 'mo', label: 'Macau CTM', usageText: '2.57 MB', multiplier: '2' },
        ],
      },
      nat_demo_jp: {
        ok: true,
        kind: 'jp',
        currentExitCode: 'jp',
        currentExit: 'Japan SoftBank 家宽',
        multiplier: '原生计费',
        plan: '日本家宽',
        cycle: '',
        expiresAt: futureDate(24),
        billedText: '',
        totalText: '',
        remainText: '',
        usedBytes: 0,
        totalBytes: 0,
        percent: 0,
        quotaStatus: '正常',
        breakdown: [],
      },
    },
    natLatencies: {
      nat_demo_global: [
        { code: 'us', label: 'America AT&T 家宽', reachable: true, ms: 148.2 },
        { code: 'jp', label: 'Japan SoftBank 家宽', reachable: true, ms: 61.4 },
        { code: 'hkt', label: 'Hong Kong HKT 家宽', reachable: true, ms: 2.3 },
        { code: 'hgc', label: 'Hong Kong HGC 家宽', reachable: true, ms: 3.6 },
        { code: 'sgv', label: 'Singapore ViewQwest 家宽', reachable: true, ms: 34.8 },
        { code: 'au', label: 'Australia 家宽', reachable: true, ms: 156.5 },
        { code: 'kr', label: 'Korea 家宽', reachable: true, ms: 71.2 },
        { code: 'my', label: 'Malaysia 家宽', reachable: true, ms: 44.1 },
        { code: 'mo', label: 'Macau CTM 家宽', reachable: true, ms: 1.8 },
        { code: 'mos', label: 'Macau CTM 特价', reachable: false, ms: null },
      ],
    },
    mihomo: {
      mode: 'rule',
      groups: [
        {
          name: 'Proxy',
          type: 'Selector',
          now: '🇯🇵 Tokyo Transit 01',
          nodes: [
            { name: '🇯🇵 Tokyo Transit 01', type: 'Trojan', delay: 48 },
            { name: '🇭🇰 HongKong IPLC 02', type: 'Shadowsocks', delay: 32 },
            { name: '🇸🇬 Singapore Direct 03', type: 'VLESS', delay: 68 },
            { name: '🇺🇸 LosAngeles CN2 04', type: 'VLESS', delay: 142 },
          ],
        },
        {
          name: 'AI Services',
          type: 'Selector',
          now: 'Demo US VPS · 洛杉矶',
          nodes: [
            { name: 'Demo US VPS · 洛杉矶', type: 'VLESS', delay: 162 },
            { name: 'Demo Tokyo NAT-Bob', type: 'Socks5', delay: 78 },
            { name: 'Demo Global NAT-Alice', type: 'Socks5', delay: 94 },
          ],
        },
        {
          name: 'Fallback',
          type: 'Selector',
          now: 'Proxy',
          nodes: [
            { name: 'Proxy', type: 'Selector', delay: null },
            { name: 'DIRECT', type: 'Direct', delay: null },
          ],
        },
      ],
      connections: [
        { id: 'mc1', process: 'Antigravity.exe', host: 'generativelanguage.googleapis.com', port: '443', network: 'tcp', rule: 'DOMAIN-SUFFIX', rulePayload: 'googleapis.com', chains: ['🇯🇵 Tokyo Transit 01', 'Demo US VPS · 洛杉矶', 'AI Services'], upload: 1843200, download: 24117248 },
        { id: 'mc2', process: 'chrome.exe', host: 'chatgpt.com', port: '443', network: 'tcp', rule: 'DOMAIN-SUFFIX', rulePayload: 'chatgpt.com', chains: ['🇯🇵 Tokyo Transit 01', 'Demo Tokyo NAT-Bob', 'AI Services'], upload: 524288, download: 8912896 },
        { id: 'mc3', process: 'Code.exe', host: 'api.anthropic.com', port: '443', network: 'tcp', rule: 'DOMAIN-SUFFIX', rulePayload: 'anthropic.com', chains: ['🇭🇰 HongKong IPLC 02', 'Demo Global NAT-Alice', 'AI Services'], upload: 912340, download: 6192384 },
        { id: 'mc4', process: 'git.exe', host: 'github.com', port: '443', network: 'tcp', rule: 'DOMAIN-SUFFIX', rulePayload: 'github.com', chains: ['🇯🇵 Tokyo Transit 01', 'Proxy'], upload: 312000, download: 4120000 },
        { id: 'mc5', process: 'msedge.exe', host: 'www.bilibili.com', port: '443', network: 'tcp', rule: 'GEOIP', rulePayload: 'CN', chains: ['DIRECT'], upload: 128000, download: 19200000 },
      ],
    },
    vpsConnections: [
      { id: 'vc1', user: 'Alice', sourceIP: '198.51.100.81', host: 'generativelanguage.googleapis.com', port: '443', network: 'tcp', upload: 3145728, download: 48234496, suspicious: false },
      { id: 'vc2', user: 'Alice', sourceIP: '198.51.100.82', host: 'api.anthropic.com', port: '443', network: 'tcp', upload: 1468006, download: 19922944, suspicious: false },
      { id: 'vc3', user: 'Bob', sourceIP: '203.0.113.105', host: 'chatgpt.com', port: '443', network: 'tcp', upload: 2097152, download: 29360128, suspicious: false },
      { id: 'vc4', user: 'Charlie', sourceIP: '192.0.2.44', host: 'github.com', port: '443', network: 'tcp', upload: 622592, download: 11534336, suspicious: false },
    ],
    sessions: {
      cloudnet_main: true,
      relay_main: true,
      relay_alt: true,
      swift_sub: false,
    },
    tick: 0,
  };
}

let state = createInitialDemoState();

export function resetDemoState() {
  state = createInitialDemoState();
}

export function getDemoSeedHistories() {
  const times = [];
  const now = Date.now();
  for (let i = 9; i >= 1; i -= 1) {
    times.push(new Date(now - i * 10000).toTimeString().slice(0, 8));
  }
  return {
    times,
    cpuHist: [11.2, 13.4, 12.1, 15.8, 14.0, 12.6, 11.9, 13.5, 12.8],
    memHist: [33.4, 33.8, 34.1, 34.0, 34.5, 34.2, 34.1, 34.4, 34.3],
    rxHist: [18.4, 24.1, 21.5, 36.2, 28.9, 22.4, 19.8, 31.5, 26.2],
    txHist: [16.2, 21.8, 19.4, 33.1, 26.0, 20.1, 17.5, 28.4, 23.8],
    natPingHist: {
      nat_demo_global: {
        times: [...times],
        values: [21, 23, 19, 25, 22, 20, 24, 21, 22],
        last: { ok: true, reachable: true, ms: 22 },
      },
      nat_demo_jp: {
        times: [...times],
        values: [14, 16, 13, 15, 14, 17, 15, 13, 14],
        last: { ok: true, reachable: true, ms: 14 },
      },
    },
    natExitLatency: {
      nat_demo_global: state.natLatencies.nat_demo_global,
    },
  };
}

function buildVpsInbounds() {
  const primary = {
    tag: 'vless-reality-in',
    type: 'vless',
    listenPort: 8443,
    isPrimary: true,
    sni: 'www.microsoft.com',
    shortId: 'a1b2c3d4',
    userCount: state.vpsUsers.length,
    users: state.vpsUsers.map((u) => u.name),
    usersDetail: state.vpsUsers.map((u) => ({ name: u.name, uuid: u.uuid, flow: u.flow })),
  };
  return [primary, ...state.vpsExtraInbounds];
}

function buildVpsAuditPayload() {
  const userSummary = {};
  for (const u of state.vpsUsers) {
    userSummary[u.name] = { activeConnections: 0, upload: 0, download: 0, sourceIPs: [], suspiciousHosts: [] };
  }
  for (const c of state.vpsConnections) {
    if (!userSummary[c.user]) {
      userSummary[c.user] = { activeConnections: 0, upload: 0, download: 0, sourceIPs: [], suspiciousHosts: [] };
    }
    const row = userSummary[c.user];
    row.activeConnections += 1;
    row.upload += c.upload;
    row.download += c.download;
    if (!row.sourceIPs.includes(c.sourceIP)) row.sourceIPs.push(c.sourceIP);
    if (c.suspicious && !row.suspiciousHosts.includes(c.host)) row.suspiciousHosts.push(c.host);
  }
  const uploadTotal = state.vpsConnections.reduce((acc, c) => acc + c.upload, 0) + 1288490188;
  const downloadTotal = state.vpsConnections.reduce((acc, c) => acc + c.download, 0) + 9663676416;
  return {
    enabled: state.clashApiEnabled,
    controller: `127.0.0.1:${state.config.clashApiPort}`,
    logLevel: state.auditLogLevel,
    uploadTotal,
    downloadTotal,
    configuredUsers: state.vpsUsers.map((u) => u.name),
    userSummary,
    connections: state.vpsConnections,
    recentLogSummary: {
      Alice: { count: 42, sourceIPs: ['198.51.100.81', '198.51.100.82'], suspiciousHosts: [] },
      Bob: { count: 29, sourceIPs: ['203.0.113.105'], suspiciousHosts: [] },
      Charlie: { count: 14, sourceIPs: ['192.0.2.44'], suspiciousHosts: [] },
    },
  };
}

function buildVlessDemoLink(u) {
  const c = state.config;
  const q = new URLSearchParams({
    encryption: 'none',
    flow: u.flow || 'xtls-rprx-vision',
    security: 'reality',
    sni: 'www.microsoft.com',
    fp: 'chrome',
    pbk: c.realityPublicKey,
    sid: 'a1b2c3d4',
    type: 'tcp',
  });
  return `vless://${u.uuid}@${c.host}:8443?${q.toString()}#${encodeURIComponent(`${c.name}-${u.name}`)}`;
}

export async function demoInvoke(cmd, args = {}) {
  state.tick += 1;
  const jitter = (base, amp) => Number((base + Math.sin(state.tick * 0.9) * amp).toFixed(1));

  switch (cmd) {
    case 'get_config':
      return {
        ok: true,
        config: structuredClone(state.config),
        keyExists: true,
        resolvedKeyPath: 'C:\\Users\\Demo\\.ssh\\id_ed25519',
        panelDir: 'D:\\NodeDeck (Demo Mode)',
      };

    case 'save_config_cmd': {
      const inp = args.input || {};
      state.config = { ...state.config, ...inp };
      return { ok: true, config: structuredClone(state.config) };
    }

    case 'save_nat_nodes':
      state.config.natNodes = structuredClone(args.nodes || []);
      return { ok: true, natNodes: structuredClone(state.config.natNodes) };

    case 'save_provider_accounts':
      state.config.providerAccounts = structuredClone(args.accounts || []);
      return { ok: true, providerAccounts: structuredClone(state.config.providerAccounts) };

    case 'launch_ssh_wizard':
      return { ok: true, message: '[演示模式] 已模拟启动 SSH 免密配置向导' };

    case 'get_overview': {
      const audit = buildVpsAuditPayload();
      return {
        ok: true,
        data: {
          serverName: state.config.name,
          host: state.config.host,
          os: 'Ubuntu 24.04.2 LTS',
          kernel: '6.8.0-49-generic',
          uptimeSec: 18 * 86400 + 6 * 3600 + 24 * 60,
          sshLatencyMs: Math.round(jitter(146, 8)),
          monthlyQuotaGB: state.config.monthlyQuotaGB,
          cpu: { cores: 2, percent: jitter(13.2, 2.4), load: ['0.18', '0.22', '0.19'] },
          memory: { total: 2147483648, used: 736000000, percent: jitter(34.3, 0.8) },
          disk: { total: 42949672960, used: 11274289152, free: 31675383808, percent: 26.3 },
          network: {
            iface: 'eth0',
            rxBytes: 230000000000,
            txBytes: 229900000000,
            rxBps: Math.round(jitter(3100000, 900000)),
            txBps: Math.round(jitter(2800000, 800000)),
          },
          singbox: {
            active: true,
            status: 'active',
            version: 'sing-box version 1.11.4',
            memoryBytes: 48234496,
            config: {
              listenPort: 8443,
              sni: 'www.microsoft.com',
              userCount: state.vpsUsers.length,
              antiChinaEnabled: state.antiChinaEnabled,
              clashApiEnabled: state.clashApiEnabled,
            },
          },
          memberLive: state.clashApiEnabled
            ? {
                totalConnections: state.vpsConnections.length,
                uploadTotal: audit.uploadTotal,
                downloadTotal: audit.downloadTotal,
                members: audit.userSummary,
              }
            : null,
          security: {
            checkedAt: new Date().toTimeString().slice(0, 8),
            fail2banActive: true,
            fail2banCurrent: 5,
            fail2banTotal: 142,
            failedSsh24h: 38,
            ufwRules: ['22/tcp LIMIT Anywhere', '8443/tcp ALLOW Anywhere', '9444/tcp ALLOW Anywhere'],
            recentLogins: [
              'root     pts/0        198.51.100.200   Thu Nov 26 08:15   still logged in',
              'root     pts/0        198.51.100.200   Wed Nov 25 21:04 - 22:18  (01:14)',
            ],
          },
        },
      };
    }

    case 'get_users':
      return {
        ok: true,
        listenPort: 8443,
        sni: 'www.microsoft.com',
        shortId: 'a1b2c3d4',
        publicKeySet: true,
        antiChinaEnabled: state.antiChinaEnabled,
        activeUsers: state.vpsUsers.map((u) => ({ ...u, vlessLink: buildVlessDemoLink(u) })),
        disabledUsers: state.vpsDisabledUsers.map((u) => ({ ...u, vlessLink: buildVlessDemoLink(u) })),
      };

    case 'add_user': {
      const uid = args.uuid || randomUuidV4();
      state.vpsUsers.push({ name: args.name, uuid: uid, flow: 'xtls-rprx-vision' });
      return { ok: true, message: `[演示模式] 已新增成员「${args.name}」` };
    }

    case 'edit_vps_user': {
      const target = state.vpsUsers.find((u) => u.uuid === args.uuid);
      if (target) {
        target.name = args.name;
        if (args.newUuid) target.uuid = args.newUuid;
      }
      return { ok: true, message: `[演示模式] 已更新成员「${args.name}」` };
    }

    case 'toggle_user': {
      if (args.enable) {
        const idx = state.vpsDisabledUsers.findIndex((u) => u.uuid === args.uuid);
        if (idx >= 0) {
          const [u] = state.vpsDisabledUsers.splice(idx, 1);
          state.vpsUsers.push({ name: u.name, uuid: u.uuid, flow: u.flow });
        }
      } else {
        const idx = state.vpsUsers.findIndex((u) => u.uuid === args.uuid);
        if (idx >= 0) {
          const [u] = state.vpsUsers.splice(idx, 1);
          state.vpsDisabledUsers.push({ ...u, disabledAt: new Date().toISOString().slice(0, 16).replace('T', ' ') });
        }
      }
      return { ok: true, message: `[演示模式] 已${args.enable ? '恢复' : '暂停'}该成员` };
    }

    case 'delete_user':
      state.vpsUsers = state.vpsUsers.filter((u) => u.uuid !== args.uuid);
      state.vpsDisabledUsers = state.vpsDisabledUsers.filter((u) => u.uuid !== args.uuid);
      return { ok: true, message: '[演示模式] 已移除该成员' };

    case 'toggle_antichina':
      state.antiChinaEnabled = Boolean(args.enable);
      return { ok: true, message: `[演示模式] 防定位泄露拦截已${state.antiChinaEnabled ? '开启' : '关闭'}` };

    case 'get_audit':
      return { ok: true, data: buildVpsAuditPayload() };

    case 'configure_audit':
      state.clashApiEnabled = Boolean(args.enable);
      if (args.logLevel) state.auditLogLevel = args.logLevel;
      return { ok: true, message: `[演示模式] 本地统计接口已${state.clashApiEnabled ? '开启' : '关闭'}` };

    case 'close_vps_conn':
      state.vpsConnections = args.id === '__ALL__' ? [] : state.vpsConnections.filter((c) => c.id !== args.id);
      return { ok: true };

    case 'get_logs':
      return {
        ok: true,
        logs: [
          'INFO[0000] sing-box started (v1.11.4, Demo Mode)',
          'INFO[0012] [Alice] inbound/vless[vless-reality-in]: accepted tcp -> generativelanguage.googleapis.com:443',
          'INFO[0028] [Bob] inbound/vless[vless-reality-in]: accepted tcp -> chatgpt.com:443',
          'INFO[0045] [Charlie] inbound/vless[vless-reality-in]: accepted tcp -> github.com:443',
          'WARN[0102] route/reject: blocked locationhistory-pa.googleapis.com:443 (anti-location-leak)',
        ].join('\n'),
      };

    case 'run_service_action':
      return { ok: true, output: `[演示模式] sing-box ${args.action} 执行成功 (0 errors)` };

    case 'check_vps_ip':
      return {
        ok: true,
        data: {
          ip: state.config.host,
          country: 'United States',
          countryCode: 'US',
          region: 'California',
          city: 'Los Angeles',
          postal: '90001',
          org: 'AS64512 Example Residential ISP LLC',
          isp: 'Example Dual-ISP Broadband',
          timezone: 'America/Los_Angeles',
          loc: '34.0522,-118.2437',
          hosting: false,
          proxy: false,
        },
      };

    case 'get_singbox_config': {
      const inbounds = buildVpsInbounds();
      return {
        ok: true,
        data: {
          host: state.config.host,
          publicKey: state.config.realityPublicKey,
          inbounds,
          dns: { servers: [{ tag: 'cf', type: 'https', server: '1.1.1.1' }], strategy: 'ipv4_only' },
          log: { level: state.auditLogLevel },
          rules: [
            { action: 'sniff' },
            { protocol: 'quic', action: 'reject' },
            ...(state.antiChinaEnabled ? [{ domain_suffix: ['locationhistory-pa.googleapis.com', 'geomobileservices-pa.googleapis.com'], action: 'reject' }] : []),
            { auth_user: state.vpsUsers.map((u) => u.name), outbound: 'direct' },
          ],
          backups: ['config.json.bak.20261126_051000', 'config.json.bak.20261124_220512'],
          rawJson: JSON.stringify({ log: { level: state.auditLogLevel }, inbounds: inbounds.map((i) => ({ tag: i.tag, type: i.type, listen_port: i.listenPort })) }, null, 2),
        },
      };
    }

    case 'restore_singbox_backup':
    case 'restore_nat_alpine_backup':
      return { ok: true, message: `[演示模式] 已回滚至历史备份 ${args.backup}` };

    case 'mutate_node_inbound': {
      const { nodeId, payload } = args;
      const list = nodeId === 'vps_main' ? state.vpsExtraInbounds : (state.natInbounds[nodeId] || []);
      if (payload.op === 'add') {
        const proto = payload.proto || 'socks';
        const pass = payload.password || (proto === 'vless' ? randomUuidV4() : proto === 'shadowsocks' ? randomSs2022Key() : randomHex(16));
        const uname = payload.username || 'user';
        list.push({
          tag: payload.tag,
          type: proto,
          listenPort: payload.port || 25000,
          isPrimary: false,
          sni: payload.sni || 'www.microsoft.com',
          method: '2022-blake3-aes-128-gcm',
          password: pass,
          userCount: 1,
          users: [proto === 'shadowsocks' ? payload.tag : uname],
          usersDetail: [proto === 'vless' ? { name: uname, uuid: pass, flow: 'xtls-rprx-vision' } : { username: uname, name: uname, password: pass }],
        });
      } else if (payload.op === 'upsert_user') {
        const all = nodeId === 'vps_main' ? buildVpsInbounds() : list;
        const target = all.find((i) => i.tag === payload.tag);
        if (target) {
          const pass = payload.password || (target.type === 'vless' ? randomUuidV4() : randomHex(16));
          if (nodeId === 'vps_main' && target.isPrimary) {
            const u = state.vpsUsers.find((x) => x.name === payload.origName);
            if (u) {
              u.name = payload.username;
              if (payload.password) u.uuid = payload.password;
            } else {
              state.vpsUsers.push({ name: payload.username, uuid: pass, flow: 'xtls-rprx-vision' });
            }
          } else {
            const idx = target.usersDetail.findIndex((x) => (x.username || x.name) === (payload.origName || payload.username));
            const item = target.type === 'vless'
              ? { name: payload.username, uuid: pass, flow: 'xtls-rprx-vision' }
              : { username: payload.username, name: payload.username, password: pass };
            if (idx >= 0) target.usersDetail[idx] = item;
            else target.usersDetail.push(item);
            target.users = target.usersDetail.map((x) => x.username || x.name);
            target.userCount = target.users.length;
          }
        }
      } else if (payload.op === 'delete_user') {
        if (nodeId === 'vps_main' && payload.tag === 'vless-reality-in') {
          state.vpsUsers = state.vpsUsers.filter((u) => u.name !== payload.username);
        } else {
          const target = list.find((i) => i.tag === payload.tag);
          if (target) {
            target.usersDetail = target.usersDetail.filter((x) => (x.username || x.name) !== payload.username);
            target.users = target.usersDetail.map((x) => x.username || x.name);
            target.userCount = target.users.length;
          }
        }
      } else if (payload.op === 'delete') {
        const idx = list.findIndex((i) => i.tag === payload.tag);
        if (idx >= 0) list.splice(idx, 1);
      }
      return { ok: true, message: `[演示模式] 已完成节点变更 (${payload.op})` };
    }

    case 'get_all_nodes_users':
      return {
        ok: true,
        nodes: [
          {
            nodeId: 'vps_main',
            nodeKind: 'vps',
            name: state.config.name,
            region: 'US',
            host: state.config.host,
            publicKey: state.config.realityPublicKey,
            ok: true,
            inbounds: buildVpsInbounds(),
          },
          ...state.config.natNodes.map((n) => ({
            nodeId: n.id,
            nodeKind: 'nat',
            name: n.name,
            region: n.region,
            host: n.publicIp,
            publicKey: n.realityPublicKey || '',
            ok: true,
            inbounds: structuredClone(state.natInbounds[n.id] || []),
          })),
        ],
      };

    case 'get_nat_alpine_overview':
      return {
        ok: true,
        os: 'Alpine Linux v3.21',
        uptimeSec: 6 * 86400 + 11 * 3600,
        sshLatencyMs: args.nodeId === 'nat_demo_jp' ? 42 : 58,
        cpuPercent: jitter(2.4, 0.8),
        memory: { total: 134217728, used: 29779558, percent: 22.2 },
        disk: { percent: 38.4 },
        network: { rxBytes: 8589934592, txBytes: 8589934592 },
        singbox: { active: true, version: 'sing-box version 1.11.4', memoryBytes: 34603008 },
      };

    case 'get_nat_alpine_config': {
      const nat = state.config.natNodes.find((n) => n.id === args.nodeId);
      const inbounds = structuredClone(state.natInbounds[args.nodeId] || []);
      return {
        ok: true,
        host: nat?.publicIp || '203.0.113.50',
        publicKey: nat?.realityPublicKey || '',
        inbounds,
        dns: { servers: [{ tag: 'local', type: 'local' }], strategy: 'ipv4_only' },
        log: { level: 'warn' },
        rules: [{ action: 'sniff' }],
        backups: ['config.json.bak.20261125_190000'],
        rawJson: JSON.stringify({ inbounds }, null, 2),
      };
    }

    case 'get_nat_alpine_logs':
      return {
        ok: true,
        logs: 'INFO[0000] alpine sing-box started (Demo Mode)\nINFO[0015] inbound/socks[socks-in-25000]: accepted connection from 203.0.113.88 -> chatgpt.com:443',
      };

    case 'run_nat_alpine_action':
      return { ok: true, output: `[演示模式] Alpine NAT ${args.action} 完成` };

    case 'get_nat_alpine_audit': {
      const enabled = Boolean(state.natAuditEnabled[args.nodeId]);
      return {
        ok: true,
        data: {
          enabled,
          controller: '127.0.0.1:19091',
          logLevel: 'warn',
          uploadTotal: 429496729,
          downloadTotal: 3221225472,
          configuredUsers: (state.natInbounds[args.nodeId]?.[0]?.users) || ['Alice'],
          userSummary: {
            Alice: { activeConnections: 2, upload: 819200, download: 14680064, sourceIPs: ['203.0.113.88'], suspiciousHosts: [] },
          },
          connections: enabled
            ? [{ id: 'nc1', user: 'Alice', sourceIP: '203.0.113.88', host: 'chatgpt.com', port: '443', network: 'tcp', upload: 819200, download: 14680064, suspicious: false }]
            : [],
        },
      };
    }

    case 'configure_nat_alpine_audit':
      state.natAuditEnabled[args.nodeId] = Boolean(args.enable);
      return { ok: true, message: `[演示模式] NAT 本地监控已${args.enable ? '开启' : '关闭'}` };

    case 'close_nat_alpine_conn':
      return { ok: true };

    case 'get_nat_exit_status':
      return structuredClone(state.natExits[args.nodeId] || { ok: true, kind: 'none' });

    case 'get_nat_exit_latency':
      return { ok: true, items: structuredClone(state.natLatencies[args.nodeId] || []) };

    case 'switch_nat_exit_cmd': {
      const cur = state.natExits[args.nodeId];
      if (cur) {
        const meta = RESIDENTIAL_GLOBAL_EXITS.find((e) => e.code === args.exitCode);
        cur.currentExitCode = args.exitCode;
        cur.currentExit = meta ? meta.label : (args.exitCode === 'direct' ? '默认直连' : 'Japan SoftBank 家宽');
        cur.multiplier = meta ? meta.mult : '原生计费';
      }
      return structuredClone(cur || { ok: true, kind: 'none' });
    }

    case 'run_nat_exit_diag':
      return {
        ok: true,
        elapsedMs: 1420,
        rawText: [
          '========== Japan SoftBank 家宽 (1.5x) ==========',
          '落地 IP：203.0.113.188 (RFC 5737 Demo)',
          '位置：Japan / Tokyo / Chiyoda',
          'ASN：AS17676 SoftBank Corp. (Demo)',
          '属性：移动网络=否 / 代理=否 / 机房=否',
          '常用网站：',
          '  Google: 正常 (204)    YouTube: 正常 (204)',
          '  ChatGPT: 正常 (200)   Claude: 正常 (200)',
          '  Gemini: 正常 (200)    GitHub: 正常 (200)',
        ].join('\n'),
      };

    case 'open_account_window':
      state.sessions[args.profileId] = true;
      return { ok: true, message: `[演示模式] 已模拟打开隔离沙箱窗口 (${args.profileId})` };

    case 'clear_account_session':
      state.sessions[args.profileId] = false;
      return { ok: true };

    case 'get_account_sessions_status':
      return { ok: true, sessions: structuredClone(state.sessions) };

    case 'sync_dashboard_traffic': {
      const snap = {
        usedBytes: 148240797696,
        totalBytes: 2147483648000,
        usedText: '138.06 GB',
        totalText: '2000 GB',
        percent: 6.9,
        cycleText: '演示仪表盘识别同步成功',
        expiresAt: futureDate(180),
        syncedAt: nowUnixStr(),
        source: 'dashboard',
      };
      return { ok: true, needsWindowReady: false, snapshot: snap, config: structuredClone(state.config) };
    }

    case 'sync_subscription_traffic': {
      const snap = {
        usedBytes: 45634027520,
        totalBytes: 107374182400,
        usedText: '42.50 GB',
        totalText: '100.00 GB',
        percent: 42.5,
        cycleText: '演示按需单次拉取成功',
        expiresAt: futureDate(16),
        syncedAt: nowUnixStr(),
        source: 'subscription',
      };
      return { ok: true, viaProxy: false, snapshot: snap, config: structuredClone(state.config) };
    }

    case 'tcp_ping_host':
      return { ok: true, reachable: true, ms: args.host === '203.0.113.21' ? 14 : 22 };

    case 'get_mihomo_status': {
      const g0 = state.mihomo.groups[0];
      const g1 = state.mihomo.groups[1];
      const g2 = state.mihomo.groups[2];
      return {
        ok: true,
        connected: true,
        apiUrl: state.config.mihomoApiUrl,
        hasSecret: false,
        version: 'Meta v1.19.2 (Demo)',
        mode: state.mihomo.mode,
        allowLan: false,
        tunEnabled: true,
        mixedPort: 7890,
        uploadTotal: 348966092,
        downloadTotal: 4529848320,
        memoryBytes: 62914560,
        totalConnections: state.mihomo.connections.length,
        chainSummary: {
          mode: state.mihomo.mode,
          primaryName: g0.name,
          primaryNow: g0.now,
          secondaryName: g1.name,
          secondaryNow: g1.now,
          fallback: g2.now,
        },
        groups: structuredClone(state.mihomo.groups),
        connections: structuredClone(state.mihomo.connections),
      };
    }

    case 'probe_connectivity':
      return {
        ok: true,
        results: [
          { id: 'gemini', name: 'Google / Gemini', ok: true, status: 204, ms: 192 },
          { id: 'claude', name: 'Anthropic / Claude', ok: true, status: 200, ms: 268 },
          { id: 'openai', name: 'OpenAI / ChatGPT', ok: true, status: 200, ms: 234 },
          { id: 'cf', name: 'Cloudflare Edge', ok: true, status: 204, ms: 118 },
        ],
      };

    case 'set_mihomo_mode':
      state.mihomo.mode = args.mode || 'rule';
      return { ok: true, mode: state.mihomo.mode };

    case 'select_mihomo_node': {
      const grp = state.mihomo.groups.find((g) => g.name === args.group);
      if (grp) grp.now = args.name;
      return { ok: true, group: args.group, name: args.name };
    }

    case 'test_mihomo_delay':
      return { ok: true, name: args.name, delay: Math.round(jitter(64, 15)) };

    case 'close_mihomo_conn':
      state.mihomo.connections = args.id === '__ALL__'
        ? []
        : state.mihomo.connections.filter((c) => c.id !== args.id);
      return { ok: true };

    case 'set_window_theme':
    case 'open_external_url':
      return { ok: true };

    default:
      return { ok: true };
  }
}
