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
import { ingestionStatusPill, uploadErrorLabel } from "../../lib/ingestionView";

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
      <div className="card p-8 text-center text-slate-light">
        No tenants exist yet. Create a tenant before configuring ingestion.
      </div>
    );
  }

  return (
    <div className="grid gap-8">
      <div>
        <label className="label-base">Tenant</label>
        <select
          className="input-base max-w-[420px]"
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
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
        <div className="card p-8 text-center text-slate-light">
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
    <div className="mt-6 p-6 bg-cream-light border border-dashed border-gold rounded">
      <div className="eyebrow text-coral-ink mb-2">
        {title} - {hint}
      </div>
      <div className="font-mono text-[14px] text-navy break-all mb-4">
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
  const { className, label } = ingestionStatusPill(status);
  return <span className={className}>{label}</span>;
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
      <h3 className="font-serif text-title font-semibold text-navy mb-4">
        Ingestion Keys
      </h3>
      <p className="text-slate-light text-caption mb-4">
        Bearer keys for the Ingestion API, SFTP drop, and MCP server. Hashed at rest and
        revocable; the token is shown once at mint.
      </p>
      {errorMsg && (
        <div className="alert-error mb-4">
          <TriangleAlert size={16} />
          <span>{errorMsg}</span>
        </div>
      )}
      <form onSubmit={handleMint} className="flex gap-4 items-end">
        <div className="flex-1">
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

      <div className="mt-6">
        {state === "loading" ? (
          <div className="skeleton h-20" />
        ) : state === "error" ? (
          <div className="text-red-base">Failed to load ingestion keys.</div>
        ) : state === "empty" ? (
          <div className="p-6 text-center text-slate-light">
            No ingestion keys minted for this tenant.
          </div>
        ) : (
          <div className="overflow-x-auto">
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
                      <div className="font-medium text-navy">{k.label}</div>
                      <div className="font-mono text-meta text-slate-light">
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
                          className="btn-ghost h-6 px-2 py-0 text-meta"
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
      <h3 className="font-serif text-title font-semibold text-navy mb-4">
        Webhook Sources
      </h3>
      <p className="text-slate-light text-caption mb-4">
        Each source has its own signing secret and delivery path. Payloads are
        HMAC-verified; the secret is sealed under the tenant key and shown once.
      </p>
      {errorMsg && (
        <div className="alert-error mb-4">
          <TriangleAlert size={16} />
          <span>{errorMsg}</span>
        </div>
      )}
      <form onSubmit={handleMint} className="flex gap-4 items-end">
        <div className="flex-1">
          <label className="label-base">Label</label>
          <input
            className="input-base"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Stripe events"
            required
          />
        </div>
        <div className="flex-1">
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

      <div className="mt-6">
        {state === "loading" ? (
          <div className="skeleton h-20" />
        ) : state === "error" ? (
          <div className="text-red-base">Failed to load webhook sources.</div>
        ) : state === "empty" ? (
          <div className="p-6 text-center text-slate-light">
            No webhook sources configured for this tenant.
          </div>
        ) : (
          <div className="overflow-x-auto">
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
                      <div className="font-medium text-navy">{s.label}</div>
                      <div className="font-mono text-meta text-slate-light">
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
                          className="btn-ghost h-6 px-2 py-0 text-meta"
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
      setErrorMsg(uploadErrorLabel(result.error));
      return;
    }
    setReport(result.report);
    setFile(null);
  };

  return (
    <div className="card">
      <h3 className="font-serif text-title font-semibold text-navy mb-4">
        Manual Upload
      </h3>
      <p className="text-slate-light text-caption mb-4">
        Upload a spreadsheet (.csv, .xlsx) or contract (.pdf, .docx). The file is parsed in
        memory, only numeric math is stored, and the raw bytes are discarded. The result
        below shows exactly what was derived versus what was discarded.
      </p>
      {errorMsg && (
        <div className="alert-error mb-4">
          <TriangleAlert size={16} />
          <span>{errorMsg}</span>
        </div>
      )}
      <form onSubmit={handleUpload} className="flex gap-4 items-end">
        <div className="flex-1">
          <label className="label-base">Target Layer</label>
          <input
            className="input-base"
            value={layer}
            onChange={(e) => setLayer(e.target.value)}
            placeholder="layer key"
            required
          />
        </div>
        <div className="flex-1">
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
        <div className="mt-6 grid grid-cols-[1fr_1fr] gap-4">
          <div className="p-5 bg-cream-light rounded">
            <div className="eyebrow text-teal-ink mb-3">
              Derived and stored ({report.signalsCount})
            </div>
            <div className="text-xs text-slate-light mb-2">
              {report.fileType.toUpperCase()} - {report.kind} - layer {report.layer}
            </div>
            <ul className="font-mono text-xs text-navy pl-4 m-0">
              {report.derived.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
            <div className="font-mono text-meta text-slate-light mt-3 break-all">
              root {report.rootHash.slice(0, 24)}...
            </div>
          </div>
          <div className="p-5 bg-cream-light rounded">
            <div className="eyebrow text-coral-ink mb-3">
              Discarded
            </div>
            <div className="text-caption text-navy mb-2">
              {report.discarded.filename} - {report.discarded.bytes} bytes
            </div>
            {report.discarded.rawRows != null && (
              <div className="text-caption text-navy">{report.discarded.rawRows} raw rows</div>
            )}
            {report.discarded.rawTextChars != null && (
              <div className="text-caption text-navy">
                {report.discarded.rawTextChars} raw text characters
              </div>
            )}
            <div className="text-xs text-slate-light mt-3 italic">
              {report.discarded.note}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
