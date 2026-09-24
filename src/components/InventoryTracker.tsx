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
  Bell,
  PackagePlus,
  CalendarClock,
  type LucideIcon,
} from "lucide-react";
import type {
  CategoryId,
  Status,
  Tier,
  Mode,
  Page,
  DisplayMode,
  InventoryItem,
  Ingredient,
  MenuItem,
  Batch,
  ShopProfile,
  ShopSummary,
  SaleLine,
} from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { DEMO_SHOP_ID } from "@/lib/demo";
import {
  fetchItems,
  fetchMenuItems,
  insertItem,
  updateItem,
  deleteItemRow,
  updateItemCount,
  updateItemCounts,
  insertMenuItem,
  deleteMenuItemRow,
  insertIngredient,
  updateIngredient,
  deleteIngredientRow,
  fetchAllShops,
  fetchAlertRecipients,
  addAlertRecipient,
  deleteAlertRecipient,
  updateDisplayMode,
  updateExpirationAlertDays,
  fetchBatchesForShop,
  insertBatch,
  updateBatch,
  deleteBatchRow,
  consumeBatchesFIFO,
  type AlertRecipient,
} from "@/lib/shop-data";

// ---- Categories (display metadata only — data shape lives in lib/types) ---

interface Category {
  id: CategoryId;
  label: string;
  icon: LucideIcon;
}

