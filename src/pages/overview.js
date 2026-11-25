/**
 * 主 VPS 系统总览页、首次开箱引导与出口 IP 体检弹窗模块
 */

import { renderOverviewCharts } from '../components/area-chart.js';
import { closeModal, openModal } from '../components/modal.js';
import { setHealthPill, setRing } from '../components/ring-card.js';
import { showToast } from '../components/toast.js';
import {
  DEFAULT_MONTHLY_QUOTA_GB,
  DEFAULT_PORT_BANDWIDTH_MBPS,
  EXTERNAL_IP_CHECKERS,
  HEALTH_THRESHOLDS,
  MAX_HISTORY_POINTS,
  MEMBER_COLORS,
  POST_MUTATION_REFRESH_MS,
} from '../constants/ui-constants.js';
import { copyToClipboard, invokeCmd, isDemoMode, openExternal, withButtonLoading } from '../utils/bridge.js';
import {
  annotatePort,
  countryFlag,
  countSubnets24,
  esc,
  fmtBytes,
  fmtMbps,
  fmtMbpsNum,
  fmtUptime,
  nowTimeStr,
} from '../utils/format.js';

const $ = (id) => document.getElementById(id);

function showBanner(html, isErr = false) {
  const banner = $('setupBanner');
  banner.innerHTML = html;
  banner.className = `banner show${isErr ? ' error' : ''}`;
}

export function hideBanner() {
  $('setupBanner').className = 'banner';
}

function renderOverviewMembers(ml) {
  const bar = $('memberStorageBar');
  const strip = $('overviewMemberStrip');
  if (!ml) {
    $('liveTotalPill').textContent = '统计未开启';
    $('navConnBadge').textContent = '--';
    bar.innerHTML = '<div class="storage-seg" style="width:100%;background:var(--ring-track)"></div>';
    strip.innerHTML = '<div class="sub-note col-span-full">打开下方「本机防外泄流量统计」开关即可实时查看每位成员的在线状态、流量占比与前置接入 IP。</div>';
    return;
  }

  const entries = Object.entries(ml.members || {});
  $('liveTotalPill').textContent = `活跃 ${ml.totalConnections} 条 · 累计 ${fmtBytes(ml.uploadTotal + ml.downloadTotal)}`;
  $('navConnBadge').textContent = ml.totalConnections;

  const totalLive = entries.reduce((acc, [, s]) => acc + (s.upload || 0) + (s.download || 0), 0);
  if (totalLive > 0) {
    bar.innerHTML = entries.map(([u, s], idx) => {
      const bytes = (s.upload || 0) + (s.download || 0);
      if (bytes <= 0) return '';
      const pct = Math.max(4, (bytes / totalLive) * 100);
      return `<div class="storage-seg" style="width:${pct.toFixed(1)}%;background:${MEMBER_COLORS[idx % MEMBER_COLORS.length]}" title="${esc(u)}: ${fmtBytes(bytes)}"></div>`;
    }).join('');
  } else {
    bar.innerHTML = '<div class="storage-seg" style="width:100%;background:var(--ring-track)"></div>';
  }

  strip.innerHTML = entries.map(([u, s], idx) => {
    const color = MEMBER_COLORS[idx % MEMBER_COLORS.length];
    const ips = s.sourceIPs || [];
    const subnets = countSubnets24(ips);
    const sameSubnetLB = ips.length >= 2 && subnets === 1;
    const susp = (s.suspiciousHosts || []).length > 0;
    const warn = subnets >= HEALTH_THRESHOLDS.suspiciousSubnetCount || susp;
    const online = s.activeConnections > 0;
    return `
      <div class="member-mini ${warn ? 'alert' : ''}" data-action="goto-audit-user" data-user="${esc(u)}">
        <div class="flex-between mb-xs">
          <span class="row-inline text-strong">
            <span class="color-dot" style="background:${color}"></span>
            ${esc(u)}
          </span>
          ${warn
            ? '<span class="pill red">⚠️ 异地多IP预警</span>'
            : online
              ? `<span class="pill green num">● 在线 · ${s.activeConnections} 连接</span>`
              : '<span class="pill gray">离线空闲</span>'}
        </div>
        <div class="sub-note num">实时流量：↑ ${fmtBytes(s.upload)} · ↓ ${fmtBytes(s.download)}</div>
        <div class="sub-note num">
          前置接入 IP：<strong>${ips.length} 个</strong>
          ${sameSubnetLB ? '<span class="pill blue xs ml-xs">同段负载均衡</span>' : ''}
          ${ips.length
            ? `<div class="mono mt-xs">${esc(ips.slice(0, 2).join(', '))}${ips.length > 2 ? '…' : ''}</div>`
            : '（当前无接入）'}
        </div>
      </div>
    `;
  }).join('');
}

