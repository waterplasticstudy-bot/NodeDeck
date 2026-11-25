/**
 * 成员流量与实时在线监控页（支持主 VPS 与 Alpine NAT 127.0.0.1 零公网暴露统计）
 */

import { confirmDialog } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import {
  DEFAULT_NAT_PORTAL_URL,
  HEALTH_THRESHOLDS,
  MAIN_VPS_NODE_ID,
  MEMBER_COLORS,
  POST_MUTATION_REFRESH_MS,
} from '../constants/ui-constants.js';
import { invokeCmd, withButtonLoading } from '../utils/bridge.js';
import { annotateHost, countSubnets24, countryFlag, esc, fmtBytes } from '../utils/format.js';
import { getActiveNatNode } from './nat-overview.js';

const $ = (id) => document.getElementById(id);

export function renderConnectionsTable(appState) {
  const data = appState.auditData;
  if (!data) return;
  const uf = $('auditUserFilter').value;
  const kw = $('auditSearch').value.trim().toLowerCase();
  const hideSsh = $('hideSelfSsh').checked;

  const list = (data.connections || []).filter((c) => {
    if (hideSsh && c.port === '22' && c.host === appState.lastOverview?.host) return false;
    if (uf && c.user !== uf) return false;
    if (kw && !`${c.host}:${c.port} ${c.sourceIP} ${c.user}`.toLowerCase().includes(kw)) return false;
    return true;
  });

  $('connCountTag').textContent = `${list.length} 条`;
  $('connTableBody').innerHTML = list.map((c) => {
    const tag = annotateHost(c.host, c.port);
    return `
      <tr class="${c.suspicious ? 'suspicious' : ''}">
        <td><strong>${esc(c.user)}</strong></td>
        <td class="mono">${esc(c.sourceIP)}</td>
        <td class="mono">
          ${esc(c.host)}:${esc(c.port)}
          ${tag ? `<span class="pill ${tag.cls} ml-sm">${tag.label}</span>` : ''}
          ${c.suspicious ? '<span class="pill red ml-sm">⚠️ 定位域</span>' : ''}
        </td>
        <td><span class="pill gray">${esc(c.network.toUpperCase())}</span></td>
        <td class="mono num">↑ ${fmtBytes(c.upload)} / ↓ ${fmtBytes(c.download)}</td>
        <td><button class="btn sm danger" data-action="vps-close" data-id="${esc(c.id)}">掐断</button></td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="6" class="empty-cell">当前无匹配的活跃连接</td></tr>';
}

export async function loadAudit(appState) {
  const isVps = !appState || appState.activeNodeId === MAIN_VPS_NODE_ID;
  const nat = isVps ? null : getActiveNatNode(appState);

  if (!isVps && (!nat || !nat.sshPort || !nat.publicIp)) {
    $('vpsAuditPane').classList.add('hidden');
    $('natAuditPane').classList.remove('hidden');
    const flag = nat ? countryFlag(nat.region) : '🌐';
    const nodeLabel = nat ? `${flag} ${esc(nat.name)}` : '当前 NAT 节点';
    $('natAuditPane').innerHTML = `
      <div class="card empty-state-box">
        <div class="empty-state-icon">🕵️</div>
        <h3 class="card-title-lg mb-sm">${nodeLabel} 需先配置公网 SSH 端口</h3>
        <p class="sub-note empty-state-desc">
          配置 Alpine SSH 端口后即可一键为该 NAT 开启仅监听 <code>127.0.0.1:19091</code> 的零公网暴露在线连接与用户流量监控。
        </p>
        <div class="toolbar toolbar-center">
          <button class="btn primary" data-action="audit-goto-vps">🖥️ 切回主 VPS 查看审计</button>
          <button class="btn" data-action="audit-nat-web">🖥️ 打开该 NAT 官方终端</button>
        </div>
      </div>
    `;
    return;
  }

  $('natAuditPane').classList.add('hidden');
  $('vpsAuditPane').classList.remove('hidden');
  $('auditLogHistoryCard').classList.toggle('hidden', !isVps);

  if (isVps) {
    $('auditScopeTitle').textContent = '主 VPS · 按成员实时流量与防外泄审计';
    $('auditScopeSub').textContent = '同一成员并发出现 ≥3 个不同 /24 网段自动标红预警（智能识别前置同段多 IP 负载均衡）';
    $('auditOffTitle').textContent = '尚未开启主 VPS 本地统计接口';
    $('auditOffDesc').innerHTML = '开启后仅监听在服务器 <code>127.0.0.1</code>（带随机 32 位密钥），公网零暴露，同时自动写入按成员归属的 <code>auth_user</code> 路由标记。';
  } else {
    const flag = countryFlag(nat.region);
    $('auditScopeTitle').textContent = `${flag} ${nat.name} · Alpine NAT 实时在线与用户流量监控`;
    $('auditScopeSub').textContent = '仅在容器内监听 127.0.0.1:19091 本地统计接口，公网零暴露，随时查看谁正在连这台 NAT';
    $('auditOffTitle').textContent = `尚未开启「${nat.name}」本地在线统计`;
    $('auditOffDesc').innerHTML = '开启后仅在 NAT 容器内部监听 <code>127.0.0.1:19091</code>（带随机 32 位密钥），绝不占用公网端口映射，可随时一键关闭。';
  }

  try {
    const { data } = isVps
      ? await invokeCmd('get_audit')
      : await invokeCmd('get_nat_alpine_audit', { nodeId: nat.id });
    appState.auditData = data;
    if (!data.enabled) {
      $('auditOffBox').classList.remove('hidden');
      $('auditOnBox').classList.add('hidden');
      $('auditControls').innerHTML = '';
      return;
    }

    $('auditOffBox').classList.add('hidden');
    $('auditOnBox').classList.remove('hidden');
    const isInfo = data.logLevel === 'info';
    $('auditControls').innerHTML = `
      <span class="pill green">● 本地统计运行中 (${esc(data.controller)})</span>
      <span class="pill blue num">累计 ↑${fmtBytes(data.uploadTotal)} / ↓${fmtBytes(data.downloadTotal)}</span>
      <button class="btn sm danger" data-action="disable-audit">关闭统计</button>
    `;
    document.querySelectorAll('#logLevelSeg button').forEach((b) => {
      b.classList.toggle('active', b.dataset.lvl === (isInfo ? 'info' : 'warn'));
    });

    const entries = Object.entries(data.userSummary || {});
    $('auditUserCards').innerHTML = entries.map(([u, st], idx) => {
      const ips = st.sourceIPs || [];
      const subnets = countSubnets24(ips);
      const sameSubnetLB = ips.length >= 2 && subnets === 1;
      const warnShare = subnets >= HEALTH_THRESHOLDS.suspiciousSubnetCount;
      const warnLoc = (st.suspiciousHosts || []).length > 0;
      const verdict = warnShare
        ? `疑似外泄（${subnets} 个不同网段同时在线）`
        : warnLoc
          ? '触发疑似定位上报域名'
          : sameSubnetLB
            ? '正常（前置同网段多 IP 负载均衡）'
            : st.activeConnections > 0
              ? '当前在线使用中'
              : '当前空闲无连接';
      return `
        <div class="user-card ${warnShare || warnLoc ? 'alert' : ''}">
          <div class="flex-between">
            <span class="row-inline user-name-lg">
              <span class="color-dot" style="background:${MEMBER_COLORS[idx % MEMBER_COLORS.length]}"></span>
              ${esc(u)}
            </span>
            ${warnShare || warnLoc
              ? '<span class="pill red">⚠️ 需核查</span>'
              : st.activeConnections > 0
                ? `<span class="pill green num">${st.activeConnections} 活跃连接</span>`
                : '<span class="pill gray">空闲</span>'}
          </div>
          <div class="sub-note">状态评估：<strong>${verdict}</strong></div>
          <div class="sub-note num">活跃流量：<strong>↑ ${fmtBytes(st.upload)}</strong> · <strong>↓ ${fmtBytes(st.download)}</strong></div>
          <div class="sub-note num">
            接入 IP（${ips.length} 个 / ${subnets} 网段）：
            ${ips.length ? `<div class="uuid-box mono mt-xs">${ips.map(esc).join(' , ')}</div>` : '无'}
          </div>
          ${warnLoc ? `<span class="pill red">定位域：${st.suspiciousHosts.map(esc).join(', ')}</span>` : ''}
        </div>
      `;
    }).join('') || '<div class="sub-note">暂无用户记录</div>';

    if (isVps) {
      if (isInfo) {
        $('logLevelHint').textContent = '已读取最近 400 条 sing-box 日志，按成员聚合历史接入 IP';
        const rows = Object.entries(data.recentLogSummary || {});
        $('logHistoryBody').innerHTML = rows.length
          ? `<div class="ios-list">${rows.map(([u, s]) => `
              <div class="ios-row">
                <div>
                  <div class="ios-row-title">${esc(u)} · 近期 ${s.count} 次握手 · ${s.sourceIPs.length} 个来源 IP</div>
                  <div class="ios-row-desc mono">${s.sourceIPs.slice(0, 8).map(esc).join(', ')}</div>
                </div>
                ${s.suspiciousHosts.length ? '<span class="pill red">疑似定位域</span>' : '<span class="pill green">未见异常</span>'}
              </div>
            `).join('')}</div>`
          : '暂无近期连接日志（有流量通过后刷新即可看到）';
      } else {
        $('logLevelHint').textContent = '当前为省盘模式 (warn)；实时连接表已完整工作，如需回溯历史 IP 可切至「历史审计 (info)」';
        $('logHistoryBody').textContent = '当前未记录历史连接明细，零磁盘写入负担。';
      }
    }

    const sel = $('auditUserFilter');
    const prevSel = appState.pendingAuditFilter !== undefined ? appState.pendingAuditFilter : sel.value;
    appState.pendingAuditFilter = undefined;
    const names = Array.from(new Set([...(data.configuredUsers || []), ...(data.connections || []).map((c) => c.user)]));
    sel.innerHTML = '<option value="">全部用户</option>' + names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    if (names.includes(prevSel)) sel.value = prevSel;

    renderConnectionsTable(appState);
  } catch (err) {
    showToast(err.message, true);
  }
}

export function initAuditEvents(appState, { reloadOverview, switchToNode }) {
  $('natAuditPane').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'audit-goto-vps') {
      switchToNode(MAIN_VPS_NODE_ID, 'audit');
    } else if (btn.dataset.action === 'audit-nat-web') {
      const node = getActiveNatNode(appState);
      if (!node || !node.portalUrl) return showToast('请先在节点配置中填写官方控制台 URL', true);
      await withButtonLoading(btn, async () => {
        try {
          await invokeCmd('open_account_window', {
            profileId: node.providerProfileId || 'nat_main',
            title: `${node.name} · NAT 控制台`,
            url: node.portalUrl || DEFAULT_NAT_PORTAL_URL,
          });
        } catch (err) {
          showToast(err.message, true);
        }
      });
    }
  });

  $('auditUserFilter').addEventListener('change', () => renderConnectionsTable(appState));
  $('auditSearch').addEventListener('input', () => renderConnectionsTable(appState));
  $('hideSelfSsh').addEventListener('change', () => renderConnectionsTable(appState));

  $('enableAuditBtn').addEventListener('click', (ev) => withButtonLoading(ev.currentTarget, async () => {
    try {
      const isVps = appState.activeNodeId === MAIN_VPS_NODE_ID;
      const res = isVps
        ? await invokeCmd('configure_audit', { enable: true, logLevel: null })
        : await invokeCmd('configure_nat_alpine_audit', { nodeId: appState.activeNodeId, enable: true });
      showToast(res.message);
      setTimeout(() => { loadAudit(appState); reloadOverview(); }, POST_MUTATION_REFRESH_MS);
    } catch (err) {
      showToast(err.message, true);
    }
  }));

  $('auditControls').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-action="disable-audit"]');
    if (!btn) return;
    const isVps = appState.activeNodeId === MAIN_VPS_NODE_ID;
    const ok = await confirmDialog({
      title: '关闭本地统计接口',
      message: '确认关闭该节点 127.0.0.1 本地统计接口并平滑重启 sing-box？',
      confirmText: '确认关闭',
      danger: true,
    });
    if (!ok) return;
    await withButtonLoading(btn, async () => {
      try {
        const res = isVps
          ? await invokeCmd('configure_audit', { enable: false, logLevel: 'warn' })
          : await invokeCmd('configure_nat_alpine_audit', { nodeId: appState.activeNodeId, enable: false });
        showToast(res.message);
        setTimeout(() => { loadAudit(appState); reloadOverview(); }, POST_MUTATION_REFRESH_MS);
      } catch (err) {
        showToast(err.message, true);
      }
    });
  });

  document.querySelectorAll('#logLevelSeg button').forEach((btn) => btn.addEventListener('click', async () => {
    if (appState.activeNodeId !== MAIN_VPS_NODE_ID) return;
    try {
      await invokeCmd('configure_audit', { enable: true, logLevel: btn.dataset.lvl });
      showToast(`已切换日志级别为 ${btn.dataset.lvl}`);
      setTimeout(() => loadAudit(appState), POST_MUTATION_REFRESH_MS);
    } catch (err) {
      showToast(err.message, true);
    }
  }));

  $('closeAllConnBtn').addEventListener('click', async (ev) => {
    const ok = await confirmDialog({
      title: '断开当前节点全部活跃连接',
      message: '确认立即切断该节点 sing-box 上的所有活跃连接？',
      confirmText: '断开全部',
      danger: true,
    });
    if (!ok) return;
    await withButtonLoading(ev.currentTarget, async () => {
      try {
        if (appState.activeNodeId === MAIN_VPS_NODE_ID) {
          await invokeCmd('close_vps_conn', { id: '__ALL__' });
        } else {
          await invokeCmd('close_nat_alpine_conn', { nodeId: appState.activeNodeId, id: '__ALL__' });
        }
        showToast('已断开全部活跃连接');
        await loadAudit(appState);
      } catch (err) {
        showToast(err.message, true);
      }
    });
  });

  $('connTableBody').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-action="vps-close"]');
    if (!btn) return;
    try {
      if (appState.activeNodeId === MAIN_VPS_NODE_ID) {
        await invokeCmd('close_vps_conn', { id: btn.dataset.id });
      } else {
        await invokeCmd('close_nat_alpine_conn', { nodeId: appState.activeNodeId, id: btn.dataset.id });
      }
      showToast('已掐断该连接');
      await loadAudit(appState);
    } catch (err) {
      showToast(err.message, true);
    }
  });
}
