// Pure view logic for the custom-layer admin panel (Phase AG). The canonical-key
// derivation and the create error-code copy are extracted so they are
// unit-testable without rendering the panel.

// Canonical layers are the runnable catalog minus the custom layers; only a
// canonical layer is a valid benchmark mapping target.
export function canonicalKeys(
  catalog: readonly { key: string }[],
  custom: readonly { key: string }[],
): string[] {
  const customKeys = new Set(custom.map((l) => l.key));
  return catalog.filter((l) => !customKeys.has(l.key)).map((l) => l.key);
}

// Human copy for a custom-layer create error code. An unrecognised code falls
// back to a plain failure message rather than surfacing a raw machine code.
export function customLayerErrorLabel(code: string): string {
  switch (code) {
    case "invalid_request":
      return "Check the template: a name, a diagnostic question, an archetype, exactly four metric tiles, and at least one feed are required.";
    case "invalid_benchmark_canonical_key":
      return "The benchmark mapping must target an existing canonical layer.";
    default:
      return "Failed to create the custom layer.";
  }
}
