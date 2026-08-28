"use client";

import React, { useState, useMemo, useEffect } from "react";
import {
  Plus,
  Minus,
  Package,
  ClipboardList,
  Coffee,
  Snowflake,
  CupSoda,
  Check,
  X,
  ArrowUpDown,
  PencilLine,
  Table2,
  BookOpen,
  Lock,
  Upload,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import type {
  CategoryId,
  Status,
  Tier,
  Mode,
  Page,
  InventoryItem,
  Ingredient,
  MenuItem,
  ShopProfile,
  ShopSummary,
  SaleLine,
} from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import {
  fetchItems,
  fetchMenuItems,
  insertItem,
  updateItemCount,
  updateItemCounts,
  insertMenuItem,
  deleteMenuItemRow,
  insertIngredient,
  updateIngredient,
  deleteIngredientRow,
  fetchAllShops,
} from "@/lib/shop-data";

// ---- Categories (display metadata only — data shape lives in lib/types) ---

interface Category {
  id: CategoryId;
  label: string;
  icon: LucideIcon;
  note: string;
}

const CATEGORIES: Category[] = [
  { id: "perishable", label: "Perishables", icon: Snowflake, note: "Milk, cream, pastries — watch freshness, not just count" },
  { id: "dry", label: "Dry Goods & Syrups", icon: Coffee, note: "Beans, syrups, sugar — steady, predictable burn rate" },
  { id: "disposable", label: "Disposables", icon: CupSoda, note: "Cups, lids, straws — boring until you're out mid-rush" },
];

// ---- Status logic ---------------------------------------------------------

function getStatus(item: Pick<InventoryItem, "count" | "threshold">): Status {
  if (item.count <= item.threshold * 0.5) return "critical";
  if (item.count <= item.threshold) return "low";
  return "good";
}

const STATUS_META: Record<Status, { label: string; stamp: string; color: string }> = {
  good: { label: "Stocked", stamp: "STOCKED", color: "#7A8F5E" },
  low: { label: "Reorder Soon", stamp: "REORDER", color: "#C79A3E" },
  critical: { label: "Critical", stamp: "CRITICAL", color: "#B0492F" },
};

// ---- Stamp badge (signature element) --------------------------------------

function StatusStamp({ status }: { status: Status }) {
  const meta = STATUS_META[status];
  return (
    <div
      className="shrink-0 flex items-center justify-center rounded-full border-2 font-mono uppercase tracking-wider select-none"
      style={{
        width: 64,
        height: 64,
        borderColor: meta.color,
        color: meta.color,
        transform: "rotate(-8deg)",
        fontSize: 9,
        letterSpacing: "0.04em",
        borderStyle: "double",
        borderWidth: 3,
      }}
    >
      <span className="text-center leading-tight px-1">{meta.stamp}</span>
    </div>
  );
}

// ---- Item row ---------------------------------------------------------

interface ItemRowProps {
  item: InventoryItem;
  mode: Mode;
  onAdjust: (id: number, delta: number) => void;
  onBatchChange: (id: number, value: number) => void;
  batchValue: number;
}

function ItemRow({ item, mode, onAdjust, onBatchChange, batchValue }: ItemRowProps) {
  const status = getStatus(mode === "batch" ? { ...item, count: batchValue } : item);
  const meta = STATUS_META[status];

  return (
    <div
      className="flex items-center gap-4 py-4 border-b"
      style={{ borderColor: "#3A2F27" }}
    >
      <StatusStamp status={status} />

      <div className="flex-1 min-w-0">
        <div className="font-semibold" style={{ color: "#EDE3D3", fontFamily: "'Barlow Condensed', sans-serif", fontSize: 19, letterSpacing: "0.01em" }}>
          {item.name.toUpperCase()}
        </div>
        <div className="font-mono text-xs mt-0.5" style={{ color: "#9C8C79" }}>
          threshold {item.threshold} {item.unit} · {meta.label.toLowerCase()}
          {item.unitSize ? ` · 1 ${item.unit.replace(/s$/, "")} = ${item.unitSize} ${item.unitMeasure}` : ""}
        </div>
      </div>

      {mode === "quick" ? (
        <div className="flex items-center gap-3">
          <button
            onClick={() => onAdjust(item.id, -1)}
            className="w-9 h-9 rounded-full flex items-center justify-center border transition-colors hover:brightness-125"
            style={{ borderColor: "#5A4A3C", color: "#EDE3D3" }}
            aria-label={`Decrease ${item.name}`}
          >
            <Minus size={16} />
          </button>
          <div className="font-mono text-lg w-14 text-center" style={{ color: "#EDE3D3" }}>
            {item.count}
          </div>
          <button
            onClick={() => onAdjust(item.id, 1)}
            className="w-9 h-9 rounded-full flex items-center justify-center border transition-colors hover:brightness-125"
            style={{ borderColor: "#5A4A3C", color: "#EDE3D3" }}
            aria-label={`Increase ${item.name}`}
          >
            <Plus size={16} />
          </button>
        </div>
      ) : (
        <input
          type="number"
          min={0}
          value={batchValue}
          onChange={(e) => onBatchChange(item.id, e.target.value === "" ? 0 : parseInt(e.target.value, 10))}
          className="w-20 font-mono text-lg text-center rounded-md border py-1.5 bg-transparent focus:outline-none focus:ring-2"
          style={{ borderColor: "#5A4A3C", color: "#EDE3D3" }}
        />
      )}
    </div>
  );
}

// ---- Add item form ---------------------------------------------------------

interface AddItemFormProps {
  onAdd: (item: Omit<InventoryItem, "id">) => void;
  onCancel: () => void;
}

function AddItemForm({ onAdd, onCancel }: AddItemFormProps) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [threshold, setThreshold] = useState(3);
  const [count, setCount] = useState(0);
  const [category, setCategory] = useState<CategoryId>("dry");
  const [unitSize, setUnitSize] = useState("");
  const [unitMeasure, setUnitMeasure] = useState("");

  return (
    <div className="rounded-lg border p-5 mb-6" style={{ borderColor: "#5A4A3C", backgroundColor: "#241C17" }}>
      <div className="font-mono text-xs uppercase tracking-widest mb-4" style={{ color: "#C1663B" }}>
        New Stock Item
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <input
          placeholder="Item name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="col-span-2 rounded-md border px-3 py-2 bg-transparent focus:outline-none"
          style={{ borderColor: "#5A4A3C", color: "#EDE3D3" }}
        />
        <input
          placeholder="Stocking unit (e.g. carton, bag)"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          className="rounded-md border px-3 py-2 bg-transparent focus:outline-none"
          style={{ borderColor: "#5A4A3C", color: "#EDE3D3" }}
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as CategoryId)}
          className="rounded-md border px-3 py-2 bg-transparent focus:outline-none"
          style={{ borderColor: "#5A4A3C", color: "#EDE3D3" }}
        >
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id} style={{ color: "#000" }}>
              {c.label}
            </option>
          ))}
        </select>
        <label className="flex flex-col gap-1 text-xs font-mono" style={{ color: "#9C8C79" }}>
          Starting count
          <input
            type="number"
            value={count}
            onChange={(e) => setCount(parseInt(e.target.value, 10) || 0)}
            className="rounded-md border px-3 py-2 bg-transparent focus:outline-none"
            style={{ borderColor: "#5A4A3C", color: "#EDE3D3" }}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-mono" style={{ color: "#9C8C79" }}>
          Reorder threshold
          <input
            type="number"
            value={threshold}
            onChange={(e) => setThreshold(parseInt(e.target.value, 10) || 0)}
            className="rounded-md border px-3 py-2 bg-transparent focus:outline-none"
            style={{ borderColor: "#5A4A3C", color: "#EDE3D3" }}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-mono" style={{ color: "#9C8C79" }}>
          Amount per unit
          <input
            type="number"
            step="0.1"
            placeholder="e.g. 32"
            value={unitSize}
            onChange={(e) => setUnitSize(e.target.value)}
            className="rounded-md border px-3 py-2 bg-transparent focus:outline-none"
            style={{ borderColor: "#5A4A3C", color: "#EDE3D3" }}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-mono" style={{ color: "#9C8C79" }}>
          Measure (oz, pumps, cups…)
          <input
            placeholder="e.g. oz"
            value={unitMeasure}
            onChange={(e) => setUnitMeasure(e.target.value)}
            className="rounded-md border px-3 py-2 bg-transparent focus:outline-none"
            style={{ borderColor: "#5A4A3C", color: "#EDE3D3" }}
          />
        </label>
      </div>
      <p className="text-[10px] font-mono mb-3" style={{ color: "#6E6153" }}>
        &quot;Amount per unit&quot; + &quot;Measure&quot; are optional, but required if you want this item usable in a Recipe (Pro).
        E.g. a carton of oat milk might be 32 oz, so 1 carton = 32 oz.
      </p>
      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-md text-sm font-mono flex items-center gap-1.5 border"
          style={{ borderColor: "#5A4A3C", color: "#9C8C79" }}
        >
          <X size={14} /> Cancel
        </button>
        <button
          onClick={() => {
            if (!name.trim()) return;
            onAdd({
              name: name.trim(),
              unit: unit.trim() || "units",
              count,
              threshold,
              category,
              unitSize: unitSize === "" ? null : parseFloat(unitSize),
              unitMeasure: unitMeasure.trim() || null,
            });
          }}
          className="px-4 py-2 rounded-md text-sm font-mono flex items-center gap-1.5 font-semibold"
          style={{ backgroundColor: "#C1663B", color: "#1B1512" }}
        >
          <Check size={14} /> Add Item
        </button>
      </div>
    </div>
  );
}

