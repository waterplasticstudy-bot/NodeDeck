/**
 * 全节点用户归属矩阵 + 当前节点精细用户管理（统一支持主 VPS + 全部 Alpine NAT）
 */

import { closeModal, confirmDialog, openModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import {
  DEFAULT_DIALER_PROXY,
  DEFAULT_NAT_PORTAL_URL,
  MAIN_VPS_NODE_ID,
  MEMBER_COLORS,
  POST_MUTATION_REFRESH_MS,
} from '../constants/ui-constants.js';
import { copyToClipboard, invokeCmd, withButtonLoading } from '../utils/bridge.js';
import {
  buildAllPlatformYaml,
  buildBettboxUniversalJs,
  buildCloudLandingSnippet,
  downloadTextFile,
} from '../utils/client-export.js';
import {
  buildMihomoYaml,
  buildStandardNodeLink,
  countryFlag,
  esc,
  fmtBytes,
  randomHex,
  randomSs2022Key,
  randomUuidV4,
} from '../utils/format.js';
import { getActiveNatNode } from './nat-overview.js';

const $ = (id) => document.getElementById(id);

let activeUserModalCtx = null;
let activeExportCtx = null;
let vpsUsersCache = null;

function buildExportOutput(ctx) {
  const format = $('exportFormatSelect').value;
  const devicePreset = $('exportDevicePreset').value;
  const includeOpsChannel = $('exportIncludeOps').checked;
  const frontSubUrl = $('exportFrontSubUrl').value.trim();
  const cloudLandingUrl = $('exportCloudLandingUrl').value.trim();
  const excludeGecko = $('exportExcludeGecko').checked;

  const isYaml = format === 'all_platform_yaml';
  const isNatSnippet = format === 'nat_provider_yaml';
  $('exportDeviceWrap').classList.toggle('hidden', isNatSnippet);
  $('exportOpsWrap').classList.toggle('hidden', isNatSnippet);
  $('exportYamlOptsWrap').classList.toggle('hidden', !isYaml);

  const safeUser = String(ctx.username || 'member').replace(/[^a-zA-Z0-9_\u4e00-\u9fa5-]/g, '_');
  if (isNatSnippet) {
    return {
      filename: `nat-landing-${safeUser}.yaml`,
      content: buildCloudLandingSnippet(ctx),
    };
  }
  if (isYaml) {
    return {
      filename: `nodedeck-all-platform-${safeUser}.yaml`,
      content: buildAllPlatformYaml(ctx, {
        devicePreset,
        includeOpsChannel,
        frontSubUrl,
        cloudLandingUrl,
        excludeGecko,
      }),
    };
  }
  return {
    filename: `nodedeck-v4.3-${safeUser}-${devicePreset}.js`,
    content: buildBettboxUniversalJs(ctx, { devicePreset, includeOpsChannel }),
  };
}

function refreshExportPreview() {
  if (!activeExportCtx) return;
  const { content } = buildExportOutput(activeExportCtx);
  $('exportPreviewCode').textContent = content;
}

function openClientExportModal(ctx) {
  activeExportCtx = ctx;
  const proto = String(ctx.proto || 'vless').toUpperCase();
  $('exportModalTitle').textContent = `⚙️ 导出「${ctx.username || ctx.nodeName}」客户端配置`;
  $('exportModalSub').textContent = `节点：${ctx.nodeName || '--'} · ${proto} :${ctx.port || '--'}（纯本机离线拼装，零网络上传）`;
  $('exportFormatSelect').value = proto === 'SOCKS' || proto === 'SOCKS5' ? 'nat_provider_yaml' : 'bettbox_js';
  $('exportDevicePreset').value = 'universal';
  $('exportIncludeOps').checked = String(ctx.username || '').toLowerCase() === 'me';
  $('exportFrontSubUrl').value = '';
  $('exportCloudLandingUrl').value = '';
  $('exportExcludeGecko').checked = true;
  refreshExportPreview();
  openModal('clientExportModal');
}

function openNodeUserModal(ctx) {
  activeUserModalCtx = ctx;
  const isVless = ctx.proto === 'vless';
  const isSS = ctx.proto === 'shadowsocks';
  const isEdit = Boolean(ctx.origName || ctx.vpsUuid);

  $('nodeUserModalTitle').textContent = isEdit
    ? `编辑用户「${ctx.origName || ctx.username}」`
    : `新增用户 · ${ctx.nodeName} [${ctx.tag}]`;
  $('nodeUserModalSub').textContent = `节点：${ctx.nodeName} · 协议：${ctx.proto.toUpperCase()} :${ctx.port}（修改后自动备份并平滑重启）`;
  $('nodeUserNameWrap').classList.toggle('hidden', isSS);
  $('nodeUserNameInput').value = ctx.username || '';
  $('nodeUserPassInput').value = ctx.password || '';
  $('nodeUserPassLabel').textContent = isVless
    ? 'UUID（留空保留原值或自动生成 UUIDv4）'
    : isSS
      ? 'Shadowsocks-2022 密钥（留空自动生成）'
      : '访问密码（留空保留原值或自动生成 24 位强密码）';

  openModal('nodeUserModal');
  if (!isSS) $('nodeUserNameInput').focus();
}

function renderMatrixView(appState) {
  const nodes = appState.allNodesUsers || [];
  const kw = $('matrixUserSearch').value.trim().toLowerCase();
  const nodeFilter = $('matrixNodeFilter').value;

  const sel = $('matrixNodeFilter');
  const prevVal = sel.value;
  sel.innerHTML = '<option value="">全部节点 (VPS + NAT)</option>' + nodes.map((n) => (
    `<option value="${esc(n.nodeId)}">${countryFlag(n.region)} ${esc(n.name)} (${n.nodeKind === 'vps' ? '主 VPS' : 'NAT'})</option>`
  )).join('');
  if (nodes.some((n) => n.nodeId === prevVal)) sel.value = prevVal;

  let totalUsers = 0;
  let visibleNodes = 0;

  const cardsHtml = nodes
    .filter((n) => !nodeFilter || n.nodeId === nodeFilter)
    .map((n) => {
      const flag = countryFlag(n.region);
      if (!n.ok) {
        visibleNodes += 1;
        return `
          <div class="card mb-md">
            <div class="card-head">
              <div class="row-inline">
                <strong class="user-name-lg">${flag} ${esc(n.name)}</strong>
                <span class="pill gray">${n.nodeKind === 'vps' ? '主 VPS' : '家宽 NAT'}</span>
              </div>
              <span class="pill orange">未就绪</span>
            </div>
            <div class="notice-box">${esc(n.error || '无法读取该节点配置')}</div>
          </div>
        `;
      }

      const rows = [];
      for (const inb of n.inbounds || []) {
        const proto = String(inb.type || '').toLowerCase();
        const details = Array.isArray(inb.usersDetail) ? inb.usersDetail : [];
        for (const u of details) {
          const uname = u.name || u.username || inb.tag;
          const cred = proto === 'vless' ? (u.uuid || '') : (u.password || inb.password || '');
          const searchStr = `${n.name} ${inb.tag} ${proto} ${inb.listenPort} ${uname}`.toLowerCase();
          if (kw && !searchStr.includes(kw)) continue;
          totalUsers += 1;
          rows.push({ inb, proto, u, uname, cred });
        }
      }

      if (kw && !rows.length) return '';
      visibleNodes += 1;
      const firstInb = (n.inbounds || [])[0];

      return `
        <div class="card mb-md">
          <div class="card-head">
            <div>
              <div class="row-inline">
                <strong class="user-name-lg">${flag} ${esc(n.name)}</strong>
                <span class="pill ${n.nodeKind === 'vps' ? 'blue' : 'purple'}">${n.nodeKind === 'vps' ? '主 VPS' : '家宽 NAT'}</span>
                <span class="pill gray mono">${esc(n.host || '--')}</span>
              </div>
              <div class="sub-note mt-xs">共 ${(n.inbounds || []).length} 个入站 · 匹配 ${rows.length} 条使用用户</div>
            </div>
            <div class="toolbar">
              ${firstInb && firstInb.type !== 'shadowsocks'
                ? `<button class="btn sm primary" data-action="mx-add" data-node="${esc(n.nodeId)}" data-tag="${esc(firstInb.tag)}">＋ 加用户</button>`
                : ''}
              <button class="btn sm" data-action="mx-goto-node" data-node="${esc(n.nodeId)}">🧩 节点协议</button>
            </div>
          </div>

          <div class="ios-list">
            ${rows.map((r) => `
              <div class="matrix-user-row">
                <div>
                  <div class="row-inline">
                    <strong>${esc(r.uname)}</strong>
                    <span class="pill blue xs">${esc(r.proto.toUpperCase())} :${esc(r.inb.listenPort)}</span>
                    <span class="pill gray xs mono">${esc(r.inb.tag)}</span>
                  </div>
                  <div class="matrix-cred-line mono">凭证：${esc(r.cred ? `${r.cred.slice(0, 12)}••••` : '(无密码)')}</div>
                </div>
                <div class="toolbar">
                  <button class="btn sm" data-action="mx-edit" data-node="${esc(n.nodeId)}" data-tag="${esc(r.inb.tag)}" data-user="${esc(r.uname)}">✏️ 改名/密码</button>
                  <button class="btn sm" data-action="mx-copy-link" data-node="${esc(n.nodeId)}" data-tag="${esc(r.inb.tag)}" data-user="${esc(r.uname)}">📋 链接</button>
                  <button class="btn sm" data-action="mx-copy-yaml" data-node="${esc(n.nodeId)}" data-tag="${esc(r.inb.tag)}" data-user="${esc(r.uname)}">📋 YAML</button>
                  <button class="btn sm primary" data-action="mx-export" data-node="${esc(n.nodeId)}" data-tag="${esc(r.inb.tag)}" data-user="${esc(r.uname)}">⚙️ 导出配置</button>
                  ${r.proto !== 'shadowsocks'
                    ? `<button class="btn sm danger" data-action="mx-del" data-node="${esc(n.nodeId)}" data-tag="${esc(r.inb.tag)}" data-user="${esc(r.uname)}">移除</button>`
                    : ''}
                </div>
              </div>
            `).join('') || '<div class="ios-row"><span class="sub-note">该节点暂无匹配用户</span></div>'}
          </div>
        </div>
      `;
    })
    .filter(Boolean)
    .join('');

  $('allNodesUsersGrid').innerHTML = cardsHtml || `
    <div class="card empty-state-box">
      <div class="empty-state-icon">👥</div>
      <div class="sub-note">暂无已配置的节点或匹配用户。请先在「本机与节点配置」绑定主 VPS，或在「续费与多账号」中添加 NAT 实例。</div>
    </div>
  `;
  $('matrixSummaryText').textContent = `已汇总 ${visibleNodes} 台节点 · 共 ${totalUsers} 条用户归属记录`;
  $('navUserBadge').textContent = String(totalUsers);
}

async function loadMatrixUsers(appState) {
  $('matrixSummaryText').textContent = '正在并发拉取全部纳管节点的用户清单...';
  try {
    const res = await invokeCmd('get_all_nodes_users');
    appState.allNodesUsers = res.nodes || [];
    renderMatrixView(appState);
  } catch (err) {
    $('matrixSummaryText').textContent = `拉取失败：${err.message}`;
    showToast(err.message, true);
  }
}

async function loadCurrentNatUsers(appState, node) {
  const flag = countryFlag(node.region);
  const pane = $('natUsersPane');
  if (!node.sshPort || !node.publicIp) {
    pane.innerHTML = `
      <div class="card empty-state-box">
        <div class="empty-state-icon">👥</div>
        <h3 class="card-title-lg mb-sm">${flag} ${esc(node.name)} · 用户与凭证管理</h3>
        <p class="sub-note empty-state-desc">
          该 NAT 节点尚未配置公网 SSH 映射端口。填入 SSH 端口后即可在面板内直接查看、增删和修改该机所有使用用户与密码。
        </p>
        <div class="toolbar toolbar-center">
          <button class="btn primary" data-action="users-nat-web">🖥️ 打开官方 Web 终端</button>
          <button class="btn" data-action="users-goto-vps">🖥️ 切回主 VPS</button>
        </div>
      </div>
    `;
    return;
  }

  pane.innerHTML = '<div class="card"><div class="sub-note">正在读取该 NAT 节点的用户与凭证清单...</div></div>';
  try {
    const data = await invokeCmd('get_nat_alpine_config', { nodeId: node.id });
    const inbs = data.inbounds || [];
    pane.innerHTML = inbs.map((inb) => {
      const proto = String(inb.type || '').toLowerCase();
      const users = inb.usersDetail || [];
      return `
        <div class="card mb-md">
          <div class="card-head">
            <div>
              <h3 class="card-title-lg">${flag} ${esc(node.name)} · ${esc(inb.tag)} (${esc(proto.toUpperCase())} :${esc(inb.listenPort)})</h3>
              <div class="sub-note">共 ${users.length} 个使用用户 · 支持原地改名、改密码与一键复制 Mihomo YAML</div>
            </div>
            ${proto !== 'shadowsocks'
              ? `<button class="btn sm primary" data-action="nat-u-add" data-tag="${esc(inb.tag)}" data-proto="${esc(proto)}" data-port="${esc(inb.listenPort)}">＋ 新增用户</button>`
              : ''}
          </div>
          <div class="ios-list">
            ${users.map((u) => {
              const uname = u.username || u.name || inb.tag;
              const cred = proto === 'vless' ? (u.uuid || '') : (u.password || inb.password || '');
              return `
                <div class="matrix-user-row">
                  <div>
                    <div class="row-inline"><strong>${esc(uname)}</strong><span class="pill green xs">启用中</span></div>
                    <div class="matrix-cred-line mono">凭证：${esc(cred)}</div>
                  </div>
                  <div class="toolbar">
                    <button class="btn sm" data-action="nat-u-edit" data-tag="${esc(inb.tag)}" data-proto="${esc(proto)}" data-port="${esc(inb.listenPort)}" data-user="${esc(uname)}" data-cred="${esc(cred)}">✏️ 改名/密码</button>
                    <button class="btn sm" data-action="nat-u-link" data-tag="${esc(inb.tag)}" data-user="${esc(uname)}">📋 链接</button>
                    <button class="btn sm" data-action="nat-u-yaml" data-tag="${esc(inb.tag)}" data-user="${esc(uname)}">📋 YAML</button>
                    <button class="btn sm primary" data-action="nat-u-export" data-tag="${esc(inb.tag)}" data-user="${esc(uname)}">⚙️ 导出配置</button>
                    ${proto !== 'shadowsocks'
                      ? `<button class="btn sm danger" data-action="nat-u-del" data-tag="${esc(inb.tag)}" data-user="${esc(uname)}">移除</button>`
                      : ''}
                  </div>
                </div>
              `;
            }).join('') || '<div class="ios-row"><span class="sub-note">暂无用户</span></div>'}
          </div>
        </div>
      `;
    }).join('') || '<div class="card"><div class="sub-note">当前 NAT 暂无入站节点</div></div>';
    pane.dataset.cfgJson = JSON.stringify({ host: data.host, publicKey: data.publicKey, name: node.name, inbounds: inbs });
  } catch (err) {
    pane.innerHTML = `<div class="card"><div class="notice-box">读取 NAT 用户失败：${esc(err.message)}</div></div>`;
  }
}

async function loadCurrentVpsUsers(appState) {
  try {
    const [res, aud] = await Promise.all([
      invokeCmd('get_users'),
      invokeCmd('get_audit').catch(() => null),
    ]);
    vpsUsersCache = res;
    const liveMap = aud?.data?.userSummary || {};
    appState.antiChinaEnabled = Boolean(res.antiChinaEnabled);

    const antiBtn = $('toggleAntiChinaBtn');
    antiBtn.textContent = appState.antiChinaEnabled ? '🛡️ 防定位拦截：已开启' : '🛡️ 防定位拦截：未开启';
    antiBtn.className = `btn ${appState.antiChinaEnabled ? 'success' : ''}`;
    $('usersMetaLine').textContent = `监听端口 :${res.listenPort} · SNI ${res.sni} · ShortID ${res.shortId} · 活跃 ${res.activeUsers.length} 人 / 已暂停 ${res.disabledUsers.length} 人`;

    const pseudoInb = {
      type: 'vless',
      tag: 'vless-in',
      listenPort: res.listenPort,
      sni: res.sni,
      shortId: res.shortId,
    };
    const vpsHost = appState.localConfig?.host || '';
    const vpsPbk = appState.localConfig?.realityPublicKey || '';
    const vpsName = appState.localConfig?.name || 'Primary VPS';
    const dialer = appState.localConfig?.dialerProxy || DEFAULT_DIALER_PROXY;

    $('activeUsersGrid').innerHTML = res.activeUsers.map((u, idx) => {
      const lm = liveMap[u.name] || { activeConnections: 0, upload: 0, download: 0, sourceIPs: [] };
      const online = lm.activeConnections > 0;
      const yaml = buildMihomoYaml(pseudoInb, vpsHost, vpsPbk, vpsName, u, dialer);
      return `
        <div class="user-card">
          <div class="flex-between">
            <span class="row-inline user-name-lg">
              <span class="color-dot" style="background:${MEMBER_COLORS[idx % MEMBER_COLORS.length]}"></span>
              ${esc(u.name || '未命名')}
            </span>
            ${online ? `<span class="pill green num">● 在线 ${lm.activeConnections}</span>` : '<span class="pill gray">空闲</span>'}
          </div>
          <div class="uuid-box mono">${esc(u.uuid)}</div>
          <div class="sub-note num">活跃流量 ↑${fmtBytes(lm.upload)} / ↓${fmtBytes(lm.download)} · 来源 IP ${lm.sourceIPs.length} 个</div>
          <div class="toolbar mt-xs">
            <button class="btn sm primary" data-action="copy-vless" data-link="${esc(u.vlessLink)}" data-name="${esc(u.name)}">📋 链接</button>
            <button class="btn sm" data-action="copy-yaml" data-yaml="${esc(yaml)}" data-name="${esc(u.name)}">📋 YAML</button>
            <button class="btn sm" data-action="export-vps-u" data-uuid="${esc(u.uuid)}" data-name="${esc(u.name)}">⚙️ 导出配置</button>
            <button class="btn sm" data-action="edit-vps-u" data-uuid="${esc(u.uuid)}" data-name="${esc(u.name)}">✏️ 改名/UUID</button>
            <button class="btn sm" data-action="pause-user" data-uuid="${esc(u.uuid)}" data-name="${esc(u.name)}">暂停</button>
            <button class="btn sm danger" data-action="delete-user" data-uuid="${esc(u.uuid)}" data-name="${esc(u.name)}">删除</button>
          </div>
        </div>
      `;
    }).join('') || '<div class="sub-note">暂无活跃成员</div>';

    $('disabledUsersGrid').innerHTML = res.disabledUsers.map((u) => `
      <div class="user-card paused">
        <div class="flex-between">
          <strong class="user-name-lg">${esc(u.name || '未命名')}</strong>
          <span class="pill orange">已暂停</span>
        </div>
        <div class="uuid-box mono">${esc(u.uuid)}</div>
        <div class="sub-note">暂停于 ${esc(u.disabledAt || '--')}</div>
        <div class="toolbar">
          <button class="btn sm success" data-action="resume-user" data-uuid="${esc(u.uuid)}" data-name="${esc(u.name)}">恢复使用</button>
          <button class="btn sm danger" data-action="delete-user" data-uuid="${esc(u.uuid)}" data-name="${esc(u.name)}">彻底删除</button>
        </div>
      </div>
    `).join('') || '<div class="sub-note">暂无已暂停成员</div>';
  } catch (err) {
    showToast(err.message, true);
  }
}

export async function loadUsers(appState) {
  const mode = appState.usersViewMode || 'matrix';
  document.querySelectorAll('#usersViewSeg button').forEach((b) => {
    b.classList.toggle('active', b.dataset.uv === mode);
  });

  if (mode === 'matrix') {
    $('allNodesUsersPane').classList.remove('hidden');
    $('vpsUsersPane').classList.add('hidden');
    $('natUsersPane').classList.add('hidden');
    await loadMatrixUsers(appState);
    return;
  }

  $('allNodesUsersPane').classList.add('hidden');
  const isVps = !appState || appState.activeNodeId === MAIN_VPS_NODE_ID;
  $('vpsUsersPane').classList.toggle('hidden', !isVps);
  $('natUsersPane').classList.toggle('hidden', isVps);

  if (isVps) {
    await loadCurrentVpsUsers(appState);
  } else {
    const node = getActiveNatNode(appState);
    if (node) await loadCurrentNatUsers(appState, node);
  }
}

function findMatrixEntry(appState, nodeId, tag, uname) {
  const node = (appState.allNodesUsers || []).find((n) => n.nodeId === nodeId);
  const inb = (node?.inbounds || []).find((i) => i.tag === tag);
  const user = (inb?.usersDetail || []).find((u) => (u.name || u.username || inb.tag) === uname);
  return { node, inb, user };
}

export function initUsersEvents(appState, { reloadOverview, switchToNode }) {
  document.querySelectorAll('#usersViewSeg button').forEach((btn) => {
    btn.addEventListener('click', () => {
      appState.usersViewMode = btn.dataset.uv;
      loadUsers(appState);
    });
  });

  $('refreshMatrixBtn').addEventListener('click', (ev) => withButtonLoading(ev.currentTarget, () => loadUsers(appState)));
  $('matrixUserSearch').addEventListener('input', () => renderMatrixView(appState));
  $('matrixNodeFilter').addEventListener('change', () => renderMatrixView(appState));

  $('cancelNodeUserBtn').addEventListener('click', () => closeModal('nodeUserModal'));
  $('genNodeUserPassBtn').addEventListener('click', () => {
    if (!activeUserModalCtx) return;
    if (activeUserModalCtx.proto === 'vless') $('nodeUserPassInput').value = randomUuidV4();
    else if (activeUserModalCtx.proto === 'shadowsocks') $('nodeUserPassInput').value = randomSs2022Key();
    else $('nodeUserPassInput').value = randomHex(24);
  });

  $('saveNodeUserBtn').addEventListener('click', (ev) => withButtonLoading(ev.currentTarget, async () => {
    const ctx = activeUserModalCtx;
    if (!ctx) return;
    const username = $('nodeUserNameInput').value.trim();
    const password = $('nodeUserPassInput').value.trim();
    if (ctx.proto !== 'shadowsocks' && !username) {
      showToast('请输入用户名', true);
      return;
    }
    try {
      if (ctx.vpsUuid) {
        const res = await invokeCmd('edit_vps_user', {
          uuid: ctx.vpsUuid,
          name: username,
          newUuid: password && password !== ctx.vpsUuid ? password : null,
        });
        showToast(res.message);
      } else {
        const res = await invokeCmd('mutate_node_inbound', {
          nodeId: ctx.nodeId,
          payload: {
            op: 'upsert_user',
            tag: ctx.tag,
            origTag: null,
            proto: null,
            port: null,
            sni: null,
            method: null,
            username: username || ctx.tag,
            password: password || null,
            origName: ctx.origName || null,
          },
        });
        showToast(res.message);
      }
      closeModal('nodeUserModal');
      setTimeout(() => { loadUsers(appState); reloadOverview(); }, POST_MUTATION_REFRESH_MS);
    } catch (err) {
      showToast(err.message, true);
    }
  }));

  $('allNodesUsersGrid').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-action]');
    if (!btn) return;
    const { action, node: nodeId, tag, user: uname } = btn.dataset;
    const { node, inb, user } = findMatrixEntry(appState, nodeId, tag, uname);

    if (action === 'mx-goto-node') {
      switchToNode(nodeId, 'singbox');
      return;
    }
    if (action === 'mx-add' && node && inb) {
      openNodeUserModal({
        nodeId,
        nodeName: node.name,
        tag: inb.tag,
        proto: String(inb.type || '').toLowerCase(),
        port: inb.listenPort,
        username: '',
        password: '',
        origName: '',
      });
      return;
    }
    if (action === 'mx-edit' && node && inb) {
      const proto = String(inb.type || '').toLowerCase();
      openNodeUserModal({
        nodeId,
        nodeName: node.name,
        tag: inb.tag,
        proto,
        port: inb.listenPort,
        username: uname,
        password: proto === 'vless' ? (user?.uuid || '') : (user?.password || inb.password || ''),
        origName: uname,
      });
      return;
    }
    if (action === 'mx-export' && node && inb) {
      const proto = String(inb.type || '').toLowerCase();
      openClientExportModal({
        nodeName: node.name,
        host: node.host || '',
        proto,
        port: inb.listenPort,
        sni: inb.sni || '',
        shortId: inb.shortId || '',
        publicKey: node.publicKey || '',
        method: inb.method || '',
        username: uname,
        credential: proto === 'vless' ? (user?.uuid || '') : (user?.password || inb.password || ''),
        flow: user?.flow || 'xtls-rprx-vision',
        dialerProxy: appState.localConfig?.dialerProxy || DEFAULT_DIALER_PROXY,
      });
      return;
    }
    if ((action === 'mx-copy-link' || action === 'mx-copy-yaml') && node && inb) {
      const protoTag = String(inb.type || '').toUpperCase();
      const dialer = appState.localConfig?.dialerProxy || DEFAULT_DIALER_PROXY;
      const text = action === 'mx-copy-link'
        ? buildStandardNodeLink(inb, node.host || '', node.publicKey || '', node.name, user)
        : buildMihomoYaml(inb, node.host || '', node.publicKey || '', node.name, user, dialer);
      try {
        await copyToClipboard(text);
        showToast(action === 'mx-copy-link'
          ? `已按 ${protoTag} 协议复制「${node.name}-${uname}」分享链接`
          : `已按 ${protoTag} 协议复制「${node.name}-${uname}」Mihomo YAML`);
      } catch (err) {
        showToast(err.message, true);
      }
      return;
    }
    if (action === 'mx-del' && node && inb) {
      const ok = await confirmDialog({
        title: `移除用户「${uname}」`,
        message: `确认从 ${node.name} [${tag}] 移除用户「${uname}」？将自动备份配置并重启服务。`,
        confirmText: '确认移除',
        danger: true,
      });
      if (!ok) return;
      await withButtonLoading(btn, async () => {
        try {
          const res = await invokeCmd('mutate_node_inbound', {
            nodeId,
            payload: { op: 'delete_user', tag, username: uname, origTag: null, proto: null, port: null, sni: null, method: null, password: null, origName: null },
          });
          showToast(res.message);
          setTimeout(() => loadUsers(appState), POST_MUTATION_REFRESH_MS);
        } catch (err) {
          showToast(err.message, true);
        }
      });
    }
  });

  $('natUsersPane').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-action]');
    if (!btn) return;
    const act = btn.dataset.action;
    if (act === 'users-goto-vps') {
      switchToNode(MAIN_VPS_NODE_ID, 'users');
      return;
    }
    const node = getActiveNatNode(appState);
    if (!node) return;

    if (act === 'users-nat-web') {
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
      return;
    }
    if (act === 'nat-u-add') {
      openNodeUserModal({
        nodeId: node.id,
        nodeName: node.name,
        tag: btn.dataset.tag,
        proto: btn.dataset.proto,
        port: Number(btn.dataset.port),
        username: '',
        password: '',
        origName: '',
      });
      return;
    }
    if (act === 'nat-u-edit') {
      openNodeUserModal({
        nodeId: node.id,
        nodeName: node.name,
        tag: btn.dataset.tag,
        proto: btn.dataset.proto,
        port: Number(btn.dataset.port),
        username: btn.dataset.user,
        password: btn.dataset.cred,
        origName: btn.dataset.user,
      });
      return;
    }
    if (act === 'nat-u-export') {
      const snap = JSON.parse($('natUsersPane').dataset.cfgJson || '{}');
      const inb = (snap.inbounds || []).find((i) => i.tag === btn.dataset.tag);
      const u = (inb?.usersDetail || []).find((x) => (x.username || x.name || inb.tag) === btn.dataset.user);
      if (!inb) return;
      const proto = String(inb.type || '').toLowerCase();
      openClientExportModal({
        nodeName: snap.name || node.name,
        host: snap.host || '',
        proto,
        port: inb.listenPort,
        sni: inb.sni || '',
        shortId: inb.shortId || '',
        publicKey: snap.publicKey || '',
        method: inb.method || '',
        username: btn.dataset.user,
        credential: proto === 'vless' ? (u?.uuid || '') : (u?.password || inb.password || ''),
        flow: u?.flow || 'xtls-rprx-vision',
        dialerProxy: appState.localConfig?.dialerProxy || DEFAULT_DIALER_PROXY,
      });
      return;
    }
    if (act === 'nat-u-link' || act === 'nat-u-yaml') {
      const snap = JSON.parse($('natUsersPane').dataset.cfgJson || '{}');
      const inb = (snap.inbounds || []).find((i) => i.tag === btn.dataset.tag);
      const u = (inb?.usersDetail || []).find((x) => (x.username || x.name || inb.tag) === btn.dataset.user);
      if (!inb) return;
      const dialer = appState.localConfig?.dialerProxy || DEFAULT_DIALER_PROXY;
      const text = act === 'nat-u-link'
        ? buildStandardNodeLink(inb, snap.host || '', snap.publicKey || '', snap.name || node.name, u)
        : buildMihomoYaml(inb, snap.host || '', snap.publicKey || '', snap.name || node.name, u, dialer);
      try {
        await copyToClipboard(text);
        showToast(act === 'nat-u-link' ? '已复制标准节点链接' : '已复制 Mihomo / Clash 链式 YAML');
      } catch (err) {
        showToast(err.message, true);
      }
      return;
    }
    if (act === 'nat-u-del') {
      const { tag, user: uname } = btn.dataset;
      const ok = await confirmDialog({
        title: `移除用户「${uname}」`,
        message: `确认从 ${node.name} [${tag}] 移除用户「${uname}」？`,
        confirmText: '确认移除',
        danger: true,
      });
      if (!ok) return;
      await withButtonLoading(btn, async () => {
        try {
          const res = await invokeCmd('mutate_node_inbound', {
            nodeId: node.id,
            payload: { op: 'delete_user', tag, username: uname, origTag: null, proto: null, port: null, sni: null, method: null, password: null, origName: null },
          });
          showToast(res.message);
          setTimeout(() => loadUsers(appState), POST_MUTATION_REFRESH_MS);
        } catch (err) {
          showToast(err.message, true);
        }
      });
    }
  });

  $('openAddUserBtn').addEventListener('click', () => {
    $('newUserName').value = '';
    $('newUserUuid').value = '';
    openModal('addUserModal');
    $('newUserName').focus();
  });

  $('cancelAddUser').addEventListener('click', () => closeModal('addUserModal'));

  $('confirmAddUser').addEventListener('click', (ev) => withButtonLoading(ev.currentTarget, async () => {
    const name = $('newUserName').value.trim();
    const uuid = $('newUserUuid').value.trim();
    if (!name) {
      showToast('请输入成员昵称', true);
      return;
    }
    try {
      const res = await invokeCmd('add_user', { name, uuid: uuid || null });
      closeModal('addUserModal');
      showToast(res.message);
      setTimeout(() => { loadUsers(appState); reloadOverview(); }, POST_MUTATION_REFRESH_MS);
    } catch (err) {
      showToast(err.message, true);
    }
  }));

  $('toggleAntiChinaBtn').addEventListener('click', (ev) => withButtonLoading(ev.currentTarget, async () => {
    try {
      const res = await invokeCmd('toggle_antichina', { enable: !appState.antiChinaEnabled });
      showToast(res.message);
      setTimeout(() => { loadUsers(appState); reloadOverview(); }, POST_MUTATION_REFRESH_MS);
    } catch (err) {
      showToast(err.message, true);
    }
  }));

  async function handleCardClick(ev) {
    const btn = ev.target.closest('[data-action]');
    if (!btn) return;
    const { action, uuid, name, link, yaml } = btn.dataset;

    if (action === 'copy-vless') {
      try {
        await copyToClipboard(link);
        showToast(`已复制「${name}」标准节点分享链接`);
      } catch (err) {
        showToast(err.message, true);
      }
      return;
    }

    if (action === 'copy-yaml') {
      try {
        await copyToClipboard(yaml);
        showToast(`已复制「${name}」Mihomo / Clash 链式 YAML`);
      } catch (err) {
        showToast(err.message, true);
      }
      return;
    }

    if (action === 'export-vps-u') {
      openClientExportModal({
        nodeName: appState.localConfig?.name || 'Primary VPS',
        host: appState.localConfig?.host || '',
        proto: 'vless',
        port: vpsUsersCache?.listenPort || 8443,
        sni: vpsUsersCache?.sni || '',
        shortId: vpsUsersCache?.shortId || '',
        publicKey: appState.localConfig?.realityPublicKey || '',
        username: name,
        credential: uuid,
        flow: 'xtls-rprx-vision',
        dialerProxy: appState.localConfig?.dialerProxy || DEFAULT_DIALER_PROXY,
      });
      return;
    }

    if (action === 'edit-vps-u') {
      openNodeUserModal({
        vpsUuid: uuid,
        nodeId: MAIN_VPS_NODE_ID,
        nodeName: appState.localConfig?.name || '主 VPS',
        tag: 'vless-in',
        proto: 'vless',
        port: vpsUsersCache?.listenPort || 8443,
        username: name,
        password: uuid,
        origName: name,
      });
      return;
    }

    if (action === 'pause-user' || action === 'resume-user') {
      const enable = action === 'resume-user';
      const ok = await confirmDialog({
        title: enable ? `恢复成员「${name}」` : `暂停成员「${name}」`,
        message: enable
          ? '确认恢复该成员的 UUID 接入权限？恢复后约 1 秒生效。'
          : '确认暂停该成员？停用后立即断开并拒绝新连接，不影响其他成员。',
        confirmText: enable ? '确认恢复' : '确认暂停',
        danger: !enable,
      });
      if (!ok) return;
      await withButtonLoading(btn, async () => {
        try {
          const res = await invokeCmd('toggle_user', { uuid, enable });
          showToast(res.message);
          setTimeout(() => { loadUsers(appState); reloadOverview(); }, POST_MUTATION_REFRESH_MS);
        } catch (err) {
          showToast(err.message, true);
        }
      });
      return;
    }

    if (action === 'delete-user') {
      const ok = await confirmDialog({
        title: `彻底删除成员「${name}」`,
        message: '此操作会永久移除该成员 UUID 且无法自动找回，确认继续？',
        confirmText: '彻底删除',
        danger: true,
      });
      if (!ok) return;
      await withButtonLoading(btn, async () => {
        try {
          const res = await invokeCmd('delete_user', { uuid });
          showToast(res.message);
          setTimeout(() => { loadUsers(appState); reloadOverview(); }, POST_MUTATION_REFRESH_MS);
        } catch (err) {
          showToast(err.message, true);
        }
      });
    }
  }

  $('activeUsersGrid').addEventListener('click', handleCardClick);
  $('disabledUsersGrid').addEventListener('click', handleCardClick);

  $('closeExportConfigBtn').addEventListener('click', () => closeModal('clientExportModal'));
  ['exportFormatSelect', 'exportDevicePreset', 'exportIncludeOps', 'exportExcludeGecko'].forEach((id) => {
    $(id).addEventListener('change', refreshExportPreview);
  });
  ['exportFrontSubUrl', 'exportCloudLandingUrl'].forEach((id) => {
    $(id).addEventListener('input', refreshExportPreview);
  });
  $('copyExportConfigBtn').addEventListener('click', async () => {
    if (!activeExportCtx) return;
    try {
      const { content } = buildExportOutput(activeExportCtx);
      await copyToClipboard(content);
      showToast('已复制完整客户端配置到剪贴板');
    } catch (err) {
      showToast(err.message, true);
    }
  });
  $('downloadExportConfigBtn').addEventListener('click', () => {
    if (!activeExportCtx) return;
    const { filename, content } = buildExportOutput(activeExportCtx);
    downloadTextFile(filename, content);
    showToast(`已导出文件：${filename}`);
  });
}
