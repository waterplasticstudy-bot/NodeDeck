/**
 * 统一苹果风模态弹窗与确认对话框（铁律 #1：全面替代浏览器原生 confirm / alert / prompt）
 * 支持危险操作安全聚焦（默认聚焦取消键防误删）与 Esc 逐层关闭栈
 */

let pendingConfirmResolve = null;
const modalStack = [];

export function openModal(modalId) {
  const el = document.getElementById(modalId);
  if (!el) return;
  el.classList.add('show');
  const idx = modalStack.indexOf(modalId);
  if (idx >= 0) modalStack.splice(idx, 1);
  modalStack.push(modalId);
}

export function closeModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) el.classList.remove('show');
  const idx = modalStack.indexOf(modalId);
  if (idx >= 0) modalStack.splice(idx, 1);
}

/** 弹出苹果风毛玻璃确认框，返回 Promise<boolean>（危险操作默认焦点落在「取消」防误敲回车） */
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
    (danger ? cancelBtn : okBtn).focus();
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

/** 初始化所有模态框的遮罩点击关闭与 Esc 逐层关闭 */
export function initModals() {
  document.getElementById('confirmModalOk')?.addEventListener('click', () => settleConfirm(true));
  document.getElementById('confirmModalCancel')?.addEventListener('click', () => settleConfirm(false));

  document.querySelectorAll('.modal-bg').forEach((bg) => {
    bg.addEventListener('click', (ev) => {
      if (ev.target !== bg) return;
      if (bg.id === 'confirmModal') settleConfirm(false);
      else closeModal(bg.id);
    });
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (document.getElementById('confirmModal')?.classList.contains('show')) {
      settleConfirm(false);
      return;
    }
    while (modalStack.length > 0) {
      const topId = modalStack.pop();
      const topEl = document.getElementById(topId);
      if (topEl?.classList.contains('show')) {
        topEl.classList.remove('show');
        return;
      }
    }
    const visible = Array.from(document.querySelectorAll('.modal-bg.show'));
    if (visible.length) {
      visible[visible.length - 1].classList.remove('show');
    }
  });
}
