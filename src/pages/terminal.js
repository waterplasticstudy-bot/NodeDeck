/**
 * 跨平台内置交互式 SSH 终端（xterm.js + ConPTY/PTY）与右侧可折叠快捷命令面板
 * 支持多标签、字体缩放、沉浸全屏、自动适配窗口尺寸、一键拉起 sing-box 管理脚本 (sb)
 */

import { closeModal, confirmDialog, openModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { MAIN_VPS_NODE_ID } from '../constants/ui-constants.js';
import {
  copyToClipboard,
  invokeCmd,
  isDemoMode,
  onPtyData,
  onPtyExit,
  withButtonLoading,
} from '../utils/bridge.js';
import { countryFlag, esc } from '../utils/format.js';
import { getActiveNatNode } from './nat-overview.js';

const $ = (id) => document.getElementById(id);

const TERM_FONT_KEY = 'nodedeck_term_font_size';
const TERM_DRAWER_KEY = 'nodedeck_term_drawer_collapsed';

const DEFAULT_SNIPPETS = [
  { id: 'builtin_sb', title: 'sing-box 脚本面板 (sb)', command: 'sb', scope: 'all' },
  { id: 'builtin_mem', title: '内存与系统负载', command: 'free -m && uptime', scope: 'all' },
  { id: 'builtin_ports', title: '查看监听端口', command: 'ss -tulnp 2>/dev/null || netstat -tulnp', scope: 'all' },
  { id: 'builtin_status', title: 'sing-box 服务状态', command: 'systemctl status sing-box --no-pager 2>/dev/null || rc-service sing-box status', scope: 'all' },
  { id: 'builtin_ledger', title: '查看成员流量账本', command: 'cat /var/lib/nodedeck/ledger.json 2>/dev/null || echo "尚未安装流量账本"', scope: 'all' },
];

const TERM_THEME = {
  background: '#0d0f13',
  foreground: '#e6edf3',
  cursor: '#2dd4bf',
  cursorAccent: '#0d0f13',
  selectionBackground: 'rgba(45, 212, 191, 0.28)',
  black: '#1c2128',
  red: '#ff6b6b',
  green: '#3fb950',
  yellow: '#e3b341',
  blue: '#58a6ff',
  magenta: '#bc8cff',
  cyan: '#39d0d8',
  white: '#d0d7de',
  brightBlack: '#6e7681',
  brightRed: '#ffa198',
  brightGreen: '#56d364',
  brightYellow: '#f2cc60',
  brightBlue: '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#56d4dd',
  brightWhite: '#f0f6fc',
};

/** @type {Array<{id:string, label:string, nodeId:string, nodeName:string, host:string, port:number, sessionId:string|null, status:'connecting'|'connected'|'closed', term:any, fitAddon:any, hostEl:HTMLElement, decoder:TextDecoder, pendingCmd:string|null, demoMode:boolean, demoBuf:string}>} */
const tabs = [];
let activeTabId = null;
let tabSeq = 1;
let fontSize = Number(localStorage.getItem(TERM_FONT_KEY)) || 14;
let drawerCollapsed = localStorage.getItem(TERM_DRAWER_KEY) === '1';
let selectedSnippetId = null;
let editingSnippetId = null;
let isMaximized = false;
let ptyEventsBound = false;

function base64ToUint8Array(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

function getActiveNodeMeta(appState) {
  if (appState.activeNodeId === MAIN_VPS_NODE_ID) {
    const cfg = appState.localConfig || {};
    return {
      nodeId: MAIN_VPS_NODE_ID,
      nodeName: cfg.name || '主 VPS',
      flag: countryFlag(cfg.region || 'US'),
      host: cfg.host || '',
      port: Number(cfg.sshPort) || 22,
      ready: Boolean(cfg.host && String(cfg.host).trim()),
      isNat: false,
    };
  }
  const nat = getActiveNatNode(appState);
  if (!nat) {
    return { nodeId: appState.activeNodeId, nodeName: '节点', flag: '🖥️', host: '', port: 0, ready: false, isNat: true };
  }
  return {
    nodeId: nat.id,
    nodeName: nat.name,
    flag: countryFlag(nat.region),
    host: nat.publicIp || '',
    port: Number(nat.sshPort) || 0,
    ready: Boolean(nat.publicIp && Number(nat.sshPort) > 0),
    isNat: true,
    nat,
  };
}

function getSnippets(appState) {
  const saved = appState.localConfig?.terminalSnippets;
  if (Array.isArray(saved) && saved.length > 0) return saved;
  return DEFAULT_SNIPPETS;
}

function updateNavTermBadge() {
  const badge = $('navTermBadge');
  if (!badge) return;
  const alive = tabs.filter((t) => t.status === 'connected').length;
  badge.textContent = alive > 0 ? String(alive) : 'SSH';
  badge.className = `nav-badge num${alive > 0 ? '' : ''}`;
}

function getActiveTab() {
  return tabs.find((t) => t.id === activeTabId) || null;
}

function renderStatusHeader() {
  const tab = getActiveTab();
  const pill = $('termConnPill');
  const hostLbl = $('termHostBadge');
  if (!pill || !hostLbl) return;

  if (!tab) {
    pill.textContent = '未连接';
    pill.className = 'term-status-pill closed';
    hostLbl.textContent = 'Shell';
    return;
  }

  hostLbl.textContent = tab.host ? `${tab.nodeName} · ${tab.host}:${tab.port}` : tab.nodeName;
  if (tab.status === 'connected') {
    pill.textContent = '已连接';
    pill.className = 'term-status-pill connected';
  } else if (tab.status === 'connecting') {
    pill.textContent = '连接中...';
    pill.className = 'term-status-pill connecting';
  } else {
    pill.textContent = '已断开';
    pill.className = 'term-status-pill closed';
  }
}

function renderTabStrip() {
  const strip = $('termTabList');
  if (!strip) return;
  strip.innerHTML = tabs.map((t) => {
    const active = t.id === activeTabId;
    const dotCls = t.status === 'connected' ? 'green' : t.status === 'connecting' ? 'orange' : 'red';
    return `
      <div class="term-tab ${active ? 'active' : ''}" data-term-tab="${esc(t.id)}" title="${esc(t.nodeName)} (${esc(t.host || '--')})">
        <span class="dot ${dotCls}"></span>
        <span class="term-tab-title">${esc(t.label)}</span>
        <button class="term-tab-close" type="button" data-close-tab="${esc(t.id)}" title="关闭标签">×</button>
      </div>
    `;
  }).join('');
  updateNavTermBadge();
  renderStatusHeader();
}

function renderSnippets(appState) {
  const list = getSnippets(appState);
  const countEl = $('termSnippetsCount');
  const listEl = $('termSnippetsList');
  const selLbl = $('termSnippetSelectedLabel');
  const execBtn = $('termSnippetExecBtn');
  const delBtn = $('termSnippetDelBtn');
  if (!listEl) return;

  if (!selectedSnippetId || !list.some((s) => s.id === selectedSnippetId)) {
    selectedSnippetId = list[0]?.id || null;
  }

  if (countEl) countEl.textContent = `共 ${list.length} 条`;

  listEl.innerHTML = list.map((s) => {
    const active = s.id === selectedSnippetId;
    return `
      <div class="snippet-card ${active ? 'selected' : ''}" data-snippet-id="${esc(s.id)}">
        <div class="snippet-card-head">
          <span class="snippet-title-wrap">
            <span class="snippet-dot ${active ? 'active' : ''}"></span>
            <span class="snippet-title">${esc(s.title)}</span>
          </span>
          <button class="snippet-edit-btn" type="button" data-edit-snippet="${esc(s.id)}" title="编辑命令">📝</button>
        </div>
        <pre class="snippet-code mono">${esc(s.command)}</pre>
      </div>
    `;
  }).join('') || '<div class="sub-note empty-cell">暂无快捷命令，点右上角「+ 新建」添加常用指令</div>';

  const cur = list.find((s) => s.id === selectedSnippetId);
  if (selLbl) selLbl.textContent = cur ? `已选中: ${cur.title}` : '未选中快捷命令';
  if (execBtn) execBtn.disabled = !cur;
  if (delBtn) delBtn.disabled = !cur;
}

function renderDemoSbBanner(term, nodeName) {
  const cyan = '\x1b[36m';
  const green = '\x1b[32m';
  const yellow = '\x1b[33m';
  const gray = '\x1b[90m';
  const reset = '\x1b[0m';
  const lines = [
    '',
    `${cyan}╔════════════════════════════════════════════╗${reset}`,
    `${cyan}║        sing-box 管理脚本 (演示终端)        ║${reset}`,
    `${cyan}╚════════════════════════════════════════════╝${reset}`,
    '',
    `节点: ${green}${nodeName}${reset}  |  模式: systemd / openrc`,
    `Sing-box v1.14.4: ${green}● 运行中${reset}  |  流量账本: ${green}● 统计中${reset}`,
    '',
    `${yellow}【节点与成员管理】${reset}`,
    '  [1] 查看当前节点与成员      [2] 查看分享链接',
    '  [3] 新增成员 (自动校验)     [4] 删除成员',
    '',
    `${yellow}【服务控制与流量账本】${reset}`,
    '  [5] 重启 sing-box           [6] 平滑重载 sing-box',
    '  [7] 查看运行状态            [8] 查看实时日志',
    '  [11] 查看成员持久化流量账本 [12] 防火墙端口 (UFW)',
    '',
    `${gray}──────────────────────────────────────────────${reset}`,
    '  [0] 退出脚本',
    '',
    '请输入选项 [0-15] (演示模式输入 sb / 11 / free -m 体验): ',
  ];
  term.write(`${lines.join('\r\n')}`);
}

function handleDemoInput(tab, data) {
  if (data === '\r' || data === '\n') {
    tab.term.write('\r\n');
    const cmd = tab.demoBuf.trim();
    tab.demoBuf = '';
    if (cmd === 'sb') {
      renderDemoSbBanner(tab.term, tab.nodeName);
    } else if (cmd === '11') {
      tab.term.write('\x1b[36m[成员持久化流量账本 · 演示]\x1b[0m\r\n  Alice   今日 2.81 GB   本月 39.96 GB   总计 79.96 GB\r\n  Bob     今日 1.02 GB   本月 13.50 GB   总计 27.00 GB\r\nroot@demo:~# ');
    } else if (cmd === 'free -m' || cmd.startsWith('free')) {
      tab.term.write('               total        used        free      shared  buff/cache   available\r\nMem:            2048         412        1180          12         456        1512\r\nroot@demo:~# ');
    } else if (cmd === '0' || cmd === 'exit') {
      tab.term.write('已退出脚本。\r\nroot@demo:~# ');
    } else if (cmd === 'clear') {
      tab.term.clear();
      tab.term.write('root@demo:~# ');
    } else if (cmd) {
      tab.term.write(`\x1b[90m[演示模式] 已接收命令: ${cmd}\x1b[0m\r\nroot@demo:~# `);
    } else {
      tab.term.write('root@demo:~# ');
    }
    return;
  }
  if (data === '\x7f' || data === '\b') {
    if (tab.demoBuf.length > 0) {
      tab.demoBuf = tab.demoBuf.slice(0, -1);
      tab.term.write('\b \b');
    }
    return;
  }
  if (data === '\x03') {
    tab.demoBuf = '';
    tab.term.write('^C\r\nroot@demo:~# ');
    return;
  }
  tab.demoBuf += data;
  tab.term.write(data);
}

function sendToTab(tab, rawData) {
  if (!tab || tab.status !== 'connected') return;
  if (tab.demoMode) {
    for (const ch of rawData) handleDemoInput(tab, ch);
    return;
  }
  if (!tab.sessionId) return;
  invokeCmd('pty_write', { sessionId: tab.sessionId, data: rawData }).catch((err) => {
    showToast(`写入终端失败：${err.message}`, true);
  });
}

function syncTabVisibility() {
  const emptyEl = $('termEmptyState');
  const stageEl = $('termStage');
  if (!stageEl || !emptyEl) return;

  const hasTabs = tabs.length > 0;
  emptyEl.classList.toggle('hidden', hasTabs);
  for (const t of tabs) {
    t.hostEl.classList.toggle('active', t.id === activeTabId);
  }
}

export function fitActiveTerminal() {
  const tab = getActiveTab();
  if (!tab || !tab.fitAddon || !tab.term) return;
  const section = $('tab-terminal');
  if (!section || !section.classList.contains('active')) return;
  try {
    tab.fitAddon.fit();
    const { cols, rows } = tab.term;
    if (!tab.demoMode && tab.sessionId && tab.status === 'connected' && cols >= 20 && rows >= 5) {
      invokeCmd('pty_resize', { sessionId: tab.sessionId, cols, rows }).catch(() => {});
    }
  } catch {
    // 容器隐藏时忽略
  }
}

function activateTab(tabId) {
  if (!tabs.some((t) => t.id === tabId)) return;
  activeTabId = tabId;
  syncTabVisibility();
  renderTabStrip();
  requestAnimationFrame(() => {
    fitActiveTerminal();
    getActiveTab()?.term?.focus();
  });
}

async function closeTab(tabId) {
  const idx = tabs.findIndex((t) => t.id === tabId);
  if (idx < 0) return;
  const [tab] = tabs.splice(idx, 1);
  if (!tab.demoMode && tab.sessionId) {
    invokeCmd('pty_close', { sessionId: tab.sessionId }).catch(() => {});
  }
  try {
    tab.term?.dispose();
  } catch {
    // ignore
  }
  tab.hostEl?.remove();
  if (activeTabId === tabId) {
    activeTabId = tabs[Math.max(0, idx - 1)]?.id || null;
  }
  syncTabVisibility();
  renderTabStrip();
  if (activeTabId) {
    requestAnimationFrame(() => fitActiveTerminal());
  }
}

async function openNewTabForNode(appState, initialCmd = null) {
  const meta = getActiveNodeMeta(appState);
  if (!meta.ready && !isDemoMode()) {
    renderEmptyUnconfigured(meta);
    showToast(`「${meta.nodeName}」尚未配置公网 SSH 端口，无法开启内置终端`, true);
    return null;
  }

  const TerminalCtor = window.Terminal;
  const FitAddonCtor = window.FitAddon?.FitAddon;
  if (!TerminalCtor || !FitAddonCtor) {
    showToast('终端引擎未就绪，请重新加载应用', true);
    return null;
  }

  const stageEl = $('termStage');
  const hostEl = document.createElement('div');
  hostEl.className = 'term-pane';
  stageEl.appendChild(hostEl);

  const term = new TerminalCtor({
    fontSize,
    fontFamily: '"Cascadia Code", "JetBrains Mono", "SF Mono", Consolas, "Microsoft YaHei", monospace',
    lineHeight: 1.25,
    cursorBlink: true,
    cursorStyle: 'bar',
    scrollback: 5000,
    allowTransparency: false,
    theme: TERM_THEME,
  });
  const fitAddon = new FitAddonCtor();
  term.loadAddon(fitAddon);
  term.open(hostEl);

  const id = `tab_${tabSeq}`;
  const label = `标签 ${tabSeq} · ${meta.nodeName}`;
  tabSeq += 1;

  const tab = {
    id,
    label,
    nodeId: meta.nodeId,
    nodeName: meta.nodeName,
    host: meta.host,
    port: meta.port,
    sessionId: null,
    status: 'connecting',
    term,
    fitAddon,
    hostEl,
    decoder: new TextDecoder('utf-8'),
    pendingCmd: initialCmd,
    demoMode: isDemoMode(),
    demoBuf: '',
  };
  tabs.push(tab);
  activeTabId = id;
  syncTabVisibility();
  renderTabStrip();

  // Ctrl+Shift+C 复制 / Ctrl+Shift+V 粘贴
  term.attachCustomKeyEventHandler((ev) => {
    if (ev.type === 'keydown' && ev.ctrlKey && ev.shiftKey && ev.key.toLowerCase() === 'c') {
      const sel = term.getSelection();
      if (sel) {
        copyToClipboard(sel).then(() => showToast('已复制终端选中内容')).catch(() => {});
      }
      return false;
    }
    if (ev.type === 'keydown' && ev.ctrlKey && ev.shiftKey && ev.key.toLowerCase() === 'v') {
      if (navigator.clipboard?.readText) {
        navigator.clipboard.readText().then((txt) => {
          if (txt) sendToTab(tab, txt);
        }).catch(() => {});
      }
      return false;
    }
    return true;
  });

  // 右键智能复制/粘贴
  hostEl.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    const sel = term.getSelection();
    if (sel) {
      copyToClipboard(sel).then(() => {
        term.clearSelection();
        showToast('已复制选中文本');
      }).catch(() => {});
    } else if (navigator.clipboard?.readText) {
      navigator.clipboard.readText().then((txt) => {
        if (txt) sendToTab(tab, txt);
      }).catch(() => {});
    }
  });

  term.onData((data) => {
    sendToTab(tab, data);
  });

  await new Promise((r) => requestAnimationFrame(r));
  try { fitAddon.fit(); } catch { /* ignore */ }
  const cols = Math.max(40, term.cols || 110);
  const rows = Math.max(12, term.rows || 30);

  if (tab.demoMode) {
    tab.sessionId = `demo_${id}`;
    tab.status = 'connected';
    renderTabStrip();
    term.writeln(`\x1b[90mConnected to ${meta.nodeName} (Demo Mode PTY ${cols}x${rows})\x1b[0m`);
    if (initialCmd === 'sb') {
      renderDemoSbBanner(term, meta.nodeName);
    } else {
      term.write('root@demo:~# ');
      if (initialCmd) {
        sendToTab(tab, `${initialCmd}\r`);
      }
    }
    term.focus();
    return tab;
  }

  term.writeln(`\x1b[90m正在建立免密 SSH 交互会话 → ${meta.nodeName} (${meta.host}:${meta.port}) ...\x1b[0m`);
  try {
    const res = await invokeCmd('pty_open', { nodeId: meta.nodeId, cols, rows });
    tab.sessionId = res.sessionId;
    tab.host = res.host || meta.host;
    tab.port = res.port || meta.port;
    tab.status = 'connected';
    renderTabStrip();
    fitActiveTerminal();
    term.focus();
  } catch (err) {
    tab.status = 'closed';
    term.writeln(`\r\n\x1b[31m[连接失败] ${err.message}\x1b[0m`);
    renderTabStrip();
    showToast(err.message, true);
  }
  return tab;
}

