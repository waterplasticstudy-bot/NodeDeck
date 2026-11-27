/**
 * 零公网暴露远端 sing-box 实时面板（经 SSH -L 127.0.0.1 加密隧道每 1.5s 实时刷新）
 */

import { showToast } from './components/toast.js';
import { copyToClipboard, invokeCmd } from './utils/bridge.js';
import { esc, fmtBytes, fmtMbps, nowTimeStr } from './utils/format.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(window.location.search);
const nodeId = params.get('nodeId') || 'vps_main';
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.setAttribute('data-theme', theme);

let paused = false;
let activeTab = 'conns';
let selectedUser = '';
let lastTotals = null;
let lastMeta = null;
let lastConnections = [];
const upHist = [];
const downHist = [];
const MAX_PTS = 40;

function extractConnUser(conn) {
  const m = conn.metadata || {};
  let u = m.user || m.inboundUser || m.authUser || m.auth_user || '';
  if (!u) {
    const rule = String(conn.rule || '');
    const hit = rule.match(/auth_user=\[?([^\]\s,]+)\]?/);
    if (hit) u = hit[1];
    else if (conn.rulePayload && !/^\d/.test(String(conn.rulePayload))) u = String(conn.rulePayload);
  }
  return u || '未标注';
}

function renderSpark() {
  const svg = $('rpSparkSvg');
  if (!svg) return;
  const maxVal = Math.max(0.5, ...upHist, ...downHist);
  const w = 600;
  const h = 110;
  const toPath = (arr) => {
    if (!arr.length) return '';
    return arr.map((v, i) => {
      const x = arr.length === 1 ? w : (i / (MAX_PTS - 1)) * w;
      const y = h - 8 - ((v / maxVal) * (h - 18));
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  };
  const upPath = toPath(upHist);
  const dnPath = toPath(downHist);
  svg.innerHTML = `
    <line x1="0" y1="${h - 8}" x2="${w}" y2="${h - 8}" stroke="var(--border)" stroke-width="1" />
    ${dnPath ? `<path d="${dnPath}" fill="none" stroke="var(--blue)" stroke-width="2.2" stroke-linecap="round" />` : ''}
    ${upPath ? `<path d="${upPath}" fill="none" stroke="var(--green)" stroke-width="2.2" stroke-linecap="round" />` : ''}
  `;
}

function renderConns() {
  const kw = ($('rpSearch')?.value || '').trim().toLowerCase();
  const userCounts = new Map();
  const normalized = lastConnections.map((c) => {
    const m = c.metadata || {};
    const user = extractConnUser(c);
    userCounts.set(user, (userCounts.get(user) || 0) + 1);
    return {
      id: c.id || '',
      user,
      sourceIP: m.sourceIP || '',
      host: m.host || m.destinationIP || '',
      port: m.destinationPort || '',
      network: String(m.network || '').toUpperCase(),
      rule: c.rulePayload ? `${c.rule || ''} (${c.rulePayload})` : (c.rule || '--'),
      upload: Number(c.upload || 0),
      download: Number(c.download || 0),
    };
  });

  if ($('rpUserCountSub')) {
    $('rpUserCountSub').textContent = `${userCounts.size} 位在线成员`;
  }

  const chips = [
    `<button type="button" class="region-chip${selectedUser === '' ? ' active' : ''}" data-rp-user="">全部 (${normalized.length})</button>`,
    ...[...userCounts.entries()].map(([u, cnt]) => (
      `<button type="button" class="region-chip${selectedUser === u ? ' active' : ''}" data-rp-user="${esc(u)}">${esc(u)} (${cnt})</button>`
    )),
  ];
  if ($('rpUserChips')) $('rpUserChips').innerHTML = chips.join('');

  const filtered = normalized
    .filter((c) => {
      if (selectedUser && c.user !== selectedUser) return false;
      if (kw && !`${c.user} ${c.sourceIP} ${c.host}:${c.port} ${c.rule}`.toLowerCase().includes(kw)) return false;
      return true;
    })
    .sort((a, b) => (b.upload + b.download) - (a.upload + a.download))
    .slice(0, 150);

  if ($('rpConnBody')) {
    $('rpConnBody').innerHTML = filtered.map((c) => `
      <tr>
        <td><strong>${esc(c.user)}</strong></td>
        <td class="mono">${esc(c.sourceIP)}</td>
        <td class="mono">${esc(c.host)}:${esc(c.port)}</td>
        <td><span class="pill gray xs">${esc(c.network)}</span></td>
        <td class="mono" style="font-size:11.5px;">${esc(c.rule)}</td>
        <td class="mono num">↑${fmtBytes(c.upload)} / ↓${fmtBytes(c.download)}</td>
        <td><button class="btn sm danger" data-rp-kill="${esc(c.id)}">掐断</button></td>
      </tr>
    `).join('') || '<tr><td colspan="7" class="empty-cell">当前无活跃连接</td></tr>';
  }
}

function renderRules(rules) {
  const arr = Array.isArray(rules) ? rules : [];
  if ($('rpRuleCount')) $('rpRuleCount').textContent = `${arr.length} 条`;
  if ($('rpRulesBody')) {
    $('rpRulesBody').innerHTML = arr.map((r, idx) => `
      <tr>
        <td class="mono num">${idx + 1}</td>
        <td><span class="pill gray xs">${esc(r.type || '--')}</span></td>
        <td class="mono">${esc(r.payload || '--')}</td>
        <td><span class="pill blue xs">${esc(r.proxy || '--')}</span></td>
      </tr>
    `).join('') || '<tr><td colspan="4" class="empty-cell">暂无远端规则数据</td></tr>';
  }
}

async function pollOnce() {
  if (paused) return;
  try {
    const res = await invokeCmd('poll_remote_singbox_panel', {
      nodeId,
      includeRules: activeTab === 'rules',
    });
    lastMeta = res;
    if ($('rpNodeTitle')) $('rpNodeTitle').textContent = `📊 ${res.nodeName || nodeId} · 远端 sing-box 实时面板`;
    if ($('rpTunnelBadge')) $('rpTunnelBadge').textContent = `🔒 加密隧道 127.0.0.1:${res.localPort} → 远端 127.0.0.1:${res.remotePort}`;
    if ($('rpVersionChip')) $('rpVersionChip').textContent = String(res.version || 'sing-box');
    if ($('rpSyncChip')) $('rpSyncChip').textContent = `更新于 ${nowTimeStr()}`;
    if ($('rpDot')) $('rpDot').className = 'dot ok';

    const now = Date.now();
    const upTot = Number(res.uploadTotal || 0);
    const dnTot = Number(res.downloadTotal || 0);
    let upBps = 0;
    let dnBps = 0;
    if (lastTotals && now > lastTotals.ts) {
      const dt = (now - lastTotals.ts) / 1000;
      upBps = Math.max(0, (upTot - lastTotals.up) / dt);
      dnBps = Math.max(0, (dnTot - lastTotals.dn) / dt);
    }
    lastTotals = { ts: now, up: upTot, dn: dnTot };

    upHist.push((upBps * 8) / 1e6);
    downHist.push((dnBps * 8) / 1e6);
    if (upHist.length > MAX_PTS) upHist.shift();
    if (downHist.length > MAX_PTS) downHist.shift();
    renderSpark();

    if ($('rpSpeedVal')) $('rpSpeedVal').textContent = `${fmtMbps(dnBps)}`;
    if ($('rpSpeedSub')) $('rpSpeedSub').textContent = `↑ ${fmtMbps(upBps)} · ↓ ${fmtMbps(dnBps)}`;
    if ($('rpUpLeg')) $('rpUpLeg').textContent = fmtMbps(upBps);
    if ($('rpDownLeg')) $('rpDownLeg').textContent = fmtMbps(dnBps);
    if ($('rpTotalVal')) $('rpTotalVal').textContent = fmtBytes(upTot + dnTot);
    if ($('rpTotalSub')) $('rpTotalSub').textContent = `↑ ${fmtBytes(upTot)} / ↓ ${fmtBytes(dnTot)}`;
    if ($('rpMemVal')) $('rpMemVal').textContent = fmtBytes(res.memory || 0);

    lastConnections = Array.isArray(res.connections) ? res.connections : [];
    if ($('rpConnNum')) $('rpConnNum').textContent = String(lastConnections.length);
    renderConns();
    if (activeTab === 'rules') renderRules(res.rules);
  } catch (err) {
    if ($('rpDot')) $('rpDot').className = 'dot err';
    if ($('rpTunnelBadge')) $('rpTunnelBadge').textContent = `⚠️ ${err.message}`;
  }
}

document.querySelectorAll('#rpTabSeg button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#rpTabSeg button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    activeTab = btn.dataset.rpTab;
    $('rpConnsPane')?.classList.toggle('hidden', activeTab !== 'conns');
    $('rpRulesPane')?.classList.toggle('hidden', activeTab !== 'rules');
    pollOnce();
  });
});