// ---- Spreadsheet view ---------------------------------------------------------

const CATEGORY_LABEL: Record<CategoryId, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c.label])
) as Record<CategoryId, string>;

type SortKey = "name" | "category" | "count" | "unit" | "threshold" | "status";

interface SpreadsheetViewProps {
  items: InventoryItem[];
  onEdit: (id: number) => void;
}

function SpreadsheetView({ items, onEdit }: SpreadsheetViewProps) {
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState(1);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => -d);
    } else {
      setSortKey(key);
      setSortDir(1);
    }
  }

  const sorted = useMemo(() => {
    const withStatus = items.map((i) => ({ ...i, status: getStatus(i) }));
    const statusOrder: Record<Status, number> = { critical: 0, low: 1, good: 2 };
    return [...withStatus].sort((a, b) => {
      let av: string | number = a[sortKey as keyof InventoryItem] as string | number;
      let bv: string | number = b[sortKey as keyof InventoryItem] as string | number;
      if (sortKey === "status") {
        av = statusOrder[a.status];
        bv = statusOrder[b.status];
      }
      if (sortKey === "category") {
        av = CATEGORY_LABEL[a.category];
        bv = CATEGORY_LABEL[b.category];
      }
      if (typeof av === "string" && typeof bv === "string") {
        return av.localeCompare(bv) * sortDir;
      }
      return ((av as number) - (bv as number)) * sortDir;
    });
  }, [items, sortKey, sortDir]);

  const columns: { key: SortKey; label: string }[] = [
    { key: "name", label: "Item" },
    { key: "category", label: "Category" },
    { key: "count", label: "Count" },
    { key: "unit", label: "Unit" },
    { key: "threshold", label: "Threshold" },
    { key: "status", label: "Status" },
  ];

  return (
    <div className="rounded-lg border overflow-hidden" style={{ borderColor: "#3A2F27" }}>
      <table className="w-full border-collapse font-mono text-sm">
        <thead>
          <tr style={{ backgroundColor: "#241C17" }}>
            {columns.map((col) => (
              <th
                key={col.key}
                onClick={() => toggleSort(col.key)}
                className="text-left px-3 py-2.5 cursor-pointer select-none whitespace-nowrap"
                style={{ color: "#9C8C79", borderBottom: "1px solid #3A2F27" }}
              >
                <span className="inline-flex items-center gap-1 uppercase text-[11px] tracking-widest">
                  {col.label}
                  <ArrowUpDown size={11} style={{ opacity: sortKey === col.key ? 1 : 0.35 }} />
                </span>
              </th>
            ))}
            <th style={{ borderBottom: "1px solid #3A2F27" }}></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((item, idx) => {
            const meta = STATUS_META[item.status];
            return (
              <tr
                key={item.id}
                style={{
                  backgroundColor: idx % 2 === 0 ? "transparent" : "#211A15",
                  borderBottom: "1px solid #2A2119",
                }}
              >
                <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: "#EDE3D3" }}>
                  {item.name}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: "#9C8C79" }}>
                  {CATEGORY_LABEL[item.category]}
                </td>
                <td className="px-3 py-2.5" style={{ color: "#EDE3D3" }}>
                  {item.count}
                </td>
                <td className="px-3 py-2.5" style={{ color: "#9C8C79" }}>
                  {item.unit}
                </td>
                <td className="px-3 py-2.5" style={{ color: "#9C8C79" }}>
                  {item.threshold}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="inline-block rounded-full"
                      style={{ width: 7, height: 7, backgroundColor: meta.color }}
                    />
                    <span style={{ color: meta.color }}>{meta.label}</span>
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <button
                    onClick={() => onEdit(item.id)}
                    className="text-xs px-2 py-1 rounded border"
                    style={{ borderColor: "#3A2F27", color: "#9C8C79" }}
                  >
                    Edit
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---- Recipes (Pro tier) ---------------------------------------------------------

function servingsRemaining(menuItem: MenuItem, items: InventoryItem[]): number | null {
  let min = Infinity;
  for (const ing of menuItem.ingredients) {
    const item = items.find((i) => i.id === ing.itemId);
    if (!item || !item.unitSize || !ing.amount) continue;
    const onHandInMeasure = item.count * item.unitSize;
    const possible = Math.floor(onHandInMeasure / ing.amount);
    if (possible < min) min = possible;
  }
  return min === Infinity ? null : min;
}

interface IngredientRowProps {
  ingredient: Ingredient;
  items: InventoryItem[];
  onChangeAmount: (amount: number) => void;
  onChangeItem: (itemId: number) => void;
  onRemove: () => void;
}

function IngredientRow({ ingredient, items, onChangeAmount, onChangeItem, onRemove }: IngredientRowProps) {
  const item = items.find((i) => i.id === ingredient.itemId);
  return (
    <div className="flex items-center gap-2 py-1.5">
      <select
        value={ingredient.itemId}
        onChange={(e) => onChangeItem(parseInt(e.target.value, 10))}
        className="flex-1 min-w-0 rounded-md border px-2 py-1.5 text-sm bg-transparent focus:outline-none"
        style={{ borderColor: "#5A4A3C", color: "#EDE3D3" }}
      >
        {items.filter((i) => i.unitSize).map((i) => (
          <option key={i.id} value={i.id} style={{ color: "#000" }}>
            {i.name}
          </option>
        ))}
      </select>
      <input
        type="number"
        step="0.1"
        value={ingredient.amount}
        onChange={(e) => onChangeAmount(parseFloat(e.target.value) || 0)}
        className="w-16 rounded-md border px-2 py-1.5 text-sm text-center font-mono bg-transparent focus:outline-none"
        style={{ borderColor: "#5A4A3C", color: "#EDE3D3" }}
      />
      <span className="text-xs font-mono w-14 shrink-0" style={{ color: "#9C8C79" }}>
        {item ? item.unitMeasure : ""}
      </span>
      <button onClick={onRemove} style={{ color: "#B0492F" }}>
        <Trash2 size={14} />
      </button>
    </div>
  );
}

interface MenuItemCardProps {
  menuItem: MenuItem;
  items: InventoryItem[];
  onAddIngredient: (itemId: number) => void;
  onChangeIngredientAmount: (ingredientId: number, amount: number) => void;
  onChangeIngredientItem: (ingredientId: number, itemId: number) => void;
  onRemoveIngredient: (ingredientId: number) => void;
  onDelete: () => void;
}

