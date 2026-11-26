/**
 * 本机 Mihomo / Clash API 整合页（全链路视图、AI 并发测速、Zashboard 级 DIY 策略组/连接控制、只读规则检视器、内嵌 Web 面板）
 */

import { confirmDialog } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import {
  AI_DOMAIN_REGEX,
  DEFAULT_MIHOMO_URL,
  HEALTH_THRESHOLDS,
  MIHOMO_MODE_LABELS,
} from '../constants/ui-constants.js';
import { copyToClipboard, invokeCmd, openExternal, withButtonLoading } from '../utils/bridge.js';
import { annotateHost, esc, fmtBytes } from '../utils/format.js';

const $ = (id) => document.getElementById(id);
const DEFAULT_VISIBLE_NODES = 24;
const MAX_VISIBLE_RULES = 400;
const DIY_PREFS_KEY = 'nodedeck_mihomo_diy_v1';
const DEFAULT_DELAY_TEST_URL = 'https://www.gstatic.com/generate_204';

const VALID_SORTS = new Set(['default', 'delay', 'name']);
const VALID_DENSITIES = new Set(['normal', 'compact', 'wide']);
const VALID_TIMEOUTS = new Set([3000, 5000, 8000]);
const VALID_CONN_SORTS = new Set(['traffic', 'host', 'process']);
const VALID_CONN_COLS = new Set(['process', 'host', 'rule', 'chains', 'traffic', 'action']);
const CONTROL_PSEUDO_NAMES = new Set(['DIRECT', 'REJECT']);
const CONTROL_PSEUDO_TYPES = new Set(['Direct', 'Reject', 'Selector', 'URLTest', 'Fallback', 'LoadBalance']);

const DEFAULT_DIY_PREFS = {
  sort: 'default',
  density: 'normal',
  hideUnavailable: false,
  testUrl: DEFAULT_DELAY_TEST_URL,
  timeoutMs: 5000,
  connSort: 'traffic',
  hiddenCols: [],
};

const expandedGroups = new Set();
const groupSearchTerms = new Map();
let diyPrefs = { ...DEFAULT_DIY_PREFS };
let connPaused = false;

function loadDiyPrefs() {
  try {
    const raw = localStorage.getItem(DIY_PREFS_KEY);
    if (!raw) {
      diyPrefs = { ...DEFAULT_DIY_PREFS };
      return;
    }
    const parsed = JSON.parse(raw);
    const timeoutNum = Number(parsed?.timeoutMs);
    diyPrefs = {
      sort: VALID_SORTS.has(parsed?.sort) ? parsed.sort : DEFAULT_DIY_PREFS.sort,
      density: VALID_DENSITIES.has(parsed?.density) ? parsed.density : DEFAULT_DIY_PREFS.density,
      hideUnavailable: Boolean(parsed?.hideUnavailable),
      testUrl: typeof parsed?.testUrl === 'string' && parsed.testUrl.trim()
        ? parsed.testUrl.trim()
        : DEFAULT_DIY_PREFS.testUrl,
      timeoutMs: VALID_TIMEOUTS.has(timeoutNum) ? timeoutNum : DEFAULT_DIY_PREFS.timeoutMs,
      connSort: VALID_CONN_SORTS.has(parsed?.connSort) ? parsed.connSort : DEFAULT_DIY_PREFS.connSort,
      hiddenCols: Array.isArray(parsed?.hiddenCols)
        ? parsed.hiddenCols.filter((c) => VALID_CONN_COLS.has(c))
        : [],
    };
  } catch {
    diyPrefs = { ...DEFAULT_DIY_PREFS };
  }
}

function saveDiyPrefs() {
  try {
    localStorage.setItem(DIY_PREFS_KEY, JSON.stringify(diyPrefs));
  } catch {
    // 存储空间受限时静默忽略
  }
}

function applyConnColumnVisibility() {
  const table = $('mhConnTable');
  if (!table) return;
  const hiddenSet = new Set(diyPrefs.hiddenCols);
  table.querySelectorAll('[data-col]').forEach((el) => {
    el.classList.toggle('hidden', hiddenSet.has(el.dataset.col));
  });
}

