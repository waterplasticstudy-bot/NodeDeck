/**
 * 独立多节点离线客户端配置生成器弹窗（含本机常用方案预设管理、导出前校验、Rust 原生落盘与定位打开）
 */

import { DEFAULT_DIALER_PROXY } from '../constants/ui-constants.js';
import { copyToClipboard, invokeCmd, withButtonLoading } from '../utils/bridge.js';
import {
  APP_ROUTE_CATALOG,
  buildAllPlatformYaml,
  buildBettboxUniversalJs,
  createAppRouteFromPreset,
  DEFAULT_TEST_URL,
  EXPORT_REGIONS,
  inferRegionsFromCtxs,
  suggestExportFilename,
  validateExportDraft,
} from '../utils/client-export.js';
import { countryFlag, esc } from '../utils/format.js';
import { closeModal, confirmDialog, openModal } from './modal.js';
import { showToast } from './toast.js';

const $ = (id) => document.getElementById(id);
const EXPORT_SUB_STORAGE_KEY = 'nodedeck_last_front_sub_url';
const DEFAULT_APAC_REGIONS = ['HK', 'TW', 'JP', 'SG', 'KR'];

let exportCandidates = [];
let exportSelectedKeys = new Set();
let selectedExitRegions = new Set();
let selectedFrontRegions = new Set(DEFAULT_APAC_REGIONS);
let exportAppRoutes = [];
const expandedAppRouteIds = new Set();
let exportFilenameEdited = false;
let lastExportSavedPath = '';

/** 收集本地配置中全部受管节点公网 IP（主 VPS + NAT 节点） */
function collectAllManagedIps(appState) {
  const ips = [];
  const host = String(appState?.localConfig?.host || '').trim();
  if (host) ips.push(host);
  for (const n of appState?.localConfig?.natNodes || []) {
    const ip = String(n?.publicIp || '').trim();
    if (ip) ips.push(ip);
  }
  return Array.from(new Set(ips));
}

function renderRegionChips(boxId, activeSet) {
  const box = $(boxId);
  if (!box) return;
  box.innerHTML = EXPORT_REGIONS.map((r) => {
    const active = activeSet.has(r.code) ? ' active' : '';
    return `<button type="button" class="region-chip${active}" data-region-code="${esc(r.code)}">${r.flag} ${esc(r.label)}</button>`;
  }).join('');
}

