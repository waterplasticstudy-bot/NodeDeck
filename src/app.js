/**
 * NodeDeck 前端应用主入口：多节点路由调度、竞态防护、Ctrl+K 命令面板、主题/现场记忆与定时轮询
 */

import { renderOverviewCharts } from './components/area-chart.js';
import { initConfigExporter, openConfigExporter } from './components/config-exporter.js';
import { closeModal, initModals, openModal } from './components/modal.js';
import { initQrModalEvents } from './components/qr-modal.js';
import { showToast } from './components/toast.js';
import {
  DEFAULT_POLL_MS,
  MAIN_VPS_NODE_ID,
  TAB_TITLES,
  THEME_STORAGE_KEY,
} from './constants/ui-constants.js';
import { initAssetsEvents, loadAssets, openNatEditor, updateAssetsNavBadge } from './pages/assets.js';
import { initAuditEvents, loadAudit } from './pages/audit.js';
import { initLogsEvents, loadLogs } from './pages/logs.js';
import { initMihomoEvents, loadMihomo } from './pages/mihomo.js';
import { initNatOverviewEvents, loadNatOverview, renderNatPingChart } from './pages/nat-overview.js';
import { hideBanner, initOverviewEvents, loadOverview } from './pages/overview.js';
import { applyAppearancePrefs, initSettingsEvents, loadAppearancePrefs, loadConfigUI } from './pages/settings.js';
import { initSingboxEvents, loadSingboxConfig } from './pages/singbox.js';
import { initUsersEvents, loadUsers } from './pages/users.js';
import { isDemoMode, onTrayRefresh, setDemoMode, syncNativeTheme, withButtonLoading } from './utils/bridge.js';
import { getDemoSeedHistories, resetDemoState } from './utils/demo-mock.js';
import { countryFlag, esc } from './utils/format.js';

const LAST_NODE_STORAGE_KEY = 'nodedeck_last_node_id';
const LAST_POLL_STORAGE_KEY = 'nodedeck_last_poll_ms';

const appState = {
  tab: 'overview',
  activeNodeId: MAIN_VPS_NODE_ID,
  timer: null,
  pollMs: DEFAULT_POLL_MS,
  navSeq: 0,
  times: [],
  cpuHist: [],
  memHist: [],
  rxHist: [],
  txHist: [],
  peakMbps: 0,
  natPingHist: {},
  natAlpineCache: {},
  natExitCache: {},
  natExitLatency: {},
  isAutoPolling: false,
  accountSessions: {},
  usersViewMode: 'matrix',
  allNodesUsers: [],
  rawLogs: '',
  auditData: null,
  mhData: null,
  mhFilter: 'all',
  lastOverview: null,
  localConfig: null,
  antiChinaEnabled: false,
  clashApiEnabled: false,
  pendingAuditFilter: undefined,
};

function clearRuntimeHistories() {
  appState.times = [];
  appState.cpuHist = [];
  appState.memHist = [];
  appState.rxHist = [];
  appState.txHist = [];
  appState.peakMbps = 0;
  appState.natPingHist = {};
  appState.natAlpineCache = {};
  appState.natExitCache = {};
  appState.natExitLatency = {};
  appState.lastOverview = null;
}

function seedHistoriesIfDemo() {
  clearRuntimeHistories();
  if (!isDemoMode()) return;
  const seed = getDemoSeedHistories();
  appState.times = seed.times;
  appState.cpuHist = seed.cpuHist;
  appState.memHist = seed.memHist;
  appState.rxHist = seed.rxHist;
  appState.txHist = seed.txHist;
  appState.peakMbps = Math.max(...seed.rxHist, ...seed.txHist);
  appState.natPingHist = seed.natPingHist;
  appState.natExitLatency = seed.natExitLatency;
}

function syncDemoToggleUI() {
  const active = isDemoMode();
  const btn = document.getElementById('demoToggleBtn');
  const badge = document.getElementById('demoToggleBadge');
  if (btn) btn.classList.toggle('active', active);
  if (badge) {
    badge.textContent = active ? '演示中' : '关闭';
    badge.className = `pill ${active ? 'blue' : 'gray'} xs`;
  }
}

function applyTheme(theme) {
  const normalized = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', normalized);
  localStorage.setItem(THEME_STORAGE_KEY, normalized);
  document.querySelectorAll('#themeSeg button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.themeVal === normalized);
  });
  syncNativeTheme(normalized);
}

