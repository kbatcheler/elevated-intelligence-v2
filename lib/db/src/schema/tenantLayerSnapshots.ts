import { sql } from "drizzle-orm";
import { boolean, doublePrecision, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

// One connected derived signal's de-identified metadata as it stood at build
// time: the connector source it came from and when it was computed (epoch
// milliseconds, or null when the signal carried no timestamp). This is the SAME
// pair already present in derived_signals (a connector key reference and a
// timestamp, never raw client content), captured per build so the as-of efficacy
// can recompute coverage, freshness, and source diversity from what actually
// grounded the build rather than from the live signals, which are delete-replaced
// on every refresh.
export interface SnapshotSignalMeta {
  sourceConnectorKey: string | null;
  computedAt: number | null;
}

// The as-of replay snapshot store (Phase AM). One APPEND-ONLY row per layer
// (re)build, capturing the diagnosis content EXACTLY as it was persisted at that
// moment. It exists because tenant_layers is upserted in place (unique on
// (tenant_id, layer_key)), so a refresh overwrites the prior narrative, claim
// split and confounder verdicts; without this ledger a past diagnosis could not
// be reconstructed and an as-of view would have to fabricate it, which the
// honesty boundary forbids ("a figure is computed from persisted state or it is
// not shown").
//
// What is and is not stored, and why:
// - The content fields mirror tenant_layers field-for-field (content, heroPanel,
//   peerBenchmark, supplementBlocks, confounders, verifiedClaims, modelledClaims,
//   voiceQuality, reducedMode, generatorModel). They are written from the SAME
//   dash-stripped row the upsert uses, so a snapshot is byte-identical to the
//   live row at build time and is itself dash-clean.
// - rawConfidence is the overall numeric confidence the assembler wrote onto the
//   content at build time, snapshotted so the as-of confidence advisory can be
//   recomputed against the forecasts resolved by the as-of date. Null when the
//   content carried no numeric overall confidence (honest absence).
// - contentHash is a sha256 over a canonical, stable-key serialisation of the
//   content fields. It is the fingerprint the "what changed since" diff compares;
//   two builds that produced identical content hash equal, a real change does not.
// - The efficacy index is deliberately NOT stored. It is a read-time derivation
//   in every other surface; recomputing it from the snapshot's own claim arrays
//   plus the connected-signal metadata captured in signalMeta (below) keeps it
//   from drifting from its inputs, which storing a frozen figure would risk.
//
// Append-only is enforced at the application layer, mirroring provenance_ledger:
// rows are inserted, never updated or deleted. layerKey is a plain text key (no
// foreign key), consistent with committed_actions, forecasts and decision_records,
// so a later removal of a custom layer can never orphan the history of what that
// layer once said.
export const tenantLayerSnapshotsTable = pgTable(
  "tenant_layer_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    layerKey: text("layer_key").notNull(),
    // The pipeline run that produced this build, snapshotted by reference for
    // traceability. Nullable for a build that recorded no run id; no foreign key,
    // so trimming run history never deletes a diagnosis snapshot.
    runId: uuid("run_id"),
    // The moment the build was persisted. Set explicitly to the SAME instant the
    // tenant_layers row records as generatedAt, so the snapshot and the live row
    // agree on when this content was true. The as-of read selects the latest
    // snapshot whose snapshotAt is at or before the requested date.
    snapshotAt: timestamp("snapshot_at", { withTimezone: true }).notNull(),
    content: jsonb("content").notNull().$type<Record<string, unknown>>(),
    heroPanel: jsonb("hero_panel").$type<Record<string, unknown> | null>(),
    peerBenchmark: jsonb("peer_benchmark").$type<Record<string, unknown> | null>(),
    supplementBlocks: jsonb("supplement_blocks").$type<Record<string, unknown> | null>(),
    confounders: jsonb("confounders").$type<unknown[] | null>(),
    verifiedClaims: jsonb("verified_claims").$type<Record<string, unknown> | null>(),
    modelledClaims: jsonb("modelled_claims").$type<Record<string, unknown> | null>(),
    voiceQuality: jsonb("voice_quality").$type<Record<string, unknown> | null>(),
    reducedMode: boolean("reduced_mode").notNull().default(false),
    // The tenant data mode in effect for THIS build ("outside_in" | "connected"),
    // snapshotted so the as-of efficacy is recomputed with the mode ceiling and
    // driver applicability the build actually had. Reading the tenant's CURRENT
    // dataMode would fabricate a score the system never held then: a tenant that
    // later connected would retroactively gain a higher ceiling on a past date.
    dataMode: text("data_mode").notNull(),
    // The layer's feed list at build time, which is the coverage-driver
    // denominator. Snapshotted because layers.feeds can change after a build, and
    // an as-of coverage figure computed against the current denominator would not
    // match what was true then.
    feeds: jsonb("feeds").notNull().$type<string[]>(),
    // The connected-signal metadata that grounded THIS build: per source signal,
    // its connector key and computedAt. Captured because derived_signals is
    // delete-replaced on every refresh (persistDerivedSignalSet), so the live
    // table can no longer answer "what grounded the build on a past date"; without
    // this the as-of coverage, freshness, and source-diversity drivers would read
    // the CURRENT signals and understate or null out a past connected build. It
    // holds no raw client content, only the same de-identified references already
    // in derived_signals. An outside_in build, or a layer with no grounding,
    // captures an honest empty set (the column default).
    signalMeta: jsonb("signal_meta")
      .notNull()
      .$type<SnapshotSignalMeta[]>()
      .default(sql`'[]'::jsonb`),
    generatorModel: text("generator_model").notNull(),
    rawConfidence: doublePrecision("raw_confidence"),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantLayerAtIdx: index("tenant_layer_snapshots_tenant_layer_at_idx").on(
      t.tenantId,
      t.layerKey,
      t.snapshotAt,
    ),
    tenantAtIdx: index("tenant_layer_snapshots_tenant_at_idx").on(t.tenantId, t.snapshotAt),
  }),
);

export type TenantLayerSnapshot = typeof tenantLayerSnapshotsTable.$inferSelect;
export type InsertTenantLayerSnapshot = typeof tenantLayerSnapshotsTable.$inferInsert;
