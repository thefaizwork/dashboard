"use client";

import { useMemo, useState } from "react";

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function canonicalKey(key) {
  return key.toLowerCase().replace(/[^a-z]/g, "");
}

function findArrayForKeys(payload, acceptedKeys) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  for (const [key, value] of Object.entries(payload)) {
    if (acceptedKeys.has(canonicalKey(key)) && Array.isArray(value)) return value;
  }
  for (const value of Object.values(payload)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = findArrayForKeys(value, acceptedKeys);
      if (nested) return nested;
    }
  }
  return null;
}

function findValueForKeys(payload, acceptedKeys) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  for (const [key, value] of Object.entries(payload)) {
    if (acceptedKeys.has(canonicalKey(key))) return value;
  }
  for (const value of Object.values(payload)) {
    if (value && typeof value === "object") {
      const nested = findValueForKeys(value, acceptedKeys);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

function findEndpointArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return null;
  return findArrayForKeys(payload, new Set(["endpoints", "results", "items", "data", "discoveredapis", "collectedapis"]));
}

function normalizeEndpoint(row, websiteHost, forceShadow = false) {
  if (typeof row === "string") {
    const routeMatch = row.trim().match(/^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(.+)$/i);
    const method = routeMatch?.[1]?.toUpperCase() ?? "GET";
    const route = routeMatch?.[2]?.trim() ?? row.trim();
    let parsed;
    try { parsed = new URL(route); } catch { parsed = null; }
    return {
      method,
      path: parsed ? `${parsed.pathname}${parsed.search}` : route,
      host: parsed?.hostname ?? websiteHost,
      source: parsed?.hostname ?? websiteHost,
      found: "Just now",
      shadow: forceShadow,
    };
  }
  if (!row || typeof row !== "object") return null;
  const method = String(row.method ?? row.httpMethod ?? row.verb ?? "GET").toUpperCase();
  const rawPath = row.path ?? row.endpoint ?? row.route ?? row.url;
  if (typeof rawPath !== "string" || !rawPath.trim()) return null;
  let endpointUrl;
  try { endpointUrl = new URL(rawPath); } catch { endpointUrl = null; }
  const host = String(row.host ?? row.hostname ?? row.domain ?? endpointUrl?.hostname ?? websiteHost);
  return {
    method: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"].includes(method) ? method : "GET",
    path: endpointUrl ? `${endpointUrl.pathname}${endpointUrl.search}` : rawPath,
    host,
    source: String(row.source ?? row.sourceUrl ?? host),
    found: String(row.found ?? row.lastFound ?? "Just now"),
    shadow: forceShadow || Boolean(row.shadowApi ?? row.shadow_api ?? row.isShadowApi ?? row.is_shadow_api ?? row.shadow ?? row.isShadow ?? row.is_shadow ?? (row.seen === true && row.documented === false)),
  };
}

function validResponseMessage(payload, fallback) {
  if (payload && typeof payload === "object") return payload.message ?? payload.error ?? fallback;
  return fallback;
}

export default function Home() {
  const [backendUrl, setBackendUrl] = useState("");
  const [requestMethod, setRequestMethod] = useState("POST");
  const [token, setToken] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [endpoints, setEndpoints] = useState([]);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [lastHost, setLastHost] = useState("");
  const [lastBackend, setLastBackend] = useState("");
  const [coverage, setCoverage] = useState(null);
  const [reportedTotal, setReportedTotal] = useState(0);

  const siteCount = new Set(endpoints.map((endpoint) => endpoint.host).filter(Boolean)).size;
  const shadowCount = endpoints.filter((endpoint) => endpoint.shadow).length;
  const totalCount = Math.max(endpoints.length, reportedTotal);
  const visibleEndpoints = useMemo(() => endpoints
    .map((endpoint, index) => ({ ...endpoint, index }))
    .filter((endpoint) => `${endpoint.method} ${endpoint.path} ${endpoint.host} ${endpoint.source} ${endpoint.shadow ? "shadow api undocumented" : ""}`.toLowerCase().includes(query.trim().toLowerCase())), [endpoints, query]);

  async function submitRequest(event) {
    event.preventDefault();
    if (!isHttpUrl(backendUrl.trim())) {
      setError("Enter a valid backend API URL, including https://");
      return;
    }
    if (!isHttpUrl(websiteUrl.trim())) {
      setError("Enter a valid website URL to send to your backend.");
      return;
    }

    setError("");
    setPending(true);
    try {
      const target = new URL(backendUrl.trim());
      const headers = token.trim() ? { Authorization: `Bearer ${token.trim()}` } : {};
      const options = { method: requestMethod, headers };
      if (requestMethod === "GET") {
        target.searchParams.set("url", websiteUrl.trim());
      } else {
        headers["Content-Type"] = "application/json";
        options.body = JSON.stringify({ url: websiteUrl.trim() });
      }

      const response = await fetch(target, options);
      const raw = await response.text();
      let payload = null;
      try {
        payload = raw ? JSON.parse(raw) : null;
      } catch {
        throw new Error("The backend response is not JSON. This page expects JSON containing an endpoint list.");
      }
      if (!response.ok) {
        throw new Error(validResponseMessage(payload, `Backend returned HTTP ${response.status}.`));
      }
      const rows = findEndpointArray(payload);
      const shadowRows = findArrayForKeys(payload, new Set(["seenbutundocumented", "shadowapis", "shadowapiendpoints"]));
      if (!rows && !shadowRows) {
        throw new Error("The backend responded, but no endpoint list was found. Return an endpoints array or a Seen but undocumented array.");
      }

      const websiteHost = new URL(websiteUrl.trim()).hostname;
      const reportedRows = [
        ...(rows ?? []).map((row) => normalizeEndpoint(row, websiteHost)),
        ...(shadowRows ?? []).map((row) => normalizeEndpoint(row, websiteHost, true)),
      ].filter(Boolean);
      const uniqueRows = new Map();
      for (const row of reportedRows) {
        const key = `${row.method} ${row.path} ${row.host}`;
        const previous = uniqueRows.get(key);
        uniqueRows.set(key, previous ? { ...previous, ...row, shadow: previous.shadow || row.shadow } : row);
      }
      const normalized = [...uniqueRows.values()];
      const documentedSeenValue = findValueForKeys(payload, new Set(["documentedandseen", "documentedseen"]));
      const documentedSeenCount = Number(documentedSeenValue) || 0;
      const shadowListCount = (shadowRows ?? []).length;
      const coverageValue = findValueForKeys(payload, new Set(["coverage", "coveragepercent"]));
      const coverageNumber = Number(typeof coverageValue === "object" && coverageValue !== null ? coverageValue.percent ?? coverageValue.value : coverageValue);
      setEndpoints(normalized);
      setReportedTotal(documentedSeenCount + shadowListCount);
      setCoverage(Number.isFinite(coverageNumber) ? `${coverageNumber.toFixed(1)}%` : typeof coverageValue === "string" ? coverageValue : null);
      setLastHost(websiteHost);
      setLastBackend(`${requestMethod} ${new URL(backendUrl.trim()).host}`);
      const shadowsFound = normalized.filter((endpoint) => endpoint.shadow).length;
      setToast(`Backend responded · ${shadowsFound} shadow API${shadowsFound === 1 ? "" : "s"} found`);
      window.setTimeout(() => setToast(""), 3200);
    } catch (cause) {
      setError(cause instanceof TypeError
        ? "Could not reach the backend. Check the URL and make sure its server allows browser requests (CORS)."
        : cause.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Main navigation">
        <a className="brand" href="#" aria-label="API Scout home">
          <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
          <span>api<span className="brand-light">scout</span></span>
        </a>
        <div className="nav-label">WORKSPACE</div>
        <button className="nav-item active" type="button"><span className="nav-icon grid-icon" aria-hidden="true">▦</span> API collection</button>
        <div className="sidebar-bottom">
          <div className="sidebar-divider" />
          <div className="workspace-row"><span className="workspace-avatar">W</span><span className="workspace-copy"><strong>My workspace</strong><small>API testing</small></span><span className="more">···</span></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><span className="crumb-sep">/</span><strong>API collection</strong></div>
          <div className="topbar-right"><span className="mock-badge"><span className="badge-dot" /> API integration</span><button className="help-button" type="button" aria-label="Help">?</button></div>
        </header>

        <div className="page-content">
          <section className="page-heading">
            <div><div className="eyebrow">DISCOVERY</div><h1>API collection</h1><p className="page-description">Find and review API endpoints across your websites.</p></div>
            <div className="updated-label"><span className="live-dot" /> Live API results</div>
          </section>

          <section className="collect-card" aria-labelledby="collect-title">
            <div className="collect-header"><div className="collect-icon" aria-hidden="true">↗</div><div><h2 id="collect-title">Connect your backend scanner</h2><p>Add your friend’s API endpoint, then send it a website to scan.</p></div></div>
            <form className="url-form" onSubmit={submitRequest}>
              <div className="backend-fields">
                <label className="field-label" htmlFor="backend-url">Backend API endpoint</label>
                <div className="backend-row">
                  <input id="backend-url" className="plain-input" type="url" placeholder="https://api.example.com/scan" autoComplete="url" value={backendUrl} onChange={(event) => setBackendUrl(event.target.value)} required />
                  <select id="request-method" className="method-select" aria-label="Backend request method" value={requestMethod} onChange={(event) => setRequestMethod(event.target.value)}><option value="POST">POST</option><option value="GET">GET</option></select>
                </div>
                <label className="field-label token-label" htmlFor="backend-token">Bearer token <span>(optional)</span></label>
                <input id="backend-token" className="plain-input token-input" type="password" placeholder="Paste token if your API requires one" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} />
                <p className="request-hint">POST sends <code>{'{ "url": "…" }'}</code>; GET sends <code>?url=…</code>. Return JSON as <code>[]</code> or <code>{'{ "endpoints": [] }'}</code>. Token stays in this tab.</p>
              </div>
              <div className="website-row">
                <label className="url-input-wrap" htmlFor="website-url"><span aria-hidden="true" className="url-icon">⊕</span><input id="website-url" name="url" type="url" placeholder="https://website-to-scan.com" autoComplete="url" value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} required /><span className="input-hint">Website to scan</span></label>
                <button className="primary-button" type="submit" disabled={pending}><span className="button-icon" aria-hidden="true">{pending ? "◌" : "⌕"}</span> {pending ? "Waiting…" : "Send test request"}</button>
              </div>
            </form>
            {error && <p className="form-error" role="alert">{error}</p>}
            {pending && <div className="progress-panel" aria-live="polite"><div className="progress-topline"><span className="progress-title"><span className="spinner" aria-hidden="true" /> <span>Waiting for {new URL(backendUrl).host}…</span></span></div><div className="progress-track"><div className="progress-fill indeterminate" /></div><p className="progress-help">Your backend is processing the scan. Results will appear here when it responds.</p></div>}
          </section>

          <section className="summary-grid" aria-label="Collection summary">
            <article className="summary-card"><div className="summary-label">TOTAL ENDPOINTS <span className="summary-symbol">↗</span></div><div className="summary-value">{totalCount}</div><div className="summary-note">Across <strong>{siteCount}</strong> websites</div></article>
            <article className="summary-card"><div className="summary-label">SHADOW APIS <span className="shadow-indicator" /></div><div className="summary-value">{shadowCount}</div><div className="summary-note">Seen but undocumented</div></article>
            <article className="summary-card"><div className="summary-label">COVERAGE <span className="summary-symbol">%</span></div><div className="summary-value">{coverage ?? "—"}</div><div className="summary-note">Reported by backend</div></article>
            <article className="summary-card"><div className="summary-label">LAST COLLECTION <span className="summary-symbol">◷</span></div><div className="summary-value summary-date">{lastHost ? "Just now" : "—"}</div><div className="summary-note">{lastHost || "No requests yet"}</div></article>
          </section>

          <section className="endpoint-section" aria-labelledby="endpoint-title">
            <div className="section-heading"><div><h2 id="endpoint-title">Discovered endpoints</h2><p>Review endpoints found across your collected websites.</p></div><div className="list-tools"><label className="search-box"><span aria-hidden="true">⌕</span><input type="search" placeholder="Search endpoints" aria-label="Search endpoints" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div></div>
            <div className="table-card">
              <div className="table-toolbar"><div className="table-view-label">All endpoints</div><div className="table-meta"><span className="table-dot" />{visibleEndpoints.length} {visibleEndpoints.length === 1 ? "endpoint" : "endpoints"}</div></div>
              {visibleEndpoints.length > 0 ? <div className="table-scroll"><table><thead><tr><th scope="col">METHOD</th><th scope="col">ENDPOINT</th><th scope="col">SOURCE</th><th scope="col">LAST FOUND</th></tr></thead><tbody>{visibleEndpoints.map((endpoint) => <tr key={`${endpoint.index}-${endpoint.method}-${endpoint.path}`}><td><span className={`method-pill method-${endpoint.method}`}>{endpoint.method}</span></td><td><span className="endpoint-path">{endpoint.path}</span>{endpoint.shadow && <span className="shadow-badge">SHADOW API</span>}</td><td><span className="endpoint-host">{endpoint.source}</span></td><td>{endpoint.found}</td></tr>)}</tbody></table></div> : <div className="empty-state"><div className="empty-icon">⌕</div><strong>{endpoints.length === 0 ? "No endpoints found" : "No matching endpoints"}</strong><p>{endpoints.length === 0 ? "Connect your backend and send a website to scan." : "Try another search."}</p></div>}
              <div className="table-footer"><span>Showing <strong>{visibleEndpoints.length}</strong> endpoints</span><span>{lastBackend || "Waiting for backend connection"}</span></div>
            </div>
          </section>
          <footer className="page-footer"><span>API Scout <span className="footer-dot">·</span> API discovery dashboard</span><span>Backend connection</span></footer>
        </div>
      </main>
      {toast && <div className="toast visible" role="status" aria-live="polite">{toast}</div>}
    </div>
  );
}
