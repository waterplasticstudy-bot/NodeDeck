//! NodeDeck v1.0 核心应用装配入口（编译器硬拒死代码与未使用导入）

#![deny(dead_code, unused_imports)]

mod accounts;
mod alpine;
mod commands;
mod config;
mod constants;
mod mihomo;
mod ssh_client;
mod terminal;
mod tray;
mod tunnel;

use commands::AppState;
use config::load_config;
use constants::{MAIN_WINDOW_LABEL, SINGBOX_PANEL_WINDOW_PREFIX};
use tauri::{Manager, RunEvent, WindowEvent};
use tray::{setup_tray, show_main_window};

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_config_cmd,
            commands::save_nat_nodes,
            commands::save_provider_accounts,
            commands::save_export_presets,
            commands::save_terminal_snippets,
            commands::pty_open,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_close,
            commands::launch_ssh_wizard,
            commands::get_overview,
            commands::get_users,
            commands::add_user,
            commands::edit_vps_user,
            commands::toggle_user,
            commands::delete_user,
            commands::toggle_antichina,
            commands::get_audit,
            commands::configure_audit,
            commands::close_vps_conn,
            commands::get_logs,
            commands::run_service_action,
            commands::check_vps_ip,
            commands::get_singbox_config,
            commands::restore_singbox_backup,
            commands::mutate_node_inbound,
            commands::get_all_nodes_users,
            commands::get_nat_alpine_overview,
            commands::get_nat_alpine_config,
            commands::get_nat_alpine_logs,
            commands::run_nat_alpine_action,
            commands::restore_nat_alpine_backup,
            commands::get_nat_alpine_audit,
            commands::configure_nat_alpine_audit,
            commands::close_nat_alpine_conn,
            commands::manage_node_ledger,
            commands::save_member_quota,
            commands::open_remote_singbox_panel,
            commands::poll_remote_singbox_panel,
            commands::close_remote_singbox_panel,
            commands::close_remote_singbox_panel_conn,
            commands::get_nat_exit_status,
            commands::get_nat_exit_latency,
            commands::switch_nat_exit_cmd,
            commands::run_nat_exit_diag,
            commands::open_account_window,
            commands::clear_account_session,
            commands::get_account_sessions_status,
            commands::sync_dashboard_traffic,
            commands::sync_subscription_traffic,
            commands::tcp_ping_host,
            commands::get_mihomo_status,
            commands::probe_connectivity,
            commands::set_mihomo_mode,
            commands::select_mihomo_node,
            commands::test_mihomo_delay,
            commands::test_mihomo_group_delay,
            commands::get_mihomo_rules,
            commands::close_mihomo_conn,
            commands::set_window_theme,
            commands::open_external_url,
            commands::save_export_file,
            commands::open_export_folder,
        ])
        .setup(|app| {
            setup_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // 仅主窗口拦截关闭收进托盘；远端 sing-box 面板关闭时自动回收加密 SSH 隧道
            let label = window.label().to_string();
            if label == MAIN_WINDOW_LABEL {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    if load_config().close_to_tray {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            } else if label.starts_with(SINGBOX_PANEL_WINDOW_PREFIX) {
                if let WindowEvent::Destroyed = event {
                    let app = window.app_handle().clone();
                    tauri::async_runtime::spawn(async move {
                        let state = app.state::<AppState>();
                        state.tunnels.close_by_window_label(&label).await;
                    });
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building NodeDeck desktop application");

    app.run(|app_handle, event| match event {
        RunEvent::Exit => {
            let state = app_handle.state::<AppState>();
            state.terminal.close_all();
            tauri::async_runtime::block_on(async {
                state.tunnels.close_all().await;
                state.ssh.reset().await;
            });
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen {
            has_visible_windows: false,
            ..
        } => {
            show_main_window(app_handle);
        }
        _ => {}
    });
}
