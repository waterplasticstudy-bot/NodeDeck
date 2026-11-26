/**
 * 独立多节点离线客户端配置生成器弹窗（含本机常用方案预设管理、导出前校验、Rust 原生落盘与定位打开）
 */

import { DEFAULT_DIALER_PROXY } from '../constants/ui-constants.js';
import { copyToClipboard, invokeCmd, withButtonLoading } from '../utils/bridge.js';
import {
  buildAllPlatformYaml,
  buildBettboxUniversalJs,
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
  };
  const check = validateExportDraft(selected, exportOpts);

  const vbar = $('exportValidationBar');
  if (vbar) {
    if (check.errors.length) {
      vbar.className = 'export-val-bar err mb-sm';
      vbar.textContent = `⚠️ ${check.errors.join('；')}`;
    } else {
      const exitLabel = check.resolvedExitRegions.length ? check.resolvedExitRegions.join('+') : '仅自建';
      const customPart = check.customRuleCount ? ` · 自定义规则 ${check.customRuleCount} 条` : '';
      const summary = `落地 ${check.nodeCount} 个 · 备选国 ${exitLabel} · 前置 ${check.resolvedFrontLabel} · 保护IP ${check.ipCount} 个${customPart}`;
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
  renderRegionChips('exportExitRegionsBox', selectedExitRegions);
  renderRegionChips('exportFrontRegionsBox', selectedFrontRegions);

  populateExportAirportOptions(appState);
  renderPresetOptions(appState);
  renderExportChecklist();
  refreshExportPreview(appState);
  openModal('clientExportModal');
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
    refreshExportPreview(appState);
  });

  $('exportSelectAllBtn')?.addEventListener('click', () => {
    exportCandidates.forEach((c) => exportSelectedKeys.add(c.key));
    renderExportChecklist();
    refreshExportPreview(appState);
  });

  $('exportClearAllBtn')?.addEventListener('click', () => {
    exportSelectedKeys.clear();
    renderExportChecklist();
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
    renderRegionChips('exportExitRegionsBox', selectedExitRegions);
    renderRegionChips('exportFrontRegionsBox', selectedFrontRegions);

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
    await withButtonLoading(ev.currentTarget, async () => {
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
