/**
 * 统一苹果风模态弹窗与确认对话框（铁律 #1：全面替代浏览器原生 confirm / alert / prompt）
 */

let pendingConfirmResolve = null;

export function openModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) el.classList.add('show');
}

export function closeModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) el.classList.remove('show');
}

/** 弹出苹果风毛玻璃确认框，返回 Promise<boolean> */
export function confirmDialog({
  title = '确认操作',
  message = '',
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
}) {
  return new Promise((resolve) => {
    if (pendingConfirmResolve) {
      pendingConfirmResolve(false);
    }
    pendingConfirmResolve = resolve;

    const titleEl = document.getElementById('confirmModalTitle');
    const descEl = document.getElementById('confirmModalDesc');
    const okBtn = document.getElementById('confirmModalOk');
    const cancelBtn = document.getElementById('confirmModalCancel');

    titleEl.textContent = title;
    descEl.textContent = message;
    okBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;
    okBtn.className = danger ? 'btn danger-solid' : 'btn primary';
    openModal('confirmModal');
    okBtn.focus();
  });
}

function settleConfirm(result) {
  closeModal('confirmModal');
  if (pendingConfirmResolve) {
    const fn = pendingConfirmResolve;
    pendingConfirmResolve = null;
    fn(result);
  }
}

/** 初始化所有模态框的遮罩点击关闭与 ESC 快捷键 */
export function initModals() {
  document.getElementById('confirmModalOk')?.addEventListener('click', () => settleConfirm(true));
  document.getElementById('confirmModalCancel')?.addEventListener('click', () => settleConfirm(false));

  document.querySelectorAll('.modal-bg').forEach((bg) => {
    bg.addEventListener('click', (ev) => {
      if (ev.target !== bg) return;
      if (bg.id === 'confirmModal') settleConfirm(false);
      else bg.classList.remove('show');
    });
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (document.getElementById('confirmModal')?.classList.contains('show')) {
      settleConfirm(false);
      return;
    }
    document.querySelectorAll('.modal-bg.show').forEach((el) => el.classList.remove('show'));
  });
}
