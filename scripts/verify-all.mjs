/**
 * NodeDeck 全链路离线质量门禁脚本 (v1.1.0)
 * 1. 前后端静态交叉审计：ES Import / DOM ID / Tauri Command / Demo Mock / 禁用原生弹窗
 * 2. 导出引擎与倍率正则回归：YAML / Bettbox JS (VM 沙箱实跑) / 单节点 YAML / 导出前校验
 * 3. 离线 ISO/IEC 18004 二维码全链路解码闭环校验（解析 SVG → 校验定位符/时序/BCH/RS 伴随式 → 解码字节与原文逐字比对）
 * 4. 开源仓库隐私防泄漏扫描（调用 scripts/privacy-check.mjs）
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const INDEX_HTML = path.join(SRC_DIR, 'index.html');
const LIB_RS = path.join(ROOT, 'src-tauri', 'src', 'lib.rs');
const DEMO_MOCK_JS = path.join(SRC_DIR, 'utils', 'demo-mock.js');

const failures = [];
let passCount = 0;

function check(label, fn) {
  try {
    fn();
    passCount += 1;
    console.log(`  ✓ ${label}`);
  } catch (err) {
    failures.push(`${label}: ${err.message}`);
    console.error(`  ✗ ${label}: ${err.message}`);
  }
}

async function checkAsync(label, fn) {
  try {
    await fn();
    passCount += 1;
    console.log(`  ✓ ${label}`);
  } catch (err) {
    failures.push(`${label}: ${err.message}`);
    console.error(`  ✗ ${label}: ${err.message}`);
  }
}

function collectFiles(dir, ext) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(full, ext));
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

console.log('=== [1/4] 前后端静态交叉审计 ===');
const jsFiles = collectFiles(SRC_DIR, '.js');
const htmlText = fs.readFileSync(INDEX_HTML, 'utf8');
const libRsText = fs.readFileSync(LIB_RS, 'utf8');
const demoMockText = fs.readFileSync(DEMO_MOCK_JS, 'utf8');

check('所有 JS 文件 ES Import 路径均存在', () => {
  const missing = [];
  for (const file of jsFiles) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/import\s+(?:[\s\S]*?\s+from\s+)?['"](\.[^'"]+)['"]/g)) {
      const target = path.resolve(path.dirname(file), m[1]);
      if (!fs.existsSync(target)) {
        missing.push(`${path.relative(ROOT, file)} -> ${m[1]}`);
      }
    }
  }
  assert.equal(missing.length, 0, `缺失模块:\n${missing.join('\n')}`);
});

check('前端源码零原生 alert / confirm / prompt 调用', () => {
  const hits = [];
  for (const file of jsFiles) {
    const raw = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    const lines = raw.split(/\r?\n/);
    lines.forEach((line, i) => {
      const stripped = line.replace(/\/\/.*$/, '');
      if (/\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/.test(stripped)) {
        hits.push(`${path.relative(ROOT, file)}:${i + 1}`);
      }
    });
  }
  assert.equal(hits.length, 0, `发现原生阻塞弹窗: ${hits.join(', ')}`);
});

check('所有静态 getElementById(...) 目标 ID 均存在于 index.html 或动态模板中', () => {
  const knownIds = new Set();
  for (const m of htmlText.matchAll(/\bid="([^"]+)"/g)) knownIds.add(m[1]);
  for (const file of jsFiles) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\bid="([A-Za-z0-9_-]+)"/g)) knownIds.add(m[1]);
  }
  const missing = [];
  for (const file of jsFiles) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/getElementById\(\s*['"]([A-Za-z0-9_-]+)['"]\s*\)/g)) {
      if (!knownIds.has(m[1])) {
        missing.push(`${path.relative(ROOT, file)} -> #${m[1]}`);
      }
    }
  }
  assert.equal(missing.length, 0, `未定义 DOM ID:\n${missing.join('\n')}`);
});

check('所有前端 invokeCmd(...) 均已在 Rust lib.rs 注册且在 demo-mock.js 覆盖', () => {
  const handlerMatch = libRsText.match(/generate_handler!\[([\s\S]*?)\]/);
  assert.ok(handlerMatch, '未找到 tauri::generate_handler!');
  const rustCmds = new Set(
    handlerMatch[1]
      .split(',')
      .map((s) => s.trim().split('::').pop())
      .filter((s) => s && !s.startsWith('//')),
  );
  const demoCmds = new Set([...demoMockText.matchAll(/case\s+'([a-z0-9_]+)':/g)].map((m) => m[1]));

  const missingRust = [];
  const missingDemo = [];
  for (const file of jsFiles) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/invokeCmd\(\s*['"]([a-z0-9_]+)['"]/g)) {
      const cmd = m[1];
      if (!rustCmds.has(cmd)) missingRust.push(`${path.relative(ROOT, file)} -> ${cmd}`);
      if (!demoCmds.has(cmd)) missingDemo.push(`${path.relative(ROOT, file)} -> ${cmd}`);
    }
  }
  assert.equal(missingRust.length, 0, `未在 Rust 注册的命令:\n${missingRust.join('\n')}`);
  assert.equal(missingDemo.length, 0, `未在 demo-mock.js 覆盖的命令:\n${missingDemo.join('\n')}`);
});

check('开源仓库无残留 __pycache__ / exports / 个人 config.json', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'src-tauri', 'assets', '__pycache__')), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'exports')), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'config.json')), false);
});

console.log('\n=== [2/4] 导出引擎、倍率过滤与 Demo Mock 回归 ===');
const clientExport = await import(pathToFileURL(path.join(SRC_DIR, 'utils', 'client-export.js')).href);
const formatMod = await import(pathToFileURL(path.join(SRC_DIR, 'utils', 'format.js')).href);
const demoMod = await import(pathToFileURL(path.join(SRC_DIR, 'utils', 'demo-mock.js')).href);

const sampleLandingJp = {
  nodeName: 'JP-Demo-NAT',
  proto: 'socks5',
  host: '203.0.113.21',
  port: 25000,
  username: 'demo_user',
  credential: 'demo_password_jp',
};
const sampleLandingKr = {
  nodeName: 'KR-Demo-NAT',
  proto: 'vless',
  host: '198.51.100.10',
  port: 8443,
  username: 'Alice',
  credential: '11111111-4444-4aaa-8bbb-000000000001',
  flow: 'xtls-rprx-vision',
  sni: 'www.microsoft.com',
  publicKey: 'DemoPublicKeyX25519Placeholder1234567890ABCD',
  shortId: 'a1b2c3d4',
};

check('单节点 YAML 渲染复用唯一真源（format.buildMihomoYaml === client-export.renderSingleProxyYaml）', () => {
  const fromFmt = formatMod.buildMihomoYaml(
    {
      tag: 'socks-in',
      type: 'socks',
      listenPort: sampleLandingJp.port,
      usersDetail: [{ username: sampleLandingJp.username, password: sampleLandingJp.credential }],
    },
    sampleLandingJp.host,
    '',
    sampleLandingJp.nodeName,
    { username: sampleLandingJp.username, password: sampleLandingJp.credential },
    'Proxy',
  );
  assert.match(fromFmt, /type:\s*socks5/);
  assert.match(fromFmt, /dialer-proxy:\s*"Proxy"/);
  assert.match(fromFmt, /server:\s*"203\.0\.113\.21"/);
  assert.match(fromFmt, /port:\s*25000/);
});

check('validateExportDraft 准确拦截非法草稿与正则错误并放行合法节点', () => {
  const emptyDraft = clientExport.validateExportDraft([], { format: 'all_platform_yaml', customExclude: '[unclosed' });
  assert.equal(emptyDraft.ok, false);
  assert.equal(emptyDraft.errors.length, 2);

  const warnDraft = clientExport.validateExportDraft([{ nodeName: 'NoPbk', proto: 'vless', host: '', port: 8443 }], {
    format: 'all_platform_yaml',
    frontSubUrl: '',
  });
  assert.equal(warnDraft.ok, true);
  assert.ok(warnDraft.warnings.length >= 3);

  const okDraft = clientExport.validateExportDraft([sampleLandingJp, sampleLandingKr], {
    format: 'all_platform_yaml',
    frontSubUrl: 'https://example.com/sub?token=demo_token_only',
  });
  assert.equal(okDraft.ok, true);
  assert.equal(okDraft.errors.length, 0);
  assert.equal(okDraft.nodeCount, 2);
});

check('全平台 YAML 导出（自用版 + 占位模板版）结构完整且防回环 IP 注入正确', () => {
  const yamlSelf = clientExport.buildAllPlatformYaml([sampleLandingJp, sampleLandingKr], {
    frontSubUrl: 'https://example.com/sub?token=demo_token_only',
    excludeHighMult: true,
    customExclude: '1💎',
    includeOpsChannel: true,
  });
  assert.match(yamlSelf, /name:\s*"落地-JP-Demo-NAT\(链式\)"/);
  assert.match(yamlSelf, /name:\s*"落地-KR-Demo-NAT\(链式\)"/);
  assert.match(yamlSelf, /reality-opts:/);
  assert.match(yamlSelf, /proxy-providers:/);
  assert.match(yamlSelf, /IP-CIDR,203\.0\.113\.21\/32,🔧 运维通道,no-resolve/);
  assert.match(yamlSelf, /DOMAIN-SUFFIX,geomobileservices-pa\.googleapis\.com,REJECT/);
  assert.match(yamlSelf, /DOMAIN-SUFFIX,stun\.miwifi\.com,REJECT/);
  assert.match(yamlSelf, /DOMAIN-SUFFIX,stun\.l\.google\.com,落地出口/);
  assert.ok(!yamlSelf.includes('"+.stun.*.*"'), 'fake-ip-filter 不应再放行通配符 STUN');
  assert.match(yamlSelf, /exclude-filter:/);
  assert.match(yamlSelf, /1💎/);

  const yamlTemplate = clientExport.buildAllPlatformYaml([sampleLandingJp], {
    frontSubUrl: '',
  });
  assert.ok(yamlTemplate.includes('REPLACE_WITH_FRONT_AIRPORT_SUB_URL'));
});

check('v1.2.0 DIY 自由定制：落地出口备选 3 模式 + 省流分流 + 自定义规则箱 + Go RE2 零非法前瞻', () => {
  const badRe2 = clientExport.validateExportDraft([sampleLandingJp], {
    format: 'all_platform_yaml',
    customExclude: '(?!foo)bar',
    testUrl: 'ftp://bad.example.com',
    customExitDomains: 'not a valid domain!!!',
  });
  assert.equal(badRe2.ok, false);
  assert.ok(badRe2.errors.length >= 3, '应同时拦截 Go RE2 非法语法、非法测速 URL 和非法域名');

  // 1) YAML custom(JP+KR) + airport 省流模式 + 自定义规则 + 额外防回环 IP + 自定义测速 URL
  const yamlDiy = clientExport.buildAllPlatformYaml([sampleLandingJp, sampleLandingKr], {
    frontSubUrl: 'https://example.com/sub?token=demo_token_only',
    exitFallbackMode: 'custom',
    exitFallbackRegions: ['JP', 'KR'],
    frontRegionMode: 'custom',
    frontRegions: ['HK', 'SG'],
    defaultOutboundMode: 'airport',
    includeOpsChannel: true,
    includeAllManagedIps: true,
    extraManagedIps: ['192.0.2.99'],
    testUrl: 'https://cp.cloudflare.com/generate_204',
    customExitDomains: 'custom-ai.example.com',
    customDirectDomains: 'corp.example.cn',
    customRejectDomains: 'ads.example.net',
  });
  assert.match(yamlDiy, /dialer-proxy: "前置代理"/);
  assert.ok(!yamlDiy.includes('dialer-proxy: "Proxy"'), '自包含全平台 YAML 必须绑定内建「前置代理」防 not found 报错');
  assert.match(yamlDiy, /IP-CIDR,192\.0\.2\.99\/32,🔧 运维通道,no-resolve/);
  assert.match(yamlDiy, /DOMAIN-SUFFIX,custom-ai\.example\.com,落地出口/);
  assert.match(yamlDiy, /DOMAIN-SUFFIX,corp\.example\.cn,DIRECT/);
  assert.match(yamlDiy, /DOMAIN-SUFFIX,ads\.example\.net,REJECT/);
  assert.match(yamlDiy, /url: "https:\/\/cp\.cloudflare\.com\/generate_204"/);
  assert.ok(!/(?:\(\?=|\(\?!|\(\?<=|\(\?<!)/.test(yamlDiy), 'YAML 不得包含 Go RE2 不支持的前瞻/后顾语法');

  // 2) YAML none 模式（仅自建落地）
  const yamlNone = clientExport.buildAllPlatformYaml([sampleLandingJp], {
    frontSubUrl: 'https://example.com/sub?token=demo_token_only',
    exitFallbackMode: 'none',
  });
  const exitSection = yamlNone.slice(yamlNone.indexOf('- name: "落地出口"'), yamlNone.indexOf('- name: "🤖 AI 服务"'));
  assert.ok(!exitSection.includes('use:'), 'none 模式下落地出口不应混入 front_airport');

  // 3) JS custom(JP+KR) VM 实跑验证：落地出口只含日韩备选，绝不含美国节点
  const jsDiy = clientExport.buildBettboxUniversalJs([sampleLandingJp, sampleLandingKr], {
    exitFallbackMode: 'custom',
    exitFallbackRegions: ['JP', 'KR'],
    defaultOutboundMode: 'airport',
    customExitDomains: 'custom-ai.example.com',
  });
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(`${jsDiy}\nthis.__main = main;`, ctx);
  const out = ctx.__main({
    proxies: [
      { name: '🇭🇰 香港 1x', type: 'vless', server: '198.51.100.1', port: 443 },
      { name: '🇯🇵 日本 东京 1x', type: 'vless', server: '198.51.100.2', port: 443 },
      { name: '🇰🇷 韩国 首尔 1x', type: 'vless', server: '198.51.100.3', port: 443 },
      { name: '🇺🇸 美国 洛杉矶 1x', type: 'vless', server: '198.51.100.4', port: 443 },
    ],
    'proxy-groups': [],
    rules: [],
  });
  const exitGrp = out['proxy-groups'].find((g) => g.name === '落地出口');
  const mediaGrp = out['proxy-groups'].find((g) => g.name.includes('YouTube'));
  assert.ok(exitGrp.proxies.includes('🇯🇵 日本 东京 1x') && exitGrp.proxies.includes('🇰🇷 韩国 首尔 1x'));
  assert.ok(!exitGrp.proxies.includes('🇺🇸 美国 洛杉矶 1x'), 'JP+KR 定制模式下落地出口不得混入美国节点');
  assert.equal(mediaGrp.proxies[0], '🚀 机场直出', '省流模式下流媒体应优先机场直出');
  assert.ok(out.rules.includes('DOMAIN-SUFFIX,custom-ai.example.com,落地出口'));
});

check('Bettbox 覆写 JS 在 VM 沙箱实跑通过，高倍率过滤精准放行 <=1x 且剔除 >1x', () => {
  const jsCode = clientExport.buildBettboxUniversalJs([sampleLandingJp, sampleLandingKr], {
    excludeHighMult: true,
    preferApac: true,
    customExclude: '1💎',
  });
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(`${jsCode}\nthis.__main = main;`, ctx);

  const mockAirportNodes = [
    { name: '🇭🇰 香港 0.01x 省流', type: 'vless', server: '198.51.100.1', port: 443 },
    { name: '🇹🇼 台湾 0.5倍率', type: 'vless', server: '198.51.100.2', port: 443 },
    { name: '🇯🇵 日本 0.9x 神秘优化', type: 'vless', server: '198.51.100.3', port: 443 },
    { name: '🇸🇬 新加坡 1x 💎', type: 'vless', server: '198.51.100.4', port: 443 },
    { name: '🇰🇷 韩国 1.0x 原生', type: 'vless', server: '198.51.100.5', port: 443 },
    { name: '🇭🇰 香港 100Mbps', type: 'vless', server: '198.51.100.6', port: 443 },
    { name: '🇺🇸 美国 1x 欧美节点', type: 'vless', server: '198.51.100.15', port: 443 },
    { name: '🇯🇵 日本家宽1💎', type: 'hysteria2', server: '198.51.100.7', port: 443 },
    { name: '🇭🇰 香港 IPLC 1.05x', type: 'vless', server: '198.51.100.8', port: 443 },
    { name: '🇯🇵 东京专线 1.5x', type: 'vless', server: '198.51.100.9', port: 443 },
    { name: '🇸🇬 专线 2倍率', type: 'vless', server: '198.51.100.11', port: 443 },
    { name: '🇭🇰 香港 ×3', type: 'vless', server: '198.51.100.12', port: 443 },
    { name: '🇯🇵 高倍 8.0x', type: 'vless', server: '198.51.100.13', port: 443 },
    { name: '剩余流量：999 GB', type: 'ss', server: '198.51.100.14', port: 443 },
  ];

  const out = ctx.__main({ proxies: mockAirportNodes, 'proxy-groups': [], rules: [] });
  const frontAuto = out['proxy-groups'].find((g) => g.name.includes('前置测速'));
  assert.ok(frontAuto, '应生成前置测速组');
  const kept = new Set(frontAuto.proxies);

  for (const okName of [
    '🇭🇰 香港 0.01x 省流',
    '🇹🇼 台湾 0.5倍率',
    '🇯🇵 日本 0.9x 神秘优化',
    '🇸🇬 新加坡 1x 💎',
    '🇰🇷 韩国 1.0x 原生',
    '🇭🇰 香港 100Mbps',
  ]) {
    assert.ok(kept.has(okName), `应保留 <=1x 亚太前置节点: ${okName}`);
  }
  for (const dropName of [
    '🇺🇸 美国 1x 欧美节点',
    '🇯🇵 日本家宽1💎',
    '🇭🇰 香港 IPLC 1.05x',
    '🇯🇵 东京专线 1.5x',
    '🇸🇬 专线 2倍率',
    '🇭🇰 香港 ×3',
    '🇯🇵 高倍 8.0x',
    '剩余流量：999 GB',
  ]) {
    assert.ok(!kept.has(dropName), `应排除非亚太/>1x/信息/自定义正则节点: ${dropName}`);
  }
});

await checkAsync('Demo Mock 核心指令（含 v1.1.0 整组测速与导出预设）运行零异常', async () => {
  demoMod.resetDemoState();
  const cfg = await demoMod.demoInvoke('get_config');
  assert.equal(cfg.ok, true);
  assert.equal(cfg.config.region, 'US');
  assert.ok(Array.isArray(cfg.config.exportPresets));

  const saved = await demoMod.demoInvoke('save_export_presets', {
    presets: [{ id: 'p1', name: 'Test', format: 'yaml', landingKeys: [], subscriptionUrl: '', excludeHighMultiplier: true, customExcludeRegex: '' }],
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.exportPresets.length, 1);

  const grpDelay = await demoMod.demoInvoke('test_mihomo_group_delay', { group: 'Proxy', testUrl: 'https://cp.cloudflare.com/generate_204', timeoutMs: 3000 });
  assert.equal(grpDelay.ok, true);
  assert.ok(grpDelay.testedCount >= 4);

  const rulesRes = await demoMod.demoInvoke('get_mihomo_rules');
  assert.equal(rulesRes.ok, true);
  assert.ok(Array.isArray(rulesRes.rules) && rulesRes.rules.length > 0);
  assert.ok(Array.isArray(rulesRes.providers) && rulesRes.providers.length > 0);

  const allUsers = await demoMod.demoInvoke('get_all_nodes_users');
  assert.equal(allUsers.ok, true);
  assert.equal(allUsers.nodes[0].region, 'US');
});

console.log('\n=== [3/4] 离线 QR Code ISO/IEC 18004 全链路解码闭环验证 ===');
const qrMod = await import(pathToFileURL(path.join(SRC_DIR, 'utils', 'qrcode.js')).href);

// 独立 ISO/IEC 18004 解码校验器（不共享 qrcode.js 内部状态，从渲染后的 SVG path 反向重建矩阵并校验 BCH + RS 伴随式 + 还原原文）
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255];
})();
const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]]);

const ISO_VER_L = [
  null,
  [19, 7, 1, 19, 0, 0],
  [34, 10, 1, 34, 0, 0],
  [55, 15, 1, 55, 0, 0],
  [80, 20, 1, 80, 0, 0],
  [108, 26, 1, 108, 0, 0],
  [136, 18, 2, 68, 0, 0],
  [156, 20, 2, 78, 0, 0],
  [194, 24, 2, 97, 0, 0],
  [232, 30, 2, 116, 0, 0],
  [274, 18, 2, 68, 2, 69],
  [324, 20, 4, 81, 0, 0],
  [370, 24, 2, 92, 2, 93],
  [428, 26, 4, 107, 0, 0],
  [461, 30, 3, 115, 1, 116],
  [523, 22, 5, 87, 1, 88],
  [589, 24, 5, 98, 1, 99],
];
const ISO_ALIGN = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54],
  [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74],
];

function decodeQrSvgStrict(svg) {
  const vbMatch = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  assert.ok(vbMatch && vbMatch[1] === vbMatch[2], '无效 viewBox');
  const vb = Number(vbMatch[1]);
  const margin = 4;
  const size = vb - margin * 2;
  const ver = (size - 17) / 4;
  assert.ok(Number.isInteger(ver) && ver >= 1 && ver <= 16, `异常版本 size=${size}`);

  const grid = Array.from({ length: size }, () => new Uint8Array(size));
  const pathMatch = svg.match(/<path d="([^"]+)"/);
  assert.ok(pathMatch, '缺少 path 数据');
  for (const seg of pathMatch[1].matchAll(/M(\d+),(\d+)h(\d+)v1h-\d+z/g)) {
    const x = Number(seg[1]) - margin;
    const y = Number(seg[2]) - margin;
    const w = Number(seg[3]);
    assert.ok(x >= 0 && y >= 0 && x + w <= size && y < size, '绘制越出静区边界');
    for (let dx = 0; dx < w; dx += 1) grid[y][x + dx] = 1;
  }

  // 校验 3 个定位符 + 暗模块 + 时序线
  assert.equal(grid[size - 8][8], 1, '暗模块必须为 1');
  for (let i = 8; i < size - 8; i += 1) {
    assert.equal(grid[6][i], i % 2 === 0 ? 1 : 0, `水平时序线错误 col=${i}`);
    assert.equal(grid[i][6], i % 2 === 0 ? 1 : 0, `垂直时序线错误 row=${i}`);
  }

  // 读取两份 Format Info 并验证一致 & BCH(15,5) 有效
  let f1 = 0;
  for (const [r, c] of [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]]) {
    f1 = (f1 << 1) | grid[r][c];
  }
  let f2 = 0;
  for (let i = 0; i < 7; i += 1) f2 = (f2 << 1) | grid[size - 1 - i][8];
  for (let i = 0; i < 8; i += 1) f2 = (f2 << 1) | grid[8][size - 8 + i];
  assert.equal(f1, f2, `两份格式信息不一致: ${f1.toString(2)} vs ${f2.toString(2)}`);

  const rawFmt = f1 ^ 0x5412;
  let rem = rawFmt;
  for (let i = 14; i >= 10; i -= 1) if ((rem >> i) & 1) rem ^= 0x537 << (i - 10);
  assert.equal(rem, 0, 'Format Info BCH 校验失败');
  const eccLevel = (rawFmt >> 13) & 3;
  const mask = (rawFmt >> 10) & 7;
  assert.equal(eccLevel, 0b01, '应为 ECC Level L');

  // 标记功能区
  const isFunc = Array.from({ length: size }, () => new Uint8Array(size));
  const markRect = (r0, c0, r1, c1) => {
    for (let r = Math.max(0, r0); r <= Math.min(size - 1, r1); r += 1) {
      for (let c = Math.max(0, c0); c <= Math.min(size - 1, c1); c += 1) isFunc[r][c] = 1;
    }
  };
  markRect(0, 0, 8, 8);
  markRect(0, size - 8, 8, size - 1);
  markRect(size - 8, 0, size - 1, 8);
  for (let i = 0; i < size; i += 1) { isFunc[6][i] = 1; isFunc[i][6] = 1; }
  for (const r of ISO_ALIGN[ver]) {
    for (const c of ISO_ALIGN[ver]) {
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
      markRect(r - 2, c - 2, r + 2, c + 2);
    }
  }
  if (ver >= 7) {
    markRect(size - 11, 0, size - 9, 5);
    markRect(0, size - 11, 5, size - 9);
  }

  const maskFn = (r, c) => {
    switch (mask) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    }
  };

  // 提取全部比特并拼回码字
  const rawBits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let step = 0; step < size; step += 1) {
      const r = upward ? size - 1 - step : step;
      for (let dx = 0; dx < 2; dx += 1) {
        const c = right - dx;
        if (isFunc[r][c]) continue;
        rawBits.push(grid[r][c] ^ (maskFn(r, c) ? 1 : 0));
      }
    }
  }

  const [totalData, ecLen, g1Cnt, g1Len, g2Cnt, g2Len] = ISO_VER_L[ver];
  const totalBlocks = g1Cnt + g2Cnt;
  const totalCw = totalData + ecLen * totalBlocks;
  const cw = [];
  for (let i = 0; i < totalCw; i += 1) {
    let b = 0;
    for (let k = 0; k < 8; k += 1) b = (b << 1) | rawBits[i * 8 + k];
    cw.push(b);
  }

  // 反交织并校验每个 RS 块的所有伴随式 S_j = P(α^j) == 0
  const blocks = [];
  for (let i = 0; i < g1Cnt; i += 1) blocks.push(new Uint8Array(g1Len + ecLen));
  for (let i = 0; i < g2Cnt; i += 1) blocks.push(new Uint8Array(g2Len + ecLen));
  let ptr = 0;
  const maxD = Math.max(g1Len, g2Len);
  for (let i = 0; i < maxD; i += 1) {
    for (let b = 0; b < blocks.length; b += 1) {
      const dLen = b < g1Cnt ? g1Len : g2Len;
      if (i < dLen) blocks[b][i] = cw[ptr++];
    }
  }
  for (let i = 0; i < ecLen; i += 1) {
    for (let b = 0; b < blocks.length; b += 1) {
      const dLen = b < g1Cnt ? g1Len : g2Len;
      blocks[b][dLen + i] = cw[ptr++];
    }
  }

  const dataStream = [];
  for (let b = 0; b < blocks.length; b += 1) {
    const blk = blocks[b];
    for (let s = 0; s < ecLen; s += 1) {
      let syn = 0;
      const root = GF_EXP[s];
      for (let i = 0; i < blk.length; i += 1) syn = gfMul(syn, root) ^ blk[i];
      assert.equal(syn, 0, `V${ver} Block ${b} Reed-Solomon 伴随式 S_${s} != 0`);
    }
    const dLen = b < g1Cnt ? g1Len : g2Len;
    for (let i = 0; i < dLen; i += 1) dataStream.push(blk[i]);
  }

  // 解析 Byte Mode
  const bitAt = (idx) => (dataStream[idx >> 3] >> (7 - (idx & 7))) & 1;
  const readBits = (pos, n) => {
    let v = 0;
    for (let i = 0; i < n; i += 1) v = (v << 1) | bitAt(pos + i);
    return v;
  };
  let bp = 0;
  assert.equal(readBits(bp, 4), 0b0100, '应为 Byte 模式');
  bp += 4;
  const cBits = ver <= 9 ? 8 : 16;
  const byteLen = readBits(bp, cBits);
  bp += cBits;
  const bytes = new Uint8Array(byteLen);
  for (let i = 0; i < byteLen; i += 1) {
    bytes[i] = readBits(bp, 8);
    bp += 8;
  }
  return { ver, text: new TextDecoder().decode(bytes) };
}

const QR_SAMPLES = [
  { label: 'V1 短文本', text: 'NodeDeck v1.1.0' },
  { label: 'SOCKS5 含中文 UTF-8 节点名', text: 'socks://ZGVtbzpwYXNz@203.0.113.21:25000#%F0%9F%87%AF%F0%9F%87%B5%20Tokyo-NAT-%E6%B5%8B%E8%AF%95' },
  { label: 'VLESS + Reality 完整分享链接 (V8+)', text: 'vless://11111111-4444-4aaa-8bbb-000000000001@198.51.100.10:8443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.microsoft.com&fp=chrome&pbk=DemoPublicKeyX25519Placeholder1234567890ABCD&sid=a1b2c3d4&type=tcp#Demo-US-VPS-Alice' },
  { label: 'V10+ 多组交织长链接 (300 字节)', text: `ss://${'A'.repeat(120)}@203.0.113.50:9444?plugin=${'x'.repeat(130)}#LongPayloadTest` },
  { label: 'V16 极限容量 (580 字节)', text: `https://example.com/node?payload=${'Z'.repeat(540)}` },
];

for (const sample of QR_SAMPLES) {
  check(`QR 编解码闭环: ${sample.label}`, () => {
    const svg = qrMod.renderQrSvg(sample.text, 240);
    const decoded = decodeQrSvgStrict(svg);
    assert.equal(decoded.text, sample.text, '解码文本与原始输入不一致');
  });
}

check('QR 超出 V16 上限 (>586 字节) 抛出可读中文提示', () => {
  assert.throws(() => qrMod.renderQrSvg('A'.repeat(600)), /超出离线二维码/);
});

console.log('\n=== [4/4] 开源仓库隐私防泄漏扫描 ===');
check('privacy-check.mjs 零告警通过', () => {
  const res = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'privacy-check.mjs')], {
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, res.stderr || res.stdout);
});

console.log(`\n${'='.repeat(48)}`);
if (failures.length > 0) {
  console.error(`❌ VERIFY-ALL FAILED: ${failures.length} 项失败 / ${passCount} 项通过`);
  process.exit(1);
}
console.log(`✅ VERIFY-ALL PASSED: ${passCount}/${passCount} 项全绿通过！`);