function renderNodeSwitcher() {
  const sel = document.getElementById('nodeSwitcher');
  if (!sel) return;
  const vpsName = appState.localConfig?.name || 'My Primary VPS';
  const vpsFlag = countryFlag(appState.localConfig?.region || 'US');
  const nats = appState.localConfig?.natNodes || [];
  sel.innerHTML = `
    <option value="${MAIN_VPS_NODE_ID}">${vpsFlag} ${esc(vpsName)} (主 VPS)</option>
    ${nats.map((n) => `<option value="${esc(n.id)}">${countryFlag(n.region)} ${esc(n.name)} (NAT)</option>`).join('')}
  `;
  const exists = appState.activeNodeId === MAIN_VPS_NODE_ID || nats.some((n) => n.id === appState.activeNodeId);
  if (!exists) appState.activeNodeId = MAIN_VPS_NODE_ID;
  sel.value = appState.activeNodeId;
}

async function loadActiveOverview(force = false) {
  const mySeq = ++appState.navSeq;
  const isVps = appState.activeNodeId === MAIN_VPS_NODE_ID;
  document.getElementById('vpsOverviewPane').classList.toggle('hidden', !isVps);
  document.getElementById('natOverviewPane').classList.toggle('hidden', isVps);
  if (isVps) {
    await loadOverview(appState);
  } else {
    hideBanner();
    await loadNatOverview(appState, force);
  }
  return mySeq === appState.navSeq;
}

async function refreshCurrentTab(force = false) {
  switch (appState.tab) {
    case 'overview':
      await loadActiveOverview(force);
      break;
    case 'mihomo':
      await loadMihomo(appState);
      break;
    case 'singbox':
      await loadSingboxConfig(appState);
      break;
    case 'users':
      await loadUsers(appState);
      break;
    case 'audit':
      await loadAudit(appState);
      break;
    case 'logs':
      await loadLogs(appState);
      break;
    case 'assets':
      await loadAssets(appState);
      break;
    case 'settings':
      await loadConfigUI(appState);
      break;
    default:
      break;
  }
}

function switchTab(tabName, filterUser = null) {
  const validTab = TAB_TITLES[tabName] ? tabName : 'overview';
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === validTab);
  });
  document.querySelectorAll('.tab').forEach((section) => {
    section.classList.toggle('active', section.id === `tab-${validTab}`);
  });
  appState.tab = validTab;
  document.getElementById('pageHeading').textContent = TAB_TITLES[validTab] || '节点总览';
  if (validTab === 'audit' && filterUser !== null) {
    appState.pendingAuditFilter = filterUser;
  }
  refreshCurrentTab();
}

function switchToNode(nodeId, targetTab = null) {
  appState.activeNodeId = nodeId;
  if (!isDemoMode()) {
    try { localStorage.setItem(LAST_NODE_STORAGE_KEY, nodeId); } catch { /* ignore */ }
  }
  const sel = document.getElementById('nodeSwitcher');
  if (sel) sel.value = nodeId;
  const svcOut = document.getElementById('svcOutput');
  if (svcOut) {
    svcOut.textContent = '';
    svcOut.classList.add('hidden');
  }
  if (targetTab) switchTab(targetTab);
  else refreshCurrentTab();
}

async function toggleDemoModeState(enable) {
  if (!window.__TAURI__?.core?.invoke && !enable) {
    showToast('当前在浏览器预览中，仅支持演示模式；请编译运行 NodeDeck.exe 管理真实服务器');
    return;
  }
  setDemoMode(enable);
  if (enable) resetDemoState();
  syncDemoToggleUI();
  seedHistoriesIfDemo();
  appState.activeNodeId = MAIN_VPS_NODE_ID;
  await loadConfigUI(appState);
  renderNodeSwitcher();
  updateAssetsNavBadge(appState);
  await Promise.all([refreshCurrentTab(true), loadMihomo(appState)]);
  showToast(enable ? '已切换至交互式演示模式（全模拟 RFC 5737 数据）' : '已退出演示模式，恢复连接本地真实配置');
}

function resetTimer() {
  clearInterval(appState.timer);
  if (appState.pollMs > 0) {
    appState.timer = setInterval(async () => {
      if (document.hidden || appState.isAutoPolling || document.querySelector('.modal-bg.show')) {
        return;
      }
      appState.isAutoPolling = true;
      try {
        if (appState.tab === 'overview') await loadActiveOverview(false);
        else if (appState.tab === 'mihomo' && appState.mhData?.connected) await loadMihomo(appState);
        else if (appState.tab === 'audit' && appState.auditData?.enabled) {
          await loadAudit(appState);
        }
      } finally {
        appState.isAutoPolling = false;
      }
    }, appState.pollMs);
  }
}

