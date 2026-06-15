import React, { useEffect, useState } from "react";
import { Pin } from "../../types";
import { Loader2, TriangleAlert, Copy, Check } from "lucide-react";
import { useAuth } from "../../lib/AuthContext";
import * as adminApi from "../../lib/adminApi";

export function PinsPanel({ orgs }: { orgs: { id: string; name: string; type: string }[] }) {
  const { logout } = useAuth();
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [pins, setPins] = useState<Pin[]>([]);
  const [errorMsg, setErrorMsg] = useState("");

  const [label, setLabel] = useState("");
  const [maxUses, setMaxUses] = useState(1);
  const [expiresInDays, setExpiresInDays] = useState(14);
  const [scopeRole, setScopeRole] = useState("client-viewer");
  const [scopeOrgId, setScopeOrgId] = useState("");

  const [minting, setMinting] = useState(false);
  const [mintedCode, setMintedCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchPins = async () => {
    const result = await adminApi.fetchPins();
    if ("unauthorized" in result) return logout();
    if (result.state === "error") {
      setState("error");
      return;
    }
    setPins(result.items);
    setState(result.state);
  };

  useEffect(() => {
    fetchPins();
  }, []);

  const handleMint = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setMinting(true);
    setMintedCode(null);
    setCopied(false);

    const payload: {
      label: string;
      maxUses: number;
      expiresInDays: number;
      scopeRole: string;
      scopeOrgId?: string;
    } = { label, maxUses, expiresInDays, scopeRole };
    if (scopeRole !== "provider-member" && scopeOrgId) {
      payload.scopeOrgId = scopeOrgId;
    }

    const result = await adminApi.mintPin(payload);
    setMinting(false);
    if ("unauthorized" in result) return logout();
    if ("error" in result) {
      setErrorMsg(result.error === "scope_org_required" ? "Scope org is required for client roles" : "Failed to mint PIN.");
      return;
    }

    setMintedCode(result.code);
    setLabel("");
    setMaxUses(1);
    setExpiresInDays(14);
    fetchPins();
  };

  const handleRevoke = async (id: string) => {
    const result = await adminApi.revokePin(id);
    if ("unauthorized" in result) return logout();
    if ("ok" in result) fetchPins();
  };

  const copyCode = () => {
    if (mintedCode) {
      navigator.clipboard.writeText(mintedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const getStatePill = (status: string) => {
    switch (status) {
      case "active": return <span className="pill pill-verified">Active</span>;
      case "expired": return <span className="pill pill-gray">Expired</span>;
      case "revoked": return <span className="pill pill-red">Revoked</span>;
      case "used-up": return <span className="pill pill-amber">Used Up</span>;
      default: return <span className="pill pill-navy">{status}</span>;
    }
  };

  const clientOrgs = orgs.filter(o => o.type === "client" || o.type === "portfolio");

  return (
    <div style={{ display: "grid", gap: 32 }}>
      <div className="card card-accent-gold">
        <h3 className="font-serif" style={{ fontSize: 20, fontWeight: 600, color: "var(--navy)", marginBottom: 16 }}>
          Mint Invite PIN
        </h3>
        {errorMsg && (
          <div className="alert-error" style={{ marginBottom: 16 }}>
            <TriangleAlert size={16} />
            <span>{errorMsg}</span>
          </div>
        )}
        <form onSubmit={handleMint} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "end" }}>
          <div>
            <label className="label-base">Label (optional)</label>
            <input className="input-base" value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Acme Corp Batch" />
          </div>
          <div>
            <label className="label-base">Scope Role</label>
            <select className="input-base" value={scopeRole} onChange={e => setScopeRole(e.target.value)}>
              <option value="client-viewer">Client Viewer</option>
              <option value="client-admin">Client Admin</option>
              <option value="provider-member">Provider Member</option>
            </select>
          </div>
          {scopeRole !== "provider-member" && (
            <div>
              <label className="label-base">Scope Org</label>
              <select className="input-base" value={scopeOrgId} onChange={e => setScopeOrgId(e.target.value)} required>
                <option value="">Select an Org...</option>
                {clientOrgs.map(o => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
          )}
          <div style={{ display: "flex", gap: 16 }}>
            <div style={{ flex: 1 }}>
              <label className="label-base">Max Uses</label>
              <input type="number" min={1} className="input-base" value={maxUses} onChange={e => setMaxUses(parseInt(e.target.value))} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="label-base">Expires In (Days)</label>
              <input type="number" min={1} className="input-base" value={expiresInDays} onChange={e => setExpiresInDays(parseInt(e.target.value))} />
            </div>
          </div>
          <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end" }}>
            <button type="submit" className="btn-primary" disabled={minting}>
              {minting ? <Loader2 size={16} className="animate-spin" /> : "Mint PIN"}
            </button>
          </div>
        </form>

        {mintedCode && (
          <div style={{ marginTop: 24, padding: 24, background: "var(--cream-light)", border: "1px dashed var(--gold)", borderRadius: 4, textAlign: "center" }}>
            <div className="eyebrow" style={{ color: "var(--coral-ink)", marginBottom: 8 }}>Copy it now, it will not be shown again</div>
            <div className="font-mono" style={{ fontSize: 32, color: "var(--navy)", fontWeight: 500, marginBottom: 16, letterSpacing: "0.1em" }}>
              {mintedCode}
            </div>
            <button onClick={copyCode} className="btn-ghost" style={{ margin: "0 auto" }}>
              {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy to Clipboard</>}
            </button>
          </div>
        )}
      </div>

      <div>
        <h3 className="font-serif" style={{ fontSize: 20, fontWeight: 600, color: "var(--navy)", marginBottom: 16 }}>
          Existing PINs
        </h3>
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          {state === "loading" ? (
            <div style={{ padding: 24 }}><div className="skeleton" style={{ height: 100 }} /></div>
          ) : state === "error" ? (
            <div style={{ padding: 24, color: "var(--red)" }}>Failed to load PINs.</div>
          ) : state === "empty" ? (
            <div style={{ padding: 32, textAlign: "center", color: "var(--slate-light)" }}>No PINs have been minted yet.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Label / ID</th>
                    <th>State</th>
                    <th>Role</th>
                    <th>Uses</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pins.map(pin => (
                    <tr key={pin.id}>
                      <td>
                        <div style={{ fontWeight: 500, color: "var(--navy)" }}>{pin.label || "Untitled"}</div>
                        <div className="font-mono" style={{ fontSize: 11, color: "var(--slate-light)" }}>{pin.id.slice(0, 8)}...</div>
                      </td>
                      <td>{getStatePill(pin.state)}</td>
                      <td>
                        <div className="tag tag-data">{pin.scopeRole}</div>
                        {pin.scopeOrgId && <div style={{ fontSize: 11, color: "var(--slate-light)", marginTop: 4 }}>Org: {pin.scopeOrgId.slice(0, 8)}</div>}
                      </td>
                      <td><span className="font-mono">{pin.useCount} / {pin.maxUses}</span></td>
                      <td>{new Date(pin.createdAt).toLocaleDateString()}</td>
                      <td>
                        {pin.state === "active" && (
                          <button onClick={() => handleRevoke(pin.id)} className="btn-ghost" style={{ height: 24, padding: "0 8px", fontSize: 11 }}>
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
    </div>
  );
}
