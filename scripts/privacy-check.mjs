/**
 * NodeDeck 开源仓库自动化隐私与密钥防泄漏扫描（本地 + GitHub Actions CI 双重门禁）
 * 严格拦截：
 *  1. 运行期个人配置文件（config.json / *.local.json / *.key / *.pem）
 *  2. 私钥头（OPENSSH / RSA / EC PRIVATE KEY）
 *  3. 常见明文访问令牌与订阅 token
 *  4. 代码与示例配置中的非 RFC 5737 / 非内网公网 IPv4（允许 127.x / 10.x / 192.168.x / 1.1.1.1 / 8.8.8.8 / RFC 5737）
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

const SECRET_RULES = [
  { label: 'Private Key Header', regex: /BEGIN (?:OPENSSH|RSA|EC|DSA|PGP) PRIVATE KEY/ },
  { label: 'Hardcoded GitHub Token', regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { label: 'Hardcoded OpenAI/Anthropic Key', regex: /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}\b/ },
  { label: 'Hardcoded Subscription URL Token', regex: /subscribe\?token=(?!demo_token_only\b)[A-Za-z0-9_-]{12,}/i },
];

const ALLOWED_PUBLIC_IPS = new Set([
  '0.0.0.0',
  '1.1.1.1',
  '1.0.0.1',
  '8.8.8.8',
  '8.8.4.4',
  '223.5.5.5',
  '223.6.6.6',
  '119.29.29.29',
  '1.12.12.12',
  // Official Telegram AS62041 MTProto CIDR bases (for sniffer skip-dst-address)
  '91.105.192.0',
  '91.108.4.0',
  '91.108.8.0',
  '91.108.16.0',
  '91.108.56.0',
  '95.161.64.0',
  '149.154.160.0',
  '185.76.151.0',
  '255.255.255.255',
]);

function isSafeIpv4(ip) {
  if (ALLOWED_PUBLIC_IPS.has(ip)) return true;
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n > 255)) return true;
  const [a, b, c] = parts;
  if (a === 127 || a === 10 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  // RFC 2544 / Mihomo Fake-IP range: 198.18.0.0/15
  if (a === 198 && (b === 18 || b === 19)) return true;
  // RFC 5737 Documentation IPs: 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  return false;
}

const IGNORE_DIRS = new Set(['.git', 'target', 'gen', 'node_modules', '__pycache__', '.cargo']);
const BINARY_EXTS = new Set(['.png', '.jpg', '.jpeg', '.ico', '.exe', '.zip', '.woff2', '.pyc']);
const SKIP_IP_FILES = new Set(['Cargo.lock']);

const violations = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(ROOT, full);

    if (entry.isDirectory()) {
      walk(full);
      continue;
    }

    if (
      entry.name === 'config.json'
      || entry.name.endsWith('.local.json')
      || entry.name.endsWith('.pem')
      || entry.name.endsWith('.key')
      || /^id_(ed25519|rsa)/.test(entry.name)
    ) {
      violations.push(`FORBIDDEN PERSONAL FILE PRESENT: ${rel}`);
      continue;
    }

    if (BINARY_EXTS.has(path.extname(entry.name).toLowerCase())) continue;

    const text = fs.readFileSync(full, 'utf8');
    const lines = text.split(/\r?\n/);
    const checkIps = !SKIP_IP_FILES.has(entry.name) && rel !== path.join('scripts', 'privacy-check.mjs');

    lines.forEach((line, idx) => {
      for (const rule of SECRET_RULES) {
        if (rule.regex.test(line)) {
          violations.push(`${rel}:${idx + 1} [${rule.label}] -> ${line.trim().slice(0, 90)}`);
        }
      }
      if (checkIps) {
        const matches = line.matchAll(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g);
        for (const m of matches) {
          const ip = m[1];
          // 跳过版本号误报（如 2.10.4.0 紧跟 v/version 或 crate 版本上下文）
          if (/(?:version|v\d|schema|tauri|sing-box)/i.test(line)) continue;
          if (!isSafeIpv4(ip)) {
            violations.push(`${rel}:${idx + 1} [Non-RFC5737 Public IPv4: ${ip}] -> ${line.trim().slice(0, 90)}`);
          }
        }
      }
    });
  }
}

walk(ROOT);

if (violations.length > 0) {
  console.error('❌ PRIVACY CHECK FAILED! Found potential secrets or non-RFC5737 personal data:');
  for (const v of violations) console.error('  -', v);
  process.exit(1);
}

console.log('✅ PRIVACY CHECK PASSED: 0 personal configs, private keys, tokens, or non-RFC5737 public IPs found.');
