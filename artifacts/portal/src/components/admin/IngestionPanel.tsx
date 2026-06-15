import React, { useEffect, useState } from "react";
import { Loader2, TriangleAlert, Copy, Check, Upload } from "lucide-react";
import { useAuth } from "../../lib/AuthContext";
import { Tenant } from "../../types";
import * as ingestionApi from "../../lib/ingestionApi";
import type {
  IngestionKey,
  WebhookSource,
  MintedKey,
  MintedSource,
  UploadReport,
} from "../../lib/ingestionApi";

// The ingestion console (Phase AE). A provider mints and revokes the credentials
// for the five ingestion paths against a chosen tenant, and can drive a manual
// upload to watch the derive-and-discard boundary in real time. Every minted
// credential is shown exactly once (the server stores only its hash or
// ciphertext); the upload panel renders the server's honest account of what was
// derived versus what raw input was discarded, which is itself the trust feature.
export function IngestionPanel({ tenants }: { tenants: Tenant[] }) {
  const { logout } = useAuth();
  const [tenantId, setTenantId] = useState("");

  if (tenants.length === 0) {
    return (
      <div className="card" style={{ padding: 32, textAlign: "center", color: "var(--slate-light)" }}>
        No tenants exist yet. Create a tenant before configuring ingestion.
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 32 }}>
      <div>
        <label className="label-base">Tenant</label>
        <select
          className="input-base"
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
          style={{ maxWidth: 420 }}
        >
          <option value="">Select a tenant...</option>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {tenantId === "" ? (
        <div className="card" style={{ padding: 32, textAlign: "center", color: "var(--slate-light)" }}>
          Select a tenant to manage its ingestion keys, webhook sources, and uploads.
        </div>
      ) : (
        <>
          <KeysSection tenantId={tenantId} logout={logout} />
          <WebhookSection tenantId={tenantId} logout={logout} />
          <UploadSection tenantId={tenantId} logout={logout} />
        </>
      )}
    </div>
  );
}

function RevealBox({ title, value, hint }: { title: string; value: string; hint: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div
      style={{
        marginTop: 24,
        padding: 24,
        background: "var(--cream-light)",
        border: "1px dashed var(--gold)",
        borderRadius: 4,
      }}
    >
      <div className="eyebrow" style={{ color: "var(--coral-ink)", marginBottom: 8 }}>
        {title} - {hint}
      </div>
      <div
        className="font-mono"
        style={{ fontSize: 14, color: "var(--navy)", wordBreak: "break-all", marginBottom: 16 }}
      >
        {value}
      </div>
      <button onClick={copy} className="btn-ghost">
        {copied ? (
          <>
            <Check size={14} /> Copied
          </>
        ) : (
          <>
            <Copy size={14} /> Copy to Clipboard
          </>
        )}
      </button>
    </div>
  );
}

function statePill(status: string) {
  switch (status) {
    case "active":
      return <span className="pill pill-verified">Active</span>;
    case "revoked":
      return <span className="pill pill-red">Revoked</span>;
    default:
      return <span className="pill pill-navy">{status}</span>;
  }
}

