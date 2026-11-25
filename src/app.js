/**
 * NodeDeck 前端应用主入口：多节点路由调度、交互式 Demo Mode、主题同步与定时轮询
 */

import { renderOverviewCharts } from './components/area-chart.js';
import { initModals } from './components/modal.js';
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
import { initSettingsEvents, loadConfigUI } from './pages/settings.js';
import { initSingboxEvents, loadSingboxConfig } from './pages/singbox.js';
import { initUsersEvents, loadUsers } from './pages/users.js';
import { isDemoMode, onTrayRefresh, setDemoMode, syncNativeTheme, withButtonLoading } from './utils/bridge.js';
import { getDemoSeedHistories, resetDemoState } from './utils/demo-mock.js';
import { countryFlag, esc } from './utils/format.js';

const appState = {
  tab: 'overview',
  activeNodeId: MAIN_VPS_NODE_ID,
  timer: null,
  pollMs: DEFAULT_POLL_MS,
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
  const nats = appState.localConfig?.natNodes || [];
  sel.innerHTML = `
    <option value="${MAIN_VPS_NODE_ID}">🖥️ ${esc(vpsName)} (主 VPS)</option>
    ${nats.map((n) => `<option value="${esc(n.id)}">${countryFlag(n.region)} ${esc(n.name)} (NAT)</option>`).join('')}
  `;
  const exists = appState.activeNodeId === MAIN_VPS_NODE_ID || nats.some((n) => n.id === appState.activeNodeId);
  if (!exists) appState.activeNodeId = MAIN_VPS_NODE_ID;
  sel.value = appState.activeNodeId;
}

async function loadActiveOverview(force = false) {
  const isVps = appState.activeNodeId === MAIN_VPS_NODE_ID;
  document.getElementById('vpsOverviewPane').classList.toggle('hidden', !isVps);
  document.getElementById('natOverviewPane').classList.toggle('hidden', isVps);
  if (isVps) {
    await loadOverview(appState);
  } else {
    hideBanner();
    await loadNatOverview(appState, force);
  }
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

async function bootstrap() {
  initModals();
  const params = new URLSearchParams(window.location.search);
  const initialTheme = params.get('theme') || localStorage.getItem(THEME_STORAGE_KEY) || 'light';
  applyTheme(initialTheme);
  syncDemoToggleUI();
  seedHistoriesIfDemo();

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
      resetTimer();
    });
  });

  document.getElementById('refreshBtn').addEventListener('click', (ev) => {
    withButtonLoading(ev.currentTarget, () => refreshCurrentTab(true));
  });

  const ctx = {
    switchTab,
    switchToNode,
    toggleDemoMode: (on) => toggleDemoModeState(on),
    reloadOverview: () => loadActiveOverview(true),
    reloadMihomo: () => loadMihomo(appState),
    reloadConfigUI: () => loadConfigUI(appState),
    refreshNodeSwitcher: () => renderNodeSwitcher(),
    openNatEditor: (natId) => openNatEditor(appState, natId),
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

  window.addEventListener('resize', () => {
    if (appState.tab !== 'overview') return;
    if (appState.activeNodeId === MAIN_VPS_NODE_ID) renderOverviewCharts(appState);
    else renderNatPingChart(appState, appState.activeNodeId);
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
  renderNodeSwitcher();
  updateAssetsNavBadge(appState);

  const reqNode = params.get('node');
  if (reqNode) {
    appState.activeNodeId = reqNode;
    renderNodeSwitcher();
  }
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