function renderEmptyUnconfigured(meta) {
  const emptyEl = $('termEmptyState');
  if (!emptyEl) return;
  if (!meta.ready && !isDemoMode()) {
    emptyEl.innerHTML = `
      <div class="empty-state-icon">⌨️</div>
      <h3 class="card-title-lg mb-sm">${meta.flag} ${esc(meta.nodeName)} 尚未开启 SSH 直连</h3>
      <p class="sub-note empty-state-desc">
        ${meta.isNat
          ? '该 NAT 节点尚未填写公网 SSH 映射端口。请先在节点配置中填入 SSH 端口，或点击下方打开官方 Web 终端。'
          : '请先在「本机与节点配置」中填写主 VPS 公网 IP 与免密 SSH 私钥路径。'}
      </p>
      <div class="toolbar toolbar-center">
        <button class="btn primary" type="button" data-term-empty-act="edit">⚙️ 配置 SSH 端口</button>
      </div>
    `;
  } else {
    emptyEl.innerHTML = `
      <div class="empty-state-icon">⌨️</div>
      <h3 class="card-title-lg mb-sm">准备就绪 · ${meta.flag} ${esc(meta.nodeName)}</h3>
      <p class="sub-note empty-state-desc">一键连接免密 SSH 交互终端，直接运行 <code>sb</code> 打开 sing-box 管理脚本或执行右侧快捷命令。</p>
      <div class="toolbar toolbar-center">
        <button class="btn primary" type="button" data-term-empty-act="open-sb">🧩 连接并打开 sing-box 脚本 (sb)</button>
        <button class="btn" type="button" data-term-empty-act="open-shell">⌨️ 仅打开 Shell 终端</button>
      </div>
    `;
  }
}