function KeysSection({ tenantId, logout }: { tenantId: string; logout: () => void }) {
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [keys, setKeys] = useState<IngestionKey[]>([]);
  const [label, setLabel] = useState("");
  const [minting, setMinting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [minted, setMinted] = useState<MintedKey | null>(null);

  const load = async () => {
    const result = await ingestionApi.fetchIngestionKeys(tenantId);
    if ("unauthorized" in result) return logout();
    if (result.state === "error") {
      setState("error");
      return;
    }
    setKeys(result.items);
    setState(result.state);
  };

  useEffect(() => {
    setState("loading");
    setMinted(null);
    load();
  }, [tenantId]);

  const handleMint = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setMinting(true);
    setMinted(null);
    const result = await ingestionApi.mintIngestionKey(tenantId, label);
    setMinting(false);
    if ("unauthorized" in result) return logout();
    if ("error" in result) {
      setErrorMsg("Failed to mint ingestion key.");
      return;
    }
    setMinted(result.minted);
    setLabel("");
    load();
  };

  const handleRevoke = async (keyId: string) => {
    const result = await ingestionApi.revokeIngestionKey(tenantId, keyId);
    if ("unauthorized" in result) return logout();
    if ("ok" in result) load();
  };

  return (
    <div className="card card-accent-gold">
      <h3 className="font-serif" style={{ fontSize: 20, fontWeight: 600, color: "var(--navy)", marginBottom: 16 }}>
        Ingestion Keys
      </h3>
      <p style={{ color: "var(--slate-light)", fontSize: 13, marginBottom: 16 }}>
        Bearer keys for the Ingestion API, SFTP drop, and MCP server. Hashed at rest and
        revocable; the token is shown once at mint.
      </p>
      {errorMsg && (
        <div className="alert-error" style={{ marginBottom: 16 }}>
          <TriangleAlert size={16} />
          <span>{errorMsg}</span>
        </div>
      )}
      <form onSubmit={handleMint} style={{ display: "flex", gap: 16, alignItems: "end" }}>
        <div style={{ flex: 1 }}>
          <label className="label-base">Label</label>
          <input
            className="input-base"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Salesforce nightly export"
            required
          />
        </div>
        <button type="submit" className="btn-primary" disabled={minting}>
          {minting ? <Loader2 size={16} className="animate-spin" /> : "Mint Key"}
        </button>
      </form>

      {minted && (
        <RevealBox title="Ingestion key" value={minted.token} hint="copy it now, it will not be shown again" />
      )}

      <div style={{ marginTop: 24 }}>
        {state === "loading" ? (
          <div className="skeleton" style={{ height: 80 }} />
        ) : state === "error" ? (
          <div style={{ color: "var(--red)" }}>Failed to load ingestion keys.</div>
        ) : state === "empty" ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--slate-light)" }}>
            No ingestion keys minted for this tenant.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table-base">
              <thead>
                <tr>
                  <th>Label / ID</th>
                  <th>State</th>
                  <th>Last Used</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <td>
                      <div style={{ fontWeight: 500, color: "var(--navy)" }}>{k.label}</div>
                      <div className="font-mono" style={{ fontSize: 11, color: "var(--slate-light)" }}>
                        {k.id.slice(0, 8)}...
                      </div>
                    </td>
                    <td>{statePill(k.status)}</td>
                    <td>{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "Never"}</td>
                    <td>{new Date(k.createdAt).toLocaleDateString()}</td>
                    <td>
                      {k.status === "active" && (
                        <button
                          onClick={() => handleRevoke(k.id)}
                          className="btn-ghost"
                          style={{ height: 24, padding: "0 8px", fontSize: 11 }}
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function WebhookSection({ tenantId, logout }: { tenantId: string; logout: () => void }) {
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [sources, setSources] = useState<WebhookSource[]>([]);
  const [label, setLabel] = useState("");
  const [targetLayer, setTargetLayer] = useState("");
  const [minting, setMinting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [minted, setMinted] = useState<MintedSource | null>(null);

  const load = async () => {
    const result = await ingestionApi.fetchWebhookSources(tenantId);
    if ("unauthorized" in result) return logout();
    if (result.state === "error") {
      setState("error");
      return;
    }
    setSources(result.items);
    setState(result.state);
  };

  useEffect(() => {
    setState("loading");
    setMinted(null);
    load();
  }, [tenantId]);

  const handleMint = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setMinting(true);
    setMinted(null);
    const result = await ingestionApi.mintWebhookSource(tenantId, label, targetLayer);
    setMinting(false);
    if ("unauthorized" in result) return logout();
    if ("error" in result) {
      setErrorMsg(
        result.error === "layer_not_enabled" || result.error === "unknown_layer"
          ? "That layer is not enabled for this tenant."
          : "Failed to mint webhook source.",
      );
      return;
    }
    setMinted(result.minted);
    setLabel("");
    setTargetLayer("");
    load();
  };

  const handleRevoke = async (sourceId: string) => {
    const result = await ingestionApi.revokeWebhookSource(tenantId, sourceId);
    if ("unauthorized" in result) return logout();
    if ("ok" in result) load();
  };

  return (
    <div className="card">
      <h3 className="font-serif" style={{ fontSize: 20, fontWeight: 600, color: "var(--navy)", marginBottom: 16 }}>
        Webhook Sources
      </h3>
      <p style={{ color: "var(--slate-light)", fontSize: 13, marginBottom: 16 }}>
        Each source has its own signing secret and delivery path. Payloads are
        HMAC-verified; the secret is sealed under the tenant key and shown once.
      </p>
      {errorMsg && (
        <div className="alert-error" style={{ marginBottom: 16 }}>
          <TriangleAlert size={16} />
          <span>{errorMsg}</span>
        </div>
      )}
      <form onSubmit={handleMint} style={{ display: "flex", gap: 16, alignItems: "end" }}>
        <div style={{ flex: 1 }}>
          <label className="label-base">Label</label>
          <input
            className="input-base"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Stripe events"
            required
          />
        </div>
        <div style={{ flex: 1 }}>
          <label className="label-base">Target Layer</label>
          <input
            className="input-base"
            value={targetLayer}
            onChange={(e) => setTargetLayer(e.target.value)}
            placeholder="layer key"
            required
          />
        </div>
        <button type="submit" className="btn-primary" disabled={minting}>
          {minting ? <Loader2 size={16} className="animate-spin" /> : "Mint Source"}
        </button>
      </form>

      {minted && (
        <>
          <RevealBox
            title="Signing secret"
            value={minted.signingSecret}
            hint="copy it now, it will not be shown again"
          />
          <RevealBox title="Delivery path" value={minted.deliveryPath} hint="POST signed payloads here" />
        </>
      )}

      <div style={{ marginTop: 24 }}>
        {state === "loading" ? (
          <div className="skeleton" style={{ height: 80 }} />
        ) : state === "error" ? (
          <div style={{ color: "var(--red)" }}>Failed to load webhook sources.</div>
        ) : state === "empty" ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--slate-light)" }}>
            No webhook sources configured for this tenant.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table-base">
              <thead>
                <tr>
                  <th>Label / ID</th>
                  <th>Target Layer</th>
                  <th>State</th>
                  <th>Last Delivery</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div style={{ fontWeight: 500, color: "var(--navy)" }}>{s.label}</div>
                      <div className="font-mono" style={{ fontSize: 11, color: "var(--slate-light)" }}>
                        {s.id.slice(0, 8)}...
                      </div>
                    </td>
                    <td>
                      <div className="tag tag-data">{s.targetLayer}</div>
                    </td>
                    <td>{statePill(s.status)}</td>
                    <td>{s.lastDeliveryAt ? new Date(s.lastDeliveryAt).toLocaleString() : "Never"}</td>
                    <td>
                      {s.status === "active" && (
                        <button
                          onClick={() => handleRevoke(s.id)}
                          className="btn-ghost"
                          style={{ height: 24, padding: "0 8px", fontSize: 11 }}
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function UploadSection({ tenantId, logout }: { tenantId: string; logout: () => void }) {
  const [layer, setLayer] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [report, setReport] = useState<UploadReport | null>(null);

  useEffect(() => {
    setReport(null);
    setErrorMsg("");
  }, [tenantId]);

  const errorLabel = (code: string): string => {
    switch (code) {
      case "file_too_large":
        return "That file exceeds the 10MB upload limit.";
      case "unsupported_file_type":
      case "unsupported_extension":
        return "Only .csv, .xlsx, .docx, and .pdf files are accepted.";
      case "mime_mismatch":
        return "The file content does not match its extension.";
      case "local_extraction_seat_not_connected":
        return "Contract extraction needs the local model seat, which is not connected.";
      case "layer_not_enabled":
      case "unknown_layer":
        return "That layer is not enabled for this tenant.";
      case "no_numeric_signals":
      case "invalid_signals":
        return "No numeric signals could be derived from that file.";
      default:
        return "Upload failed.";
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setErrorMsg("");
    setUploading(true);
    setReport(null);
    const result = await ingestionApi.uploadFile(tenantId, layer, file);
    setUploading(false);
    if ("unauthorized" in result) return logout();
    if ("error" in result) {
      setErrorMsg(errorLabel(result.error));
      return;
    }
    setReport(result.report);
    setFile(null);
  };

  return (
    <div className="card">
      <h3 className="font-serif" style={{ fontSize: 20, fontWeight: 600, color: "var(--navy)", marginBottom: 16 }}>
        Manual Upload
      </h3>
      <p style={{ color: "var(--slate-light)", fontSize: 13, marginBottom: 16 }}>
        Upload a spreadsheet (.csv, .xlsx) or contract (.pdf, .docx). The file is parsed in
        memory, only numeric math is stored, and the raw bytes are discarded. The result
        below shows exactly what was derived versus what was discarded.
      </p>
      {errorMsg && (
        <div className="alert-error" style={{ marginBottom: 16 }}>
          <TriangleAlert size={16} />
          <span>{errorMsg}</span>
        </div>
      )}
      <form onSubmit={handleUpload} style={{ display: "flex", gap: 16, alignItems: "end" }}>
        <div style={{ flex: 1 }}>
          <label className="label-base">Target Layer</label>
          <input
            className="input-base"
            value={layer}
            onChange={(e) => setLayer(e.target.value)}
            placeholder="layer key"
            required
          />
        </div>
        <div style={{ flex: 1 }}>
          <label className="label-base">File</label>
          <input
            type="file"
            className="input-base"
            accept=".csv,.xlsx,.docx,.pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            required
          />
        </div>
        <button type="submit" className="btn-primary" disabled={uploading || !file}>
          {uploading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <>
              <Upload size={14} /> Upload
            </>
          )}
        </button>
      </form>

      {report && (
        <div
          style={{
            marginTop: 24,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
          }}
        >
          <div style={{ padding: 20, background: "var(--cream-light)", borderRadius: 4 }}>
            <div className="eyebrow" style={{ color: "var(--teal-ink)", marginBottom: 12 }}>
              Derived and stored ({report.signalsCount})
            </div>
            <div style={{ fontSize: 12, color: "var(--slate-light)", marginBottom: 8 }}>
              {report.fileType.toUpperCase()} - {report.kind} - layer {report.layer}
            </div>
            <ul className="font-mono" style={{ fontSize: 12, color: "var(--navy)", paddingLeft: 16, margin: 0 }}>
              {report.derived.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
            <div className="font-mono" style={{ fontSize: 11, color: "var(--slate-light)", marginTop: 12, wordBreak: "break-all" }}>
              root {report.rootHash.slice(0, 24)}...
            </div>
          </div>
          <div style={{ padding: 20, background: "var(--cream-light)", borderRadius: 4 }}>
            <div className="eyebrow" style={{ color: "var(--coral-ink)", marginBottom: 12 }}>
              Discarded
            </div>
            <div style={{ fontSize: 13, color: "var(--navy)", marginBottom: 8 }}>
              {report.discarded.filename} - {report.discarded.bytes} bytes
            </div>
            {report.discarded.rawRows != null && (
              <div style={{ fontSize: 13, color: "var(--navy)" }}>{report.discarded.rawRows} raw rows</div>
            )}
            {report.discarded.rawTextChars != null && (
              <div style={{ fontSize: 13, color: "var(--navy)" }}>
                {report.discarded.rawTextChars} raw text characters
              </div>
            )}
            <div style={{ fontSize: 12, color: "var(--slate-light)", marginTop: 12, fontStyle: "italic" }}>
              {report.discarded.note}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
