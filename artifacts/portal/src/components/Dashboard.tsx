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
  { name: "Coral Ink", varName: "--coral-ink", hex: "#B04927" },
  { name: "Teal Ink", varName: "--teal-ink", hex: "#177B5B" },
  { name: "Amber Ink", varName: "--amber-ink", hex: "#975F13" },
  { name: "Gold Ink", varName: "--gold-ink", hex: "#826930" },
  { name: "Ink", varName: "--ink", hex: "#1F1F1F", onDark: true },
];

type LayerSummary = { key: string; name: string; archetype: string; moduleGroup: string };

function Section({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mb-12">
      <div className="eyebrow text-coral-ink mb-1.5">
        {eyebrow}
      </div>
      <h2 className="font-serif text-[26px] text-navy font-semibold mb-5">
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
      <div className="grid gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-11" />
        ))}
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="card card-accent-coral flex gap-3 items-start">
        <TriangleAlert size={18} color="var(--coral)" className="mt-0.5 shrink-0" />
        <div>
          <div className="font-semibold text-navy">Registry unavailable</div>
          <div className="text-caption text-slate-light">
            The api-server is not responding on /api/layers. Start it to load the canonical layer
            registry. The portal fails loudly rather than showing placeholder data.
          </div>
        </div>
      </div>
    );
  }

  if (state === "empty") {
    return (
      <div className="card text-center text-slate-light">
        The registry is reachable but holds no layers yet. Run the canonical layer seed.
      </div>
    );
  }

  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
      {layers.map((layer) => (
        <div key={layer.key} className="card card-accent-navy p-4">
          <div className="font-serif text-[16px] text-navy font-semibold">
            {layer.name}
          </div>
          <div className="text-xs text-slate-light mt-1">{layer.archetype}</div>
          <div className="eyebrow text-gold-ink mt-2.5">
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
      <header className="bg-navy-deep text-cream-light py-10">
        <div className="max-w-[1080px] mx-auto px-8">
          <div className="eyebrow text-gold-light mb-2.5">
            Different Day · Elevated Intelligence V2
          </div>
          <h1 className="font-serif text-[44px] font-bold leading-[1.05]">
            Design Language
          </h1>
          <p className="max-w-[640px] mt-3 text-cream/75 text-body">
            The foundation of the per-tenant intelligence layer. Authority in navy, elevation in
            gold, paper in cream. Surfaces are drawn with one-pixel borders and a three-pixel top
            accent, never with shadows or gradients. This page is the living specification.
          </p>
        </div>
      </header>

      <main className="max-w-[1080px] mx-auto pt-12 px-8 pb-24">
        <Section eyebrow="Foundation" title="Palette">
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]">
            {palette.map((s) => (
              <div key={s.varName} className="card p-0 overflow-hidden">
                <div className="h-16" style={{ background: s.hex }} />
                <div className="py-2.5 px-3">
                  <div className="font-semibold text-caption text-navy">{s.name}</div>
                  <div className="font-mono text-meta text-slate-light">
                    {s.hex}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section eyebrow="Foundation" title="Typography">
          <div className="card grid gap-4">
            <div>
              <div className="eyebrow text-slate-light">Serif · Crimson Pro</div>
              <div className="font-serif text-[38px] text-navy font-bold">
                The diagnosis, stated plainly
              </div>
            </div>
            <div>
              <div className="eyebrow text-slate-light">Sans · Inter</div>
              <div className="text-body text-ink">
                Body and interface text. Measured, quiet, and legible at small sizes.
              </div>
            </div>
            <div>
              <div className="eyebrow text-slate-light">Mono · JetBrains Mono</div>
              <div className="font-mono text-[14px] text-slate-base">
                metrics · 142 · 0.62 · -3.4
              </div>
            </div>
          </div>
        </Section>

        <Section eyebrow="Primitives" title="Cards and accents">
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
            {(["navy", "coral", "teal", "gold", "amber"] as const).map((accent) => (
              <div key={accent} className={"card card-accent-" + accent}>
                <div className="eyebrow text-slate-light">Accent</div>
                <div className="font-serif text-[18px] text-navy font-semibold">
                  {accent}
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section eyebrow="Primitives" title="Provenance, pills and actions">
          <div className="card flex flex-wrap gap-3 items-center">
            <span className="pill pill-verified">
              <ShieldCheck size={13} className="mr-1" /> Verified
            </span>
            <span className="pill pill-modelled">
              <Sparkles size={13} className="mr-1" /> Modelled
            </span>
            <span className="pill pill-navy">Layer</span>
            <span className="tag tag-signal">Signal</span>
            <span className="tag tag-model">Model</span>
            <span className="tag tag-data">Data</span>
            <div className="flex-1" />
            <button className="btn-ghost">Secondary</button>
            <button className="btn-primary">
              Primary <ArrowRight size={14} />
            </button>
          </div>
        </Section>

        <Section eyebrow="Proof" title="The canonical layer registry, consumed live">
          <p className="text-slate-light text-[14px] mb-4 max-w-[640px]">
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