async function ensurePtyListeners() {
  if (ptyEventsBound) return;
  ptyEventsBound = true;

  await onPtyData((payload) => {
    const { sessionId, data } = payload;
    if (!sessionId || !data) return;
    const tab = tabs.find((t) => t.sessionId === sessionId);
    if (!tab) return;
    try {
      const bytes = base64ToUint8Array(data);
      const text = tab.decoder.decode(bytes, { stream: true });
      tab.term.write(text);
      if (tab.pendingCmd) {
        const cmd = tab.pendingCmd;
        tab.pendingCmd = null;
        // 收到远端首包 shell 欢迎/提示符后短暂等待再注入初始命令（如 sb）
        setTimeout(() => {
          if (tab.status === 'connected' && tab.sessionId === sessionId) {
            sendToTab(tab, `${cmd}\r`);
          }
        }, 280);
      }
    } catch {
      // ignore decode anomalies
    }
  });

  await onPtyExit((payload) => {
    const { sessionId } = payload;
    if (!sessionId) return;
    const tab = tabs.find((t) => t.sessionId === sessionId);
    if (!tab) return;
    tab.status = 'closed';
    tab.sessionId = null;
    tab.term.writeln('\r\n\x1b[33m[SSH 会话已结束 — 点击右上角「↻ 重连」可快速恢复]\x1b[0m');
    renderTabStrip();
  });
}