/** Ctrl+K 快速跳转命令面板 */
function buildPaletteActions() {
  const actions = [
    { icon: '📦', title: '离线生成客户端配置文件', sub: '支持多节点组合打包与常用方案预设 (.yaml / .js)', run: () => openConfigExporter(appState, null) },
    { icon: '📊', title: '前往 · 节点总览', sub: '实时监控主 VPS / NAT 系统与出口状态', run: () => switchTab('overview') },
    { icon: '💻', title: '前往 · 本机 Mihomo', sub: '切换策略组、全组测速与 AI 连通性探测', run: () => switchTab('mihomo') },
    { icon: '🕵️', title: '前往 · 成员流量与在线监控', sub: '查看活跃连接、防外泄预警与定位域拦截', run: () => switchTab('audit') },
    { icon: '🧩', title: '前往 · sing-box 节点与协议', sub: '增删改入站协议、端口、密钥与历史备份回滚', run: () => switchTab('singbox') },
    { icon: '👥', title: '前往 · 用户与节点归属', sub: '全节点用户矩阵、二维码与配置生成', run: () => switchTab('users') },
    { icon: '📜', title: '前往 · 日志与运维', sub: '查看高亮运行日志、语法校验与一键重启', run: () => switchTab('logs') },
    { icon: '💳', title: '前往 · 续费与多账号', sub: '隔离沙箱登录、流量识别与月均支出汇总', run: () => switchTab('assets') },
    { icon: '⚙️', title: '前往 · 本机与节点配置', sub: '修改主机、地区、私钥路径与 Mihomo 控制口', run: () => switchTab('settings') },
    {
      icon: '🌗',
      title: '切换浅色 / 深色外观主题',
      sub: '同步更新 Windows 原生标题栏外观',
      run: () => applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'),
    },
    { icon: '↻', title: '立即刷新当前页面', sub: '快捷键 Ctrl+R / F5', run: () => refreshCurrentTab(true) },
  ];
  const vpsName = appState.localConfig?.name || '主 VPS';
  actions.push({
    icon: countryFlag(appState.localConfig?.region || 'US'),
    title: `切换节点 · ${vpsName} (主 VPS)`,
    sub: appState.localConfig?.host || '主服务器',
    run: () => switchToNode(MAIN_VPS_NODE_ID, 'overview'),
  });
  for (const nat of appState.localConfig?.natNodes || []) {
    actions.push({
      icon: countryFlag(nat.region),
      title: `切换节点 · ${nat.name} (NAT)`,
      sub: `${nat.publicIp || '--'}:${nat.servicePort || '--'} · ${nat.plan || '家宽 NAT'}`,
      run: () => switchToNode(nat.id, 'overview'),
    });
  }
  return actions;
}

function initCommandPalette() {
  const input = document.getElementById('cmdPaletteInput');
  const listEl = document.getElementById('cmdPaletteList');
  let filtered = [];
  let activeIdx = 0;

  const render = () => {
    const kw = (input.value || '').trim().toLowerCase();
    const all = buildPaletteActions();
    filtered = kw
      ? all.filter((a) => `${a.title} ${a.sub}`.toLowerCase().includes(kw))
      : all;
    activeIdx = Math.min(activeIdx, Math.max(0, filtered.length - 1));
    listEl.innerHTML = filtered.map((a, idx) => `
      <button class="cmd-item ${idx === activeIdx ? 'active' : ''}" type="button" data-cmd-idx="${idx}">
        <span class="cmd-icon">${a.icon}</span>
        <span class="cmd-meta">
          <span class="cmd-title">${esc(a.title)}</span>
          <span class="cmd-sub">${esc(a.sub)}</span>
        </span>
      </button>
    `).join('') || '<div class="sub-note empty-cell">无匹配命令</div>';
  };

  const openPalette = () => {
    input.value = '';
    activeIdx = 0;
    render();
    openModal('cmdPaletteModal');
    setTimeout(() => input.focus(), 20);
  };

  document.getElementById('openCmdPaletteBtn')?.addEventListener('click', openPalette);
  input.addEventListener('input', () => {
    activeIdx = 0;
    render();
  });
  input.addEventListener('keydown', (ev) => {
    if (!filtered.length) return;
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      activeIdx = (activeIdx + 1) % filtered.length;
      render();
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      activeIdx = (activeIdx - 1 + filtered.length) % filtered.length;
      render();
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      const act = filtered[activeIdx];
      closeModal('cmdPaletteModal');
      if (act) act.run();
    }
  });
  listEl.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-cmd-idx]');
    if (!btn) return;
    const act = filtered[Number(btn.dataset.cmdIdx)];
    closeModal('cmdPaletteModal');
    if (act) act.run();
  });

  document.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') {
      ev.preventDefault();
      if (document.getElementById('cmdPaletteModal')?.classList.contains('show')) {
        closeModal('cmdPaletteModal');
      } else {
        openPalette();
      }
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'r') {
      ev.preventDefault();
      refreshCurrentTab(true);
      showToast('已刷新当前页面');
      return;
    }
    if (ev.key === 'F5') {
      ev.preventDefault();
      refreshCurrentTab(true);
      showToast('已刷新当前页面');
    }
  });
}

