import React, { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Upload, Download, Trash2, Check, Search, Pencil, RefreshCcw, ListFilter, PackageOpen, Printer } from "lucide-react";

// ---------- Types ----------
type Item = {
  id: string;
  name: string;
  quantity?: string;
  unit?: string;
  category: string;
  notes?: string;
  have?: boolean;      // already in pantry/fridge
  checked?: boolean;   // added to cart / done
  createdAt?: number;
};

// ---------- Constants ----------
const DEFAULT_CATEGORIES = [
  "Produce",
  "Dairy",
  "Meat & Seafood",
  "Deli",
  "Bakery",
  "Frozen",
  "Dry Goods / Pantry",
  "Beverages",
  "Household",
  "Other",
];

const LS_ITEMS_KEY = "shopping_list_items_v1";
const LS_CATS_KEY = "shopping_list_categories_v1";

// ---------- Helpers ----------
const uid = () => Math.random().toString(36).slice(2, 10);

function saveToLS<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

function loadFromLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function toCSV(items: Item[]) {
  const header = ["name", "quantity", "unit", "category", "notes", "have", "checked"]; 
  const lines = [header.join(",")];
  for (const it of items) {
    const row = [
      it.name ?? "",
      it.quantity ?? "",
      it.unit ?? "",
      it.category ?? "",
      it.notes ?? "",
      it.have ? "TRUE" : "FALSE",
      it.checked ? "TRUE" : "FALSE",
    ].map(v => `"${String(v).replaceAll('"', '""')}"`).join(",");
    lines.push(row);
  }
  return lines.join("\n");
}

function download(filename: string, content: string, mime = "text/plain") {
  const blob = new Blob([content], { type: mime + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function parseCSV(text: string): Record<string, string>[] {
  // Very small, RFC-unfussy CSV parser (handles quotes & commas)
  const rows: string[][] = [];
  let i = 0, field = "", inQuotes = false, row: string[] = [];
  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { rows.push(row); row = []; };
  while (i < text.length) {
    const c = text[i++];
    if (inQuotes) {
      if (c === '"') {
        if (text[i] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') pushField();
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i] === '\n') i++; // handle CRLF
        pushField();
        if (row.length > 1 || rows.length === 0) pushRow();
      } else field += c;
    }
  }
  // last field/row
  if (field.length || row.length) { pushField(); pushRow(); }

  if (!rows.length) return [];
  const header = rows[0].map(h => h.trim().toLowerCase());
  const out: Record<string, string>[] = [];
  for (let r = 1; r < rows.length; r++) {
    const obj: Record<string, string> = {};
    header.forEach((h, idx) => obj[h] = rows[r][idx] ?? "");
    // skip empty lines (no name)
    if (Object.values(obj).join("").trim().length) out.push(obj);
  }
  return out;
}

function normalizeCategory(c: string, categories: string[]) {
  if (!c) return "Other";
  const t = c.trim().toLowerCase();
  const found = categories.find(cat => cat.toLowerCase() === t);
  return found ?? c.trim();
}

function printPage() {
  window.print();
}

// ---------- Components ----------
function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium">
      {children}
    </span>
  );
}

function SectionTitle({ icon: Icon, title, right }:{ icon: any; title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <Icon className="h-5 w-5" />
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      {right}
    </div>
  );
}

function CategoryHeader({ name, count }:{ name: string; count: number }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <h3 className="text-base font-semibold">{name}</h3>
      <Pill>{count}</Pill>
    </div>
  );
}

