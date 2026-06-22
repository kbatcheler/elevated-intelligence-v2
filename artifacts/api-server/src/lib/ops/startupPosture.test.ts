import { afterEach, describe, expect, it } from "vitest";
import {
  logStartupPosture,
  rateLimitPostureLine,
  scheduledLoopPostureLine,
  SCHEDULED_LOOPS,
} from "./startupPosture";

describe("rateLimitPostureLine", () => {
  it("warns and names the postgres opt-in when the store is in-memory", () => {
    const line = rateLimitPostureLine("memory");
    expect(line.level).toBe("warn");
    expect(line.msg).toContain("single-instance");
    expect(line.msg).toContain("RATE_LIMIT_STORE=postgres");
    expect(line.fields.rateLimitStore).toBe("memory");
    expect(line.fields.sharedAcrossInstances).toBe(false);
  });

  it("is informational and shared when the store is postgres", () => {
    const line = rateLimitPostureLine("postgres");
    expect(line.level).toBe("info");
    expect(line.msg).toContain("shared across instances");
    expect(line.fields.rateLimitStore).toBe("postgres");
    expect(line.fields.sharedAcrossInstances).toBe(true);
  });
});

describe("scheduledLoopPostureLine", () => {
  it("states the single loop-runner requirement and lists every loop", () => {
    const line = scheduledLoopPostureLine();
    expect(line.level).toBe("info");
    expect(line.msg).toContain("single loop-runner");
    expect(Array.isArray(line.fields.scheduledLoops)).toBe(true);
    expect((line.fields.scheduledLoops as string[]).length).toBe(SCHEDULED_LOOPS.length);
    expect(SCHEDULED_LOOPS.length).toBe(7);
  });
});

describe("logStartupPosture", () => {
  const original = process.env.RATE_LIMIT_STORE;

  afterEach(() => {
    if (original === undefined) delete process.env.RATE_LIMIT_STORE;
    else process.env.RATE_LIMIT_STORE = original;
  });

  function capture() {
    const calls: { level: "info" | "warn"; msg: string }[] = [];
    const log = {
      info: (_f: Record<string, unknown>, msg: string) => {
        calls.push({ level: "info", msg });
      },
      warn: (_f: Record<string, unknown>, msg: string) => {
        calls.push({ level: "warn", msg });
      },
    };
    return { log, calls };
  }

  it("warns on the memory default and still logs the loop posture", () => {
    delete process.env.RATE_LIMIT_STORE;
    const { log, calls } = capture();
    logStartupPosture(log);
    expect(calls.some((c) => c.level === "warn" && c.msg.includes("memory"))).toBe(true);
    expect(calls.some((c) => c.level === "info" && c.msg.includes("single loop-runner"))).toBe(true);
  });

  it("does not warn when RATE_LIMIT_STORE=postgres, and logs two informational lines", () => {
    process.env.RATE_LIMIT_STORE = "postgres";
    const { log, calls } = capture();
    logStartupPosture(log);
    expect(calls.some((c) => c.level === "warn")).toBe(false);
    expect(calls.filter((c) => c.level === "info").length).toBe(2);
  });
});
