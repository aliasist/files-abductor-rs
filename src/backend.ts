// Two runtimes, one interface. On desktop (Tauri) yt-dlp runs as a local
// subprocess the Rust backend spawns directly. On Android, subprocess
// spawning isn't allowed at all — so the mobile build instead talks HTTP to
// abductor-server (the same download engine, running headless on a machine
// that can run yt-dlp, tunneled in via Cloudflare at
// https://abductor-dev.aliasist.tech). Callers just import `backend` and
// don't need to know which one they're talking to.

export interface DownloadProgress {
  percent: number;
  speed?: string;
  eta?: string;
}

export interface DownloadResult {
  success: boolean;
  final_path?: string;
  error?: string;
}

export interface Backend {
  kind: "tauri" | "remote";
  getDlDir(): Promise<string>;
  downloadFile(
    url: string,
    savePath: string,
    onProgress: (p: DownloadProgress) => void,
  ): Promise<DownloadResult>;
  abortDownload(): Promise<boolean>;
  /** Only meaningful on desktop — mobile has no file-picker save dialog. */
  browseSavePath(suggestedName: string): Promise<string | null>;
}

const isTauri = typeof (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== "undefined";

// Same machine the Ollama lab tunnel points at — see aliasist-tech's
// ollama-dev.aliasist.tech for the sibling setup this mirrors.
const REMOTE_BACKEND_URL = import.meta.env.VITE_ABDUCTOR_BACKEND_URL || "https://abductor-dev.aliasist.tech";

class TauriBackend implements Backend {
  kind = "tauri" as const;

  async getDlDir(): Promise<string> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("get_dl_dir");
  }

  async downloadFile(
    url: string,
    savePath: string,
    onProgress: (p: DownloadProgress) => void,
  ): Promise<DownloadResult> {
    const { invoke } = await import("@tauri-apps/api/core");
    const { listen } = await import("@tauri-apps/api/event");

    const unlisten = await listen<DownloadProgress>("download://progress", (event) => {
      onProgress(event.payload);
    });

    try {
      return await invoke<DownloadResult>("download_file", { url, savePath });
    } finally {
      unlisten();
    }
  }

  async abortDownload(): Promise<boolean> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<boolean>("abort_download");
  }

  async browseSavePath(suggestedName: string): Promise<string | null> {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const dlDir = await this.getDlDir();
    const result = await open({
      directory: false,
      multiple: false,
      defaultPath: `${dlDir}/${suggestedName}`,
      title: "Choose landing zone",
    });
    return typeof result === "string" ? result : null;
  }
}

class RemoteBackend implements Backend {
  kind = "remote" as const;
  private currentJobId: string | null = null;
  private pollTimer: number | null = null;

  async getDlDir(): Promise<string> {
    // Nothing to browse on mobile — files land in the app's cache, then get
    // handed to the OS share sheet so the user picks where they actually
    // want them (Downloads, Drive, etc). This is just informational text.
    return "Downloads (via share sheet)";
  }

  async downloadFile(
    url: string,
    _savePath: string,
    onProgress: (p: DownloadProgress) => void,
  ): Promise<DownloadResult> {
    const createRes = await fetch(`${REMOTE_BACKEND_URL}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!createRes.ok) {
      return { success: false, error: `Server error (${createRes.status})` };
    }
    const { id } = (await createRes.json()) as { id: string };
    this.currentJobId = id;

    return new Promise((resolve) => {
      const poll = async () => {
        try {
          const res = await fetch(`${REMOTE_BACKEND_URL}/api/jobs/${id}`);
          const job = await res.json();

          if (job.status === "downloading") {
            onProgress({ percent: job.percent, speed: job.speed, eta: job.eta });
            this.pollTimer = window.setTimeout(poll, 1000);
            return;
          }

          if (job.status === "done") {
            const saved = await this.fetchAndShareFile(id, job.filename);
            this.currentJobId = null;
            resolve(saved);
            return;
          }

          if (job.status === "aborted") {
            this.currentJobId = null;
            resolve({ success: false, error: "Aborted by user." });
            return;
          }

          // error
          this.currentJobId = null;
          resolve({ success: false, error: job.message || "Download failed." });
        } catch (e) {
          this.currentJobId = null;
          resolve({ success: false, error: String(e) });
        }
      };
      poll();
    });
  }

  private async fetchAndShareFile(jobId: string, filename: string): Promise<DownloadResult> {
    try {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      const { Share } = await import("@capacitor/share");

      const fileRes = await fetch(`${REMOTE_BACKEND_URL}/api/jobs/${jobId}/file`);
      const blob = await fileRes.blob();
      const base64 = await blobToBase64(blob);

      const write = await Filesystem.writeFile({
        path: filename,
        data: base64,
        directory: Directory.Cache,
      });

      await Share.share({
        title: filename,
        url: write.uri,
        dialogTitle: "Save your abducted file",
      });

      return { success: true, final_path: write.uri };
    } catch (e) {
      return { success: false, error: `Downloaded but couldn't share/save: ${e}` };
    }
  }

  async abortDownload(): Promise<boolean> {
    if (this.pollTimer) {
      window.clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (!this.currentJobId) return false;
    const res = await fetch(`${REMOTE_BACKEND_URL}/api/jobs/${this.currentJobId}/abort`, {
      method: "POST",
    });
    const data = await res.json();
    return Boolean(data.aborted);
  }

  async browseSavePath(): Promise<string | null> {
    return null;
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // Strip the "data:<mime>;base64," prefix — Filesystem.writeFile wants
      // raw base64 only.
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export const backend: Backend = isTauri ? new TauriBackend() : new RemoteBackend();
