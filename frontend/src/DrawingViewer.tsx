import { MouseEvent, useEffect, useRef, useState } from "react";
import { Balloon, Characteristic } from "./api/client";

export type DrawingViewerProps = {
  src: string;
  alt: string;
  balloons: Balloon[];
  characteristics: Characteristic[];
  activeId?: number;
  onSelect?: (id: number) => void;
  onImageClick?: (event: MouseEvent<HTMLImageElement>) => void;
  onRemove?: (id: number) => void;
};

export default function DrawingViewer({ src, alt, balloons, characteristics, activeId, onSelect, onImageClick, onRemove }: DrawingViewerProps) {
  const [zoom, setZoom] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const selected = characteristics.find((item) => item.id === activeId);
  function reset() {
    setZoom(1);
    if (viewport.current) { viewport.current.scrollLeft = 0; viewport.current.scrollTop = 0; }
  }
  useEffect(() => { reset(); setError(""); }, [src]);
  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  async function toggleFullscreen() {
    setError("");
    try {
      if (document.fullscreenElement === root.current) await document.exitFullscreen();
      else if (root.current?.requestFullscreen) await root.current.requestFullscreen();
      else throw new Error("Fullscreen unavailable");
    } catch { setError("No se pudo abrir o cerrar la pantalla completa. Puedes usar el zoom y desplazar el plano."); }
  }
  async function removeMarker(id: number) {
    try {
      if (document.fullscreenElement === root.current) await document.exitFullscreen();
      onRemove?.(id);
    } catch { setError("Sal de pantalla completa antes de eliminar el marcador."); }
  }
  return <div className="drawing-viewer" ref={root}>
    <div className="drawing-toolbar" role="group" aria-label="Controles del plano">
      <button type="button" aria-label="Alejar plano" disabled={zoom <= .5} onClick={() => setZoom((value) => Math.max(.5, value - .25))}>−</button>
      <output aria-label="Nivel de zoom">{Math.round(zoom * 100)}%</output>
      <button type="button" aria-label="Acercar plano" disabled={zoom >= 4} onClick={() => setZoom((value) => Math.min(4, value + .25))}>+</button>
      <button type="button" onClick={reset}>Restablecer vista</button>
      <button type="button" onClick={toggleFullscreen}>{fullscreen ? "Salir de pantalla completa" : "Pantalla completa"}</button>
    </div>
    {error && <p role="alert">{error}</p>}
    <div className="drawing-viewport" ref={viewport} tabIndex={0} role="region" aria-label={`Vista desplazable: ${alt}`} style={{ overflow: "auto" }}>
      <div className="drawing-canvas" style={{ position: "relative", width: `${zoom * 100}%` }}>
        <img src={src} alt={alt} onClick={onImageClick} draggable={false} style={{ display: "block", width: "100%", maxWidth: "none", height: "auto" }} />
        {balloons.map((balloon) => {
          const characteristic = characteristics.find((item) => item.id === balloon.characteristic_id);
          const controlPlan = characteristic?.control_plan || "Sin característica";
          const active = activeId === balloon.characteristic_id;
          return <div key={balloon.id} className={`drawing-marker${active ? " active" : ""}`} style={{ position: "absolute", left: `${balloon.x * 100}%`, top: `${balloon.y * 100}%`, transform: "translate(-50%, -50%)" }}>
            <button type="button" className="drawing-marker-select" aria-pressed={active} aria-label={`Marcador C.P. ${active ? "activo " : ""}${controlPlan}`} onClick={(event) => { event.stopPropagation(); onSelect?.(balloon.characteristic_id); }}>{controlPlan}</button>
            {onRemove && <button type="button" className="drawing-marker-remove" style={{ position: "absolute", left: "100%", top: 0 }} aria-label={`Eliminar marcador ${controlPlan}`} onClick={(event) => { event.stopPropagation(); void removeMarker(balloon.id); }}>×</button>}
          </div>;
        })}
      </div>
    </div>
    {selected && <div className="drawing-selection" aria-live="polite"><strong>C.P. {selected.control_plan} · {selected.name || "Sin nombre"}</strong><p>{selected.measurement_method} · Nominal: {selected.nominal} {selected.unit} · Límites: {selected.min_limit} a {selected.max_limit} {selected.unit}</p></div>}
  </div>;
}
