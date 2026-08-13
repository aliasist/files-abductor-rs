import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { randomJoke, type JokePhase } from "./jokes";
import { backend, type DownloadProgress } from "./backend";
import "./style.css";

type Phase = "idle" | "downloading" | "done" | "aborted" | "error";

function phaseToJokeBank(phase: Phase): JokePhase {
  switch (phase) {
    case "downloading":
      return "dl";
    case "done":
      return "done";
    case "aborted":
      return "abort";
    case "error":
      return "err";
    default:
      return "idle";
  }
}

export default function App() {
  const [url, setUrl] = useState("");
  const [savePath, setSavePath] = useState("");
  const [dlDir, setDlDir] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [joke, setJoke] = useState(randomJoke("idle"));
  const [statusText, setStatusText] = useState("👽 Awaiting target coordinates...");

  const jokeIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    backend.getDlDir().then(setDlDir);
  }, []);

  // Rotate jokes every ~2.4s while a phase is active, matching the original
  // app's cadence — long enough to actually read, short enough to feel alive.
  useEffect(() => {
    if (jokeIntervalRef.current) window.clearInterval(jokeIntervalRef.current);
    setJoke(randomJoke(phaseToJokeBank(phase)));
    if (phase === "downloading" || phase === "idle") {
      jokeIntervalRef.current = window.setInterval(() => {
        setJoke(randomJoke(phaseToJokeBank(phase)));
      }, 2400);
    }
    return () => {
      if (jokeIntervalRef.current) window.clearInterval(jokeIntervalRef.current);
    };
  }, [phase]);

  const handleBrowse = useCallback(async () => {
    const suggested = url.split("/").pop()?.split("?")[0] || "abducted-file";
    const result = await backend.browseSavePath(suggested);
    if (result) setSavePath(result);
  }, [url]);

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text.trim());
    } catch {
      setStatusText("👽 Clipboard access denied by Earth security protocols.");
    }
  }, []);

  const handleAbduct = useCallback(async () => {
    if (!url.trim() || !accepted) return;
    const finalSave = savePath || `${dlDir}/${url.split("/").pop()?.split("?")[0] || "file"}`;
    setPhase("downloading");
    setProgress(null);
    setStatusText("🛸 Aligning tractor beam...");

    try {
      const result = await backend.downloadFile(url.trim(), finalSave, (p) => {
        setProgress(p);
        setStatusText(
          `🛸 Abducting... ${p.percent.toFixed(1)}%${p.speed ? ` @ ${p.speed}` : ""}${
            p.eta ? ` · ETA ${p.eta}` : ""
          }`,
        );
      });
      if (result.success) {
        setPhase("done");
        setStatusText(
          backend.kind === "remote"
            ? "✅ Landed safely — pick where to save it."
            : `✅ Landed safely at ${result.final_path}`,
        );
      } else if (result.error?.toLowerCase().includes("abort")) {
        setPhase("aborted");
        setStatusText("🚨 Ejected. Mission scrubbed.");
      } else {
        setPhase("error");
        setStatusText(`❌ ${result.error ?? "Unknown anomaly."}`);
      }
    } catch (e) {
      setPhase("error");
      setStatusText(`❌ ${String(e)}`);
    }
  }, [url, savePath, dlDir, accepted]);

  const handleEject = useCallback(async () => {
    await backend.abortDownload();
    setPhase("aborted");
    setStatusText("🚨 Ejected. Mission scrubbed.");
  }, []);

  const isBusy = phase === "downloading";

  return (
    <div className="app">
      <motion.div
        className="app-inner"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      >
        <header className="header">
          <h1>👽 ALIASIST FILES ABDUCTOR</h1>
          <p className="subtitle">Abducting files from a galaxy far far away.. · www.aliasist.com</p>
        </header>

        <main className="panel">
          <label className="field-label">🎯 Target URL</label>
          <div className="input-row">
            <input
              type="text"
              className="text-input"
              placeholder="Paste any URL here..."
              spellCheck={false}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={isBusy}
            />
            <button className="btn btn-sm" onClick={handlePaste} disabled={isBusy}>
              📋 Paste
            </button>
          </div>

          {backend.kind === "tauri" && (
            <>
              <label className="field-label">📂 Landing Zone</label>
              <div className="input-row">
                <input
                  type="text"
                  className="text-input"
                  placeholder={dlDir ? `${dlDir}/...` : "Auto-filled..."}
                  spellCheck={false}
                  readOnly
                  value={savePath}
                />
                <button className="btn btn-sm" onClick={handleBrowse} disabled={isBusy}>
                  📁 Browse
                </button>
              </div>
            </>
          )}

          <div className="disclaimer">
            ⚠ DISCLAIMER* You are responsible for what you are authorized to abduct. Don't be a
            space pirate! 🏴‍☠️
            <label className="check-row">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
              />
              <span>🛡️ I'll obey and be on my best behavior.</span>
            </label>
          </div>

          <div className="action-row">
            <button
              className="btn btn-abduct"
              onClick={handleAbduct}
              disabled={isBusy || !url.trim() || !accepted}
            >
              🛸 Abduct File
            </button>
            <button className="btn btn-eject" onClick={handleEject} disabled={!isBusy}>
              🚨 Eject!
            </button>
            {progress && <span className="size-info">{progress.speed}</span>}
          </div>
        </main>

        <div className="progress-area">
          <AnimatePresence>
            {isBusy && (
              <motion.div
                className="progress-ufo"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: [0, -4, 0] }}
                exit={{ opacity: 0, y: -8 }}
                transition={{
                  opacity: { duration: 0.25 },
                  y: { duration: 1.6, repeat: Infinity, ease: "easeInOut" },
                }}
                aria-hidden="true"
              >
                🛸
              </motion.div>
            )}
          </AnimatePresence>
          <p className="status">{statusText}</p>
          <div className="track">
            <motion.div
              className="bar"
              animate={{ width: `${progress?.percent ?? 0}%` }}
              transition={{ duration: 0.3, ease: "easeOut" }}
            />
          </div>
        </div>

        <AnimatePresence mode="wait">
          <motion.p
            key={joke}
            className="joke"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.35 }}
          >
            {joke}
          </motion.p>
        </AnimatePresence>

        <footer className="footer">
          Aliasist Files Abductor v3.0 (Rust) · Fun project coded by dev_aliasist ·
          www.aliasist.com
        </footer>
      </motion.div>
    </div>
  );
}