function MenuItemCard({
  menuItem,
  items,
  onAddIngredient,
  onChangeIngredientAmount,
  onChangeIngredientItem,
  onRemoveIngredient,
  onDelete,
}: MenuItemCardProps) {
  const remaining = servingsRemaining(menuItem, items);
  const hasUnmapped = menuItem.ingredients.some((ing) => !items.find((i) => i.id === ing.itemId));
  const linkableItems = items.filter((i) => i.unitSize);

  function addIngredient() {
    if (linkableItems.length === 0) return;
    onAddIngredient(linkableItems[0].id);
  }

  return (
    <div className="rounded-lg border p-4 mb-4" style={{ borderColor: "#3A2F27" }}>
      <div className="flex items-center justify-between mb-2">
        <div
          className="font-semibold"
          style={{ color: "#EDE3D3", fontFamily: "'Barlow Condensed', sans-serif", fontSize: 18 }}
        >
          {menuItem.name.toUpperCase()}
        </div>
        <div className="flex items-center gap-3">
          {remaining !== null && (
            <span
              className="font-mono text-xs"
              style={{ color: remaining <= 10 ? "#B0492F" : remaining <= 25 ? "#C79A3E" : "#7A8F5E" }}
            >
              ~{remaining} left to sell
            </span>
          )}
          <button onClick={onDelete} style={{ color: "#6E6153" }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {menuItem.ingredients.map((ing) => (
        <IngredientRow
          key={ing.id}
          ingredient={ing}
          items={items}
          onChangeAmount={(v) => onChangeIngredientAmount(ing.id, v)}
          onChangeItem={(v) => onChangeIngredientItem(ing.id, v)}
          onRemove={() => onRemoveIngredient(ing.id)}
        />
      ))}

      <button
        onClick={addIngredient}
        disabled={linkableItems.length === 0}
        className="mt-2 text-xs font-mono flex items-center gap-1.5 disabled:opacity-40"
        style={{ color: "#C1663B" }}
      >
        <Plus size={12} /> Add ingredient
      </button>

      {hasUnmapped && (
        <p className="text-[10px] font-mono mt-2" style={{ color: "#B0492F" }}>
          Some ingredients reference an item that no longer has a unit size set.
        </p>
      )}
    </div>
  );
}

interface AddMenuItemFormProps {
  items: InventoryItem[];
  onAdd: (name: string, firstIngredient: { itemId: number; amount: number }) => void;
}

function AddMenuItemForm({ items, onAdd }: AddMenuItemFormProps) {
  const [name, setName] = useState("");
  const linkableItems = items.filter((i) => i.unitSize);

  return (
    <div className="flex gap-2 mb-6">
      <input
        placeholder="New menu item, e.g. Vanilla Latte"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="flex-1 rounded-md border px-3 py-2 bg-transparent focus:outline-none"
        style={{ borderColor: "#5A4A3C", color: "#EDE3D3" }}
      />
      <button
        onClick={() => {
          if (!name.trim() || linkableItems.length === 0) return;
          onAdd(name.trim(), { itemId: linkableItems[0].id, amount: 1 });
          setName("");
        }}
        disabled={linkableItems.length === 0}
        className="px-4 py-2 rounded-md text-sm font-mono font-semibold flex items-center gap-1.5 disabled:opacity-40"
        style={{ backgroundColor: "#C1663B", color: "#1B1512" }}
      >
        <Plus size={14} /> Add
      </button>
    </div>
  );
}

interface EndOfShiftImportProps {
  menuItems: MenuItem[];
  onApply: (sales: SaleLine[]) => void;
}

function EndOfShiftImport({ menuItems, onApply }: EndOfShiftImportProps) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ applied: number; unmatched: string[] } | null>(null);

  function apply() {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const sales: SaleLine[] = [];
    const unmatched: string[] = [];
    for (const line of lines) {
      const [rawName, rawQty] = line.split(",");
      if (!rawName || !rawQty) continue;
      const qty = parseInt(rawQty.trim(), 10);
      if (!qty) continue;
      const match = menuItems.find((m) => m.name.toLowerCase() === rawName.trim().toLowerCase());
      if (match) sales.push({ menuItem: match, qty });
      else unmatched.push(rawName.trim());
    }
    onApply(sales);
    setResult({ applied: sales.length, unmatched });
    setText("");
  }

  return (
    <div className="rounded-lg border p-4" style={{ borderColor: "#3A2F27" }}>
      <div className="font-mono text-xs uppercase tracking-widest mb-2 flex items-center gap-1.5" style={{ color: "#C1663B" }}>
        <Upload size={13} /> End-of-Shift Import
      </div>
      <p className="text-xs mb-3" style={{ color: "#9C8C79" }}>
        Paste sales from your POS export, one line per menu item: <span className="font-mono">Menu Item, Qty Sold</span>
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"Vanilla Latte, 24\nOat Milk Latte, 17"}
        rows={4}
        className="w-full rounded-md border px-3 py-2 text-sm font-mono bg-transparent focus:outline-none mb-3"
        style={{ borderColor: "#5A4A3C", color: "#EDE3D3" }}
      />
      <button
        onClick={apply}
        disabled={!text.trim()}
        className="px-4 py-2 rounded-md text-sm font-mono font-semibold disabled:opacity-40"
        style={{ backgroundColor: "#C1663B", color: "#1B1512" }}
      >
        Apply Sales & Deduct Stock
      </button>
      {result && (
        <div className="mt-3 text-xs font-mono" style={{ color: "#9C8C79" }}>
          <div style={{ color: "#7A8F5E" }}>✓ Deducted stock for {result.applied} menu item line(s).</div>
          {result.unmatched.length > 0 && (
            <div style={{ color: "#C79A3E" }} className="mt-1">
              Didn&apos;t recognize: {result.unmatched.join(", ")} — check spelling matches your menu items exactly.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface RecipesPageProps {
  items: InventoryItem[];
  menuItems: MenuItem[];
  onAddMenuItem: (name: string, firstIngredient: { itemId: number; amount: number }) => void;
  onDeleteMenuItem: (id: number) => void;
  onAddIngredient: (menuItemId: number, itemId: number) => void;
  onChangeIngredientAmount: (ingredientId: number, amount: number) => void;
  onChangeIngredientItem: (ingredientId: number, itemId: number) => void;
  onRemoveIngredient: (ingredientId: number) => void;
  onApplySales: (sales: SaleLine[]) => void;
}

function RecipesPage({
  items,
  menuItems,
  onAddMenuItem,
  onDeleteMenuItem,
  onAddIngredient,
  onChangeIngredientAmount,
  onChangeIngredientItem,
  onRemoveIngredient,
  onApplySales,
}: RecipesPageProps) {
  const linkableCount = items.filter((i) => i.unitSize).length;

  return (
    <div>
      {linkableCount === 0 && (
        <div
          className="rounded-lg border px-4 py-3 mb-6 text-sm"
          style={{ borderColor: "#5A4A3C", backgroundColor: "#241C17", color: "#EDE3D3" }}
        >
          None of your inventory items have an &quot;amount per unit&quot; set yet. Edit an item (or add a new
          one) with something like 32 oz per carton before you can build a recipe.
        </div>
      )}
      <AddMenuItemForm items={items} onAdd={onAddMenuItem} />
      {menuItems.map((mi) => (
        <MenuItemCard
          key={mi.id}
          menuItem={mi}
          items={items}
          onAddIngredient={(itemId) => onAddIngredient(mi.id, itemId)}
          onChangeIngredientAmount={onChangeIngredientAmount}
          onChangeIngredientItem={onChangeIngredientItem}
          onRemoveIngredient={onRemoveIngredient}
          onDelete={() => onDeleteMenuItem(mi.id)}
        />
      ))}
      {menuItems.length > 0 && <EndOfShiftImport menuItems={menuItems} onApply={onApplySales} />}
    </div>
  );
}

// ---- Login / shop select ---------------------------------------------------------

type AuthMode = "sign-in" | "sign-up";

function LoginScreen() {
  const [authMode, setAuthMode] = useState<AuthMode>("sign-in");
  const [shopName, setShopName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setNotice("");

    if (authMode === "sign-up" && !shopName.trim()) {
      setError("Enter a shop name.");
      return;
    }
    if (!email.trim() || !password) {
      setError("Enter an email and password.");
      return;
    }
    if (authMode === "sign-up" && password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setBusy(true);
    const supabase = createClient();
    try {
      if (authMode === "sign-up") {
        // The shop_name here is read by the on_auth_user_created trigger
        // (supabase/002_auth_and_shops_rls.sql) to seed the new shops row.
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { shop_name: shopName.trim() } },
        });
        if (signUpError) {
          setError(signUpError.message);
          return;
        }
        if (!data.session) {
          // Project has email confirmation on — no session until they click
          // the link. The parent's onAuthStateChange listener picks it up
          // automatically once they do and come back.
          setNotice("Check your email to confirm your account, then sign in below.");
          setAuthMode("sign-in");
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) {
          setError(signInError.message);
        }
      }
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  // Public, deliberately shared demo account — anyone hitting this button
  // signs into the same real Demo Shop. No secret here: these credentials
  // are meant to be reachable by any visitor, and the button just saves
  // them from having to type them in. See the chat history around
  // 2026-08-28 for the tradeoffs (shared mutable state across visitors,
  // billing portal reachable from that dashboard) before changing this.
  async function handleTryDemo() {
    setError("");
    setNotice("");
    setBusy(true);
    const supabase = createClient();
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: "owner2@groundworktestshop.com",
        password: "correct-horse-battery-2",
      });
      if (signInError) {
        setError("Couldn't load the demo right now. Try again in a moment.");
      }
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center px-5"
      style={{ backgroundColor: "#1B1512", fontFamily: "'Inter', sans-serif" }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-lg border p-6"
        style={{ borderColor: "#3A2F27", backgroundColor: "#211A15" }}
      >
        <div className="font-mono text-xs uppercase tracking-[0.25em] mb-2" style={{ color: "#C1663B" }}>
          Ground Work
        </div>
        <h1
          style={{
            fontFamily: "'Barlow Condensed', sans-serif",
            color: "#EDE3D3",
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: "0.01em",
          }}
          className="mb-1"
        >
          {authMode === "sign-in" ? "SHOP LOGIN" : "CREATE YOUR SHOP"}
        </h1>
        <p className="text-xs mb-5" style={{ color: "#9C8C79" }}>
          {authMode === "sign-in"
            ? "Sign in with your shop's email and password."
            : "Set up a new shop account with an email and password."}
        </p>

        {authMode === "sign-up" && (
          <>
            <label className="block text-xs font-mono mb-1.5" style={{ color: "#9C8C79" }}>
              Shop name
            </label>
            <input
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              placeholder="e.g. Cedar & Fig Coffee"
              className="w-full rounded-md border px-3 py-2 mb-4 bg-transparent focus:outline-none"
              style={{ borderColor: "#5A4A3C", color: "#EDE3D3" }}
            />
          </>
        )}

        <label className="block text-xs font-mono mb-1.5" style={{ color: "#9C8C79" }}>
          Email
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@shop.com"
          autoComplete="email"
          className="w-full rounded-md border px-3 py-2 mb-4 bg-transparent focus:outline-none"
          style={{ borderColor: "#5A4A3C", color: "#EDE3D3" }}
        />

        <label className="block text-xs font-mono mb-1.5" style={{ color: "#9C8C79" }}>
          Password
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          autoComplete={authMode === "sign-up" ? "new-password" : "current-password"}
          className="w-full rounded-md border px-3 py-2 mb-2 bg-transparent focus:outline-none"
          style={{ borderColor: "#5A4A3C", color: "#EDE3D3" }}
        />

        {error && (
          <div className="text-xs font-mono mt-2" style={{ color: "#B0492F" }}>
            {error}
          </div>
        )}
        {notice && (
          <div className="text-xs font-mono mt-2" style={{ color: "#7A8F5E" }}>
            {notice}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full mt-5 px-4 py-2.5 rounded-md text-sm font-mono font-semibold disabled:opacity-60"
          style={{ backgroundColor: "#C1663B", color: "#1B1512" }}
        >
          {busy ? "Working…" : authMode === "sign-in" ? "Sign In" : "Create Shop Account"}
        </button>

        <button
          type="button"
          onClick={() => {
            setAuthMode((m) => (m === "sign-in" ? "sign-up" : "sign-in"));
            setError("");
            setNotice("");
          }}
          className="w-full mt-3 text-xs font-mono underline underline-offset-2"
          style={{ color: "#9C8C79" }}
        >
          {authMode === "sign-in" ? "New shop? Create an account" : "Already have an account? Sign in"}
        </button>

        <div className="my-4 flex items-center gap-3">
          <div className="h-px flex-1" style={{ backgroundColor: "#3A2F27" }} />
          <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "#6E6153" }}>
            or
          </span>
          <div className="h-px flex-1" style={{ backgroundColor: "#3A2F27" }} />
        </div>

        <button
          type="button"
          onClick={handleTryDemo}
          disabled={busy}
          className="w-full px-4 py-2.5 rounded-md text-sm font-mono font-semibold border disabled:opacity-60"
          style={{ borderColor: "#5A4A3C", color: "#EDE3D3" }}
        >
          {busy ? "Working…" : "Try the demo — no signup needed"}
        </button>
      </form>
    </div>
  );
}

// ---- Shop dashboard ---------------------------------------------------------

interface ShopDashboardProps {
  shop: ShopProfile;
  onLogout: () => void;
}

function ShopDashboard({ shop, onLogout }: ShopDashboardProps) {
  const shopName = shop.name;
  // ShopDashboard only ever renders for a shop with an active paid plan
  // (the outer component gates 'none' out to NoPlanScreen), so `tier` here
  // is always "standard" or "pro". It's read-only — see shop-data.ts.
  const tier = shop.tier;
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [page, setPage] = useState<Page>("update");
  const [mode, setMode] = useState<Mode>("quick");
  const [batchDraft, setBatchDraft] = useState<Record<number, number>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [pendingSaves, setPendingSaves] = useState(0);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError("");
      try {
        const [fetchedItems, fetchedMenuItems] = await Promise.all([
          fetchItems(shop.id),
          fetchMenuItems(shop.id),
        ]);
        if (cancelled) return;
        setItems(fetchedItems);
        setMenuItems(fetchedMenuItems);
        setBatchDraft(Object.fromEntries(fetchedItems.map((i) => [i.id, i.count])));
      } catch {
        if (!cancelled) setLoadError("Couldn't load your shop's data. Try refreshing the page.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shop.id]);

  // Wraps a write so the header can show "Saving…" while it's in flight —
  // a counter rather than a boolean so overlapping writes (e.g. mashing
  // Quick Log +/-) don't have one call's finally flip it back to idle
  // while another is still out.
  async function withSaving<T>(fn: () => Promise<T>): Promise<T> {
    setPendingSaves((n) => n + 1);
    try {
      return await fn();
    } finally {
      setPendingSaves((n) => n - 1);
    }
  }

  // Opens Stripe's hosted Customer Portal — used for upgrading Standard to
  // Pro, downgrading, updating payment method, or canceling. Not built
  // yet: /api/stripe/portal is the next piece, once billing is wired up.
  async function openBillingPortal() {
    setActionError("");
    setPortalLoading(true);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const data = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!res.ok || !data?.url) {
        setActionError(data?.error || "Couldn't open billing portal. Try again.");
        return;
      }
      window.location.href = data.url;
    } catch {
      setActionError("Couldn't open billing portal. Try again.");
    } finally {
      setPortalLoading(false);
    }
  }

  const counts = useMemo(() => {
    const c: Record<Status, number> = { critical: 0, low: 0, good: 0 };
    items.forEach((i) => c[getStatus(i)]++);
    return c;
  }, [items]);

  async function adjustQuick(id: number, delta: number) {
    const current = items.find((i) => i.id === id);
    if (!current) return;
    const nextCount = Math.max(0, current.count + delta);
    setActionError("");
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, count: nextCount } : i)));
    try {
      await withSaving(() => updateItemCount(id, nextCount));
    } catch {
      setActionError("Couldn't save that change — reload to see the last saved count.");
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, count: current.count } : i)));
    }
  }

  function changeBatchDraft(id: number, value: number) {
    setBatchDraft((prev) => ({ ...prev, [id]: Math.max(0, value) }));
  }

  function enterBatchMode() {
    setBatchDraft(Object.fromEntries(items.map((i) => [i.id, i.count])));
    setMode("batch");
  }

  async function saveBatch() {
    const changed = items
      .map((i) => ({ id: i.id, count: batchDraft[i.id] ?? i.count }))
      .filter((u) => items.find((i) => i.id === u.id)!.count !== u.count);

    setActionError("");
    setItems((prev) => prev.map((i) => ({ ...i, count: batchDraft[i.id] ?? i.count })));
    setMode("quick");

    try {
      await withSaving(() => updateItemCounts(changed));
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2200);
    } catch {
      setActionError("Couldn't save the closing count. Try again.");
    }
  }

  async function addItem(newItem: Omit<InventoryItem, "id">) {
    setActionError("");
    try {
      const inserted = await withSaving(() => insertItem(shop.id, newItem));
      setItems((prev) => [...prev, inserted]);
      setBatchDraft((prev) => ({ ...prev, [inserted.id]: inserted.count }));
      setShowAdd(false);
    } catch {
      setActionError("Couldn't add that item. Try again.");
    }
  }

  function jumpToEdit() {
    setPage("update");
    setMode("quick");
  }

  async function addMenuItem(name: string, firstIngredient: { itemId: number; amount: number }) {
    setActionError("");
    try {
      const inserted = await withSaving(() => insertMenuItem(shop.id, name, firstIngredient));
      setMenuItems((prev) => [...prev, inserted]);
    } catch {
      setActionError("Couldn't create that menu item. Try again.");
    }
  }

  async function deleteMenuItemHandler(id: number) {
    const prevMenuItems = menuItems;
    setActionError("");
    setMenuItems((prev) => prev.filter((m) => m.id !== id));
    try {
      await withSaving(() => deleteMenuItemRow(id));
    } catch {
      setActionError("Couldn't delete that menu item.");
      setMenuItems(prevMenuItems);
    }
  }

  async function addIngredientToMenuItem(menuItemId: number, itemId: number) {
    setActionError("");
    try {
      const inserted = await withSaving(() => insertIngredient(menuItemId, itemId, 1));
      setMenuItems((prev) =>
        prev.map((m) => (m.id === menuItemId ? { ...m, ingredients: [...m.ingredients, inserted] } : m))
      );
    } catch {
      setActionError("Couldn't add that ingredient. Try again.");
    }
  }

  async function changeIngredientAmount(ingredientId: number, amount: number) {
    const prevMenuItems = menuItems;
    setActionError("");
    setMenuItems((prev) =>
      prev.map((m) => ({
        ...m,
        ingredients: m.ingredients.map((ing) => (ing.id === ingredientId ? { ...ing, amount } : ing)),
      }))
    );
    try {
      await withSaving(() => updateIngredient(ingredientId, { amount }));
    } catch {
      setActionError("Couldn't save that ingredient amount.");
      setMenuItems(prevMenuItems);
    }
  }

  async function changeIngredientItem(ingredientId: number, itemId: number) {
    const prevMenuItems = menuItems;
    setActionError("");
    setMenuItems((prev) =>
      prev.map((m) => ({
        ...m,
        ingredients: m.ingredients.map((ing) => (ing.id === ingredientId ? { ...ing, itemId } : ing)),
      }))
    );
    try {
      await withSaving(() => updateIngredient(ingredientId, { itemId }));
    } catch {
      setActionError("Couldn't update that ingredient.");
      setMenuItems(prevMenuItems);
    }
  }

  async function removeIngredientFromMenuItem(ingredientId: number) {
    const prevMenuItems = menuItems;
    setActionError("");
    setMenuItems((prev) =>
      prev.map((m) => ({ ...m, ingredients: m.ingredients.filter((ing) => ing.id !== ingredientId) }))
    );
    try {
      await withSaving(() => deleteIngredientRow(ingredientId));
    } catch {
      setActionError("Couldn't remove that ingredient.");
      setMenuItems(prevMenuItems);
    }
  }

  async function applySales(sales: SaleLine[]) {
    // sales: [{ menuItem, qty }] — deduct each ingredient's amount * qty, converted
    // from the recipe's measure into the item's stocking unit, from on-hand count.
    const deltaByItemId: Record<number, number> = {};
    for (const { menuItem, qty } of sales) {
      for (const ing of menuItem.ingredients) {
        const item = items.find((i) => i.id === ing.itemId);
        if (!item || !item.unitSize) continue;
        const stockingUnitsUsed = (ing.amount * qty) / item.unitSize;
        deltaByItemId[ing.itemId] = (deltaByItemId[ing.itemId] || 0) + stockingUnitsUsed;
      }
    }
    const updates = items
      .filter((i) => deltaByItemId[i.id])
      .map((i) => ({
        id: i.id,
        count: Math.max(0, Math.round((i.count - deltaByItemId[i.id]) * 100) / 100),
      }));
    if (updates.length === 0) return;

    setActionError("");
    setItems((prev) => {
      const byId = new Map(updates.map((u) => [u.id, u.count]));
      return prev.map((i) => (byId.has(i.id) ? { ...i, count: byId.get(i.id)! } : i));
    });
    try {
      await withSaving(() => updateItemCounts(updates));
    } catch {
      setActionError("Couldn't save the sales deduction. Try again.");
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center" style={{ backgroundColor: "#1B1512" }}>
        <div className="font-mono text-xs uppercase tracking-widest" style={{ color: "#6E6153" }}>
          Loading your shop…
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div
        className="min-h-screen w-full flex items-center justify-center px-5 text-center"
        style={{ backgroundColor: "#1B1512" }}
      >
        <div>
          <div className="font-mono text-sm mb-3" style={{ color: "#B0492F" }}>
            {loadError}
          </div>
          <button
            onClick={onLogout}
            className="font-mono text-xs underline underline-offset-2"
            style={{ color: "#9C8C79" }}
          >
            Switch shop
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen w-full"
      style={{ backgroundColor: "#1B1512", fontFamily: "'Inter', sans-serif" }}
    >
      <div className="max-w-2xl md:max-w-4xl mx-auto px-5 py-10">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1
              style={{
                fontFamily: "'Barlow Condensed', sans-serif",
                color: "#EDE3D3",
                fontSize: 40,
                fontWeight: 700,
                letterSpacing: "0.01em",
                lineHeight: 1,
              }}
            >
              GROUND WORK
            </h1>
            <p className="text-sm mt-2" style={{ color: "#9C8C79" }}>
              {shopName}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0 mt-1">
            <Package size={28} style={{ color: "#5A4A3C" }} />
            <div className="text-right">
              <div className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "#6E6153" }}>
                {pendingSaves > 0 ? "Saving…" : "Signed in"}
              </div>
              <button
                onClick={onLogout}
                className="font-mono text-xs mt-1 underline underline-offset-2"
                style={{ color: "#9C8C79" }}
              >
                Switch shop
              </button>
            </div>
          </div>
        </div>

        {/* Page switcher */}
        <div className="flex items-center justify-between gap-3 mb-8 flex-wrap">
          <div
            className="flex items-center gap-1 p-1 rounded-lg border w-fit"
            style={{ borderColor: "#3A2F27", backgroundColor: "#1F1712" }}
          >
            <button
              onClick={() => setPage("update")}
              className="px-4 py-2 rounded-md text-sm font-mono flex items-center gap-2 transition-colors"
              style={{
                backgroundColor: page === "update" ? "#2A211C" : "transparent",
                color: page === "update" ? "#EDE3D3" : "#6E6153",
              }}
            >
              <PencilLine size={14} /> Update
            </button>
            <button
              onClick={() => setPage("spreadsheet")}
              className="px-4 py-2 rounded-md text-sm font-mono flex items-center gap-2 transition-colors"
              style={{
                backgroundColor: page === "spreadsheet" ? "#2A211C" : "transparent",
                color: page === "spreadsheet" ? "#EDE3D3" : "#6E6153",
              }}
            >
              <Table2 size={14} /> Spreadsheet
            </button>
            <button
              onClick={() => setPage("recipes")}
              className="px-4 py-2 rounded-md text-sm font-mono flex items-center gap-2 transition-colors"
              style={{
                backgroundColor: page === "recipes" ? "#2A211C" : "transparent",
                color: page === "recipes" ? "#EDE3D3" : "#6E6153",
              }}
            >
              {tier === "standard" ? <Lock size={14} /> : <BookOpen size={14} />} Recipes
            </button>
          </div>

          <button
            onClick={openBillingPortal}
            disabled={portalLoading}
            className="px-3 py-1.5 rounded-full text-[11px] font-mono border disabled:opacity-60"
            style={{
              borderColor: tier === "pro" ? "#C1663B" : "#3A2F27",
              color: tier === "pro" ? "#C1663B" : "#6E6153",
            }}
          >
            {tier === "pro" ? "★ Pro plan" : "Standard plan"} · {portalLoading ? "Opening…" : "Manage billing"}
          </button>
        </div>

        {/* Status summary strip */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          {(["critical", "low", "good"] as Status[]).map((s) => (
            <div
              key={s}
              className="rounded-lg border px-3 py-3 text-center"
              style={{ borderColor: "#3A2F27" }}
            >
              <div className="font-mono text-2xl font-bold" style={{ color: STATUS_META[s].color }}>
                {counts[s]}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-widest mt-1" style={{ color: "#9C8C79" }}>
                {STATUS_META[s].label}
              </div>
            </div>
          ))}
        </div>

        {page === "update" && (
        <>
        {/* Mode switcher */}
        <div className="flex items-center gap-2 mb-6 flex-wrap">
          <button
            onClick={() => setMode("quick")}
            className="px-4 py-2 rounded-full text-sm font-mono flex items-center gap-2 border transition-colors"
            style={{
              borderColor: mode === "quick" ? "#C1663B" : "#3A2F27",
              backgroundColor: mode === "quick" ? "#C1663B" : "transparent",
              color: mode === "quick" ? "#1B1512" : "#9C8C79",
            }}
          >
            <Plus size={14} /> Quick Log
          </button>
          <button
            onClick={enterBatchMode}
            className="px-4 py-2 rounded-full text-sm font-mono flex items-center gap-2 border transition-colors"
            style={{
              borderColor: mode === "batch" ? "#C1663B" : "#3A2F27",
              backgroundColor: mode === "batch" ? "#C1663B" : "transparent",
              color: mode === "batch" ? "#1B1512" : "#9C8C79",
            }}
          >
            <ClipboardList size={14} /> Closing Count
          </button>
          <button
            onClick={() => setShowAdd((v) => !v)}
            className="ml-auto px-4 py-2 rounded-full text-sm font-mono border"
            style={{ borderColor: "#3A2F27", color: "#9C8C79" }}
          >
            + New item
          </button>
        </div>

        {showAdd && <AddItemForm onAdd={addItem} onCancel={() => setShowAdd(false)} />}

        {mode === "batch" && (
          <div
            className="rounded-lg border px-4 py-3 mb-6 flex items-center justify-between"
            style={{ borderColor: "#5A4A3C", backgroundColor: "#241C17" }}
          >
            <span className="text-sm" style={{ color: "#EDE3D3" }}>
              Walk the storage room, update every count, then save once.
            </span>
            <button
              onClick={saveBatch}
              className="px-4 py-2 rounded-md text-sm font-mono font-semibold flex items-center gap-1.5"
              style={{ backgroundColor: "#C1663B", color: "#1B1512" }}
            >
              <Check size={14} /> Save Closing Count
            </button>
          </div>
        )}

        {savedFlash && (
          <div className="mb-6 text-sm font-mono" style={{ color: "#7A8F5E" }}>
            ✓ Closing count saved.
          </div>
        )}

        {actionError && (
          <div className="mb-6 text-sm font-mono" style={{ color: "#B0492F" }}>
            {actionError}
          </div>
        )}

        {items.length === 0 && (
          <div
            className="rounded-lg border px-4 py-6 mb-8 text-center text-sm"
            style={{ borderColor: "#3A2F27", color: "#9C8C79" }}
          >
            No inventory yet — add your first item above to get started.
          </div>
        )}

        {/* Category sections */}
        <div className="md:grid md:grid-cols-2 md:gap-x-12">
        {CATEGORIES.map((cat) => {
          const catItems = items.filter((i) => i.category === cat.id);
          if (catItems.length === 0) return null;
          const Icon = cat.icon;
          return (
            <div key={cat.id} className="mb-8">
              <div className="flex items-center gap-2 mb-1">
                <Icon size={16} style={{ color: "#C1663B" }} />
                <h2
                  className="font-semibold uppercase tracking-wide text-sm"
                  style={{ color: "#EDE3D3", fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: "0.08em" }}
                >
                  {cat.label}
                </h2>
              </div>
              <p className="text-xs mb-2" style={{ color: "#6E6153" }}>{cat.note}</p>
              <div>
                {catItems.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    mode={mode}
                    onAdjust={adjustQuick}
                    onBatchChange={changeBatchDraft}
                    batchValue={batchDraft[item.id] ?? item.count}
                  />
                ))}
              </div>
            </div>
          );
        })}
        </div>
        </>
        )}

        {page === "spreadsheet" && (
          <SpreadsheetView items={items} onEdit={jumpToEdit} />
        )}

        {page === "recipes" && tier === "standard" && (
          <div
            className="rounded-lg border p-8 text-center"
            style={{ borderColor: "#3A2F27", backgroundColor: "#211A15" }}
          >
            <Lock size={22} className="mx-auto mb-3" style={{ color: "#5A4A3C" }} />
            <div
              className="font-semibold mb-2"
              style={{ color: "#EDE3D3", fontFamily: "'Barlow Condensed', sans-serif", fontSize: 20 }}
            >
              RECIPES IS A PRO FEATURE
            </div>
            <p className="text-sm mb-4 max-w-sm mx-auto" style={{ color: "#9C8C79" }}>
              Map menu items to ingredients so a sale automatically deducts stock, and import
              your end-of-shift POS sales to update everything at once.
            </p>
            <button
              onClick={openBillingPortal}
              disabled={portalLoading}
              className="px-4 py-2 rounded-md text-sm font-mono font-semibold disabled:opacity-60"
              style={{ backgroundColor: "#C1663B", color: "#1B1512" }}
            >
              {portalLoading ? "Opening…" : "Upgrade to Pro — $50/mo"}
            </button>
          </div>
        )}

        {page === "recipes" && tier === "pro" && (
          <RecipesPage
            items={items}
            menuItems={menuItems}
            onAddMenuItem={addMenuItem}
            onDeleteMenuItem={deleteMenuItemHandler}
            onAddIngredient={addIngredientToMenuItem}
            onChangeIngredientAmount={changeIngredientAmount}
            onChangeIngredientItem={changeIngredientItem}
            onRemoveIngredient={removeIngredientFromMenuItem}
            onApplySales={applySales}
          />
        )}

        <div className="text-center font-mono text-[10px] uppercase tracking-widest mt-10" style={{ color: "#4A3F35" }}>
          Text alerts fire automatically when an item crosses into Reorder or Critical
        </div>
      </div>
    </div>
  );
}