function applyDrawerAndFontUI() {
  const fontSel = $('termFontSizeSel');
  if (fontSel) fontSel.value = String(fontSize);
  const drawer = $('termDrawer');
  const toggleBtn = $('termDrawerCollapseBtn');
  if (drawer) drawer.classList.toggle('collapsed', drawerCollapsed);
  if (toggleBtn) {
    toggleBtn.textContent = drawerCollapsed ? '‹' : '›';
    toggleBtn.title = drawerCollapsed ? '展开快捷命令面板' : '收起快捷命令面板';
  }
  const wb = $('termWorkbench');
  if (wb) wb.classList.toggle('is-maximized', isMaximized);
  const maxBtn = $('termMaxBtn');
  if (maxBtn) maxBtn.title = isMaximized ? '退出终端全屏' : '终端沉浸全屏';
  requestAnimationFrame(() => fitActiveTerminal());
}

export async function loadTerminal(appState, { autoConnect = true, initialCmd = null } = {}) {
  await ensurePtyListeners();
  renderSnippets(appState);
  applyDrawerAndFontUI();

  const meta = getActiveNodeMeta(appState);
  const existingForNode = tabs.find((t) => t.nodeId === meta.nodeId && t.status !== 'closed');

  if (existingForNode) {
    activateTab(existingForNode.id);
    if (initialCmd) {
      sendToTab(existingForNode, `${initialCmd}\r`);
    }
    return;
  }

  renderEmptyUnconfigured(meta);
  if (autoConnect && (meta.ready || isDemoMode())) {
    await openNewTabForNode(appState, initialCmd);
  } else {
    syncTabVisibility();
    renderTabStrip();
  }
}

