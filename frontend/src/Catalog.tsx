import { FormEvent, MouseEvent, useEffect, useState } from "react";
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
  useEffect(() => { api.catalog.list().then(setParts).catch(() => setError("No se pudo cargar el catálogo.")); }, []);

  async function open(selected: PartType) {
    setPart(selected); setEditing(undefined); setPoint(undefined); setError("");
    try { const [nextCharacteristics, nextBalloons] = await Promise.all([api.catalog.characteristics(selected.id), api.catalog.balloons(selected.id)]); setCharacteristics(nextCharacteristics); setBalloons(nextBalloons); }
    catch { setError("No se pudo cargar el detalle del tipo de pieza."); }
  }
  async function createPart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const code = String(new FormData(form).get("code"));
    try { const created = await api.catalog.createPart({ code }); setParts((current) => [...(current || []), created]); form.reset(); }
    catch { setError("No se pudo crear el tipo de pieza."); }
  }
  async function togglePart() {
    if (!part) return; try { const updated = await api.catalog.patchPart(part.id, { active: !part.active }); setPart(updated); setParts((items) => items?.map((item) => item.id === updated.id ? updated : item)); }
    catch { setError("No se pudo actualizar el tipo de pieza."); }
  }
  async function upload(file?: File) {
    if (!part || !file) return; try { const updated = await api.catalog.uploadImage(part.id, file); setPart(updated); setParts((items) => items?.map((item) => item.id === updated.id ? updated : item)); }
    catch { setError("La imagen no pudo cargarse. Usa PNG o JPEG."); }
  }
  function edit(characteristic?: Characteristic) { setEditing(characteristic); setFormat(characteristic?.tol_type || "SYMMETRIC"); }
  async function saveCharacteristic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!part) return; const form = event.currentTarget; const data = new FormData(form);
    const input: CharacteristicInput = {
      code: String(data.get("code")), name: String(data.get("name")) || null, unit: String(data.get("unit")) || null, tol_type: format,
      nominal: format === "SYMMETRIC" ? numberValue(data, "nominal") : null,
      tol_plus: format === "SYMMETRIC" ? numberValue(data, "tol_plus") : null,
      min_limit: format === "LIMITS" ? numberValue(data, "min_limit") : null,
      max_limit: format === "LIMITS" ? numberValue(data, "max_limit") : null,
      sort_order: numberValue(data, "sort_order") || 0,
    };
    try {
      const saved = editing ? await api.catalog.patchCharacteristic(editing.id, input) : await api.catalog.createCharacteristic(part.id, input);
      setCharacteristics((items) => editing ? items.map((item) => item.id === saved.id ? saved : item) : [...items, saved]); edit(); form.reset();
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
    try { const created = await api.catalog.createBalloon(part.id, { number: Number(data.get("number")), characteristic_id: Number(data.get("characteristic")), ...point }); setBalloons((items) => [...items, created]); setPoint(undefined); event.currentTarget.reset(); }
    catch { setError("No se pudo guardar el globo. Verifica el número y la característica."); }
  }
  async function removeBalloon(id: number) { try { await api.catalog.deleteBalloon(id); setBalloons((items) => items.filter((item) => item.id !== id)); } catch { setError("No se pudo eliminar el globo."); } }

  return <section><h2>Catálogo</h2>{error && <p role="alert">{error}</p>}
    {admin && <form onSubmit={createPart} className="row card"><label>Código del nuevo tipo<input name="code" required /></label><button>Crear tipo</button></form>}
    {!parts ? <p>Cargando catálogo…</p> : <ul className="list">{parts.map((item) => <li key={item.id}><span><strong>{item.code}</strong> · {item.active ? "Activo" : "Inactivo"}</span><button aria-label={`Ver ${item.code}`} onClick={() => open(item)}>Ver características</button></li>)}</ul>}
    {part && <div className="catalog-detail"><div className="row"><h3>{part.code}</h3>{admin && <button onClick={togglePart}>{part.active ? "Desactivar tipo" : "Activar tipo"}</button>}</div>
      {admin && <label>Imagen de la pieza<input type="file" accept="image/png,image/jpeg" onChange={(event) => upload(event.target.files?.[0])} /></label>}
      {part.image_path && <div className="image-map"><img src={api.catalog.imageUrl(part.id)} alt={`Plano de ${part.code}`} onClick={choosePoint} />{balloons.map((balloon) => <span className="balloon" style={{ left: `${balloon.x * 100}%`, top: `${balloon.y * 100}%` }} aria-label={`Globo ${balloon.number}: ${characteristics.find((item) => item.id === balloon.characteristic_id)?.code || "Sin característica"}`} key={balloon.id}>{balloon.number}{admin && <button aria-label={`Eliminar globo ${balloon.number}`} onClick={() => removeBalloon(balloon.id)}>×</button>}</span>)}</div>}
      <h3>Características</h3>{characteristics.length ? <ul className="list">{characteristics.map((item) => <li key={item.id}><span><strong>{item.code}</strong> — {item.name || "Sin nombre"}{item.unit ? ` (${item.unit})` : ""}</span>{admin && <><button aria-label={`Editar ${item.code}`} onClick={() => edit(item)}>Editar</button><button aria-label={`Eliminar ${item.code}`} onClick={() => removeCharacteristic(item.id)}>Eliminar</button></>}</li>)}</ul> : <p>Este tipo no tiene características.</p>}
      {admin && <><form key={editing?.id || "new"} onSubmit={saveCharacteristic} className="form-grid card"><label>Código de característica<input name="code" defaultValue={editing?.code} required /></label><label>Nombre<input name="name" defaultValue={editing?.name || ""} /></label><label>Unidad<input name="unit" defaultValue={editing?.unit || ""} /></label><label>Orden<input name="sort_order" type="number" defaultValue={editing?.sort_order || 0} /></label><label>Formato de tolerancia<select value={format} onChange={(event) => setFormat(event.target.value as typeof format)}><option value="SYMMETRIC">Nominal ± tolerancia</option><option value="LIMITS">Límites</option></select></label>{format === "SYMMETRIC" ? <><label key="nominal">Nominal<input name="nominal" type="number" step="any" defaultValue={editing?.nominal ?? ""} required /></label><label key="tolerance">Tolerancia ±<input name="tol_plus" type="number" step="any" min="0" defaultValue={editing?.tol_plus ?? ""} required /></label></> : <><label key="minimum">Límite mínimo<input name="min_limit" type="number" step="any" defaultValue={editing?.min_limit ?? ""} /></label><label key="maximum">Límite máximo<input name="max_limit" type="number" step="any" defaultValue={editing?.max_limit ?? ""} /></label></>}<button>Guardar característica</button>{editing && <button type="button" onClick={() => edit()}>Cancelar edición</button>}</form>
        {part.image_path && <form onSubmit={saveBalloon} className="row card"><p>{point ? `Posición: ${point.x.toFixed(3)}, ${point.y.toFixed(3)}` : "Selecciona una posición en la imagen."}</p><label>Número de globo<input name="number" type="number" min="1" required /></label><label>Característica del globo<select name="characteristic" required><option value="">Selecciona</option>{characteristics.map((item) => <option key={item.id} value={item.id}>{item.code}</option>)}</select></label><button disabled={!point}>Guardar globo</button></form>}</>}
    </div>}
  </section>;
}