export default function ShoppingListApp() {
  const [items, setItems] = useState<Item[]>(() => loadFromLS<Item[]>(LS_ITEMS_KEY, []));
  const [categories, setCategories] = useState<string[]>(() => loadFromLS<string[]>(LS_CATS_KEY, DEFAULT_CATEGORIES));
  const [query, setQuery] = useState("");
  const [showOnlyNeeded, setShowOnlyNeeded] = useState(false); // hide items you already have
  const [showOnlyUnchecked, setShowOnlyUnchecked] = useState(false); // hide items already in cart
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => saveToLS(LS_ITEMS_KEY, items), [items]);
  useEffect(() => saveToLS(LS_CATS_KEY, categories), [categories]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(it => {
      if (showOnlyNeeded && it.have) return false;
      if (showOnlyUnchecked && it.checked) return false;
      if (!q) return true;
      return (
        it.name?.toLowerCase().includes(q) ||
        it.category?.toLowerCase().includes(q) ||
        it.notes?.toLowerCase().includes(q) ||
        it.unit?.toLowerCase().includes(q)
      );
    });
  }, [items, query, showOnlyNeeded, showOnlyUnchecked]);

  const byCategory = useMemo(() => {
    const map: Record<string, Item[]> = {};
    const catOrder = new Map(categories.map((c, i) => [c, i] as const));
    for (const it of filtered) {
      const cat = it.category || "Other";
      (map[cat] ||= []).push(it);
    }
    // sort each category's items: unchecked first, then by name
    Object.values(map).forEach(list => list.sort((a,b) => Number(a.checked) - Number(b.checked) || (a.name||"").localeCompare(b.name||"")));
    // return entries sorted by category order, unknowns at end
    return Object.entries(map).sort((a, b) => (catOrder.get(a[0]) ?? 999) - (catOrder.get(b[0]) ?? 999));
  }, [filtered, categories]);

  function addItem(partial: Partial<Item>) {
    const it: Item = {
      id: uid(),
      name: (partial.name || "").trim(),
      quantity: partial.quantity?.trim() || "",
      unit: partial.unit?.trim() || "",
      category: partial.category || "Other",
      notes: partial.notes?.trim() || "",
      have: !!partial.have,
      checked: !!partial.checked,
      createdAt: Date.now(),
    };
    if (!it.name) return;
    setItems(prev => [it, ...prev]);
  }

  function updateItem(id: string, patch: Partial<Item>) {
    setItems(prev => prev.map(it => it.id === id ? { ...it, ...patch } : it));
  }

  function removeItem(id: string) {
    setItems(prev => prev.filter(it => it.id !== id));
  }

  function clearChecked() {
    setItems(prev => prev.filter(it => !it.checked));
  }

  function importCSV(text: string) {
    const rows = parseCSV(text);
    const mapped = rows.map(r => {
      const name = r["item"] || r["name"] || r["product"] || r["ingredient"] || "";
      const quantity = r["qty"] || r["quantity"] || r["amount"] || "";
      const unit = r["unit"] || r["units"] || "";
      const categoryRaw = r["category"] || r["section"] || r["aisle"] || r["dept"] || "";
      const notes = r["notes"] || r["note"] || r["details"] || "";
      const have = /true|yes|y|1/i.test(r["have"] || "");
      const checked = /true|yes|y|1/i.test(r["checked"] || "");
      return {
        id: uid(),
        name: name.trim(),
        quantity: (quantity || "").trim(),
        unit: (unit || "").trim(),
        category: normalizeCategory(categoryRaw, categories),
        notes: (notes || "").trim(),
        have,
        checked,
        createdAt: Date.now(),
      } as Item;
    }).filter(x => x.name);
    if (mapped.length) setItems(prev => [...mapped, ...prev]);
  }

  function exportCSV() {
    download("shopping-list.csv", toCSV(items), "text/csv");
  }

  function exportJSON() {
    download("shopping-list.json", JSON.stringify({ items, categories }, null, 2), "application/json");
  }

  function handlePaste(text: string) {
    // Basic line-by-line import: "2 lb chicken breast | Meat & Seafood"
    const rows = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const parsed: Item[] = [];
    for (const line of rows) {
      const [left, right] = line.split("|");
      const [qtyName, unitMaybe, nameMaybe] = left.split(/\s+/);
      // heuristics: allow formats like "2 lb carrots" or just "carrots"
      let name = line;
      let quantity = "";
      let unit = "";
      let category = right?.trim() || "Other";
      const m = left.match(/^\s*(\d+[\d\/\.]*)\s+([a-zA-Z]+)\s+(.+)$/);
      if (m) {
        quantity = m[1];
        unit = m[2];
        name = m[3];
      } else {
        name = left.trim();
      }
      parsed.push({ id: uid(), name, quantity, unit, category, createdAt: Date.now(), checked: false, have: false });
    }
    if (parsed.length) setItems(prev => [...parsed, ...prev]);
  }

  function consolidateDuplicates() {
    const key = (it: Item) => `${(it.name||"").toLowerCase()}|${(it.category||"").toLowerCase()}`;
    const map = new Map<string, Item>();
    for (const it of items) {
      const k = key(it);
      if (!map.has(k)) map.set(k, { ...it });
      else {
        const cur = map.get(k)!;
        // naive: if quantities match units, append with +
        if (cur.quantity && it.quantity && cur.unit === it.unit) {
          const a = parseFloat(String(cur.quantity));
          const b = parseFloat(String(it.quantity));
          if (!isNaN(a) && !isNaN(b)) cur.quantity = String(a + b);
          else cur.notes = [cur.notes, it.quantity].filter(Boolean).join("; ");
        } else {
          cur.notes = [cur.notes, it.quantity && it.unit ? `${it.quantity} ${it.unit}` : it.quantity || "", it.notes]
            .filter(Boolean).join("; ");
        }
        cur.have = cur.have && it.have; // only mark have if both had it
        cur.checked = cur.checked && it.checked;
      }
    }
    setItems(Array.from(map.values()));
  }

  // ---------- UI ----------
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="sticky top-0 z-20 backdrop-blur bg-white/70 border-b">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <PackageOpen className="h-6 w-6" />
          <h1 className="text-xl font-bold">Weekly Shopping List</h1>
          <div className="ml-auto flex items-center gap-2">
            <button className="btn" onClick={printPage} title="Print or Save to PDF">
              <Printer className="h-4 w-4" />
              <span className="hidden sm:inline">Print</span>
            </button>
            <button className="btn" onClick={exportCSV} title="Export CSV">
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">CSV</span>
            </button>
            <button className="btn" onClick={exportJSON} title="Export JSON">
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">JSON</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* Quick Add */}
        <section className="mb-6">
          <SectionTitle icon={Plus} title="Add Item" />
          <QuickAdd categories={categories} onAdd={addItem} />
        </section>

        {/* Controls */}
        <section className="mb-6">
          <SectionTitle icon={ListFilter} title="Filters & Tools" right={<div className="flex gap-2">
            <label className="ctrl"><input type="checkbox" checked={showOnlyNeeded} onChange={e=>setShowOnlyNeeded(e.target.checked)} />Hide items I already have</label>
            <label className="ctrl"><input type="checkbox" checked={showOnlyUnchecked} onChange={e=>setShowOnlyUnchecked(e.target.checked)} />Hide checked items</label>
            <button className="btn" onClick={consolidateDuplicates} title="Merge duplicate items by name & category">
              <RefreshCcw className="h-4 w-4" />
              Consolidate
            </button>
            <button className="btn btn-danger" onClick={clearChecked} title="Remove items that are checked">
              <Trash2 className="h-4 w-4" />
              Clear checked
            </button>
          </div>} />

          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2" />
              <input className="input pl-9" placeholder="Search name, note, category…" value={query} onChange={e=>setQuery(e.target.value)} />
            </div>
            <ImportControls onImportCSV={importCSV} onImportPaste={handlePaste} />
          </div>
        </section>

        {/* Categories Manager */}
        <section className="mb-8">
          <SectionTitle icon={Pencil} title="Categories" />
          <CategoriesEditor categories={categories} setCategories={setCategories} />
        </section>

        {/* List by Category */}
        <section className="print:break-before-page">
          {byCategory.length === 0 ? (
            <div className="text-center text-sm text-neutral-600 py-12">No items yet. Add manually above or import from your meal plan CSV.</div>
          ) : (
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
              {byCategory.map(([cat, list]) => (
                <div key={cat} className="card">
                  <CategoryHeader name={cat} count={list.length} />
                  <ul className="space-y-2">
                    {list.map(it => (
                      <li key={it.id} className={`item ${it.checked ? "opacity-70" : ""}`}>
                        <div className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            checked={!!it.checked}
                            onChange={e => updateItem(it.id, { checked: e.target.checked })}
                            className="mt-1"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium truncate">{it.name}</span>
                              {it.have && <Pill>Have</Pill>}
                            </div>
                            <div className="text-xs text-neutral-600">
                              {[it.quantity, it.unit].filter(Boolean).join(" ")}{it.quantity||it.unit ? " · " : ""}{it.notes}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <button className="icon" title="Toggle Have" onClick={()=>updateItem(it.id, { have: !it.have })}><Check className={`h-4 w-4 ${it.have?"text-green-600":""}`} /></button>
                            <EditPopover item={it} categories={categories} onSave={(patch)=>updateItem(it.id, patch)} onDelete={()=>removeItem(it.id)} />
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        <footer className="text-center text-xs text-neutral-500 mt-12 pb-10">
          Pro tip: Use Export → CSV to move lists between weeks. Use Print to make an in-store paper copy.
        </footer>
      </main>

      {/* Styles */}
      <style>{`
        .btn { @apply inline-flex items-center gap-2 rounded-2xl border px-3 py-1.5 text-sm shadow-sm bg-white hover:bg-neutral-50; }
        .btn-danger { @apply border-red-300 hover:bg-red-50; }
        .input { @apply w-full rounded-xl border px-3 py-2 shadow-sm; }
        .ctrl { @apply inline-flex items-center gap-2 text-sm; }
        .card { @apply rounded-2xl border bg-white p-4 shadow-sm; }
        .item { @apply rounded-xl border bg-white px-3 py-2; }
        .label { @apply text-xs font-medium text-neutral-600; }
        .field { @apply w-full rounded-lg border px-3 py-2; }
        .icon { @apply p-1 rounded-lg hover:bg-neutral-100; }
        @media print { 
          header, .btn, .ctrl, .input { display: none !important; }
          .card { break-inside: avoid; }
        }
      `}</style>
    </div>
  );
}

function QuickAdd({ categories, onAdd }:{ categories: string[]; onAdd: (partial: Partial<Item>)=>void }) {
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [category, setCategory] = useState(categories[0] || "Other");
  const [notes, setNotes] = useState("");

  useEffect(()=>{ if (!categories.includes(category)) setCategory(categories[0] || "Other"); }, [categories]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onAdd({ name, quantity, unit, category, notes });
    setName(""); setQuantity(""); setUnit(""); setNotes("");
  }

  return (
    <form onSubmit={submit} className="card">
      <div className="grid md:grid-cols-5 gap-3">
        <div className="md:col-span-2">
          <div className="label">Item</div>
          <input className="field" value={name} onChange={e=>setName(e.target.value)} placeholder="e.g., bananas" required />
        </div>
        <div>
          <div className="label">Qty</div>
          <input className="field" value={quantity} onChange={e=>setQuantity(e.target.value)} placeholder="e.g., 6 or 2" />
        </div>
        <div>
          <div className="label">Unit</div>
          <input className="field" value={unit} onChange={e=>setUnit(e.target.value)} placeholder="e.g., lb, oz, ct" />
        </div>
        <div>
          <div className="label">Category</div>
          <select className="field" value={category} onChange={e=>setCategory(e.target.value)}>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div className="grid md:grid-cols-[1fr_auto] gap-3 mt-3">
        <div>
          <div className="label">Notes (optional)</div>
          <input className="field" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="brand, ripeness, substitutions…" />
        </div>
        <div className="flex items-end justify-end">
          <button type="submit" className="btn"><Plus className="h-4 w-4"/>Add</button>
        </div>
      </div>
    </form>
  );
}

function ImportControls({ onImportCSV, onImportPaste }:{ onImportCSV: (text:string)=>void; onImportPaste: (text:string)=>void }) {
  const fileRef = useRef<HTMLInputElement | null>(null);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => onImportCSV(String(reader.result||""));
    reader.readAsText(f);
    e.target.value = ""; // reset
  }

  function pasteFromClipboard() {
    navigator.clipboard.readText().then(t => { if (t) onImportPaste(t); });
  }

  return (
    <div className="card flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4">
      <div className="flex items-center gap-2">
        <Upload className="h-4 w-4" />
        <div className="font-medium">Import</div>
      </div>
      <div className="flex gap-2">
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
        <button className="btn" onClick={()=>fileRef.current?.click()}>CSV file</button>
        <button className="btn" onClick={pasteFromClipboard} title="Paste plain text or lines like: 2 lb chicken breast | Meat & Seafood">Paste</button>
      </div>
      <div className="text-xs text-neutral-600">
        CSV Columns supported: <code>name</code>/<code>item</code>, <code>quantity</code>/<code>qty</code>, <code>unit</code>, <code>category</code>, <code>notes</code>, <code>have</code>, <code>checked</code>
      </div>
    </div>
  );
}

function CategoriesEditor({ categories, setCategories }:{ categories: string[]; setCategories: (cats: string[])=>void }) {
  const [newCat, setNewCat] = useState("");

  function addCat(e: React.FormEvent) {
    e.preventDefault();
    const c = newCat.trim();
    if (!c) return;
    if (!categories.includes(c)) setCategories([...categories, c]);
    setNewCat("");
  }

  function rename(idx: number, val: string) {
    const next = [...categories];
    next[idx] = val;
    setCategories(next);
  }

  function remove(idx: number) {
    const name = categories[idx];
    const next = categories.filter((_, i) => i !== idx);
    setCategories(next);
  }

  function move(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= categories.length) return;
    const next = [...categories];
    const [c] = next.splice(idx, 1);
    next.splice(j, 0, c);
    setCategories(next);
  }

  return (
    <div className="card">
      <form onSubmit={addCat} className="flex gap-2 mb-3">
        <input className="input" placeholder="Add new category (e.g., Baby, Pet, Pharmacy)" value={newCat} onChange={e=>setNewCat(e.target.value)} />
        <button className="btn" type="submit"><Plus className="h-4 w-4"/>Add</button>
      </form>

      <ul className="space-y-2">
        {categories.map((c, idx) => (
          <li key={c} className="item flex items-center gap-2">
            <span className="text-xs text-neutral-500 w-6">{idx+1}.</span>
            <input className="flex-1 field" value={c} onChange={e=>rename(idx, e.target.value)} />
            <div className="flex gap-1">
              <button className="icon" title="Move up" onClick={()=>move(idx,-1)}>↑</button>
              <button className="icon" title="Move down" onClick={()=>move(idx,1)}>↓</button>
              <button className="icon" title="Remove" onClick={()=>remove(idx)}><Trash2 className="h-4 w-4"/></button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EditPopover({ item, categories, onSave, onDelete }:{ item: Item; categories: string[]; onSave: (patch: Partial<Item>)=>void; onDelete: ()=>void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Item>({ ...item });
  const ref = useRef<HTMLDivElement|null>(null);

  useEffect(()=>{ setForm({ ...item }); }, [item.id]);

  useEffect(()=>{
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as any)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onDoc);
    return ()=> document.removeEventListener('mousedown', onDoc);
  }, [open]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      name: form.name,
      quantity: form.quantity,
      unit: form.unit,
      category: form.category,
      notes: form.notes,
    });
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button className="icon" title="Edit" onClick={()=>setOpen(v=>!v)}><Pencil className="h-4 w-4"/></button>
      {open && (
        <form onSubmit={submit} className="absolute right-0 mt-2 w-80 card z-10">
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <div className="label">Item</div>
              <input className="field" value={form.name||""} onChange={e=>setForm({...form, name: e.target.value})} />
            </div>
            <div>
              <div className="label">Qty</div>
              <input className="field" value={form.quantity||""} onChange={e=>setForm({...form, quantity: e.target.value})} />
            </div>
            <div>
              <div className="label">Unit</div>
              <input className="field" value={form.unit||""} onChange={e=>setForm({...form, unit: e.target.value})} />
            </div>
            <div className="col-span-2">
              <div className="label">Category</div>
              <select className="field" value={form.category||"Other"} onChange={e=>setForm({...form, category: e.target.value})}>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <div className="label">Notes</div>
              <input className="field" value={form.notes||""} onChange={e=>setForm({...form, notes: e.target.value})} />
            </div>
          </div>
          <div className="flex justify-between items-center mt-3">
            <button type="button" className="btn btn-danger" onClick={()=>{ onDelete(); setOpen(false); }}><Trash2 className="h-4 w-4"/>Delete</button>
            <div className="flex gap-2">
              <button type="button" className="btn" onClick={()=>setOpen(false)}>Cancel</button>
              <button type="submit" className="btn"><Check className="h-4 w-4"/>Save</button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
