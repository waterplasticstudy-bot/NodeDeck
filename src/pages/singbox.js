/**
 * sing-box 四大主力协议入站增删改、路由规则与历史配置备份一键回滚（统一支持主 VPS + 全部 Alpine NAT）
 */

import { closeModal, confirmDialog, openModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import {
  DEFAULT_DIALER_PROXY,
  DEFAULT_NAT_PORTAL_URL,
  DEFAULT_NAT_SINGBOX_CONFIG,
  DEFAULT_SNI,
  INBOUND_PRESETS,
  MAIN_VPS_NODE_ID,
  POST_MUTATION_REFRESH_MS,
} from '../constants/ui-constants.js';
import { copyToClipboard, invokeCmd, withButtonLoading } from '../utils/bridge.js';
import {
  buildMihomoYaml,
  buildStandardNodeLink,
  countryFlag,
  describeSingboxRule,
  esc,
  randomHex,
  randomSs2022Key,
  randomUuidV4,
} from '../utils/format.js';
import { getActiveNatNode } from './nat-overview.js';

const $ = (id) => document.getElementById(id);

let currentSbData = null;
let editingInboundOrigTag = null;

function updateModalFieldsForProto(proto) {
  const isVless = proto === 'vless';
  const isSS = proto === 'shadowsocks';
  const isUserPass = proto === 'socks' || proto === 'http' || proto === 'mixed';
  $('newInbSniField').classList.toggle('hidden', !isVless);
  $('newInbUserField').classList.toggle('hidden', isSS);
  $('newInbPassField').classList.toggle('hidden', false);
  $('newInbUserLabel').textContent = isVless ? '首个成员名（修改现有 VLESS 时保留原成员）' : '首个使用用户名';
  $('newInbPassLabel').textContent = isVless
    ? 'UUID（留空自动生成标准 UUIDv4，修改现有 VLESS 时保留原成员）'
    : isSS
      ? 'Shadowsocks-2022 密钥（16 字节 Base64，留空自动生成）'
      : isUserPass
        ? '访问密码（留空自动生成 24 位强密码）'
        : '密码';
}

function openInboundModal(appState, inb = null) {
  const isVps = appState.activeNodeId === MAIN_VPS_NODE_ID;
  const nat = isVps ? null : getActiveNatNode(appState);
  editingInboundOrigTag = inb ? inb.tag : null;

  const defaultProto = inb ? inb.type : (isVps ? 'vless' : 'socks');
  const preset = INBOUND_PRESETS[defaultProto] || INBOUND_PRESETS.socks;

  $('inbModalTitle').textContent = inb
    ? `编辑节点「${inb.tag}」(${isVps ? '主 VPS' : nat?.name || 'NAT'})`
    : `新增入站节点 (${isVps ? '主 VPS' : nat?.name || 'NAT'})`;
  $('newInbProto').value = defaultProto;
  $('newInbProto').disabled = Boolean(inb && isVps && inb.isPrimary);
  $('newInbTag').value = inb ? inb.tag : preset.tag;
  $('newInbPort').value = String(inb ? inb.listenPort : (nat?.servicePort || preset.port));
  $('newInbSni').value = inb?.sni || preset.sni || DEFAULT_SNI;

  const firstUser = Array.isArray(inb?.usersDetail) && inb.usersDetail[0] ? inb.usersDetail[0] : null;
  $('newInbUser').value = firstUser ? (firstUser.username || firstUser.name || '') : (preset.username || 'user');
  $('newInbPass').value = inb
    ? (inb.type === 'shadowsocks' ? (inb.password || '') : (firstUser?.password || firstUser?.uuid || ''))
    : '';

  $('inbModalHint').innerHTML = isVps
    ? '⚠️ 每次保存自动创建历史备份并校验语法，修改端口会自动同步 UFW 规则（请同步检查云厂商网页安全组）。'
    : `⚠️ 每次保存自动创建历史备份并执行 <code>sing-box check</code>（含 <code>relay.json</code>）；NAT 仅公网已映射端口（如 :${nat?.servicePort || 25000}）可直接外连，新增其他端口需同步在服务商后台添加映射。`;

  updateModalFieldsForProto(defaultProto);
  openModal('addInbModal');
}

function renderSingboxData(appState, data, scopeMeta) {
  currentSbData = { ...data, scopeMeta };
  const inbs = data.inbounds || [];
  $('navInbBadge').textContent = String(inbs.length);

  $('sbScopeTitle').textContent = `${scopeMeta.flag} ${scopeMeta.name} · sing-box 入站节点管理`;
  $('sbScopeSub').innerHTML = scopeMeta.isVps
    ? '四大协议全支持 · 每次修改自动备份 → <code>sing-box check</code> → 自动同步 UFW → 平滑重启'
    : `Alpine 零 Python 原子变更 (${esc(scopeMeta.cfgPath)}) · 自动备份与回滚 · 支持一键复制 Mihomo YAML`;
  $('sbOpenNatTermBtn').classList.toggle('hidden', scopeMeta.isVps);
  $('sbJsonTitle').textContent = `完整配置只读检查（${scopeMeta.cfgPath}）`;

  const dnsServer = (data.dns?.servers || []).map((s) => `${s.type}${s.server ? `://${s.server}` : ''} (${s.tag || 'dns'})`).join(', ');
  $('sbDnsSub').textContent = `DNS：${dnsServer || '--'} · 策略：${data.dns?.strategy || 'default'} · 日志：${data.log?.level || 'default'}`;

  $('sbInboundsGrid').innerHTML = inbs.map((inb, idx) => {
    const proto = String(inb.type || '').toLowerCase();
    const isVless = proto === 'vless';
    const isSS = proto === 'shadowsocks';
    const isUserPass = proto === 'socks' || proto === 'http' || proto === 'mixed';
    const tone = isVless ? 'blue' : isSS ? 'orange' : 'purple';
    const firstUser = (inb.usersDetail || [])[0] || {};
    const canDelete = !(inbs.length <= 1 || (scopeMeta.isVps && inb.isPrimary));

    return `
      <div class="card">
        <div class="card-head">
          <div class="row-inline">
            <strong class="user-name-lg">${esc(inb.tag)}</strong>
            <span class="pill ${tone}">${esc(proto.toUpperCase())}</span>
            ${inb.isPrimary ? '<span class="pill green">主入口</span>' : '<span class="pill gray">扩展</span>'}
          </div>
          <span class="pill blue mono">:${esc(inb.listenPort)}</span>
        </div>
        <div class="ios-list mb-md">
          ${isVless ? `
            <div class="ios-row"><span class="ios-row-title">伪装域名 (SNI)</span><span class="mono">${esc(inb.sni || '--')}</span></div>
            <div class="ios-row"><span class="ios-row-title">ShortID</span><span class="mono">${esc(inb.shortId || '--')}</span></div>
            <div class="ios-row"><span class="ios-row-title">授权用户 (${inb.userCount}人)</span><span>${(inb.users || []).map((u) => `<span class="pill gray ml-xs">${esc(u)}</span>`).join('') || '--'}</span></div>
          ` : isSS ? `
            <div class="ios-row"><span class="ios-row-title">加密套件</span><span class="mono">${esc(inb.method || '--')}</span></div>
            <div class="ios-row"><span class="ios-row-title">访问密钥</span><span class="mono">${esc((inb.password || '').slice(0, 10))}••••</span></div>
          ` : isUserPass ? `
            <div class="ios-row"><span class="ios-row-title">使用用户 (${inb.userCount}人)</span><span>${(inb.users || []).map((u) => `<span class="pill blue ml-xs">${esc(u)}</span>`).join('') || '无鉴权'}</span></div>
            <div class="ios-row"><span class="ios-row-title">首个凭证</span><span class="mono">${esc(firstUser.username || '--')} / ${esc((firstUser.password || '').slice(0, 8))}••••</span></div>
          ` : `<div class="ios-row"><span class="ios-row-title">协议</span><span class="mono">${esc(proto)}</span></div>`}
        </div>
        <div class="toolbar">
          <button class="btn sm primary" data-action="edit-inb" data-idx="${idx}">✏️ 编辑协议/密码</button>
          <button class="btn sm" data-action="goto-users">👥 管理用户</button>
          <button class="btn sm" data-action="copy-link" data-idx="${idx}">📋 链接</button>
          <button class="btn sm" data-action="copy-yaml" data-idx="${idx}">📋 Mihomo YAML</button>
          ${canDelete
            ? `<button class="btn sm danger" data-action="del-inb" data-tag="${esc(inb.tag)}" data-port="${esc(inb.listenPort)}">🗑️</button>`
            : '<span class="sub-note">受保护</span>'}
        </div>
      </div>
    `;
  }).join('') || '<div class="sub-note">当前配置暂无入站节点</div>';

  $('sbRulesList').innerHTML = (data.rules || []).length
    ? data.rules.map((r, idx) => {
      const desc = describeSingboxRule(r);
      return `
        <div class="ios-row">
          <div>
            <div class="ios-row-title">${idx + 1}. ${esc(desc.title)}</div>
            <div class="ios-row-desc">${esc(desc.desc)}</div>
          </div>
          <span class="pill ${desc.tone}">生效中</span>
        </div>
      `;
    }).join('')
    : '<div class="ios-row"><span class="sub-note">当前采用默认直出规则 (final: direct)</span></div>';

  $('sbBackupsList').innerHTML = (data.backups || []).length
    ? data.backups.map((b) => `
        <div class="ios-row">
          <span class="mono">${esc(b)}</span>
          <button class="btn sm" data-action="restore-bak" data-backup="${esc(b)}">↺ 一键回滚</button>
        </div>
      `).join('')
    : '<div class="ios-row"><span class="sub-note">暂无历史备份（首次在面板修改后自动生成）</span></div>';

  $('sbRawJson').textContent = data.rawJson || '';
}

export async function loadSingboxConfig(appState) {
  const isVps = !appState || appState.activeNodeId === MAIN_VPS_NODE_ID;

  if (isVps) {
    $('natSingboxPane').classList.add('hidden');
    $('vpsSingboxPane').classList.remove('hidden');
    try {
      const { data } = await invokeCmd('get_singbox_config');
      renderSingboxData(appState, data, {
        isVps: true,
        nodeId: MAIN_VPS_NODE_ID,
        flag: '🖥️',
        name: appState.localConfig?.name || '主 VPS',
        cfgPath: '/etc/sing-box/config.json',
      });
    } catch (err) {
      showToast(err.message, true);
    }
    return;
  }

  const node = getActiveNatNode(appState);
  if (!node) return;
  const flag = countryFlag(node.region);

  if (!node.sshPort || !node.publicIp) {
    $('vpsSingboxPane').classList.add('hidden');
    $('natSingboxPane').classList.remove('hidden');
    $('natSingboxPane').innerHTML = `
      <div class="card empty-state-box">
        <div class="empty-state-icon">🧩</div>
        <h3 class="card-title-lg mb-sm">${flag} ${esc(node.name)} · sing-box 配置维护</h3>
        <p class="sub-note empty-state-desc">
          该 Alpine NAT 尚未配置公网 SSH 映射端口。填入 SSH 映射端口后即可在面板内直接修改协议/密码与自动备份回滚，或先打开官方 Web 终端操作 <code>${esc(node.singboxConfigPath || DEFAULT_NAT_SINGBOX_CONFIG)}</code>。
        </p>
        <div class="toolbar toolbar-center">
          <button class="btn primary" data-action="nat-sb-terminal">🖥️ 打开官方 Web 终端</button>
          <button class="btn" data-action="nat-sb-edit">⚙️ 配置 SSH 映射端口</button>
        </div>
      </div>
    `;
    return;
  }

  $('natSingboxPane').classList.add('hidden');
  $('vpsSingboxPane').classList.remove('hidden');
  $('sbRawJson').textContent = '正在经 Alpine SSH 读取 sing-box 配置与备份清单...';
  try {
    const data = await invokeCmd('get_nat_alpine_config', { nodeId: node.id });
    renderSingboxData(appState, data, {
      isVps: false,
      nodeId: node.id,
      flag,
      name: node.name,
      cfgPath: node.singboxConfigPath || DEFAULT_NAT_SINGBOX_CONFIG,
    });
  } catch (err) {
    showToast(err.message, true);
  }
}

export function initSingboxEvents(appState, { switchTab, reloadOverview, openNatEditor }) {
  $('natSingboxPane').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-action]');
    if (!btn) return;
    const node = getActiveNatNode(appState);
    if (!node) return;
    if (btn.dataset.action === 'nat-sb-terminal') {
      if (!node.portalUrl) return showToast('请先在节点配置中填写官方控制台 URL', true);
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
    } else if (btn.dataset.action === 'nat-sb-edit') {
      openNatEditor(node.id);
    }
  });

  $('sbOpenNatTermBtn').addEventListener('click', (ev) => withButtonLoading(ev.currentTarget, async () => {
    const node = getActiveNatNode(appState);
    if (!node || !node.portalUrl) return showToast('请先在节点配置中填写官方控制台 URL', true);
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

  $('openAddInbBtn').addEventListener('click', () => openInboundModal(appState, null));

  $('newInbProto').addEventListener('change', (ev) => {
    const proto = ev.target.value;
    updateModalFieldsForProto(proto);
    if (!editingInboundOrigTag) {
      const preset = INBOUND_PRESETS[proto] || INBOUND_PRESETS.socks;
      $('newInbTag').value = preset.tag;
      if (appState.activeNodeId === MAIN_VPS_NODE_ID) {
        $('newInbPort').value = String(preset.port);
      }
      if (preset.sni) $('newInbSni').value = preset.sni;
    }
  });

  $('genInbPassBtn').addEventListener('click', () => {
    const proto = $('newInbProto').value;
    if (proto === 'vless') $('newInbPass').value = randomUuidV4();
    else if (proto === 'shadowsocks') $('newInbPass').value = randomSs2022Key();
    else $('newInbPass').value = randomHex(24);
  });

  $('cancelAddInb').addEventListener('click', () => closeModal('addInbModal'));

  $('confirmAddInb').addEventListener('click', (ev) => withButtonLoading(ev.currentTarget, async () => {
    const proto = $('newInbProto').value;
    const tag = $('newInbTag').value.trim();
    const port = Number($('newInbPort').value);
    const sni = $('newInbSni').value.trim();
    const username = $('newInbUser').value.trim();
    const password = $('newInbPass').value.trim();
    if (!tag || !port) {
      showToast('请填写节点标识和监听端口', true);
      return;
    }
    try {
      const payload = {
        op: editingInboundOrigTag ? 'edit' : 'add',
        origTag: editingInboundOrigTag,
        proto,
        tag,
        port,
        sni: sni || null,
        method: null,
        username: username || null,
        password: password || null,
        origName: null,
      };
      const res = await invokeCmd('mutate_node_inbound', { nodeId: appState.activeNodeId, payload });
      closeModal('addInbModal');
      if (res.realityPublicKey && appState.activeNodeId !== MAIN_VPS_NODE_ID) {
        const node = getActiveNatNode(appState);
        if (node) node.realityPublicKey = res.realityPublicKey;
      }
      showToast(res.message || '节点保存成功');
      setTimeout(() => { loadSingboxConfig(appState); reloadOverview(); }, POST_MUTATION_REFRESH_MS);
    } catch (err) {
      showToast(err.message, true);
    }
  }));

  $('copySbJsonBtn').addEventListener('click', async () => {
    try {
      await copyToClipboard($('sbRawJson').textContent);
      showToast('已复制脱敏 config.json');
    } catch (err) {
      showToast(err.message, true);
    }
  });

  $('sbInboundsGrid').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-action]');
    if (!btn || !currentSbData) return;
    const act = btn.dataset.action;

    if (act === 'goto-users') {
      appState.usersViewMode = 'current';
      switchTab('users');
      return;
    }

    if (act === 'edit-inb') {
      const inb = (currentSbData.inbounds || [])[Number(btn.dataset.idx)];
      if (inb) openInboundModal(appState, inb);
      return;
    }

    if (act === 'copy-link' || act === 'copy-yaml') {
      const inb = (currentSbData.inbounds || [])[Number(btn.dataset.idx)];
      if (!inb) return;
      const host = currentSbData.host || '';
      const pbk = currentSbData.publicKey || '';
      const nodeName = currentSbData.scopeMeta?.name || '';
      const dialer = appState.localConfig?.dialerProxy || DEFAULT_DIALER_PROXY;
      const text = act === 'copy-link'
        ? buildStandardNodeLink(inb, host, pbk, nodeName)
        : buildMihomoYaml(inb, host, pbk, nodeName, null, dialer);
      const protoTag = String(inb.type || '').toUpperCase();
      try {
        await copyToClipboard(text);
        showToast(act === 'copy-link'
          ? `已复制 ${protoTag} 分享链接（${inb.tag}）`
          : `已复制 ${protoTag} Mihomo / Clash 链式 YAML`);
      } catch (err) {
        showToast(err.message, true);
      }
      return;
    }

    if (act === 'del-inb') {
      const { tag, port } = btn.dataset;
      const ok = await confirmDialog({
        title: `删除入站节点「${tag}」`,
        message: `确认删除端口 :${port} 入站节点？面板将自动备份并校验配置后重启服务。`,
        confirmText: '确认删除',
        danger: true,
      });
      if (!ok) return;
      await withButtonLoading(btn, async () => {
        try {
          const res = await invokeCmd('mutate_node_inbound', {
            nodeId: appState.activeNodeId,
            payload: { op: 'delete', tag, origTag: null, proto: null, port: null, sni: null, method: null, username: null, password: null, origName: null },
          });
          showToast(res.message);
          setTimeout(() => { loadSingboxConfig(appState); reloadOverview(); }, POST_MUTATION_REFRESH_MS);
        } catch (err) {
          showToast(err.message, true);
        }
      });
    }
  });

  $('sbBackupsList').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-action="restore-bak"]');
    if (!btn) return;
    const { backup } = btn.dataset;
    const isVps = appState.activeNodeId === MAIN_VPS_NODE_ID;
    const ok = await confirmDialog({
      title: '恢复历史备份配置',
      message: `确认将当前节点的 config.json 还原为 ${backup} 并重启 sing-box？`,
      confirmText: '确认还原',
      danger: true,
    });
    if (!ok) return;
    await withButtonLoading(btn, async () => {
      try {
        const res = isVps
          ? await invokeCmd('restore_singbox_backup', { backup })
          : await invokeCmd('restore_nat_alpine_backup', { nodeId: appState.activeNodeId, backup });
        showToast(res.message || '已还原历史备份');
        setTimeout(() => { loadSingboxConfig(appState); reloadOverview(); }, POST_MUTATION_REFRESH_MS);
      } catch (err) {
        showToast(err.message, true);
      }
    });
  });
}
