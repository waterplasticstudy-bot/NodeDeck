/**
 * sing-box 运维工具箱与实时日志页（支持主 VPS 与 Alpine NAT 自适应隔离 + 日志语义高亮 + 一键导出）
 */

import { showToast } from '../components/toast.js';
import {
  DEFAULT_NAT_PORTAL_URL,
  MAIN_VPS_NODE_ID,
  POST_MUTATION_REFRESH_MS,
} from '../constants/ui-constants.js';
import { copyToClipboard, invokeCmd, withButtonLoading } from '../utils/bridge.js';
import { countryFlag, esc } from '../utils/format.js';
import { getActiveNatNode } from './nat-overview.js';
import { openIpCheckSheet } from './overview.js';

const $ = (id) => document.getElementById(id);

function classifyLogLine(line) {
  if (/\b(ERROR|FATAL|PANIC)\b|失败|异常/i.test(line)) return 'log-err';
  if (/\bWARN(ING)?\b|超时|timeout/i.test(line)) return 'log-warn';
  if (/\bINFO\b/i.test(line)) return 'log-info';
  return '';
}

export function renderLogs(appState) {
  const kw = $('logFilter').value.trim().toLowerCase();
  const term = $('logsTerminal');
  const rawLines = String(appState.rawLogs || '').split('\n');
  const filtered = kw
    ? rawLines.filter((line) => line.toLowerCase().includes(kw))
    : rawLines;

  if (!filtered.length || (filtered.length === 1 && !filtered[0])) {
    term.textContent = kw ? '(无匹配日志)' : '(暂无日志)';
    return;
  }

  term.innerHTML = filtered.map((line) => {
    const cls = classifyLogLine(line);
    return cls ? `<span class="${cls}">${esc(line)}</span>` : esc(line);
  }).join('\n');

  if ($('logAutoScroll')?.checked) {
    term.scrollTop = term.scrollHeight;
  }
}

async function openNatWebTerminal(node) {
  if (!node.portalUrl) throw new Error('请先在节点编辑中填写官方控制台 URL');
  await invokeCmd('open_account_window', {
    profileId: node.providerProfileId || 'nat_main',
    title: `${node.name} · NAT 控制台`,
    url: node.portalUrl || DEFAULT_NAT_PORTAL_URL,
  });
}

export async function loadLogs(appState) {
  const isVps = !appState || appState.activeNodeId === MAIN_VPS_NODE_ID;
  const lines = Number($('logLines').value) || 150;

  if (isVps) {
    $('logsNatUnconfigured').classList.add('hidden');
    $('logsContentWrap').classList.remove('hidden');
    $('svcReloadBtn').classList.remove('hidden');
    $('logsIpCheckBtn').classList.remove('hidden');
    $('logsNatTerminalBtn').classList.add('hidden');
    $('logsScopeTitle').textContent = `sing-box 运维工具箱（主 VPS · ${appState.localConfig?.name || 'Primary VPS'}）`;
    $('logsScopeSub').textContent = '常用诊断命令全部按钮化，无需手动敲 SSH 指令';
    $('logsStreamTitle').textContent = 'sing-box 运行日志（主 VPS）';

    try {
      const { logs } = await invokeCmd('get_logs', { lines });
      appState.rawLogs = logs || '(暂无日志)';
      renderLogs(appState);
    } catch (err) {
      $('logsTerminal').textContent = `加载失败：${err.message}`;
    }
    return;
  }

  const node = getActiveNatNode(appState);
  if (!node) return;
  const flag = countryFlag(node.region);

  if (!node.sshPort || !node.publicIp) {
    $('logsContentWrap').classList.add('hidden');
    $('logsNatUnconfigured').classList.remove('hidden');
    $('logsNatUnconfigured').innerHTML = `
      <div class="card empty-state-box">
        <div class="empty-state-icon">📜</div>
        <h3 class="card-title-lg mb-sm">${flag} ${esc(node.name)} · NAT 日志与运维</h3>
        <p class="sub-note empty-state-desc">
          当前节点尚未配置公网 SSH 映射端口，已自动隔离主 VPS 工具箱以防止误重启。你可以直接打开独立沙箱中的官方 Web 终端，或在节点编辑中补充 SSH 端口启用面板内日志与重启。
        </p>
        <div class="toolbar toolbar-center">
          <button class="btn primary" data-action="logs-nat-web">🖥️ 打开官方 Web 终端</button>
          <button class="btn" data-action="logs-nat-edit">⚙️ 配置 SSH 映射端口</button>
        </div>
      </div>
    `;
    return;
  }

  $('logsNatUnconfigured').classList.add('hidden');
  $('logsContentWrap').classList.remove('hidden');
  $('svcReloadBtn').classList.add('hidden');
  $('logsIpCheckBtn').classList.add('hidden');
  $('logsNatTerminalBtn').classList.remove('hidden');
  $('logsScopeTitle').textContent = `${flag} ${node.name} · Alpine 运维工具箱`;
  $('logsScopeSub').textContent = `当前已锁定操作 ${node.publicIp}:${node.sshPort}（已隔离主 VPS，绝不误触）`;
  $('logsStreamTitle').textContent = `${flag} ${node.name} · sing-box 运行日志 (/var/log/sing-box.log)`;
  $('logsTerminal').textContent = '正在经 Alpine SSH 读取最新日志...';

  try {
    const { logs } = await invokeCmd('get_nat_alpine_logs', { nodeId: node.id, lines });
    appState.rawLogs = logs || '(暂无日志)';
    renderLogs(appState);
  } catch (err) {
    $('logsTerminal').textContent = `读取 Alpine NAT 日志失败：${err.message}`;
  }
}

