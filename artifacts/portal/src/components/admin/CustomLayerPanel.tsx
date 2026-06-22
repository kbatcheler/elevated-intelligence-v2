import React, { useEffect, useState } from "react";
import { Loader2, TriangleAlert, Plus } from "lucide-react";
import { useAuth } from "../../lib/AuthContext";
import * as adminApi from "../../lib/adminApi";
import type { CustomLayer } from "../../lib/adminApi";
import { ARCHETYPE_KEYS } from "../heroes/registry";
import { canonicalKeys as deriveCanonicalKeys, customLayerErrorLabel } from "../../lib/customLayerView";

// The curated custom-layer console (Phase AG). An owner creates a layer from a
// guarded template (exactly four metric tiles, an archetype the hero registry can
// render, at least one feed), optionally pooling its benchmark signals under a
// canonical layer. A new layer is created UNAPPROVED and does not run until the
// owner approves it here, which is also what admits it to the runnable catalog and
// the seed fan-out. Loading, empty, and error states are distinct and honest.
export function CustomLayerPanel() {
  const { logout } = useAuth();
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [layers, setLayers] = useState<CustomLayer[]>([]);
  const [canonicalKeys, setCanonicalKeys] = useState<string[]>([]);

  const load = async () => {
    const [custom, catalog] = await Promise.all([
      adminApi.fetchCustomLayers(),
      adminApi.fetchCatalogLayers(),
    ]);
    if ("unauthorized" in custom || "unauthorized" in catalog) return logout();
    if (custom.state === "error" || catalog.state === "error") {
      setState("error");
      return;
    }
    setLayers(custom.items);
    setState(custom.state);
    // Canonical layers are the runnable catalog minus the custom layers; only a
    // canonical layer is a valid benchmark mapping target.
    setCanonicalKeys(deriveCanonicalKeys(catalog.items, custom.items));
  };

  useEffect(() => {
    setState("loading");
    load();
  }, []);

  return (
    <div className="grid gap-8">
      <CreateSection canonicalKeys={canonicalKeys} logout={logout} onCreated={load} />

      <div className="card">
        <h3 className="font-serif text-title font-semibold text-navy mb-4">
          Custom Layers
        </h3>
        <p className="text-slate-light text-caption mb-4">
          Custom layers begin pending and are withheld from the runnable catalog until you
          approve them. Approval is what admits a layer to the per-tenant seed fan-out and
          records which owner authorized its first run.
        </p>

        {state === "loading" ? (
          <div className="skeleton h-20" />
        ) : state === "error" ? (
          <div className="text-red-base">Failed to load custom layers.</div>
        ) : state === "empty" ? (
          <div className="p-6 text-center text-slate-light">
            No custom layers yet. Create one above; it stays pending until you approve it.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Layer / Key</th>
                  <th>Archetype</th>
                  <th>Benchmark Mapping</th>
                  <th>State</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {layers.map((l) => (
                  <LayerRow key={l.key} layer={l} logout={logout} onApproved={load} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function approvalPill(layer: CustomLayer) {
  return layer.approvedAt ? (
    <span className="pill pill-verified">Approved</span>
  ) : (
    <span className="pill pill-navy">Pending</span>
  );
}

function LayerRow({
  layer,
  logout,
  onApproved,
}: {
  layer: CustomLayer;
  logout: () => void;
  onApproved: () => void;
}) {
  const [approving, setApproving] = useState(false);

  const handleApprove = async () => {
    setApproving(true);
    const result = await adminApi.approveCustomLayer(layer.key);
    setApproving(false);
    if ("unauthorized" in result) return logout();
    if ("ok" in result) onApproved();
  };

  return (
    <tr>
      <td>
        <div className="font-medium text-navy">{layer.name}</div>
        <div className="font-mono text-meta text-slate-light">
          {layer.key}
        </div>
      </td>
      <td>
        <div className="tag tag-data">{layer.archetype}</div>
      </td>
      <td>
        {layer.benchmarkCanonicalKey ? (
          <span className="font-mono text-xs text-navy">
            {layer.benchmarkCanonicalKey}
          </span>
        ) : (
          <span className="text-xs text-slate-light">Excluded</span>
        )}
      </td>
      <td>{approvalPill(layer)}</td>
      <td>{new Date(layer.createdAt).toLocaleDateString()}</td>
      <td>
        {!layer.approvedAt && (
          <button
            onClick={handleApprove}
            className="btn-ghost h-6 px-2 py-0 text-meta"
            disabled={approving}
          >
            {approving ? <Loader2 size={12} className="animate-spin" /> : "Approve"}
          </button>
        )}
      </td>
    </tr>
  );
}

function CreateSection({
  canonicalKeys,
  logout,
  onCreated,
}: {
  canonicalKeys: string[];
  logout: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [diagnosticQuestion, setDiagnosticQuestion] = useState("");
  const [archetype, setArchetype] = useState<string>(ARCHETYPE_KEYS[0] ?? "");
  const [tiles, setTiles] = useState<string[]>(["", "", "", ""]);
  const [feeds, setFeeds] = useState("");
  const [benchmarkCanonicalKey, setBenchmarkCanonicalKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [savedKey, setSavedKey] = useState("");

  const setTile = (i: number, value: string) => {
    setTiles((prev) => prev.map((t, j) => (j === i ? value : t)));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSavedKey("");
    setSaving(true);
    const feedsList = feeds
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);
    const result = await adminApi.createCustomLayer({
      name,
      diagnosticQuestion,
      archetype,
      metricDefinitions: { tiles: tiles.map((t) => t.trim()) },
      feeds: feedsList,
      ...(benchmarkCanonicalKey ? { benchmarkCanonicalKey } : {}),
    });
    setSaving(false);
    if ("unauthorized" in result) return logout();
    if ("error" in result) {
      setErrorMsg(customLayerErrorLabel(result.error));
      return;
    }
    setSavedKey(name);
    setName("");
    setDiagnosticQuestion("");
    setArchetype(ARCHETYPE_KEYS[0] ?? "");
    setTiles(["", "", "", ""]);
    setFeeds("");
    setBenchmarkCanonicalKey("");
    onCreated();
  };

  return (
    <div className="card card-accent-gold">
      <h3 className="font-serif text-title font-semibold text-navy mb-4">
        Create Custom Layer
      </h3>
      <p className="text-slate-light text-caption mb-4">
        A guarded template: name the layer, state the one diagnostic question it answers, pick a
        renderable archetype, give exactly four metric tiles, and name at least one feed. The
        layer is created pending and runs nothing until you approve it.
      </p>

      {errorMsg && (
        <div className="alert-error mb-4">
          <TriangleAlert size={16} />
          <span>{errorMsg}</span>
        </div>
      )}

      {savedKey && (
        <div className="mb-4 p-4 bg-cream-light border border-dashed border-gold rounded text-navy text-caption">
          Created "{savedKey}" as a pending custom layer. Approve it below to make it runnable.
        </div>
      )}

      <form onSubmit={handleCreate} className="grid gap-4">
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="label-base">Name</label>
            <input
              className="input-base"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Expansion readiness"
              maxLength={120}
              required
            />
          </div>
          <div className="flex-1">
            <label className="label-base">Archetype</label>
            <select
              className="input-base"
              value={archetype}
              onChange={(e) => setArchetype(e.target.value)}
              required
            >
              {ARCHETYPE_KEYS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="label-base">Diagnostic Question</label>
          <input
            className="input-base"
            value={diagnosticQuestion}
            onChange={(e) => setDiagnosticQuestion(e.target.value)}
            placeholder="The single question this layer answers"
            maxLength={500}
            required
          />
        </div>

        <div>
          <label className="label-base">Metric Tiles (exactly four)</label>
          <div className="grid grid-cols-[1fr_1fr_1fr_1fr] gap-3">
            {tiles.map((t, i) => (
              <input
                key={i}
                className="input-base"
                value={t}
                onChange={(e) => setTile(i, e.target.value)}
                placeholder={`Tile ${i + 1}`}
                maxLength={160}
                required
              />
            ))}
          </div>
        </div>

        <div className="flex gap-4">
          <div className="flex-1">
            <label className="label-base">Feeds (comma separated)</label>
            <input
              className="input-base"
              value={feeds}
              onChange={(e) => setFeeds(e.target.value)}
              placeholder="e.g. billing, crm, product-usage"
              required
            />
          </div>
          <div className="flex-1">
            <label className="label-base">Benchmark Mapping (optional)</label>
            <select
              className="input-base"
              value={benchmarkCanonicalKey}
              onChange={(e) => setBenchmarkCanonicalKey(e.target.value)}
            >
              <option value="">Excluded from benchmark</option>
              {canonicalKeys.map((k) => (
                <option key={k} value={k}>
                  Pool under {k}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <>
                <Plus size={14} /> Create Layer
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