export async function loadOverview(appState, forceSecurity = false) {
  try {
    const { data } = await invokeCmd('get_overview', { forceSecurity });
    appState.lastOverview = data;
    if (isDemoMode()) {
      showBanner(`
        <div class="flex-between">
          <div>
            <strong>🎭 当前处于交互式演示模式 (Demo Mode)：</strong>展示数据均为 RFC 5737 虚构示例，可随意点击切换节点、修改用户或体验多出口控制。
          </div>
          <button class="btn sm" data-action="exit-demo-mode">退出演示</button>
        </div>
      `, false);
    } else {
      hideBanner();
    }

    $('connDot').className = 'dot green';
    $('connText').textContent = `${data.serverName} (${data.host})`;
    $('sideHost').textContent = `${data.host} · ${isDemoMode() ? '演示' : '已连接'}`;

    const sb = data.singbox;
    appState.antiChinaEnabled = Boolean(sb.config.antiChinaEnabled);
    appState.clashApiEnabled = Boolean(sb.config.clashApiEnabled);
    $('sbDot').className = `dot ${sb.active ? 'green' : 'red'}`;
    $('sbText').textContent = sb.active
      ? `sing-box 正常 · ${sb.config.userCount} 成员`
      : `sing-box 异常 (${sb.status})`;
    $('navUserBadge').textContent = sb.config.userCount;

    const lat = data.sshLatencyMs;
    const latLabel = lat < HEALTH_THRESHOLDS.latencyGoodMs
      ? '优秀'
      : lat < HEALTH_THRESHOLDS.latencyWarnMs
        ? '正常'
        : '偏高';
    $('latChip').textContent = `往返 ${lat} ms · ${latLabel}`;
    $('navLatBadge').textContent = `${lat}ms`;
    $('upChip').textContent = `已运行 ${fmtUptime(data.uptimeSec)}`;
    $('syncChip').textContent = `更新于 ${nowTimeStr()}`;

    const cpu = data.cpu.percent;
    $('cpuVal').textContent = cpu.toFixed(cpu >= 10 ? 0 : 1);
    $('cpuSub').innerHTML = `${data.cpu.cores} 核 · 负载 <strong>${data.cpu.load.join(' / ')}</strong>`;
    const cpuTone = cpu >= HEALTH_THRESHOLDS.cpuDangerPct ? 'red' : cpu >= HEALTH_THRESHOLDS.cpuWarnPct ? 'orange' : 'green';
    const cpuColor = cpuTone === 'red' ? 'var(--red)' : cpuTone === 'orange' ? 'var(--orange)' : 'var(--blue)';
    setRing($('cpuRing'), cpu, cpuColor);
    setHealthPill($('cpuHealth'), cpuTone === 'red' ? '高负载' : cpuTone === 'orange' ? '中等' : '极轻负载', cpuTone);

    const mem = data.memory.percent;
    $('memVal').textContent = mem.toFixed(1);
    $('memSub').innerHTML = `<strong>${fmtBytes(data.memory.used)}</strong> / ${fmtBytes(data.memory.total)} · sing-box 占 ${fmtBytes(sb.memoryBytes)}`;
    const memTone = mem >= HEALTH_THRESHOLDS.memDangerPct ? 'red' : mem >= HEALTH_THRESHOLDS.memWarnPct ? 'orange' : 'green';
    const memColor = memTone === 'red' ? 'var(--red)' : memTone === 'orange' ? 'var(--orange)' : 'var(--purple)';
    setRing($('memRing'), mem, memColor);
    setHealthPill($('memHealth'), memTone === 'red' ? '紧张' : memTone === 'orange' ? '偏高' : '健康余量', memTone);

    const dsk = data.disk.percent;
    $('diskVal').textContent = dsk.toFixed(1);
    $('diskSub').innerHTML = `已用 ${fmtBytes(data.disk.used)} · 剩余 <strong>${fmtBytes(data.disk.free)}</strong>`;
    const dskDanger = dsk >= HEALTH_THRESHOLDS.diskDangerPct;
    setRing($('diskRing'), dsk, dskDanger ? 'var(--red)' : 'var(--teal)');
    setHealthPill($('diskHealth'), dskDanger ? '空间紧张' : '空间充裕', dskDanger ? 'red' : 'green');

    const biGB = (data.network.rxBytes + data.network.txBytes) / (1024 ** 3);
    const uniGB = biGB / 2;
    const days = Math.max(0.1, data.uptimeSec / 86400);
    const dailyUni = uniGB / days;
    const quota = data.monthlyQuotaGB || DEFAULT_MONTHLY_QUOTA_GB;
    const tPct = Math.min(100, (biGB / quota) * 100);
    $('trafficCardLabel').textContent = `开机双向流量 · ${quota >= 1000 ? `${(quota / 1000).toFixed(quota % 1000 === 0 ? 0 : 1)}TB` : `${quota}GB`}配额`;
    $('trafficVal').textContent = biGB.toFixed(1);
    $('trafficSub').innerHTML = `折算单向约 <strong>${uniGB.toFixed(1)} GB</strong> · 日均 ${dailyUni.toFixed(1)} GB`;
    const trafficWarn = tPct >= HEALTH_THRESHOLDS.trafficWarnPct;
    setRing($('trafficRing'), Math.max(2, tPct), trafficWarn ? 'var(--orange)' : 'var(--green)');
    setHealthPill($('trafficHealth'), `已用 ${tPct.toFixed(1)}%`, trafficWarn ? 'orange' : 'green');

    const rxM = fmtMbpsNum(data.network.rxBps);
    const txM = fmtMbpsNum(data.network.txBps);
    appState.peakMbps = Math.max(appState.peakMbps, rxM, txM);
    appState.times.push(nowTimeStr());
    appState.cpuHist.push(cpu);
    appState.memHist.push(mem);
    appState.rxHist.push(rxM);
    appState.txHist.push(txM);
    if (appState.times.length > MAX_HISTORY_POINTS) {
      appState.times.shift();
      appState.cpuHist.shift();
      appState.memHist.shift();
      appState.rxHist.shift();
      appState.txHist.shift();
    }
    $('legCpu').textContent = `${cpu.toFixed(1)}%`;
    $('legMem').textContent = `${mem.toFixed(1)}%`;
    $('legRx').textContent = fmtMbps(data.network.rxBps);
    $('legTx').textContent = fmtMbps(data.network.txBps);
    $('netPeakNote').textContent = `端口参考上限 ${DEFAULT_PORT_BANDWIDTH_MBPS} Mbps · 本次观测峰值 ${appState.peakMbps.toFixed(2)} Mbps`;
    renderOverviewCharts(appState);

    renderOverviewMembers(data.memberLive);

    $('ovAntiChinaSwitch').classList.toggle('on', appState.antiChinaEnabled);
    $('ovAuditSwitch').classList.toggle('on', appState.clashApiEnabled);

    const sec = data.security;
    $('secCheckTime').textContent = sec.checkedAt ? `最近复检 ${sec.checkedAt}（每 60 秒自动更新）` : '已开启实时守护';
    $('f2bDesc').textContent = `近 24h 拦下 ${sec.failedSsh24h} 次公网爆破 · 累计拉黑 ${sec.fail2banTotal} 个恶意 IP`;
    $('f2bPill').textContent = sec.fail2banActive ? `封禁中 ${sec.fail2banCurrent} IP` : '未运行';
    $('f2bPill').className = `pill num ${sec.fail2banActive ? 'green' : 'red'}`;

    $('ufwPorts').innerHTML = sec.ufwRules.length
      ? sec.ufwRules.map((rule) => {
        const info = annotatePort(rule);
        return `<div class="port-chip"><span class="mono text-strong">${esc(info.port)}</span><span class="pill ${info.tone}">${esc(info.desc)}</span></div>`;
      }).join('')
      : '<span class="sub-note">未检测到 UFW 放行规则</span>';

    $('sysOsLine').textContent = `${data.os} · 内核 ${data.kernel}`;
    $('sbVerRow').textContent = `${sb.version.replace('sing-box version ', 'v')} (${fmtBytes(sb.memoryBytes)})`;
    $('sbPortRow').textContent = `TCP :${sb.config.listenPort} · Reality (${sb.config.sni})`;
    $('recentLogins').textContent = sec.recentLogins.length ? sec.recentLogins.join('\n') : '暂无记录';
  } catch (err) {
    $('connDot').className = 'dot red';
    $('connText').textContent = '未连接';
    if (err.code === 'NO_SSH_KEY' || err.code === 'AUTH_FAILED') {
      showBanner(`
        <div class="flex-between">
          <div>
            <strong>🔑 需配置 SSH 免密登录：</strong>点击右侧向导输入 1 次 root 密码上传公钥，以后永久免密。<br />
            <span class="sub-note">详情：${esc(err.message)}</span>
          </div>
          <button class="btn primary sm" data-action="launch-ssh-wizard">一键配置 SSH 免密</button>
        </div>
      `, false);
    } else if (err.code === 'NO_HOST') {
      $('sideHost').textContent = '欢迎使用 · 待配置';
      showBanner(`
        <div class="flex-between">
          <div>
            <strong>👋 欢迎使用 NodeDeck！</strong>当前尚未绑定服务器。你可以手动引入自己的 VPS / NAT / 多账号，或先开启零隐私演示模式体验完整界面。
          </div>
          <div class="toolbar">
            <button class="btn primary sm" data-action="goto-settings">⚙️ 配置主 VPS</button>
            <button class="btn sm" data-action="goto-assets">＋ 添加 NAT / 账号</button>
            <button class="btn sm" data-action="enter-demo-mode">🎭 体验演示模式</button>
          </div>
        </div>
      `, false);
    } else {
      showBanner(`<strong>连接失败：</strong>${esc(err.message)}`, true);
    }
  }
}

