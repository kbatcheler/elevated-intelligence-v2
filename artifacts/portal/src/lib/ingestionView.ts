// Pure view logic for the ingestion admin panel (Phase AE). The status-pill
// descriptor and the upload error-code copy are extracted so they are
// unit-testable without rendering the panel.

// The pill class and label for an ingestion key or webhook source status. An
// unknown status passes through as a navy pill carrying the raw status, never a
// fabricated state.
export function ingestionStatusPill(status: string): { className: string; label: string } {
  switch (status) {
    case "active":
      return { className: "pill pill-verified", label: "Active" };
    case "revoked":
      return { className: "pill pill-red", label: "Revoked" };
    default:
      return { className: "pill pill-navy", label: status };
  }
}

// Human copy for an upload error code. An unrecognised code falls back to a plain
// "Upload failed." rather than surfacing a raw machine code.
export function uploadErrorLabel(code: string): string {
  switch (code) {
    case "file_too_large":
      return "That file exceeds the 10MB upload limit.";
    case "unsupported_file_type":
    case "unsupported_extension":
      return "Only .csv, .xlsx, .docx, and .pdf files are accepted.";
    case "mime_mismatch":
      return "The file content does not match its extension.";
    case "local_extraction_seat_not_connected":
      return "Contract extraction needs the local model seat, which is not connected.";
    case "layer_not_enabled":
    case "unknown_layer":
      return "That layer is not enabled for this tenant.";
    case "no_numeric_signals":
    case "invalid_signals":
      return "No numeric signals could be derived from that file.";
    default:
      return "Upload failed.";
  }
}
