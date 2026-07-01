mod commands;
mod crypto;
mod ssh;
mod state;
mod store;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // 在 app_data_dir 下建 kshell.db 并做迁移。失败直接抛,让用户看到具体原因。
            let dir = app.path().app_data_dir().expect("无法定位 app_data_dir");
            let db_path = dir.join("kshell.db");
            let store = store::Store::open(db_path).expect("初始化 SQLite 存储失败");

            // known_hosts 信任库,同目录下 known_hosts.json
            let kh_path = dir.join("known_hosts.json");
            let known_hosts =
                ssh::known_hosts::KnownHosts::load(kh_path).expect("初始化 known_hosts 失败");

            // 凭据加密 key,同目录下 key.bin(机器绑定,换电脑无法解密)
            let key_path = dir.join("key.bin");
            let crypto = crypto::CryptoKey::load_or_create(key_path).expect("初始化加密 key 失败");

            let state = AppState::new(known_hosts, crypto);
            let _ = state.store.set(store);
            app.manage(state);
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
            commands::session_get_credentials,
            // 主机公钥校验
            commands::ssh_confirm_host,
            commands::ssh_remove_known_host,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