function applyDiyPrefsToUI() {
  if ($('mhNodeSort')) $('mhNodeSort').value = diyPrefs.sort;
  if ($('mhCardDensity')) $('mhCardDensity').value = diyPrefs.density;
  if ($('mhHideUnavailable')) $('mhHideUnavailable').checked = diyPrefs.hideUnavailable;
  if ($('mhTestUrlInput')) $('mhTestUrlInput').value = diyPrefs.testUrl;
  if ($('mhTestTimeoutSelect')) $('mhTestTimeoutSelect').value = String(diyPrefs.timeoutMs);
  if ($('mhConnSort')) $('mhConnSort').value = diyPrefs.connSort;

  const hiddenSet = new Set(diyPrefs.hiddenCols);
  const colsBar = $('mhConnColsBar');
  if (colsBar) {
    colsBar.querySelectorAll('input[data-conn-col]').forEach((cb) => {
      cb.checked = !hiddenSet.has(cb.dataset.connCol);
    });
  }
  applyConnColumnVisibility();
}

function updateConnPauseBtn() {
  const btn = $('mhConnPauseBtn');
  if (!btn) return;
  btn.textContent = connPaused ? '▶️ 已暂停(点此恢复)' : '⏸️ 暂停刷新';
  btn.classList.toggle('primary', connPaused);
}

function getDelayTestParams() {
  const rawUrl = ($('mhTestUrlInput')?.value ?? diyPrefs.testUrl ?? '').trim();
  const testUrl = rawUrl || DEFAULT_DELAY_TEST_URL;
  const rawTimeout = Number($('mhTestTimeoutSelect')?.value ?? diyPrefs.timeoutMs ?? 5000);
  const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 5000;
  return { testUrl, timeoutMs };
}

function isControlPseudoNode(node) {
  return CONTROL_PSEUDO_NAMES.has(node.name) || CONTROL_PSEUDO_TYPES.has(node.type);
}

function delayToneClass(delay) {
  if (!delay || delay <= 0) return '';
  if (delay <= 120) return 'good';
  if (delay <= 300) return 'warn';
  return 'bad';
}

function ruleTargetTone(proxy) {
  if (proxy === 'REJECT' || proxy === 'REJECT-DROP') return 'red';
  if (proxy === 'DIRECT') return 'gray';
  return 'blue';
}

export async function runConnectivityProbe() {
  const box = $('probeList');
  if (!box) return;
  box.innerHTML = '<div class="sub-note">正在经当前代理链路并发测速中...</div>';
  try {
    const { results } = await invokeCmd('probe_connectivity');
    box.innerHTML = results.map((item) => {
      const pct = item.ok
        ? Math.min(100, Math.max(8, (item.ms / HEALTH_THRESHOLDS.probeMaxScaleMs) * 100))
        : 100;
      const color = !item.ok
        ? 'var(--red)'
        : item.ms < HEALTH_THRESHOLDS.probeGoodMs
          ? 'var(--green)'
          : item.ms < HEALTH_THRESHOLDS.probeWarnMs
            ? 'var(--orange)'
            : 'var(--red)';
      return `
        <div class="probe-row">
          <span class="text-strong">${esc(item.name)}</span>
          <div class="probe-track"><div class="probe-fill" style="width:${pct.toFixed(0)}%;background:${color}"></div></div>
          <span class="num mono text-right text-strong" style="color:${color}">${item.ok ? `${item.ms} ms` : esc(item.error || '失败')}</span>
        </div>
      `;
    }).join('');
  } catch (err) {
    box.innerHTML = `<div class="sub-note text-danger">测速失败：${esc(err.message)}</div>`;
  }
}