export async function openIpCheckSheet() {
  openModal('ipCheckModal');
  const body = $('ipCheckBody');
  body.innerHTML = '<div class="sub-note empty-cell">正在从服务器实时联合查询 ipinfo + ip-api...</div>';
  try {
    const { data: d } = await invokeCmd('check_vps_ip');
    const flag = countryFlag(d.countryCode);
    const hostOk = d.hosting === false;
    const proxyOk = d.proxy === false;
    const regionLabel = [d.country, d.region, d.city].filter(Boolean).join(' · ') || '归属地未知';
    body.innerHTML = `
      <div class="ip-hero-box">
        <div>
          <div class="sub-note">VPS 当前唯一公网出口 IP</div>
          <div class="ip-hero-val mono num">${flag} ${esc(d.ip || '--')}</div>
          <div class="sub-note mt-xs">${esc(regionLabel)} ${d.postal ? `(${esc(d.postal)})` : ''}</div>
        </div>
        <button class="btn sm primary" data-action="copy-ip" data-ip="${esc(d.ip || '')}">📋 复制</button>
      </div>
      <div class="row-wrap mb-md">
        <span class="pill ${hostOk ? 'green' : 'orange'}">${hostOk ? '✅ 非机房 (hosting: false)' : '⚠️ 机房标记'}</span>
        <span class="pill ${proxyOk ? 'green' : 'red'}">${proxyOk ? '✅ 非代理 (proxy: false)' : '⚠️ 代理标记'}</span>
        <span class="pill blue">${flag} ${esc(d.city || d.country || '未知地区')}</span>
      </div>
      <div class="ios-list mb-lg">
        <div class="ios-row"><span class="ios-row-title">运营商 / ASN</span><span class="mono text-right">${esc(d.org || '--')}</span></div>
        <div class="ios-row"><span class="ios-row-title">ISP 名称</span><span>${esc(d.isp || '--')}</span></div>
        <div class="ios-row"><span class="ios-row-title">时区</span><span class="mono">${esc(d.timezone || '--')}</span></div>
        <div class="ios-row"><span class="ios-row-title">经纬度坐标</span><span class="mono num">${esc(d.loc || '--')}</span></div>
      </div>
      <div class="toolbar toolbar-between">
        <span class="sub-note">深入交叉验证：</span>
        <div class="toolbar">
          ${EXTERNAL_IP_CHECKERS.map((chk, idx) => `
            <button class="btn sm" data-action="open-ip-checker" data-idx="${idx}" data-ip="${esc(d.ip || '')}">${esc(chk.label)}</button>
          `).join('')}
        </div>
      </div>
    `;
  } catch (err) {
    body.innerHTML = `<div class="sub-note text-danger empty-cell">检测失败：${esc(err.message)}</div>`;
  }
}

