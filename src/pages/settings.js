/**
 * 本机连接配置与桌面托盘行为设置页
 */

import { showToast } from '../components/toast.js';
import { DEFAULT_MIHOMO_URL, DEFAULT_MONTHLY_QUOTA_GB } from '../constants/ui-constants.js';
import { invokeCmd, withButtonLoading } from '../utils/bridge.js';
import { esc } from '../utils/format.js';

const $ = (id) => document.getElementById(id);

export async function loadConfigUI(appState) {
  const { config, keyExists, resolvedKeyPath, panelDir } = await invokeCmd('get_config');
  appState.localConfig = config;

  $('cfgPathHint').textContent = `${panelDir}\\config.json`;
  $('cfgName').value = config.name || '';
  $('cfgHost').value = config.host || '';
  $('cfgSshPort').value = config.sshPort || 22;
  $('cfgUser').value = config.user || 'root';
  $('cfgKeyPath').value = config.keyPath || '';
  $('cfgPbk').value = config.realityPublicKey || '';
  $('cfgQuota').value = config.monthlyQuotaGB || DEFAULT_MONTHLY_QUOTA_GB;
  $('cfgClashPort').value = config.clashApiPort || 19090;
  $('cfgMhUrl').value = config.mihomoApiUrl || DEFAULT_MIHOMO_URL;
  $('cfgMhSecret').value = config.mihomoSecret || '';
  $('cfgCloseToTraySwitch').classList.toggle('on', config.closeToTray !== false);

  $('keyStatusText').innerHTML = keyExists
    ? `<span class="pill green">✅ 私钥就绪</span> <code class="mono">${esc(resolvedKeyPath)}</code>`
    : `<span class="pill red">❌ 未找到私钥</span> <code class="mono">${esc(resolvedKeyPath)}</code>`;
}

export function initSettingsEvents(appState, { reloadOverview, reloadMihomo, switchTab, refreshNodeSwitcher }) {
  $('cfgCloseToTraySwitch').addEventListener('click', (ev) => {
    ev.currentTarget.classList.toggle('on');
  });

  $('gotoAssetsFromSettingsBtn').addEventListener('click', () => switchTab('assets'));

  $('saveCfgBtn').addEventListener('click', (ev) => withButtonLoading(ev.currentTarget, async () => {
    try {
      await invokeCmd('save_config_cmd', {
        input: {
          name: $('cfgName').value,
          host: $('cfgHost').value,
          sshPort: Number($('cfgSshPort').value) || 22,
          user: $('cfgUser').value,
          keyPath: $('cfgKeyPath').value,
          realityPublicKey: $('cfgPbk').value,
          monthlyQuotaGB: Number($('cfgQuota').value) || DEFAULT_MONTHLY_QUOTA_GB,
          clashApiPort: Number($('cfgClashPort').value) || 19090,
          mihomoApiUrl: $('cfgMhUrl').value,
          mihomoSecret: $('cfgMhSecret').value,
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
