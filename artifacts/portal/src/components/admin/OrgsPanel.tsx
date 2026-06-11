import React, { useEffect, useState } from "react";
import { Org, Tenant } from "../../types";
import { Loader2, TriangleAlert } from "lucide-react";
import { useAuth } from "../../lib/AuthContext";

export function OrgsPanel({ orgs, refreshOrgs }: { orgs: Org[], refreshOrgs: () => void }) {
  const { logout } = useAuth();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantsLoading, setTenantsLoading] = useState(true);

  const [name, setName] = useState("");
  const [type, setType] = useState<"client" | "portfolio">("client");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const [bindingOrgId, setBindingOrgId] = useState("");
  const [bindingTenantId, setBindingTenantId] = useState("");
  const [binding, setBinding] = useState(false);
  const [bindError, setBindError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/admin/tenants")
      .then(r => {
        if (r.status === 401) return logout();
        if (!r.ok) throw new Error("bad status");
        return r.json();
      })
      .then(data => {
        if (!active) return;
        setTenants(data.tenants || []);
      })
      .catch(() => {})
      .finally(() => { if (active) setTenantsLoading(false); });
    return () => { active = false; };
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError("");
    setCreating(true);
    try {
      const res = await fetch("/api/admin/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type }),
      });
      if (res.status === 401) return logout();
      if (!res.ok) throw new Error("Failed to create org");
      setName("");
      refreshOrgs();
    } catch (err: any) {
      setCreateError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleBind = async (e: React.FormEvent) => {
    e.preventDefault();
    setBindError("");
    setBinding(true);
    try {
      const res = await fetch(`/api/admin/orgs/${bindingOrgId}/tenants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: bindingTenantId }),
      });
      if (res.status === 401) return logout();
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to bind tenant");
      }
      setBindingOrgId("");
      setBindingTenantId("");
      refreshOrgs();
    } catch (err: any) {
      setBindError(err.message === "provider_org_needs_no_bindings" ? "Provider orgs do not need tenant bindings." : err.message);
    } finally {
      setBinding(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 32 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 24 }}>
        <div className="card card-accent-teal">
          <h3 className="font-serif" style={{ fontSize: 18, fontWeight: 600, color: "var(--navy)", marginBottom: 16 }}>
            Create Organization
          </h3>
          {createError && (
            <div className="alert-error" style={{ marginBottom: 16, padding: 8 }}>
              <TriangleAlert size={14} /> <span style={{ fontSize: 12 }}>{createError}</span>
            </div>
          )}
          <form onSubmit={handleCreate} style={{ display: "grid", gap: 12 }}>
            <div>
              <label className="label-base">Name</label>
              <input className="input-base" value={name} onChange={e => setName(e.target.value)} required />
            </div>
            <div>
              <label className="label-base">Type</label>
              <select className="input-base" value={type} onChange={e => setType(e.target.value as any)}>
                <option value="client">Client</option>
                <option value="portfolio">Portfolio</option>
              </select>
            </div>
            <button type="submit" className="btn-primary" disabled={creating} style={{ marginTop: 8 }}>
              {creating ? <Loader2 size={16} className="animate-spin" /> : "Create Org"}
            </button>
          </form>
        </div>

        <div className="card card-accent-navy">
          <h3 className="font-serif" style={{ fontSize: 18, fontWeight: 600, color: "var(--navy)", marginBottom: 16 }}>
            Bind Tenant to Org
          </h3>
          {bindError && (
            <div className="alert-error" style={{ marginBottom: 16, padding: 8 }}>
              <TriangleAlert size={14} /> <span style={{ fontSize: 12 }}>{bindError}</span>
            </div>
          )}
          <form onSubmit={handleBind} style={{ display: "grid", gap: 12 }}>
            <div>
              <label className="label-base">Organization</label>
              <select className="input-base" value={bindingOrgId} onChange={e => setBindingOrgId(e.target.value)} required>
                <option value="">Select Org...</option>
                {orgs.filter(o => o.type !== "provider").map(o => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-base">Tenant</label>
              <select className="input-base" value={bindingTenantId} onChange={e => setBindingTenantId(e.target.value)} required disabled={tenantsLoading}>
                <option value="">{tenantsLoading ? "Loading..." : "Select Tenant..."}</option>
                {tenants.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn-primary" disabled={binding || !bindingOrgId || !bindingTenantId} style={{ marginTop: 8 }}>
              {binding ? <Loader2 size={16} className="animate-spin" /> : "Bind"}
            </button>
          </form>
        </div>
      </div>

      <div>
        <h3 className="font-serif" style={{ fontSize: 20, fontWeight: 600, color: "var(--navy)", marginBottom: 16 }}>
          Organizations
        </h3>
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          {orgs.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: "var(--slate-light)" }}>No orgs found.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Bound Tenants</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {orgs.map(org => (
                    <tr key={org.id}>
                      <td>
                        <div style={{ fontWeight: 500, color: "var(--navy)" }}>{org.name}</div>
                        <div className="font-mono" style={{ fontSize: 11, color: "var(--slate-light)" }}>{org.id.slice(0, 8)}...</div>
                      </td>
                      <td>
                        <span className={`pill ${org.type === 'provider' ? 'pill-navy' : org.type === 'portfolio' ? 'pill-teal' : 'pill-amber'}`}>
                          {org.type}
                        </span>
                      </td>
                      <td>
                        {org.tenants.length === 0 ? (
                          <span style={{ color: "var(--slate-light)", fontSize: 12 }}>None</span>
                        ) : (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {org.tenants.map(t => (
                              <span key={t.id} className="tag tag-workflow">{t.name}</span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>{new Date(org.createdAt).toLocaleDateString()}</td>
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
