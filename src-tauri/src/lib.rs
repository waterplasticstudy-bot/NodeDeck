//! NodeDeck v1.0 核心应用装配入口（编译器硬拒死代码与未使用导入）

#![deny(dead_code, unused_imports)]

mod accounts;
mod alpine_ssh;
mod commands;
mod config;
mod constants;
mod mihomo;
mod ssh_client;
mod tray;

use commands::AppState;
use config::load_config;
use constants::MAIN_WINDOW_LABEL;
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
            commands::close_mihomo_conn,
            commands::set_window_theme,
            commands::open_external_url,
        ])
        .setup(|app| {
            setup_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // 仅主窗口拦截关闭收进托盘；多账号隔离窗口正常关闭释放资源
            if window.label() == MAIN_WINDOW_LABEL {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    if load_config().close_to_tray {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building NodeDeck desktop application");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            let state = app_handle.state::<AppState>();
            tauri::async_runtime::block_on(state.ssh.reset());
        }
    });
}
