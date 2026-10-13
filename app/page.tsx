"use client";

import { useMemo, useRef, useState } from "react";
import { csvToZones } from "@/lib/csv";
import { argbColor, DEFAULT_BASE_URL } from "@/lib/wialon";
import type { Zone, BatchEvent } from "@/lib/types";

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.slice(0, 2), 16) || 0,
    g: parseInt(clean.slice(2, 4), 16) || 0,
    b: parseInt(clean.slice(4, 6), 16) || 0,
  };
}

export default function Home() {
  const [token, setToken] = useState("");
  const [resourceId, setResourceId] = useState("");
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [defaultRadius, setDefaultRadius] = useState(100);
  const [colorHex, setColorHex] = useState("#c991e4");
  const [opacity, setOpacity] = useState(70);
  const [batchSize, setBatchSize] = useState(100);

  const [fileName, setFileName] = useState("");
  const [zones, setZones] = useState<Zone[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [parseError, setParseError] = useState("");

  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [summary, setSummary] = useState<{ created: number; failed: number; total: number; failures: { name: string; error: unknown }[] } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const color = useMemo(() => {
    const { r, g, b } = hexToRgb(colorHex);
    return argbColor(r, g, b, opacity);
  }, [colorHex, opacity]);

  function handleFile(file: File) {
    setFileName(file.name);
    setParseError("");
    setSummary(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || "");
        const { zones: parsed, warnings: w } = csvToZones(text, defaultRadius);
        setZones(parsed);
        setWarnings(w);
      } catch (err) {
        setZones([]);
        setWarnings([]);
        setParseError(err instanceof Error ? err.message : String(err));
      }
    };
    reader.readAsText(file);
  }

  async function startImport() {
    if (!token || !resourceId || zones.length === 0) return;
    setRunning(true);
    setLog([]);
    setSummary(null);
    setProgress({ done: 0, total: 0 });

    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          resourceId: Number(resourceId),
          baseUrl,
          color,
          batchSize,
          zones,
        }),
      });

      if (!res.body) throw new Error("No response stream from server.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;

      while (!finished) {
        const { value, done } = await reader.read();
        finished = done;
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event: BatchEvent = JSON.parse(line);
          handleEvent(event);
        }
      }
      if (buffer.trim()) {
        handleEvent(JSON.parse(buffer));
      }
    } catch (err) {
      setLog((prev) => [...prev, `Fatal error: ${err instanceof Error ? err.message : String(err)}`]);
    } finally {
      setRunning(false);
    }
  }

  function handleEvent(event: BatchEvent) {
    if (event.type === "status" && event.message) {
      setLog((prev) => [...prev, event.message!]);
    } else if (event.type === "batch") {
      setLog((prev) => [
        ...prev,
        `Batch ${event.batchIndex}/${event.totalBatches}: +${event.batchCreated} created, ${event.batchFailed} failed (running total: ${event.createdSoFar} created, ${event.failedSoFar} failed)`,
      ]);
      setProgress({ done: event.batchIndex || 0, total: event.totalBatches || 0 });
    } else if (event.type === "done") {
      setLog((prev) => [...prev, `Done. Created: ${event.created}, Failed: ${event.failed}, Total: ${event.total}`]);
      setSummary({
        created: event.created || 0,
        failed: event.failed || 0,
        total: event.total || 0,
        failures: event.failures || [],
      });
    } else if (event.type === "error" && event.message) {
      setLog((prev) => [...prev, `Error: ${event.message}`]);
    }
  }

  function downloadResults() {
    if (!summary) return;
    const lines = ["name,status,error"];
    for (const f of summary.failures) {
      lines.push(`"${f.name.replace(/"/g, '""')}",failed,"${JSON.stringify(f.error).replace(/"/g, '""')}"`);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "wialon-import-failures.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function resetAll() {
    setToken("");
    setResourceId("");
    setZones([]);
    setWarnings([]);
    setParseError("");
    setFileName("");
    setLog([]);
    setSummary(null);
    setProgress({ done: 0, total: 0 });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const canImport = !!token && !!resourceId && zones.length > 0 && !running;

  return (
    <div className="wrap">
      <h1>Wialon Geofence Bulk Importer</h1>
      <p className="subtitle">Bulk-create circular geofences in Wialon from a CSV file.</p>

      <div className="notice">
        Your token and CSV data are sent once to this app&apos;s serverless endpoint, forwarded
        directly to Wialon&apos;s API for this request, and are never written to disk, a database,
        or logs. Nothing is stored between visits — refreshing the page clears everything.
      </div>

      <div className="panel">
        <div className="field">
          <label htmlFor="token">Wialon API token</label>
          <input
            id="token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste your Wialon token"
            autoComplete="off"
          />
          <div className="hint">
            Create one at hosting.wialon.com with geofence create/edit rights (not just view).
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label htmlFor="resource">Resource ID</label>
            <input
              id="resource"
              type="text"
              inputMode="numeric"
              value={resourceId}
              onChange={(e) => setResourceId(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="e.g. 29982789"
            />
          </div>
          <div className="field">
            <label htmlFor="baseUrl">API base URL</label>
            <input id="baseUrl" type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="csv">CSV file (name, latitude, longitude, radius?)</label>
          <input
            id="csv"
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
          {fileName && <div className="hint">Loaded: {fileName}</div>}
        </div>

        <details>
          <summary>Advanced options</summary>
          <div className="row">
            <div className="field">
              <label htmlFor="radius">Default radius (m)</label>
              <input
                id="radius"
                type="number"
                min={1}
                value={defaultRadius}
                onChange={(e) => setDefaultRadius(Number(e.target.value) || 100)}
              />
              <div className="hint">Used when a row has no radius column.</div>
            </div>
            <div className="field">
              <label htmlFor="batchSize">Batch size</label>
              <input
                id="batchSize"
                type="number"
                min={1}
                max={500}
                value={batchSize}
                onChange={(e) => setBatchSize(Number(e.target.value) || 100)}
              />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="color">Zone color</label>
              <input id="color" type="color" value={colorHex} onChange={(e) => setColorHex(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="opacity">Opacity (%)</label>
              <input
                id="opacity"
                type="number"
                min={0}
                max={100}
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value) || 0)}
              />
            </div>
          </div>
        </details>
      </div>

      {parseError && (
        <div className="panel">
          <span className="err-text">{parseError}</span>
        </div>
      )}

      {zones.length > 0 && (
        <div className="panel">
          <strong>
            {zones.length} valid row{zones.length === 1 ? "" : "s"} parsed
          </strong>
          {warnings.length > 0 && (
            <div style={{ marginTop: 6 }}>
              {warnings.map((w, i) => (
                <div key={i} className="warn-text">
                  {w}
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 10, maxHeight: 220, overflowY: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Latitude</th>
                  <th>Longitude</th>
                  <th>Radius (m)</th>
                </tr>
              </thead>
              <tbody>
                {zones.slice(0, 50).map((z, i) => (
                  <tr key={i}>
                    <td>{z.name}</td>
                    <td>{z.lat}</td>
                    <td>{z.lng}</td>
                    <td>{z.radius}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {zones.length > 50 && <div className="hint">...and {zones.length - 50} more</div>}
          </div>
        </div>
      )}

      <div className="actions">
        <button onClick={startImport} disabled={!canImport}>
          {running ? "Importing..." : `Start Import (${zones.length})`}
        </button>
        <button className="secondary" onClick={resetAll} disabled={running}>
          Reset
        </button>
      </div>

      {(running || log.length > 0) && (
        <div className="panel" style={{ marginTop: 16 }}>
          {progress.total > 0 && (
            <div className="progress-outer">
              <div
                className="progress-inner"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
          )}
          <div className="log">{log.join("\n")}</div>
        </div>
      )}

      {summary && (
        <div className="panel">
          <div className="summary-grid">
            <div>
              <strong className="ok-text">{summary.created}</strong>
              Created
            </div>
            <div>
              <strong className={summary.failed > 0 ? "err-text" : undefined}>{summary.failed}</strong>
              Failed
            </div>
            <div>
              <strong>{summary.total}</strong>
              Total
            </div>
          </div>
          {summary.failures.length > 0 && (
            <button className="secondary" onClick={downloadResults}>
              Download failures as CSV
            </button>
          )}
        </div>
      )}
    </div>
  );
}
