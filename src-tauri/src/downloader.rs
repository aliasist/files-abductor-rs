// Download engine — shells out to yt-dlp (same as the original Electron app)
// but runs it through Tokio so progress parsing never blocks the UI thread.
// Rust gives us two things the JS version didn't have for free: a `Result`
// that forces every error path to be handled, and cancellation via a
// `CancellationToken` instead of manually tracking `abortRequested`.

use serde::Serialize;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

#[derive(Clone, Serialize)]
pub struct DownloadProgress {
    pub percent: f32,
    pub speed: Option<String>,
    pub eta: Option<String>,
    pub raw_line: String,
}

#[derive(Clone, Serialize)]
pub struct DownloadResult {
    pub success: bool,
    pub final_path: Option<String>,
    pub error: Option<String>,
}

/// Holds the currently-running yt-dlp child process, if any, so the
/// "eject" button can kill it. Wrapped in Arc<Mutex<>> because the process
/// is spawned in a Tauri command (async, runs on Tokio) and killed from a
/// separate command triggered by a UI button click.
pub struct DownloadState {
    pub current_child: Arc<Mutex<Option<Child>>>,
}

impl Default for DownloadState {
    fn default() -> Self {
        Self {
            current_child: Arc::new(Mutex::new(None)),
        }
    }
}

fn ytdlp_binary() -> &'static str {
    if cfg!(target_os = "windows") {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    }
}

/// Parses a single line of yt-dlp's --newline --progress output into a
/// percent/speed/eta triple. yt-dlp's progress format looks like:
///   [download]  42.3% of 10.00MiB at 1.20MiB/s ETA 00:05
fn parse_progress_line(line: &str) -> Option<DownloadProgress> {
    if !line.contains("[download]") || !line.contains('%') {
        return None;
    }

    let percent = line
        .split('%')
        .next()
        .and_then(|s| s.split_whitespace().last())
        .and_then(|s| s.parse::<f32>().ok())?;

    let speed = line
        .split("at ")
        .nth(1)
        .and_then(|s| s.split_whitespace().next())
        .map(|s| s.to_string());

    let eta = line
        .split("ETA ")
        .nth(1)
        .and_then(|s| s.split_whitespace().next())
        .map(|s| s.to_string());

    Some(DownloadProgress {
        percent,
        speed,
        eta,
        raw_line: line.trim().to_string(),
    })
}

pub async fn download(
    app: AppHandle,
    state: Arc<Mutex<Option<Child>>>,
    url: String,
    save_path: String,
) -> DownloadResult {
    let parsed_base = save_path
        .rfind('.')
        .map(|i| &save_path[..i])
        .unwrap_or(&save_path)
        .to_string();
    let out_template = format!("{parsed_base}.%(ext)s");
    let final_path = format!("{parsed_base}.mp4");

    if let Some(parent) = PathBuf::from(&parsed_base).parent() {
        if let Err(e) = tokio::fs::create_dir_all(parent).await {
            return DownloadResult {
                success: false,
                final_path: None,
                error: Some(format!("Could not create download folder: {e}")),
            };
        }
    }

    let mut cmd = Command::new(ytdlp_binary());
    cmd.args([
        &url,
        "--newline",
        "--no-playlist",
        "--format",
        // Require video+audio, prefer H.264/AAC so it plays everywhere
        // without a transcode step (same constraint as the original app).
        "bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo[vcodec^=avc1]+bestaudio[ext=m4a]",
        "--merge-output-format",
        "mp4",
        "-o",
        &out_template,
        "--progress",
        "--no-warnings",
        "--restrict-filenames",
    ])
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return DownloadResult {
                success: false,
                final_path: None,
                error: Some(format!(
                    "Could not launch yt-dlp — is it installed and on PATH? ({e})"
                )),
            };
        }
    };

    let stdout = child.stdout.take().expect("stdout was piped");
    let stderr = child.stderr.take().expect("stderr was piped");

    // Stash the child so the eject/abort command can kill it mid-flight.
    *state.lock().await = None; // drop any stale handle first
    let pid = child.id();

    let app_stdout = app.clone();
    let stdout_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(progress) = parse_progress_line(&line) {
                let _ = app_stdout.emit("download://progress", progress);
            }
        }
    });

    let app_stderr = app.clone();
    let mut stderr_tail = String::new();
    let stderr_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        let mut tail = String::new();
        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(progress) = parse_progress_line(&line) {
                let _ = app_stderr.emit("download://progress", progress);
            } else {
                tail = line;
            }
        }
        tail
    });

    *state.lock().await = Some(child);

    let _ = stdout_task.await;
    if let Ok(tail) = stderr_task.await {
        stderr_tail = tail;
    }

    // Take the child back out to wait on its exit status.
    let mut guard = state.lock().await;
    let status = if let Some(mut child) = guard.take() {
        child.wait().await
    } else {
        // Killed by eject — process handle already consumed there.
        return DownloadResult {
            success: false,
            final_path: None,
            error: Some("Aborted by user.".to_string()),
        };
    };
    drop(guard);

    match status {
        Ok(s) if s.success() => DownloadResult {
            success: true,
            final_path: Some(final_path),
            error: None,
        },
        Ok(_) => DownloadResult {
            success: false,
            final_path: None,
            error: Some(if stderr_tail.is_empty() {
                "yt-dlp exited with an error.".to_string()
            } else {
                stderr_tail
            }),
        },
        Err(e) => DownloadResult {
            success: false,
            final_path: None,
            error: Some(format!("Process error (pid {pid:?}): {e}")),
        },
    }
}

pub async fn abort(state: Arc<Mutex<Option<Child>>>) -> bool {
    let mut guard = state.lock().await;
    if let Some(mut child) = guard.take() {
        let _ = child.kill().await;
        true
    } else {
        false
    }
}