function splitToCleanList(raw) {
  return String(raw || '')
    .split(/[\r\n,;，；]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function calcAppRouteRiskHits(route, selectedLandings) {
  const blocked = new Set(route.blockedRegions || []);
  if (!blocked.size) return [];
  const effective = new Set();
  if (route.targetMode === 'custom_group') {
    const boundKeys = new Set(route.landingKeys || []);
    for (const c of selectedLandings) {
      if (boundKeys.has(c.key)) {
        inferRegionsFromCtxs([c]).forEach((r) => effective.add(r));
      }
    }
    (route.fallbackRegions || []).forEach((r) => effective.add(r));
    if (!boundKeys.size && !(route.fallbackRegions || []).length) {
      inferRegionsFromCtxs(selectedLandings).forEach((r) => effective.add(r));
    }
  } else if (route.targetMode === 'exit') {
    inferRegionsFromCtxs(selectedLandings).forEach((r) => effective.add(r));
  } else if (route.targetMode === 'airport') {
    const frontMode = $('exportFrontRegionMode')?.value || 'apac';
    const regs = frontMode === 'all'
      ? EXPORT_REGIONS.map((r) => r.code)
      : frontMode === 'custom'
        ? [...selectedFrontRegions]
        : DEFAULT_APAC_REGIONS;
    regs.forEach((r) => effective.add(r));
  }
  return (route.blockedRegions || []).filter((r) => effective.has(r));
}

function renderAppCatalogBar() {
  const box = $('exportAppCatalogBar');
  if (!box) return;
  const activePresets = new Set(exportAppRoutes.map((r) => r.presetId).filter(Boolean));
  box.innerHTML = APP_ROUTE_CATALOG.map((item) => {
    const active = activePresets.has(item.id) ? ' active' : '';
    const title = item.note || item.name;
    return `<button type="button" class="region-chip${active}" data-app-preset="${esc(item.id)}" title="${esc(title)}">${esc(item.icon)} ${esc(item.name)}</button>`;
  }).join('');
}

function renderAppRoutesList() {
  const listEl = $('exportAppRoutesList');
  const countEl = $('exportAppRoutesCount');
  if (countEl) countEl.textContent = `${exportAppRoutes.length} 项`;
  if (!listEl) return;

  if (!exportAppRoutes.length) {
    listEl.innerHTML = '<div class="sub-note" style="padding:4px 2px;">暂未添加专属 APP 分流。例如：点击上方 <strong>🟡 Bybit</strong> 或 <strong>🟡 币安 Binance</strong>，可将其锁定到日本/韩国 NAT 或台湾/日韩节点，绝不误走美国节点触发风控。</div>';
    return;
  }

  const selectedLandings = getSelectedExportItems();
  listEl.innerHTML = exportAppRoutes.map((route) => {
    const riskHits = calcAppRouteRiskHits(route, selectedLandings);
    const hasBlockedSpec = (route.blockedRegions || []).length > 0;
    const blockedSet = new Set(route.blockedRegions || []);
    const isCustomGroup = (route.targetMode || 'custom_group') === 'custom_group';
    const isExpanded = expandedAppRouteIds.has(route.id);
    const ruleCnt = (route.domains || []).length + (route.keywords || []).length + (route.processes || []).length;
    const presetMeta = APP_ROUTE_CATALOG.find((p) => p.id === route.presetId);

    const riskBadge = riskHits.length
      ? `<span class="pill red xs">🚨 含禁区 ${esc(riskHits.join('/'))}</span>`
      : hasBlockedSpec
        ? '<span class="pill green xs">✅ 已避开禁区</span>'
        : '';

    const landingChipsHtml = selectedLandings.length
      ? selectedLandings.map((it) => {
        const bound = (route.landingKeys || []).includes(it.key);
        const regs = inferRegionsFromCtxs([it]);
        const isDanger = regs.some((r) => blockedSet.has(r));
        const cls = `app-bind-chip${bound ? ' active' : ''}${isDanger ? ' danger' : ''}`;
        const label = `${countryFlag(it.region)} ${it.nodeName}${selectedLandings.filter((x) => x.nodeName === it.nodeName).length > 1 ? ` · ${it.username}` : ''}`;
        return `<button type="button" class="${cls}" data-app-bind-landing="${esc(route.id)}" data-landing-key="${esc(it.key)}" title="${isDanger ? '该节点属于此 APP 风险禁区，请谨慎绑定' : '点击绑定/取消绑定此自建落地'}">${bound ? '✓ ' : ''}${esc(label)}</button>`;
      }).join('')
      : '<span class="sub-note">请先在上方 ① 勾选自建落地节点</span>';

    const regionChipsHtml = EXPORT_REGIONS.map((reg) => {
      const bound = (route.fallbackRegions || []).includes(reg.code);
      const isDanger = blockedSet.has(reg.code);
      const cls = `app-bind-chip${bound ? ' active' : ''}${isDanger ? ' danger' : ''}`;
      return `<button type="button" class="${cls}" data-app-bind-region="${esc(route.id)}" data-region-code="${esc(reg.code)}" title="${isDanger ? '风控禁区国家' : '叠加该地区机场备选节点'}">${reg.flag} ${esc(reg.label)}</button>`;
    }).join('');

    return `
      <div class="app-route-card${riskHits.length ? ' risk-alert' : ''}" data-app-route-id="${esc(route.id)}">
        <div class="app-route-head">
          <input class="input app-route-icon-in" data-app-field="icon" data-route-id="${esc(route.id)}" value="${esc(route.icon || '📱')}" maxlength="4" title="策略组图标" />
          <input class="input app-route-name-in" data-app-field="name" data-route-id="${esc(route.id)}" value="${esc(route.name || '')}" placeholder="APP 名称（如 Bybit）" />
          <select class="app-route-mode-sel" data-app-field="targetMode" data-route-id="${esc(route.id)}">
            <option value="custom_group"${route.targetMode === 'custom_group' ? ' selected' : ''}>🎯 独立策略组（自选节点/国家）</option>
            <option value="exit"${route.targetMode === 'exit' ? ' selected' : ''}>🛡️ 跟随「落地出口」</option>
            <option value="airport"${route.targetMode === 'airport' ? ' selected' : ''}>⚡ 走「机场直出」</option>
            <option value="direct"${route.targetMode === 'direct' ? ' selected' : ''}>🟢 DIRECT 直连</option>
            <option value="reject"${route.targetMode === 'reject' ? ' selected' : ''}>🔴 REJECT 拦截</option>
          </select>
          ${riskBadge}
          <div style="margin-left:auto;display:flex;gap:6px;">
            <button type="button" class="btn sm" data-app-toggle-rules="${esc(route.id)}">${isExpanded ? '收起规则' : `⚙️ 规则 (${ruleCnt})`}</button>
            <button type="button" class="btn sm danger" data-app-del="${esc(route.id)}" title="移除此 APP 分流">✕</button>
          </div>
        </div>
        ${presetMeta?.note ? `<div class="sub-note" style="font-size:11.5px;">💡 ${esc(presetMeta.note)}</div>` : ''}
        ${isCustomGroup ? `
          <div class="app-route-bind-row">
            <div class="app-route-bind-group">
              <span class="app-route-bind-label">绑定自建落地</span>
              ${landingChipsHtml}
            </div>
            <div class="app-route-bind-group">
              <span class="app-route-bind-label">机场备选国家</span>
              ${regionChipsHtml}
            </div>
          </div>
        ` : ''}
        ${isExpanded ? `
          <div class="app-route-rules-box">
            <div class="field">
              <label>域名后缀 (DOMAIN-SUFFIX，每行或逗号分隔)</label>
              <textarea class="input mono" rows="3" data-app-field="domains" data-route-id="${esc(route.id)}" placeholder="bybit.com&#10;bytick.com">${esc((route.domains || []).join('\n'))}</textarea>
            </div>
            <div class="field">
              <label>域名关键字 (DOMAIN-KEYWORD，可选)</label>
              <textarea class="input mono" rows="3" data-app-field="keywords" data-route-id="${esc(route.id)}" placeholder="例如：bybit">${esc((route.keywords || []).join('\n'))}</textarea>
            </div>
            <div class="field">
              <label>进程/包名 (可选，仅 PC/原生安卓)</label>
              <textarea class="input mono" rows="3" data-app-field="processes" data-route-id="${esc(route.id)}" placeholder="鸿蒙出境易/卓易通靠域名生效，通常留空">${esc((route.processes || []).join('\n'))}</textarea>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

function collectExportCandidates(appState) {
  const items = [];
  const dialer = appState.localConfig?.dialerProxy || DEFAULT_DIALER_PROXY;
  for (const n of appState.allNodesUsers || []) {
    if (!n || !n.ok) continue;
    for (const inb of n.inbounds || []) {
      const proto = String(inb.type || '').toLowerCase();
      const details = Array.isArray(inb.usersDetail) ? inb.usersDetail : [];
      for (const u of details) {
        const uname = u.name || u.username || inb.tag;
        const cred = proto === 'vless' ? (u.uuid || '') : (u.password || inb.password || '');
        items.push({
          key: `${n.nodeId}::${inb.tag}::${uname}`,
          nodeId: n.nodeId,
          nodeKind: n.nodeKind,
          region: n.region || '',
          nodeName: n.name || 'Node',
          host: n.host || '',
          proto,
          port: inb.listenPort,
          sni: inb.sni || '',
          shortId: inb.shortId || '',
          publicKey: n.publicKey || '',
          method: inb.method || '',
          username: uname,
          credential: cred,
          flow: u.flow || 'xtls-rprx-vision',
          dialerProxy: dialer,
        });
      }
    }
  }
  return items;
}

function getSelectedExportItems() {
  return exportCandidates.filter((it) => exportSelectedKeys.has(it.key));
}

function renderExportChecklist() {
  const box = $('exportNodeChecklist');
  if (!exportCandidates.length) {
    box.innerHTML = '<div class="sub-note" style="grid-column:1/-1;padding:6px 4px;">暂无可用落地节点，请先配置并同步节点用户</div>';
    $('exportSelectedCount').textContent = '已选 0 个';
    return;
  }
  box.innerHTML = exportCandidates.map((it) => {
    const checked = exportSelectedKeys.has(it.key);
    const badge = it.nodeKind === 'vps' ? '主 VPS' : 'NAT';
    return `
      <label class="export-node-item ${checked ? 'checked' : ''}" data-export-key="${esc(it.key)}">
        <input type="checkbox" ${checked ? 'checked' : ''} data-export-chk="${esc(it.key)}" />
        <div class="export-node-meta">
          <div class="export-node-title">${countryFlag(it.region)} ${esc(it.nodeName)} · ${esc(it.username)}</div>
          <div class="export-node-sub mono">${badge} · ${esc(it.proto.toUpperCase())} :${esc(it.port)} · ${esc(it.host || '--')}</div>
        </div>
      </label>
    `;
  }).join('');
  $('exportSelectedCount').textContent = `已选 ${getSelectedExportItems().length} 个`;
}

function renderPresetOptions(appState, activeId = '') {
  const sel = $('exportPresetSelect');
  const presets = appState.localConfig?.exportPresets || [];
  sel.innerHTML = '<option value="">选择已保存方案（一键复原勾选与参数）...</option>' + presets.map((p) => (
    `<option value="${esc(p.id)}">${esc(p.name)} (${p.format === 'bettbox_js' ? '.js' : '.yaml'} · ${(p.nodeKeys || []).length}节点)</option>`
  )).join('');
  if (activeId && presets.some((p) => p.id === activeId)) {
    sel.value = activeId;
  }
  $('delExportPresetBtn').disabled = !sel.value;
}

function buildExportOutput(appState) {
  const selected = getSelectedExportItems();
  const format = $('exportFormatSelect')?.value || 'all_platform_yaml';
  const devicePreset = $('exportDevicePreset')?.value || 'universal';
  const includeOpsChannel = Boolean($('exportIncludeOps')?.checked);
  const includeAllManagedIps = Boolean($('exportIncludeAllManagedIps')?.checked);
  const frontSubUrl = $('exportFrontSubUrl')?.value.trim() || '';
  const excludeHighMult = $('exportExcludeHighMult')?.checked !== false;
  const customExclude = $('exportCustomExclude')?.value.trim() || '';
  const exitFallbackMode = $('exportExitFallbackMode')?.value || 'auto';
  const frontRegionMode = $('exportFrontRegionMode')?.value || 'apac';
  const defaultOutboundMode = $('exportDefaultOutbound')?.value || 'landing';
  const testUrl = $('exportTestUrl')?.value.trim() || '';
  const customExitDomains = $('exportCustomExitDomains')?.value || '';
  const customDirectDomains = $('exportCustomDirectDomains')?.value || '';
  const customRejectDomains = $('exportCustomRejectDomains')?.value || '';

  const isYaml = format === 'all_platform_yaml';
  $('exportYamlOptsWrap')?.classList.toggle('hidden', !isYaml);
  $('exportExitRegionsWrap')?.classList.toggle('hidden', exitFallbackMode !== 'custom');
  $('exportFrontRegionsWrap')?.classList.toggle('hidden', frontRegionMode !== 'custom');
  $('exportAllIpsLabel')?.classList.toggle('hidden', !includeOpsChannel);

  const fileInput = $('exportFileNameInput');
  if (!exportFilenameEdited && fileInput) {
    fileInput.value = suggestExportFilename(selected, format, devicePreset);
  }
  const filename = fileInput?.value.trim() || suggestExportFilename(selected, format, devicePreset);

  const exportOpts = {
    format,
    devicePreset,
    includeOpsChannel,
    includeAllManagedIps,
    extraManagedIps: collectAllManagedIps(appState),
    frontSubUrl,
    excludeHighMult,
    customExclude,
    exitFallbackMode,
    exitFallbackRegions: [...selectedExitRegions],
    frontRegionMode,
    frontRegions: [...selectedFrontRegions],
    defaultOutboundMode,
    testUrl,
    customExitDomains,
    customDirectDomains,
    customRejectDomains,
    appRoutes: exportAppRoutes,
  };
  const check = validateExportDraft(selected, exportOpts);

  const vbar = $('exportValidationBar');
  if (vbar) {
    if (check.errors.length) {
      vbar.className = 'export-val-bar err mb-sm';
      vbar.textContent = `⚠️ ${check.errors.join('；')}`;
    } else {
      const exitLabel = check.resolvedExitRegions.length ? check.resolvedExitRegions.join('+') : '仅自建';
      const appPart = check.appRouteCount ? ` · APP分流 ${check.appRouteCount} 组` : '';
      const customPart = check.customRuleCount ? ` · 规则 ${check.customRuleCount} 条` : '';
      const summary = `落地 ${check.nodeCount} 个 · 备选国 ${exitLabel} · 前置 ${check.resolvedFrontLabel} · 保护IP ${check.ipCount} 个${appPart}${customPart}`;
      if (check.warnings.length) {
        vbar.className = 'export-val-bar warn mb-sm';
        vbar.textContent = `✓ ${summary} ｜ 提示：${check.warnings.join('；')}`;
      } else {
        vbar.className = 'export-val-bar ok mb-sm';
        vbar.textContent = `✅ ${summary}`;
      }
    }
  }

  if (!selected.length) {
    return {
      filename,
      selected,
      check,
      content: '# 请先在上方 ① 勾选至少 1 个落地节点（支持同时勾选多台 NAT / VPS 组合打包）\n',
    };
  }

  const content = isYaml
    ? buildAllPlatformYaml(selected, exportOpts)
    : buildBettboxUniversalJs(selected, exportOpts);

  return { filename, selected, check, content };
}

function refreshExportPreview(appState) {
  const { content } = buildExportOutput(appState);
  const codeEl = $('exportPreviewCode');
  if (codeEl) codeEl.textContent = content;
}

function populateExportAirportOptions(appState) {
  const sel = $('exportAirportSelect');
  const accs = (appState.localConfig?.providerAccounts || [])
    .filter((a) => a && typeof a.subscriptionUrl === 'string' && a.subscriptionUrl.trim());
  sel.innerHTML = '<option value="">手动输入右侧订阅链接（自动记忆）</option>' + accs.map((a) => (
    `<option value="${esc(a.subscriptionUrl.trim())}">${esc(a.name)}${a.planName ? ` · ${esc(a.planName)}` : ''}</option>`
  )).join('');

  let savedSub = '';
  try { savedSub = localStorage.getItem(EXPORT_SUB_STORAGE_KEY) || ''; } catch { savedSub = ''; }
  if (!savedSub && accs.length === 1) savedSub = accs[0].subscriptionUrl.trim();
  $('exportFrontSubUrl').value = savedSub;
  if (savedSub && accs.some((a) => a.subscriptionUrl.trim() === savedSub)) {
    sel.value = savedSub;
  }
}

export async function openConfigExporter(appState, seedCtx = null) {
  if (!Array.isArray(appState.allNodesUsers) || !appState.allNodesUsers.length) {
    try {
      const res = await invokeCmd('get_all_nodes_users');
      appState.allNodesUsers = res.nodes || [];
    } catch {
      // 允许回退至单节点 seedCtx
    }
  }

  exportCandidates = collectExportCandidates(appState);
  exportSelectedKeys = new Set();

  if (seedCtx) {
    const match = exportCandidates.find(
      (c) => c.host === (seedCtx.host || '')
        && Number(c.port) === Number(seedCtx.port)
        && c.username === (seedCtx.username || ''),
    );
    if (match) {
      exportSelectedKeys.add(match.key);
    } else {
      const fallbackKey = `seed::${seedCtx.nodeName || 'node'}::${seedCtx.username || 'user'}`;
      exportCandidates.unshift({ ...seedCtx, key: fallbackKey, nodeKind: seedCtx.proto === 'vless' ? 'vps' : 'nat', region: '' });
      exportSelectedKeys.add(fallbackKey);
    }
  } else {
    const natItems = exportCandidates.filter((c) => c.nodeKind === 'nat');
    const defaults = natItems.length ? natItems : exportCandidates;
    defaults.forEach((c) => exportSelectedKeys.add(c.key));
  }

  exportFilenameEdited = false;
  lastExportSavedPath = '';
  $('exportSavedBar').classList.add('hidden');
  $('exportSavedBar').textContent = '';
  $('exportPresetNameInput').value = '';

  $('exportModalTitle').textContent = seedCtx
    ? `📦 生成客户端配置文件 · ${seedCtx.nodeName || ''} (${seedCtx.username || ''})`
    : '📦 离线生成客户端配置文件（支持多节点组合与方案预设）';
  const includeOps = Boolean(seedCtx && String(seedCtx.username || '').toLowerCase() === 'me');
  if ($('exportFormatSelect')) $('exportFormatSelect').value = 'all_platform_yaml';
  if ($('exportDevicePreset')) $('exportDevicePreset').value = 'universal';
  if ($('exportIncludeOps')) $('exportIncludeOps').checked = includeOps;
  if ($('exportIncludeAllManagedIps')) $('exportIncludeAllManagedIps').checked = includeOps;
  if ($('exportExcludeHighMult')) $('exportExcludeHighMult').checked = true;
  if ($('exportCustomExclude')) $('exportCustomExclude').value = '';
  if ($('exportExitFallbackMode')) $('exportExitFallbackMode').value = 'auto';
  if ($('exportFrontRegionMode')) $('exportFrontRegionMode').value = 'apac';
  if ($('exportDefaultOutbound')) $('exportDefaultOutbound').value = 'landing';
  if ($('exportTestUrl')) $('exportTestUrl').value = DEFAULT_TEST_URL;
  if ($('exportCustomExitDomains')) $('exportCustomExitDomains').value = '';
  if ($('exportCustomDirectDomains')) $('exportCustomDirectDomains').value = '';
  if ($('exportCustomRejectDomains')) $('exportCustomRejectDomains').value = '';
  if ($('exportCustomRulesDetails')) $('exportCustomRulesDetails').open = false;

  selectedExitRegions = new Set(inferRegionsFromCtxs(getSelectedExportItems()));
  selectedFrontRegions = new Set(DEFAULT_APAC_REGIONS);
  exportAppRoutes = [];
  expandedAppRouteIds.clear();
  renderRegionChips('exportExitRegionsBox', selectedExitRegions);
  renderRegionChips('exportFrontRegionsBox', selectedFrontRegions);
  renderAppCatalogBar();
  renderAppRoutesList();

  populateExportAirportOptions(appState);
  renderPresetOptions(appState);
  renderExportChecklist();
  refreshExportPreview(appState);
  openModal('clientExportModal');
}

/** 从本机 Mihomo 实时连接表一键将漏网根域名带入离线配置生成器（APP 分流或强制走落地出口） */
export async function openConfigExporterWithDomain(appState, rootDomain, mode = 'app_route') {
  const dom = String(rootDomain || '').trim().toLowerCase();
  if (!dom) return;
  await openConfigExporter(appState, null);

  if (mode === 'custom_exit') {
    const ta = $('exportCustomExitDomains');
    if (ta) {
      const existing = splitToCleanList(ta.value);
      if (!existing.includes(dom)) existing.push(dom);
      ta.value = existing.join('\n');
    }
    if ($('exportCustomRulesDetails')) $('exportCustomRulesDetails').open = true;
    refreshExportPreview(appState);
    showToast(`已将「${dom}」填入「强制走落地出口」，可直接点保存重新导出`);
    return;
  }

  // 智能匹配 APP_ROUTE_CATALOG 预设（如 byd3c3.com -> Bybit）；未命中则创建专属自定义 APP 分流并展开规则箱
  const matchedPreset = APP_ROUTE_CATALOG.find((p) => (
    (p.domains || []).some((d) => dom === d || dom.endsWith(`.${d}`))
    || (p.keywords || []).some((k) => dom.includes(k))
  ));
  let targetRoute = matchedPreset
    ? exportAppRoutes.find((r) => r.presetId === matchedPreset.id)
    : null;
  if (!targetRoute && matchedPreset) {
    targetRoute = createAppRouteFromPreset(matchedPreset.id, getSelectedExportItems());
    if (targetRoute) exportAppRoutes.push(targetRoute);
  }
  if (!targetRoute) {
    const labelBase = dom.split('.')[0].toUpperCase();
    targetRoute = {
      id: `app_from_conn_${Date.now().toString(36)}`,
      presetId: '',
      name: labelBase.length <= 16 ? labelBase : dom,
      icon: '🎯',
      domains: [dom],
      keywords: [],
      processes: [],
      targetMode: 'custom_group',
      landingKeys: [],
      fallbackRegions: ['JP', 'TW', 'KR'],
      blockedRegions: [],
    };
    exportAppRoutes.push(targetRoute);
  } else if (!targetRoute.domains.includes(dom)) {
    targetRoute.domains.push(dom);
  }

  expandedAppRouteIds.add(targetRoute.id);
  renderAppCatalogBar();
  renderAppRoutesList();
  refreshExportPreview(appState);
  showToast(`已将「${dom}」加入「${targetRoute.icon} ${targetRoute.name}」APP 专属分流`);
}

export function initConfigExporter(appState) {
  $('closeExportConfigBtn')?.addEventListener('click', () => closeModal('clientExportModal'));

  $('exportNodeChecklist')?.addEventListener('change', (ev) => {
    const chk = ev.target.closest('input[data-export-chk]');
    if (!chk) return;
    const key = chk.dataset.exportChk;
    if (chk.checked) exportSelectedKeys.add(key);
    else exportSelectedKeys.delete(key);
    const tile = chk.closest('.export-node-item');
    if (tile) tile.classList.toggle('checked', chk.checked);
    if ($('exportSelectedCount')) $('exportSelectedCount').textContent = `已选 ${getSelectedExportItems().length} 个`;
    renderAppRoutesList();
    refreshExportPreview(appState);
  });

  $('exportSelectAllBtn')?.addEventListener('click', () => {
    exportCandidates.forEach((c) => exportSelectedKeys.add(c.key));
    renderExportChecklist();
    renderAppRoutesList();
    refreshExportPreview(appState);
  });

  $('exportClearAllBtn')?.addEventListener('click', () => {
    exportSelectedKeys.clear();
    renderExportChecklist();
    renderAppRoutesList();
    refreshExportPreview(appState);
  });

  $('exportPresetSelect')?.addEventListener('change', () => {
    const pid = $('exportPresetSelect').value;
    if ($('delExportPresetBtn')) $('delExportPresetBtn').disabled = !pid;
    if (!pid) return;
    const preset = (appState.localConfig?.exportPresets || []).find((p) => p.id === pid);
    if (!preset) return;
    exportSelectedKeys = new Set(
      (preset.nodeKeys || []).filter((k) => exportCandidates.some((c) => c.key === k)),
    );
    if ($('exportFormatSelect')) $('exportFormatSelect').value = preset.format || 'all_platform_yaml';
    if ($('exportDevicePreset')) $('exportDevicePreset').value = preset.devicePreset || 'universal';
    if ($('exportFrontSubUrl')) $('exportFrontSubUrl').value = preset.frontSubUrl || '';
    if ($('exportExcludeHighMult')) $('exportExcludeHighMult').checked = preset.excludeHighMult !== false;
    if ($('exportCustomExclude')) $('exportCustomExclude').value = preset.customExclude || '';
    if ($('exportIncludeOps')) $('exportIncludeOps').checked = Boolean(preset.includeOps);
    if ($('exportIncludeAllManagedIps')) $('exportIncludeAllManagedIps').checked = Boolean(preset.includeAllManagedIps);
    if ($('exportExitFallbackMode')) $('exportExitFallbackMode').value = preset.exitFallbackMode || 'auto';
    if ($('exportFrontRegionMode')) {
      $('exportFrontRegionMode').value = preset.frontRegionMode || (preset.preferApac === false ? 'all' : 'apac');
    }
    if ($('exportDefaultOutbound')) {
      $('exportDefaultOutbound').value = preset.defaultOutboundMode === 'airport' ? 'airport' : 'landing';
    }
    if ($('exportTestUrl')) $('exportTestUrl').value = preset.testUrl || DEFAULT_TEST_URL;
    if ($('exportCustomExitDomains')) $('exportCustomExitDomains').value = preset.customExitDomains || '';
    if ($('exportCustomDirectDomains')) $('exportCustomDirectDomains').value = preset.customDirectDomains || '';
    if ($('exportCustomRejectDomains')) $('exportCustomRejectDomains').value = preset.customRejectDomains || '';
    if ($('exportCustomRulesDetails')) {
      $('exportCustomRulesDetails').open = Boolean(
        preset.customExitDomains || preset.customDirectDomains || preset.customRejectDomains,
      );
    }

    selectedExitRegions = new Set(
      Array.isArray(preset.exitFallbackRegions)
        ? preset.exitFallbackRegions
        : inferRegionsFromCtxs(getSelectedExportItems()),
    );
    selectedFrontRegions = new Set(
      Array.isArray(preset.frontRegions) ? preset.frontRegions : DEFAULT_APAC_REGIONS,
    );
    exportAppRoutes = Array.isArray(preset.appRoutes)
      ? preset.appRoutes.map((r, idx) => ({
        id: r.id || `app_loaded_${idx}_${Date.now().toString(36)}`,
        presetId: r.presetId || '',
        name: r.name || '',
        icon: r.icon || '📱',
        domains: Array.isArray(r.domains) ? [...r.domains] : splitToCleanList(r.domains),
        keywords: Array.isArray(r.keywords) ? [...r.keywords] : splitToCleanList(r.keywords),
        processes: Array.isArray(r.processes) ? [...r.processes] : splitToCleanList(r.processes),
        targetMode: r.targetMode || 'custom_group',
        landingKeys: Array.isArray(r.landingKeys) ? [...r.landingKeys] : [],
        fallbackRegions: Array.isArray(r.fallbackRegions) ? [...r.fallbackRegions] : [],
        blockedRegions: Array.isArray(r.blockedRegions) ? [...r.blockedRegions] : [],
      }))
      : [];
    expandedAppRouteIds.clear();
    renderRegionChips('exportExitRegionsBox', selectedExitRegions);
    renderRegionChips('exportFrontRegionsBox', selectedFrontRegions);
    renderAppCatalogBar();
    renderAppRoutesList();

    if ($('exportPresetNameInput')) $('exportPresetNameInput').value = preset.name || '';
    if (preset.filename && $('exportFileNameInput')) {
      $('exportFileNameInput').value = preset.filename;
      exportFilenameEdited = true;
    } else {
      exportFilenameEdited = false;
    }
    renderExportChecklist();
    refreshExportPreview(appState);
    showToast(`已载入方案「${preset.name}」`);
  });

  $('saveExportPresetBtn')?.addEventListener('click', (ev) => withButtonLoading(ev.currentTarget, async () => {
    const name = $('exportPresetNameInput')?.value.trim() || '';
    if (!name) return showToast('请先在左侧填写方案名称（如：日韩双NAT-iOS）', true);
    const selected = getSelectedExportItems();
    if (!selected.length) return showToast('请先勾选至少 1 个落地节点', true);

    const list = [...(appState.localConfig?.exportPresets || [])];
    const existing = list.find((p) => p.name === name);
    const nextPreset = {
      id: existing?.id || `exp_${Date.now().toString(36)}`,
      name,
      format: $('exportFormatSelect')?.value || 'all_platform_yaml',
      devicePreset: $('exportDevicePreset')?.value || 'universal',
      nodeKeys: selected.map((c) => c.key),
      frontSubUrl: $('exportFrontSubUrl')?.value.trim() || '',
      excludeHighMult: $('exportExcludeHighMult')?.checked !== false,
      customExclude: $('exportCustomExclude')?.value.trim() || '',
      includeOps: Boolean($('exportIncludeOps')?.checked),
      includeAllManagedIps: Boolean($('exportIncludeAllManagedIps')?.checked),
      exitFallbackMode: $('exportExitFallbackMode')?.value || 'auto',
      exitFallbackRegions: [...selectedExitRegions],
      frontRegionMode: $('exportFrontRegionMode')?.value || 'apac',
      frontRegions: [...selectedFrontRegions],
      defaultOutboundMode: $('exportDefaultOutbound')?.value || 'landing',
      testUrl: $('exportTestUrl')?.value.trim() || DEFAULT_TEST_URL,
      customExitDomains: $('exportCustomExitDomains')?.value.trim() || '',
      customDirectDomains: $('exportCustomDirectDomains')?.value.trim() || '',
      customRejectDomains: $('exportCustomRejectDomains')?.value.trim() || '',
      appRoutes: exportAppRoutes.map((r) => ({
        id: r.id,
        presetId: r.presetId || '',
        name: r.name || '',
        icon: r.icon || '',
        domains: Array.isArray(r.domains) ? r.domains : splitToCleanList(r.domains),
        keywords: Array.isArray(r.keywords) ? r.keywords : splitToCleanList(r.keywords),
        processes: Array.isArray(r.processes) ? r.processes : splitToCleanList(r.processes),
        targetMode: r.targetMode || 'custom_group',
        landingKeys: Array.isArray(r.landingKeys) ? r.landingKeys : [],
        fallbackRegions: Array.isArray(r.fallbackRegions) ? r.fallbackRegions : [],
        blockedRegions: Array.isArray(r.blockedRegions) ? r.blockedRegions : [],
      })),
      filename: $('exportFileNameInput')?.value.trim() || '',
    };
    const idx = list.findIndex((p) => p.id === nextPreset.id);
    if (idx >= 0) list[idx] = nextPreset;
    else list.push(nextPreset);

    try {
      const res = await invokeCmd('save_export_presets', { presets: list });
      if (appState.localConfig) appState.localConfig.exportPresets = res.exportPresets;
      renderPresetOptions(appState, nextPreset.id);
      showToast(`已保存本机方案「${name}」（仅存本机 config.json）`);
    } catch (err) {
      showToast(err.message, true);
    }
  }));

  $('delExportPresetBtn')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    const pid = $('exportPresetSelect')?.value || '';
    if (!pid) return;
    const preset = (appState.localConfig?.exportPresets || []).find((p) => p.id === pid);
    const ok = await confirmDialog({
      title: `删除导出方案「${preset?.name || pid}」`,
      message: '确认从本机配置中移除该常用导出方案？（不会删除已导出的文件）',
      confirmText: '确认删除',
      danger: true,
    });
    if (!ok) return;
    await withButtonLoading(btn, async () => {
      try {
        const list = (appState.localConfig?.exportPresets || []).filter((p) => p.id !== pid);
        const res = await invokeCmd('save_export_presets', { presets: list });
        if (appState.localConfig) appState.localConfig.exportPresets = res.exportPresets;
        if ($('exportPresetNameInput')) $('exportPresetNameInput').value = '';
        renderPresetOptions(appState, '');
        showToast('已删除导出方案');
      } catch (err) {
        showToast(err.message, true);
      }
    });
  });

  $('exportAirportSelect')?.addEventListener('change', () => {
    const v = $('exportAirportSelect').value.trim();
    if (v) {
      if ($('exportFrontSubUrl')) $('exportFrontSubUrl').value = v;
      try { localStorage.setItem(EXPORT_SUB_STORAGE_KEY, v); } catch { /* ignore */ }
      refreshExportPreview(appState);
    }
  });

  $('exportFrontSubUrl')?.addEventListener('input', () => {
    const v = $('exportFrontSubUrl').value.trim();
    try { localStorage.setItem(EXPORT_SUB_STORAGE_KEY, v); } catch { /* ignore */ }
    refreshExportPreview(appState);
  });

  $('exportFileNameInput')?.addEventListener('input', () => {
    exportFilenameEdited = Boolean($('exportFileNameInput').value.trim());
  });

  const appendCustomExclude = (token) => {
    const el = $('exportCustomExclude');
    if (!el) return;
    const cur = el.value.trim();
    const parts = cur ? cur.split('|').map((s) => s.trim()).filter(Boolean) : [];
    for (const seg of token.split('|')) {
      if (seg && !parts.includes(seg)) parts.push(seg);
    }
    el.value = parts.join('|');
    refreshExportPreview(appState);
  };

  $('exportPresetGeckoBtn')?.addEventListener('click', () => appendCustomExclude('1💎|[^0-9]1$'));
  $('exportPresetSpecialBtn')?.addEventListener('click', () => appendCustomExclude('移动优化\\s*v6|下载推荐'));
  $('exportPresetClearBtn')?.addEventListener('click', () => {
    if ($('exportCustomExclude')) $('exportCustomExclude').value = '';
    refreshExportPreview(appState);
  });
  $('exportCustomExclude')?.addEventListener('input', () => refreshExportPreview(appState));

  const bindRegionBox = (boxId, activeSet) => {
    $(boxId)?.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-region-code]');
      if (!btn) return;
      const code = btn.dataset.regionCode;
      if (!code) return;
      if (activeSet.has(code)) {
        activeSet.delete(code);
        btn.classList.remove('active');
      } else {
        activeSet.add(code);
        btn.classList.add('active');
      }
      refreshExportPreview(appState);
    });
  };
  bindRegionBox('exportExitRegionsBox', selectedExitRegions);
  bindRegionBox('exportFrontRegionsBox', selectedFrontRegions);

  $('exportAppCatalogBar')?.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-app-preset]');
    if (!btn) return;
    const presetId = btn.dataset.appPreset;
    if (!presetId) return;
    const existIdx = exportAppRoutes.findIndex((r) => r.presetId === presetId);
    if (existIdx >= 0) {
      const removed = exportAppRoutes.splice(existIdx, 1)[0];
      expandedAppRouteIds.delete(removed.id);
      renderAppCatalogBar();
      renderAppRoutesList();
      refreshExportPreview(appState);
      return;
    }
    const created = createAppRouteFromPreset(presetId, getSelectedExportItems());
    if (!created) return;
    exportAppRoutes.push(created);
    renderAppCatalogBar();
    renderAppRoutesList();
    refreshExportPreview(appState);
    if ((created.blockedRegions || []).length) {
      showToast(`已添加「${created.icon} ${created.name}」专属分流（已自动避开 ${created.blockedRegions.join('/')} 禁区）`);
    }
  });

  $('addCustomAppRouteBtn')?.addEventListener('click', () => {
    const id = `app_custom_${Date.now().toString(36)}`;
    exportAppRoutes.push({
      id,
      presetId: '',
      name: `自定义 APP ${exportAppRoutes.length + 1}`,
      icon: '📱',
      domains: [],
      keywords: [],
      processes: [],
      targetMode: 'custom_group',
      landingKeys: [],
      fallbackRegions: ['JP', 'TW'],
      blockedRegions: [],
    });
    expandedAppRouteIds.add(id);
    renderAppRoutesList();
    refreshExportPreview(appState);
  });

  $('clearAppRoutesBtn')?.addEventListener('click', () => {
    if (!exportAppRoutes.length) return;
    exportAppRoutes = [];
    expandedAppRouteIds.clear();
    renderAppCatalogBar();
    renderAppRoutesList();
    refreshExportPreview(appState);
  });

  $('exportAppRoutesList')?.addEventListener('click', (ev) => {
    const delBtn = ev.target.closest('[data-app-del]');
    if (delBtn) {
      const rid = delBtn.dataset.appDel;
      exportAppRoutes = exportAppRoutes.filter((r) => r.id !== rid);
      expandedAppRouteIds.delete(rid);
      renderAppCatalogBar();
      renderAppRoutesList();
      refreshExportPreview(appState);
      return;
    }
    const toggleBtn = ev.target.closest('[data-app-toggle-rules]');
    if (toggleBtn) {
      const rid = toggleBtn.dataset.appToggleRules;
      if (expandedAppRouteIds.has(rid)) expandedAppRouteIds.delete(rid);
      else expandedAppRouteIds.add(rid);
      renderAppRoutesList();
      return;
    }
    const landBtn = ev.target.closest('[data-app-bind-landing]');
    if (landBtn) {
      const route = exportAppRoutes.find((r) => r.id === landBtn.dataset.appBindLanding);
      const lk = landBtn.dataset.landingKey;
      if (!route || !lk) return;
      const list = Array.isArray(route.landingKeys) ? [...route.landingKeys] : [];
      const idx = list.indexOf(lk);
      if (idx >= 0) list.splice(idx, 1);
      else list.push(lk);
      route.landingKeys = list;
      renderAppRoutesList();
      refreshExportPreview(appState);
      return;
    }
    const regBtn = ev.target.closest('[data-app-bind-region]');
    if (regBtn) {
      const route = exportAppRoutes.find((r) => r.id === regBtn.dataset.appBindRegion);
      const code = regBtn.dataset.regionCode;
      if (!route || !code) return;
      const list = Array.isArray(route.fallbackRegions) ? [...route.fallbackRegions] : [];
      const idx = list.indexOf(code);
      if (idx >= 0) list.splice(idx, 1);
      else list.push(code);
      route.fallbackRegions = list;
      renderAppRoutesList();
      refreshExportPreview(appState);
    }
  });

  $('exportAppRoutesList')?.addEventListener('input', (ev) => {
    const fieldEl = ev.target.closest('[data-app-field]');
    if (!fieldEl || fieldEl.tagName === 'SELECT') return;
    const route = exportAppRoutes.find((r) => r.id === fieldEl.dataset.routeId);
    if (!route) return;
    const field = fieldEl.dataset.appField;
    if (field === 'name' || field === 'icon') {
      route[field] = fieldEl.value;
    } else if (field === 'domains' || field === 'keywords' || field === 'processes') {
      route[field] = splitToCleanList(fieldEl.value);
    }
    refreshExportPreview(appState);
  });

  $('exportAppRoutesList')?.addEventListener('change', (ev) => {
    const sel = ev.target.closest('select[data-app-field="targetMode"]');
    if (!sel) return;
    const route = exportAppRoutes.find((r) => r.id === sel.dataset.routeId);
    if (!route) return;
    route.targetMode = sel.value;
    renderAppRoutesList();
    refreshExportPreview(appState);
  });

  $('clientExportModal')?.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-export-test-url]');
    if (!btn) return;
    const url = btn.dataset.exportTestUrl || '';
    if ($('exportTestUrl')) $('exportTestUrl').value = url;
    refreshExportPreview(appState);
  });

  [
    'exportTestUrl',
    'exportCustomExitDomains',
    'exportCustomDirectDomains',
    'exportCustomRejectDomains',
  ].forEach((id) => {
    $(id)?.addEventListener('input', () => refreshExportPreview(appState));
  });

  [
    'exportFormatSelect',
    'exportDevicePreset',
    'exportIncludeOps',
    'exportIncludeAllManagedIps',
    'exportExcludeHighMult',
    'exportExitFallbackMode',
    'exportFrontRegionMode',
    'exportDefaultOutbound',
  ].forEach((id) => {
    $(id)?.addEventListener('change', () => {
      if (id === 'exportFormatSelect') exportFilenameEdited = false;
      refreshExportPreview(appState);
    });
  });

  $('copyExportConfigBtn')?.addEventListener('click', async () => {
    const { content, selected, check } = buildExportOutput(appState);
    if (!selected.length || !check.ok) return showToast(check.errors[0] || '请先勾选至少 1 个落地节点', true);
    try {
      await copyToClipboard(content);
      showToast(`已复制含 ${selected.length} 个落地节点的完整配置到剪贴板`);
    } catch (err) {
      showToast(err.message, true);
    }
  });

  $('downloadExportConfigBtn')?.addEventListener('click', (ev) => withButtonLoading(ev.currentTarget, async () => {
    const { filename, content, selected, check } = buildExportOutput(appState);
    if (!selected.length || !check.ok) return showToast(check.errors[0] || '请先勾选至少 1 个落地节点', true);
    try {
      const res = await invokeCmd('save_export_file', { filename, content });
      lastExportSavedPath = res.filePath || '';
      const bar = $('exportSavedBar');
      if (bar) {
        bar.innerHTML = `✅ 已生成并写入本地：<code class="mono">${esc(res.filePath || res.fileName)}</code>（${Math.max(1, Math.round((res.size || content.length) / 1024))} KB）`;
        bar.classList.remove('hidden');
      }
      showToast(`配置文件已真实保存：${res.fileName}`);
    } catch (err) {
      showToast(err.message, true);
    }
  }));

  $('openExportDirBtn')?.addEventListener('click', async () => {
    try {
      await invokeCmd('open_export_folder', { filePath: lastExportSavedPath || null });
    } catch (err) {
      showToast(err.message, true);
    }
  });
}
