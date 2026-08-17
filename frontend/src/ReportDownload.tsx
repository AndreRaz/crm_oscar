import { useState } from "react";
import { api } from "./api/client";

export default function ReportDownload({ inspectionId, label, onError }: { inspectionId: number; label: string; onError: (message: string) => void }) {
  const [pending, setPending] = useState(false);
  async function download() {
    setPending(true); onError("");
    try {
      const blob = await api.inspections.report(inspectionId);
      const url = URL.createObjectURL(blob); const link = document.createElement("a");
      link.href = url; link.download = `inspeccion-${inspectionId}.pdf`; link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      onError(`No se pudo descargar el informe.${error instanceof Error ? ` ${error.message}` : ""}`);
    } finally { setPending(false); }
  }
  return <button type="button" disabled={pending} onClick={download}>{pending ? "Descargando…" : label}</button>;
}
