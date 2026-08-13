mod downloader;

use downloader::{DownloadResult, DownloadState};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

#[tauri::command]
fn get_dl_dir(app: AppHandle) -> String {
    let dir = app
        .path()
        .download_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("Aliasist");
    let _ = std::fs::create_dir_all(&dir);
    dir.to_string_lossy().to_string()
}

#[tauri::command]
async fn download_file(
    app: AppHandle,
    state: State<'_, DownloadState>,
    url: String,
    save_path: String,
) -> Result<DownloadResult, String> {
    let child_state = state.current_child.clone();
    Ok(downloader::download(app, child_state, url, save_path).await)
}

#[tauri::command]
async fn abort_download(state: State<'_, DownloadState>) -> Result<bool, String> {
    Ok(downloader::abort(state.current_child.clone()).await)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DownloadState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_dl_dir,
            download_file,
            abort_download
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