$('rpPauseBtn')?.addEventListener('click', () => {
  paused = !paused;
  $('rpPauseBtn').textContent = paused ? '▶️ 恢复' : '⏸️ 暂停';
  if (!paused) pollOnce();
});

$('rpCopyConnBtn')?.addEventListener('click', async () => {
  if (!lastMeta) return showToast('隧道尚未就绪', true);
  const text = `URL: http://127.0.0.1:${lastMeta.localPort}\nSecret: ${lastMeta.secret || '(无)'}`;
  try {
    await copyToClipboard(text);
    showToast('已复制本地隧道地址与 Secret（仅本机 127.0.0.1 可连）');
  } catch (err) {
    showToast(err.message, true);
  }
});

$('rpCloseBtn')?.addEventListener('click', async () => {
  try {
    await invokeCmd('close_remote_singbox_panel', { nodeId });
  } catch {
    // 窗口关闭时后端也会自动回收隧道
  }
  window.close();
});

$('rpSearch')?.addEventListener('input', () => renderConns());

$('rpUserChips')?.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-rp-user]');
  if (!btn) return;
  selectedUser = btn.dataset.rpUser || '';
  renderConns();
});

$('rpKillAllBtn')?.addEventListener('click', async () => {
  try {
    await invokeCmd('close_remote_singbox_panel_conn', { nodeId, id: '__ALL__' });
    showToast('已断开远端全部连接');
    await pollOnce();
  } catch (err) {
    showToast(err.message, true);
  }
});

$('rpConnBody')?.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('[data-rp-kill]');
  if (!btn) return;
  try {
    await invokeCmd('close_remote_singbox_panel_conn', { nodeId, id: btn.dataset.rpKill });
    showToast('已掐断该远端连接');
    await pollOnce();
  } catch (err) {
    showToast(err.message, true);
  }
});

pollOnce();
setInterval(pollOnce, 1500);
