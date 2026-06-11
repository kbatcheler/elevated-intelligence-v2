import React, { useEffect, useState } from "react";
import { ArrowRight, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";

type Swatch = { name: string; varName: string; hex: string; onDark?: boolean };

const palette: Swatch[] = [
  { name: "Navy", varName: "--navy", hex: "#1B2A4E", onDark: true },
  { name: "Navy Deep", varName: "--navy-deep", hex: "#0F1A33", onDark: true },
  { name: "Navy Soft", varName: "--navy-soft", hex: "#4A5878", onDark: true },
  { name: "Gold", varName: "--gold", hex: "#C8A24A" },
  { name: "Gold Light", varName: "--gold-light", hex: "#E5C97B" },
  { name: "Cream", varName: "--cream", hex: "#F4F1EA" },
  { name: "Cream Light", varName: "--cream-light", hex: "#FAF8F2" },
  { name: "Cream Dark", varName: "--cream-dark", hex: "#E8E2D2" },
  { name: "Coral", varName: "--coral", hex: "#D85A30" },
  { name: "Teal", varName: "--teal", hex: "#1D9E75" },
  { name: "Amber", varName: "--amber", hex: "#BA7517" },
  { name: "Ink", varName: "--ink", hex: "#1F1F1F", onDark: true },
];

type LayerSummary = { key: string; name: string; archetype: string; moduleGroup: string };

function Section({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 48 }}>
      <div className="eyebrow" style={{ color: "var(--coral)", marginBottom: 6 }}>
        {eyebrow}
      </div>
      <h2 className="font-serif" style={{ fontSize: 26, color: "var(--navy)", fontWeight: 600, marginBottom: 20 }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function RegistryProof() {
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [layers, setLayers] = useState<LayerSummary[]>([]);

  useEffect(() => {
    let active = true;
    fetch("/api/layers")
      .then((r) => {
        if (!r.ok) throw new Error("status " + r.status);
        return r.json();
      })
      .then((data: { layers?: LayerSummary[] }) => {
        if (!active) return;
        const list = data.layers ?? [];
        setLayers(list);
        setState(list.length > 0 ? "ready" : "empty");
      })
      .catch(() => active && setState("error"));
    return () => {
      active = false;
    };
  }, []);

  if (state === "loading") {
    return (
      <div style={{ display: "grid", gap: 8 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton" style={{ height: 44 }} />
        ))}
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="card card-accent-coral" style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <TriangleAlert size={18} color="var(--coral)" style={{ marginTop: 2, flexShrink: 0 }} />
        <div>
          <div style={{ fontWeight: 600, color: "var(--navy)" }}>Registry unavailable</div>
          <div style={{ fontSize: 13, color: "var(--slate-light)" }}>
            The api-server is not responding on /api/layers. Start it to load the canonical layer
            registry. The portal fails loudly rather than showing placeholder data.
          </div>
        </div>
      </div>
    );
  }

  if (state === "empty") {
    return (
      <div className="card" style={{ textAlign: "center", color: "var(--slate-light)" }}>
        The registry is reachable but holds no layers yet. Run the canonical layer seed.
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
      {layers.map((layer) => (
        <div key={layer.key} className="card card-accent-navy" style={{ padding: 16 }}>
          <div className="font-serif" style={{ fontSize: 16, color: "var(--navy)", fontWeight: 600 }}>
            {layer.name}
          </div>
          <div style={{ fontSize: 12, color: "var(--slate-light)", marginTop: 4 }}>{layer.archetype}</div>
          <div className="eyebrow" style={{ color: "var(--gold)", marginTop: 10 }}>
            {layer.moduleGroup}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Dashboard() {
  return (
    <div>
      <header style={{ background: "var(--navy-deep)", color: "var(--cream-light)", padding: "40px 0" }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 32px" }}>
          <div className="eyebrow" style={{ color: "var(--gold-light)", marginBottom: 10 }}>
            Different Day · Elevated Intelligence V2
          </div>
          <h1 className="font-serif" style={{ fontSize: 44, fontWeight: 700, lineHeight: 1.05 }}>
            Design Language
          </h1>
          <p style={{ maxWidth: 640, marginTop: 12, color: "rgba(244,241,234,0.75)", fontSize: 15 }}>
            The foundation of the per-tenant intelligence layer. Authority in navy, elevation in
            gold, paper in cream. Surfaces are drawn with one-pixel borders and a three-pixel top
            accent, never with shadows or gradients. This page is the living specification.
          </p>
        </div>
      </header>

      <main style={{ maxWidth: 1080, margin: "0 auto", padding: "48px 32px 96px" }}>
        <Section eyebrow="Foundation" title="Palette">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
            {palette.map((s) => (
              <div key={s.varName} className="card" style={{ padding: 0, overflow: "hidden" }}>
                <div style={{ height: 64, background: s.hex }} />
                <div style={{ padding: "10px 12px" }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: "var(--navy)" }}>{s.name}</div>
                  <div className="font-mono" style={{ fontSize: 11, color: "var(--slate-light)" }}>
                    {s.hex}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section eyebrow="Foundation" title="Typography">
          <div className="card" style={{ display: "grid", gap: 16 }}>
            <div>
              <div className="eyebrow" style={{ color: "var(--slate-light)" }}>Serif · Crimson Pro</div>
              <div className="font-serif" style={{ fontSize: 38, color: "var(--navy)", fontWeight: 700 }}>
                The diagnosis, stated plainly
              </div>
            </div>
            <div>
              <div className="eyebrow" style={{ color: "var(--slate-light)" }}>Sans · Inter</div>
              <div style={{ fontSize: 15, color: "var(--ink)" }}>
                Body and interface text. Measured, quiet, and legible at small sizes.
              </div>
            </div>
            <div>
              <div className="eyebrow" style={{ color: "var(--slate-light)" }}>Mono · JetBrains Mono</div>
              <div className="font-mono" style={{ fontSize: 14, color: "var(--slate)" }}>
                metrics · 142 · 0.62 · -3.4
              </div>
            </div>
          </div>
        </Section>

        <Section eyebrow="Primitives" title="Cards and accents">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
            {(["navy", "coral", "teal", "gold", "amber"] as const).map((accent) => (
              <div key={accent} className={"card card-accent-" + accent}>
                <div className="eyebrow" style={{ color: "var(--slate-light)" }}>Accent</div>
                <div className="font-serif" style={{ fontSize: 18, color: "var(--navy)", fontWeight: 600 }}>
                  {accent}
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section eyebrow="Primitives" title="Provenance, pills and actions">
          <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
            <span className="pill pill-verified">
              <ShieldCheck size={13} style={{ marginRight: 4 }} /> Verified
            </span>
            <span className="pill pill-modelled">
              <Sparkles size={13} style={{ marginRight: 4 }} /> Modelled
            </span>
            <span className="pill pill-navy">Layer</span>
            <span className="tag tag-signal">Signal</span>
            <span className="tag tag-model">Model</span>
            <span className="tag tag-data">Data</span>
            <div style={{ flex: 1 }} />
            <button className="btn-ghost">Secondary</button>
            <button className="btn-primary">
              Primary <ArrowRight size={14} />
            </button>
          </div>
        </Section>

        <Section eyebrow="Proof" title="The canonical layer registry, consumed live">
          <p style={{ color: "var(--slate-light)", fontSize: 14, marginBottom: 16, maxWidth: 640 }}>
            The portal reads the fourteen layers from the registry through the api-server, the same
            source the pipeline and prompts read. Below it renders the four designed data states:
            loading, ready, empty and error.
          </p>
          <RegistryProof />
        </Section>
      </main>
    </div>
  );
}