const CATEGORIES: Category[] = [
  { id: "perishable", label: "Perishables", icon: Snowflake },
  { id: "dry", label: "Dry Goods & Syrups", icon: Coffee },
  { id: "disposable", label: "Disposables", icon: CupSoda },
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

// ---- Display mode (Count vs. Amount) ---------------------------------------
// Entry and editing always happen in native stocking units (a count of
// items/bags/cartons) — this only changes how a quantity is *shown*.
// "measurement" mode converts through unitSize/unitMeasure into a total
// remaining amount; items without those set just always show count, since
// there's nothing to convert.

function trimNumber(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

function displayQuantity(item: InventoryItem, mode: DisplayMode, count: number): { amount: string; label: string } {
  if (mode === "measurement" && item.unitSize && item.unitMeasure) {
    return { amount: trimNumber(count * item.unitSize), label: item.unitMeasure };
  }
  return { amount: trimNumber(count), label: item.unit };
}

function displayThreshold(item: InventoryItem, mode: DisplayMode): string {
  const { amount, label } = displayQuantity(item, mode, item.threshold);
  return `${amount} ${label}`;
}

// ---- Batch expiration helpers ----------------------------------------------

function daysUntilDate(dateStr: string): number {
  const target = new Date(dateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function formatDaysUntil(days: number): string {
  if (days < 0) return `expired ${Math.abs(days)}d ago`;
  if (days === 0) return "expires today";
  return `${days}d left`;
}

// ---- Stamp badge (signature element) --------------------------------------

function StatusStamp({ status }: { status: Status }) {
  const meta = STATUS_META[status];
  return (
    <div
      className="shrink-0 flex items-center justify-center rounded-full border-2 font-mono uppercase tracking-wider select-none w-12 h-12 sm:w-16 sm:h-16"
      style={{
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
  displayMode: DisplayMode;
  batches: Batch[];
  onAdjust: (id: number, delta: number) => void;
  onBatchChange: (id: number, value: number | "") => void;
  batchValue: number | "";
  onEdit: (id: number) => void;
  onAddStock: (id: number) => void;
  onEditBatches: (id: number) => void;
}

function ItemRow({
  item,
  mode,
  displayMode,
  batches,
  onAdjust,
  onBatchChange,
  batchValue,
  onEdit,
  onAddStock,
  onEditBatches,
}: ItemRowProps) {
  // batchValue is "" while the field is mid-edit (backspaced to empty) —
  // fall back to the item's real count just for the status-color preview,
  // rather than treating a blank field as a count of zero.
  const status = getStatus(mode === "batch" ? { ...item, count: batchValue === "" ? item.count : batchValue } : item);
  const meta = STATUS_META[status];
  const qty = displayQuantity(item, displayMode, item.count);
  const isPerishable = item.category === "perishable";
  // Nearest-expiring batch, if any — shown as a quick heads-up in the
  // subtitle without needing to open the batch editor.
  const nearestBatch = batches.length > 0 ? batches[0] : null;

  return (
    <div
      // Always two lines (info on top, controls below) rather than trying
      // to fit everything on one row past some breakpoint — the category
      // list is itself a 2-column grid on wider screens, so "wide viewport"
      // doesn't mean "wide column"; a fixed breakpoint here can't reliably
      // predict how much width a row actually has. Stacking always is
      // simpler and correct at every size instead of guessing.
      className="flex flex-col gap-3 py-4 border-b"
      style={{ borderColor: "#3A2F27" }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <StatusStamp status={status} />

        <div className="flex-1 min-w-0">
          <div className="font-semibold" style={{ color: "#EDE3D3", fontFamily: "'Barlow Condensed', sans-serif", fontSize: 19, letterSpacing: "0.01em" }}>
            {item.name.toUpperCase()}
          </div>
          <div className="font-mono text-xs mt-0.5" style={{ color: "#9C8C79" }}>
            threshold {displayThreshold(item, displayMode)} · {meta.label.toLowerCase()}
            {item.unitSize ? ` · 1 ${item.unit.replace(/s$/, "")} = ${item.unitSize} ${item.unitMeasure}` : ""}
          </div>
          {nearestBatch && (
            <div
              className="font-mono text-[10px] mt-0.5 flex items-center gap-1"
              style={{ color: daysUntilDate(nearestBatch.expiresOn) <= 3 ? "#C79A3E" : "#6E6153" }}
            >
              <CalendarClock size={10} />
              {batches.length === 1 ? "1 batch" : `${batches.length} batches`} ·{" "}
              {formatDaysUntil(daysUntilDate(nearestBatch.expiresOn))}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        {mode === "quick" ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => onAdjust(item.id, -1)}
              className="w-9 h-9 rounded-full flex items-center justify-center border transition-colors hover:brightness-125 shrink-0"
              style={{ borderColor: "#5A4A3C", color: "#EDE3D3" }}
              aria-label={`Decrease ${item.name}`}
            >
              <Minus size={16} />
            </button>
            <div className="font-mono text-center" style={{ color: "#EDE3D3", minWidth: 48 }}>
              <div className="text-lg leading-tight">{qty.amount}</div>
              <div className="text-[9px] uppercase tracking-wide" style={{ color: "#6E6153" }}>{qty.label}</div>
            </div>
            <button
              onClick={() => onAdjust(item.id, 1)}
              className="w-9 h-9 rounded-full flex items-center justify-center border transition-colors hover:brightness-125 shrink-0"
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
            // Blank stays blank instead of snapping to 0 — forcing a "0" into
            // a controlled number input is what caused the next keystroke to
            // land in front of it (typing "5" against a displayed "0" gives
            // "05"). parseFloat (not parseInt) so a fractional closing count
            // like "2.5" isn't silently truncated to 2.
            onChange={(e) => onBatchChange(item.id, e.target.value === "" ? "" : parseFloat(e.target.value))}
            className="w-20 font-mono text-lg text-center rounded-md border py-1.5 bg-transparent focus:outline-none focus:ring-2"
            style={{ borderColor: "#5A4A3C", color: "#EDE3D3" }}
          />
        )}

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => onAddStock(item.id)}
            className="w-8 h-8 rounded-full flex items-center justify-center border shrink-0 hover:brightness-125"
            style={{ borderColor: "#5A4A3C", color: "#9C8C79" }}
            aria-label={`Add stock for ${item.name}`}
            title="Add stock — just picked some up?"
          >
            <PackagePlus size={14} />
          </button>

          {isPerishable && (
            <button
              onClick={() => onEditBatches(item.id)}
              className="w-8 h-8 rounded-full flex items-center justify-center border shrink-0 hover:brightness-125"
              style={{ borderColor: "#5A4A3C", color: "#9C8C79" }}
              aria-label={`Manage batches for ${item.name}`}
              title="Batches — track expiration, FIFO"
            >
              <CalendarClock size={14} />
            </button>
          )}

          <button
            onClick={() => onEdit(item.id)}
            className="w-8 h-8 rounded-full flex items-center justify-center border shrink-0 hover:brightness-125"
            style={{ borderColor: "#5A4A3C", color: "#9C8C79" }}
            aria-label={`Edit ${item.name}`}
          >
            <PencilLine size={14} />
          </button>
        </div>
      </div>
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
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

// ---- Edit item form ---------------------------------------------------------

interface EditItemFormProps {
  item: InventoryItem;
  onSave: (id: number, item: Omit<InventoryItem, "id">) => void;
  onCancel: () => void;
  onDelete: (id: number) => void;
}

function EditItemForm({ item, onSave, onCancel, onDelete }: EditItemFormProps) {
  const [name, setName] = useState(item.name);
  const [unit, setUnit] = useState(item.unit);
  const [threshold, setThreshold] = useState(item.threshold);
  const [count, setCount] = useState(item.count);
  const [category, setCategory] = useState<CategoryId>(item.category);
  const [unitSize, setUnitSize] = useState(item.unitSize === null ? "" : String(item.unitSize));
  const [unitMeasure, setUnitMeasure] = useState(item.unitMeasure ?? "");

  return (
    <div className="rounded-lg border p-5 mb-6" style={{ borderColor: "#5A4A3C", backgroundColor: "#241C17" }}>
      <div className="font-mono text-xs uppercase tracking-widest mb-4" style={{ color: "#C1663B" }}>
        Edit {item.name}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
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
          Count
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
      <div className="flex gap-2 justify-between">
        <button
          onClick={() => onDelete(item.id)}
          className="px-4 py-2 rounded-md text-sm font-mono flex items-center gap-1.5 border"
          style={{ borderColor: "#5A4A3C", color: "#B0492F" }}
        >
          <Trash2 size={14} /> Delete
        </button>
        <div className="flex gap-2">
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
              onSave(item.id, {
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
            <Check size={14} /> Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Add stock form ---------------------------------------------------------
// The "just got a shipment in" flow: add N of what you're stocking rather
// than doing count math by hand. If the item has a unitSize/unitMeasure
// set (the same fields Recipes use), lets you say the package you're
// adding is a different size than what's tracked (e.g. tracking in 16oz
// cartons but you bought 32oz ones) and converts automatically.

interface AddStockFormProps {
  item: InventoryItem;
  onAdd: (id: number, nativeAmount: number, batchExpiresOn?: string) => void;
  onCancel: () => void;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function AddStockForm({ item, onAdd, onCancel }: AddStockFormProps) {
  const [qty, setQty] = useState<number | "">(1);
  const [size, setSize] = useState(item.unitSize === null ? "" : String(item.unitSize));
  // Perishables only — "individual units" behaves exactly as before
  // (plain count bump); "batch" also creates a tracked batch row with an
  // expiration date, consumed FIFO ahead of the untracked pool.
  const [asBatch, setAsBatch] = useState(false);
  const [expiresOn, setExpiresOn] = useState(todayISO());

  const isPerishable = item.category === "perishable";
  const hasSize = item.unitSize !== null && !!item.unitMeasure;
  const qtyNum = qty === "" ? 0 : qty;
  const sizeNum = parseFloat(size) || 0;
  const sizeDiffers = hasSize && sizeNum > 0 && sizeNum !== item.unitSize;
  const nativeAdd = hasSize && sizeNum > 0 && item.unitSize ? (qtyNum * sizeNum) / item.unitSize : qtyNum;
  const canSubmit = nativeAdd > 0 && (!asBatch || !!expiresOn);

  return (
    <div className="rounded-lg border p-5 mb-6" style={{ borderColor: "#5A4A3C", backgroundColor: "#241C17" }}>
      <div className="font-mono text-xs uppercase tracking-widest mb-1" style={{ color: "#C1663B" }}>
        Add Stock — {item.name}
      </div>
      <p className="text-xs mb-4" style={{ color: "#9C8C79" }}>
        Just picked some up? Say how many you&apos;re adding and it&apos;ll do the math for you.
      </p>

      {isPerishable && (
        <div className="flex items-center gap-1 p-1 rounded-lg border overflow-x-auto max-w-full mb-3" style={{ borderColor: "#3A2F27" }}>
          <button
            onClick={() => setAsBatch(false)}
            className="px-3 py-1.5 rounded-md text-xs font-mono transition-colors"
            style={{
              backgroundColor: !asBatch ? "#2A211C" : "transparent",
              color: !asBatch ? "#EDE3D3" : "#6E6153",
            }}
          >
            Individual units
          </button>
          <button
            onClick={() => setAsBatch(true)}
            className="px-3 py-1.5 rounded-md text-xs font-mono transition-colors flex items-center gap-1.5"
            style={{
              backgroundColor: asBatch ? "#2A211C" : "transparent",
              color: asBatch ? "#EDE3D3" : "#6E6153",
            }}
          >
            <CalendarClock size={12} /> New batch
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <label className="flex flex-col gap-1 text-xs font-mono" style={{ color: "#9C8C79" }}>
          Adding how many {item.unit}?
          <input
            type="number"
            min={0}
            step="0.1"
            autoFocus
            value={qty}
            onChange={(e) => setQty(e.target.value === "" ? "" : parseFloat(e.target.value))}
            className="rounded-md border px-3 py-2 bg-transparent focus:outline-none"
            style={{ borderColor: "#5A4A3C", color: "#EDE3D3" }}
          />
        </label>
        {hasSize && (
          <label className="flex flex-col gap-1 text-xs font-mono" style={{ color: "#9C8C79" }}>
            Size of each ({item.unitMeasure})
            <input
              type="number"
              min={0}
              step="0.1"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              className="rounded-md border px-3 py-2 bg-transparent focus:outline-none"
              style={{ borderColor: "#5A4A3C", color: "#EDE3D3" }}
            />
          </label>
        )}
        {asBatch && (
          <label className="flex flex-col gap-1 text-xs font-mono col-span-2" style={{ color: "#9C8C79" }}>
            This batch expires on
            <input
              type="date"
              value={expiresOn}
              onChange={(e) => setExpiresOn(e.target.value)}
              className="rounded-md border px-3 py-2 bg-transparent focus:outline-none"
              style={{ borderColor: "#5A4A3C", color: "#EDE3D3" }}
            />
          </label>
        )}
      </div>
      {sizeDiffers && (
        <p className="text-[11px] font-mono mb-3" style={{ color: "#C79A3E" }}>
          Different size than what you track (1 {item.unit.replace(/s$/, "")} = {item.unitSize} {item.unitMeasure}) —
          converting: adds {trimNumber(nativeAdd)} {item.unit}.
        </p>
      )}
      <p className="text-xs font-mono mb-4" style={{ color: "#7A8F5E" }}>
        New total: {trimNumber(item.count + nativeAdd)} {item.unit}
        {asBatch && " · tracked as its own batch, consumed first"}
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
          onClick={() => canSubmit && onAdd(item.id, nativeAdd, asBatch ? expiresOn : undefined)}
          disabled={!canSubmit}
          className="px-4 py-2 rounded-md text-sm font-mono flex items-center gap-1.5 font-semibold disabled:opacity-40"
          style={{ backgroundColor: "#C1663B", color: "#1B1512" }}
        >
          <PackagePlus size={14} /> Add {trimNumber(qtyNum)} {item.unit}
        </button>
      </div>
    </div>
  );
}

// ---- Batch editor ---------------------------------------------------------
// Perishables only. Lists every tracked batch for one item — quantity and
// expiration date both directly editable, oldest first (the order they'll
// actually be consumed in) — plus a way to add another. Any part of the
// item's count that isn't covered by a batch is the "untracked" pool,
// shown as a simple line rather than a fake batch row.

interface BatchEditorRowProps {
  batch: Batch;
  unit: string;
  onSave: (patch: { quantity?: number; expiresOn?: string }) => void;
  onDelete: () => void;
}

function BatchEditorRow({ batch, unit, onSave, onDelete }: BatchEditorRowProps) {
  const [quantity, setQuantity] = useState(String(batch.quantity));
  const [expiresOn, setExpiresOn] = useState(batch.expiresOn);

  const quantityNum = parseFloat(quantity);
  const dirty = (quantity !== "" && quantityNum !== batch.quantity) || expiresOn !== batch.expiresOn;
  const days = daysUntilDate(batch.expiresOn);

  function save() {
    const patch: { quantity?: number; expiresOn?: string } = {};
    if (quantity !== "" && quantityNum !== batch.quantity) patch.quantity = Math.max(0, quantityNum);
    if (expiresOn !== batch.expiresOn) patch.expiresOn = expiresOn;
    if (Object.keys(patch).length > 0) onSave(patch);
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border px-3 py-2 flex-wrap" style={{ borderColor: "#3A2F27" }}>
      <input
        type="number"
        min={0}
        step="0.1"
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        className="w-20 rounded-md border px-2 py-1.5 text-sm font-mono bg-transparent focus:outline-none"
        style={{ borderColor: "#5A4A3C", color: "#EDE3D3" }}
      />
      <span className="text-xs font-mono" style={{ color: "#6E6153" }}>
        {unit}
      </span>
      <input
        type="date"
        value={expiresOn}
        onChange={(e) => setExpiresOn(e.target.value)}
        className="rounded-md border px-2 py-1.5 text-sm font-mono bg-transparent focus:outline-none"
        style={{ borderColor: "#5A4A3C", color: "#EDE3D3" }}
      />
      <span
        className="text-[10px] font-mono"
        style={{ color: days < 0 ? "#B0492F" : days <= 3 ? "#C79A3E" : "#6E6153" }}
      >
        {formatDaysUntil(days)}
      </span>
      <div className="flex items-center gap-1 ml-auto">
        {dirty && (
          <button
            onClick={save}
            className="text-xs px-2 py-1 rounded border font-mono"
            style={{ borderColor: "#7A8F5E", color: "#7A8F5E" }}
          >
            Save
          </button>
        )}
        <button onClick={onDelete} style={{ color: "#6E6153" }} aria-label="Delete batch">
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

interface BatchEditorProps {
  item: InventoryItem;
  batches: Batch[];
  onAddBatch: (itemId: number, quantity: number, expiresOn: string) => void;
  onEditBatch: (id: number, patch: { quantity?: number; expiresOn?: string }) => void;
  onDeleteBatch: (id: number) => void;
  onClose: () => void;
}

function BatchEditor({ item, batches, onAddBatch, onEditBatch, onDeleteBatch, onClose }: BatchEditorProps) {
  const [newQty, setNewQty] = useState<number | "">("");
  const [newExpiresOn, setNewExpiresOn] = useState(todayISO());

  const trackedTotal = batches.reduce((sum, b) => sum + b.quantity, 0);
  const untracked = Math.max(0, item.count - trackedTotal);

  return (
    <div className="rounded-lg border p-5 mb-6" style={{ borderColor: "#5A4A3C", backgroundColor: "#241C17" }}>
      <div className="flex items-center justify-between mb-1">
        <div className="font-mono text-xs uppercase tracking-widest" style={{ color: "#C1663B" }}>
          Batches — {item.name}
        </div>
        <button onClick={onClose} style={{ color: "#9C8C79" }} aria-label="Close batch editor">
          <X size={16} />
        </button>
      </div>
      <p className="text-xs mb-4" style={{ color: "#9C8C79" }}>
        Oldest-expiring batch is used first automatically as stock gets consumed — Quick Log, Closing Count, and
        recipe sales deductions all draw from it before touching untracked stock.
      </p>

      {batches.length === 0 ? (
        <p className="text-sm mb-4" style={{ color: "#9C8C79" }}>
          No tracked batches yet — all {trimNumber(item.count)} {item.unit} is untracked stock.
        </p>
      ) : (
        <div className="flex flex-col gap-2 mb-2">
          {batches.map((b) => (
            <BatchEditorRow
              key={b.id}
              batch={b}
              unit={item.unit}
              onSave={(patch) => onEditBatch(b.id, patch)}
              onDelete={() => onDeleteBatch(b.id)}
            />
          ))}
        </div>
      )}
      {batches.length > 0 && untracked > 0 && (
        <p className="text-[11px] font-mono mb-4" style={{ color: "#6E6153" }}>
          + {trimNumber(untracked)} {item.unit} untracked (no expiration recorded)
        </p>
      )}

      <div className="border-t pt-4 mt-2" style={{ borderColor: "#3A2F27" }}>
        <div className="font-mono text-[10px] uppercase tracking-widest mb-2" style={{ color: "#9C8C79" }}>
          Add another batch
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs font-mono" style={{ color: "#9C8C79" }}>
            Quantity ({item.unit})
            <input
              type="number"
              min={0}
              step="0.1"
              value={newQty}
              onChange={(e) => setNewQty(e.target.value === "" ? "" : parseFloat(e.target.value))}
              className="rounded-md border px-3 py-2 bg-transparent focus:outline-none"
              style={{ borderColor: "#5A4A3C", color: "#EDE3D3" }}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-mono" style={{ color: "#9C8C79" }}>
            Expires on
            <input
              type="date"
              value={newExpiresOn}
              onChange={(e) => setNewExpiresOn(e.target.value)}
              className="rounded-md border px-3 py-2 bg-transparent focus:outline-none"
              style={{ borderColor: "#5A4A3C", color: "#EDE3D3" }}
            />
          </label>
        </div>
        <div className="flex justify-end mt-3">
          <button
            onClick={() => {
              if (newQty === "" || newQty <= 0 || !newExpiresOn) return;
              onAddBatch(item.id, newQty, newExpiresOn);
              setNewQty("");
            }}
            disabled={newQty === "" || newQty <= 0}
            className="px-4 py-2 rounded-md text-sm font-mono font-semibold flex items-center gap-1.5 disabled:opacity-40"
            style={{ backgroundColor: "#C1663B", color: "#1B1512" }}
          >
            <Plus size={14} /> Add Batch
          </button>
        </div>
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
  displayMode: DisplayMode;
  onEdit: (id: number) => void;
}

function SpreadsheetView({ items, displayMode, onEdit }: SpreadsheetViewProps) {
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
    <div className="rounded-lg border overflow-x-auto" style={{ borderColor: "#3A2F27" }}>
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
            const qty = displayQuantity(item, displayMode, item.count);
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
                <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: "#EDE3D3" }}>
                  {qty.amount} {qty.label}
                </td>
                <td className="px-3 py-2.5" style={{ color: "#9C8C79" }}>
                  {item.unit}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: "#9C8C79" }}>
                  {displayThreshold(item, displayMode)}
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
  menuItems: MenuItem[];
  onAdd: (name: string, firstIngredient: { itemId: number; amount: number }) => void;
}

function AddMenuItemForm({ items, menuItems, onAdd }: AddMenuItemFormProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const linkableItems = items.filter((i) => i.unitSize);

  function submit() {
    const trimmed = name.trim();
    if (!trimmed || linkableItems.length === 0) return;
    // Case-insensitive so "Vanilla Latte" and "vanilla latte" collide too —
    // the unique index on menu_items(shop_id, lower(name)) backs this up
    // server-side for the concurrent-tab race this check can't catch.
    const isDuplicate = menuItems.some((m) => m.name.toLowerCase() === trimmed.toLowerCase());
    if (isDuplicate) {
      setError(`You already have a recipe named "${trimmed}".`);
      return;
    }
    setError("");
    onAdd(trimmed, { itemId: linkableItems[0].id, amount: 1 });
    setName("");
  }

  return (
    <div className="mb-6">
      <div className="flex gap-2">
        <input
          placeholder="New menu item, e.g. Vanilla Latte"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError("");
          }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="flex-1 rounded-md border px-3 py-2 bg-transparent focus:outline-none"
          style={{ borderColor: "#5A4A3C", color: "#EDE3D3" }}
        />
        <button
          onClick={submit}
          disabled={linkableItems.length === 0}
          className="px-4 py-2 rounded-md text-sm font-mono font-semibold flex items-center gap-1.5 disabled:opacity-40"
          style={{ backgroundColor: "#C1663B", color: "#1B1512" }}
        >
          <Plus size={14} /> Add
        </button>
      </div>
      {error && (
        <p className="text-[10px] font-mono mt-2" style={{ color: "#B0492F" }}>
          {error}
        </p>
      )}
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
      <AddMenuItemForm items={items} menuItems={menuItems} onAdd={onAddMenuItem} />
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

// ---- Restock alerts ---------------------------------------------------------

// Loose E.164 check (+ then 7-15 digits, no leading 0) — not exhaustive,
// but catches "forgot the +" / "typed letters" before it ever reaches
// Twilio and fails silently from the shop owner's point of view.
const PHONE_PATTERN = /^\+[1-9]\d{6,14}$/;

interface AlertsPageProps {
  shopId: string;
  expirationAlertDays: number;
  onChangeExpirationAlertDays: (days: number) => void;
}

function AlertsPage({ shopId, expirationAlertDays, onChangeExpirationAlertDays }: AlertsPageProps) {
  const [recipients, setRecipients] = useState<AlertRecipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [consentChecked, setConsentChecked] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError("");
      try {
        const fetched = await fetchAlertRecipients(shopId);
        if (!cancelled) setRecipients(fetched);
      } catch {
        if (!cancelled) setLoadError("Couldn't load alert recipients.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shopId]);

  async function handleAdd() {
    const phone = newPhone.trim();
    if (!phone || !consentChecked) return;
    setActionError("");
    if (!PHONE_PATTERN.test(phone)) {
      setActionError("Enter a phone number in international format, e.g. +15551234567.");
      return;
    }
    setAdding(true);
    try {
      const inserted = await addAlertRecipient(shopId, phone);
      setRecipients((prev) => [...prev, inserted]);
      setNewPhone("");
      setConsentChecked(false);
    } catch {
      setActionError("Couldn't add that number. Try again.");
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(id: number) {
    const prevRecipients = recipients;
    setActionError("");
    setRecipients((prev) => prev.filter((r) => r.id !== id));
    try {
      await deleteAlertRecipient(id);
    } catch {
      setActionError("Couldn't remove that number.");
      setRecipients(prevRecipients);
    }
  }

  return (
    <div>
      <h2
        style={{ fontFamily: "'Barlow Condensed', sans-serif", color: "#EDE3D3", fontSize: 24, fontWeight: 700 }}
        className="mb-1"
      >
        ALERTS
      </h2>
      <p className="text-sm mb-4" style={{ color: "#9C8C79" }}>
        <strong style={{ color: "#EDE3D3" }}>Restock:</strong> a text goes out the moment an item&apos;s status gets
        worse — Stocked to Reorder, or Reorder to Critical. No repeat texts while it just sits at the same status.
      </p>
      <div className="flex items-center gap-2 mb-6 text-sm flex-wrap" style={{ color: "#9C8C79" }}>
        <strong style={{ color: "#EDE3D3" }}>Expiration:</strong>
        <span>text</span>
        <input
          type="number"
          min={1}
          value={expirationAlertDays}
          onChange={(e) => {
            const days = parseInt(e.target.value, 10);
            if (days > 0) onChangeExpirationAlertDays(days);
          }}
          className="w-14 rounded-md border px-2 py-1 font-mono text-center bg-transparent focus:outline-none"
          style={{ borderColor: "#5A4A3C", color: "#EDE3D3" }}
        />
        <span>day(s) before a batch expires, once, per batch.</span>
      </div>
      <p className="text-xs font-mono uppercase tracking-widest mb-3" style={{ color: "#6E6153" }}>
        Sent to
      </p>

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
          <div className="rounded-lg border p-4 mb-4" style={{ borderColor: "#3A2F27" }}>
            <label className="flex flex-col gap-1 text-xs font-mono mb-3" style={{ color: "#9C8C79" }}>
              Phone number
              <input
                type="tel"
                placeholder="+15551234567"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                className="rounded-md border px-3 py-2 font-mono bg-transparent focus:outline-none"
                style={{ borderColor: "#5A4A3C", color: "#EDE3D3" }}
              />
            </label>

            <label className="flex items-start gap-2 text-xs mb-4 cursor-pointer" style={{ color: "#9C8C79" }}>
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                className="mt-0.5 shrink-0"
              />
              <span>
                I agree to receive automated text alerts about my inventory (restock and expiration alerts) from
                GroundWorks Inventory. Message frequency varies. Msg &amp; data rates may apply. Reply STOP to a
                text to opt out, HELP for help. See our{" "}
                <a
                  href="https://docs.google.com/document/d/1WK9vGoqY49YQFDl4zjIQtq6P8kvLiZ0eHYV5ob_gxTg/edit?usp=sharing"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                  style={{ color: "#EDE3D3" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  Privacy Policy
                </a>{" "}
                and{" "}
                <a
                  href="https://docs.google.com/document/d/13gFfxhpodBltWpfNRV7bia5ub1qq5VmX-ngS2eV1wCk/edit?usp=sharing"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                  style={{ color: "#EDE3D3" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  Terms
                </a>
                .
              </span>
            </label>

            <button
              onClick={handleAdd}
              disabled={adding || !newPhone.trim() || !consentChecked}
              className="px-4 py-2 rounded-md text-sm font-mono font-semibold flex items-center gap-1.5 disabled:opacity-40"
              style={{ backgroundColor: "#C1663B", color: "#1B1512" }}
            >
              <Plus size={14} /> {adding ? "Signing up…" : "Yes, sign me up!"}
            </button>
          </div>

          {actionError && (
            <div className="text-xs font-mono mb-4" style={{ color: "#B0492F" }}>
              {actionError}
            </div>
          )}

          {recipients.length === 0 ? (
            <p className="text-sm" style={{ color: "#9C8C79" }}>
              No recipients yet — add a phone number above to start getting restock texts.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {recipients.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between rounded-lg border px-4 py-3"
                  style={{ borderColor: "#3A2F27" }}
                >
                  <span className="font-mono text-sm" style={{ color: "#EDE3D3" }}>
                    {r.phone}
                  </span>
                  <button onClick={() => handleRemove(r.id)} style={{ color: "#6E6153" }} aria-label="Remove">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
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
  const isDemoShop = shop.id === DEMO_SHOP_ID;
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  // Perishable expiration batches — NOT related to `mode === "batch"`
  // (Closing Count) or `batchDraft` below, which are an unrelated older
  // use of the word "batch" for the walk-the-storage-room recount flow.
  const [perishableBatches, setPerishableBatches] = useState<Batch[]>([]);
  const [page, setPage] = useState<Page>("update");
  const [mode, setMode] = useState<Mode>("quick");
  const [batchDraft, setBatchDraft] = useState<Record<number, number | "">>({});
  const [showAdd, setShowAdd] = useState(false);
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [addingStockId, setAddingStockId] = useState<number | null>(null);
  const [editingBatchesItemId, setEditingBatchesItemId] = useState<number | null>(null);
  // Cosmetic only (see displayQuantity/displayThreshold) — initialized from
  // the shop's saved preference, persisted on change via updateDisplayMode.
  const [displayMode, setDisplayMode] = useState<DisplayMode>(shop.displayMode);
  // Days-before-expiration lead time for the batch alert text — same
  // pattern as displayMode, persisted via updateExpirationAlertDays.
  const [expirationAlertDays, setExpirationAlertDays] = useState(shop.expirationAlertDays);
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
        const [fetchedItems, fetchedMenuItems, fetchedBatches] = await Promise.all([
          fetchItems(shop.id),
          fetchMenuItems(shop.id),
          fetchBatchesForShop(shop.id),
        ]);
        if (cancelled) return;
        setItems(fetchedItems);
        setMenuItems(fetchedMenuItems);
        setPerishableBatches(fetchedBatches);
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

  // Best-effort refresh of the perishable batch list after something may
  // have trimmed it server-side (consume_batches_fifo). Not wrapped around
  // the action that triggered it — the count change already succeeded and
  // is the source of truth either way; worst case the batch breakdown just
  // doesn't reflect the trim until the next reload.
  async function refreshBatches() {
    try {
      setPerishableBatches(await fetchBatchesForShop(shop.id));
    } catch {
      // see comment above
    }
  }

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
      return;
    }
    // Separate from the try/catch above on purpose — the count save
    // already succeeded and is the source of truth regardless of whether
    // this secondary trim works, so a failure here must never trigger the
    // "couldn't save, roll back" path above.
    const consumed = current.count - nextCount;
    if (consumed > 0) {
      try {
        await consumeBatchesFIFO(id, consumed);
        await refreshBatches();
      } catch {
        // best-effort — see refreshBatches
      }
    }
  }

  // Add Stock: adds to the current count rather than replacing it — the
  // "just got a shipment in" flow. nativeAmount is already converted to
  // the item's tracked unit by AddStockForm (handles a different package
  // size than what's stocked, e.g. 32oz cartons when tracking in 16oz).
  // batchExpiresOn is set only when adding as a tracked batch rather than
  // plain individual units — see AddStockForm.
  async function addStock(id: number, nativeAmount: number, batchExpiresOn?: string) {
    const current = items.find((i) => i.id === id);
    if (!current) return;
    const nextCount = current.count + nativeAmount;
    setActionError("");
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, count: nextCount } : i)));
    setBatchDraft((prev) => ({ ...prev, [id]: nextCount }));
    setAddingStockId(null);
    try {
      await withSaving(() => updateItemCount(id, nextCount));
    } catch {
      setActionError("Couldn't save that addition — reload to see the last saved count.");
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, count: current.count } : i)));
      return;
    }
    if (batchExpiresOn) {
      try {
        const inserted = await withSaving(() => insertBatch(id, nativeAmount, batchExpiresOn));
        setPerishableBatches((prev) => [...prev, inserted].sort((a, b) => a.expiresOn.localeCompare(b.expiresOn)));
      } catch {
        // The count already saved correctly above — this only means the
        // expiration won't be tracked for this addition. Worth surfacing,
        // since unlike the FIFO trim above, the user explicitly asked for
        // this specific batch to be tracked.
        setActionError("Stock was added, but the expiration date couldn't be saved. You can add it from Batches.");
      }
    }
  }

  // Every one of these three touches BOTH batches and items.count, which
  // are two separate tables/writes — unlike consumeBatchesFIFO (a single
  // atomic RPC), there's no way to make this one round trip, so each
  // function persists items.count via updateItemCount explicitly rather
  // than relying on the optimistic setItems() call alone. (A real bug
  // shipped briefly without this: the UI looked right until a reload,
  // because setItems() only ever updated local state — nothing here was
  // actually writing the new count to the database.)

  async function addBatch(itemId: number, quantity: number, expiresOn: string) {
    const current = items.find((i) => i.id === itemId);
    if (!current) return;
    const nextCount = current.count + quantity;
    setActionError("");
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, count: nextCount } : i)));
    setBatchDraft((prev) => ({ ...prev, [itemId]: nextCount }));
    try {
      await withSaving(() => updateItemCount(itemId, nextCount));
    } catch {
      setActionError("Couldn't add that batch. Try again.");
      setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, count: current.count } : i)));
      setBatchDraft((prev) => ({ ...prev, [itemId]: current.count }));
      return;
    }
    try {
      const inserted = await withSaving(() => insertBatch(itemId, quantity, expiresOn));
      setPerishableBatches((prev) => [...prev, inserted].sort((a, b) => a.expiresOn.localeCompare(b.expiresOn)));
    } catch {
      setActionError("Stock was added, but the expiration date couldn't be saved. Try adding the batch again.");
    }
  }

  async function editBatch(id: number, patch: { quantity?: number; expiresOn?: string }) {
    const prevBatches = perishableBatches;
    const batch = perishableBatches.find((b) => b.id === id);
    if (!batch) return;
    const item = items.find((i) => i.id === batch.itemId);
    if (!item) return;
    const quantityDelta = patch.quantity !== undefined ? patch.quantity - batch.quantity : 0;
    const nextCount = Math.max(0, item.count + quantityDelta);

    setActionError("");
    setPerishableBatches((prev) =>
      prev
        .map((b) => (b.id === id ? { ...b, ...patch } : b))
        .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))
    );
    if (quantityDelta !== 0) {
      setItems((prev) => prev.map((i) => (i.id === batch.itemId ? { ...i, count: nextCount } : i)));
    }
    try {
      await withSaving(() => updateBatch(id, patch));
      if (quantityDelta !== 0) {
        await withSaving(() => updateItemCount(batch.itemId, nextCount));
      }
    } catch {
      setActionError("Couldn't save changes to that batch.");
      setPerishableBatches(prevBatches);
      if (quantityDelta !== 0) {
        setItems((prev) => prev.map((i) => (i.id === batch.itemId ? { ...i, count: item.count } : i)));
      }
    }
  }

  async function removeBatch(id: number) {
    const prevBatches = perishableBatches;
    const batch = perishableBatches.find((b) => b.id === id);
    if (!batch) return;
    const item = items.find((i) => i.id === batch.itemId);
    if (!item) return;
    const nextCount = Math.max(0, item.count - batch.quantity);

    setActionError("");
    setPerishableBatches((prev) => prev.filter((b) => b.id !== id));
    setItems((prev) => prev.map((i) => (i.id === batch.itemId ? { ...i, count: nextCount } : i)));
    try {
      await withSaving(() => deleteBatchRow(id));
      await withSaving(() => updateItemCount(batch.itemId, nextCount));
    } catch {
      setActionError("Couldn't remove that batch.");
      setPerishableBatches(prevBatches);
      setItems((prev) => prev.map((i) => (i.id === batch.itemId ? { ...i, count: item.count } : i)));
    }
  }

  async function changeExpirationAlertDays(days: number) {
    setExpirationAlertDays(days);
    try {
      await updateExpirationAlertDays(shop.id, days);
    } catch {
      // Cosmetic-ish preference, same reasoning as changeDisplayMode.
    }
  }

  async function changeDisplayMode(next: DisplayMode) {
    setDisplayMode(next);
    try {
      await updateDisplayMode(shop.id, next);
    } catch {
      // Cosmetic preference — worth trying again, not worth blocking or
      // erroring the whole dashboard over. It'll just reset to the saved
      // value next reload if this silently didn't persist.
    }
  }

  function changeBatchDraft(id: number, value: number | "") {
    setBatchDraft((prev) => ({ ...prev, [id]: value === "" ? "" : Math.max(0, value) }));
  }

  // A blank draft (mid-edit, backspaced out) resolves back to the item's
  // last saved count — never to 0 — so leaving a field empty can't
  // accidentally zero out real inventory on save.
  function resolveBatchCount(item: InventoryItem): number {
    const draft = batchDraft[item.id];
    return draft === "" || draft === undefined ? item.count : draft;
  }

  function enterBatchMode() {
    setBatchDraft(Object.fromEntries(items.map((i) => [i.id, i.count])));
    setMode("batch");
  }

  async function saveBatch() {
    const changed = items
      .map((i) => ({ id: i.id, count: resolveBatchCount(i) }))
      .filter((u) => items.find((i) => i.id === u.id)!.count !== u.count);

    setActionError("");
    setItems((prev) => prev.map((i) => ({ ...i, count: resolveBatchCount(i) })));
    setMode("quick");

    try {
      await withSaving(() => updateItemCounts(changed));
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2200);
    } catch {
      setActionError("Couldn't save the closing count. Try again.");
      return;
    }
    // Only decreases trim batches (FIFO) — a recount that comes in higher
    // than expected goes to the untracked pool, same as Add Stock's
    // "individual units" path, since a plain recount doesn't say which
    // batch (if any) the extra belongs to.
    const decreases = changed
      .map((u) => ({ id: u.id, decrease: items.find((i) => i.id === u.id)!.count - u.count }))
      .filter((d) => d.decrease > 0);
    if (decreases.length > 0) {
      try {
        await Promise.all(decreases.map((d) => consumeBatchesFIFO(d.id, d.decrease)));
        await refreshBatches();
      } catch {
        // best-effort — see refreshBatches
      }
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

  function jumpToEdit(id: number) {
    setPage("update");
    setMode("quick");
    setEditingItemId(id);
  }

  async function saveItemEdit(id: number, patch: Omit<InventoryItem, "id">) {
    const prevItems = items;
    setActionError("");
    setItems((prev) => prev.map((i) => (i.id === id ? { ...patch, id } : i)));
    try {
      const updated = await withSaving(() => updateItem(id, patch));
      setItems((prev) => prev.map((i) => (i.id === id ? updated : i)));
      setBatchDraft((prev) => ({ ...prev, [id]: updated.count }));
      setEditingItemId(null);
    } catch {
      setActionError("Couldn't save changes to that item.");
      setItems(prevItems);
    }
  }

  async function deleteItem(id: number) {
    if (typeof window !== "undefined" && !window.confirm("Delete this item? This can't be undone.")) {
      return;
    }
    const prevItems = items;
    setActionError("");
    setItems((prev) => prev.filter((i) => i.id !== id));
    try {
      await withSaving(() => deleteItemRow(id));
      setEditingItemId(null);
    } catch {
      setActionError("Couldn't delete that item — it may still be used in a recipe.");
      setItems(prevItems);
    }
  }

  async function addMenuItem(name: string, firstIngredient: { itemId: number; amount: number }) {
    setActionError("");
    try {
      const inserted = await withSaving(() => insertMenuItem(shop.id, name, firstIngredient));
      setMenuItems((prev) => [...prev, inserted]);
    } catch (err) {
      // 23505 = unique_violation — the menu_items(shop_id, lower(name))
      // index (see supabase/009_menu_item_name_uniqueness.sql) catching a
      // duplicate the in-form check above missed, e.g. two tabs submitting
      // the same name at once.
      const isDuplicate = typeof err === "object" && err !== null && "code" in err && err.code === "23505";
      setActionError(
        isDuplicate ? `You already have a recipe named "${name}".` : "Couldn't create that menu item. Try again."
      );
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
      return;
    }
    // Sales always deduct (never add), so every update here is a decrease
    // — trim the oldest-expiring batch(es) for each affected item to match.
    try {
      await Promise.all(updates.map((u) => consumeBatchesFIFO(u.id, deltaByItemId[u.id])));
      await refreshBatches();
    } catch {
      // best-effort — see refreshBatches
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
            className="flex items-center gap-1 p-1 rounded-lg border overflow-x-auto max-w-full"
            style={{ borderColor: "#3A2F27", backgroundColor: "#1F1712" }}
          >
            <button
              onClick={() => setPage("update")}
              className="px-3 sm:px-4 py-2 rounded-md text-sm font-mono flex items-center justify-center gap-2 transition-colors shrink-0"
              style={{
                backgroundColor: page === "update" ? "#2A211C" : "transparent",
                color: page === "update" ? "#EDE3D3" : "#6E6153",
              }}
            >
              <PencilLine size={14} /> <span className="hidden sm:inline">Update</span>
            </button>
            <button
              onClick={() => setPage("spreadsheet")}
              className="px-3 sm:px-4 py-2 rounded-md text-sm font-mono flex items-center justify-center gap-2 transition-colors shrink-0"
              style={{
                backgroundColor: page === "spreadsheet" ? "#2A211C" : "transparent",
                color: page === "spreadsheet" ? "#EDE3D3" : "#6E6153",
              }}
            >
              <Table2 size={14} /> <span className="hidden sm:inline">Spreadsheet</span>
            </button>
            <button
              onClick={() => setPage("recipes")}
              className="px-3 sm:px-4 py-2 rounded-md text-sm font-mono flex items-center justify-center gap-2 transition-colors shrink-0"
              style={{
                backgroundColor: page === "recipes" ? "#2A211C" : "transparent",
                color: page === "recipes" ? "#EDE3D3" : "#6E6153",
              }}
            >
              {tier === "standard" ? <Lock size={14} /> : <BookOpen size={14} />}{" "}
              <span className="hidden sm:inline">Recipes</span>
            </button>
            <button
              onClick={() => setPage("alerts")}
              className="px-3 sm:px-4 py-2 rounded-md text-sm font-mono flex items-center justify-center gap-2 transition-colors shrink-0"
              style={{
                backgroundColor: page === "alerts" ? "#2A211C" : "transparent",
                color: page === "alerts" ? "#EDE3D3" : "#6E6153",
              }}
            >
              <Bell size={14} /> <span className="hidden sm:inline">Alerts</span>
            </button>
          </div>

          <div className="flex items-center gap-3">
            <div
              className="flex items-center gap-1 p-1 rounded-lg border w-fit"
              style={{ borderColor: "#3A2F27", backgroundColor: "#1F1712" }}
              title="How quantities are shown — count of units, or a converted total amount"
            >
              <button
                onClick={() => changeDisplayMode("count")}
                className="px-3 py-1.5 rounded-md text-xs font-mono transition-colors"
                style={{
                  backgroundColor: displayMode === "count" ? "#2A211C" : "transparent",
                  color: displayMode === "count" ? "#EDE3D3" : "#6E6153",
                }}
              >
                Count
              </button>
              <button
                onClick={() => changeDisplayMode("measurement")}
                className="px-3 py-1.5 rounded-md text-xs font-mono transition-colors"
                style={{
                  backgroundColor: displayMode === "measurement" ? "#2A211C" : "transparent",
                  color: displayMode === "measurement" ? "#EDE3D3" : "#6E6153",
                }}
              >
                Amount
              </button>
            </div>

            {isDemoShop ? (
              <div
                className="px-3 py-1.5 rounded-full text-[11px] font-mono border"
                style={{ borderColor: "#3A2F27", color: "#6E6153" }}
              >
                ★ Pro plan · Demo mode — billing disabled
              </div>
            ) : (
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
            )}
          </div>
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

        {editingItemId !== null &&
          (() => {
            const editingItem = items.find((i) => i.id === editingItemId);
            if (!editingItem) return null;
            return (
              <EditItemForm
                item={editingItem}
                onSave={saveItemEdit}
                onCancel={() => setEditingItemId(null)}
                onDelete={deleteItem}
              />
            );
          })()}

        {addingStockId !== null &&
          (() => {
            const stockItem = items.find((i) => i.id === addingStockId);
            if (!stockItem) return null;
            return <AddStockForm item={stockItem} onAdd={addStock} onCancel={() => setAddingStockId(null)} />;
          })()}

        {editingBatchesItemId !== null &&
          (() => {
            const batchItem = items.find((i) => i.id === editingBatchesItemId);
            if (!batchItem) return null;
            return (
              <BatchEditor
                item={batchItem}
                batches={perishableBatches.filter((b) => b.itemId === batchItem.id)}
                onAddBatch={addBatch}
                onEditBatch={editBatch}
                onDeleteBatch={removeBatch}
                onClose={() => setEditingBatchesItemId(null)}
              />
            );
          })()}

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
              <div className="flex items-center gap-2 mb-3">
                <Icon size={16} style={{ color: "#C1663B" }} />
                <h2
                  className="font-semibold uppercase tracking-wide text-sm"
                  style={{ color: "#EDE3D3", fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: "0.08em" }}
                >
                  {cat.label}
                </h2>
              </div>
              <div>
                {catItems.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    mode={mode}
                    displayMode={displayMode}
                    batches={perishableBatches.filter((b) => b.itemId === item.id)}
                    onAdjust={adjustQuick}
                    onBatchChange={changeBatchDraft}
                    batchValue={batchDraft[item.id] ?? item.count}
                    onEdit={jumpToEdit}
                    onAddStock={setAddingStockId}
                    onEditBatches={setEditingBatchesItemId}
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
          <SpreadsheetView items={items} displayMode={displayMode} onEdit={jumpToEdit} />
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

        {page === "alerts" && (
          <AlertsPage
            shopId={shop.id}
            expirationAlertDays={expirationAlertDays}
            onChangeExpirationAlertDays={changeExpirationAlertDays}
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
            <div className="rounded-lg border overflow-x-auto mb-8" style={{ borderColor: "#3A2F27" }}>
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
              <div className="rounded-lg border overflow-x-auto" style={{ borderColor: "#3A2F27" }}>
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
        .select("id, name, tier, display_mode, expiration_alert_days")
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

      setShop({
        id: data.id,
        name: data.name,
        tier: data.tier,
        displayMode: (data.display_mode as DisplayMode | null) ?? "count",
        expirationAlertDays: (data.expiration_alert_days as number | null) ?? 3,
      });
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
