import { FormEvent, MouseEvent, useEffect, useRef, useState } from "react";
import { api, Balloon, Characteristic, CharacteristicInput, PartType, Role } from "./api/client";

const numberValue = (data: FormData, key: string) => {
  const value = String(data.get(key) ?? ""); return value === "" ? null : Number(value);
};

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
  const createPartNumber = useRef<HTMLInputElement>(null);
  useEffect(() => { api.catalog.list().then(setParts).catch(() => setError("No se pudo cargar el catálogo.")); }, []);
  useEffect(() => { if (creating) createPartNumber.current?.focus(); }, [creating]);

  async function open(selected: PartType) {
    setPart(selected); setEditing(undefined); setPoint(undefined); setError("");
    try { const [nextCharacteristics, nextBalloons] = await Promise.all([api.catalog.characteristics(selected.id), api.catalog.balloons(selected.id)]); setCharacteristics(nextCharacteristics); setBalloons(nextBalloons); }
    catch { setError("No se pudo cargar el detalle del tipo de pieza."); }
  }
  async function createPart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    try { const created = await api.catalog.createPart({ part_number: String(data.get("part_number")), part_description: String(data.get("part_description")) }); setParts((current) => [...(current || []), created]); form.reset(); setCreating(false); }
    catch { setError("No se pudo crear el tipo de pieza."); }
  }
  async function togglePart() {
    if (!part) return; try { const updated = await api.catalog.patchPart(part.id, { active: !part.active }); setPart(updated); setParts((items) => items?.map((item) => item.id === updated.id ? updated : item)); }
    catch { setError("No se pudo actualizar el tipo de pieza."); }
  }
  async function savePart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!part) return; const data = new FormData(event.currentTarget);
    try { const updated = await api.catalog.patchPart(part.id, { part_number: String(data.get("part_number")), part_description: String(data.get("part_description")) }); setPart(updated); setParts((items) => items?.map((item) => item.id === updated.id ? updated : item)); }
    catch { setError("No se pudo actualizar el tipo de pieza."); }
  }
  async function upload(file?: File) {
    if (!part || !file) return; try { const updated = await api.catalog.uploadImage(part.id, file); setPart(updated); setParts((items) => items?.map((item) => item.id === updated.id ? updated : item)); }
    catch { setError("La imagen no pudo cargarse. Usa PNG o JPEG."); }
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
    try {
      const saved = editing ? await api.catalog.patchCharacteristic(editing.id, input) : await api.catalog.createCharacteristic(part.id, input);
      setCharacteristics((items) => editing ? items.map((item) => item.id === saved.id ? saved : item) : [...items, saved]); edit(); form.reset(); setFormVersion((value) => value + 1);
    } catch { setError("No se pudo guardar la característica. Revisa los datos y tolerancias."); }
  }
  async function removeCharacteristic(id: number) {
    try { await api.catalog.deleteCharacteristic(id); setCharacteristics((items) => items.filter((item) => item.id !== id)); }
    catch { setError("No se pudo eliminar la característica."); }
  }
  function choosePoint(event: MouseEvent<HTMLImageElement>) {
    if (!admin) return; const box = event.currentTarget.getBoundingClientRect();
    setPoint({ x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height });
  }
  async function saveBalloon(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!part || !point) return; const data = new FormData(event.currentTarget);
    try { const created = await api.catalog.createBalloon(part.id, { characteristic_id: Number(data.get("characteristic")), ...point }); setBalloons((items) => [...items, created]); setPoint(undefined); event.currentTarget.reset(); }
    catch { setError("No se pudo guardar el marcador. Verifica la característica."); }
  }
  async function removeBalloon(id: number) { try { await api.catalog.deleteBalloon(id); setBalloons((items) => items.filter((item) => item.id !== id)); } catch { setError("No se pudo eliminar el globo."); } }

  const filteredParts = parts?.filter((item) => String(item.id).includes(filter.trim()));

  return <section><h2>Catálogo</h2>{error && <p role="alert">{error}</p>}
    <label className="catalog-filter">Buscar por ID<input value={filter} onChange={(event) => setFilter(event.target.value)} inputMode="numeric" /></label>
    {!parts ? <p>Cargando catálogo…</p> : <div className="catalog-grid">
      {admin && <button className="catalog-card add-part-card" onClick={() => setCreating(true)}><span aria-hidden="true">+</span><strong>Agregar pieza</strong></button>}
      {filteredParts?.map((item) => <button className="catalog-card part-card" aria-label={`Ver ${item.part_number}`} onClick={() => open(item)} key={item.id}>
        {item.image_path ? <img src={api.catalog.imageUrl(item.id)} alt={`Imagen de ${item.part_number}`} /> : <span className="part-image-fallback" role="img" aria-label={`Sin imagen para ${item.part_number}`}>Sin imagen</span>}
        <span className="part-card-body"><strong>{item.part_number}</strong><span>ID {item.id}</span><span className={item.active ? "status-active" : "status-inactive"}>{item.active ? "Activo" : "Inactivo"}</span></span>
      </button>)}
      {!filteredParts?.length && <p className="catalog-empty">No se encontraron piezas para ese ID.</p>}
    </div>}
    {admin && creating && <form onSubmit={createPart} className="row card create-part-form"><label>Número de parte<input ref={createPartNumber} name="part_number" required /></label><label>Descripción de parte<textarea name="part_description" required /></label><button>Crear tipo</button><button type="button" onClick={() => setCreating(false)}>Cancelar</button></form>}
    {part && <div className="catalog-detail"><div className="row"><h3>{part.part_number}</h3>{admin && <button onClick={togglePart}>{part.active ? "Desactivar tipo" : "Activar tipo"}</button>}</div>
      {admin ? <form onSubmit={savePart} className="row"><label>Número de parte<input name="part_number" defaultValue={part.part_number} required /></label><label>Descripción de parte<textarea name="part_description" defaultValue={part.part_description} required /></label><button>Guardar tipo</button></form> : <><p>{part.part_number}</p><p>{part.part_description}</p></>}
      {admin && <label>Imagen de la pieza<input type="file" accept="image/png,image/jpeg" onChange={(event) => upload(event.target.files?.[0])} /></label>}
      {part.image_path && <div className="image-map"><img src={api.catalog.imageUrl(part.id)} alt={`Plano de ${part.part_number}`} onClick={choosePoint} />{balloons.map((balloon) => { const controlPlan = characteristics.find((item) => item.id === balloon.characteristic_id)?.control_plan || "Sin característica"; return <span className="balloon" style={{ left: `${balloon.x * 100}%`, top: `${balloon.y * 100}%` }} aria-label={`Marcador ${controlPlan}`} key={balloon.id}>{controlPlan}{admin && <button aria-label={`Eliminar marcador ${controlPlan}`} onClick={() => removeBalloon(balloon.id)}>×</button>}</span>; })}</div>}
      <h3>Características</h3>{characteristics.length ? <ul className="list">{characteristics.map((item) => <li key={item.id}><span><strong>{item.control_plan}</strong> — {item.name || "Sin nombre"}{item.unit ? ` (${item.unit})` : ""}<br />{item.measurement_method} · Nominal {item.nominal} · Límites {item.min_limit} — {item.max_limit}</span>{admin && <><button aria-label={`Editar ${item.control_plan}`} onClick={() => edit(item)}>Editar</button><button aria-label={`Eliminar ${item.control_plan}`} onClick={() => removeCharacteristic(item.id)}>Eliminar</button></>}</li>)}</ul> : <p>Este tipo no tiene características.</p>}
      {admin && <><form key={`${editing?.id || "new"}-${formVersion}`} aria-label="Definir característica" onSubmit={saveCharacteristic} className="form-grid card"><label>Plan de control<input name="control_plan" defaultValue={editing?.control_plan} required /></label><label>Nombre<input name="name" defaultValue={editing?.name || ""} /></label><label>Unidad<input name="unit" defaultValue={editing?.unit || ""} /></label><label>Método de medición<input name="measurement_method" defaultValue={editing?.measurement_method || ""} required maxLength={500} /></label><label>Orden<input name="sort_order" type="number" defaultValue={editing?.sort_order || 0} /></label><label>Formato de tolerancia<select value={format} onChange={(event) => setFormat(event.target.value as typeof format)}><option value="SYMMETRIC">Nominal ± tolerancias</option><option value="LIMITS">Límites</option></select></label><label key={`nominal-${format}`}>Nominal<input name="nominal" type="number" step="any" defaultValue={editing?.nominal ?? ""} required /></label>{format === "SYMMETRIC" ? <><label key="upper-tolerance">Tolerancia superior<input name="tol_plus" type="number" step="any" min="0" defaultValue={editing?.tol_plus ?? ""} required /></label><label key="lower-tolerance">Tolerancia inferior<input name="tol_minus" type="number" step="any" min="0" defaultValue={editing?.tol_minus ?? ""} /></label></> : <><label key="minimum">Límite mínimo<input name="min_limit" type="number" step="any" defaultValue={editing?.min_limit ?? ""} required /></label><label key="maximum">Límite máximo<input name="max_limit" type="number" step="any" defaultValue={editing?.max_limit ?? ""} required /></label></>}<button>Guardar característica</button>{editing && <button type="button" onClick={() => edit()}>Cancelar edición</button>}</form>
        {part.image_path && <form onSubmit={saveBalloon} className="row card"><p>{point ? `Posición: ${point.x.toFixed(3)}, ${point.y.toFixed(3)}` : "Selecciona una posición en la imagen."}</p><label>Característica del marcador<select name="characteristic" required><option value="">Selecciona</option>{characteristics.map((item) => <option key={item.id} value={item.id}>{item.control_plan}</option>)}</select></label><button disabled={!point}>Guardar marcador</button></form>}</>}
    </div>}
  </section>;
}