// ---- No active plan: paywall, not just Recipes ------------------------------

interface NoPlanScreenProps {
  shopName: string;
  onLogout: () => void;
}

function NoPlanScreen({ shopName, onLogout }: NoPlanScreenProps) {
  const [loadingPlan, setLoadingPlan] = useState<"standard" | "pro" | null>(null);
  const [error, setError] = useState("");

  // /api/stripe/checkout doesn't exist yet — this is the very next thing
  // to build, once Stripe Products/Prices exist to point it at.
  async function subscribe(plan: "standard" | "pro") {
    setError("");
    setLoadingPlan(plan);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!res.ok || !data?.url) {
        setError(data?.error || "Couldn't start checkout. Try again.");
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("Couldn't start checkout. Try again.");
    } finally {
      setLoadingPlan(null);
    }
  }

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center px-5"
      style={{ backgroundColor: "#1B1512", fontFamily: "'Inter', sans-serif" }}
    >
      <div
        className="w-full max-w-md rounded-lg border p-6 text-center"
        style={{ borderColor: "#3A2F27", backgroundColor: "#211A15" }}
      >
        <div className="font-mono text-xs uppercase tracking-[0.25em] mb-2" style={{ color: "#C1663B" }}>
          Ground Work
        </div>
        <h1
          style={{ fontFamily: "'Barlow Condensed', sans-serif", color: "#EDE3D3", fontSize: 26, fontWeight: 700 }}
          className="mb-2"
        >
          CHOOSE A PLAN FOR {shopName.toUpperCase()}
        </h1>
        <p className="text-sm mb-6" style={{ color: "#9C8C79" }}>
          Every shop needs an active plan to get into the dashboard.
        </p>

        <div className="flex flex-col gap-3 mb-4">
          <button
            onClick={() => subscribe("standard")}
            disabled={loadingPlan !== null}
            className="w-full px-4 py-3 rounded-md text-sm font-mono font-semibold border disabled:opacity-60 text-left"
            style={{ borderColor: "#5A4A3C", color: "#EDE3D3" }}
          >
            {loadingPlan === "standard" ? "Redirecting…" : "Standard — $40/mo"}
            <div className="text-xs font-normal mt-1" style={{ color: "#9C8C79" }}>
              Inventory tracking, no recipes
            </div>
          </button>
          <button
            onClick={() => subscribe("pro")}
            disabled={loadingPlan !== null}
            className="w-full px-4 py-3 rounded-md text-sm font-mono font-semibold disabled:opacity-60 text-left"
            style={{ backgroundColor: "#C1663B", color: "#1B1512" }}
          >
            {loadingPlan === "pro" ? "Redirecting…" : "Pro — $50/mo"}
            <div className="text-xs font-normal mt-1" style={{ color: "#1B1512", opacity: 0.7 }}>
              Everything in Standard, plus recipes
            </div>
          </button>
        </div>

        {error && (
          <div className="text-xs font-mono mb-4" style={{ color: "#B0492F" }}>
            {error}
          </div>
        )}

        <button
          onClick={onLogout}
          className="font-mono text-xs underline underline-offset-2"
          style={{ color: "#9C8C79" }}
        >
          Switch shop
        </button>
      </div>
    </div>
  );
}

