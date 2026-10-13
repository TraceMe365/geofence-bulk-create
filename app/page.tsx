"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { csvToZones } from "@/lib/csv";
import { argbColor, DEFAULT_BASE_URL, DEFAULT_LOGIN_URL } from "@/lib/wialon";
import type { Zone, BatchEvent } from "@/lib/types";

interface Geofence {
  id: number;
  name: string;
  type: number;
  lat: number | null;
  lng: number | null;
  radius: number | null;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.slice(0, 2), 16) || 0,
    g: parseInt(clean.slice(2, 4), 16) || 0,
    b: parseInt(clean.slice(4, 6), 16) || 0,
  };
}

export default function Home() {
  const [tab, setTab] = useState<"import" | "view">("import");
  const [token, setToken] = useState("");
  const [userName, setUserName] = useState("");
  const [authError, setAuthError] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [loginUrl, setLoginUrl] = useState(DEFAULT_LOGIN_URL);
  const [resourceId, setResourceId] = useState("");
  const [resources, setResources] = useState<{ id: number; name: string }[]>([]);
  const [resourcesLoading, setResourcesLoading] = useState(false);
  const [resourcesError, setResourcesError] = useState("");
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

  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [geofencesLoading, setGeofencesLoading] = useState(false);
  const [geofencesError, setGeofencesError] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  const color = useMemo(() => {
    const { r, g, b } = hexToRgb(colorHex);
    return argbColor(r, g, b, opacity);
  }, [colorHex, opacity]);

  const loadResources = useCallback(
    async (authToken: string) => {
      if (!authToken) return;
      setResourcesLoading(true);
      setResourcesError("");
      setResources([]);
      setResourceId("");
      try {
        const res = await fetch("/api/resources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: authToken, baseUrl }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load resources.");
        const loaded: { id: number; name: string }[] = data.resources || [];
        setResources(loaded);
        if (loaded.length === 0) setResourcesError("No resources found for this account.");
      } catch (err) {
        setResourcesError(err instanceof Error ? err.message : String(err));
      } finally {
        setResourcesLoading(false);
      }
    },
    [baseUrl]
  );

  function signIn() {
    setAuthError("");
    const params = new URLSearchParams({
      client_id: "Geofence Bulk Importer",
      access_type: "-1",
      activation_time: "0",
      duration: "3600",
      flags: "1",
      redirect_uri: `${window.location.origin}/auth/callback`,
      response_type: "token",
    });
    const popup = window.open(
      `${loginUrl}?${params.toString()}`,
      "wialon_login",
      "width=480,height=640"
    );
    if (!popup) {
      setAuthError("Popup blocked. Allow popups for this site and try again.");
      return;
    }
    setSigningIn(true);
  }

  function signOut() {
    setToken("");
    setUserName("");
    setResources([]);
    setResourceId("");
    setResourcesError("");
    setGeofences([]);
    setGeofencesError("");
  }

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.source !== "wialon-auth") return;
      setSigningIn(false);
      if (data.accessToken) {
        setToken(data.accessToken);
        setUserName(data.userName || "");
        setAuthError("");
        loadResources(data.accessToken);
      } else {
        setAuthError(data.error || "Sign-in failed.");
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [loadResources]);

  useEffect(() => {
    setGeofences([]);
    setGeofencesError("");
  }, [resourceId]);

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

  async function loadGeofences() {
    if (!token || !resourceId) return;
    setGeofencesLoading(true);
    setGeofencesError("");
    setGeofences([]);
    try {
      const res = await fetch("/api/zones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, resourceId: Number(resourceId), baseUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load geofences.");
      const loaded: Geofence[] = data.zones || [];
      setGeofences(loaded);
      if (loaded.length === 0) setGeofencesError("No geofences found on this resource.");
    } catch (err) {
      setGeofencesError(err instanceof Error ? err.message : String(err));
    } finally {
      setGeofencesLoading(false);
    }
  }

  function downloadGeofencesExcel() {
    if (geofences.length === 0) return;
    const rows = geofences.map((z) => ({
      Name: z.name,
      Latitude: z.lat,
      Longitude: z.lng,
      "Radius (m)": z.radius,
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Geofences");
    const resourceLabel = resources.find((r) => String(r.id) === resourceId)?.name || resourceId;
    XLSX.writeFile(workbook, `geofences-${resourceLabel}.xlsx`);
  }

  function resetAll() {
    signOut();
    setZones([]);
    setWarnings([]);
    setParseError("");
    setFileName("");
    setLog([]);
    setSummary(null);
    setProgress({ done: 0, total: 0 });
    setGeofences([]);
    setGeofencesError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const canImport = !!token && !!resourceId && zones.length > 0 && !running;

  return (
    <div className="wrap">
      <h1>Wialon Geofence Manager</h1>
      <p className="subtitle">Bulk-create geofences from a CSV, or view and export existing ones to Excel.</p>

      <div className="notice">
        Signing in opens Wialon&apos;s own login page in a popup. Your credentials go directly to
        Wialon, never to this app — it only receives a short-lived session token back, which is
        sent once to this app&apos;s serverless endpoint per action and never written to disk, a
        database, or logs. Nothing is stored between visits — refreshing the page clears
        everything.
      </div>

      <div className="panel">
        <div className="field">
          <label>Wialon account</label>
          {token ? (
            <div className="auth-status">
              <span className="auth-dot" />
              <span>Signed in{userName ? ` as ${userName}` : ""}</span>
              <button type="button" className="secondary" onClick={signOut}>
                Sign out
              </button>
            </div>
          ) : (
            <div className="auth-status">
              <button type="button" onClick={signIn} disabled={signingIn}>
                {signingIn ? "Waiting for sign-in…" : "Sign in with Wialon"}
              </button>
            </div>
          )}
          {authError && <div className="err-text" style={{ marginTop: 6 }}>{authError}</div>}
          <div className="hint">
            The account needs geofence create/edit rights on the resource (not just view).
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label htmlFor="resource">Resource</label>
            <div className="select-row">
              <div className="select-wrap">
                <select
                  id="resource"
                  value={resourceId}
                  onChange={(e) => setResourceId(e.target.value)}
                  disabled={resources.length === 0}
                >
                  <option value="">
                    {resources.length === 0 ? "Load resources to select…" : "Select a resource…"}
                  </option>
                  {resources.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.id})
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="secondary"
                onClick={() => loadResources(token)}
                disabled={!token || resourcesLoading}
              >
                {resourcesLoading ? "Loading…" : resources.length > 0 ? "Reload" : "Load resources"}
              </button>
            </div>
            {resourcesError && <div className="err-text" style={{ marginTop: 4 }}>{resourcesError}</div>}
            {!resourcesError && !token && (
              <div className="hint">Sign in above, then load your resources.</div>
            )}
          </div>
          <div className="field">
            <label htmlFor="baseUrl">API base URL</label>
            <input id="baseUrl" type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </div>
        </div>

        <details>
          <summary>Advanced options</summary>
          <div className="row">
            <div className="field">
              <label htmlFor="loginUrl">Wialon login page URL</label>
              <input
                id="loginUrl"
                type="text"
                value={loginUrl}
                onChange={(e) => setLoginUrl(e.target.value)}
              />
              <div className="hint">Change this if you use a private Wialon server.</div>
            </div>
          </div>
        </details>
      </div>

      <div className="tabs">
        <button
          type="button"
          className={tab === "import" ? "tab active" : "tab"}
          onClick={() => setTab("import")}
        >
          Import geofences
        </button>
        <button
          type="button"
          className={tab === "view" ? "tab active" : "tab"}
          onClick={() => setTab("view")}
        >
          View &amp; export
        </button>
      </div>

      {tab === "import" && (
        <>
      <div className="panel">
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
          <div className="hint">
            <a href="/sample.csv" download>
              Download sample CSV
            </a>
          </div>
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
        </>
      )}

      {tab === "view" && (
        <>
          <div className="panel">
            <div className="actions" style={{ marginTop: 0 }}>
              <button
                type="button"
                onClick={loadGeofences}
                disabled={!token || !resourceId || geofencesLoading}
              >
                {geofencesLoading ? "Loading…" : "Load geofences"}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={downloadGeofencesExcel}
                disabled={geofences.length === 0}
              >
                Download as Excel
              </button>
            </div>
            {geofencesError && (
              <div className="err-text" style={{ marginTop: 8 }}>
                {geofencesError}
              </div>
            )}
            {!geofencesError && (!token || !resourceId) && (
              <div className="hint" style={{ marginTop: 8 }}>
                Sign in and select a resource above, then load geofences.
              </div>
            )}
          </div>

          {geofences.length > 0 && (
            <div className="panel">
              <strong>
                {geofences.length} geofence{geofences.length === 1 ? "" : "s"}
              </strong>
              <div style={{ marginTop: 10, maxHeight: 420, overflowY: "auto" }}>
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
                    {geofences.map((z) => (
                      <tr key={z.id}>
                        <td>{z.name}</td>
                        <td>{z.lat ?? "—"}</td>
                        <td>{z.lng ?? "—"}</td>
                        <td>{z.radius ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
