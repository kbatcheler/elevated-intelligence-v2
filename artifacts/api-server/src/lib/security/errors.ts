// Typed failures for the per-tenant crypto path. They exist so the read path can
// fail loud and a caller can tell a crypto-shredded tenant (key revoked and its
// material destroyed) apart from a generic decryption fault, and so neither one
// is ever swallowed into a silent empty grounding.

export class CryptoShreddedError extends Error {
  readonly ref: string;
  constructor(ref: string, detail: string) {
    super("crypto-shredded [" + ref + "]: " + detail);
    this.name = "CryptoShreddedError";
    this.ref = ref;
  }
}

export class SignalEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignalEncryptionError";
  }
}

export class BreakGlassRequiredError extends Error {
  readonly tenantId: string;
  constructor(tenantId: string, detail: string) {
    super("break-glass required for tenant " + tenantId + ": " + detail);
    this.name = "BreakGlassRequiredError";
    this.tenantId = tenantId;
  }
}
