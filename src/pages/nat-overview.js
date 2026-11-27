/**
 * 家宽 NAT 专属节点总览模块（SWR 无闪烁缓存 + 独立流量条 + 宿主机多出口单选控制 + 延迟与 AI 体检）
 */

import { drawAreaChart } from '../components/area-chart.js';
import { closeModal, confirmDialog, openModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import {
  DEFAULT_NAT_PORTAL_URL,
  HEALTH_THRESHOLDS,
  MAX_HISTORY_POINTS,
  NAT_ALPINE_MIN_POLL_MS,
  RESIDENTIAL_GLOBAL_EXITS,
  RESIDENTIAL_JP_EXITS,
} from '../constants/ui-constants.js';
import { copyToClipboard, invokeCmd, withButtonLoading } from '../utils/bridge.js';
import {
  buildStandardNodeLink,
  countryFlag,
  esc,
  fmtBytes,
  fmtPingMs,
  fmtSyncedTime,
  fmtUptime,
  getExpiryMeta,
  nowTimeStr,
} from '../utils/format.js';

const $ = (id) => document.getElementById(id);

const inFlightPing = new Set();
const inFlightAlpine = new Set();
const inFlightExit = new Set();
const inFlightAutoTraffic = new Set();
const lastAutoTrafficAt = {};
let lastDiagText = '';

export function getActiveNatNode(appState) {
  const list = appState.localConfig?.natNodes || [];
  return list.find((n) => n.id === appState.activeNodeId) || null;
}

function getPingStore(appState, nodeId) {
  if (!appState.natPingHist[nodeId]) {
    appState.natPingHist[nodeId] = { times: [], values: [], last: null };
  }
  return appState.natPingHist[nodeId];
}

function getAlpineCache(appState, nodeId) {
  if (!appState.natAlpineCache[nodeId]) {
    appState.natAlpineCache[nodeId] = { data: null, error: null, fetchedAt: 0, timeStr: '' };
  }
  return appState.natAlpineCache[nodeId];
}

function getExitCache(appState, nodeId) {
  if (!appState.natExitCache[nodeId]) {
    appState.natExitCache[nodeId] = { data: null, error: null, fetchedAt: 0 };
  }
  return appState.natExitCache[nodeId];
}

export function renderNatPingChart(appState, nodeId) {
  const store = getPingStore(appState, nodeId);
  if (!store.times.length) {
    $('natPingChart').innerHTML = '';
    return;
  }
  drawAreaChart('natPingChart', 'natPingChartWrap', 'natPingTip', {
    times: store.times,
    seriesA: store.values,
    seriesB: [],
    colorA: 'var(--blue)',
    colorB: 'var(--green)',
    labelA: 'TCP 握手',
    labelB: '',
    maxFixed: null,
    fmtY: (v) => `${v >= 10 ? Math.round(v) : v.toFixed(1)}ms`,
    fmtTip: (v) => fmtPingMs(v),
  });
}

function resolveNatTrafficView(node, exitInfo, alpine) {
  if (exitInfo?.kind === 'global' && exitInfo.totalBytes > 0) {
    return {
      hasOfficial: true,
      usedText: exitInfo.billedText || fmtBytes(exitInfo.usedBytes),
      totalText: exitInfo.totalText || fmtBytes(exitInfo.totalBytes),
      remainText: exitInfo.remainText || '',
      percent: Math.min(100, Number(exitInfo.percent || 0)),
      sourceLabel: '宿主机原生计费',
      subNote: exitInfo.cycle ? `周期 ${exitInfo.cycle}` : `剩余 ${exitInfo.remainText || '--'}`,
    };
  }
  const snap = node.trafficSnapshot;
  if (snap && snap.totalBytes > 0) {
    const t = fmtSyncedTime(snap.syncedAt);
    return {
      hasOfficial: true,
      usedText: snap.usedText || fmtBytes(snap.usedBytes),
      totalText: snap.totalText || fmtBytes(snap.totalBytes),
      remainText: '',
      percent: Math.min(100, Number(snap.percent || 0)),
      sourceLabel: snap.source === 'host-billing' ? '宿主机计费' : '仪表盘识别',
      subNote: `${snap.cycleText || `${node.monthlyQuotaGB || '--'} GB 配额`}${t ? ` · ${t}` : ''}`,
    };
  }
  const net = alpine?.data?.network;
  if (net && (net.rxBytes > 0 || net.txBytes > 0)) {
    const totalBi = (net.rxBytes || 0) + (net.txBytes || 0);
    const quotaBytes = (node.monthlyQuotaGB || 100) * (1024 ** 3);
    const pct = Math.min(100, (totalBi / quotaBytes) * 100);
    return {
      hasOfficial: false,
      usedText: fmtBytes(totalBi),
      totalText: `${node.monthlyQuotaGB || 100} GB`,
      remainText: '',
      percent: Number(pct.toFixed(1)),
      sourceLabel: '容器网卡累计',
      subNote: '点下方「🪞 一键同步官方流量」可静默同步官方账单',
    };
  }
  return {
    hasOfficial: false,
    usedText: '--',
    totalText: `${node.monthlyQuotaGB || '--'} GB`,
    remainText: '',
    percent: 0,
    sourceLabel: '待同步',
    subNote: '点「🪞 一键同步官方流量」静默同步面板官方已用流量',
  };
}

function renderNatHeaderAndCards(appState, node) {
  const flag = countryFlag(node.region);
  const exp = getExpiryMeta(node.expiresAt, node.autoRenew);
  const store = getPingStore(appState, node.id);
  const alpine = getAlpineCache(appState, node.id);
  const exitInfo = getExitCache(appState, node.id).data;
  const last = store.last;
  const sshRtt = alpine.data?.sshLatencyMs;

  $('sideHost').textContent = node.publicIp ? `${node.publicIp}:${node.servicePort || '--'}` : 'NAT 官方托管模式';
  $('connDot').className = `dot ${last ? (last.reachable ? 'green' : 'red') : 'orange'}`;
  $('connText').textContent = `${flag} ${node.name} (NAT)`;
  $('sbDot').className = `dot ${alpine.data ? (alpine.data.singbox?.active ? 'green' : 'red') : (node.sshPort > 0 ? 'green' : 'blue')}`;
  $('sbText').textContent = alpine.data?.singbox?.active
    ? `sing-box 运行中 · SSH :${node.sshPort}`
    : node.sshPort > 0
      ? `Alpine SSH :${node.sshPort}`
      : 'sing-box · 官方 Web 终端托管';
  $('latChip').textContent = sshRtt
    ? `实测 SSH 往返 ${sshRtt} ms`
    : last
      ? (last.reachable ? `TCP ${fmtPingMs(last.ms)}` : '端口不可达')
      : '待测速';
  $('navLatBadge').textContent = sshRtt
    ? `${sshRtt}ms`
    : last && last.reachable
      ? fmtPingMs(last.ms).replace(' ', '')
      : 'NAT';
  $('upChip').textContent = alpine.data?.uptimeSec ? `已运行 ${fmtUptime(alpine.data.uptimeSec)}` : exp.text;
  $('syncChip').textContent = `更新于 ${alpine.timeStr || nowTimeStr()}`;

  $('natTitleLine').textContent = `${flag} ${node.name} · ${node.plan || '家宽 LXC NAT'}`;
  $('natSubLine').textContent = node.notes || '支持一键切换宿主机家宽出口、修改 sing-box 协议与密码或打开隔离官方终端';

  const pingValText = last ? (last.reachable ? fmtPingMs(last.ms) : '超时') : '--';
  const pingTone = !last
    ? 'gray'
    : !last.reachable
      ? 'red'
      : last.ms < HEALTH_THRESHOLDS.natPingGoodMs
        ? 'green'
        : last.ms < HEALTH_THRESHOLDS.natPingWarnMs
          ? 'orange'
          : 'red';
  $('natLatestPingPill').textContent = last ? (last.reachable ? `${fmtPingMs(last.ms)} · 在线` : '不可达') : '等待测速';
  $('natLatestPingPill').className = `pill num ${pingTone}`;

  const traffic = resolveNatTrafficView(node, exitInfo, alpine);
  const exitLabel = exitInfo?.currentExit || (node.region === 'JP' ? 'Japan SoftBank 家宽' : '标准出口');
  const exitSub = exitInfo?.kind === 'global'
    ? `当前倍率 ${exitInfo.multiplier || '--'} · 状态 ${exitInfo.quotaStatus || '正常'}`
    : exitInfo?.kind === 'jp'
      ? '面板原生流量计费（无倍率）'
      : `隔离沙箱：${node.providerProfileId || 'nat_main'}`;

  $('natKpiGrid').innerHTML = `
    <div class="sub-panel">
      <div class="card-label">TCP 端口存活与握手</div>
      <div class="hero-num num mt-xs">${esc(pingValText)}</div>
      <div class="sub-note">${node.publicIp && node.servicePort ? `${esc(node.publicIp)}:${node.servicePort}` : '点「编辑节点」补全 IP 与端口'}</div>
    </div>
    <div class="sub-panel">
      <div class="flex-between">
        <span class="card-label">本月流量 · ${esc(traffic.sourceLabel)}</span>
        <span class="pill ${traffic.percent >= 80 ? 'orange' : 'blue'} xs num">${traffic.percent}%</span>
      </div>
      <div class="hero-num-sm num mt-xs">${esc(traffic.usedText)} <span class="hero-unit">/ ${esc(traffic.totalText)}</span></div>
      <div class="sub-progress-track"><div class="sub-progress-fill" style="width:${traffic.percent.toFixed(1)}%"></div></div>
      <div class="sub-note">${esc(traffic.subNote)}</div>
    </div>
    <div class="sub-panel">
      <div class="card-label">当前生效家宽出口</div>
      <div class="hero-num-sm mt-xs">${esc(exitLabel)}</div>
      <div class="sub-note">${esc(exitSub)}</div>
    </div>
    <div class="sub-panel">
      <div class="card-label">月费与 Alpine SSH</div>
      <div class="hero-num-sm num mt-xs">¥${Number(node.priceCny || 0).toFixed(1)}<span class="hero-unit">/月</span> · ${node.sshPort > 0 ? `:${node.sshPort}` : '免SSH'}</div>
      <div class="sub-note"><span class="pill ${exp.tone} xs">${esc(exp.text)}</span> ${sshRtt ? `· 往返 ${sshRtt} ms` : ''}</div>
    </div>
  `;
}

function renderExitControlCard(appState, node) {
  const card = $('natExitCard');
  if (!node.sshPort || !node.publicIp) {
    card.classList.add('hidden');
    return;
  }

  const cache = getExitCache(appState, node.id);
  const exitInfo = cache.data;
  if (!exitInfo || exitInfo.kind === 'none') {
    if (cache.error) {
      card.classList.remove('hidden');
      card.innerHTML = `<div class="notice-box">读取宿主机多出口状态失败：${esc(cache.error)}</div>`;
    } else {
      card.classList.add('hidden');
    }
    return;
  }

  card.classList.remove('hidden');
  const latItems = appState.natExitLatency[node.id] || [];
  const latMap = new Map(latItems.map((it) => [it.code, it]));

  if (exitInfo.kind === 'global') {
    const usageMap = new Map((exitInfo.breakdown || []).map((b) => [b.code, b]));
    const curCode = exitInfo.currentExitCode || '';
    const breakdownRows = (exitInfo.breakdown || []).filter((b) => !/^0\.00\s*B$/i.test(b.usageText));

    card.innerHTML = `
      <div class="card-head">
        <div>
          <h3 class="card-title-lg">🌍 宿主机多出口单选与计费明细</h3>
          <div class="sub-note">严格单选互斥（同一时间仅 1 个出口生效）· 已计费 <strong>${esc(exitInfo.billedText)}</strong> / ${esc(exitInfo.totalText)}（剩 <strong>${esc(exitInfo.remainText)}</strong>）</div>
        </div>
        <div class="toolbar">
          <button class="btn sm" data-action="exit-latency">⚡ 测全出口延迟</button>
          <button class="btn sm" data-action="exit-diag">🩺 落地 IP 与 AI 体检</button>
          <button class="btn sm" data-action="exit-refresh">↻ 刷新计费</button>
        </div>
      </div>

      <div class="exit-grid mb-md">
        ${RESIDENTIAL_GLOBAL_EXITS.map((ex) => {
          const active = curCode === ex.code;
          const lat = latMap.get(ex.code);
          const u = usageMap.get(ex.code);
          const latPill = lat
            ? (lat.reachable
              ? `<span class="pill ${lat.ms < 80 ? 'green' : lat.ms < 160 ? 'blue' : 'orange'} xs num">${lat.ms.toFixed(1)} ms</span>`
              : '<span class="pill red xs">不可用</span>')
            : '';
          return `
            <button class="exit-tile ${active ? 'selected' : ''}" data-action="exit-switch" data-code="${esc(ex.code)}" data-label="${esc(ex.label)}" data-mult="${esc(ex.mult)}">
              <div class="exit-tile-main">
                <div class="exit-tile-title">${ex.flag} ${esc(ex.label)} <span class="pill gray xs num">${esc(ex.mult)}</span></div>
                <div class="exit-tile-sub num">本期实耗：${esc(u ? u.usageText : '0.00 B')}${active ? ' · 当前生效出口' : ''}</div>
              </div>
              <div class="exit-tile-right">
                ${latPill}
                ${active ? '<span class="pill blue xs">● 当前</span>' : '<span class="pill gray xs">切换</span>'}
              </div>
            </button>
          `;
        }).join('')}
      </div>

      ${breakdownRows.length ? `
        <div class="sub-note mb-xs">已产生流量的地区实耗明细（${esc(exitInfo.cycle || '')}）：</div>
        <div class="port-grid">
          ${breakdownRows.map((b) => `<div class="port-chip"><strong>${esc(b.label)}</strong><span class="mono num">${esc(b.usageText)} × ${esc(b.multiplier)}</span></div>`).join('')}
        </div>
      ` : ''}
    `;
    return;
  }

  const curCode = exitInfo.currentExitCode || 'jp';
  card.innerHTML = `
    <div class="card-head">
      <div>
        <h3 class="card-title-lg">🇯🇵 宿主机家宽出口单选与官方流量同步</h3>
        <div class="sub-note">当前采用面板原生流量计费（无倍率）· 点击右侧按钮静默后台一键同步官方本月流量（无需手动弹窗切页）</div>
      </div>
      <div class="toolbar">
        <button class="btn sm primary" data-action="nat-scrape-traffic">🪞 一键同步官方流量</button>
        <button class="btn sm" data-action="exit-diag">🩺 落地 IP 与 AI 体检</button>
        <button class="btn sm" data-action="exit-refresh">↻ 刷新状态</button>
      </div>
    </div>
    <div class="exit-grid">
      ${RESIDENTIAL_JP_EXITS.map((ex) => {
        const active = curCode === ex.code;
        return `
          <button class="exit-tile ${active ? 'selected' : ''}" data-action="exit-switch" data-code="${esc(ex.code)}" data-label="${esc(ex.label)}" data-mult="${esc(ex.mult)}">
            <div class="exit-tile-main">
              <div class="exit-tile-title">${ex.flag} ${esc(ex.label)}</div>
              <div class="exit-tile-sub">${esc(ex.mult)}${active ? ' · 当前生效出口' : ''}</div>
            </div>
            <div class="exit-tile-right">
              ${active ? '<span class="pill blue xs">● 当前</span>' : '<span class="pill gray xs">切换</span>'}
            </div>
          </button>
        `;
      }).join('')}
    </div>
  `;
}

function renderAlpineCard(node, cache) {
  const box = $('natAlpineBody');
  if (!node.sshPort || !node.publicIp) {
    $('natAlpineSub').textContent = '当前为免端口标准模式（零配置开箱即用）';
    box.innerHTML = `
      <div class="ios-list mb-md">
        <div class="ios-row">
          <div>
            <div class="ios-row-title">方式 A：直接用官方 Web 终端管理 sing-box（推荐）</div>
            <div class="ios-row-desc">无需多占 1 个端口映射，点击上方「打开官方 Web 终端」即可在隔离窗口内直接操作 Alpine 中的 sing-box。</div>
          </div>
          <button class="btn sm primary" data-action="nat-open-web">打开终端</button>
        </div>
        <div class="ios-row">
          <div>
            <div class="ios-row-title">方式 B：映射 1 个公网 SSH 端口解锁实时监控与出口单选</div>
            <div class="ios-row-desc">在服务商端口映射里将内网 22 映射到公网端口并填入本节点，即可直控多出口、改协议密码与查流量。</div>
          </div>
          <button class="btn sm" data-action="nat-edit-inline">去填写</button>
        </div>
      </div>
    `;
    return;
  }

  $('natAlpineSub').textContent = `SSH 直连 ${node.publicIp}:${node.sshPort}（30秒静默节流更新${cache.timeStr ? ` · 上次 ${cache.timeStr}` : ''}）`;

  if (cache.data) {
    const res = cache.data;
    const sb = res.singbox || {};
    box.innerHTML = `
      <div class="ios-list mb-md">
        <div class="ios-row"><span class="ios-row-title">系统与运行时间</span><span class="mono">${esc(res.os)} · ${fmtUptime(res.uptimeSec)}</span></div>
        <div class="ios-row"><span class="ios-row-title">CPU / 内存 / 硬盘</span><span class="mono num">CPU ${res.cpuPercent}% · 内存 ${fmtBytes(res.memory.used)}/${fmtBytes(res.memory.total)} · 盘 ${res.disk.percent}%</span></div>
        <div class="ios-row"><span class="ios-row-title">sing-box 进程</span><span class="pill ${sb.active ? 'green' : 'red'}">${sb.active ? `运行中 (${fmtBytes(sb.memoryBytes)})` : '未运行'}</span></div>
        <div class="ios-row"><span class="ios-row-title">sing-box 版本</span><span class="mono">${esc(sb.version || '--')}</span></div>
      </div>
      ${cache.error ? `<div class="sub-note text-danger mb-sm">最近一次后台静默刷新波动：${esc(cache.error)}（已保留上次正常数据）</div>` : ''}
      <div class="toolbar">
        <button class="btn sm" data-action="nat-alpine-act" data-act="check">✅ 语法校验</button>
        <button class="btn sm" data-action="nat-alpine-act" data-act="restart">🔁 重启 sb</button>
        <button class="btn sm" data-action="nat-alpine-act" data-act="ports">🔌 监听端口</button>
        <button class="btn sm" data-action="nat-goto-sb">🧩 改协议/密码</button>
      </div>
    `;
    return;
  }

  if (cache.error) {
    box.innerHTML = `<div class="notice-box">连接 Alpine SSH 失败：${esc(cache.error)}（你仍可直接使用上方「打开官方 Web 终端」）</div>`;
    return;
  }

  box.innerHTML = '<div class="sub-note">首次拉取 Alpine 实时指标中...</div>';
}

async function loadAlpineMetrics(appState, node, force = false) {
  const cache = getAlpineCache(appState, node.id);
  renderAlpineCard(node, cache);
  if (!node.sshPort || !node.publicIp) return;

  const now = Date.now();
  if (!force && cache.fetchedAt > 0 && now - cache.fetchedAt < NAT_ALPINE_MIN_POLL_MS) {
    return;
  }
  if (inFlightAlpine.has(node.id)) return;
  inFlightAlpine.add(node.id);

  try {
    const res = await invokeCmd('get_nat_alpine_overview', { nodeId: node.id });
    cache.data = res;
    cache.error = null;
    cache.fetchedAt = Date.now();
    cache.timeStr = nowTimeStr();
  } catch (err) {
    cache.error = err.message;
    cache.fetchedAt = Date.now();
  } finally {
    inFlightAlpine.delete(node.id);
    if (appState.activeNodeId === node.id) {
      renderNatHeaderAndCards(appState, node);
      renderAlpineCard(node, cache);
    }
  }
}

async function loadExitStatus(appState, node, force = false) {
  const cache = getExitCache(appState, node.id);
  renderExitControlCard(appState, node);
  if (!node.sshPort || !node.publicIp) return;

  const now = Date.now();
  if (!force && cache.fetchedAt > 0 && now - cache.fetchedAt < NAT_ALPINE_MIN_POLL_MS) {
    return;
  }
  if (inFlightExit.has(node.id)) return;
  inFlightExit.add(node.id);

  try {
    const res = await invokeCmd('get_nat_exit_status', { nodeId: node.id });
    cache.data = res;
    cache.error = null;
    cache.fetchedAt = Date.now();
    if (res.kind === 'global' && res.totalBytes > 0) {
      node.trafficSnapshot = {
        usedBytes: res.usedBytes,
        totalBytes: res.totalBytes,
        usedText: res.billedText,
        totalText: res.totalText,
        percent: res.percent,
        cycleText: res.cycle || '',
        expiresAt: res.expiresAt || '',
        syncedAt: String(Math.floor(Date.now() / 1000)),
        source: 'host-billing',
      };
    } else if (res.kind === 'jp' && node.portalUrl) {
      // 日本 NAT 采用面板原生计费：已登录沙箱时自动后台静默同步官方流量（10 分钟节流或手动强制刷新时触发，绝不弹窗打扰）
      const stale = Date.now() - (lastAutoTrafficAt[node.id] || 0) > 600000;
      if ((force || stale) && !inFlightAutoTraffic.has(node.id)) {
        inFlightAutoTraffic.add(node.id);
        lastAutoTrafficAt[node.id] = Date.now();
        invokeCmd('sync_dashboard_traffic', { targetKind: 'nat', targetId: node.id, silentOnly: true })
          .then((syncRes) => {
            if (!syncRes.needsWindowReady && syncRes.config) {
              appState.localConfig = syncRes.config;
              const fresh = getActiveNatNode(appState);
              if (fresh && fresh.id === node.id) renderNatHeaderAndCards(appState, fresh);
            }
          })
          .catch(() => {})
          .finally(() => inFlightAutoTraffic.delete(node.id));
      }
    }
  } catch (err) {
    cache.error = err.message;
    cache.fetchedAt = Date.now();
  } finally {
    inFlightExit.delete(node.id);
    if (appState.activeNodeId === node.id) {
      renderNatHeaderAndCards(appState, node);
      renderExitControlCard(appState, node);
    }
  }
}

export async function pingActiveNat(appState, node) {
  if (!node.publicIp || !node.servicePort) {
    $('natPingNote').textContent = '尚未填写公网 IP 与映射端口，点「编辑节点」补充后自动开启实时 TCP 测速';
    renderNatHeaderAndCards(appState, node);
    return;
  }
  if (inFlightPing.has(node.id)) return;
  inFlightPing.add(node.id);

  try {
    const res = await invokeCmd('tcp_ping_host', { host: node.publicIp, port: Number(node.servicePort) });
    const store = getPingStore(appState, node.id);
    store.last = res;
    if (res.reachable) {
      store.times.push(nowTimeStr());
      store.values.push(Number(res.ms));
      if (store.times.length > MAX_HISTORY_POINTS) {
        store.times.shift();
        store.values.shift();
      }
    }
    if (appState.activeNodeId === node.id) {
      const tunHint = res.reachable && res.ms < 2 ? '（本机 TUN 代理快速接管握手）' : '';
      $('natPingNote').textContent = res.reachable
        ? `实测 ${node.publicIp}:${node.servicePort} TCP 通畅（最新 ${fmtPingMs(res.ms)}）${tunHint}`
        : `实测 ${node.publicIp}:${node.servicePort} 失败：${res.error || '不可达'}`;
      renderNatHeaderAndCards(appState, node);
      renderNatPingChart(appState, node.id);
    }
  } catch (err) {
    showToast(err.message, true);
  } finally {
    inFlightPing.delete(node.id);
  }
}

export async function loadNatOverview(appState, forceAlpine = false) {
  const node = getActiveNatNode(appState);
  if (!node) return;
  renderNatHeaderAndCards(appState, node);
  renderExitControlCard(appState, node);
  renderNatPingChart(appState, node.id);
  await Promise.all([
    pingActiveNat(appState, node),
    loadAlpineMetrics(appState, node, forceAlpine),
    loadExitStatus(appState, node, forceAlpine),
  ]);
}

export function initNatOverviewEvents(appState, { openNatEditor, switchTab, openTerminalSb }) {
  $('natOpenPtyBtn')?.addEventListener('click', () => openTerminalSb());
  $('natQuickAuditBtn')?.addEventListener('click', () => switchTab('audit'));
  $('natQuickSbBtn')?.addEventListener('click', () => switchTab('singbox'));

  $('natOpenTerminalBtn').addEventListener('click', (ev) => withButtonLoading(ev.currentTarget, async () => {
    const node = getActiveNatNode(appState);
    if (!node) return;
    if (!node.portalUrl) return showToast('请先在「编辑节点」中填写官方控制台 URL', true);
    try {
      await invokeCmd('open_account_window', {
        profileId: node.providerProfileId || 'nat_main',
        title: `${node.name} · NAT 控制台`,
        url: node.portalUrl || DEFAULT_NAT_PORTAL_URL,
      });
    } catch (err) {
      showToast(err.message, true);
    }
  }));

  $('natPingBtn').addEventListener('click', (ev) => withButtonLoading(ev.currentTarget, async () => {
    const node = getActiveNatNode(appState);
    if (node) await pingActiveNat(appState, node);
  }));

  $('natCopyAddrBtn').addEventListener('click', (ev) => withButtonLoading(ev.currentTarget, async () => {
    const node = getActiveNatNode(appState);
    if (!node) return;
    try {
      if (node.sshPort > 0 && node.publicIp) {
        const cfg = await invokeCmd('get_nat_alpine_config', { nodeId: node.id });
        const firstInb = (cfg.inbounds || [])[0];
        if (firstInb) {
          const link = buildStandardNodeLink(firstInb, cfg.host || node.publicIp, cfg.publicKey || '', node.name);
          await copyToClipboard(link);
          showToast(`已按 ${String(firstInb.type || '').toUpperCase()} 协议复制「${node.name}」标准分享链接`);
          return;
        }
      }
      const text = node.shareLink || (node.publicIp && node.servicePort ? `${node.publicIp}:${node.servicePort}` : node.portalUrl);
      if (!text) return showToast('尚未填写分享链接或公网端口', true);
      await copyToClipboard(text);
      showToast(node.shareLink ? '已复制节点分享链接' : '已复制公网连接地址');
    } catch (err) {
      showToast(err.message, true);
    }
  }));

  $('natEditCurBtn').addEventListener('click', () => {
    const node = getActiveNatNode(appState);
    if (node) openNatEditor(node.id);
  });

  $('natAlpineRefreshBtn').addEventListener('click', (ev) => withButtonLoading(ev.currentTarget, async () => {
    const node = getActiveNatNode(appState);
    if (node) await Promise.all([loadAlpineMetrics(appState, node, true), loadExitStatus(appState, node, true)]);
  }));

  $('closeExitDiagBtn').addEventListener('click', () => closeModal('exitDiagModal'));
  $('copyExitDiagBtn').addEventListener('click', async () => {
    try {
      await copyToClipboard(lastDiagText);
      showToast('体检报告已复制到剪贴板');
    } catch (err) {
      showToast(err.message, true);
    }
  });

  $('natExitCard').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-action]');
    if (!btn) return;
    const node = getActiveNatNode(appState);
    if (!node) return;
    const act = btn.dataset.action;

    if (act === 'exit-refresh') {
      await withButtonLoading(btn, () => loadExitStatus(appState, node, true));
    } else if (act === 'exit-latency') {
      await withButtonLoading(btn, async () => {
        try {
          const res = await invokeCmd('get_nat_exit_latency', { nodeId: node.id });
          appState.natExitLatency[node.id] = res.items || [];
          renderExitControlCard(appState, node);
          showToast('宿主机 → 全出口延迟测速完成');
        } catch (err) {
          showToast(err.message, true);
        }
      });
    } else if (act === 'exit-diag') {
      $('exitDiagTitle').textContent = `🩺 ${node.name} · 落地 IP 与 AI 网站体检`;
      $('exitDiagBody').innerHTML = '<div class="sub-note empty-cell">正在向宿主机发起实时出口与 AI 网站检测（多出口约 20-45 秒，请稍候）...</div>';
      lastDiagText = '';
      openModal('exitDiagModal');
      try {
        const res = await invokeCmd('run_nat_exit_diag', { nodeId: node.id });
        lastDiagText = res.rawText || '(无返回输出)';
        $('exitDiagBody').innerHTML = `
          <div class="sub-note mb-sm">检测完成，耗时 ${(Number(res.elapsedMs || 0) / 1000).toFixed(1)} 秒</div>
          <pre class="terminal medium">${esc(lastDiagText)}</pre>
        `;
      } catch (err) {
        $('exitDiagBody').innerHTML = `<div class="notice-box">体检失败：${esc(err.message)}</div>`;
      }
    } else if (act === 'exit-switch') {
      const code = btn.dataset.code;
      const label = btn.dataset.label;
      const mult = btn.dataset.mult;
      const curCode = getExitCache(appState, node.id).data?.currentExitCode;
      if (code === curCode) {
        showToast(`当前已处于「${label}」`);
        return;
      }
      const ok = await confirmDialog({
        title: `切换家宽出口至「${label}」`,
        message: `将把 ${node.name} 的唯一出口切换为「${label}」（${mult}），原出口连接会平滑切换至新落地 IP，确认继续？`,
        confirmText: '确认切换',
        danger: false,
      });
      if (!ok) return;
      await withButtonLoading(btn, async () => {
        try {
          const res = await invokeCmd('switch_nat_exit_cmd', { nodeId: node.id, exitCode: code });
          const cache = getExitCache(appState, node.id);
          cache.data = res;
          cache.error = null;
          cache.fetchedAt = Date.now();
          renderNatHeaderAndCards(appState, node);
          renderExitControlCard(appState, node);
          showToast(`已成功切换出口为「${res.currentExit || label}」`);
        } catch (err) {
          showToast(err.message, true);
        }
      });
    } else if (act === 'nat-scrape-traffic') {
      await withButtonLoading(btn, async () => {
        try {
          const res = await invokeCmd('sync_dashboard_traffic', { targetKind: 'nat', targetId: node.id });
          if (res.needsWindowReady) {
            showToast(res.message);
            return;
          }
          if (res.config) appState.localConfig = res.config;
          const fresh = getActiveNatNode(appState);
          if (fresh) renderNatHeaderAndCards(appState, fresh);
          showToast(`已同步官方流量：${res.snapshot.usedText} / ${res.snapshot.totalText}`);
        } catch (err) {
          showToast(err.message, true);
        }
      });
    }
  });

  $('natAlpineBody').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-action]');
    if (!btn) return;
    const node = getActiveNatNode(appState);
    if (!node) return;
    if (btn.dataset.action === 'nat-open-web') {
      $('natOpenTerminalBtn').click();
    } else if (btn.dataset.action === 'nat-edit-inline') {
      openNatEditor(node.id);
    } else if (btn.dataset.action === 'nat-goto-sb') {
      switchTab('singbox');
    } else if (btn.dataset.action === 'nat-alpine-act') {
      const act = btn.dataset.act;
      await withButtonLoading(btn, async () => {
        try {
          const res = await invokeCmd('run_nat_alpine_action', { nodeId: node.id, action: act });
          showToast(res.output || '执行完成');
        } catch (err) {
          showToast(err.message, true);
        }
      });
    }
  });
}