export async function openTerminalWithCmd(appState, cmd = 'sb') {
  await loadTerminal(appState, { autoConnect: true, initialCmd: cmd });
}

function openSnippetModal(appState, snippetId = null) {
  const list = getSnippets(appState);
  const target = snippetId ? list.find((s) => s.id === snippetId) : null;
  editingSnippetId = target ? target.id : null;
  $('snippetModalTitle').textContent = target ? '编辑快捷命令' : '新建快捷命令';
  $('snippetTitleInput').value = target?.title || '';
  $('snippetCmdInput').value = target?.command || '';
  openModal('snippetEditModal');
  setTimeout(() => $('snippetTitleInput')?.focus(), 20);
}

async function persistSnippets(appState, nextList) {
  const res = await invokeCmd('save_terminal_snippets', { snippets: nextList });
  if (appState.localConfig) {
    appState.localConfig.terminalSnippets = res.terminalSnippets || nextList;
  }
  renderSnippets(appState);
}

export function initTerminalEvents(appState, { switchTab, openNatEditor }) {
  ensurePtyListeners();

  $('termAddTabBtn')?.addEventListener('click', () => {
    openNewTabForNode(appState, null);
  });

  $('termRunSbBtn')?.addEventListener('click', async () => {
    const cur = getActiveTab();
    const meta = getActiveNodeMeta(appState);
    if (cur && cur.nodeId === meta.nodeId && cur.status === 'connected') {
      sendToTab(cur, 'sb\r');
      cur.term.focus();
      return;
    }
    await openNewTabForNode(appState, 'sb');
  });

  $('termClearBtn')?.addEventListener('click', () => {
    const tab = getActiveTab();
    if (tab?.term) {
      tab.term.clear();
      tab.term.focus();
    }
  });

  $('termReconnectBtn')?.addEventListener('click', async () => {
    const tab = getActiveTab();
    if (tab) {
      const prevNode = tab.nodeId;
      await closeTab(tab.id);
      if (prevNode === appState.activeNodeId) {
        await openNewTabForNode(appState, null);
        return;
      }
    }
    await openNewTabForNode(appState, null);
  });

  $('termPasteBtn')?.addEventListener('click', async () => {
    const tab = getActiveTab();
    if (!tab || tab.status !== 'connected') return showToast('当前没有活动终端会话', true);
    try {
      const txt = await navigator.clipboard.readText();
      if (txt) {
        sendToTab(tab, txt);
        tab.term.focus();
      }
    } catch {
      showToast('剪贴板读取受限，请直接在终端内按 Ctrl+Shift+V 粘贴', true);
    }
  });

  $('termFontSizeSel')?.addEventListener('change', (ev) => {
    fontSize = Math.min(20, Math.max(11, Number(ev.target.value) || 14));
    try { localStorage.setItem(TERM_FONT_KEY, String(fontSize)); } catch { /* ignore */ }
    for (const t of tabs) {
      t.term.options.fontSize = fontSize;
    }
    requestAnimationFrame(() => fitActiveTerminal());
  });

  $('termDrawerCollapseBtn')?.addEventListener('click', () => {
    drawerCollapsed = !drawerCollapsed;
    try { localStorage.setItem(TERM_DRAWER_KEY, drawerCollapsed ? '1' : '0'); } catch { /* ignore */ }
    applyDrawerAndFontUI();
  });

  $('termToggleSnippetsBtn')?.addEventListener('click', () => {
    drawerCollapsed = !drawerCollapsed;
    try { localStorage.setItem(TERM_DRAWER_KEY, drawerCollapsed ? '1' : '0'); } catch { /* ignore */ }
    applyDrawerAndFontUI();
  });

  $('termMaxBtn')?.addEventListener('click', () => {
    isMaximized = !isMaximized;
    applyDrawerAndFontUI();
  });

  $('termTabList')?.addEventListener('click', (ev) => {
    const closeBtn = ev.target.closest('[data-close-tab]');
    if (closeBtn) {
      ev.stopPropagation();
      closeTab(closeBtn.dataset.closeTab);
      return;
    }
    const tabEl = ev.target.closest('[data-term-tab]');
    if (tabEl) {
      activateTab(tabEl.dataset.termTab);
    }
  });

  $('termEmptyState')?.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-term-empty-act]');
    if (!btn) return;
    const act = btn.dataset.termEmptyAct;
    if (act === 'open-sb') openNewTabForNode(appState, 'sb');
    else if (act === 'open-shell') openNewTabForNode(appState, null);
    else if (act === 'edit') {
      if (appState.activeNodeId === MAIN_VPS_NODE_ID) switchTab('settings');
      else openNatEditor(appState.activeNodeId);
    }
  });

  // 快捷命令面板交互
  $('termAddSnippetBtn')?.addEventListener('click', () => openSnippetModal(appState, null));
  $('snippetCancelBtn')?.addEventListener('click', () => closeModal('snippetEditModal'));

  $('snippetSaveBtn')?.addEventListener('click', (ev) => withButtonLoading(ev.currentTarget, async () => {
    const title = $('snippetTitleInput').value.trim();
    const command = $('snippetCmdInput').value.trim();
    if (!title || !command) return showToast('请填写快捷命令名称和内容', true);

    const list = structuredClone(getSnippets(appState));
    const id = editingSnippetId || `snip_${Date.now().toString(36)}`;
    const nextItem = { id, title, command, scope: 'all' };
    const idx = list.findIndex((s) => s.id === id);
    if (idx >= 0) list[idx] = nextItem;
    else list.push(nextItem);

    try {
      await persistSnippets(appState, list);
      selectedSnippetId = id;
      renderSnippets(appState);
      closeModal('snippetEditModal');
      showToast(`已保存快捷命令「${title}」`);
    } catch (err) {
      showToast(err.message, true);
    }
  }));

  $('termSnippetsList')?.addEventListener('click', (ev) => {
    const editBtn = ev.target.closest('[data-edit-snippet]');
    if (editBtn) {
      ev.stopPropagation();
      openSnippetModal(appState, editBtn.dataset.editSnippet);
      return;
    }
    const card = ev.target.closest('[data-snippet-id]');
    if (card) {
      selectedSnippetId = card.dataset.snippetId;
      renderSnippets(appState);
    }
  });

  $('termSnippetsList')?.addEventListener('dblclick', (ev) => {
    const card = ev.target.closest('[data-snippet-id]');
    if (!card) return;
    selectedSnippetId = card.dataset.snippetId;
    renderSnippets(appState);
    $('termSnippetExecBtn')?.click();
  });

  $('termSnippetExecBtn')?.addEventListener('click', async () => {
    const list = getSnippets(appState);
    const cur = list.find((s) => s.id === selectedSnippetId);
    if (!cur) return;
    let tab = getActiveTab();
    if (!tab || tab.status !== 'connected') {
      tab = await openNewTabForNode(appState, cur.command);
      if (tab) showToast(`已在新终端执行「${cur.title}」`);
      return;
    }
    sendToTab(tab, `${cur.command}\r`);
    tab.term.focus();
  });

  $('termSnippetDelBtn')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    const list = getSnippets(appState);
    const cur = list.find((s) => s.id === selectedSnippetId);
    if (!cur) return;
    const ok = await confirmDialog({
      title: `删除快捷命令「${cur.title}」`,
      message: '确认从本地快捷命令清单中删除该条命令？',
      confirmText: '确认删除',
      danger: true,
    });
    if (!ok) return;
    await withButtonLoading(btn, async () => {
      try {
        const nextList = list.filter((s) => s.id !== cur.id);
        await persistSnippets(appState, nextList);
        showToast('已删除快捷命令');
      } catch (err) {
        showToast(err.message, true);
      }
    });
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && isMaximized) {
      isMaximized = false;
      applyDrawerAndFontUI();
    }
  });
}