export function renderMihomoGroups(appState) {
  const d = appState.mhData;
  const grid = $('mhGroupsGrid');
  if (!d || !d.connected || !grid) return;

  const showAll = Boolean($('showAllGroups')?.checked);
  const sort = $('mhNodeSort')?.value || diyPrefs.sort;
  const density = $('mhCardDensity')?.value || diyPrefs.density;
  const hideUnavailable = $('mhHideUnavailable') ? $('mhHideUnavailable').checked : diyPrefs.hideUnavailable;

  grid.classList.toggle('grid-1', density === 'wide');
  grid.classList.toggle('grid-2', density !== 'wide');

  const densityCls = density === 'compact'
    ? 'density-compact'
    : density === 'wide'
      ? 'density-wide'
      : '';

  const groups = showAll ? d.groups : d.groups.slice(0, 6);

  grid.innerHTML = groups.map((g) => {
    const canSwitch = g.type === 'Selector';
    const kw = (groupSearchTerms.get(g.name) || '').trim().toLowerCase();
    let filtered = kw
      ? g.nodes.filter((n) => `${n.name} ${n.type}`.toLowerCase().includes(kw))
      : [...g.nodes];

    if (hideUnavailable) {
      filtered = filtered.filter((n) => (n.delay && n.delay > 0) || n.name === g.now || isControlPseudoNode(n));
    }

    if (sort === 'delay') {
      filtered.sort((a, b) => {
        const da = a.delay && a.delay > 0 ? a.delay : Infinity;
        const db = b.delay && b.delay > 0 ? b.delay : Infinity;
        if (da === db) return 0;
        if (da === Infinity) return 1;
        if (db === Infinity) return -1;
        return da - db;
      });
    } else if (sort === 'name') {
      filtered.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    }

    const isExpanded = expandedGroups.has(g.name) || Boolean(kw);
    const visible = isExpanded ? filtered : filtered.slice(0, DEFAULT_VISIBLE_NODES);
    const hiddenCount = Math.max(0, filtered.length - visible.length);

    return `
      <div class="sub-panel">
        <div class="flex-between mb-xs" style="flex-wrap:wrap;gap:8px;">
          <div class="row-inline">
            <strong class="text-strong">${esc(g.name)}</strong>
            <span class="pill gray xs">${esc(g.type)} · ${g.nodes.length}</span>
          </div>
          <div class="toolbar">
            <span class="pill blue pill-truncate">${esc(g.now || '--')}</span>
            <button class="btn sm" data-action="mh-delay" data-node="${esc(g.now || g.name)}" title="测当前选中节点延迟">测当前</button>
            <button class="btn sm" data-action="mh-group-delay" data-group="${esc(g.name)}" title="并发测速本策略组内全部节点">⚡ 测整组</button>
          </div>
        </div>
        ${g.nodes.length > 12 ? `
          <div class="flex-between mb-xs" style="gap:8px;">
            <input class="input sm-search" data-mh-group-search="${esc(g.name)}" value="${esc(groupSearchTerms.get(g.name) || '')}" placeholder="筛选「${esc(g.name)}」内 ${g.nodes.length} 个节点..." />
            ${filtered.length > DEFAULT_VISIBLE_NODES && !kw ? `
              <button class="btn sm" data-action="mh-toggle-expand" data-group="${esc(g.name)}">${isExpanded ? '收起' : `展开全部 (+${hiddenCount})`}</button>
            ` : ''}
          </div>
        ` : ''}
        <div class="node-grid ${isExpanded ? 'expanded' : ''} ${densityCls}">
          ${visible.map((n) => `
            <button class="node-pill ${n.name === g.now ? 'selected' : ''}"
              data-node-name="${esc(n.name)}"
              ${canSwitch ? `data-action="mh-select" data-group="${esc(g.name)}" data-node="${esc(n.name)}"` : 'aria-disabled="true"'}
              title="${esc(n.name)} (${esc(n.type)}) · 右键快速测速">
              <span>${esc(n.name)}</span>
              ${n.delay ? `<span class="nd ${delayToneClass(n.delay)} num">${n.delay}ms</span>` : ''}
            </button>
          `).join('') || '<span class="sub-note">无匹配节点</span>'}
        </div>
      </div>
    `;
  }).join('');
}

