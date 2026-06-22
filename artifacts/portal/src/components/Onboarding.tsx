import React, { useEffect, useState } from "react";
import { Loader2, TriangleAlert, Copy, Check } from "lucide-react";
import type { Pin } from "../types";
import { useAuth } from "../lib/AuthContext";
import * as clientApi from "../lib/clientApi";
import { PageHeader, PageWidth, SectionHeading } from "./primitives";

// The client-admin onboarding surface. A client-admin invites their own
// colleagues as read-only viewers: the invite is always scoped, server-side, to
// this admin's own org and the client-viewer role, so there is no role or org
// picker to get wrong here. The plaintext PIN is shown exactly once.
export function Onboarding() {
  const { logout } = useAuth();
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [pins, setPins] = useState<Pin[]>([]);
  const [errorMsg, setErrorMsg] = useState("");

  const [label, setLabel] = useState("");
  const [maxUses, setMaxUses] = useState(1);
  const [expiresInDays, setExpiresInDays] = useState(14);

  const [minting, setMinting] = useState(false);
  const [mintedCode, setMintedCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = async () => {
    const result = await clientApi.fetchViewerPins();
    if ("unauthorized" in result) return logout();
    if (result.state === "error") {
      setState("error");
      return;
    }
    setPins(result.items);
    setState(result.state);
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleMint = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setMinting(true);
    setMintedCode(null);
    setCopied(false);

    const result = await clientApi.mintViewerPin({ label, maxUses, expiresInDays });
    setMinting(false);
    if ("unauthorized" in result) return logout();
    if ("error" in result) {
      setErrorMsg(
        result.error === "invalid_input"
          ? "Check the invite settings and try again."
          : "Failed to mint the viewer invite.",
      );
      return;
    }

    setMintedCode(result.code);
    setLabel("");
    setMaxUses(1);
    setExpiresInDays(14);
    refresh();
  };

  const handleRevoke = async (id: string) => {
    const result = await clientApi.revokeViewerPin(id);
    if ("unauthorized" in result) return logout();
    if ("ok" in result) refresh();
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
      case "active":
        return <span className="pill pill-verified">Active</span>;
      case "expired":
        return <span className="pill pill-gray">Expired</span>;
      case "revoked":
        return <span className="pill pill-red">Revoked</span>;
      case "used-up":
        return <span className="pill pill-amber">Used Up</span>;
      default:
        return <span className="pill pill-navy">{status}</span>;
    }
  };

  return (
    <PageWidth space="page">
      <PageHeader
        eyebrow="Onboarding"
        title="Invite your team"
        subtitle="Mint a read-only invite for a colleague in your organisation. They self-register with it and land beside you."
      />

      <div className="grid gap-8 mt-7">
        <div className="card">
          <SectionHeading eyebrow="How it works" title="Three steps to a new viewer" />
          <ol className="mt-3 pl-5 text-slate-base text-[14px] leading-[1.7]">
            <li>Mint a viewer invite below. The PIN is shown once, so copy it then.</li>
            <li>Share the PIN with your colleague over a channel you trust.</li>
            <li>
              They open the sign-in screen, choose Create Account, and enter the PIN. They land in your organisation
              with read-only access to the same companies you see.
            </li>
          </ol>
        </div>

        <div className="card card-accent-gold">
          <h3 className="font-serif text-title font-semibold text-navy mb-4">
            Mint viewer invite
          </h3>
          {errorMsg && (
            <div className="alert-error mb-4">
              <TriangleAlert size={16} />
              <span>{errorMsg}</span>
            </div>
          )}
          <form onSubmit={handleMint} className="grid grid-cols-2 gap-4 items-end">
            <div className="col-span-full">
              <label className="label-base">Label (optional)</label>
              <input
                className="input-base"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Finance team viewer"
              />
            </div>
            <div>
              <label className="label-base">Max uses</label>
              <input
                type="number"
                min={1}
                className="input-base"
                value={maxUses}
                onChange={(e) => setMaxUses(parseInt(e.target.value))}
              />
            </div>
            <div>
              <label className="label-base">Expires in (days)</label>
              <input
                type="number"
                min={1}
                className="input-base"
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(parseInt(e.target.value))}
              />
            </div>
            <div className="col-span-full flex justify-end">
              <button type="submit" className="btn-primary" disabled={minting}>
                {minting ? <Loader2 size={16} className="animate-spin" /> : "Mint invite"}
              </button>
            </div>
          </form>

          {mintedCode && (
            <div className="mt-6 p-6 bg-cream-light border border-dashed border-gold rounded text-center">
              <div className="eyebrow text-coral-ink mb-2">
                Copy it now, it will not be shown again
              </div>
              <div className="font-mono text-[32px] text-navy font-medium mb-4 tracking-[0.1em]">
                {mintedCode}
              </div>
              <button onClick={copyCode} className="btn-ghost mx-auto">
                {copied ? (
                  <>
                    <Check size={14} /> Copied
                  </>
                ) : (
                  <>
                    <Copy size={14} /> Copy to clipboard
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        <div>
          <h3 className="font-serif text-title font-semibold text-navy mb-4">
            Your viewer invites
          </h3>
          <div className="card p-0 overflow-hidden">
            {state === "loading" ? (
              <div className="p-6">
                <div className="skeleton h-25" />
              </div>
            ) : state === "error" ? (
              <div className="p-6 text-red-base">Failed to load your invites.</div>
            ) : state === "empty" ? (
              <div className="p-8 text-center text-slate-light">
                You have not minted any viewer invites yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Label / ID</th>
                      <th>State</th>
                      <th>Uses</th>
                      <th>Created</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pins.map((pin) => (
                      <tr key={pin.id}>
                        <td>
                          <div className="font-medium text-navy">{pin.label || "Untitled"}</div>
                          <div className="font-mono text-meta text-slate-light">
                            {pin.id.slice(0, 8)}...
                          </div>
                        </td>
                        <td>{getStatePill(pin.state)}</td>
                        <td>
                          <span className="font-mono">
                            {pin.useCount} / {pin.maxUses}
                          </span>
                        </td>
                        <td>{new Date(pin.createdAt).toLocaleDateString()}</td>
                        <td>
                          {pin.state === "active" && (
                            <button
                              onClick={() => handleRevoke(pin.id)}
                              className="btn-ghost h-6 px-2 text-meta"
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
      </div>
    </PageWidth>
  );
}
