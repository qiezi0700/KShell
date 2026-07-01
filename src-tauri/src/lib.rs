mod commands;
mod ssh;
mod state;
mod store;
mod vault;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_stronghold::Builder::new(|_| {}).build())
        .manage(AppState::new())
        .setup(|app| {
            // 在 app_data_dir 下建 kshell.db 并做迁移。失败直接抛,让用户看到具体原因。
            let dir = app
                .path()
                .app_data_dir()
                .expect("无法定位 app_data_dir");
            let db_path = dir.join("kshell.db");
            let store = store::Store::open(db_path)
                .expect("初始化 SQLite 存储失败");
            let state = app.state::<AppState>();
            let _ = state.store.set(store);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // SSH
            commands::ssh_connect,
            commands::ssh_open_shell,
            commands::ssh_write,
            commands::ssh_resize,
            commands::ssh_close_channel,
            commands::ssh_disconnect,
            // 持久化
            commands::groups_list,
            commands::group_upsert,
            commands::group_delete,
            commands::sessions_list,
            commands::session_upsert,
            commands::session_delete,
            // 凭据保险箱
            commands::vault_set,
            commands::vault_get,
            commands::vault_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