export function renderMihomoConnections(appState) {
  const d = appState.mhData;
  const tbody = $('mhConnBody');
  if (!d || !d.connected || !tbody) return;

  const kw = ($('mhConnSearch')?.value || '').trim().toLowerCase();
  const bf = appState.mhFilter;
  const sortMode = $('mhConnSort')?.value || diyPrefs.connSort;

  const list = (d.connections || []).filter((c) => {
    const chainStr = c.chains.join(' → ');
    const isDirect = c.chains.includes('DIRECT');
    if (bf === 'proxy' && isDirect) return false;
    if (bf === 'direct' && !isDirect) return false;
    if (bf === 'ai' && !AI_DOMAIN_REGEX.test(c.host)) return false;
    if (kw && !`${c.process} ${c.host}:${c.port} ${c.rule} ${c.rulePayload} ${chainStr}`.toLowerCase().includes(kw)) {
      return false;
    }
    return true;
  });

  if (sortMode === 'traffic') {
    list.sort((a, b) => (b.upload + b.download) - (a.upload + a.download));
  } else if (sortMode === 'host') {
    list.sort((a, b) => String(a.host || '').localeCompare(String(b.host || '')));
  } else if (sortMode === 'process') {
    list.sort((a, b) => String(a.process || '系统').localeCompare(String(b.process || '系统')));
  }

  if ($('mhTableCount')) $('mhTableCount').textContent = `${list.length} 条`;
  const visibleCols = Math.max(1, 6 - diyPrefs.hiddenCols.length);

  tbody.innerHTML = list.map((c) => {
    const chainPath = [...c.chains].reverse().join(' → ');
    const isDirect = c.chains.includes('DIRECT');
    const tag = annotateHost(c.host, c.port);
    const ruleText = c.rulePayload ? `${c.rule},${c.rulePayload}` : (c.rule || '');
    return `
      <tr>
        <td data-col="process"><strong>${esc(c.process || '系统')}</strong></td>
        <td data-col="host" data-copy="${esc(c.host || '')}" class="mono">${esc(c.host)}:${esc(c.port)} ${tag ? `<span class="pill ${tag.cls} ml-xs">${tag.label}</span>` : ''}</td>
        <td data-col="rule" data-copy="${esc(ruleText)}" class="mono">${esc(c.rule)}${c.rulePayload ? ` (${esc(c.rulePayload)})` : ''}</td>
        <td data-col="chains" data-copy="${esc(chainPath || '')}"><span class="pill ${isDirect ? 'gray' : 'green'}">${esc(chainPath || '--')}</span></td>
        <td data-col="traffic" class="mono num">↑${fmtBytes(c.upload)} / ↓${fmtBytes(c.download)}</td>
        <td data-col="action"><button class="btn sm danger" data-action="mh-close" data-id="${esc(c.id)}">掐断</button></td>
      </tr>
    `;
  }).join('') || `<tr><td colspan="${visibleCols}" class="empty-cell">当前无匹配的本机连接</td></tr>`;

  applyConnColumnVisibility();
}

function renderMihomoRules(appState) {
  const data = appState.mhRulesData;
  const tbody = $('mhRulesBody');
  const badge = $('mhRulesTotalBadge');
  if (!data || !tbody) return;

  const rules = Array.isArray(data.rules) ? data.rules : [];
  const total = data.totalRules ?? rules.length;
  const kw = ($('mhRulesSearch')?.value || '').trim().toLowerCase();
  const target = $('mhRulesTargetFilter')?.value || '';

  const filtered = rules.filter((r) => {
    if (target && r.proxy !== target) return false;
    if (kw && !`${r.type} ${r.payload} ${r.proxy}`.toLowerCase().includes(kw)) return false;
    return true;
  });

  if (badge) {
    badge.textContent = filtered.length === total ? `${total} 条` : `${filtered.length} / ${total} 条`;
  }

  const shown = filtered.slice(0, MAX_VISIBLE_RULES);
  const rowsHtml = shown.map((r) => `
    <tr>
      <td class="mono num">${esc(r.index)}</td>
      <td><span class="pill gray xs">${esc(r.type)}</span></td>
      <td class="mono">${esc(r.payload || '--')}</td>
      <td><span class="pill ${ruleTargetTone(r.proxy)} xs">${esc(r.proxy || '--')}</span></td>
    </tr>
  `).join('');

  const overflowRow = filtered.length > MAX_VISIBLE_RULES
    ? `<tr><td colspan="4" class="empty-cell">仅展示前 ${MAX_VISIBLE_RULES} 条匹配规则（共 ${filtered.length} 条，请输入关键词或选择目标策略进一步筛选）</td></tr>`
    : '';

  tbody.innerHTML = (rowsHtml + overflowRow) || '<tr><td colspan="4" class="empty-cell">暂无匹配的规则条目</td></tr>';
}

