import { describe, expect, it } from "vitest";
import { ingestionStatusPill, uploadErrorLabel } from "./ingestionView";

describe("ingestionView.ingestionStatusPill", () => {
  it("maps the two known statuses to their verified/red pills", () => {
    expect(ingestionStatusPill("active")).toEqual({ className: "pill pill-verified", label: "Active" });
    expect(ingestionStatusPill("revoked")).toEqual({ className: "pill pill-red", label: "Revoked" });
  });

  it("carries an unknown status as a navy pill rather than fabricating a state", () => {
    expect(ingestionStatusPill("pending")).toEqual({ className: "pill pill-navy", label: "pending" });
  });
});

describe("ingestionView.uploadErrorLabel", () => {
  it("gives human copy for each known upload error code", () => {
    expect(uploadErrorLabel("file_too_large")).toContain("10MB");
    expect(uploadErrorLabel("unsupported_file_type")).toContain(".csv");
    expect(uploadErrorLabel("unsupported_extension")).toContain(".csv");
    expect(uploadErrorLabel("mime_mismatch")).toContain("does not match");
    expect(uploadErrorLabel("local_extraction_seat_not_connected")).toContain("local model seat");
    expect(uploadErrorLabel("layer_not_enabled")).toContain("not enabled");
    expect(uploadErrorLabel("unknown_layer")).toContain("not enabled");
    expect(uploadErrorLabel("no_numeric_signals")).toContain("No numeric signals");
    expect(uploadErrorLabel("invalid_signals")).toContain("No numeric signals");
  });

  it("falls back to a plain message for an unrecognised code, never a raw code", () => {
    expect(uploadErrorLabel("kaboom_x9")).toBe("Upload failed.");
  });
});
