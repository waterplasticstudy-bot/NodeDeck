/**
 * 本机 Mihomo / Clash API 整合页（全链路视图、AI 并发测速、策略组切换、连接排查、内嵌原版 Web 面板）
 */

import { confirmDialog } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import {
  AI_DOMAIN_REGEX,
  DEFAULT_MIHOMO_URL,
  HEALTH_THRESHOLDS,
  MIHOMO_MODE_LABELS,
} from '../constants/ui-constants.js';
import { invokeCmd, openExternal, withButtonLoading } from '../utils/bridge.js';
import { annotateHost, esc, fmtBytes } from '../utils/format.js';

const $ = (id) => document.getElementById(id);

export async function runConnectivityProbe() {
  const box = $('probeList');
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
  if (!d || !d.connected) return;
  const showAll = $('showAllGroups').checked;
  const groups = showAll ? d.groups : d.groups.slice(0, 6);

  $('mhGroupsGrid').innerHTML = groups.map((g) => {
    const canSwitch = g.type === 'Selector';
    return `
      <div class="sub-panel">
        <div class="flex-between">
          <div>
            <strong class="text-strong">${esc(g.name)}</strong>
            <span class="pill gray ml-sm">${esc(g.type)}</span>
          </div>
          <div class="toolbar">
            <span class="pill blue pill-truncate">${esc(g.now || '--')}</span>
            <button class="btn sm" data-action="mh-delay" data-node="${esc(g.now || g.name)}">测速</button>
          </div>
        </div>
        <div class="node-grid">
          ${g.nodes.slice(0, 24).map((n) => `
            <button class="node-pill ${n.name === g.now ? 'selected' : ''}"
              ${canSwitch ? `data-action="mh-select" data-group="${esc(g.name)}" data-node="${esc(n.name)}"` : 'disabled'}
              title="${esc(n.name)} (${esc(n.type)})">
              <span>${esc(n.name)}</span>
              ${n.delay ? `<span class="nd num">${n.delay}ms</span>` : ''}
            </button>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');
}

export function renderMihomoConnections(appState) {
  const d = appState.mhData;
  if (!d || !d.connected) return;
  const kw = $('mhConnSearch').value.trim().toLowerCase();
  const bf = appState.mhFilter;

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

  $('mhTableCount').textContent = `${list.length} 条`;
  $('mhConnBody').innerHTML = list.map((c) => {
    const chainPath = [...c.chains].reverse().join(' → ');
    const isDirect = c.chains.includes('DIRECT');
    const tag = annotateHost(c.host, c.port);
    return `
      <tr>
        <td><strong>${esc(c.process || '系统')}</strong></td>
        <td class="mono">${esc(c.host)}:${esc(c.port)} ${tag ? `<span class="pill ${tag.cls} ml-xs">${tag.label}</span>` : ''}</td>
        <td class="mono">${esc(c.rule)}${c.rulePayload ? ` (${esc(c.rulePayload)})` : ''}</td>
        <td><span class="pill ${isDirect ? 'gray' : 'green'}">${esc(chainPath || '--')}</span></td>
        <td class="mono num">↑${fmtBytes(c.upload)} / ↓${fmtBytes(c.download)}</td>
        <td><button class="btn sm danger" data-action="mh-close" data-id="${esc(c.id)}">掐断</button></td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="6" class="empty-cell">当前无匹配的本机连接</td></tr>';
}

export async function loadMihomo(appState) {
  try {
    const d = await invokeCmd('get_mihomo_status');
    appState.mhData = d;

    if (!d.connected) {
      $('navMhBadge').textContent = '未接';
      $('mhModeSeg').classList.add('hidden');
      $('mhOffBox').classList.remove('hidden');
      $('mhOnBox').classList.add('hidden');
      $('mhErrText').textContent = `${d.error}（当前检测地址：${d.apiUrl}）`;
      $('quickMhUrl').value = d.apiUrl || DEFAULT_MIHOMO_URL;
      $('chLocal').textContent = 'Mihomo（未连接控制口）';
      $('chPrimary').textContent = '连接本机 Clash API 后显示';
      $('chSecondary').textContent = '--';
      $('chFallback').textContent = '--';
      return;
    }

    const modeZh = MIHOMO_MODE_LABELS[d.mode] || d.mode;
    $('navMhBadge').textContent = `${modeZh}·${d.totalConnections}`;
    $('mhModeSeg').classList.remove('hidden');
    document.querySelectorAll('#mhModeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.mode === d.mode));
    $('mhOffBox').classList.add('hidden');
    $('mhOnBox').classList.remove('hidden');

    $('chLocal').textContent = `Mihomo · ${modeZh}模式`;
    $('chPrimaryLbl').textContent = `② ${d.chainSummary?.primaryName || '主力策略组'}`;
    $('chPrimary').textContent = d.chainSummary?.primaryNow || '--';
    $('chSecondaryLbl').textContent = `③ ${d.chainSummary?.secondaryName || '次级策略组'}`;
    $('chSecondary').textContent = d.chainSummary?.secondaryNow || '--';
    $('chFallback').textContent = d.chainSummary?.fallback || '--';

    $('mhConnNum').textContent = d.totalConnections;
    $('mhModeNote').textContent = `内核 ${d.version} · 混合端口 :${d.mixedPort}`;
    $('mhUpNum').textContent = fmtBytes(d.uploadTotal);
    $('mhDownNum').textContent = fmtBytes(d.downloadTotal);
    $('mhMemNum').textContent = fmtBytes(d.memoryBytes);
    $('mhTunNote').textContent = `虚拟网卡 TUN：${d.tunEnabled ? '已开启' : '未开启'}`;

    renderMihomoGroups(appState);
    renderMihomoConnections(appState);
  } catch (err) {
    showToast(err.message, true);
  }
}

export function initMihomoEvents(appState, { reloadConfigUI }) {
  $('runProbeBtn').addEventListener('click', (ev) => withButtonLoading(ev.currentTarget, runConnectivityProbe));

  $('quickMhSaveBtn').addEventListener('click', (ev) => withButtonLoading(ev.currentTarget, async () => {
    const mihomoApiUrl = $('quickMhUrl').value.trim() || DEFAULT_MIHOMO_URL;
    const mihomoSecret = $('quickMhSecret').value.trim();
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
    const isWeb = btn.dataset.v === 'zash';
    $('mhAppleWrap').classList.toggle('hidden', isWeb);
    $('mhWebEmbed').classList.toggle('hidden', !isWeb);
    if (isWeb) {
      const base = (appState.localConfig?.mihomoApiUrl || DEFAULT_MIHOMO_URL).replace(/\/+$/, '');
      const frame = $('webUiFrame');
      if (frame.src === 'about:blank' || !frame.src.startsWith(base)) {
        frame.src = `${base}/ui/#/proxies`;
      }
    }
  }));

  $('openWebUiBtn').addEventListener('click', () => {
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

  $('showAllGroups').addEventListener('change', () => renderMihomoGroups(appState));
  $('mhConnSearch').addEventListener('input', () => renderMihomoConnections(appState));

  $('mhCloseAllBtn').addEventListener('click', async (ev) => {
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

  $('mhGroupsGrid').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'mh-select') {
      const { group, node } = btn.dataset;
      try {
        await invokeCmd('select_mihomo_node', { group, name: node });
        showToast(`已将「${group}」切换至「${node}」`);
        await loadMihomo(appState);
      } catch (err) {
        showToast(err.message, true);
      }
    } else if (btn.dataset.action === 'mh-delay') {
      const { node } = btn.dataset;
      await withButtonLoading(btn, async () => {
        try {
          const r = await invokeCmd('test_mihomo_delay', { name: node });
          showToast(r.delay ? `「${node}」延迟：${r.delay} ms` : `「${node}」测速完成`);
          await loadMihomo(appState);
        } catch (err) {
          showToast(`测速失败：${err.message}`, true);
        }
      });
    }
  });

  $('mhConnBody').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-action="mh-close"]');
    if (!btn) return;
    try {
      await invokeCmd('close_mihomo_conn', { id: btn.dataset.id });
      showToast('已掐断该本机连接');
      await loadMihomo(appState);
    } catch (err) {
      showToast(err.message, true);
    }
  });
}
