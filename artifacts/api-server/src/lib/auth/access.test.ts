import { describe, expect, it } from "vitest";
import { canAccessTenant, isOwner, isProvider } from "./access";

const TENANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("role helpers", () => {
  it("identifies provider seats", () => {
    expect(isProvider("provider-owner")).toBe(true);
    expect(isProvider("provider-member")).toBe(true);
    expect(isProvider("client-admin")).toBe(false);
    expect(isProvider("client-viewer")).toBe(false);
  });

  it("identifies the owner seat only", () => {
    expect(isOwner("provider-owner")).toBe(true);
    expect(isOwner("provider-member")).toBe(false);
    expect(isOwner("client-admin")).toBe(false);
  });
});

describe("tenant access fencing", () => {
  it("lets provider seats see any tenant regardless of bindings", () => {
    const empty = new Set<string>();
    expect(canAccessTenant({ role: "provider-owner", orgId: null }, TENANT_A, empty)).toBe(true);
    expect(canAccessTenant({ role: "provider-member", orgId: "org" }, TENANT_B, empty)).toBe(true);
  });

  it("lets a client seat see only a bound tenant", () => {
    const bound = new Set<string>([TENANT_A]);
    const user = { role: "client-viewer" as const, orgId: "client-org" };
    expect(canAccessTenant(user, TENANT_A, bound)).toBe(true);
    expect(canAccessTenant(user, TENANT_B, bound)).toBe(false);
  });

  it("lets a portfolio seat see every tenant in its bound set", () => {
    const bound = new Set<string>([TENANT_A, TENANT_B]);
    const user = { role: "client-admin" as const, orgId: "portfolio-org" };
    expect(canAccessTenant(user, TENANT_A, bound)).toBe(true);
    expect(canAccessTenant(user, TENANT_B, bound)).toBe(true);
  });

  it("denies a client seat with no org", () => {
    const bound = new Set<string>([TENANT_A]);
    expect(canAccessTenant({ role: "client-viewer", orgId: null }, TENANT_A, bound)).toBe(false);
  });
});
