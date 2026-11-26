/**
 * 本机连接配置与桌面托盘行为设置页
 */

import { showToast } from '../components/toast.js';
import { DEFAULT_DIALER_PROXY, DEFAULT_MIHOMO_URL, DEFAULT_MONTHLY_QUOTA_GB } from '../constants/ui-constants.js';
import { invokeCmd, withButtonLoading } from '../utils/bridge.js';
import { esc } from '../utils/format.js';

const $ = (id) => document.getElementById(id);

export const APPEARANCE_DIY_STORAGE_KEY = 'nodedeck_appearance_diy_v1';

export const DEFAULT_APPEARANCE_PREFS = Object.freeze({
  accent: 'blue',
  density: 'comfortable',
  hideProbe: false,
  hideMetrics: false,
});

const VALID_ACCENTS = new Set(['blue', 'teal', 'purple', 'green', 'orange', 'graphite']);
const VALID_DENSITIES = new Set(['comfortable', 'compact']);

export function normalizeAppearancePrefs(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    accent: VALID_ACCENTS.has(src.accent) ? src.accent : DEFAULT_APPEARANCE_PREFS.accent,
    density: VALID_DENSITIES.has(src.density) ? src.density : DEFAULT_APPEARANCE_PREFS.density,
    hideProbe: Boolean(src.hideProbe),
    hideMetrics: Boolean(src.hideMetrics),
  };
}

export function loadAppearancePrefs() {
  try {
    const raw = localStorage.getItem(APPEARANCE_DIY_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_APPEARANCE_PREFS };
    return normalizeAppearancePrefs(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_APPEARANCE_PREFS };
  }
}

export function syncAppearanceControls(prefs) {
  const normalized = normalizeAppearancePrefs(prefs);
  document.querySelectorAll('#accentSwatchRow [data-accent-val]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.accentVal === normalized.accent);
  });
  document.querySelectorAll('#densitySeg [data-density-val]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.densityVal === normalized.density);
  });
  $('diyHideProbeSwitch')?.classList.toggle('on', normalized.hideProbe);
  $('diyHideMetricsSwitch')?.classList.toggle('on', normalized.hideMetrics);
}

export function applyAppearancePrefs(prefs, persist = true) {
  const normalized = normalizeAppearancePrefs(prefs);
  const root = document.documentElement;
  root.dataset.accent = normalized.accent;
  root.dataset.density = normalized.density;
  root.dataset.hideProbe = normalized.hideProbe ? '1' : '0';
  root.dataset.hideMetrics = normalized.hideMetrics ? '1' : '0';
  if (persist) {
    try {
      localStorage.setItem(APPEARANCE_DIY_STORAGE_KEY, JSON.stringify(normalized));
    } catch { /* ignore */ }
  }
  syncAppearanceControls(normalized);
  return normalized;
}

export async function loadConfigUI(appState) {
  const { config, keyExists, resolvedKeyPath, panelDir } = await invokeCmd('get_config');
  appState.localConfig = config;

  $('cfgPathHint').textContent = `${panelDir}\\config.json`;
  $('cfgName').value = config.name || '';
  $('cfgRegion').value = config.region || 'US';
  $('cfgHost').value = config.host || '';
  $('cfgSshPort').value = config.sshPort || 22;
  $('cfgUser').value = config.user || 'root';
  $('cfgKeyPath').value = config.keyPath || '';
  $('cfgPbk').value = config.realityPublicKey || '';
  $('cfgQuota').value = config.monthlyQuotaGB || DEFAULT_MONTHLY_QUOTA_GB;
  $('cfgClashPort').value = config.clashApiPort || 19090;
  $('cfgMhUrl').value = config.mihomoApiUrl || DEFAULT_MIHOMO_URL;
  $('cfgMhSecret').value = config.mihomoSecret || '';
  $('cfgDialerProxy').value = config.dialerProxy || DEFAULT_DIALER_PROXY;
  $('cfgCloseToTraySwitch').classList.toggle('on', config.closeToTray !== false);

  $('keyStatusText').innerHTML = keyExists
    ? `<span class="pill green">✅ 私钥就绪</span> <code class="mono">${esc(resolvedKeyPath)}</code>`
    : `<span class="pill red">❌ 未找到私钥</span> <code class="mono">${esc(resolvedKeyPath)}</code>`;
}

export function initSettingsEvents(
  appState,
  { reloadOverview, reloadMihomo, switchTab, refreshNodeSwitcher, applyAppearancePrefs: applyOverride },
) {
  const applyPrefs = typeof applyOverride === 'function' ? applyOverride : applyAppearancePrefs;
  syncAppearanceControls(loadAppearancePrefs());

  $('cfgCloseToTraySwitch').addEventListener('click', (ev) => {
    ev.currentTarget.classList.toggle('on');
  });

  $('accentSwatchRow')?.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-accent-val]');
    if (!btn) return;
    const current = loadAppearancePrefs();
    applyPrefs({ ...current, accent: btn.dataset.accentVal });
  });

  $('densitySeg')?.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-density-val]');
    if (!btn) return;
    const current = loadAppearancePrefs();
    applyPrefs({ ...current, density: btn.dataset.densityVal });
  });

  $('diyHideProbeSwitch')?.addEventListener('click', () => {
    const current = loadAppearancePrefs();
    applyPrefs({ ...current, hideProbe: !current.hideProbe });
  });

  $('diyHideMetricsSwitch')?.addEventListener('click', () => {
    const current = loadAppearancePrefs();
    applyPrefs({ ...current, hideMetrics: !current.hideMetrics });
  });

  $('resetAppearanceBtn')?.addEventListener('click', () => {
    applyPrefs({ ...DEFAULT_APPEARANCE_PREFS });
    showToast('已恢复默认外观与布局');
  });

  $('gotoAssetsFromSettingsBtn').addEventListener('click', () => switchTab('assets'));

  $('saveCfgBtn').addEventListener('click', (ev) => withButtonLoading(ev.currentTarget, async () => {
    try {
      await invokeCmd('save_config_cmd', {
        input: {
          name: $('cfgName').value,
          region: $('cfgRegion').value,
          host: $('cfgHost').value,
          sshPort: Number($('cfgSshPort').value) || 22,
          user: $('cfgUser').value,
          keyPath: $('cfgKeyPath').value,
          realityPublicKey: $('cfgPbk').value,
          monthlyQuotaGB: Number($('cfgQuota').value) || DEFAULT_MONTHLY_QUOTA_GB,
          clashApiPort: Number($('cfgClashPort').value) || 19090,
          mihomoApiUrl: $('cfgMhUrl').value,
          mihomoSecret: $('cfgMhSecret').value,
          dialerProxy: $('cfgDialerProxy').value,
          closeToTray: $('cfgCloseToTraySwitch').classList.contains('on'),
        },
      });
      showToast('配置已保存');
      await loadConfigUI(appState);
      refreshNodeSwitcher();
      await Promise.all([reloadOverview(), reloadMihomo()]);
    } catch (err) {
      showToast(err.message, true);
    }
  }));

  $('testConnBtn').addEventListener('click', (ev) => withButtonLoading(ev.currentTarget, async () => {
    showToast('正在测试 SSH 免密连接...');
    await reloadOverview();
    if ($('connDot').classList.contains('green')) {
      showToast('✅ 免密连接成功！');
    }
  }));

  $('sshWizardBtn').addEventListener('click', (ev) => withButtonLoading(ev.currentTarget, async () => {
    try {
      const res = await invokeCmd('launch_ssh_wizard');
      showToast(res.message);
    } catch (err) {
      showToast(err.message, true);
    }
  }));
}