function initPasswordToggles() {
  document.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-toggle-pass]');
    if (!btn) return;
    const target = document.getElementById(btn.dataset.togglePass);
    if (!target) return;
    const hidden = target.type === 'password';
    target.type = hidden ? 'text' : 'password';
    btn.textContent = hidden ? '🙈' : '👁️';
    btn.title = hidden ? '隐藏内容' : '显示明文';
  });
}

async function bootstrap() {
  initModals();
  initQrModalEvents();
  initConfigExporter(appState);
  initCommandPalette();
  initPasswordToggles();

  const params = new URLSearchParams(window.location.search);
  const initialTheme = params.get('theme') || localStorage.getItem(THEME_STORAGE_KEY) || 'light';
  applyTheme(initialTheme);
  applyAppearancePrefs(loadAppearancePrefs(), false);
  syncDemoToggleUI();
  seedHistoriesIfDemo();

  // 恢复上次轮询频率偏好
  const savedPoll = Number(localStorage.getItem(LAST_POLL_STORAGE_KEY));
  if ([0, 5000, 10000, 30000].includes(savedPoll) && localStorage.getItem(LAST_POLL_STORAGE_KEY) !== null) {
    appState.pollMs = savedPoll;
    document.querySelectorAll('#pollSeg button').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.ms) === savedPoll);
    });
  }

  document.querySelectorAll('#themeSeg button').forEach((btn) => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.themeVal));
  });

  document.getElementById('demoToggleBtn').addEventListener('click', () => {
    toggleDemoModeState(!isDemoMode());
  });

  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('nodeSwitcher').addEventListener('change', (ev) => {
    switchToNode(ev.target.value);
  });

  document.querySelectorAll('#pollSeg button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#pollSeg button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      appState.pollMs = Number(btn.dataset.ms);
      try { localStorage.setItem(LAST_POLL_STORAGE_KEY, String(appState.pollMs)); } catch { /* ignore */ }
      resetTimer();
    });
  });

  document.getElementById('refreshBtn').addEventListener('click', (ev) => {
    withButtonLoading(ev.currentTarget, () => refreshCurrentTab(true));
  });

  const ctx = {
    switchTab,
    switchToNode,
    applyAppearancePrefs,
    toggleDemoMode: (on) => toggleDemoModeState(on),
    reloadOverview: () => loadActiveOverview(true),
    reloadMihomo: () => loadMihomo(appState),
    reloadConfigUI: () => loadConfigUI(appState),
    refreshNodeSwitcher: () => renderNodeSwitcher(),
    openNatEditor: (natId) => openNatEditor(appState, natId),
    openConfigExporter: (seedCtx = null) => openConfigExporter(appState, seedCtx),
    onNodesChanged: (deletedId = null) => {
      if (deletedId && appState.activeNodeId === deletedId) {
        appState.activeNodeId = MAIN_VPS_NODE_ID;
      }
      renderNodeSwitcher();
      updateAssetsNavBadge(appState);
      if (appState.tab === 'overview') loadActiveOverview(true);
      else if (appState.tab === 'logs' || appState.tab === 'singbox') refreshCurrentTab(true);
    },
  };

  initOverviewEvents(appState, ctx);
  initNatOverviewEvents(appState, ctx);
  initMihomoEvents(appState, ctx);
  initAuditEvents(appState, ctx);
  initSingboxEvents(appState, ctx);
  initUsersEvents(appState, ctx);
  initLogsEvents(appState, ctx);
  initAssetsEvents(appState, ctx);
  initSettingsEvents(appState, ctx);

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (appState.tab !== 'overview') return;
      if (appState.activeNodeId === MAIN_VPS_NODE_ID) renderOverviewCharts(appState);
      else renderNatPingChart(appState, appState.activeNodeId);
    }, 120);
  });

  onTrayRefresh(() => {
    loadActiveOverview(true);
    loadMihomo(appState);
  });

  try {
    await loadConfigUI(appState);
  } catch {
    // 兜底初始化
  }
  const reqNode = params.get('node') || (!isDemoMode() ? localStorage.getItem(LAST_NODE_STORAGE_KEY) : null);
  if (reqNode) {
    appState.activeNodeId = reqNode;
  }
  renderNodeSwitcher();
  updateAssetsNavBadge(appState);

  await loadActiveOverview();
  const reqTab = params.get('tab');
  if (reqTab && TAB_TITLES[reqTab] && reqTab !== 'overview') {
    switchTab(reqTab);
  }
  loadMihomo(appState);
  if (params.get('demo') !== '1') {
    resetTimer();
  }
}

bootstrap();