export function initLogsEvents(appState, { reloadOverview, openNatEditor, openTerminalShell }) {
  $('logFilter').addEventListener('input', () => renderLogs(appState));
  $('logLines').addEventListener('change', () => loadLogs(appState));
  $('logAutoScroll').addEventListener('change', () => renderLogs(appState));
  $('refreshLogsBtn').addEventListener('click', (ev) => withButtonLoading(ev.currentTarget, () => loadLogs(appState)));
  $('logsOpenPtyBtn')?.addEventListener('click', () => openTerminalShell());
  $('logsIpCheckBtn').addEventListener('click', openIpCheckSheet);

  $('logsNatTerminalBtn').addEventListener('click', (ev) => withButtonLoading(ev.currentTarget, async () => {
    const node = getActiveNatNode(appState);
    if (!node) return;
    try {
      await openNatWebTerminal(node);
    } catch (err) {
      showToast(err.message, true);
    }
  }));

  $('logsNatUnconfigured').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-action]');
    if (!btn) return;
    const node = getActiveNatNode(appState);
    if (!node) return;
    if (btn.dataset.action === 'logs-nat-web') {
      await withButtonLoading(btn, async () => {
        try {
          await openNatWebTerminal(node);
        } catch (err) {
          showToast(err.message, true);
        }
      });
    } else if (btn.dataset.action === 'logs-nat-edit') {
      openNatEditor(node.id);
    }
  });

  $('copyLogsBtn').addEventListener('click', async () => {
    try {
      await copyToClipboard($('logsTerminal').textContent);
      showToast('日志已复制到剪贴板');
    } catch (err) {
      showToast(err.message, true);
    }
  });

  $('exportLogsBtn').addEventListener('click', (ev) => withButtonLoading(ev.currentTarget, async () => {
    const content = $('logsTerminal').textContent || '';
    if (!content.trim()) return showToast('当前日志为空', true);
    const scope = appState.activeNodeId === MAIN_VPS_NODE_ID ? 'vps' : appState.activeNodeId;
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `nodedeck-logs-${scope}-${ts}.txt`;
    try {
      const res = await invokeCmd('save_export_file', { filename, content });
      showToast(`日志已导出：${res.filePath || res.fileName}`);
    } catch (err) {
      showToast(err.message, true);
    }
  }));

  document.querySelectorAll('[data-svc]').forEach((btn) => btn.addEventListener('click', () => {
    const action = btn.dataset.svc;
    withButtonLoading(btn, async () => {
      const outEl = $('svcOutput');
      outEl.classList.remove('hidden');
      outEl.textContent = '执行中...';
      try {
        const isVps = appState.activeNodeId === MAIN_VPS_NODE_ID;
        let res;
        if (isVps) {
          res = await invokeCmd('run_service_action', { action });
        } else {
          const node = getActiveNatNode(appState);
          if (!node) return;
          res = await invokeCmd('run_nat_alpine_action', { nodeId: node.id, action });
        }
        outEl.textContent = res.output || '执行完成';
        showToast('执行完成');
        if (action === 'restart' || action === 'reload') {
          setTimeout(reloadOverview, POST_MUTATION_REFRESH_MS);
        }
      } catch (err) {
        outEl.textContent = `执行失败：${err.message}`;
        showToast(err.message, true);
      }
    });
  }));
}