export async function loadMihomoRules(appState) {
  const providersBox = $('mhRuleProvidersBox');
  const tbody = $('mhRulesBody');
  try {
    const res = await invokeCmd('get_mihomo_rules');
    appState.mhRulesData = res;

    const rules = Array.isArray(res.rules) ? res.rules : [];
    const targetSel = $('mhRulesTargetFilter');
    if (targetSel) {
      const prevVal = targetSel.value;
      const targets = [...new Set(rules.map((r) => r.proxy).filter(Boolean))].sort((a, b) => a.localeCompare(b));
      targetSel.innerHTML = `<option value="">全部策略目标</option>${targets.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}`;
      targetSel.value = targets.includes(prevVal) ? prevVal : '';
    }

    if (providersBox) {
      const providers = Array.isArray(res.providers) ? res.providers : [];
      providersBox.innerHTML = providers.length
        ? providers.map((p) => `<span class="pill gray" title="${esc(p.behavior || '')}${p.format ? ` · ${esc(p.format)}` : ''}">${esc(p.name)} · ${Number(p.ruleCount || 0)} 条</span>`).join('')
        : '<span class="sub-note">当前未加载外部规则集 (rule-providers)</span>';
    }

    renderMihomoRules(appState);
  } catch (err) {
    showToast(err.message, true);
    if (tbody && !appState.mhRulesData) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty-cell text-danger">规则加载失败：${esc(err.message)}</td></tr>`;
    }
  }
}

