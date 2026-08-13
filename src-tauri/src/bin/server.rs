// Standalone HTTP server exposing the same yt-dlp download engine the
// desktop Tauri app uses (app_lib::downloader), for the Android client —
// Android forbids apps from spawning arbitrary subprocesses, so yt-dlp can't
// run on-device. Instead the Android app talks HTTP to this server (running
// on a machine that *can* run yt-dlp), the same way the Ollama lab setup
// tunnels a local model to the phone.
//
// Flow: POST /api/jobs {url} -> {id}; poll GET /api/jobs/:id for progress;
// once status is "done", GET /api/jobs/:id/file streams the result.
// Deliberately poll-based rather than SSE/websocket — simpler client code,
// and fine for a single-user tool with a handful of concurrent jobs.

use app_lib::downloader::{self, DownloadProgress, DownloadResult};
use axum::{
    extract::{Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;
use tower_http::cors::{Any, CorsLayer};
use uuid::Uuid;

#[derive(Clone, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum JobStatus {
    Downloading {
        percent: f32,
        speed: Option<String>,
        eta: Option<String>,
    },
    Done {
        filename: String,
    },
    Error {
        message: String,
    },
    Aborted,
}

#[derive(Clone)]
struct Job {
    status: JobStatus,
    file_path: Option<PathBuf>,
}

type Jobs = Arc<Mutex<HashMap<String, Job>>>;
type ChildState = Arc<Mutex<Option<tokio::process::Child>>>;

#[derive(Clone)]
struct AppState {
    jobs: Jobs,
    // One in-flight download at a time per server instance — matches the
    // desktop app's single-job model and keeps this simple. A queue can be
    // added later if concurrent downloads turn out to matter.
    current_child: ChildState,
    download_dir: PathBuf,
}

#[derive(Deserialize)]
struct CreateJobBody {
    url: String,
}

#[derive(Serialize)]
struct CreateJobResponse {
    id: String,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let download_dir = std::env::var("ABDUCTOR_DOWNLOAD_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            dirs_download_dir().unwrap_or_else(|| PathBuf::from("./downloads"))
        });
    std::fs::create_dir_all(&download_dir).expect("could not create download dir");
    tracing::info!("Downloads land in {}", download_dir.display());

    let state = AppState {
        jobs: Arc::new(Mutex::new(HashMap::new())),
        current_child: Arc::new(Mutex::new(None)),
        download_dir,
    };

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/jobs", post(create_job))
        .route("/api/jobs/:id", get(get_job))
        .route("/api/jobs/:id/abort", post(abort_job))
        .route("/api/jobs/:id/file", get(get_job_file))
        .layer(cors)
        .with_state(state);

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8420);
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port))
        .await
        .expect("could not bind port");
    tracing::info!("Abductor server listening on :{port}");
    axum::serve(listener, app).await.expect("server crashed");
}

fn dirs_download_dir() -> Option<PathBuf> {
    std::env::var("HOME")
        .ok()
        .map(|h| PathBuf::from(h).join("Downloads").join("Aliasist"))
}

async fn health() -> &'static str {
    "ok"
}

async fn create_job(
    State(state): State<AppState>,
    Json(body): Json<CreateJobBody>,
) -> Json<CreateJobResponse> {
    let id = Uuid::new_v4().to_string();
    let filename = format!("abductee_{}", &id[..8]);
    let save_path = state.download_dir.join(&filename);

    state.jobs.lock().await.insert(
        id.clone(),
        Job {
            status: JobStatus::Downloading {
                percent: 0.0,
                speed: None,
                eta: None,
            },
            file_path: None,
        },
    );

    let jobs = state.jobs.clone();
    let child_state = state.current_child.clone();
    let job_id = id.clone();
    let url = body.url;
    let save_path_str = save_path.to_string_lossy().to_string();

    tokio::spawn(async move {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<DownloadProgress>();
        let progress_jobs = jobs.clone();
        let progress_job_id = job_id.clone();
        let progress_task = tokio::spawn(async move {
            while let Some(p) = rx.recv().await {
                if let Some(job) = progress_jobs.lock().await.get_mut(&progress_job_id) {
                    job.status = JobStatus::Downloading {
                        percent: p.percent,
                        speed: p.speed,
                        eta: p.eta,
                    };
                }
            }
        });

        let result: DownloadResult =
            downloader::download(tx, child_state, url, save_path_str).await;
        progress_task.await.ok();

        if let Some(job) = jobs.lock().await.get_mut(&job_id) {
            job.status = if result.success {
                JobStatus::Done {
                    filename: result
                        .final_path
                        .as_deref()
                        .and_then(|p| PathBuf::from(p).file_name().map(|f| f.to_string_lossy().to_string()))
                        .unwrap_or_default(),
                }
            } else if result.error.as_deref() == Some("Aborted by user.") {
                JobStatus::Aborted
            } else {
                JobStatus::Error {
                    message: result.error.unwrap_or_else(|| "Unknown error".to_string()),
                }
            };
            job.file_path = result.final_path.map(PathBuf::from);
        }
    });

    Json(CreateJobResponse { id })
}

async fn get_job(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    match state.jobs.lock().await.get(&id) {
        Some(job) => Json(job.status.clone()).into_response(),
        None => (StatusCode::NOT_FOUND, "job not found").into_response(),
    }
}

async fn abort_job(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    let aborted = downloader::abort(state.current_child.clone()).await;
    if aborted {
        if let Some(job) = state.jobs.lock().await.get_mut(&id) {
            job.status = JobStatus::Aborted;
        }
    }
    Json(serde_json::json!({ "aborted": aborted })).into_response()
}

async fn get_job_file(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    let path = {
        let jobs = state.jobs.lock().await;
        match jobs.get(&id) {
            Some(job) => job.file_path.clone(),
            None => return (StatusCode::NOT_FOUND, "job not found").into_response(),
        }
    };

    let Some(path) = path else {
        return (StatusCode::CONFLICT, "job not finished yet").into_response();
    };

    match tokio::fs::read(&path).await {
        Ok(bytes) => {
            let filename = path
                .file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_else(|| "download.mp4".to_string());
            (
                [
                    (header::CONTENT_TYPE, "application/octet-stream".to_string()),
                    (
                        header::CONTENT_DISPOSITION,
                        format!("attachment; filename=\"{filename}\""),
                    ),
                ],
                bytes,
            )
                .into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, format!("{e}")).into_response(),
    }
}
