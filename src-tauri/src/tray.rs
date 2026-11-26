//! Windows 原生系统托盘管理（最小化常驻、代理模式快捷切换与安全退出）

use crate::commands::AppState;
use crate::config::load_config;
use crate::constants::{
    EVENT_TRAY_REFRESH, MAIN_WINDOW_LABEL, TRAY_ID, TRAY_MENU_MODE_DIRECT, TRAY_MENU_MODE_GLOBAL,
    TRAY_MENU_MODE_RULE, TRAY_MENU_QUIT, TRAY_MENU_REFRESH, TRAY_MENU_SHOW, TRAY_TOOLTIP,
};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

pub fn show_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, TRAY_MENU_SHOW, "显示 NodeDeck 主窗口", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let rule_item = MenuItem::with_id(app, TRAY_MENU_MODE_RULE, "代理模式 · 规则 (Rule)", true, None::<&str>)?;
    let global_item = MenuItem::with_id(app, TRAY_MENU_MODE_GLOBAL, "代理模式 · 全局 (Global)", true, None::<&str>)?;
    let direct_item = MenuItem::with_id(app, TRAY_MENU_MODE_DIRECT, "代理模式 · 直连 (Direct)", true, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let refresh_item = MenuItem::with_id(app, TRAY_MENU_REFRESH, "立即刷新全部状态", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, TRAY_MENU_QUIT, "彻底退出程序", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &show_item,
            &sep1,
            &rule_item,
            &global_item,
            &direct_item,
            &sep2,
            &refresh_item,
            &quit_item,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip(TRAY_TOOLTIP)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| {
            let id = event.id.as_ref();
            match id {
                TRAY_MENU_SHOW => show_main_window(app),
                TRAY_MENU_REFRESH => {
                    let _ = app.emit(EVENT_TRAY_REFRESH, ());
                }
                TRAY_MENU_MODE_RULE | TRAY_MENU_MODE_GLOBAL | TRAY_MENU_MODE_DIRECT => {
                    let mode = match id {
                        TRAY_MENU_MODE_GLOBAL => "global",
                        TRAY_MENU_MODE_DIRECT => "direct",
                        _ => "rule",
                    }
                    .to_string();
                    let handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let cfg = load_config();
                        let state = handle.state::<AppState>();
                        let _ = state.mihomo.set_mode(&cfg, &mode).await;
                        let _ = handle.emit(EVENT_TRAY_REFRESH, ());
                    });
                }
                TRAY_MENU_QUIT => {
                    let handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let state = handle.state::<AppState>();
                        let _ = tokio::time::timeout(
                            std::time::Duration::from_millis(500),
                            state.ssh.reset(),
                        )
                        .await;
                        handle.exit(0);
                    });
                }
                _ => {}
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}
