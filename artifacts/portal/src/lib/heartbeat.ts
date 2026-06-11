import type { PipelineRun, SignalLayer } from "../types";

// The heartbeat shows the tenant's data feeds and how alive each one is. A feed
// and its consuming layers are registry facts (each layer lists the feeds it
// reads), so they appear for every tenant. Activity is real run telemetry: the
// most recent finished run among the consuming layers, plus the total recorded
// search calls and stage durations across those runs. A feed whose layers have
// not run reports null/zero activity, which is honest, not invented. Nothing is
// computed beyond summing and max-ing values the pipeline actually recorded.

export interface FeedPulse {
  feed: string;
  consumingLayers: { key: string; name: string }[];
  lastFinishedAt: string | null;
  runCount: number;
  searchCalls: number;
  totalDurationMs: number;
}

export function deriveHeartbeat(
  signals: readonly SignalLayer[],
  runs: readonly PipelineRun[],
): FeedPulse[] {
  // feed -> consuming layers, in registry order.
  const feedToLayers = new Map<string, { key: string; name: string }[]>();
  const ordered = [...signals].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const s of ordered) {
    for (const feed of s.feeds) {
      if (feed === "") continue;
      const list = feedToLayers.get(feed) ?? [];
      list.push({ key: s.key, name: s.name });
      feedToLayers.set(feed, list);
    }
  }

  // layerKey -> runs, for activity lookup.
  const runsByLayer = new Map<string, PipelineRun[]>();
  for (const run of runs) {
    const list = runsByLayer.get(run.layerKey) ?? [];
    list.push(run);
    runsByLayer.set(run.layerKey, list);
  }

  const pulses: FeedPulse[] = [];
  for (const [feed, layers] of feedToLayers) {
    let lastFinishedAt: string | null = null;
    let runCount = 0;
    let searchCalls = 0;
    let totalDurationMs = 0;
    for (const layer of layers) {
      for (const run of runsByLayer.get(layer.key) ?? []) {
        runCount++;
        if (run.finishedAt && (lastFinishedAt == null || run.finishedAt > lastFinishedAt)) {
          lastFinishedAt = run.finishedAt;
        }
        for (const stage of run.subStages) {
          if (stage.durationMs != null) totalDurationMs += stage.durationMs;
          if (stage.telemetry?.searchCalls != null) searchCalls += stage.telemetry.searchCalls;
        }
      }
    }
    pulses.push({ feed, consumingLayers: layers, lastFinishedAt, runCount, searchCalls, totalDurationMs });
  }

  // Most recently active feed first; never-run feeds last; alphabetical ties.
  // ISO timestamps compare chronologically as strings.
  pulses.sort((a, b) => {
    if (a.lastFinishedAt && b.lastFinishedAt) {
      if (a.lastFinishedAt !== b.lastFinishedAt) return a.lastFinishedAt > b.lastFinishedAt ? -1 : 1;
    } else if (a.lastFinishedAt) {
      return -1;
    } else if (b.lastFinishedAt) {
      return 1;
    }
    return a.feed.localeCompare(b.feed);
  });

  return pulses;
}
