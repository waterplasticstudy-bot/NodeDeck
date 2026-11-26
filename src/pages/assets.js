/**
 * 续费与多账号中心模块（双模按需流量同步：免订阅仪表盘识别 + 可选单次订阅查流 + 独立 WebView2 沙箱会话隔离）
 */

import { closeModal, confirmDialog, openModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import {
  ACCOUNT_CATEGORY_LABELS,
  DEFAULT_NAT_PORTAL_URL,
  DEFAULT_NAT_SINGBOX_CONFIG,
  HEALTH_THRESHOLDS,
} from '../constants/ui-constants.js';
import { invokeCmd, openExternal, withButtonLoading } from '../utils/bridge.js';
import {
  accentColorVar,
  billingCycleLabel,
  calcMonthlyCost,
  countryFlag,
  esc,
  fmtBytes,
  fmtPingMs,
  fmtSyncedTime,
  getExpiryMeta,
} from '../utils/format.js';

const $ = (id) => document.getElementById(id);

let editingAccountId = null;
let editingNatId = null;

export function updateAssetsNavBadge(appState) {
  const cfg = appState.localConfig;
  if (!cfg) return;
  const accounts = cfg.providerAccounts || [];
  const nats = cfg.natNodes || [];
  let urgent = 0;
  let danger = 0;

  for (const item of [...accounts, ...nats]) {
    const meta = getExpiryMeta(item.expiresAt, item.autoRenew);
    if (meta.urgent) urgent += 1;
    if (meta.tone === 'red') danger += 1;
  }

  const badge = $('navAssetsBadge');
  if (!badge) return;
  if (urgent > 0) {
    badge.textContent = `临期 ${urgent}`;
    badge.className = `nav-badge num ${danger > 0 ? 'danger' : 'warn'}`;
  } else {
    badge.textContent = String(accounts.length + nats.length);
    badge.className = 'nav-badge num';
  }
}

function renderTrafficProgressBlock(snap) {
  if (!snap || !snap.totalBytes) return '';
  const pct = Math.min(100, Number(snap.percent || 0));
  const usedLabel = snap.usedText || fmtBytes(snap.usedBytes);
  const totalLabel = snap.totalText || fmtBytes(snap.totalBytes);
  const srcLabel = snap.source === 'host-billing'
    ? '宿主机计费'
    : snap.source === 'subscription'
      ? '订阅查流'
      : '仪表盘识别';
  const timeLabel = fmtSyncedTime(snap.syncedAt);
  return `
    <div class="sub-progress-wrap">
      <div class="flex-between sub-note num">
        <span>${esc(srcLabel)}${timeLabel ? ` · ${esc(timeLabel)}` : ''}</span>
        <strong>${esc(usedLabel)} / ${esc(totalLabel)} (${pct.toFixed(1)}%)</strong>
      </div>
      <div class="sub-progress-track">
        <div class="sub-progress-fill" style="width:${pct.toFixed(1)}%"></div>
      </div>
      ${snap.cycleText ? `<div class="sub-note">${esc(snap.cycleText)}</div>` : ''}
    </div>
  `;
}

export function renderAssetsPage(appState) {
  const cfg = appState.localConfig;
  if (!cfg) return;
  const accounts = cfg.providerAccounts || [];
  const nats = cfg.natNodes || [];
  const sessions = appState.accountSessions || {};

  let monthlyTotal = 0;
  let airportCost = 0;
  let vpsCost = 0;
  let natCost = 0;
  let urgentCount = 0;
  for (const acc of accounts) {
    const mc = calcMonthlyCost(acc.priceCny, acc.billingCycle);
    monthlyTotal += mc;
    if (acc.category === 'vps') vpsCost += mc;
    else if (acc.category === 'nat') natCost += mc;
    else airportCost += mc;
    const effectiveExpire = acc.expiresAt || acc.trafficSnapshot?.expiresAt || '';
    if (getExpiryMeta(effectiveExpire, acc.autoRenew).urgent) urgentCount += 1;
  }
  for (const nat of nats) {
    const mc = calcMonthlyCost(nat.priceCny, nat.billingCycle);
    monthlyTotal += mc;
    natCost += mc;
    if (getExpiryMeta(nat.expiresAt, nat.autoRenew).urgent) urgentCount += 1;
  }

  const activeSessionProfiles = Object.values(sessions).filter(Boolean).length;
  $('assetsMonthlyCost').textContent = `¥${monthlyTotal.toFixed(1)}`;
  $('assetsCostSub').textContent = `约 ¥${(monthlyTotal * 12).toFixed(0)}/年 · 订阅 ¥${airportCost.toFixed(0)} · VPS ¥${vpsCost.toFixed(0)} · NAT ¥${natCost.toFixed(0)}`;
  $('assetsTotalCount').textContent = String(accounts.length + nats.length);
  $('assetsCountSub').textContent = `${accounts.length} 个服务商账号 · ${nats.length} 台家宽 NAT`;
  $('assetsUrgentCount').textContent = String(urgentCount);
  $('assetsUrgentSub').textContent = urgentCount > 0 ? '请留意下方标橙/标红卡片续费' : '当前所有资产到期充裕';
  $('assetsSessionCount').textContent = String(activeSessionProfiles);

  $('providerAccountsGrid').innerHTML = accounts.map((acc) => {
    const effectiveExpire = acc.expiresAt || acc.trafficSnapshot?.expiresAt || '';
    const exp = getExpiryMeta(effectiveExpire, acc.autoRenew);
    const signed = Boolean(sessions[acc.profileId]);
    const color = accentColorVar(acc.accentColor);
    const catLabel = ACCOUNT_CATEGORY_LABELS[acc.category] || '服务商';
    const hasPortal = Boolean(acc.portalUrl && acc.portalUrl.trim());
    const hasRenew = Boolean((acc.renewUrl || acc.portalUrl || '').trim());
    const hasSub = Boolean(acc.subscriptionUrl && acc.subscriptionUrl.trim());

    return `
      <div class="asset-card ${exp.cardClass}">
        <div class="flex-between">
          <span class="row-inline user-name-lg">
            <span class="color-dot" style="background:${color}"></span>
            ${esc(acc.name)}
          </span>
          <span class="pill ${signed ? 'green' : 'gray'}">${signed ? '🔒 已记登录态' : '⚪ 未登录'}</span>
        </div>

        <div class="row-wrap">
          <span class="pill blue xs">${esc(catLabel)}</span>
          <span class="pill gray xs mono">沙箱: ${esc(acc.profileId)}</span>
          <span class="pill ${exp.tone} xs">${esc(exp.text)}</span>
        </div>

        <div class="flex-between">
          <div>
            <div class="sub-note">${esc(acc.accountLabel || '未设账号备注')}</div>
            <div class="sub-note">${esc(acc.planName || '未填套餐')}</div>
          </div>
          <div class="text-right">
            <div class="asset-price num">${Number(acc.priceCny || 0) > 0 ? `¥${Number(acc.priceCny).toFixed(1)}` : '--'}</div>
            <div class="sub-note">${esc(billingCycleLabel(acc.billingCycle))}${effectiveExpire ? ` · ${esc(effectiveExpire)}` : ''}</div>
          </div>
        </div>

        ${renderTrafficProgressBlock(acc.trafficSnapshot)}
        ${acc.notes ? `<div class="sub-note">${esc(acc.notes)}</div>` : ''}

        <div class="toolbar mt-xs">
          <button class="btn sm primary" data-action="acc-open-isolated" data-id="${esc(acc.id)}" ${hasPortal ? '' : 'disabled'}>🪟 独立窗口</button>
          <button class="btn sm" data-action="acc-scrape-traffic" data-id="${esc(acc.id)}" ${hasPortal ? '' : 'disabled'}>🪞 识别流量</button>
          ${hasSub ? `<button class="btn sm" data-action="acc-sync-sub" data-id="${esc(acc.id)}" title="手动单次拉取 subscription-userinfo，不后台轮询">↻ 订阅查流</button>` : ''}
          <button class="btn sm" data-action="acc-open-browser" data-id="${esc(acc.id)}" ${hasRenew ? '' : 'disabled'}>↗ 续费</button>
          <button class="btn sm" data-action="acc-edit" data-id="${esc(acc.id)}">✏️ 编辑</button>
        </div>
      </div>
    `;
  }).join('') || `
    <div class="card empty-state-box col-span-full">
      <div class="empty-state-icon">💳</div>
      <div class="sub-note">尚未添加服务商账号卡片。点击右上角「＋ 新增账号」即可手动引入任意 VPS / NAT / 代理服务商控制台。</div>
    </div>
  `;

  $('assetsNatGrid').innerHTML = nats.map((nat) => {
    const exp = getExpiryMeta(nat.expiresAt, nat.autoRenew);
    const flag = countryFlag(nat.region);
    const ping = appState.natPingHist[nat.id]?.last;
    const pingText = ping ? (ping.reachable ? fmtPingMs(ping.ms) : '不可达') : '待测速';
    const pingTone = !ping
      ? 'gray'
      : !ping.reachable
        ? 'red'
        : ping.ms < HEALTH_THRESHOLDS.natPingGoodMs
          ? 'green'
          : 'orange';

    return `
      <div class="asset-card ${exp.cardClass}">
        <div class="flex-between">
          <span class="user-name-lg">${flag} ${esc(nat.name)}</span>
          <div class="toolbar">
            <span class="pill ${pingTone} num">${esc(pingText)}</span>
            <span class="pill ${exp.tone}">${esc(exp.text)}</span>
          </div>
        </div>
        <div class="sub-note">${esc(nat.plan || 'LXC IPv4 NAT')} · <strong>¥${Number(nat.priceCny || 0).toFixed(1)}/月</strong> · 配额 ${nat.monthlyQuotaGB || '--'} GB</div>
        <div class="sub-note mono">公网入口：${nat.publicIp && nat.servicePort ? `${esc(nat.publicIp)}:${nat.servicePort}` : '点编辑补全公网 IP 与端口'} · 到期 ${esc(nat.expiresAt || '--')}</div>
        ${renderTrafficProgressBlock(nat.trafficSnapshot)}
        <div class="toolbar mt-xs">
          <button class="btn sm primary" data-action="nat-goto-monitor" data-id="${esc(nat.id)}">📊 节点与出口控制</button>
          <button class="btn sm" data-action="nat-sync-traffic" data-id="${esc(nat.id)}">🪞 同步流量</button>
          <button class="btn sm" data-action="nat-open-portal" data-id="${esc(nat.id)}" ${nat.portalUrl ? '' : 'disabled'}>🖥️ 官方后台</button>
          <button class="btn sm" data-action="nat-edit" data-id="${esc(nat.id)}">✏️ 编辑</button>
        </div>
      </div>
    `;
  }).join('') || `
    <div class="card empty-state-box col-span-full">
      <div class="empty-state-icon">🌍</div>
      <div class="sub-note">尚未引入家宽 / LXC NAT 实例。点击右上角「＋ 新增 NAT」即可接入 TCP 探活、Alpine 零 Python SSH 托管与多出口控制。</div>
    </div>
  `;

  updateAssetsNavBadge(appState);
}

export async function loadAssets(appState) {
  const cfg = appState.localConfig;
  if (!cfg) return;
  const profileIds = Array.from(new Set([
    ...(cfg.providerAccounts || []).map((a) => a.profileId),
    ...(cfg.natNodes || []).map((n) => n.providerProfileId),
  ].filter(Boolean)));

  try {
    const { sessions } = await invokeCmd('get_account_sessions_status', { profileIds });
    appState.accountSessions = sessions || {};
  } catch {
    appState.accountSessions = {};
  }
  renderAssetsPage(appState);
}

function openAccountEditor(appState, accId = null) {
  const accounts = appState.localConfig?.providerAccounts || [];
  const acc = accId ? accounts.find((a) => a.id === accId) : null;
  editingAccountId = acc ? acc.id : null;

  $('accModalTitle').textContent = acc ? `编辑「${acc.name}」` : '新增服务商 / 订阅账号';
  $('accName').value = acc?.name || '';
  $('accLabel').value = acc?.accountLabel || '';
  $('accCategory').value = acc?.category || 'airport';
  $('accProfileId').value = acc?.profileId || `acc_${Date.now().toString(36).slice(-5)}`;
  $('accPortalUrl').value = acc?.portalUrl || '';
  $('accRenewUrl').value = acc?.renewUrl || '';
  $('accSubUrl').value = acc?.subscriptionUrl || '';
  $('accPlan').value = acc?.planName || '';
  $('accCycle').value = acc?.billingCycle || 'monthly';
  $('accPrice').value = acc?.priceCny ?? 0;
  $('accExpires').value = acc?.expiresAt || '';
  $('accAccent').value = acc?.accentColor || 'blue';
  $('accAutoRenew').value = String(Boolean(acc?.autoRenew));
  $('accNotes').value = acc?.notes || '';

  $('accDeleteBtn').classList.toggle('hidden', !acc);
  $('accClearSessionBtn').classList.toggle('hidden', !acc);
  openModal('accountEditModal');
}

export function openNatEditor(appState, natId = null) {
  const nats = appState.localConfig?.natNodes || [];
  const nat = natId ? nats.find((n) => n.id === natId) : null;
  editingNatId = nat ? nat.id : null;

  $('natModalTitle').textContent = nat ? `编辑 NAT「${nat.name}」` : '新增加宽 NAT 节点';
  $('natName').value = nat?.name || '';
  $('natRegion').value = nat?.region || 'JP';
  $('natPlan').value = nat?.plan || '';
  $('natPortalUrl').value = nat?.portalUrl || DEFAULT_NAT_PORTAL_URL;
  $('natPublicIp').value = nat?.publicIp || '';
  $('natServicePort').value = nat?.servicePort || '';
  $('natPrice').value = nat?.priceCny ?? 10;
  $('natExpires').value = nat?.expiresAt || '';
  $('natQuota').value = nat?.monthlyQuotaGB || 100;
  $('natAutoRenew').value = String(nat ? Boolean(nat.autoRenew) : true);
  $('natProfileId').value = nat?.providerProfileId || 'nat_main';
  $('natSshPort').value = nat?.sshPort || 0;
  $('natShareLink').value = nat?.shareLink || '';
  $('natSbCfgPath').value = nat?.singboxConfigPath || DEFAULT_NAT_SINGBOX_CONFIG;
  $('natNotes').value = nat?.notes || '';

  $('natDeleteBtn').classList.toggle('hidden', !nat);
  openModal('natEditModal');
}

export function initAssetsEvents(appState, { onNodesChanged, switchToNode }) {
  $('addAccountBtn').addEventListener('click', () => openAccountEditor(appState, null));
  $('addNatBtn').addEventListener('click', () => openNatEditor(appState, null));
  $('accCancelBtn').addEventListener('click', () => closeModal('accountEditModal'));
  $('natCancelBtn').addEventListener('click', () => closeModal('natEditModal'));

  $('accSaveBtn').addEventListener('click', (ev) => withButtonLoading(ev.currentTarget, async () => {
    const name = $('accName').value.trim();
    const profileId = $('accProfileId').value.trim();
    if (!name || !profileId) return showToast('请填写显示名称和隔离沙箱标识', true);

    const list = [...(appState.localConfig?.providerAccounts || [])];
    const existing = editingAccountId ? list.find((x) => x.id === editingAccountId) : null;
    const nextItem = {
      id: editingAccountId || `acc_${Date.now().toString(36)}`,
      profileId,
      name,
      category: $('accCategory').value,
      accentColor: $('accAccent').value,
      accountLabel: $('accLabel').value.trim(),
      portalUrl: $('accPortalUrl').value.trim(),
      renewUrl: $('accRenewUrl').value.trim(),
      subscriptionUrl: $('accSubUrl').value.trim(),
      planName: $('accPlan').value.trim(),
      billingCycle: $('accCycle').value,
      priceCny: Number($('accPrice').value) || 0,
      expiresAt: $('accExpires').value.trim(),
      autoRenew: $('accAutoRenew').value === 'true',
      trafficSnapshot: existing?.trafficSnapshot || null,
      notes: $('accNotes').value.trim(),
    };

    const idx = list.findIndex((x) => x.id === nextItem.id);
    if (idx >= 0) list[idx] = nextItem;
    else list.push(nextItem);

    try {
      const res = await invokeCmd('save_provider_accounts', { accounts: list });
      appState.localConfig.providerAccounts = res.providerAccounts;
      closeModal('accountEditModal');
      showToast(`已保存「${name}」`);
      await loadAssets(appState);
    } catch (err) {
      showToast(err.message, true);
    }
  }));

  $('accDeleteBtn').addEventListener('click', async (ev) => {
    if (!editingAccountId) return;
    const ok = await confirmDialog({
      title: '删除此账号卡片',
      message: '确认从续费台账中移除该卡片？（不会删除远端账号，仅移出本地列表）',
      confirmText: '确认删除',
      danger: true,
    });
    if (!ok) return;
    await withButtonLoading(ev.currentTarget, async () => {
      try {
        const list = (appState.localConfig?.providerAccounts || []).filter((a) => a.id !== editingAccountId);
        const res = await invokeCmd('save_provider_accounts', { accounts: list });
        appState.localConfig.providerAccounts = res.providerAccounts;
        closeModal('accountEditModal');
        showToast('已删除账号卡片');
        await loadAssets(appState);
      } catch (err) {
        showToast(err.message, true);
      }
    });
  });

  $('accClearSessionBtn').addEventListener('click', async (ev) => {
    const profileId = $('accProfileId').value.trim();
    const ok = await confirmDialog({
      title: `清除沙箱「${profileId}」登录态`,
      message: '将关闭该账号的独立窗口并清空其本地 Cookie 与缓存，下次打开需重新登录。',
      confirmText: '确认清除',
      danger: true,
    });
    if (!ok) return;
    await withButtonLoading(ev.currentTarget, async () => {
      try {
        await invokeCmd('clear_account_session', { profileId });
        showToast(`已清空沙箱「${profileId}」登录态`);
        await loadAssets(appState);
      } catch (err) {
        showToast(err.message, true);
      }
    });
  });

  $('natSaveBtn').addEventListener('click', (ev) => withButtonLoading(ev.currentTarget, async () => {
    const name = $('natName').value.trim();
    if (!name) return showToast('请填写 NAT 节点名称', true);
    const list = [...(appState.localConfig?.natNodes || [])];
    const existing = editingNatId ? list.find((n) => n.id === editingNatId) : null;
    const nextNat = {
      id: editingNatId || `nat_${Date.now().toString(36)}`,
      name,
      region: $('natRegion').value,
      plan: $('natPlan').value.trim(),
      providerProfileId: $('natProfileId').value.trim() || 'nat_main',
      portalUrl: $('natPortalUrl').value.trim() || DEFAULT_NAT_PORTAL_URL,
      publicIp: $('natPublicIp').value.trim(),
      servicePort: Number($('natServicePort').value) || 0,
      monthlyQuotaGB: Number($('natQuota').value) || 100,
      billingCycle: existing?.billingCycle || 'monthly',
      priceCny: Number($('natPrice').value) || 0,
      expiresAt: $('natExpires').value.trim(),
      autoRenew: $('natAutoRenew').value === 'true',
      shareLink: $('natShareLink').value.trim(),
      sshPort: Number($('natSshPort').value) || 0,
      sshUser: existing?.sshUser || 'root',
      sshKeyPath: existing?.sshKeyPath || '',
      singboxConfigPath: $('natSbCfgPath').value.trim() || DEFAULT_NAT_SINGBOX_CONFIG,
      realityPublicKey: existing?.realityPublicKey || '',
      trafficSnapshot: existing?.trafficSnapshot || null,
      notes: $('natNotes').value.trim(),
    };
    const idx = list.findIndex((n) => n.id === nextNat.id);
    if (idx >= 0) list[idx] = nextNat;
    else list.push(nextNat);

    try {
      const res = await invokeCmd('save_nat_nodes', { nodes: list });
      appState.localConfig.natNodes = res.natNodes;
      closeModal('natEditModal');
      showToast(`已保存 NAT「${name}」`);
      onNodesChanged();
      await loadAssets(appState);
    } catch (err) {
      showToast(err.message, true);
    }
  }));

  $('natDeleteBtn').addEventListener('click', async (ev) => {
    if (!editingNatId) return;
    const ok = await confirmDialog({
      title: '删除此 NAT 节点',
      message: '确认从 NodeDeck 移除该 NAT 卡片？（不会销毁服务器上的真实实例）',
      confirmText: '确认删除',
      danger: true,
    });
    if (!ok) return;
    await withButtonLoading(ev.currentTarget, async () => {
      try {
        const list = (appState.localConfig?.natNodes || []).filter((n) => n.id !== editingNatId);
        const res = await invokeCmd('save_nat_nodes', { nodes: list });
        appState.localConfig.natNodes = res.natNodes;
        closeModal('natEditModal');
        showToast('已删除 NAT 节点');
        onNodesChanged(editingNatId);
        await loadAssets(appState);
      } catch (err) {
        showToast(err.message, true);
      }
    });
  });

  $('pingAllNatBtn').addEventListener('click', (ev) => withButtonLoading(ev.currentTarget, async () => {
    const nats = (appState.localConfig?.natNodes || []).filter((n) => n.publicIp && n.servicePort);
    if (!nats.length) {
      showToast('请先为 NAT 节点补全公网 IP 与映射端口', true);
      return;
    }
    await Promise.all(nats.map(async (nat) => {
      try {
        const res = await invokeCmd('tcp_ping_host', { host: nat.publicIp, port: Number(nat.servicePort) });
        if (!appState.natPingHist[nat.id]) appState.natPingHist[nat.id] = { times: [], values: [], last: null };
        appState.natPingHist[nat.id].last = res;
      } catch {
        // 忽略单个超时
      }
    }));
    renderAssetsPage(appState);
    showToast('全部 NAT 端口测速完成');
  }));

  $('providerAccountsGrid').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-action]');
    if (!btn) return;
    const acc = (appState.localConfig?.providerAccounts || []).find((a) => a.id === btn.dataset.id);
    if (!acc) return;

    if (btn.dataset.action === 'acc-open-isolated') {
      await withButtonLoading(btn, async () => {
        try {
          await invokeCmd('open_account_window', {
            profileId: acc.profileId,
            title: `${acc.name} · 独立隔离窗口`,
            url: acc.portalUrl,
          });
          setTimeout(() => loadAssets(appState), 900);
        } catch (err) {
          showToast(err.message, true);
        }
      });
    } else if (btn.dataset.action === 'acc-open-browser') {
      await openExternal(acc.renewUrl || acc.portalUrl);
    } else if (btn.dataset.action === 'acc-scrape-traffic') {
      await withButtonLoading(btn, async () => {
        try {
          const res = await invokeCmd('sync_dashboard_traffic', { targetKind: 'account', targetId: acc.id });
          if (res.needsWindowReady) {
            showToast(res.message);
            setTimeout(() => loadAssets(appState), 900);
            return;
          }
          if (res.config) appState.localConfig = res.config;
          renderAssetsPage(appState);
          showToast(`已从仪表盘识别「${acc.name}」：${res.snapshot.usedText} / ${res.snapshot.totalText}`);
        } catch (err) {
          showToast(err.message, true);
        }
      });
    } else if (btn.dataset.action === 'acc-sync-sub') {
      await withButtonLoading(btn, async () => {
        try {
          const res = await invokeCmd('sync_subscription_traffic', { accountId: acc.id });
          if (res.config) appState.localConfig = res.config;
          renderAssetsPage(appState);
          showToast(`已单次拉取「${acc.name}」流量：${res.snapshot.usedText} / ${res.snapshot.totalText}${res.viaProxy ? '（经本机代理）' : ''}`);
        } catch (err) {
          showToast(err.message, true);
        }
      });
    } else if (btn.dataset.action === 'acc-edit') {
      openAccountEditor(appState, acc.id);
    }
  });

  $('assetsNatGrid').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-action]');
    if (!btn) return;
    const nat = (appState.localConfig?.natNodes || []).find((n) => n.id === btn.dataset.id);
    if (!nat) return;

    if (btn.dataset.action === 'nat-goto-monitor') {
      switchToNode(nat.id, 'overview');
    } else if (btn.dataset.action === 'nat-sync-traffic') {
      await withButtonLoading(btn, async () => {
        try {
          if (nat.sshPort > 0 && nat.publicIp) {
            const exitStatus = await invokeCmd('get_nat_exit_status', { nodeId: nat.id });
            if (exitStatus.kind === 'global' && exitStatus.totalBytes > 0) {
              const cfgRes = await invokeCmd('get_config');
              if (cfgRes.config) appState.localConfig = cfgRes.config;
              renderAssetsPage(appState);
              showToast(`已读取「${nat.name}」宿主机官方计费：${exitStatus.billedText} / ${exitStatus.totalText}`);
              return;
            }
          }
          const res = await invokeCmd('sync_dashboard_traffic', { targetKind: 'nat', targetId: nat.id });
          if (res.needsWindowReady) {
            showToast(res.message);
            return;
          }
          if (res.config) appState.localConfig = res.config;
          renderAssetsPage(appState);
          showToast(`已识别「${nat.name}」官方流量：${res.snapshot.usedText} / ${res.snapshot.totalText}`);
        } catch (err) {
          showToast(err.message, true);
        }
      });
    } else if (btn.dataset.action === 'nat-open-portal') {
      await withButtonLoading(btn, async () => {
        try {
          await invokeCmd('open_account_window', {
            profileId: nat.providerProfileId || 'nat_main',
            title: `${nat.name} · NAT 控制台`,
            url: nat.portalUrl || DEFAULT_NAT_PORTAL_URL,
          });
        } catch (err) {
          showToast(err.message, true);
        }
      });
    } else if (btn.dataset.action === 'nat-edit') {
      openNatEditor(appState, nat.id);
    }
  });
}
