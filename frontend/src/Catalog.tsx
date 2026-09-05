import { FormEvent, MouseEvent, useEffect, useRef, useState } from "react";
import { api, Balloon, Characteristic, CharacteristicInput, PartRevision, PartType, Role } from "./api/client";
import DrawingViewer from "./DrawingViewer";
import RevisionHistory from "./RevisionHistory";

const numberValue = (data: FormData, key: string) => {
  const value = String(data.get(key) ?? ""); return value === "" ? null : Number(value);
};
const sections = ["Datos", "Plano", "Características", "Historial"];

export default function Catalog({ role }: { role: Role }) {
  const admin = role === "admin";
  const [parts, setParts] = useState<PartType[]>();
  const [part, setPart] = useState<PartType>();
  const [characteristics, setCharacteristics] = useState<Characteristic[]>([]);
  const [balloons, setBalloons] = useState<Balloon[]>([]);
  const [editing, setEditing] = useState<Characteristic>();
  const [format, setFormat] = useState<"SYMMETRIC" | "LIMITS">("SYMMETRIC");
  const [point, setPoint] = useState<{ x: number; y: number }>();
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [formVersion, setFormVersion] = useState(0);
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("number-asc");
  const [section, setSection] = useState("Datos");
  const [revisions, setRevisions] = useState<PartRevision[]>([]);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [activeId, setActiveId] = useState<number>();
  const [confirmation, setConfirmation] = useState<{ message: string; action: () => Promise<boolean> }>();
  const generation = useRef(0);
  const mutationPending = useRef(false);
  const cancelConfirmation = useRef<HTMLButtonElement>(null);
  const createPartNumber = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let live = true;
    api.catalog.list().then((items) => { if (live) setParts(items); }).catch(() => { if (live) setError("No se pudo cargar el catálogo."); });
    return () => { live = false; generation.current += 1; };
  }, []);
  useEffect(() => { if (creating) createPartNumber.current?.focus(); }, [creating]);
  useEffect(() => { if (confirmation) cancelConfirmation.current?.focus(); }, [confirmation]);

  async function open(selected: PartType) {
    const request = ++generation.current;
    setPart(selected); setEditing(undefined); setPoint(undefined); setError(""); setNotice("");
    setCreating(false); setSection("Datos"); setFormat("SYMMETRIC"); setActiveId(undefined); setConfirmation(undefined);
    setCharacteristics([]); setBalloons([]); setRevisions([]); setReady(false); setLoading(true); setFormVersion((value) => value + 1);
    try {
      const [nextParts, nextCharacteristics, nextBalloons, nextRevisions] = await Promise.all([api.catalog.list(), api.catalog.characteristics(selected.id), api.catalog.balloons(selected.id), api.catalog.revisions(selected.id)]);
      if (request !== generation.current) return;
      const updated = nextParts.find((item) => item.id === selected.id);
      if (!updated) throw new Error("Part no longer available");
      setParts(nextParts); setPart(updated);
      setCharacteristics(nextCharacteristics); setBalloons(nextBalloons); setRevisions(nextRevisions); setReady(true);
    } catch { if (request === generation.current) setError("No se pudo cargar el detalle del tipo de pieza."); }
    finally { if (request === generation.current) setLoading(false); }
  }
  function back() {
    generation.current += 1; setPart(undefined); setConfirmation(undefined); setError(""); setNotice(""); setLoading(false);
  }
  function changeSection(name: string) {
    setSection(name); setEditing(undefined); setFormat("SYMMETRIC"); setPoint(undefined); setConfirmation(undefined);
    setError(""); setNotice(""); setFormVersion((value) => value + 1);
  }
  async function mutate(operation: () => Promise<unknown>, failure: string): Promise<boolean> {
    if (!admin || !part || !ready || mutationPending.current) return false;
    const request = generation.current, id = part.id;
    mutationPending.current = true; setBusy(true); setError(""); setNotice("");
    let saved = false;
    try {
      await operation(); saved = true;
      const [nextParts, nextCharacteristics, nextBalloons, nextRevisions] = await Promise.all([
        api.catalog.list(), api.catalog.characteristics(id), api.catalog.balloons(id), api.catalog.revisions(id),
      ]);
      if (request !== generation.current) return false;
      const updated = nextParts.find((item) => item.id === id);
      if (!updated) throw new Error("Part no longer available");
      setParts(nextParts); setPart(updated); setCharacteristics(nextCharacteristics); setBalloons(nextBalloons); setRevisions(nextRevisions);
      setEditing(undefined); setFormat("SYMMETRIC"); setPoint(undefined); setActiveId(undefined); setConfirmation(undefined); setFormVersion((value) => value + 1);
      setNotice("Cambios guardados. El detalle y el historial están actualizados.");
      return true;
    } catch {
      if (request === generation.current) {
        setError(saved ? "El cambio se guardó, pero no se pudo actualizar el detalle. Vuelve al catálogo y abre la pieza antes de continuar." : failure);
        if (saved) { setReady(false); setConfirmation(undefined); }
      }
      return false;
    } finally { mutationPending.current = false; if (request === generation.current) setBusy(false); }
  }
  async function createPart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    if (!admin || mutationPending.current) return;
    mutationPending.current = true; setBusy(true); setError("");
    const request = generation.current;
    try { const created = await api.catalog.createPart({ part_number: String(data.get("part_number")), part_description: String(data.get("part_description")) }); if (request !== generation.current) return; setParts((current) => [...(current || []), created]); form.reset(); setCreating(false); }
    catch { if (request === generation.current) setError("No se pudo crear el tipo de pieza."); }
    finally { mutationPending.current = false; if (request === generation.current) setBusy(false); }
  }
  async function togglePart() {
    if (!part) return;
    const action = () => mutate(() => api.catalog.patchPart(part.id, { active: !part.active }), "No se pudo actualizar el tipo de pieza.");
    if (part.active) setConfirmation({ message: "Al desactivar este tipo no se podrán iniciar nuevas inspecciones con él. Se conservarán las inspecciones y revisiones existentes.", action });
    else await action();
  }
  async function savePart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!part) return; const data = new FormData(event.currentTarget);
    await mutate(() => api.catalog.patchPart(part.id, { part_number: String(data.get("part_number")), part_description: String(data.get("part_description")) }), "No se pudo actualizar el tipo de pieza.");
  }
  async function upload(file?: File) {
    if (!part || !file) return;
    await mutate(() => api.catalog.uploadImage(part.id, file), "La imagen no pudo cargarse. Usa PNG o JPEG.");
  }
  function edit(characteristic?: Characteristic) { setEditing(characteristic); setFormat(characteristic?.tol_type || "SYMMETRIC"); }
  async function saveCharacteristic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!part) return; setError(""); const form = event.currentTarget; const data = new FormData(form);
    const measurementMethod = String(data.get("measurement_method") || "").trim();
    if (!measurementMethod) { setError("El método de medición es obligatorio."); return; }
    const nominal = numberValue(data, "nominal");
    const tolPlus = format === "SYMMETRIC" ? numberValue(data, "tol_plus") : null;
    const tolMinus = format === "SYMMETRIC" ? numberValue(data, "tol_minus") : null;
    const minLimit = format === "LIMITS" ? numberValue(data, "min_limit") : null;
    const maxLimit = format === "LIMITS" ? numberValue(data, "max_limit") : null;
    const canonical = format === "SYMMETRIC" ? [nominal, tolPlus, ...(tolMinus === null ? [] : [tolMinus])] : [nominal, minLimit, maxLimit];
    if (canonical.some((value) => value === null || !Number.isFinite(value))) { setError("Ingresa valores numéricos finitos para nominal y tolerancias."); return; }
    if (format === "SYMMETRIC" && (tolPlus! < 0 || (tolMinus !== null && tolMinus < 0))) { setError("Las tolerancias no pueden ser negativas."); return; }
    if (format === "LIMITS" && !(minLimit! <= nominal! && nominal! <= maxLimit!)) { setError("El nominal debe estar entre los límites mínimo y máximo."); return; }
    const input: CharacteristicInput = {
      control_plan: String(data.get("control_plan")), name: String(data.get("name")) || null, unit: String(data.get("unit")) || null, tol_type: format,
      measurement_method: measurementMethod, nominal: nominal!, tol_plus: tolPlus, tol_minus: tolMinus,
      min_limit: minLimit, max_limit: maxLimit,
      sort_order: numberValue(data, "sort_order") || 0,
    };
    await mutate(() => editing ? api.catalog.patchCharacteristic(editing.id, input) : api.catalog.createCharacteristic(part.id, input), "No se pudo guardar la característica. Revisa los datos y tolerancias.");
  }
  async function removeCharacteristic(id: number) {
    const code = characteristics.find((item) => item.id === id)?.control_plan;
    setConfirmation({ message: `Se eliminará la característica ${code} de la definición activa y su marcador dejará de mostrarse. Si tiene mediciones, se conservará inactiva para mantener la trazabilidad. Las inspecciones anteriores no cambiarán.`, action: () => mutate(() => api.catalog.deleteCharacteristic(id), "No se pudo eliminar la característica.") });
  }
  function choosePoint(event: MouseEvent<HTMLImageElement>) {
    if (!admin || busy || !ready) return; const box = event.currentTarget.getBoundingClientRect();
    if (!box.width || !box.height) return;
    setPoint({ x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height });
  }
  async function saveBalloon(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!part || !point) return; const data = new FormData(event.currentTarget);
    await mutate(() => api.catalog.createBalloon(part.id, { characteristic_id: Number(data.get("characteristic")), ...point }), "No se pudo guardar el marcador. Verifica la característica.");
  }
  function removeBalloon(id: number) {
    setConfirmation({ message: "Se eliminará este marcador del plano actual. La característica y las revisiones anteriores se conservarán.", action: () => mutate(() => api.catalog.deleteBalloon(id), "No se pudo eliminar el marcador.") });
  }

  const query = filter.trim().toLocaleLowerCase("es");
  const filteredParts = parts?.filter((item) => [item.part_number, item.part_description, String(item.id)].some((value) => value.toLocaleLowerCase("es").includes(query)) &&
    (status === "all" || item.active === (status === "active"))).sort((a, b) => {
      const comparison = sort.startsWith("id") ? a.id - b.id : a.part_number.localeCompare(b.part_number, "es", { numeric: true });
      return (comparison || a.id - b.id) * (sort.endsWith("desc") ? -1 : 1);
    });

  return <section><h2>Catálogo</h2>{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!part && <><div className="catalog-controls">
    <label className="catalog-filter">Buscar por número de parte, descripción o ID<input value={filter} onChange={(event) => setFilter(event.target.value)} /></label>
    <label>Estado<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Todos</option><option value="active">Activos</option><option value="inactive">Inactivos</option></select></label>
    <label>Ordenar por<select value={sort} onChange={(event) => setSort(event.target.value)}><option value="number-asc">Número de parte: ascendente</option><option value="number-desc">Número de parte: descendente</option><option value="id-asc">ID: ascendente</option><option value="id-desc">ID: descendente</option></select></label>
    </div>
    {!parts ? <p>Cargando catálogo…</p> : <div className="catalog-grid">
      {admin && <button disabled={busy} className="catalog-card add-part-card" onClick={() => { setCreating(true); setError(""); }}><span aria-hidden="true">+</span><strong>Agregar pieza</strong></button>}
      {filteredParts?.map((item) => <button disabled={busy} className="catalog-card part-card" aria-label={`Ver ${item.part_number}`} onClick={() => open(item)} key={item.id}>
        {item.image_path ? <img src={`${api.catalog.imageUrl(item.id)}?revision=${item.revision_no}`} alt={`Imagen de ${item.part_number}`} /> : <span className="part-image-fallback" role="img" aria-label={`Sin imagen para ${item.part_number}`}>Sin imagen</span>}
        <span className="part-card-body"><strong>{item.part_number}</strong><span>ID {item.id}</span><span className={item.active ? "status-active" : "status-inactive"}>{item.active ? "Activo" : "Inactivo"}</span></span>
      </button>)}
      {!filteredParts?.length && <p className="catalog-empty">No se encontraron piezas con esos criterios.</p>}
    </div>}
    {admin && creating && <form onSubmit={createPart} className="card form-card create-part-form">
      <fieldset className="catalog-fields" disabled={busy}>
      <div className="form-card-header"><strong>Nuevo tipo de pieza</strong></div>
      <div className="form-card-body">
        <label>Número de parte<input ref={createPartNumber} name="part_number" required /></label>
        <label>Descripción de parte<textarea name="part_description" required /></label>
      </div>
      <div className="form-card-footer"><button type="button" onClick={() => setCreating(false)}>Cancelar</button><button>Crear tipo</button></div>
      </fieldset>
    </form>}</>}
    {part && <div className="catalog-detail">
      <button type="button" disabled={busy} className="catalog-back" onClick={back}>Volver al catálogo</button>
      <header className="catalog-detail-header"><h3>{part.part_number}</h3><p>ID {part.id} · Revisión {part.revision_no} · {part.active ? "Activo" : "Inactivo"}</p></header>
      {loading ? <p role="status">Cargando detalle…</p> : !ready ? <button type="button" onClick={() => open(part)}>Reintentar detalle</button> : <>
      <div className="catalog-tabs" role="tablist" aria-label="Secciones del tipo de pieza">{sections.map((name, index) => <button type="button" role="tab" key={name} id={`catalog-tab-${name}`} aria-controls="catalog-panel" aria-selected={section === name} tabIndex={section === name ? 0 : -1} disabled={busy} onClick={() => changeSection(name)} onKeyDown={(event) => {
        const next = event.key === "ArrowRight" ? (index + 1) % sections.length : event.key === "ArrowLeft" ? (index + sections.length - 1) % sections.length : event.key === "Home" ? 0 : event.key === "End" ? sections.length - 1 : undefined;
        if (next === undefined) return;
        event.preventDefault(); changeSection(sections[next]);
        (event.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus();
      }}>{name}</button>)}</div>
      {admin && confirmation && <section className="card form-card catalog-confirmation" role="region" aria-label="Confirmar cambio">
        <div className="form-card-header"><strong>Confirmar cambio</strong></div><div className="form-card-body"><p>{confirmation.message}</p></div>
        <div className="form-card-footer"><button ref={cancelConfirmation} disabled={busy} type="button" onClick={() => setConfirmation(undefined)}>Cancelar cambio</button><button disabled={busy} type="button" onClick={() => confirmation.action()}>Confirmar cambio</button></div>
      </section>}
      <div id="catalog-panel" role="tabpanel" tabIndex={0} aria-labelledby={`catalog-tab-${section}`}>
      <fieldset className="catalog-fields" disabled={busy || !!confirmation} aria-busy={busy}>
      {section === "Datos" && (admin ? <form key={`part-${part.id}-${formVersion}`} onSubmit={savePart} className="card form-card">
        <div className="form-card-header"><strong>{part.part_number}</strong>
          <span className={part.active ? "status-active" : "status-inactive"}>{part.active ? "Activo" : "Inactivo"}</span>
          <button type="button" className="push-right" onClick={togglePart}>{part.active ? "Desactivar tipo" : "Activar tipo"}</button>
        </div>
        <div className="form-card-body">
          <div className="field-grid">
            <label>Número de parte<input name="part_number" defaultValue={part.part_number} required /></label>
          </div>
          <label>Descripción de parte<textarea name="part_description" defaultValue={part.part_description} required /></label>
        </div>
        <div className="form-card-footer"><button>Guardar tipo</button></div>
      </form> : <article className="card"><h4>Datos</h4><p>{part.part_description}</p></article>)}
      {section === "Características" && <>
      <h3>Características</h3>{characteristics.length ? <ul className="list">{characteristics.map((item) => <li key={item.id}><span><strong>{item.control_plan}</strong> — {item.name || "Sin nombre"}{item.unit ? ` (${item.unit})` : ""}<br />{item.measurement_method} · Nominal {item.nominal} · Límites {item.min_limit} — {item.max_limit}</span>{admin && <><button aria-label={`Editar ${item.control_plan}`} onClick={() => edit(item)}>Editar</button><button aria-label={`Eliminar ${item.control_plan}`} onClick={() => removeCharacteristic(item.id)}>Eliminar</button></>}</li>)}</ul> : <p>Este tipo no tiene características.</p>}
      {admin && <><form key={`${editing?.id || "new"}-${formVersion}`} aria-label="Definir característica" onSubmit={saveCharacteristic} className="card form-card">
        <div className="form-card-header"><strong>{editing ? `Editar ${editing.control_plan}` : "Nueva característica"}</strong></div>
        <div className="form-card-body">
          <p className="field-section">Identificación</p>
          <div className="field-grid">
            <label>Plan de control<input name="control_plan" defaultValue={editing?.control_plan} required /></label>
            <label>Nombre<input name="name" defaultValue={editing?.name || ""} /></label>
          </div>
          <label>Método de medición<input name="measurement_method" defaultValue={editing?.measurement_method || ""} required maxLength={500} /></label>
          <div className="field-grid field-grid-narrow">
            <label>Unidad<input name="unit" defaultValue={editing?.unit || ""} /></label>
            <label>Orden<input name="sort_order" type="number" defaultValue={editing?.sort_order || 0} /></label>
          </div>
          <p className="field-section">Tolerancia</p>
          <label className="field-narrow">Formato de tolerancia<select value={format} onChange={(event) => setFormat(event.target.value as typeof format)}><option value="SYMMETRIC">Nominal ± tolerancias</option><option value="LIMITS">Límites</option></select></label>
          <div className="field-grid field-grid-narrow">
            <label key={`nominal-${format}`}>Nominal<input name="nominal" type="number" step="any" defaultValue={editing?.nominal ?? ""} required /></label>
            {format === "SYMMETRIC" ? <><label key="upper-tolerance">Tolerancia superior<input name="tol_plus" type="number" step="any" min="0" defaultValue={editing?.tol_plus ?? ""} required /></label><label key="lower-tolerance">Tolerancia inferior<input name="tol_minus" type="number" step="any" min="0" defaultValue={editing?.tol_minus ?? ""} /></label></> : <><label key="minimum">Límite mínimo<input name="min_limit" type="number" step="any" defaultValue={editing?.min_limit ?? ""} required /></label><label key="maximum">Límite máximo<input name="max_limit" type="number" step="any" defaultValue={editing?.max_limit ?? ""} required /></label></>}
          </div>
        </div>
        <div className="form-card-footer">{editing && <button type="button" onClick={() => edit()}>Cancelar edición</button>}<button>Guardar característica</button></div>
       </form></>}
      </>}
      {section === "Plano" && <>
        {admin && <form className="card form-card" onSubmit={(event) => event.preventDefault()}><div className="form-card-header"><strong>Plano de la pieza</strong></div><div className="form-card-body"><label>Imagen de la pieza<input key={formVersion} type="file" accept="image/png,image/jpeg" onChange={(event) => upload(event.target.files?.[0])} /></label></div></form>}
        {part.image_path ? <DrawingViewer key={part.id} src={`${api.catalog.imageUrl(part.id)}?revision=${part.revision_no}`} alt={`Plano de ${part.part_number}`} balloons={balloons} characteristics={characteristics} activeId={activeId} onSelect={setActiveId} onImageClick={admin ? choosePoint : undefined} onRemove={admin ? removeBalloon : undefined} /> : <p>No hay plano disponible.</p>}
        {admin && part.image_path && <form key={`balloon-${formVersion}`} onSubmit={saveBalloon} className="card form-card">
          <div className="form-card-header"><strong>Marcador en plano</strong></div>
          <div className="form-card-body">
            <p className="field-hint">{point ? `Posición: ${point.x.toFixed(3)}, ${point.y.toFixed(3)}` : "Selecciona una posición en la imagen."}</p>
            <label className="field-narrow">Característica del marcador<select name="characteristic" required><option value="">Selecciona</option>{characteristics.map((item) => <option key={item.id} value={item.id}>{item.control_plan}</option>)}</select></label>
          </div>
          <div className="form-card-footer"><button disabled={!point}>Guardar marcador</button></div>
        </form>}
      </>}
      {section === "Historial" && <RevisionHistory key={`${part.id}-${part.revision_no}-${formVersion}`} revisions={revisions} currentRevisionNo={part.revision_no} admin={admin} busy={busy} onRestore={(revisionNo) => mutate(() => api.catalog.restoreRevision(part.id, revisionNo), "No se pudo restaurar la revisión.")} />}
      </fieldset></div></>}
    </div>}
  </section>;
}