// ---- Admin panel (view-only) ---------------------------------------------------------

const TIER_LABEL: Record<Tier, string> = { none: "No plan", standard: "Standard", pro: "★ Pro" };
const TIER_COLOR: Record<Tier, string> = { none: "#6E6153", standard: "#7A8F5E", pro: "#C1663B" };

interface AdminShopDetailProps {
  shop: ShopSummary;
  onBack: () => void;
  onTierChanged: (shopId: string, tier: Tier) => void;
}

const TIER_OPTIONS: Tier[] = ["none", "standard", "pro"];

function AdminShopDetail({ shop, onBack, onTierChanged }: AdminShopDetailProps) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [tierUpdating, setTierUpdating] = useState(false);
  const [tierError, setTierError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError("");
      try {
        const [fetchedItems, fetchedMenuItems] = await Promise.all([
          fetchItems(shop.id),
          fetchMenuItems(shop.id),
        ]);
        if (cancelled) return;
        setItems(fetchedItems);
        setMenuItems(fetchedMenuItems);
      } catch {
        if (!cancelled) setLoadError("Couldn't load this shop's data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shop.id]);

  async function changeTier(nextTier: Tier) {
    if (nextTier === shop.tier) return;
    setTierError("");
    setTierUpdating(true);
    try {
      const res = await fetch("/api/admin/set-tier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shopId: shop.id, tier: nextTier }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        setTierError(data?.error || "Couldn't update tier.");
        return;
      }
      onTierChanged(shop.id, nextTier);
    } catch {
      setTierError("Couldn't update tier. Try again.");
    } finally {
      setTierUpdating(false);
    }
  }

  const hasActiveSubscription =
    !!shop.stripeSubscriptionId && (shop.subscriptionStatus === "active" || shop.subscriptionStatus === "trialing");

  return (
    <div>
      <button
        onClick={onBack}
        className="font-mono text-xs mb-6 underline underline-offset-2"
        style={{ color: "#9C8C79" }}
      >
        ← All shops
      </button>
      <h2
        style={{ fontFamily: "'Barlow Condensed', sans-serif", color: "#EDE3D3", fontSize: 28, fontWeight: 700 }}
        className="mb-1"
      >
        {shop.name.toUpperCase()}
      </h2>
      <p className="text-xs font-mono mb-4" style={{ color: TIER_COLOR[shop.tier] }}>
        {TIER_LABEL[shop.tier]}
      </p>

      <div className="rounded-lg border p-4 mb-8" style={{ borderColor: "#3A2F27", backgroundColor: "#211A15" }}>
        <div className="font-mono text-xs uppercase tracking-widest mb-3" style={{ color: "#C1663B" }}>
          Override plan
        </div>
        <div className="flex items-center gap-2 mb-3">
          {TIER_OPTIONS.map((t) => (
            <button
              key={t}
              onClick={() => changeTier(t)}
              disabled={tierUpdating || t === shop.tier}
              className="px-3 py-1.5 rounded-full text-xs font-mono border disabled:opacity-40"
              style={{
                borderColor: t === shop.tier ? TIER_COLOR[t] : "#3A2F27",
                backgroundColor: t === shop.tier ? TIER_COLOR[t] : "transparent",
                color: t === shop.tier ? "#1B1512" : "#9C8C79",
              }}
            >
              {TIER_LABEL[t]}
            </button>
          ))}
          {tierUpdating && (
            <span className="font-mono text-xs" style={{ color: "#6E6153" }}>
              Saving…
            </span>
          )}
        </div>
        {tierError && (
          <div className="text-xs font-mono mb-2" style={{ color: "#B0492F" }}>
            {tierError}
          </div>
        )}
        <p className="text-[10px] font-mono leading-relaxed" style={{ color: "#6E6153" }}>
          {hasActiveSubscription
            ? `This shop has an active Stripe subscription (${shop.subscriptionStatus}) — an override here can get replaced the next time Stripe sends a billing event (renewal, plan change, etc.). Use the shop's own Stripe subscription if you need a permanent change.`
            : "This shop has no active Stripe subscription, so an override here sticks until they ever subscribe through Stripe."}
        </p>
      </div>

      {loading && (
        <div className="font-mono text-xs uppercase tracking-widest" style={{ color: "#6E6153" }}>
          Loading…
        </div>
      )}
      {loadError && (
        <div className="text-sm font-mono" style={{ color: "#B0492F" }}>
          {loadError}
        </div>
      )}

      {!loading && !loadError && (
        <>
          <h3 className="font-mono text-xs uppercase tracking-widest mb-2" style={{ color: "#C1663B" }}>
            Inventory ({items.length})
          </h3>
          {items.length === 0 ? (
            <p className="text-sm mb-8" style={{ color: "#9C8C79" }}>
              No items.
            </p>
          ) : (
            <div className="rounded-lg border overflow-hidden mb-8" style={{ borderColor: "#3A2F27" }}>
              <table className="w-full border-collapse font-mono text-sm">
                <thead>
                  <tr style={{ backgroundColor: "#241C17" }}>
                    {["Item", "Category", "Count", "Threshold"].map((label) => (
                      <th
                        key={label}
                        className="text-left px-3 py-2 text-[11px] uppercase tracking-widest"
                        style={{ color: "#9C8C79", borderBottom: "1px solid #3A2F27" }}
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => (
                    <tr
                      key={item.id}
                      style={{
                        backgroundColor: idx % 2 === 0 ? "transparent" : "#211A15",
                        borderBottom: "1px solid #2A2119",
                      }}
                    >
                      <td className="px-3 py-2" style={{ color: "#EDE3D3" }}>
                        {item.name}
                      </td>
                      <td className="px-3 py-2" style={{ color: "#9C8C79" }}>
                        {CATEGORY_LABEL[item.category]}
                      </td>
                      <td className="px-3 py-2" style={{ color: "#EDE3D3" }}>
                        {item.count} {item.unit}
                      </td>
                      <td className="px-3 py-2" style={{ color: "#9C8C79" }}>
                        {item.threshold}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 className="font-mono text-xs uppercase tracking-widest mb-2" style={{ color: "#C1663B" }}>
            Recipes ({menuItems.length})
          </h3>
          {menuItems.length === 0 ? (
            <p className="text-sm" style={{ color: "#9C8C79" }}>
              No recipes.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {menuItems.map((mi) => (
                <div key={mi.id} className="rounded-lg border p-3" style={{ borderColor: "#3A2F27" }}>
                  <div className="font-semibold mb-1" style={{ color: "#EDE3D3" }}>
                    {mi.name}
                  </div>
                  <ul className="text-xs font-mono flex flex-col gap-0.5" style={{ color: "#9C8C79" }}>
                    {mi.ingredients.map((ing) => {
                      const linkedItem = items.find((i) => i.id === ing.itemId);
                      return (
                        <li key={ing.id}>
                          {linkedItem ? linkedItem.name : `item #${ing.itemId} (missing)`} — {ing.amount}{" "}
                          {linkedItem?.unitMeasure ?? ""}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface AdminDashboardProps {
  onLogout: () => void;
}

function AdminDashboard({ onLogout }: AdminDashboardProps) {
  const [shops, setShops] = useState<ShopSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedShopId, setSelectedShopId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError("");
      try {
        const fetched = await fetchAllShops();
        if (!cancelled) setShops(fetched);
      } catch {
        if (!cancelled) setLoadError("Couldn't load shops.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedShop = shops.find((s) => s.id === selectedShopId) ?? null;

  function handleTierChanged(shopId: string, tier: Tier) {
    setShops((prev) => prev.map((s) => (s.id === shopId ? { ...s, tier } : s)));
  }

  return (
    <div className="min-h-screen w-full" style={{ backgroundColor: "#1B1512", fontFamily: "'Inter', sans-serif" }}>
      <div className="max-w-2xl md:max-w-4xl mx-auto px-5 py-10">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <div className="font-mono text-xs uppercase tracking-[0.25em] mb-2" style={{ color: "#C1663B" }}>
              Ground Work
            </div>
            <h1
              style={{
                fontFamily: "'Barlow Condensed', sans-serif",
                color: "#EDE3D3",
                fontSize: 40,
                fontWeight: 700,
                letterSpacing: "0.01em",
                lineHeight: 1,
              }}
            >
              ADMIN
            </h1>
            <p className="text-sm mt-2" style={{ color: "#9C8C79" }}>
              {shops.length} shop{shops.length === 1 ? "" : "s"} signed up
            </p>
          </div>
          <button
            onClick={onLogout}
            className="font-mono text-xs mt-1 underline underline-offset-2"
            style={{ color: "#9C8C79" }}
          >
            Sign out
          </button>
        </div>

        {selectedShop ? (
          <AdminShopDetail shop={selectedShop} onBack={() => setSelectedShopId(null)} onTierChanged={handleTierChanged} />
        ) : (
          <>
            {loading && (
              <div className="font-mono text-xs uppercase tracking-widest" style={{ color: "#6E6153" }}>
                Loading shops…
              </div>
            )}
            {loadError && (
              <div className="text-sm font-mono" style={{ color: "#B0492F" }}>
                {loadError}
              </div>
            )}
            {!loading && !loadError && shops.length === 0 && (
              <div className="text-sm" style={{ color: "#9C8C79" }}>
                No shops signed up yet.
              </div>
            )}
            {!loading && shops.length > 0 && (
              <div className="rounded-lg border overflow-hidden" style={{ borderColor: "#3A2F27" }}>
                <table className="w-full border-collapse font-mono text-sm">
                  <thead>
                    <tr style={{ backgroundColor: "#241C17" }}>
                      {["Shop", "Plan", "Signed up"].map((label) => (
                        <th
                          key={label}
                          className="text-left px-3 py-2.5 text-[11px] uppercase tracking-widest"
                          style={{ color: "#9C8C79", borderBottom: "1px solid #3A2F27" }}
                        >
                          {label}
                        </th>
                      ))}
                      <th style={{ borderBottom: "1px solid #3A2F27" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {shops.map((s, idx) => (
                      <tr
                        key={s.id}
                        style={{
                          backgroundColor: idx % 2 === 0 ? "transparent" : "#211A15",
                          borderBottom: "1px solid #2A2119",
                        }}
                      >
                        <td className="px-3 py-2.5" style={{ color: "#EDE3D3" }}>
                          {s.name}
                        </td>
                        <td className="px-3 py-2.5" style={{ color: TIER_COLOR[s.tier] }}>
                          {TIER_LABEL[s.tier]}
                        </td>
                        <td className="px-3 py-2.5" style={{ color: "#9C8C79" }}>
                          {new Date(s.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <button
                            onClick={() => setSelectedShopId(s.id)}
                            className="text-xs px-2 py-1 rounded border"
                            style={{ borderColor: "#3A2F27", color: "#9C8C79" }}
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---- Outer app: auth gate + shop switching ---------------------------------------------------------

type AuthStatus = "loading" | "signedOut" | "signedIn";

export default function InventoryTracker() {
  const supabase = useMemo(() => createClient(), []);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [shop, setShop] = useState<ShopProfile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadUser(userId: string) {
      // Admin identities (supabase/006_admin.sql) don't have a shops row
      // of their own by design — check this first, before the "no shop
      // row found" branch below would otherwise treat them as signed out.
      const { data: adminRow } = await supabase.from("admins").select("id").eq("id", userId).maybeSingle();
      if (cancelled) return;
      if (adminRow) {
        setIsAdmin(true);
        setShop(null);
        setStatus("signedIn");
        return;
      }
      setIsAdmin(false);
      await loadShop(userId);
    }

    async function loadShop(userId: string, attempt = 0): Promise<void> {
      const { data, error } = await supabase
        .from("shops")
        .select("id, name, tier")
        .eq("id", userId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        // Signed in but the shops row isn't readable yet — either the
        // signup trigger hasn't fired, or (before step 3 adds RLS
        // policies) reads are still blocked. Either way, don't show a
        // dashboard with no shop behind it.
        setShop(null);
        setStatus("signedOut");
        return;
      }

      // Stripe redirects the browser back here the instant Checkout
      // succeeds, which can beat the webhook that actually flips tier —
      // it's a separate, async server-to-server call. Give it a few
      // seconds to land rather than flashing the "choose a plan" screen
      // right after someone just paid.
      const justCheckedOut =
        typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).get("checkout") === "success";
      if (justCheckedOut && data.tier === "none" && attempt < 5) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (cancelled) return;
        return loadShop(userId, attempt + 1);
      }
      if (justCheckedOut && typeof window !== "undefined") {
        window.history.replaceState(null, "", window.location.pathname);
      }

      setShop(data as ShopProfile);
      setStatus("signedIn");
    }

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const user = data.session?.user;
      if (user) {
        void loadUser(user.id);
      } else {
        setStatus("signedOut");
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, authSession) => {
      const user = authSession?.user;
      if (user) {
        void loadUser(user.id);
      } else {
        setShop(null);
        setIsAdmin(false);
        setStatus("signedOut");
      }
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  if (status === "loading") {
    return (
      <div className="min-h-screen w-full flex items-center justify-center" style={{ backgroundColor: "#1B1512" }}>
        <div className="font-mono text-xs uppercase tracking-widest" style={{ color: "#6E6153" }}>
          Loading…
        </div>
      </div>
    );
  }

  const logout = () => {
    void supabase.auth.signOut();
  };

  // Checked before the "no shop" fallback below — an admin has no shops
  // row at all by design, so `shop` is null for them even while signed in.
  if (status === "signedIn" && isAdmin) {
    return <AdminDashboard onLogout={logout} />;
  }

  if (status === "signedOut" || !shop) {
    return <LoginScreen />;
  }

  if (shop.tier === "none") {
    return <NoPlanScreen shopName={shop.name} onLogout={logout} />;
  }

  return <ShopDashboard key={shop.id} shop={shop} onLogout={logout} />;
}
