import React, { useEffect, useState } from "react";
import { Org, Tenant } from "../../types";
import { Loader2, TriangleAlert } from "lucide-react";
import { useAuth } from "../../lib/AuthContext";
import * as adminApi from "../../lib/adminApi";

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
    adminApi.fetchTenants()
      .then(result => {
        if (!active) return;
        if ("unauthorized" in result) {
          logout();
          return;
        }
        if (result.state !== "error") setTenants(result.items);
      })
      .finally(() => { if (active) setTenantsLoading(false); });
    return () => { active = false; };
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError("");
    setCreating(true);
    const result = await adminApi.createOrg({ name, type });
    setCreating(false);
    if ("unauthorized" in result) return logout();
    if ("error" in result) {
      setCreateError("Failed to create org");
      return;
    }
    setName("");
    refreshOrgs();
  };

  const handleBind = async (e: React.FormEvent) => {
    e.preventDefault();
    setBindError("");
    setBinding(true);
    const result = await adminApi.bindTenant(bindingOrgId, bindingTenantId);
    setBinding(false);
    if ("unauthorized" in result) return logout();
    if ("error" in result) {
      setBindError(
        result.error === "provider_org_needs_no_bindings"
          ? "Provider orgs do not need tenant bindings."
          : result.error === "failed"
            ? "Failed to bind tenant."
            : result.error,
      );
      return;
    }
    setBindingOrgId("");
    setBindingTenantId("");
    refreshOrgs();
  };

  return (
    <div className="grid gap-8">
      <div className="grid [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))] gap-6">
        <div className="card card-accent-teal">
          <h3 className="font-serif text-[18px] font-semibold text-navy mb-4">
            Create Organisation
          </h3>
          {createError && (
            <div className="alert-error mb-4 p-2">
              <TriangleAlert size={14} /> <span className="text-xs">{createError}</span>
            </div>
          )}
          <form onSubmit={handleCreate} className="grid gap-3">
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
            <button type="submit" className="btn-primary mt-2" disabled={creating}>
              {creating ? <Loader2 size={16} className="animate-spin" /> : "Create Org"}
            </button>
          </form>
        </div>

        <div className="card card-accent-navy">
          <h3 className="font-serif text-[18px] font-semibold text-navy mb-4">
            Bind Tenant to Org
          </h3>
          {bindError && (
            <div className="alert-error mb-4 p-2">
              <TriangleAlert size={14} /> <span className="text-xs">{bindError}</span>
            </div>
          )}
          <form onSubmit={handleBind} className="grid gap-3">
            <div>
              <label className="label-base">Organisation</label>
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
            <button type="submit" className="btn-primary mt-2" disabled={binding || !bindingOrgId || !bindingTenantId}>
              {binding ? <Loader2 size={16} className="animate-spin" /> : "Bind"}
            </button>
          </form>
        </div>
      </div>

      <div>
        <h3 className="font-serif text-title font-semibold text-navy mb-4">
          Organisations
        </h3>
        <div className="card p-0 overflow-hidden">
          {orgs.length === 0 ? (
            <div className="p-8 text-center text-slate-light">No orgs found.</div>
          ) : (
            <div className="overflow-x-auto">
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
                        <div className="font-medium text-navy">{org.name}</div>
                        <div className="font-mono text-meta text-slate-light">{org.id.slice(0, 8)}...</div>
                      </td>
                      <td>
                        <span className={`pill ${org.type === 'provider' ? 'pill-navy' : org.type === 'portfolio' ? 'pill-teal' : 'pill-amber'}`}>
                          {org.type}
                        </span>
                      </td>
                      <td>
                        {org.tenants.length === 0 ? (
                          <span className="text-slate-light text-xs">None</span>
                        ) : (
                          <div className="flex gap-1.5 flex-wrap">
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