export function initOverviewEvents(appState, { switchTab, toggleDemoMode }) {
  $('goAuditBtn').addEventListener('click', () => switchTab('audit'));
  $('forceSecBtn').addEventListener('click', (ev) => {
    withButtonLoading(ev.currentTarget, async () => {
      showToast('正在全量复检安全状态...');
      await loadOverview(appState, true);
    });
  });

  $('ovAntiChinaSwitch').addEventListener('click', async (ev) => {
    const sw = ev.currentTarget;
    sw.disabled = true;
    try {
      const res = await invokeCmd('toggle_antichina', { enable: !appState.antiChinaEnabled });
      showToast(res.message);
      setTimeout(() => loadOverview(appState), POST_MUTATION_REFRESH_MS);
    } catch (err) {
      showToast(err.message, true);
    } finally {
      sw.disabled = false;
    }
  });

  $('ovAuditSwitch').addEventListener('click', async (ev) => {
    const sw = ev.currentTarget;
    sw.disabled = true;
    try {
      const res = await invokeCmd('configure_audit', { enable: !appState.clashApiEnabled, logLevel: null });
      showToast(res.message);
      setTimeout(() => loadOverview(appState), POST_MUTATION_REFRESH_MS);
    } catch (err) {
      showToast(err.message, true);
    } finally {
      sw.disabled = false;
    }
  });

  $('quickIpBtn').addEventListener('click', openIpCheckSheet);
  $('closeIpModal').addEventListener('click', () => closeModal('ipCheckModal'));

  $('ipCheckBody').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'copy-ip') {
      try {
        await copyToClipboard(btn.dataset.ip);
        showToast('已复制出口 IP');
      } catch (err) {
        showToast(err.message, true);
      }
    } else if (btn.dataset.action === 'open-ip-checker') {
      const checker = EXTERNAL_IP_CHECKERS[Number(btn.dataset.idx)];
      if (checker) await openExternal(checker.buildUrl(btn.dataset.ip));
    }
  });

  $('overviewMemberStrip').addEventListener('click', (ev) => {
    const card = ev.target.closest('[data-action="goto-audit-user"]');
    if (card) switchTab('audit', card.dataset.user);
  });

  $('setupBanner').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-action]');
    if (!btn) return;
    const act = btn.dataset.action;
    if (act === 'goto-settings') {
      switchTab('settings');
    } else if (act === 'goto-assets') {
      switchTab('assets');
    } else if (act === 'enter-demo-mode') {
      await toggleDemoMode(true);
    } else if (act === 'exit-demo-mode') {
      await toggleDemoMode(false);
    } else if (act === 'launch-ssh-wizard') {
      await withButtonLoading(btn, async () => {
        try {
          const res = await invokeCmd('launch_ssh_wizard');
          showToast(res.message);
        } catch (err) {
          showToast(err.message, true);
        }
      });
    }
  });
}
