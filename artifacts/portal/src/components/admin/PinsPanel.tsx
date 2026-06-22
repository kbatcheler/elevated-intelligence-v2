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
    <div className="grid gap-8">
      <div className="card card-accent-gold">
        <h3 className="font-serif text-title font-semibold text-navy mb-4">
          Mint Invite PIN
        </h3>
        {errorMsg && (
          <div className="alert-error mb-4">
            <TriangleAlert size={16} />
            <span>{errorMsg}</span>
          </div>
        )}
        <form onSubmit={handleMint} className="grid grid-cols-[1fr_1fr] gap-4 items-end">
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
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="label-base">Max Uses</label>
              <input type="number" min={1} className="input-base" value={maxUses} onChange={e => setMaxUses(parseInt(e.target.value))} />
            </div>
            <div className="flex-1">
              <label className="label-base">Expires In (Days)</label>
              <input type="number" min={1} className="input-base" value={expiresInDays} onChange={e => setExpiresInDays(parseInt(e.target.value))} />
            </div>
          </div>
          <div className="col-span-full flex justify-end">
            <button type="submit" className="btn-primary" disabled={minting}>
              {minting ? <Loader2 size={16} className="animate-spin" /> : "Mint PIN"}
            </button>
          </div>
        </form>

        {mintedCode && (
          <div className="mt-6 p-6 bg-cream-light border border-dashed border-gold rounded text-center">
            <div className="eyebrow text-coral-ink mb-2">Copy it now, it will not be shown again</div>
            <div className="font-mono text-[32px] text-navy font-medium mb-4 tracking-[0.1em]">
              {mintedCode}
            </div>
            <button onClick={copyCode} className="btn-ghost mx-auto">
              {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy to Clipboard</>}
            </button>
          </div>
        )}
      </div>

      <div>
        <h3 className="font-serif text-title font-semibold text-navy mb-4">
          Existing PINs
        </h3>
        <div className="card p-0 overflow-hidden">
          {state === "loading" ? (
            <div className="p-6"><div className="skeleton h-25" /></div>
          ) : state === "error" ? (
            <div className="p-6 text-red-base">Failed to load PINs.</div>
          ) : state === "empty" ? (
            <div className="p-8 text-center text-slate-light">No PINs have been minted yet.</div>
          ) : (
            <div className="overflow-x-auto">
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
                        <div className="font-medium text-navy">{pin.label || "Untitled"}</div>
                        <div className="font-mono text-meta text-slate-light">{pin.id.slice(0, 8)}...</div>
                      </td>
                      <td>{getStatePill(pin.state)}</td>
                      <td>
                        <div className="tag tag-data">{pin.scopeRole}</div>
                        {pin.scopeOrgId && <div className="text-meta text-slate-light mt-1">Org: {pin.scopeOrgId.slice(0, 8)}</div>}
                      </td>
                      <td><span className="font-mono">{pin.useCount} / {pin.maxUses}</span></td>
                      <td>{new Date(pin.createdAt).toLocaleDateString()}</td>
                      <td>
                        {pin.state === "active" && (
                          <button onClick={() => handleRevoke(pin.id)} className="btn-ghost h-6 px-2 py-0 text-meta">
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