export async function loadMihomo(appState) {
  try {
    const d = await invokeCmd('get_mihomo_status');
    appState.mhData = d;

    if (!d.connected) {
      if ($('navMhBadge')) $('navMhBadge').textContent = '未接';
      $('mhModeSeg')?.classList.add('hidden');
      $('mhOffBox')?.classList.remove('hidden');
      $('mhOnBox')?.classList.add('hidden');
      if ($('mhErrText')) $('mhErrText').textContent = `${d.error}（当前检测地址：${d.apiUrl}）`;
      if ($('quickMhUrl')) $('quickMhUrl').value = d.apiUrl || DEFAULT_MIHOMO_URL;
      if ($('chLocal')) $('chLocal').textContent = 'Mihomo（未连接控制口）';
      if ($('chPrimary')) $('chPrimary').textContent = '连接本机 Clash API 后显示';
      if ($('chSecondary')) $('chSecondary').textContent = '--';
      if ($('chFallback')) $('chFallback').textContent = '--';
      return;
    }

    const modeZh = MIHOMO_MODE_LABELS[d.mode] || d.mode;
    if ($('navMhBadge')) $('navMhBadge').textContent = `${modeZh}·${d.totalConnections}`;
    $('mhModeSeg')?.classList.remove('hidden');
    document.querySelectorAll('#mhModeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.mode === d.mode));
    $('mhOffBox')?.classList.add('hidden');
    $('mhOnBox')?.classList.remove('hidden');

    const isChained = Boolean(d.chainSummary?.chainDetected);
    if ($('chLocal')) $('chLocal').textContent = `Mihomo · ${modeZh}模式${isChained ? ' (链式)' : ''}`;
    if ($('chPrimaryLbl')) $('chPrimaryLbl').textContent = `② ${isChained ? '前置 · ' : ''}${d.chainSummary?.primaryName || '主力策略组'}`;
    if ($('chPrimary')) $('chPrimary').textContent = d.chainSummary?.primaryNow || '--';
    if ($('chSecondaryLbl')) $('chSecondaryLbl').textContent = `③ ${isChained ? '落地 · ' : ''}${d.chainSummary?.secondaryName || '次级策略组'}`;
    if ($('chSecondary')) $('chSecondary').textContent = d.chainSummary?.secondaryNow || '--';
    if ($('chFallbackLbl')) $('chFallbackLbl').textContent = `④ ${d.chainSummary?.fallbackName || '兜底分流状态'}`;
    if ($('chFallback')) $('chFallback').textContent = d.chainSummary?.fallback || '--';

    if ($('mhConnNum')) $('mhConnNum').textContent = d.totalConnections;
    if ($('mhModeNote')) $('mhModeNote').textContent = `内核 ${d.version} · 混合端口 :${d.mixedPort}`;
    if ($('mhUpNum')) $('mhUpNum').textContent = fmtBytes(d.uploadTotal);
    if ($('mhDownNum')) $('mhDownNum').textContent = fmtBytes(d.downloadTotal);
    if ($('mhMemNum')) $('mhMemNum').textContent = fmtBytes(d.memoryBytes);
    if ($('mhTunNote')) $('mhTunNote').textContent = `虚拟网卡 TUN：${d.tunEnabled ? '已开启' : '未开启'}`;

    // 若用户正在策略组搜索框输入，避免重绘打断焦点
    const activeEl = document.activeElement;
    if (!activeEl || !activeEl.matches?.('[data-mh-group-search]')) {
      renderMihomoGroups(appState);
    }
    if (!connPaused) {
      renderMihomoConnections(appState);
    }
  } catch (err) {
    showToast(err.message, true);
  }
}

export function initMihomoEvents(appState, { reloadConfigUI }) {
  loadDiyPrefs();
  applyDiyPrefsToUI();
  updateConnPauseBtn();

  $('runProbeBtn')?.addEventListener('click', (ev) => withButtonLoading(ev.currentTarget, runConnectivityProbe));

  $('quickMhSaveBtn')?.addEventListener('click', (ev) => withButtonLoading(ev.currentTarget, async () => {
    const mihomoApiUrl = ($('quickMhUrl')?.value || '').trim() || DEFAULT_MIHOMO_URL;
    const mihomoSecret = ($('quickMhSecret')?.value || '').trim();
    try {
      await invokeCmd('save_config_cmd', { input: { mihomoApiUrl, mihomoSecret } });
      showToast('已保存控制密钥，正在连接本机代理内核...');
      await reloadConfigUI();
      await loadMihomo(appState);
    } catch (err) {
      showToast(err.message, true);
    }
  }));

  document.querySelectorAll('#mhViewSeg button').forEach((btn) => btn.addEventListener('click', () => {
    document.querySelectorAll('#mhViewSeg button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const view = btn.dataset.v;
    $('mhAppleWrap')?.classList.toggle('hidden', view !== 'apple');
    $('mhRulesWrap')?.classList.toggle('hidden', view !== 'rules');
    $('mhWebEmbed')?.classList.toggle('hidden', view !== 'zash');

    if (view === 'rules') {
      loadMihomoRules(appState);
    } else if (view === 'zash') {
      const base = (appState.localConfig?.mihomoApiUrl || DEFAULT_MIHOMO_URL).replace(/\/+$/, '');
      const frame = $('webUiFrame');
      if (frame && (frame.src === 'about:blank' || !frame.src.startsWith(base))) {
        frame.src = `${base}/ui/#/proxies`;
      }
    }
  }));

  $('openWebUiBtn')?.addEventListener('click', () => {
    const base = (appState.localConfig?.mihomoApiUrl || DEFAULT_MIHOMO_URL).replace(/\/+$/, '');
    openExternal(`${base}/ui/#/proxies`);
  });

  document.querySelectorAll('#mhModeSeg button').forEach((btn) => btn.addEventListener('click', async () => {
    try {
      await invokeCmd('set_mihomo_mode', { mode: btn.dataset.mode });
      showToast(`已切换本机出站模式为：${btn.textContent}`);
      await loadMihomo(appState);
    } catch (err) {
      showToast(err.message, true);
    }
  }));

  document.querySelectorAll('#mhFilterSeg button').forEach((btn) => btn.addEventListener('click', () => {
    document.querySelectorAll('#mhFilterSeg button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    appState.mhFilter = btn.dataset.bf;
    renderMihomoConnections(appState);
  }));

  $('showAllGroups')?.addEventListener('change', () => renderMihomoGroups(appState));

  $('mhNodeSort')?.addEventListener('change', (ev) => {
    diyPrefs.sort = VALID_SORTS.has(ev.target.value) ? ev.target.value : 'default';
    saveDiyPrefs();
    renderMihomoGroups(appState);
  });

  $('mhCardDensity')?.addEventListener('change', (ev) => {
    diyPrefs.density = VALID_DENSITIES.has(ev.target.value) ? ev.target.value : 'normal';
    saveDiyPrefs();
    renderMihomoGroups(appState);
  });

  $('mhHideUnavailable')?.addEventListener('change', (ev) => {
    diyPrefs.hideUnavailable = Boolean(ev.target.checked);
    saveDiyPrefs();
    renderMihomoGroups(appState);
  });

  $('mhTestUrlInput')?.addEventListener('change', (ev) => {
    const val = ev.target.value.trim() || DEFAULT_DELAY_TEST_URL;
    ev.target.value = val;
    diyPrefs.testUrl = val;
    saveDiyPrefs();
  });

  $('mhTestTimeoutSelect')?.addEventListener('change', (ev) => {
    const val = Number(ev.target.value);
    diyPrefs.timeoutMs = VALID_TIMEOUTS.has(val) ? val : 5000;
    saveDiyPrefs();
  });

  $('mhConnSearch')?.addEventListener('input', () => renderMihomoConnections(appState));

  $('mhConnSort')?.addEventListener('change', (ev) => {
    diyPrefs.connSort = VALID_CONN_SORTS.has(ev.target.value) ? ev.target.value : 'traffic';
    saveDiyPrefs();
    renderMihomoConnections(appState);
  });

  $('mhConnPauseBtn')?.addEventListener('click', () => {
    connPaused = !connPaused;
    updateConnPauseBtn();
    if (!connPaused) {
      renderMihomoConnections(appState);
    }
  });

  $('mhConnColsBar')?.addEventListener('change', (ev) => {
    const cb = ev.target.closest('input[data-conn-col]');
    if (!cb) return;
    const col = cb.dataset.connCol;
    if (!VALID_CONN_COLS.has(col)) return;
    const next = new Set(diyPrefs.hiddenCols);
    if (cb.checked) next.delete(col);
    else next.add(col);
    diyPrefs.hiddenCols = [...next];
    saveDiyPrefs();
    applyConnColumnVisibility();
    if (!appState.mhData?.connections?.length) return;
    const emptyCell = $('mhConnBody')?.querySelector('td.empty-cell');
    if (emptyCell) emptyCell.colSpan = Math.max(1, 6 - diyPrefs.hiddenCols.length);
  });

  $('mhRulesRefreshBtn')?.addEventListener('click', (ev) => withButtonLoading(ev.currentTarget, () => loadMihomoRules(appState)));
  $('mhRulesSearch')?.addEventListener('input', () => renderMihomoRules(appState));
  $('mhRulesTargetFilter')?.addEventListener('change', () => renderMihomoRules(appState));

  $('mhCloseAllBtn')?.addEventListener('click', async (ev) => {
    const ok = await confirmDialog({
      title: '清理全部本机连接',
      message: '确认断开本机代理内核中所有当前活跃连接？正在传输的页面将自动重连。',
      confirmText: '确认清理',
      danger: true,
    });
    if (!ok) return;
    await withButtonLoading(ev.currentTarget, async () => {
      try {
        await invokeCmd('close_mihomo_conn', { id: '__ALL__' });
        showToast('已清理本机全部连接');
        await loadMihomo(appState);
      } catch (err) {
        showToast(err.message, true);
      }
    });
  });

  $('mhGroupsGrid')?.addEventListener('input', (ev) => {
    const inp = ev.target.closest('[data-mh-group-search]');
    if (!inp) return;
    const gname = inp.dataset.mhGroupSearch;
    const pos = inp.selectionStart;
    groupSearchTerms.set(gname, inp.value);
    renderMihomoGroups(appState);
    const restored = $('mhGroupsGrid')?.querySelector(`[data-mh-group-search="${CSS.escape(gname)}"]`);
    if (restored) {
      restored.focus();
      if (typeof pos === 'number') restored.setSelectionRange(pos, pos);
    }
  });

  $('mhGroupsGrid')?.addEventListener('contextmenu', async (ev) => {
    const pill = ev.target.closest('.node-pill[data-node-name]');
    if (!pill) return;
    ev.preventDefault();
    const nodeName = pill.dataset.nodeName;
    if (!nodeName) return;
    await withButtonLoading(pill, async () => {
      try {
        const r = await invokeCmd('test_mihomo_delay', { name: nodeName, ...getDelayTestParams() });
        showToast(r.delay ? `「${nodeName}」延迟：${r.delay} ms` : `「${nodeName}」测速完成`);
        await loadMihomo(appState);
      } catch (err) {
        showToast(`测速失败：${err.message}`, true);
      }
    });
  });

  $('mhGroupsGrid')?.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-action]');
    if (!btn) return;
    const act = btn.dataset.action;

    if (act === 'mh-toggle-expand') {
      const gname = btn.dataset.group;
      if (expandedGroups.has(gname)) expandedGroups.delete(gname);
      else expandedGroups.add(gname);
      renderMihomoGroups(appState);
      return;
    }

    if (act === 'mh-select') {
      const { group, node } = btn.dataset;
      await withButtonLoading(btn, async () => {
        try {
          await invokeCmd('select_mihomo_node', { group, name: node });
          showToast(`已将「${group}」切换至「${node}」`);
          await loadMihomo(appState);
        } catch (err) {
          showToast(err.message, true);
        }
      });
      return;
    }

    if (act === 'mh-delay') {
      const { node } = btn.dataset;
      await withButtonLoading(btn, async () => {
        try {
          const r = await invokeCmd('test_mihomo_delay', { name: node, ...getDelayTestParams() });
          showToast(r.delay ? `「${node}」延迟：${r.delay} ms` : `「${node}」测速完成`);
          await loadMihomo(appState);
        } catch (err) {
          showToast(`测速失败：${err.message}`, true);
        }
      });
      return;
    }

    if (act === 'mh-group-delay') {
      const { group } = btn.dataset;
      await withButtonLoading(btn, async () => {
        try {
          const r = await invokeCmd('test_mihomo_group_delay', { group, ...getDelayTestParams() });
          showToast(`「${group}」整组测速完成（有效响应 ${r.testedCount || 0} 个节点）`);
          await loadMihomo(appState);
        } catch (err) {
          showToast(`整组测速失败：${err.message}`, true);
        }
      });
    }
  });

  $('mhConnBody')?.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-action="mh-close"]');
    if (!btn) return;
    await withButtonLoading(btn, async () => {
      try {
        await invokeCmd('close_mihomo_conn', { id: btn.dataset.id });
        showToast('已掐断该本机连接');
        await loadMihomo(appState);
      } catch (err) {
        showToast(err.message, true);
      }
    });
  });

  $('mhConnBody')?.addEventListener('contextmenu', async (ev) => {
    const td = ev.target.closest('td[data-copy]');
    if (!td) return;
    const text = (td.dataset.copy || '').trim();
    if (!text) return;
    ev.preventDefault();
    try {
      await copyToClipboard(text);
      showToast(`已复制：${text}`);
    } catch (err) {
      showToast(err.message, true);
    }
  });
}
