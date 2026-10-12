"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
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
  ChevronDown,
  ShoppingCart,
  Unlock,
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
import Link from "next/link";
import { buildOrderList, orderText } from "@/lib/order-list";
import { formatPhone, normalizePhone } from "@/lib/phone";
import {
  parseSalesText,
  matchRecipe,
  computeDeductions,
  fingerprintRows,
  normalizeName,
  type ParseResult,
  type ColumnChoice,
  type Match,
} from "@/lib/sales-import";
import { DEMO_SHOP_ID, DEMO_EMAIL, DEMO_PASSWORD } from "@/lib/demo";
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
  fetchOrderMarks,
  saveOrderMarks,
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
  good: { label: "Stocked", stamp: "STOCKED", color: "var(--gw-ok)" },
  low: { label: "Reorder Soon", stamp: "REORDER", color: "var(--gw-warn)" },
  critical: { label: "Critical", stamp: "CRITICAL", color: "var(--gw-danger-text)" },
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

// "gallon" -> "gallons" for a sentence like "How many gallons came in?". Units are
// whatever the shop typed, so leave anything already ending in s alone.
function manyOf(unit: string): string {
  return unit.endsWith("s") ? unit : `${unit}s`;
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

function formatShortDate(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
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

// The number between − and +. Tap it to type an exact count (2.5 gallons, or a
// whole recount) instead of tapping + many times. In Measure view you type the
// total in oz/pumps/cups and it's converted back to the item's own unit.
function QuickCount({
  item,
  qty,
  showingMeasurement,
  onSet,
}: {
  item: InventoryItem;
  qty: { amount: string; label: string };
  showingMeasurement: boolean;
  onSet: (id: number, nativeCount: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const cancelled = useRef(false);

  function commit() {
    setEditing(false);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const parsed = parseFloat(draft);
    if (draft.trim() === "" || Number.isNaN(parsed) || parsed < 0) return;
    const native = showingMeasurement && item.unitSize ? parsed / item.unitSize : parsed;
    if (Math.abs(native - item.count) < 1e-9) return;
    onSet(item.id, native);
  }

  if (editing) {
    return (
      <div className="font-mono text-center" style={{ color: "var(--gw-text)", minWidth: 48 }}>
        <input
          type="number"
          inputMode="decimal"
          step="any"
          min={0}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              cancelled.current = true;
              e.currentTarget.blur();
            }
          }}
          aria-label={`Type the count for ${item.name}`}
          className="w-12 px-0 text-lg text-center rounded-md border py-1 bg-transparent focus:outline-none"
          style={{ borderColor: "var(--gw-accent)", color: "var(--gw-text)" }}
        />
        <div className="text-[11px] uppercase tracking-wide" style={{ color: "var(--gw-text-3)" }}>
          {qty.label}
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(qty.amount);
        setEditing(true);
      }}
      aria-label={`Type a count for ${item.name}`}
      className="font-mono text-center min-h-11"
      style={{ color: "var(--gw-text)", minWidth: 48 }}
    >
      <div className="text-lg leading-tight underline decoration-dotted underline-offset-4" style={{ textDecorationColor: "var(--gw-text-3)" }}>
        {qty.amount}
      </div>
      <div className="text-[11px] uppercase tracking-wide" style={{ color: "var(--gw-text-3)" }}>
        {qty.label}
      </div>
    </button>
  );
}


// A small action under an item with its name written out (an icon alone makes a
// barista guess), and a tap target big enough for a gloved or wet thumb.
function RowAction({
  Icon,
  label,
  ariaLabel,
  onClick,
}: {
  Icon: LucideIcon;
  label: string;
  ariaLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={ariaLabel}
      className="flex flex-col items-center justify-center gap-1 min-w-[48px] h-12 px-1 rounded-lg border shrink-0 hover:brightness-125"
      style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text-2)" }}
    >
      <Icon size={15} />
      <span className="text-[10px] font-mono leading-none">{label}</span>
    </button>
  );
}

// When a panel opens under an item, bring it into view: on a long list the
// panel can otherwise open off-screen and look like the tap did nothing.
function ScrollIntoView({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);
  return <div ref={ref}>{children}</div>;
}

interface ItemRowProps {
  item: InventoryItem;
  mode: Mode;
  displayMode: DisplayMode;
  batches: Batch[];
  onAdjust: (id: number, delta: number) => void;
  onSetCount: (id: number, nativeCount: number) => void;
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
  onSetCount,
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
  const qty = displayQuantity(item, displayMode, item.count);
  // Same condition displayQuantity uses to decide whether Amount mode
  // actually applies to this item (some items have no unitSize/unitMeasure
  // set, so Amount mode has nothing to convert to and falls back to Count).
  const showingMeasurement = displayMode === "measurement" && !!item.unitSize && !!item.unitMeasure;
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
      style={{ borderColor: "var(--gw-border)" }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <StatusStamp status={status} />

        <div className="flex-1 min-w-0">
          <div className="font-semibold" style={{ color: "var(--gw-text)", fontFamily: "var(--font-display)", fontSize: 19, letterSpacing: "0.01em" }}>
            {item.name.toUpperCase()}
          </div>
          <div className="font-mono text-xs mt-0.5" style={{ color: "var(--gw-text-2)" }}>
            Reorder at {displayThreshold(item, displayMode)}
          </div>
          {item.unitSize ? (
            <div className="font-mono text-[11px] mt-0.5" style={{ color: "var(--gw-text-3)" }}>
              1 {item.unit.replace(/s$/, "")} = {item.unitSize} {item.unitMeasure}
            </div>
          ) : null}
          {nearestBatch && (
            <div
              className="font-mono text-[11px] mt-0.5 flex items-center gap-1"
              style={{ color: daysUntilDate(nearestBatch.expiresOn) <= 3 ? "var(--gw-warn)" : "var(--gw-text-3)" }}
            >
              <CalendarClock size={10} />
              {batches.length === 1 ? "1 batch" : `${batches.length} batches`} ·{" "}
              {formatDaysUntil(daysUntilDate(nearestBatch.expiresOn))}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {mode === "quick" ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => onAdjust(item.id, -1)}
              className="w-11 h-11 rounded-full flex items-center justify-center border transition-colors hover:brightness-125 shrink-0"
              style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
              aria-label={`Decrease ${item.name}`}
            >
              <Minus size={16} />
            </button>
            <QuickCount item={item} qty={qty} showingMeasurement={showingMeasurement} onSet={onSetCount} />
            <button
              onClick={() => onAdjust(item.id, 1)}
              className="w-11 h-11 rounded-full flex items-center justify-center border transition-colors hover:brightness-125 shrink-0"
              style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
              aria-label={`Increase ${item.name}`}
            >
              <Plus size={16} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={0}
              step={showingMeasurement ? "0.01" : "1"}
              // batchValue is always stored in the item's native stocking
              // unit (what saveBatch/resolveBatchCount compare against
              // item.count) — in Amount mode we convert it to the
              // measurement unit just for display, same conversion
              // displayQuantity does for Quick Log's number.
              value={batchValue === "" ? "" : showingMeasurement ? trimNumber(batchValue * item.unitSize!) : batchValue}
              // Blank stays blank instead of snapping to 0 — forcing a "0" into
              // a controlled number input is what caused the next keystroke to
              // land in front of it (typing "5" against a displayed "0" gives
              // "05"). parseFloat (not parseInt) so a fractional closing count
              // like "2.5" isn't silently truncated to 2.
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "") {
                  onBatchChange(item.id, "");
                  return;
                }
                const parsed = parseFloat(raw);
                if (Number.isNaN(parsed)) return;
                // Convert back to the native stocking unit before storing,
                // so a Closing Count typed in Amount mode still saves as
                // the same native count Quick Log and everything else uses.
                onBatchChange(item.id, Math.max(0, showingMeasurement ? parsed / item.unitSize! : parsed));
              }}
              className="w-20 font-mono text-lg text-center rounded-md border py-1.5 bg-transparent focus:outline-none focus:ring-2"
              style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
            />
            <span className="text-[11px] uppercase tracking-wide" style={{ color: "var(--gw-text-3)" }}>
              {showingMeasurement ? item.unitMeasure : item.unit}
            </span>
          </div>
        )}

        <div className="flex items-center gap-1 shrink-0">
          <RowAction Icon={PackagePlus} label="Delivery" ariaLabel={`Add stock for ${item.name}`} onClick={() => onAddStock(item.id)} />
          {isPerishable && (
            <RowAction Icon={CalendarClock} label="Expiry" ariaLabel={`Manage batches for ${item.name}`} onClick={() => onEditBatches(item.id)} />
          )}
          <RowAction Icon={PencilLine} label="Edit" ariaLabel={`Edit ${item.name}`} onClick={() => onEdit(item.id)} />
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
  const [threshold, setThreshold] = useState<number | "">(3);
  const [count, setCount] = useState<number | "">(0);
  const [category, setCategory] = useState<CategoryId>("dry");
  const [unitSize, setUnitSize] = useState("");
  const [unitMeasure, setUnitMeasure] = useState("");

  return (
    <div className="rounded-lg border p-5 mb-6" style={{ borderColor: "var(--gw-border-strong)", backgroundColor: "var(--gw-surface-raised)" }}>
      <div className="font-mono text-xs uppercase tracking-widest mb-4" style={{ color: "var(--gw-accent-text)" }}>
        New Stock Item
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <input
          placeholder="Item name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="col-span-2 rounded-md border px-3 py-2 bg-transparent focus:outline-none"
          style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
        />
        <input
          placeholder="Stocking unit (e.g. carton, bag)"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          className="rounded-md border px-3 py-2 bg-transparent focus:outline-none"
          style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as CategoryId)}
          className="rounded-md border px-3 py-2 bg-transparent focus:outline-none"
          style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
        >
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id} style={{ color: "#000" }}>
              {c.label}
            </option>
          ))}
        </select>
        <label className="flex flex-col gap-1 text-xs font-mono" style={{ color: "var(--gw-text-2)" }}>
          Starting count
          <input
            type="number"
            value={count}
            // Blank stays blank instead of snapping to 0 — forcing "0" into
            // a controlled number input is what causes the next keystroke
            // to land in front of it (typing "5" against a displayed "0"
            // gives "05"). Resolved back to 0 only at submit time.
            onChange={(e) => setCount(e.target.value === "" ? "" : parseInt(e.target.value, 10))}
            className="rounded-md border px-3 py-2 bg-transparent focus:outline-none"
            style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-mono" style={{ color: "var(--gw-text-2)" }}>
          Reorder threshold
          <input
            type="number"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value === "" ? "" : parseInt(e.target.value, 10))}
            className="rounded-md border px-3 py-2 bg-transparent focus:outline-none"
            style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-mono" style={{ color: "var(--gw-text-2)" }}>
          Amount per unit
          <input
            type="number"
            step="0.1"
            placeholder="e.g. 32"
            value={unitSize}
            onChange={(e) => setUnitSize(e.target.value)}
            className="rounded-md border px-3 py-2 bg-transparent focus:outline-none"
            style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-mono" style={{ color: "var(--gw-text-2)" }}>
          Measure (oz, pumps, cups…)
          <input
            placeholder="e.g. oz"
            value={unitMeasure}
            onChange={(e) => setUnitMeasure(e.target.value)}
            className="rounded-md border px-3 py-2 bg-transparent focus:outline-none"
            style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
          />
        </label>
      </div>
      <p className="text-[11px] font-mono mb-3" style={{ color: "var(--gw-text-3)" }}>
        &quot;Amount per unit&quot; + &quot;Measure&quot; are optional, but required if you want this item usable in a Recipe (Pro).
        E.g. a carton of oat milk might be 32 oz, so 1 carton = 32 oz.
      </p>
      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-md text-sm font-mono flex items-center gap-1.5 border"
          style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text-2)" }}
        >
          <X size={14} /> Cancel
        </button>
        <button
          onClick={() => {
            if (!name.trim()) return;
            onAdd({
              name: name.trim(),
              unit: unit.trim() || "units",
              count: count === "" ? 0 : count,
              threshold: threshold === "" ? 0 : threshold,
              category,
              unitSize: unitSize === "" ? null : parseFloat(unitSize),
              unitMeasure: unitMeasure.trim() || null,
            });
          }}
          className="px-4 py-2 rounded-md text-sm font-mono flex items-center gap-1.5 font-semibold"
          style={{ backgroundColor: "var(--gw-accent)", color: "var(--gw-bg)" }}
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
  const [threshold, setThreshold] = useState<number | "">(item.threshold);
  const [count, setCount] = useState<number | "">(item.count);
  const [category, setCategory] = useState<CategoryId>(item.category);
  const [unitSize, setUnitSize] = useState(item.unitSize === null ? "" : String(item.unitSize));
  const [unitMeasure, setUnitMeasure] = useState(item.unitMeasure ?? "");

  return (
    <div className="rounded-lg border p-5 mb-6" style={{ borderColor: "var(--gw-border-strong)", backgroundColor: "var(--gw-surface-raised)" }}>
      <div className="font-mono text-xs uppercase tracking-widest mb-4" style={{ color: "var(--gw-accent-text)" }}>
        Edit {item.name}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <input
          placeholder="Item name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="col-span-2 rounded-md border px-3 py-2 bg-transparent focus:outline-none"
          style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
        />
        <input
          placeholder="Stocking unit (e.g. carton, bag)"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          className="rounded-md border px-3 py-2 bg-transparent focus:outline-none"
          style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as CategoryId)}
          className="rounded-md border px-3 py-2 bg-transparent focus:outline-none"
          style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
        >
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id} style={{ color: "#000" }}>
              {c.label}
            </option>
          ))}
        </select>
        <label className="flex flex-col gap-1 text-xs font-mono" style={{ color: "var(--gw-text-2)" }}>
          Count
          <input
            type="number"
            value={count}
            // Blank stays blank instead of snapping to 0 (see AddItemForm)
            // — resolved back to the item's real count only at save time,
            // never destructively defaulting a real item's stock to zero.
            onChange={(e) => setCount(e.target.value === "" ? "" : parseInt(e.target.value, 10))}
            className="rounded-md border px-3 py-2 bg-transparent focus:outline-none"
            style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-mono" style={{ color: "var(--gw-text-2)" }}>
          Reorder threshold
          <input
            type="number"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value === "" ? "" : parseInt(e.target.value, 10))}
            className="rounded-md border px-3 py-2 bg-transparent focus:outline-none"
            style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-mono" style={{ color: "var(--gw-text-2)" }}>
          Amount per unit
          <input
            type="number"
            step="0.1"
            placeholder="e.g. 32"
            value={unitSize}
            onChange={(e) => setUnitSize(e.target.value)}
            className="rounded-md border px-3 py-2 bg-transparent focus:outline-none"
            style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-mono" style={{ color: "var(--gw-text-2)" }}>
          Measure (oz, pumps, cups…)
          <input
            placeholder="e.g. oz"
            value={unitMeasure}
            onChange={(e) => setUnitMeasure(e.target.value)}
            className="rounded-md border px-3 py-2 bg-transparent focus:outline-none"
            style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
          />
        </label>
      </div>
      <div className="flex gap-2 justify-between">
        <button
          onClick={() => onDelete(item.id)}
          className="px-4 py-2 rounded-md text-sm font-mono flex items-center gap-1.5 border"
          style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-danger-text)" }}
        >
          <Trash2 size={14} /> Delete
        </button>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-md text-sm font-mono flex items-center gap-1.5 border"
            style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text-2)" }}
          >
            <X size={14} /> Cancel
          </button>
          <button
            onClick={() => {
              if (!name.trim()) return;
              onSave(item.id, {
                name: name.trim(),
                unit: unit.trim() || "units",
                count: count === "" ? item.count : count,
                threshold: threshold === "" ? item.threshold : threshold,
                category,
                unitSize: unitSize === "" ? null : parseFloat(unitSize),
                unitMeasure: unitMeasure.trim() || null,
              });
            }}
            className="px-4 py-2 rounded-md text-sm font-mono flex items-center gap-1.5 font-semibold"
            style={{ backgroundColor: "var(--gw-accent)", color: "var(--gw-bg)" }}
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
  onAdd: (id: number, nativeAmount: number, batchExpiresOn?: string, batchLabel?: string) => void;
  onCancel: () => void;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function AddStockForm({ item, onAdd, onCancel }: AddStockFormProps) {
  const [qty, setQty] = useState<number | "">(1);
  const [size, setSize] = useState(item.unitSize === null ? "" : String(item.unitSize));
  // The size of each delivered unit is almost always the usual one, so the
  // field stays out of the way unless this delivery is a different size.
  const [showSize, setShowSize] = useState(false);
  // Perishables only — "just add" behaves exactly as before (plain count
  // bump); "with expiry date" also creates a tracked batch row, used oldest
  // expiry first ahead of the untracked pool.
  const [asBatch, setAsBatch] = useState(false);
  const [expiresOn, setExpiresOn] = useState(todayISO());
  const [label, setLabel] = useState("");

  const isPerishable = item.category === "perishable";
  const hasSize = item.unitSize !== null && !!item.unitMeasure;
  const one = item.unit.replace(/s$/, "");
  const qtyNum = qty === "" ? 0 : qty;
  const sizeNum = parseFloat(size) || 0;
  const sizeDiffers = hasSize && sizeNum > 0 && sizeNum !== item.unitSize;
  const nativeAdd = hasSize && sizeNum > 0 && item.unitSize ? (qtyNum * sizeNum) / item.unitSize : qtyNum;
  const canSubmit = nativeAdd > 0 && (!asBatch || !!expiresOn);

  return (
    <div className="rounded-lg border p-5 mb-6" style={{ borderColor: "var(--gw-border-strong)", backgroundColor: "var(--gw-surface-raised)" }}>
      <div className="font-mono text-xs uppercase tracking-widest mb-1" style={{ color: "var(--gw-accent-text)" }}>
        Delivery — {item.name}
      </div>
      <p className="text-xs mb-4" style={{ color: "var(--gw-text-2)" }}>
        Got a delivery? Enter how many {manyOf(item.unit)} came in.
      </p>

      {isPerishable && (
        <div className="flex items-center gap-1 p-1 rounded-lg border overflow-x-auto max-w-full mb-3" style={{ borderColor: "var(--gw-border)" }}>
          <button
            onClick={() => setAsBatch(false)}
            className="px-3 py-2 min-h-11 rounded-md text-xs font-mono transition-colors"
            style={{
              backgroundColor: !asBatch ? "var(--gw-surface-selected)" : "transparent",
              color: !asBatch ? "var(--gw-text)" : "var(--gw-text-3)",
            }}
          >
            Just add to stock
          </button>
          <button
            onClick={() => setAsBatch(true)}
            className="px-3 py-2 min-h-11 rounded-md text-xs font-mono transition-colors flex items-center gap-1.5"
            style={{
              backgroundColor: asBatch ? "var(--gw-surface-selected)" : "transparent",
              color: asBatch ? "var(--gw-text)" : "var(--gw-text-3)",
            }}
          >
            <CalendarClock size={12} /> Add with expiry date
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <label className="flex flex-col gap-1 text-xs font-mono" style={{ color: "var(--gw-text-2)" }}>
          How many {manyOf(item.unit)} came in?
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.1"
            autoFocus
            value={qty}
            onChange={(e) => setQty(e.target.value === "" ? "" : parseFloat(e.target.value))}
            className="rounded-md border px-3 py-2 min-h-11 bg-transparent focus:outline-none"
            style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
          />
        </label>
        {hasSize && showSize && (
          <label className="flex flex-col gap-1 text-xs font-mono" style={{ color: "var(--gw-text-2)" }}>
            Each {one} holds how many {item.unitMeasure}?
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.1"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              className="rounded-md border px-3 py-2 min-h-11 bg-transparent focus:outline-none"
              style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
            />
          </label>
        )}
        {asBatch && (
          <label className="flex flex-col gap-1 text-xs font-mono col-span-2" style={{ color: "var(--gw-text-2)" }}>
            Expires on
            <input
              type="date"
              value={expiresOn}
              onChange={(e) => setExpiresOn(e.target.value)}
              className="rounded-md border px-3 py-2 min-h-11 bg-transparent focus:outline-none"
              style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
            />
          </label>
        )}
        {asBatch && (
          <label className="flex flex-col gap-1 text-xs font-mono col-span-2" style={{ color: "var(--gw-text-2)" }}>
            Note (optional)
            <input
              type="text"
              maxLength={60}
              placeholder="e.g. Tuesday delivery, walk-in"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="rounded-md border px-3 py-2 min-h-11 bg-transparent focus:outline-none"
              style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
            />
          </label>
        )}
      </div>
      {hasSize && !showSize && (
        <button
          type="button"
          onClick={() => setShowSize(true)}
          className="text-xs font-mono underline underline-offset-2 mb-3 min-h-11"
          style={{ color: "var(--gw-text-2)" }}
        >
          Different size this time?
        </button>
      )}
      {sizeDiffers && (
        <p className="text-[11px] font-mono mb-3" style={{ color: "var(--gw-warn)" }}>
          That&apos;s a different size than usual (usual: 1 {one} = {item.unitSize} {item.unitMeasure}), so this adds{" "}
          {trimNumber(nativeAdd)} {item.unit}.
        </p>
      )}
      <p className="text-xs font-mono mb-4" style={{ color: "var(--gw-ok)" }}>
        New total: {trimNumber(item.count + nativeAdd)} {item.unit}
        {asBatch && " · the oldest expiry gets used first"}
      </p>
      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="px-4 py-2 min-h-11 rounded-md text-sm font-mono flex items-center gap-1.5 border"
          style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text-2)" }}
        >
          <X size={14} /> Cancel
        </button>
        <button
          onClick={() =>
            canSubmit &&
            onAdd(item.id, nativeAdd, asBatch ? expiresOn : undefined, asBatch ? label : undefined)
          }
          disabled={!canSubmit}
          className="px-4 py-2 min-h-11 rounded-md text-sm font-mono flex items-center gap-1.5 font-semibold disabled:opacity-40"
          style={{ backgroundColor: "var(--gw-accent)", color: "var(--gw-bg)" }}
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
  isNext: boolean;
  onSave: (patch: { quantity?: number; expiresOn?: string; label?: string | null }) => void;
  onDelete: () => void;
}

function BatchEditorRow({ batch, unit, isNext, onSave, onDelete }: BatchEditorRowProps) {
  const [quantity, setQuantity] = useState(String(batch.quantity));
  const [expiresOn, setExpiresOn] = useState(batch.expiresOn);
  const [label, setLabel] = useState(batch.label ?? "");

  const quantityNum = parseFloat(quantity);
  const dirty =
    (quantity !== "" && quantityNum !== batch.quantity) ||
    expiresOn !== batch.expiresOn ||
    label !== (batch.label ?? "");
  const days = daysUntilDate(batch.expiresOn);

  function save() {
    const patch: { quantity?: number; expiresOn?: string; label?: string | null } = {};
    if (quantity !== "" && quantityNum !== batch.quantity) patch.quantity = Math.max(0, quantityNum);
    if (expiresOn !== batch.expiresOn) patch.expiresOn = expiresOn;
    if (label !== (batch.label ?? "")) patch.label = label.trim() || null;
    if (Object.keys(patch).length > 0) onSave(patch);
  }

  return (
    <div className="rounded-lg border px-3 py-2" style={{ borderColor: isNext ? "var(--gw-ok)" : "var(--gw-border)" }}>
      <div className="flex items-center gap-2 flex-wrap mb-1.5">
        <input
          type="number"
          min={0}
          step="0.1"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          className="w-20 rounded-md border px-2 py-1.5 text-sm font-mono bg-transparent focus:outline-none"
          style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
        />
        <span className="text-xs font-mono" style={{ color: "var(--gw-text-3)" }}>
          {unit}
        </span>
        <input
          type="date"
          value={expiresOn}
          onChange={(e) => setExpiresOn(e.target.value)}
          className="rounded-md border px-2 py-1.5 text-sm font-mono bg-transparent focus:outline-none"
          style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
        />
        <span
          className="text-[11px] font-mono"
          style={{ color: days < 0 ? "var(--gw-danger-text)" : days <= 3 ? "var(--gw-warn)" : "var(--gw-text-3)" }}
        >
          {formatDaysUntil(days)}
        </span>
        {isNext && (
          <span
            className="text-[11px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded"
            style={{ color: "var(--gw-ok)", border: "1px solid var(--gw-ok)" }}
          >
            Use first
          </span>
        )}
        <div className="flex items-center gap-1 ml-auto">
          {dirty && (
            <button
              onClick={save}
              className="text-xs px-2 py-1 rounded border font-mono"
              style={{ borderColor: "var(--gw-ok)", color: "var(--gw-ok)" }}
            >
              Save
            </button>
          )}
          <button onClick={onDelete} style={{ color: "var(--gw-text-3)" }} aria-label="Delete expiry date">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          maxLength={60}
          placeholder="Add a note, e.g. Tuesday delivery"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="flex-1 min-w-0 rounded-md border px-2 py-1.5 text-xs font-mono bg-transparent focus:outline-none"
          style={{ borderColor: "var(--gw-border)", color: "var(--gw-text)" }}
        />
        <span className="text-[11px] font-mono shrink-0" style={{ color: "var(--gw-text-3)" }}>
          added {formatShortDate(batch.createdAt)}
        </span>
      </div>
    </div>
  );
}

interface BatchEditorProps {
  item: InventoryItem;
  batches: Batch[];
  onAddBatch: (itemId: number, quantity: number, expiresOn: string, label?: string) => void;
  onEditBatch: (id: number, patch: { quantity?: number; expiresOn?: string; label?: string | null }) => void;
  onDeleteBatch: (id: number) => void;
  onClose: () => void;
}

function BatchEditor({ item, batches, onAddBatch, onEditBatch, onDeleteBatch, onClose }: BatchEditorProps) {
  const [newQty, setNewQty] = useState<number | "">("");
  const [newExpiresOn, setNewExpiresOn] = useState(todayISO());
  const [newLabel, setNewLabel] = useState("");

  const trackedTotal = batches.reduce((sum, b) => sum + b.quantity, 0);
  const untracked = Math.max(0, item.count - trackedTotal);

  return (
    <div className="rounded-lg border p-5 mb-6" style={{ borderColor: "var(--gw-border-strong)", backgroundColor: "var(--gw-surface-raised)" }}>
      <div className="flex items-center justify-between mb-1">
        <div className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--gw-accent-text)" }}>
          Expiry dates — {item.name}
        </div>
        <button onClick={onClose} style={{ color: "var(--gw-text-2)" }} aria-label="Close expiry dates">
          <X size={16} />
        </button>
      </div>
      <p className="text-xs mb-4" style={{ color: "var(--gw-text-2)" }}>
        Each delivery can have its own expiry date. Whatever expires first is used up first, automatically.
      </p>

      {batches.length === 0 ? (
        <p className="text-sm mb-4" style={{ color: "var(--gw-text-2)" }}>
          No expiry dates tracked yet. Add one when a delivery comes in.
        </p>
      ) : (
        <div className="flex flex-col gap-2 mb-2">
          {batches.map((b, index) => (
            <BatchEditorRow
              key={b.id}
              batch={b}
              unit={item.unit}
              isNext={index === 0}
              onSave={(patch) => onEditBatch(b.id, patch)}
              onDelete={() => onDeleteBatch(b.id)}
            />
          ))}
        </div>
      )}
      {batches.length > 0 && untracked > 0 && (
        <p className="text-[11px] font-mono mb-4" style={{ color: "var(--gw-text-3)" }}>
          + {trimNumber(untracked)} {item.unit} with no expiry date
        </p>
      )}

      <div className="border-t pt-4 mt-2" style={{ borderColor: "var(--gw-border)" }}>
        <div className="font-mono text-[11px] uppercase tracking-widest mb-2" style={{ color: "var(--gw-text-2)" }}>
          Add an expiry date
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs font-mono" style={{ color: "var(--gw-text-2)" }}>
            How many {manyOf(item.unit)}?
            <input
              type="number"
              min={0}
              step="0.1"
              value={newQty}
              onChange={(e) => setNewQty(e.target.value === "" ? "" : parseFloat(e.target.value))}
              className="rounded-md border px-3 py-2 bg-transparent focus:outline-none"
              style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-mono" style={{ color: "var(--gw-text-2)" }}>
            Expires on
            <input
              type="date"
              value={newExpiresOn}
              onChange={(e) => setNewExpiresOn(e.target.value)}
              className="rounded-md border px-3 py-2 bg-transparent focus:outline-none"
              style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-mono col-span-1 sm:col-span-2" style={{ color: "var(--gw-text-2)" }}>
            Note (optional)
            <input
              type="text"
              maxLength={60}
              placeholder="e.g. Tuesday delivery, walk-in"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              className="rounded-md border px-3 py-2 bg-transparent focus:outline-none"
              style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
            />
          </label>
        </div>
        {/* Same clarifying line Add Stock's batch toggle shows — this is
            new stock coming in, added on top of the current count (and of
            any untracked stock), never carved out of what's already there. */}
        {newQty !== "" && newQty > 0 && (
          <p className="text-xs font-mono mt-3" style={{ color: "var(--gw-ok)" }}>
            This adds {trimNumber(newQty)} {item.unit}. New total: {trimNumber(item.count + newQty)} {item.unit}.
          </p>
        )}
        <div className="flex justify-end mt-3">
          <button
            onClick={() => {
              if (newQty === "" || newQty <= 0 || !newExpiresOn) return;
              onAddBatch(item.id, newQty, newExpiresOn, newLabel);
              setNewQty("");
              setNewLabel("");
            }}
            disabled={newQty === "" || newQty <= 0}
            className="px-4 py-2 rounded-md text-sm font-mono font-semibold flex items-center gap-1.5 disabled:opacity-40"
            style={{ backgroundColor: "var(--gw-accent)", color: "var(--gw-bg)" }}
          >
            <Plus size={14} /> Add
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

  // Below sm only Item / Count / Status / Edit are shown. Count was being
  // pushed off the right edge by Category, Unit and Threshold; the Count
  // cell already carries its unit, so Unit is the least lossy one to drop.
  const columns: { key: SortKey; label: string; phone: boolean }[] = [
    { key: "name", label: "Item", phone: true },
    { key: "category", label: "Category", phone: false },
    { key: "count", label: "Count", phone: true },
    { key: "unit", label: "Unit", phone: false },
    { key: "threshold", label: "Threshold", phone: false },
    { key: "status", label: "Status", phone: true },
  ];
  const phoneHidden = "hidden sm:table-cell";

  if (items.length === 0) {
    return (
      <div
        className="rounded-lg border px-4 py-6 text-center text-sm"
        style={{ borderColor: "var(--gw-border)", color: "var(--gw-text-2)" }}
      >
        No items yet. Add one from the Update tab and it will show up here.
      </div>
    );
  }

  return (
    <div className="rounded-lg border overflow-x-auto" style={{ borderColor: "var(--gw-border)" }}>
      <table className="w-full border-collapse font-mono text-[13px] sm:text-sm">
        <thead>
          <tr style={{ backgroundColor: "var(--gw-surface-raised)" }}>
            {columns.map((col) => (
              <th
                key={col.key}
                onClick={() => toggleSort(col.key)}
                className={`text-left px-2 sm:px-3 py-2.5 cursor-pointer select-none whitespace-nowrap ${col.phone ? "" : phoneHidden}`}
                style={{ color: "var(--gw-text-2)", borderBottom: "1px solid var(--gw-border)" }}
              >
                <span className="inline-flex items-center gap-1 uppercase text-[11px] tracking-widest">
                  {col.label}
                  <ArrowUpDown size={11} style={{ opacity: sortKey === col.key ? 1 : 0.35 }} />
                </span>
              </th>
            ))}
            <th style={{ borderBottom: "1px solid var(--gw-border)" }}></th>
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
                  backgroundColor: idx % 2 === 0 ? "transparent" : "var(--gw-surface)",
                  borderBottom: "1px solid var(--gw-border-faint)",
                }}
              >
                <td className="px-2 sm:px-3 py-2.5 sm:whitespace-nowrap" style={{ color: "var(--gw-text)" }}>
                  {item.name}
                </td>
                <td className={`px-3 py-2.5 whitespace-nowrap ${phoneHidden}`} style={{ color: "var(--gw-text-2)" }}>
                  {CATEGORY_LABEL[item.category]}
                </td>
                <td className="px-2 sm:px-3 py-2.5 whitespace-nowrap" style={{ color: "var(--gw-text)" }}>
                  {qty.amount} {qty.label}
                </td>
                <td className={`px-3 py-2.5 ${phoneHidden}`} style={{ color: "var(--gw-text-2)" }}>
                  {item.unit}
                </td>
                <td className={`px-3 py-2.5 whitespace-nowrap ${phoneHidden}`} style={{ color: "var(--gw-text-2)" }}>
                  {displayThreshold(item, displayMode)}
                </td>
                <td className="px-2 sm:px-3 py-2.5 sm:whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="inline-block rounded-full shrink-0"
                      style={{ width: 7, height: 7, backgroundColor: meta.color }}
                    />
                    <span style={{ color: meta.color }}>{meta.label}</span>
                  </span>
                </td>
                <td className="pl-1 pr-2 sm:px-3 py-1 text-right">
                  <button
                    onClick={() => onEdit(item.id)}
                    className="text-xs px-2.5 py-2 rounded border"
                    style={{ borderColor: "var(--gw-border)", color: "var(--gw-text-2)" }}
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
  // Local draft so backspacing to empty can actually show empty, rather
  // than snapping to 0 and prefixing the next digit (see AddItemForm).
  // Saves (onChangeAmount) fire only once the field is a real number
  // again — a blank field just doesn't write anything yet.
  const [draft, setDraft] = useState(String(ingredient.amount));
  return (
    <div className="flex items-center gap-2 py-1.5">
      <select
        value={ingredient.itemId}
        onChange={(e) => onChangeItem(parseInt(e.target.value, 10))}
        className="flex-1 min-w-0 rounded-md border px-2 py-1.5 text-sm bg-transparent focus:outline-none"
        style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
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
        value={draft}
        onChange={(e) => {
          const value = e.target.value;
          setDraft(value);
          if (value === "") return;
          const parsed = parseFloat(value);
          if (!Number.isNaN(parsed)) onChangeAmount(parsed);
        }}
        className="w-16 rounded-md border px-2 py-1.5 text-sm text-center font-mono bg-transparent focus:outline-none"
        style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
      />
      <span className="text-xs font-mono w-14 shrink-0" style={{ color: "var(--gw-text-2)" }}>
        {item ? item.unitMeasure : ""}
      </span>
      <button onClick={onRemove} style={{ color: "var(--gw-danger-text)" }}>
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
    <div className="rounded-lg border p-4 mb-4" style={{ borderColor: "var(--gw-border)" }}>
      <div className="flex items-center justify-between mb-2">
        <div
          className="font-semibold"
          style={{ color: "var(--gw-text)", fontFamily: "var(--font-display)", fontSize: 18 }}
        >
          {menuItem.name.toUpperCase()}
        </div>
        <div className="flex items-center gap-3">
          {remaining !== null && (
            <span
              className="font-mono text-xs"
              style={{ color: remaining <= 10 ? "var(--gw-danger-text)" : remaining <= 25 ? "var(--gw-warn)" : "var(--gw-ok)" }}
            >
              ~{remaining} left to sell
            </span>
          )}
          <button onClick={onDelete} style={{ color: "var(--gw-text-3)" }}>
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

      {menuItem.ingredients.length === 0 && (
        <p className="text-xs py-1.5" style={{ color: "var(--gw-text-2)" }}>
          No ingredients yet. Add what goes into one serving, then set how much of each.
        </p>
      )}

      <button
        onClick={addIngredient}
        disabled={linkableItems.length === 0}
        className="mt-2 text-xs font-mono flex items-center gap-1.5 disabled:opacity-40"
        style={{ color: "var(--gw-accent-text)" }}
      >
        <Plus size={12} /> Add ingredient
      </button>

      {hasUnmapped && (
        <p className="text-[11px] font-mono mt-2" style={{ color: "var(--gw-danger-text)" }}>
          Some ingredients reference an item that no longer has a unit size set.
        </p>
      )}
    </div>
  );
}

interface AddMenuItemFormProps {
  menuItems: MenuItem[];
  onAdd: (name: string) => void;
}

function AddMenuItemForm({ menuItems, onAdd }: AddMenuItemFormProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    // Case-insensitive so "Vanilla Latte" and "vanilla latte" collide too —
    // the unique index on menu_items(shop_id, lower(name)) backs this up
    // server-side for the concurrent-tab race this check can't catch.
    const isDuplicate = menuItems.some((m) => m.name.toLowerCase() === trimmed.toLowerCase());
    if (isDuplicate) {
      setError(`You already have a recipe named "${trimmed}".`);
      return;
    }
    setError("");
    onAdd(trimmed);
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
          style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
        />
        <button
          onClick={submit}
          className="px-4 py-2 rounded-md text-sm font-mono font-semibold flex items-center gap-1.5"
          style={{ backgroundColor: "var(--gw-accent)", color: "var(--gw-bg)" }}
        >
          <Plus size={14} /> Add
        </button>
      </div>
      {error && (
        <p className="text-[11px] font-mono mt-2" style={{ color: "var(--gw-danger-text)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

// Remembers (per shop, in this browser only) which POS item names the owner
// has mapped to which recipe, and which reports were already applied.
function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeStore(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // private mode or storage full: mapping just isn't remembered
  }
}

interface EndOfShiftImportProps {
  shopId: string;
  items: InventoryItem[];
  menuItems: MenuItem[];
  onApply: (sales: SaleLine[]) => Promise<boolean>;
}

type ImportStage = "input" | "review" | "done";

function EndOfShiftImport({ shopId, items, menuItems, onApply }: EndOfShiftImportProps) {
  const aliasKey = `gw-sales-aliases-v1:${shopId}`;
  const seenKey = `gw-sales-seen-v1:${shopId}`;

  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [stage, setStage] = useState<ImportStage>("input");
  const [error, setError] = useState("");
  // Set when the file's column names weren't recognized: the owner picks them.
  const [pickColumns, setPickColumns] = useState<string[] | null>(null);
  const [pickName, setPickName] = useState(0);
  const [pickQty, setPickQty] = useState(1);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [matches, setMatches] = useState<Record<string, Match>>({});
  const [choices, setChoices] = useState<Record<string, number | "skip">>({});
  const [seenAt, setSeenAt] = useState<number | null>(null);
  const [applying, setApplying] = useState(false);
  const [summary, setSummary] = useState<{ lines: number; sold: number; skipped: { name: string; qty: number }[] } | null>(null);

  const recipes = menuItems.map((m) => ({ id: m.id, name: m.name }));

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 2_000_000) {
      setError("That file is too big to be a sales report.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setText(String(reader.result ?? ""));
      setFileName(file.name);
      setError("");
    };
    reader.onerror = () => setError("Couldn't read that file.");
    reader.readAsText(file);
  }

  function review(choice?: ColumnChoice) {
    const result = parseSalesText(text, choice);
    if (result.error) {
      setError(result.error);
      if (result.columns) {
        const qtyGuess = result.columns.findIndex((c) => /qty|quant|sold|count|units|out/i.test(c));
        const q = qtyGuess >= 0 ? qtyGuess : Math.min(1, result.columns.length - 1);
        setPickQty(q);
        setPickName(q === 0 ? 1 : 0);
      }
      setPickColumns(result.columns ?? null);
      return;
    }
    setPickColumns(null);
    const aliases = readStore<Record<string, number>>(aliasKey, {});
    const nextMatches: Record<string, Match> = {};
    const nextChoices: Record<string, number | "skip"> = {};
    for (const row of result.rows) {
      const m = matchRecipe(row, recipes, aliases);
      nextMatches[row.key] = m;
      // A strong near-miss is pre-selected but shown as a choice to confirm; weaker ones start as Skip.
      nextChoices[row.key] =
        m.recipeId ?? (m.suggestionId !== null && m.suggestionScore >= 0.75 ? m.suggestionId : "skip");
    }
    const seen = readStore<Record<string, number>>(seenKey, {});
    setSeenAt(seen[fingerprintRows(result.rows)] ?? null);
    setParsed(result);
    setMatches(nextMatches);
    setChoices(nextChoices);
    setError("");
    setStage("review");
  }

  function reset() {
    setText("");
    setFileName("");
    setParsed(null);
    setSummary(null);
    setPickColumns(null);
    setError("");
    setStage("input");
  }

  const rows = parsed?.rows ?? [];
  const sales: SaleLine[] = [];
  const skippedRows: { name: string; qty: number }[] = [];
  for (const row of rows) {
    const choice = choices[row.key];
    const menuItem = typeof choice === "number" ? menuItems.find((m) => m.id === choice) : undefined;
    if (menuItem) sales.push({ menuItem, qty: row.qty });
    else skippedRows.push({ name: row.name, qty: row.qty });
  }
  const { byItem, skipped: undeductible } = computeDeductions(sales, items);
  const changes = items
    .filter((i) => byItem[i.id])
    .map((i) => ({ item: i, used: byItem[i.id], after: Math.max(0, i.count - byItem[i.id]), short: byItem[i.id] > i.count + 1e-9 }));
  const soldTotal = sales.reduce((n, l) => n + l.qty, 0);

  async function apply() {
    if (sales.length === 0 || changes.length === 0 || applying) return;
    setApplying(true);
    setError("");
    const ok = await onApply(sales);
    setApplying(false);
    if (!ok) {
      setError("Couldn't save the stock changes, so nothing was deducted. Try again.");
      return;
    }
    const aliases = readStore<Record<string, number>>(aliasKey, {});
    for (const row of rows) {
      const choice = choices[row.key];
      if (typeof choice === "number" && matches[row.key]?.kind === "none") aliases[normalizeName(row.name)] = choice;
    }
    writeStore(aliasKey, aliases);
    const seen = readStore<Record<string, number>>(seenKey, {});
    seen[fingerprintRows(rows)] = new Date().getTime();
    writeStore(seenKey, seen);
    setSummary({ lines: sales.length, sold: soldTotal, skipped: skippedRows });
    setStage("done");
    setText("");
    setFileName("");
  }

  const labelCls = "font-mono text-xs uppercase tracking-widest";
  const buttonPrimary = "px-4 py-2 min-h-11 rounded-md text-sm font-mono font-semibold disabled:opacity-40";
  const buttonOutline = "px-4 py-2 min-h-11 rounded-md text-sm font-mono border";

  return (
    <div className="rounded-lg border p-4" style={{ borderColor: "var(--gw-border)" }}>
      <div className={`${labelCls} mb-2 flex items-center gap-1.5`} style={{ color: "var(--gw-accent-text)" }}>
        <Upload size={13} /> End-of-Shift Import
      </div>

      {stage === "input" && (
        <>
          <p className="text-sm mb-3" style={{ color: "var(--gw-text-2)" }}>
            Upload your POS item-sales report (CSV), or paste it. GroundWorks looks for the item name and quantity
            columns itself, so extra columns are fine. Simple lines like{" "}
            <span className="font-mono">Vanilla Latte, 24</span> work too. You&apos;ll review everything before any stock
            changes.
          </p>
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <label
              className={`${buttonOutline} inline-flex items-center gap-2 cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline`}
              style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
            >
              <Upload size={14} /> Choose a CSV file
              <input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" onChange={onFile} className="sr-only" />
            </label>
            {fileName && (
              <span className="text-xs font-mono" style={{ color: "var(--gw-text-2)" }}>
                {fileName} loaded
              </span>
            )}
          </div>
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setFileName("");
              setPickColumns(null);
              if (error) setError("");
            }}
            aria-label="Sales report"
            placeholder={"Item Name, Items Sold\nVanilla Latte, 24\nOat Milk Latte, 17"}
            rows={5}
            className="w-full rounded-md border px-3 py-2 text-sm font-mono bg-transparent focus:outline-none mb-3"
            style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
          />
          <button
            onClick={() => review()}
            disabled={!text.trim()}
            className={buttonPrimary}
            style={{ backgroundColor: "var(--gw-accent)", color: "var(--gw-bg)" }}
          >
            Review import
          </button>
          {error && (
            <p role="alert" className="mt-3 text-sm" style={{ color: "var(--gw-danger-text)" }}>
              {error}
            </p>
          )}
          {pickColumns && (
            <div className="mt-3 flex flex-wrap items-end gap-3">
              {(
                [
                  ["Item name column", pickName, setPickName],
                  ["Quantity sold column", pickQty, setPickQty],
                ] as const
              ).map(([label, value, set]) => (
                <label key={label} className="flex flex-col gap-1 text-xs font-mono" style={{ color: "var(--gw-text-2)" }}>
                  {label}
                  <select
                    value={value}
                    onChange={(e) => set(parseInt(e.target.value, 10))}
                    className="rounded-md border px-2 py-1.5 min-h-11 bg-transparent focus:outline-none"
                    style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
                  >
                    {pickColumns.map((c, i) => (
                      <option key={i} value={i} style={{ color: "#000" }}>
                        {c || `Column ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <button
                onClick={() => review({ nameCol: pickName, qtyCol: pickQty })}
                disabled={pickName === pickQty}
                className={buttonOutline}
                style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
              >
                Use these columns
              </button>
            </div>
          )}
        </>
      )}

      {stage === "review" && parsed && (
        <div>
          <p className="text-sm mb-3" style={{ color: "var(--gw-text-2)" }}>
            Found <strong style={{ color: "var(--gw-text)" }}>{rows.length}</strong> item{rows.length === 1 ? "" : "s"} in
            your report. Nothing changes until you press Apply.
          </p>

          {seenAt && (
            <div
              role="alert"
              className="rounded-md border px-3 py-2 mb-3 text-sm"
              style={{ borderColor: "var(--gw-warn)", color: "var(--gw-text)" }}
            >
              You already applied this exact report on {new Date(seenAt).toLocaleString()}. Applying it again will
              deduct everything a second time.
            </div>
          )}
          {parsed.notes.map((n) => (
            <p key={n} className="text-xs mb-1" style={{ color: "var(--gw-text-3)" }}>
              {n}
            </p>
          ))}

          <div className={`${labelCls} mt-4 mb-2`} style={{ color: "var(--gw-text-3)" }}>
            Sales in this report
          </div>
          <ul className="mb-4">
            {rows.map((row) => {
              const m = matches[row.key];
              const choice = choices[row.key];
              const label = row.variation ? `${row.name} (${row.variation})` : row.name;
              const exact = m?.kind === "exact";
              const matchedName =
                typeof choice === "number" ? menuItems.find((mi) => mi.id === choice)?.name : undefined;
              return (
                <li
                  key={row.key}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 border-b"
                  style={{ borderColor: "var(--gw-border)" }}
                >
                  <span className="font-mono text-sm w-12 text-right" style={{ color: "var(--gw-text)" }}>
                    {trimNumber(row.qty)}
                  </span>
                  <span className="text-sm flex-1 min-w-[8rem]" style={{ color: "var(--gw-text)" }}>
                    {label}
                  </span>
                  {exact ? (
                    <span className="text-xs font-mono" style={{ color: "var(--gw-ok)" }}>
                      ✓ {matchedName}
                    </span>
                  ) : (
                    <label className="flex items-center gap-2 text-xs font-mono" style={{ color: "var(--gw-text-2)" }}>
                      {m?.kind === "cleaned" || m?.kind === "alias" ? "Matched to" : "Count as"}
                      <select
                        value={choice === undefined ? "skip" : String(choice)}
                        onChange={(e) =>
                          setChoices((prev) => ({
                            ...prev,
                            [row.key]: e.target.value === "skip" ? "skip" : parseInt(e.target.value, 10),
                          }))
                        }
                        className="rounded-md border px-2 py-1.5 min-h-11 bg-transparent focus:outline-none"
                        style={{
                          borderColor: choice === "skip" ? "var(--gw-warn)" : "var(--gw-border-strong)",
                          color: "var(--gw-text)",
                        }}
                      >
                        <option value="skip" style={{ color: "#000" }}>
                          Skip (no recipe)
                        </option>
                        {menuItems.map((mi) => (
                          <option key={mi.id} value={mi.id} style={{ color: "#000" }}>
                            {mi.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </li>
              );
            })}
          </ul>

          <div className={`${labelCls} mb-2`} style={{ color: "var(--gw-text-3)" }}>
            What will change in your inventory
          </div>
          {changes.length === 0 ? (
            <p className="text-sm mb-4" style={{ color: "var(--gw-text-2)" }}>
              Nothing yet. Choose a recipe for at least one line above.
            </p>
          ) : (
            <ul className="mb-4">
              {changes.map(({ item, used, after, short }) => (
                <li key={item.id} className="flex flex-wrap items-baseline gap-x-3 py-1 text-sm">
                  <span className="flex-1 min-w-[8rem]" style={{ color: "var(--gw-text)" }}>
                    {item.name}
                  </span>
                  <span className="font-mono text-xs" style={{ color: "var(--gw-text-2)" }}>
                    −{trimNumber(used)} {item.unit} ({trimNumber(item.count)} → {trimNumber(after)})
                  </span>
                  {short && (
                    <span className="w-full text-xs" style={{ color: "var(--gw-warn)" }}>
                      Not enough on hand for these sales; the count will stop at 0.
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {undeductible.length > 0 && (
            <p className="text-xs mb-4" style={{ color: "var(--gw-warn)" }}>
              Not deducted (no amount per unit set): {[...new Set(undeductible.map((u) => u.item))].join(", ")}.
            </p>
          )}
          {skippedRows.length > 0 && (
            <p className="text-xs mb-4" style={{ color: "var(--gw-text-3)" }}>
              Skipping {skippedRows.length} line{skippedRows.length === 1 ? "" : "s"} with no recipe:{" "}
              {skippedRows.map((r) => r.name).join(", ")}.
            </p>
          )}

          {error && (
            <p role="alert" className="mb-3 text-sm" style={{ color: "var(--gw-danger-text)" }}>
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={apply}
              disabled={sales.length === 0 || changes.length === 0 || applying}
              className={buttonPrimary}
              style={{ backgroundColor: "var(--gw-accent)", color: "var(--gw-bg)" }}
            >
              {applying ? "Applying…" : `Apply and deduct stock`}
            </button>
            <button
              onClick={() => {
                setError("");
                setStage("input");
              }}
              className={buttonOutline}
              style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text-2)" }}
            >
              Back
            </button>
          </div>
        </div>
      )}

      {stage === "done" && summary && (
        <div role="status">
          <p className="text-sm mb-2" style={{ color: "var(--gw-ok)" }}>
            Done. Deducted stock for {trimNumber(summary.sold)} sale{summary.sold === 1 ? "" : "s"} across{" "}
            {summary.lines} recipe line{summary.lines === 1 ? "" : "s"}.
          </p>
          {summary.skipped.length > 0 && (
            <p className="text-xs mb-3" style={{ color: "var(--gw-text-3)" }}>
              Skipped (no recipe): {summary.skipped.map((r) => `${r.name} (${trimNumber(r.qty)})`).join(", ")}.
            </p>
          )}
          <button
            onClick={reset}
            className={buttonOutline}
            style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text-2)" }}
          >
            Import another report
          </button>
        </div>
      )}
    </div>
  );
}

// ---- Square: size multipliers and modifier rules -------------------------------

type SquareEffect =
  | { type: "add"; itemId: number; amount: number }
  | { type: "swap"; fromItemId: number; toItemId: number };

interface SquareSize {
  key: string;
  label: string;
  multiplier: number;
  confirmed: boolean;
  timesSeen: number;
}

interface SquareModifier {
  key: string;
  label: string;
  effects: SquareEffect[] | null;
  timesSeen: number;
}

function SquareSizeRow({ size, onSaved }: { size: SquareSize; onSaved: () => void }) {
  const [draft, setDraft] = useState(String(size.multiplier));
  const [error, setError] = useState("");

  async function save() {
    const value = parseFloat(draft);
    if (!Number.isFinite(value) || value <= 0 || value > 10) {
      setError("Use a number like 1.33.");
      return;
    }
    if (size.confirmed && value === size.multiplier) return;
    setError("");
    try {
      const res = await fetch("/api/square/sizes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: size.key, multiplier: value }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error || "Couldn't save that.");
        return;
      }
      onSaved();
    } catch {
      setError("Couldn't save that.");
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 border-b" style={{ borderColor: "var(--gw-border)" }}>
      <span className="text-sm flex-1 min-w-[6rem]" style={{ color: "var(--gw-text)" }}>
        {size.label}
        <span className="font-mono text-[11px] ml-2" style={{ color: "var(--gw-text-3)" }}>
          sold {size.timesSeen}×
        </span>
      </span>
      <label className="flex items-center gap-2 text-xs font-mono" style={{ color: "var(--gw-text-2)" }}>
        uses
        <input
          type="number"
          step="0.05"
          min="0.05"
          max="10"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          aria-label={`Multiplier for ${size.label}`}
          className="w-20 rounded-md border px-2 py-1.5 min-h-11 text-center bg-transparent focus:outline-none"
          style={{ borderColor: size.confirmed ? "var(--gw-border-strong)" : "var(--gw-warn)", color: "var(--gw-text)" }}
        />
        × the recipe
      </label>
      {!size.confirmed && (
        <span className="text-[11px] font-mono" style={{ color: "var(--gw-warn)" }}>
          not set — counts as 1×
        </span>
      )}
      {error && (
        <span role="alert" className="text-[11px] font-mono w-full" style={{ color: "var(--gw-danger-text)" }}>
          {error}
        </span>
      )}
    </li>
  );
}

type ModifierKind = "unset" | "none" | "add" | "swap";

function effectSummary(effects: SquareEffect[] | null, items: InventoryItem[]): string {
  if (effects === null) return "Not set up — changes nothing yet";
  if (effects.length === 0) return "No stock effect";
  const name = (id: number) => items.find((i) => i.id === id)?.name ?? "a removed item";
  return effects
    .map((e) => {
      if (e.type === "add") {
        const it = items.find((i) => i.id === e.itemId);
        return `Uses extra ${trimNumber(e.amount)} ${it?.unitMeasure ?? ""} ${name(e.itemId)}`.replace(/\s+/g, " ");
      }
      return `Uses ${name(e.toItemId)} instead of ${name(e.fromItemId)}`;
    })
    .join("; ");
}

function SquareModifierRow({
  modifier,
  items,
  onSaved,
}: {
  modifier: SquareModifier;
  items: InventoryItem[];
  onSaved: () => void;
}) {
  const sized = items.filter((i) => i.unitSize);
  const first = modifier.effects?.[0];
  const [editing, setEditing] = useState(modifier.effects === null);
  const [kind, setKind] = useState<ModifierKind>(
    modifier.effects === null ? "unset" : first ? first.type : "none"
  );
  const [itemId, setItemId] = useState<number>(first?.type === "add" ? first.itemId : (sized[0]?.id ?? 0));
  const [amount, setAmount] = useState(first?.type === "add" ? String(first.amount) : "1");
  const [fromId, setFromId] = useState<number>(first?.type === "swap" ? first.fromItemId : (sized[0]?.id ?? 0));
  const [toId, setToId] = useState<number>(first?.type === "swap" ? first.toItemId : (sized[1]?.id ?? sized[0]?.id ?? 0));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // What the row shows once saved, so it doesn't flash the old text while the
  // list reloads.
  const [shown, setShown] = useState(modifier.effects);

  async function save() {
    let effects: SquareEffect[];
    if (kind === "none") effects = [];
    else if (kind === "add") {
      const value = parseFloat(amount);
      if (!itemId || !Number.isFinite(value) || value < 0) {
        setError("Pick an ingredient and an amount.");
        return;
      }
      effects = [{ type: "add", itemId, amount: value }];
    } else if (kind === "swap") {
      if (!fromId || !toId || fromId === toId) {
        setError("Pick two different ingredients.");
        return;
      }
      effects = [{ type: "swap", fromItemId: fromId, toItemId: toId }];
    } else {
      setError("Choose what this modifier does.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/square/modifiers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: modifier.key, effects }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error || "Couldn't save that.");
        return;
      }
      setShown(effects);
      setEditing(false);
      onSaved();
    } catch {
      setError("Couldn't save that.");
    } finally {
      setSaving(false);
    }
  }

  const selectCls = "rounded-md border px-2 py-1.5 min-h-11 text-xs font-mono bg-transparent focus:outline-none";
  const selectStyle = { borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" };
  const itemOptions = sized.map((i) => (
    <option key={i.id} value={i.id} style={{ color: "#000" }}>
      {i.name}
    </option>
  ));
  const chosen = items.find((i) => i.id === itemId);

  return (
    <li className="py-2 border-b" style={{ borderColor: "var(--gw-border)" }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-sm flex-1 min-w-[6rem]" style={{ color: "var(--gw-text)" }}>
          {modifier.label}
          <span className="font-mono text-[11px] ml-2" style={{ color: "var(--gw-text-3)" }}>
            sold {modifier.timesSeen}×
          </span>
        </span>
        {!editing && (
          <>
            <span
              className="text-xs font-mono"
              style={{ color: shown === null ? "var(--gw-warn)" : "var(--gw-text-2)" }}
            >
              {effectSummary(shown, items)}
            </span>
            <button
              onClick={() => setEditing(true)}
              className="text-xs font-mono underline underline-offset-2 px-2 min-h-11"
              style={{ color: "var(--gw-accent-text)" }}
            >
              Edit
            </button>
          </>
        )}
      </div>

      {editing && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            aria-label={`What ${modifier.label} does`}
            value={kind}
            onChange={(e) => setKind(e.target.value as ModifierKind)}
            className={selectCls}
            style={selectStyle}
          >
            <option value="unset" style={{ color: "#000" }}>
              Choose what it does…
            </option>
            <option value="none" style={{ color: "#000" }}>
              No stock effect
            </option>
            <option value="add" style={{ color: "#000" }}>
              Uses an extra ingredient
            </option>
            <option value="swap" style={{ color: "#000" }}>
              Swaps one ingredient for another
            </option>
          </select>

          {kind === "add" && (
            <>
              <select
                aria-label="Extra ingredient"
                value={itemId}
                onChange={(e) => setItemId(parseInt(e.target.value, 10))}
                className={selectCls}
                style={selectStyle}
              >
                {itemOptions}
              </select>
              <input
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-label="Amount used"
                className="w-20 rounded-md border px-2 py-1.5 min-h-11 text-center text-xs font-mono bg-transparent focus:outline-none"
                style={selectStyle}
              />
              <span className="text-xs font-mono" style={{ color: "var(--gw-text-2)" }}>
                {chosen?.unitMeasure ?? ""}
              </span>
            </>
          )}

          {kind === "swap" && (
            <>
              <span className="text-xs font-mono" style={{ color: "var(--gw-text-2)" }}>
                instead of
              </span>
              <select
                aria-label="Ingredient it replaces"
                value={fromId}
                onChange={(e) => setFromId(parseInt(e.target.value, 10))}
                className={selectCls}
                style={selectStyle}
              >
                {itemOptions}
              </select>
              <span className="text-xs font-mono" style={{ color: "var(--gw-text-2)" }}>
                use
              </span>
              <select
                aria-label="Ingredient it uses instead"
                value={toId}
                onChange={(e) => setToId(parseInt(e.target.value, 10))}
                className={selectCls}
                style={selectStyle}
              >
                {itemOptions}
              </select>
            </>
          )}

          <button
            onClick={save}
            disabled={saving}
            className="px-3 py-2 min-h-11 rounded-md text-xs font-mono font-semibold disabled:opacity-40"
            style={{ backgroundColor: "var(--gw-accent)", color: "var(--gw-bg)" }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {shown !== null && (
            <button
              onClick={() => setEditing(false)}
              className="text-xs font-mono px-2 min-h-11"
              style={{ color: "var(--gw-text-3)" }}
            >
              Cancel
            </button>
          )}
          {kind === "swap" && (
            <p className="w-full text-[11px]" style={{ color: "var(--gw-text-3)" }}>
              The recipe&apos;s amount carries over as-is, measured in the new ingredient&apos;s unit.
            </p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-[11px] font-mono mt-1" style={{ color: "var(--gw-danger-text)" }}>
          {error}
        </p>
      )}
    </li>
  );
}

// ---- Square connection (Pro) ----------------------------------------------

interface SquareStatus {
  configured: boolean;
  connected: boolean;
  status: "active" | "needs_reconnect" | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  connectedSince: string | null;
  unmatched: { key: string; name: string; variation: string | null; qty: number }[];
  sizes: SquareSize[];
  modifiers: SquareModifier[];
}

const SQUARE_FLASH: Record<string, string> = {
  connected: "Square is connected. Sales from now on will deduct ingredients automatically.",
  declined: "Square wasn't connected — access was declined.",
  error: "Couldn't finish connecting Square. Please try again.",
};

function SquareConnectionCard({
  menuItems,
  items,
  onStockChanged,
}: {
  menuItems: MenuItem[];
  items: InventoryItem[];
  onStockChanged: () => void;
}) {
  const [status, setStatus] = useState<SquareStatus | null>(null);
  const [busy, setBusy] = useState<"" | "connect" | "sync" | "disconnect">("");
  const [message, setMessage] = useState(() => {
    if (typeof window === "undefined") return "";
    return SQUARE_FLASH[new URLSearchParams(window.location.search).get("square") ?? ""] ?? "";
  });
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  async function loadStatus() {
    try {
      const res = await fetch("/api/square/status");
      if (res.ok) setStatus((await res.json()) as SquareStatus);
    } catch {
      // The card just stays as it is until the next successful load.
    }
  }

  useEffect(() => {
    // The ?square=... result was read into `message` above; tidy the URL.
    if (new URLSearchParams(window.location.search).has("square")) {
      window.history.replaceState(null, "", window.location.pathname);
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/square/status");
        if (res.ok && !cancelled) setStatus((await res.json()) as SquareStatus);
      } catch {
        // see loadStatus
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Not set up on this server (or still loading): no card, no dead button.
  if (!status || !status.configured) return null;

  async function connect() {
    setBusy("connect");
    setMessage("");
    try {
      const res = await fetch("/api/square/connect", { method: "POST" });
      const data = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!res.ok || !data?.url) {
        setMessage(data?.error || "Couldn't start the Square connection. Try again.");
        setBusy("");
        return;
      }
      window.location.href = data.url;
    } catch {
      setMessage("Couldn't start the Square connection. Try again.");
      setBusy("");
    }
  }

  async function syncNow() {
    setBusy("sync");
    setMessage("");
    try {
      const res = await fetch("/api/square/sync", { method: "POST" });
      const data = (await res.json().catch(() => null)) as { status?: string; ordersApplied?: number } | null;
      if (!res.ok || !data) setMessage("Couldn't check Square. Try again.");
      else if (data.status === "needs_reconnect") setMessage("Square access was removed. Reconnect to keep syncing.");
      else if (data.status === "error") setMessage("Square didn't respond properly. We'll keep retrying automatically.");
      else if (data.status === "synced") {
        const n = data.ordersApplied ?? 0;
        setMessage(n > 0 ? `Counted ${n} new sale${n === 1 ? "" : "s"} from Square.` : "Up to date. No new sales since the last check.");
        if (n > 0) onStockChanged();
      }
      await loadStatus();
    } catch {
      setMessage("Couldn't check Square. Try again.");
    } finally {
      setBusy("");
    }
  }

  async function disconnect() {
    setBusy("disconnect");
    setMessage("");
    try {
      const res = await fetch("/api/square/disconnect", { method: "POST" });
      setMessage(res.ok ? "Square disconnected." : "Couldn't disconnect. Try again.");
      setConfirmDisconnect(false);
      await loadStatus();
    } catch {
      setMessage("Couldn't disconnect. Try again.");
    } finally {
      setBusy("");
    }
  }

  async function resolve(key: string, menuItemId: number | null) {
    try {
      await fetch("/api/square/unmatched", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, menuItemId }),
      });
    } finally {
      await loadStatus();
    }
  }

  const labelCls = "font-mono text-xs uppercase tracking-widest";
  const buttonPrimary = "px-4 py-2 min-h-11 rounded-md text-sm font-mono font-semibold disabled:opacity-40";
  const buttonOutline = "px-4 py-2 min-h-11 rounded-md text-sm font-mono border disabled:opacity-40";
  const needsReconnect = status.status === "needs_reconnect";

  return (
    <div className="rounded-lg border p-4 mb-6" style={{ borderColor: "var(--gw-border)" }}>
      <div className={`${labelCls} mb-2`} style={{ color: "var(--gw-accent-text)" }}>
        Square
      </div>

      {!status.connected ? (
        <>
          <p className="text-sm mb-3" style={{ color: "var(--gw-text-2)" }}>
            Connect your Square account and GroundWorks deducts ingredients automatically as drinks are sold. No
            end-of-shift file. It only reads your completed sales (read-only), and only counts sales made after you
            connect.
          </p>
          <button
            onClick={connect}
            disabled={busy !== ""}
            className={buttonPrimary}
            style={{ backgroundColor: "var(--gw-accent)", color: "var(--gw-bg)" }}
          >
            {busy === "connect" ? "Opening Square…" : "Connect Square"}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm mb-1" style={{ color: needsReconnect ? "var(--gw-danger-text)" : "var(--gw-text)" }}>
            {needsReconnect ? "Square access was removed — reconnect to keep syncing." : "Connected. Sales deduct automatically."}
          </p>
          <p className="text-xs mb-3" style={{ color: "var(--gw-text-3)" }}>
            {status.lastSyncedAt ? `Last checked ${new Date(status.lastSyncedAt).toLocaleString()}.` : "Waiting for the first check."}
            {status.connectedSince ? ` Counting sales since ${new Date(status.connectedSince).toLocaleDateString()}.` : ""}
          </p>
          <div className="flex flex-wrap gap-3">
            {needsReconnect ? (
              <button
                onClick={connect}
                disabled={busy !== ""}
                className={buttonPrimary}
                style={{ backgroundColor: "var(--gw-accent)", color: "var(--gw-bg)" }}
              >
                Reconnect Square
              </button>
            ) : (
              <button
                onClick={syncNow}
                disabled={busy !== ""}
                className={buttonOutline}
                style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
              >
                {busy === "sync" ? "Checking…" : "Check for new sales"}
              </button>
            )}
            {confirmDisconnect ? (
              <>
                <button
                  onClick={disconnect}
                  disabled={busy !== ""}
                  className={buttonOutline}
                  style={{ borderColor: "var(--gw-danger-text)", color: "var(--gw-danger-text)" }}
                >
                  Yes, disconnect
                </button>
                <button
                  onClick={() => setConfirmDisconnect(false)}
                  className={buttonOutline}
                  style={{ borderColor: "var(--gw-border)", color: "var(--gw-text-2)" }}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirmDisconnect(true)}
                disabled={busy !== ""}
                className={buttonOutline}
                style={{ borderColor: "var(--gw-border)", color: "var(--gw-text-2)" }}
              >
                Disconnect
              </button>
            )}
          </div>

          {status.unmatched.length > 0 && (
            <div className="mt-5">
              <div className={`${labelCls} mb-1`} style={{ color: "var(--gw-text-3)" }}>
                Sold in Square, no recipe yet
              </div>
              <p className="text-xs mb-2" style={{ color: "var(--gw-text-2)" }}>
                These sold but didn&apos;t match a recipe, so nothing was deducted for them. Pick the recipe each one
                means (it&apos;s remembered for next time), or make a recipe with the same name.
              </p>
              <ul>
                {status.unmatched.map((u) => (
                  <li
                    key={u.key}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 border-b"
                    style={{ borderColor: "var(--gw-border)" }}
                  >
                    <span className="font-mono text-sm w-12 text-right" style={{ color: "var(--gw-text)" }}>
                      {trimNumber(u.qty)}
                    </span>
                    <span className="text-sm flex-1 min-w-[8rem]" style={{ color: "var(--gw-text)" }}>
                      {u.variation ? `${u.name} (${u.variation})` : u.name}
                    </span>
                    <select
                      aria-label={`Recipe for ${u.name}`}
                      value=""
                      onChange={(e) => e.target.value && resolve(u.key, parseInt(e.target.value, 10))}
                      className="rounded-md border px-2 py-1.5 min-h-11 text-xs font-mono bg-transparent focus:outline-none"
                      style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
                    >
                      <option value="">Count as…</option>
                      {menuItems.map((m) => (
                        <option key={m.id} value={m.id} style={{ color: "#000" }}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => resolve(u.key, null)}
                      className="text-xs font-mono px-2 min-h-11"
                      style={{ color: "var(--gw-text-3)" }}
                    >
                      Ignore
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {status.sizes.length > 0 && (
            <div className="mt-5">
              <div className={`${labelCls} mb-1`} style={{ color: "var(--gw-text-3)" }}>
                Sizes
              </div>
              <p className="text-xs mb-2" style={{ color: "var(--gw-text-2)" }}>
                Your recipes are the base size. Tell GroundWorks how much more or less each size uses, like 1.33 for a Large or 0.75 for a Small, and every drink sold in that size deducts that much.
              </p>
              <ul>
                {status.sizes.map((z) => (
                  <SquareSizeRow key={`${z.key}:${z.multiplier}:${z.confirmed}`} size={z} onSaved={loadStatus} />
                ))}
              </ul>
            </div>
          )}

          {status.modifiers.length > 0 && (
            <div className="mt-5">
              <div className={`${labelCls} mb-1`} style={{ color: "var(--gw-text-3)" }}>
                Modifiers
              </div>
              <p className="text-xs mb-2" style={{ color: "var(--gw-text-2)" }}>
                Add-ons and swaps on a drink (extra shot, oat milk). Say what each one does to your stock. Until you do, it changes nothing.
              </p>
              <ul>
                {status.modifiers.map((m) => (
                  <SquareModifierRow key={`${m.key}:${JSON.stringify(m.effects)}`} modifier={m} items={items} onSaved={loadStatus} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {message && (
        <p role="status" className="mt-3 text-sm" style={{ color: "var(--gw-text-2)" }}>
          {message}
        </p>
      )}
    </div>
  );
}

interface RecipesPageProps {
  shopId: string;
  items: InventoryItem[];
  menuItems: MenuItem[];
  onAddMenuItem: (name: string) => void;
  onDeleteMenuItem: (id: number) => void;
  onAddIngredient: (menuItemId: number, itemId: number) => void;
  onChangeIngredientAmount: (ingredientId: number, amount: number) => void;
  onChangeIngredientItem: (ingredientId: number, itemId: number) => void;
  onRemoveIngredient: (ingredientId: number) => void;
  onApplySales: (sales: SaleLine[]) => Promise<boolean>;
  onStockChanged: () => void;
}

function RecipesPage({
  shopId,
  items,
  menuItems,
  onAddMenuItem,
  onDeleteMenuItem,
  onAddIngredient,
  onChangeIngredientAmount,
  onChangeIngredientItem,
  onRemoveIngredient,
  onApplySales,
  onStockChanged,
}: RecipesPageProps) {
  const linkableCount = items.filter((i) => i.unitSize).length;

  return (
    <div>
      {linkableCount === 0 && (
        <div
          className="rounded-lg border px-4 py-3 mb-6 text-sm"
          style={{ borderColor: "var(--gw-border-strong)", backgroundColor: "var(--gw-surface-raised)", color: "var(--gw-text)" }}
        >
          None of your inventory items have an &quot;amount per unit&quot; set yet. Edit an item (or add a new
          one) with something like 32 oz per carton before you can build a recipe.
        </div>
      )}
      <SquareConnectionCard menuItems={menuItems} items={items} onStockChanged={onStockChanged} />
      <AddMenuItemForm menuItems={menuItems} onAdd={onAddMenuItem} />
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
      {menuItems.length > 0 && (
        <EndOfShiftImport shopId={shopId} items={items} menuItems={menuItems} onApply={onApplySales} />
      )}
    </div>
  );
}

// ---- Restock alerts ---------------------------------------------------------

interface AlertsPageProps {
  shopId: string;
  isDemoShop?: boolean;
  expirationAlertDays: number;
  onChangeExpirationAlertDays: (days: number) => void;
}

function AlertsPage({ shopId, isDemoShop = false, expirationAlertDays, onChangeExpirationAlertDays }: AlertsPageProps) {
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
    if (!newPhone.trim() || !consentChecked) return;
    setActionError("");
    // Any normal way of typing a US number works; it's stored in the international
    // form Twilio needs. Outside the US, start with + and the country code.
    const phone = normalizePhone(newPhone);
    if (!phone) {
      setActionError("That doesn't look like a phone number. Try (555) 234-5678, or start with + and the country code if it's outside the US.");
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
        style={{ fontFamily: "var(--font-display)", color: "var(--gw-text)", fontSize: 24, fontWeight: 700 }}
        className="mb-1"
      >
        ALERTS
      </h2>
      <p className="text-sm mb-4" style={{ color: "var(--gw-text-2)" }}>
        <strong style={{ color: "var(--gw-text)" }}>Restock:</strong> a text goes out the moment an item&apos;s status gets
        worse — Stocked to Reorder, or Reorder to Critical. No repeat texts while it just sits at the same status.
      </p>
      <div className="flex items-center gap-2 mb-6 text-sm flex-wrap" style={{ color: "var(--gw-text-2)" }}>
        <strong style={{ color: "var(--gw-text)" }}>Expiration:</strong>
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
          style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
        />
        <span>day(s) before a batch expires, once, per batch.</span>
      </div>
      <p className="text-xs font-mono uppercase tracking-widest mb-3" style={{ color: "var(--gw-text-3)" }}>
        Sent to
      </p>

      {isDemoShop && (
        <div
          className="rounded-lg border p-4 mb-4 text-sm"
          style={{ borderColor: "var(--gw-border)", color: "var(--gw-text-2)" }}
        >
          Text alerts are turned off in the demo. In your own shop you add the numbers that should get a text here.
        </div>
      )}

      {loading && !isDemoShop && (
        <div className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--gw-text-3)" }}>
          Loading…
        </div>
      )}
      {loadError && !isDemoShop && (
        <div className="text-sm font-mono" style={{ color: "var(--gw-danger-text)" }}>
          {loadError}
        </div>
      )}

      {(isDemoShop || (!loading && !loadError)) && (
        <>
          <div className="rounded-lg border p-4 mb-4" style={{ borderColor: "var(--gw-border)" }}>
            <label className="flex flex-col gap-1 text-xs font-mono mb-3" style={{ color: "var(--gw-text-2)" }}>
              Phone number
              <input
                type="tel"
                disabled={isDemoShop}
                placeholder="(555) 234-5678"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                className="rounded-md border px-3 py-2 font-mono bg-transparent focus:outline-none"
                style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
              />
            </label>

            <label className="flex items-start gap-2 text-xs mb-4 cursor-pointer" style={{ color: "var(--gw-text-2)" }}>
              <input
                type="checkbox"
                disabled={isDemoShop}
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                className="mt-0.5 shrink-0"
              />
              <span>
                I agree to receive automated text alerts about my inventory (restock and expiration alerts) from
                GroundWorks Inventory. Message frequency varies. Msg &amp; data rates may apply. Reply STOP to a
                text to opt out, HELP for help.
                <span className="flex items-center gap-3 mt-2">
                  <a
                    href="/privacy"
                    target="_blank"
                    rel="noreferrer"
                    className="underline font-semibold"
                    style={{ color: "var(--gw-text)" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    Privacy Policy
                  </a>
                  <a
                    href="/terms"
                    target="_blank"
                    rel="noreferrer"
                    className="underline font-semibold"
                    style={{ color: "var(--gw-text)" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    Terms of Service
                  </a>
                </span>
              </span>
            </label>

            <button
              onClick={handleAdd}
              disabled={isDemoShop || adding || !newPhone.trim() || !consentChecked}
              className="px-4 py-2 rounded-md text-sm font-mono font-semibold flex items-center gap-1.5 disabled:opacity-40"
              style={{ backgroundColor: "var(--gw-accent)", color: "var(--gw-bg)" }}
            >
              <Plus size={14} /> {adding ? "Signing up…" : "Yes, sign me up!"}
            </button>
          </div>

          {actionError && (
            <div className="text-xs font-mono mb-4" style={{ color: "var(--gw-danger-text)" }}>
              {actionError}
            </div>
          )}

          {isDemoShop ? null : recipients.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--gw-text-2)" }}>
              No recipients yet — add a phone number above to start getting restock texts.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {recipients.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between rounded-lg border px-4 py-3"
                  style={{ borderColor: "var(--gw-border)" }}
                >
                  <span className="font-mono text-sm" style={{ color: "var(--gw-text)" }}>
                    {formatPhone(r.phone)}
                  </span>
                  <button onClick={() => handleRemove(r.id)} style={{ color: "var(--gw-text-3)" }} aria-label="Remove">
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

type AuthMode = "sign-in" | "sign-up" | "forgot-password";

function LoginScreen({ initialMode = "sign-in" }: { initialMode?: AuthMode }) {
  const [authMode, setAuthMode] = useState<AuthMode>(initialMode);
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

    if (authMode === "forgot-password") {
      if (!email.trim()) {
        setError("Enter your email.");
        return;
      }
      setBusy(true);
      const supabase = createClient();
      try {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        // Deliberately generic either way, so this can't be used to probe
        // which emails have an account (Supabase itself behaves the same
        // way — resetPasswordForEmail doesn't error for an unknown email).
        if (resetError) {
          setError(resetError.message);
        } else {
          setNotice("If an account exists for that email, a password reset link is on its way.");
        }
      } catch {
        setError("Couldn't reach the server. Check your connection and try again.");
      } finally {
        setBusy(false);
      }
      return;
    }

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
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
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
      className="relative min-h-screen w-full flex items-center justify-center px-5"
      style={{ backgroundColor: "var(--gw-bg)", fontFamily: "var(--font-sans)" }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-lg border p-6"
        style={{ borderColor: "var(--gw-border)", backgroundColor: "var(--gw-surface)" }}
      >
        <div className="font-mono text-xs uppercase tracking-[0.25em] mb-2" style={{ color: "var(--gw-accent-text)" }}>
          GroundWorks
        </div>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            color: "var(--gw-text)",
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: "0.01em",
          }}
          className="mb-1"
        >
          {authMode === "sign-in" ? "SHOP LOGIN" : authMode === "sign-up" ? "CREATE YOUR SHOP" : "RESET PASSWORD"}
        </h1>
        <p className="text-xs mb-5" style={{ color: "var(--gw-text-2)" }}>
          {authMode === "sign-in"
            ? "Sign in with your shop's email and password."
            : authMode === "sign-up"
              ? "Set up a new shop account with an email and password."
              : "Enter your email and we'll send you a link to reset your password."}
        </p>

        {authMode === "sign-up" && (
          <>
            <label className="block text-xs font-mono mb-1.5" style={{ color: "var(--gw-text-2)" }}>
              Shop name
            </label>
            <input
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              placeholder="e.g. Cedar & Fig Coffee"
              className="w-full rounded-md border px-3 py-2 mb-4 bg-transparent focus:outline-none"
              style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
            />
          </>
        )}

        <label className="block text-xs font-mono mb-1.5" style={{ color: "var(--gw-text-2)" }}>
          Email
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@shop.com"
          autoComplete="email"
          className="w-full rounded-md border px-3 py-2 mb-4 bg-transparent focus:outline-none"
          style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
        />

        {authMode !== "forgot-password" && (
          <>
            <label className="block text-xs font-mono mb-1.5" style={{ color: "var(--gw-text-2)" }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete={authMode === "sign-up" ? "new-password" : "current-password"}
              className="w-full rounded-md border px-3 py-2 mb-2 bg-transparent focus:outline-none"
              style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
            />
          </>
        )}

        {authMode === "sign-in" && (
          <button
            type="button"
            onClick={() => {
              setAuthMode("forgot-password");
              setError("");
              setNotice("");
            }}
            className="text-xs font-mono underline underline-offset-2"
            style={{ color: "var(--gw-text-2)" }}
          >
            Forgot password?
          </button>
        )}

        {error && (
          <div className="text-xs font-mono mt-2" style={{ color: "var(--gw-danger-text)" }}>
            {error}
          </div>
        )}
        {notice && (
          <div className="text-xs font-mono mt-2" style={{ color: "var(--gw-ok)" }}>
            {notice}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full mt-5 px-4 py-2.5 rounded-md text-sm font-mono font-semibold disabled:opacity-60"
          style={{ backgroundColor: "var(--gw-accent)", color: "var(--gw-bg)" }}
        >
          {busy
            ? "Working…"
            : authMode === "sign-in"
              ? "Sign In"
              : authMode === "sign-up"
                ? "Create Shop Account"
                : "Send Reset Link"}
        </button>

        <button
          type="button"
          onClick={() => {
            setAuthMode((m) => (m === "sign-up" ? "sign-in" : m === "sign-in" ? "sign-up" : "sign-in"));
            setError("");
            setNotice("");
          }}
          className="w-full mt-3 text-xs font-mono underline underline-offset-2"
          style={{ color: "var(--gw-text-2)" }}
        >
          {authMode === "sign-in"
            ? "New shop? Create an account"
            : authMode === "sign-up"
              ? "Already have an account? Sign in"
              : "Back to sign in"}
        </button>

        {authMode !== "forgot-password" && (
          <>
            <div className="my-4 flex items-center gap-3">
              <div className="h-px flex-1" style={{ backgroundColor: "var(--gw-border)" }} />
              <span className="font-mono text-[11px] uppercase tracking-widest" style={{ color: "var(--gw-text-3)" }}>
                or
              </span>
              <div className="h-px flex-1" style={{ backgroundColor: "var(--gw-border)" }} />
            </div>

            <button
              type="button"
              onClick={handleTryDemo}
              disabled={busy}
              className="w-full px-4 py-2.5 rounded-md text-sm font-mono font-semibold border disabled:opacity-60"
              style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
            >
              {busy ? "Working…" : "Try the demo — no signup needed"}
            </button>
          </>
        )}
      </form>
      <Link
        href="/"
        className="absolute top-5 left-5 inline-flex min-h-11 items-center font-mono text-xs"
        style={{ color: "var(--gw-text-2)" }}
      >
        &larr; Back to home
      </Link>
    </div>
  );
}

// ---- Loading skeleton + first-run empty state --------------------------------

// The dashboard's own frame (wordmark, shop name, tab bar, tiles, rows) in
// placeholder form, so the page appears in place immediately and fills in
// rather than swapping a blank "Loading…" screen for the real layout. Pulse
// is opacity-only and gated behind motion-safe.
function SkeletonBar({ className = "" }: { className?: string }) {
  return (
    <div
      className={`rounded motion-safe:animate-pulse ${className}`}
      style={{ backgroundColor: "var(--gw-surface-selected)" }}
    />
  );
}

function DashboardSkeleton({ shopName }: { shopName: string }) {
  return (
    <div
      className="min-h-screen w-full"
      style={{ backgroundColor: "var(--gw-bg)", fontFamily: "var(--font-sans)" }}
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">Loading your shop</span>
      <div className="max-w-2xl md:max-w-4xl mx-auto px-5 py-10">
        <div className="mb-8">
          <h1
            style={{
              fontFamily: "var(--font-display)",
              color: "var(--gw-text)",
              fontSize: 40,
              fontWeight: 700,
              letterSpacing: "0.01em",
              lineHeight: 1,
            }}
          >
            GROUNDWORKS
          </h1>
          <p className="text-sm mt-2" style={{ color: "var(--gw-text-2)" }}>
            {shopName}
          </p>
        </div>
        <SkeletonBar className="h-[60px] w-full sm:w-[420px] mb-6" />
        <div className="grid grid-cols-3 gap-3 mb-8">
          {[0, 1, 2].map((i) => (
            <SkeletonBar key={i} className="h-[84px]" />
          ))}
        </div>
        <div className="md:grid md:grid-cols-2 md:gap-x-12">
          {[0, 1].map((col) => (
            <div key={col} className="mb-8">
              <SkeletonBar className="h-4 w-32 mb-4" />
              {[0, 1].map((row) => (
                <div
                  key={row}
                  className="flex flex-col gap-3 py-4 border-b"
                  style={{ borderColor: "var(--gw-border)" }}
                >
                  <div className="flex items-center gap-3">
                    <SkeletonBar className="shrink-0 rounded-full w-12 h-12 sm:w-16 sm:h-16" />
                    <div className="flex-1 space-y-2">
                      <SkeletonBar className="h-5 w-40 max-w-full" />
                      <SkeletonBar className="h-3 w-56 max-w-full" />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <SkeletonBar className="h-11 w-11 rounded-full" />
                    <SkeletonBar className="h-6 w-14" />
                    <SkeletonBar className="h-11 w-11 rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// What a brand-new shop sees right after paying: where to start, in plain
// words, with the one action it needs and a pointer to the next useful setup
// step (text alerts), instead of a single gray line.
function EmptyInventory({ onAdd, onAlerts }: { onAdd: () => void; onAlerts: () => void }) {
  return (
    <div
      className="rounded-lg border px-5 py-8 mb-8 text-center"
      style={{ borderColor: "var(--gw-border)", backgroundColor: "var(--gw-surface)" }}
    >
      <Package size={28} className="mx-auto mb-3" style={{ color: "var(--gw-border-strong)" }} />
      <h2
        style={{
          fontFamily: "var(--font-display)",
          color: "var(--gw-text)",
          fontSize: 26,
          fontWeight: 700,
          letterSpacing: "0.01em",
          lineHeight: 1.1,
        }}
      >
        Add your first item
      </h2>
      <p className="text-sm mt-2 mb-5 max-w-sm mx-auto" style={{ color: "var(--gw-text-2)" }}>
        Track what&apos;s on hand and GroundWorks texts you before it runs out.
      </p>
      <ul
        className="text-left text-sm max-w-sm mx-auto mb-6 space-y-2 list-disc pl-5"
        style={{ color: "var(--gw-text-2)" }}
      >
        <li>
          <span style={{ color: "var(--gw-text)" }}>Name it and pick a category.</span> Milk goes under Perishables.
        </li>
        <li>
          <span style={{ color: "var(--gw-text)" }}>Set a reorder threshold.</span> That&apos;s the count where you
          want the heads-up.
        </li>
        <li>
          <span style={{ color: "var(--gw-text)" }}>Optional: amount per unit.</span> 1 carton = 32 oz lets Recipes
          use the item.
        </li>
      </ul>
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2">
        <button
          onClick={onAdd}
          className="px-5 py-2 min-h-11 rounded-full text-sm font-mono font-semibold"
          style={{ backgroundColor: "var(--gw-accent)", color: "var(--gw-bg)" }}
        >
          + Add your first item
        </button>
        <button
          onClick={onAlerts}
          className="px-5 py-2 min-h-11 rounded-full text-sm font-mono underline underline-offset-2"
          style={{ color: "var(--gw-text-2)" }}
        >
          Set up text alerts
        </button>
      </div>
    </div>
  );
}

// ---- Shop dashboard ---------------------------------------------------------

// ---- Owner PIN, undo bar, and the What-to-order tab --------------------------

type PinDialogMode = "unlock" | "settings";

function OwnerPinDialog({
  mode,
  pinEnabled,
  onClose,
  onUnlocked,
  onPinChanged,
}: {
  mode: PinDialogMode;
  pinEnabled: boolean;
  onClose: () => void;
  onUnlocked: () => void;
  onPinChanged: (enabled: boolean) => void;
}) {
  const [pin, setPin] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function call(body: Record<string, string>): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/owner-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error || "Something went wrong. Try again.");
        return false;
      }
      return true;
    } catch {
      setError("Couldn't reach the server. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    if (await call({ action: "verify", pin })) onUnlocked();
    else setPin("");
  }

  async function savePin(e: React.FormEvent) {
    e.preventDefault();
    if (await call({ action: "set", pin, password })) {
      onPinChanged(true);
      setPin("");
      setPassword("");
      setDone("Owner PIN saved. Settings are locked until someone enters it.");
    }
  }

  async function removePin() {
    if (await call({ action: "remove", password })) {
      onPinChanged(false);
      setPassword("");
      setDone("Owner PIN removed. Everyone can change settings again.");
    }
  }

  const inputCls = "w-full rounded-md border px-3 py-2 min-h-11 bg-transparent focus:outline-none text-lg font-mono";
  const inputStyle = { borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" };
  const primary = "px-4 py-2 min-h-11 rounded-md text-sm font-mono font-semibold disabled:opacity-40";
  const outline = "px-4 py-2 min-h-11 rounded-md text-sm font-mono border";

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center px-5"
      style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={mode === "unlock" ? "Enter owner PIN" : "Owner PIN"}
        className="w-full max-w-sm rounded-lg border p-5"
        style={{ borderColor: "var(--gw-border-strong)", backgroundColor: "var(--gw-surface-raised)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {mode === "unlock" ? (
          <form onSubmit={unlock}>
            <div className="font-mono text-xs uppercase tracking-widest mb-2" style={{ color: "var(--gw-accent-text)" }}>
              Owner PIN
            </div>
            <p className="text-sm mb-4" style={{ color: "var(--gw-text-2)" }}>
              This is for the owner or manager. Enter the PIN to change settings.
            </p>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              aria-label="Owner PIN"
              placeholder="••••"
              className={`${inputCls} text-center tracking-[0.5em]`}
              style={inputStyle}
            />
            {error && (
              <p role="alert" className="text-sm mt-3" style={{ color: "var(--gw-danger-text)" }}>
                {error}
              </p>
            )}
            <div className="flex gap-3 mt-4">
              <button
                type="submit"
                disabled={busy || pin.length < 4}
                className={`${primary} flex-1`}
                style={{ backgroundColor: "var(--gw-accent)", color: "var(--gw-bg)" }}
              >
                {busy ? "Checking…" : "Unlock"}
              </button>
              <button type="button" onClick={onClose} className={outline} style={{ borderColor: "var(--gw-border)", color: "var(--gw-text-2)" }}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={savePin}>
            <div className="font-mono text-xs uppercase tracking-widest mb-2" style={{ color: "var(--gw-accent-text)" }}>
              {pinEnabled ? "Owner PIN" : "Set an owner PIN"}
            </div>
            <p className="text-sm mb-4" style={{ color: "var(--gw-text-2)" }}>
              With a PIN on, your team can still count, log usage and receive deliveries. Editing items, Recipes, Alerts and billing ask for the PIN first.
            </p>
            {done ? (
              <p role="status" className="text-sm mb-4" style={{ color: "var(--gw-ok)" }}>
                {done}
              </p>
            ) : (
              <>
                <label className="block text-xs font-mono mb-1" style={{ color: "var(--gw-text-2)" }}>
                  {pinEnabled ? "New PIN (4 to 6 digits)" : "PIN (4 to 6 digits)"}
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                  aria-label="New PIN"
                  className={`${inputCls} text-center tracking-[0.5em] mb-3`}
                  style={inputStyle}
                />
                <label className="block text-xs font-mono mb-1" style={{ color: "var(--gw-text-2)" }}>
                  Your account password (to confirm it&apos;s you)
                </label>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-label="Account password"
                  className={`${inputCls} text-base`}
                  style={inputStyle}
                />
              </>
            )}
            {error && (
              <p role="alert" className="text-sm mt-3" style={{ color: "var(--gw-danger-text)" }}>
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-3 mt-4">
              {!done && (
                <button
                  type="submit"
                  disabled={busy || pin.length < 4 || !password}
                  className={`${primary} flex-1`}
                  style={{ backgroundColor: "var(--gw-accent)", color: "var(--gw-bg)" }}
                >
                  {busy ? "Saving…" : pinEnabled ? "Change PIN" : "Save PIN"}
                </button>
              )}
              {!done && pinEnabled && (
                <button
                  type="button"
                  onClick={removePin}
                  disabled={busy || !password}
                  className={`${outline} disabled:opacity-40`}
                  style={{ borderColor: "var(--gw-danger-text)", color: "var(--gw-danger-text)" }}
                >
                  Remove PIN
                </button>
              )}
              <button type="button" onClick={onClose} className={outline} style={{ borderColor: "var(--gw-border)", color: "var(--gw-text-2)" }}>
                {done ? "Close" : "Cancel"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function OwnerOnlyPanel({ onUnlock }: { onUnlock: () => void }) {
  return (
    <div className="rounded-lg border p-8 text-center" style={{ borderColor: "var(--gw-border)", backgroundColor: "var(--gw-surface)" }}>
      <Lock size={22} className="mx-auto mb-3" style={{ color: "var(--gw-border-strong)" }} />
      <div className="font-semibold mb-2" style={{ color: "var(--gw-text)", fontFamily: "var(--font-display)", fontSize: 20 }}>
        OWNER ONLY
      </div>
      <p className="text-sm mb-4 max-w-sm mx-auto" style={{ color: "var(--gw-text-2)" }}>
        Settings are locked on this device. Enter the owner PIN to open them.
      </p>
      <button
        onClick={onUnlock}
        className="px-4 py-2 min-h-11 rounded-md text-sm font-mono font-semibold"
        style={{ backgroundColor: "var(--gw-accent)", color: "var(--gw-bg)" }}
      >
        Enter owner PIN
      </button>
    </div>
  );
}

// A few seconds after a −/+ tap: shows what changed and lets a mis-tap be
// undone in one tap. Taps on the same item keep folding into one undo.
function UndoBar({ text, onUndo }: { text: string; onUndo: () => void }) {
  return (
    <div className="fixed inset-x-0 bottom-4 z-30 flex justify-center px-4 pointer-events-none">
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto flex items-center gap-4 rounded-lg border pl-4 pr-2 py-1.5 max-w-md w-full"
        style={{ borderColor: "var(--gw-border-strong)", backgroundColor: "var(--gw-surface-raised)" }}
      >
        <span className="flex-1 text-sm font-mono" style={{ color: "var(--gw-text)" }}>
          {text}
        </span>
        <button
          onClick={onUndo}
          className="px-4 min-h-11 rounded-md text-sm font-mono font-semibold"
          style={{ color: "var(--gw-accent-text)" }}
        >
          Undo
        </button>
      </div>
    </div>
  );
}

function OrderPage({
  shopName,
  items,
  marks,
  onMark,
}: {
  shopName: string;
  items: InventoryItem[];
  marks: ReadonlySet<number>;
  onMark: (ids: number[], marked: boolean) => void;
}) {
  const { toOrder, ordered } = useMemo(() => buildOrderList(items, marks), [items, marks]);
  const [note, setNote] = useState("");

  async function share() {
    const text = orderText(shopName, toOrder, new Date());
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ text });
        return;
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return; // they closed the share sheet
    }
    try {
      await navigator.clipboard.writeText(text);
      setNote("Copied. Paste it into a message or your supplier's order form.");
    } catch {
      setNote("Couldn't copy. Try again.");
    }
  }

  const labelCls = "font-mono text-xs uppercase tracking-widest";
  const outline = "px-4 py-2 min-h-11 rounded-md text-sm font-mono border";

  const row = (line: (typeof toOrder)[number], done: boolean) => (
    <li
      key={line.item.id}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 border-b"
      style={{ borderColor: "var(--gw-border)" }}
    >
      <span
        className="shrink-0 w-2.5 h-2.5 rounded-full"
        style={{ backgroundColor: line.status === "critical" ? "var(--gw-danger-text)" : "var(--gw-warn)" }}
        aria-hidden="true"
      />
      <div className="flex-1 min-w-[9rem]">
        <div className="font-semibold" style={{ color: "var(--gw-text)", fontFamily: "var(--font-display)", fontSize: 18 }}>
          {line.item.name.toUpperCase()}
        </div>
        <div className="font-mono text-xs" style={{ color: "var(--gw-text-2)" }}>
          {line.status === "critical" ? "Critical" : "Running low"} · have {trimNumber(line.item.count)} {line.item.unit}
        </div>
      </div>
      <div className="font-mono text-sm text-right" style={{ color: "var(--gw-text)" }}>
        {done ? "Ordered" : `Order ${line.suggested} ${line.item.unit}`}
      </div>
      <button
        onClick={() => onMark([line.item.id], !done)}
        className={outline}
        style={{ borderColor: done ? "var(--gw-border)" : "var(--gw-accent)", color: done ? "var(--gw-text-3)" : "var(--gw-accent-text)" }}
        aria-label={done ? `Not ordered yet: ${line.item.name}` : `Mark ${line.item.name} as ordered`}
      >
        {done ? "Undo" : "Ordered ✓"}
      </button>
    </li>
  );

  if (toOrder.length === 0 && ordered.length === 0) {
    return (
      <div className="rounded-lg border p-8 text-center" style={{ borderColor: "var(--gw-border)", backgroundColor: "var(--gw-surface)" }}>
        <Check size={22} className="mx-auto mb-3" style={{ color: "var(--gw-ok)" }} />
        <div className="font-semibold mb-2" style={{ color: "var(--gw-text)", fontFamily: "var(--font-display)", fontSize: 20 }}>
          NOTHING TO ORDER
        </div>
        <p className="text-sm max-w-sm mx-auto" style={{ color: "var(--gw-text-2)" }}>
          Everything is above its reorder level. Items show up here on their own when they run low.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm mb-4" style={{ color: "var(--gw-text-2)" }}>
        Everything at or below its reorder level, most urgent first. The amount is enough to get back to double the reorder level.
      </p>

      {toOrder.length > 0 && (
        <>
          <div className={`${labelCls} mb-1`} style={{ color: "var(--gw-text-3)" }}>
            To order ({toOrder.length})
          </div>
          <ul className="mb-4">{toOrder.map((l) => row(l, false))}</ul>
          <div className="flex flex-wrap gap-3 mb-2">
            <button
              onClick={share}
              className="px-4 py-2 min-h-11 rounded-md text-sm font-mono font-semibold"
              style={{ backgroundColor: "var(--gw-accent)", color: "var(--gw-bg)" }}
            >
              Share list
            </button>
            <button
              onClick={() => onMark(toOrder.map((l) => l.item.id), true)}
              className={outline}
              style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
            >
              Mark all ordered
            </button>
          </div>
          {note && (
            <p role="status" className="text-xs font-mono mb-2" style={{ color: "var(--gw-text-2)" }}>
              {note}
            </p>
          )}
        </>
      )}

      {ordered.length > 0 && (
        <div className="mt-6">
          <div className={`${labelCls} mb-1`} style={{ color: "var(--gw-text-3)" }}>
            Already ordered ({ordered.length})
          </div>
          <ul>{ordered.map((l) => row(l, true))}</ul>
          <p className="text-[11px] font-mono mt-2" style={{ color: "var(--gw-text-3)" }}>
            These clear on their own when you log the delivery.
          </p>
        </div>
      )}
    </div>
  );
}

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
  // Coming back from Square's authorization screen lands on the Recipes tab,
  // where the connection card (and its result message) lives.
  const [page, setPage] = useState<Page>(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).has("square") ? "recipes" : "update"
  );
  const [mode, setMode] = useState<Mode>("quick");
  const [batchDraft, setBatchDraft] = useState<Record<number, number | "">>({});
  const [showAdd, setShowAdd] = useState(false);
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [addingStockId, setAddingStockId] = useState<number | null>(null);
  const [editingBatchesItemId, setEditingBatchesItemId] = useState<number | null>(null);
  // Update-tab filters: a search box and tapping a status tile (Critical / Reorder soon / Stocked).
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<Status | null>(null);
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
  // Which category sections are collapsed on the Update page — session-only
  // (resets on reload), so a shop with a lot of line items can hide
  // categories they aren't touching this shift without losing any data.
  const [collapsedCategories, setCollapsedCategories] = useState<Set<CategoryId>>(new Set());

  // ---- Owner PIN: locks settings on a shared device (see /api/owner-pin) ----
  const [pinEnabled, setPinEnabled] = useState(false);
  const [ownerUnlocked, setOwnerUnlocked] = useState(false);
  const [pinDialog, setPinDialog] = useState<null | { mode: PinDialogMode; then?: () => void }>(null);
  const isOwner = !pinEnabled || ownerUnlocked;

  // ---- What to order: items somebody has already ordered ----
  const [orderMarks, setOrderMarks] = useState<ReadonlySet<number>>(new Set());

  // ---- Undo for a mis-tapped − / + ----
  const [undo, setUndo] = useState<{ id: number; from: number } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toOrderCount = useMemo(() => buildOrderList(items, orderMarks).toOrder.length, [items, orderMarks]);
  const lockedTab = (id: Page) => !isOwner && (id === "recipes" || id === "alerts");
  const pageTabs: { id: Page; label: string; Icon: LucideIcon; badge?: number }[] = [
    { id: "update", label: "Update", Icon: PencilLine },
    { id: "order", label: "Order", Icon: ShoppingCart, badge: toOrderCount },
    { id: "spreadsheet", label: "Table", Icon: Table2 },
    { id: "recipes", label: "Recipes", Icon: tier === "standard" || lockedTab("recipes") ? Lock : BookOpen },
    { id: "alerts", label: "Alerts", Icon: lockedTab("alerts") ? Lock : Bell },
  ];

  useEffect(() => {
    if (isDemoShop) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/owner-pin");
        const data = (await res.json()) as { enabled?: boolean };
        if (!cancelled && data.enabled) setPinEnabled(true);
      } catch {
        // No PIN status means no lock: the app stays usable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isDemoShop]);

  // Owner mode ends on its own after ten minutes so a phone left on the counter relocks.
  useEffect(() => {
    if (!ownerUnlocked) return;
    const t = setTimeout(() => setOwnerUnlocked(false), 10 * 60 * 1000);
    return () => clearTimeout(t);
  }, [ownerUnlocked]);

  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    []
  );

  function requireOwner(action: () => void) {
    if (isOwner) action();
    else setPinDialog({ mode: "unlock", then: action });
  }

  function goToPage(id: Page) {
    if (lockedTab(id)) {
      setPinDialog({ mode: "unlock", then: () => setPage(id) });
      return;
    }
    setPage(id);
  }

  function toggleCategory(catId: CategoryId) {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError("");
      try {
        const [fetchedItems, fetchedMenuItems, fetchedBatches, fetchedMarks] = await Promise.all([
          fetchItems(shop.id),
          fetchMenuItems(shop.id),
          fetchBatchesForShop(shop.id),
          fetchOrderMarks(shop.id),
        ]);
        if (cancelled) return;
        setItems(fetchedItems);
        setMenuItems(fetchedMenuItems);
        setPerishableBatches(fetchedBatches);
        setOrderMarks(new Set(fetchedMarks));
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
  // Re-reads stock after something outside this tab changed it (a Square
  // sync). Quiet: a failed refresh just leaves what's on screen.
  async function refreshStock() {
    try {
      const [fetchedItems, fetchedBatches] = await Promise.all([fetchItems(shop.id), fetchBatchesForShop(shop.id)]);
      setItems(fetchedItems);
      setPerishableBatches(fetchedBatches);
    } catch {
      // see comment above
    }
  }

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

  // − / + from the item row: same as adjustQuick, plus a few seconds of Undo.
  // Repeated taps on one item fold into a single undo back to where it started.
  function tapAdjust(id: number, delta: number) {
    const current = items.find((i) => i.id === id);
    if (!current) return;
    if (Math.max(0, current.count + delta) === current.count) return;
    setUndo((prev) => ({ id, from: prev && prev.id === id ? prev.from : current.count }));
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), 6000);
    void adjustQuick(id, delta);
  }

  // Typing an exact count: the same change (and the same Undo) as tapping − or + that many times.
  function tapSet(id: number, value: number) {
    const current = items.find((i) => i.id === id);
    if (!current) return;
    tapAdjust(id, Math.round((value - current.count) * 10000) / 10000);
  }

  async function undoLast() {
    if (!undo) return;
    const { id, from } = undo;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo(null);
    const current = items.find((i) => i.id === id);
    if (current) await adjustQuick(id, from - current.count);
  }

  async function markOrdered(ids: number[], marked: boolean) {
    const before = orderMarks;
    setOrderMarks((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (marked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
    try {
      await withSaving(() => saveOrderMarks(shop.id, ids, marked));
    } catch {
      setOrderMarks(before);
      setActionError("Couldn't save that. Try again.");
    }
  }

  // Add Stock: adds to the current count rather than replacing it — the
  // "just got a shipment in" flow. nativeAmount is already converted to
  // the item's tracked unit by AddStockForm (handles a different package
  // size than what's stocked, e.g. 32oz cartons when tracking in 16oz).
  // batchExpiresOn is set only when adding as a tracked batch rather than
  // plain individual units — see AddStockForm.
  async function addStock(id: number, nativeAmount: number, batchExpiresOn?: string, batchLabel?: string) {
    const current = items.find((i) => i.id === id);
    if (!current) return;
    const nextCount = current.count + nativeAmount;
    setActionError("");
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, count: nextCount } : i)));
    setBatchDraft((prev) => ({ ...prev, [id]: nextCount }));
    setAddingStockId(null);
    if (orderMarks.has(id)) void markOrdered([id], false);
    try {
      await withSaving(() => updateItemCount(id, nextCount));
    } catch {
      setActionError("Couldn't save that addition — reload to see the last saved count.");
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, count: current.count } : i)));
      return;
    }
    if (batchExpiresOn) {
      try {
        const inserted = await withSaving(() => insertBatch(id, nativeAmount, batchExpiresOn, batchLabel));
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

  async function addBatch(itemId: number, quantity: number, expiresOn: string, label?: string) {
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
      const inserted = await withSaving(() => insertBatch(itemId, quantity, expiresOn, label));
      setPerishableBatches((prev) => [...prev, inserted].sort((a, b) => a.expiresOn.localeCompare(b.expiresOn)));
    } catch {
      setActionError("Stock was added, but the expiration date couldn't be saved. Try adding the batch again.");
    }
  }

  async function editBatch(id: number, patch: { quantity?: number; expiresOn?: string; label?: string | null }) {
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

  // Only one panel (edit / delivery / expiry / new item) is ever open, and it
  // opens right under the item it belongs to.
  function openPanel(kind: "edit" | "stock" | "batches", id: number) {
    setShowAdd(false);
    setEditingItemId(kind === "edit" ? id : null);
    setAddingStockId(kind === "stock" ? id : null);
    setEditingBatchesItemId(kind === "batches" ? id : null);
    // The item has to be visible for its panel to be: un-collapse its section
    // and clear any search or status filter.
    const cat = items.find((i) => i.id === id)?.category;
    if (cat) {
      setCollapsedCategories((prev) => {
        if (!prev.has(cat)) return prev;
        const next = new Set(prev);
        next.delete(cat);
        return next;
      });
    }
    setQuery("");
    setStatusFilter(null);
  }

  function jumpToEdit(id: number) {
    requireOwner(() => {
      setPage("update");
      setMode("quick");
      openPanel("edit", id);
    });
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

  async function addMenuItem(name: string) {
    setActionError("");
    try {
      const inserted = await withSaving(() => insertMenuItem(shop.id, name));
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

  async function applySales(sales: SaleLine[]): Promise<boolean> {
    // sales: [{ menuItem, qty }] — deduct each ingredient's amount * qty, converted
    // from the recipe's measure into the item's stocking unit, from on-hand count.
    // The same computeDeductions() powers the import preview, so what the owner
    // reviewed is exactly what gets applied. Returns whether the save succeeded.
    const { byItem: deltaByItemId } = computeDeductions(sales, items);
    const updates = items
      .filter((i) => deltaByItemId[i.id])
      .map((i) => ({
        id: i.id,
        count: Math.max(0, Math.round((i.count - deltaByItemId[i.id]) * 100) / 100),
      }));
    if (updates.length === 0) return false;

    setActionError("");
    setItems((prev) => {
      const byId = new Map(updates.map((u) => [u.id, u.count]));
      return prev.map((i) => (byId.has(i.id) ? { ...i, count: byId.get(i.id)! } : i));
    });
    try {
      await withSaving(() => updateItemCounts(updates));
    } catch {
      setActionError("Couldn't save the sales deduction. Try again.");
      // Put the on-screen counts back; nothing was written.
      setItems((prev) =>
        prev.map((i) => {
          const before = items.find((o) => o.id === i.id);
          return before && updates.some((u) => u.id === i.id) ? { ...i, count: before.count } : i;
        })
      );
      return false;
    }
    // Sales always deduct (never add), so every update here is a decrease
    // — trim the oldest-expiring batch(es) for each affected item to match.
    try {
      await Promise.all(updates.map((u) => consumeBatchesFIFO(u.id, deltaByItemId[u.id])));
      await refreshBatches();
    } catch {
      // best-effort — see refreshBatches
    }
    return true;
  }

  if (loading) {
    return <DashboardSkeleton shopName={shopName} />;
  }

  if (loadError) {
    return (
      <div
        className="min-h-screen w-full flex items-center justify-center px-5 text-center"
        style={{ backgroundColor: "var(--gw-bg)" }}
      >
        <div>
          <div className="font-mono text-sm mb-3" style={{ color: "var(--gw-danger-text)" }}>
            {loadError}
          </div>
          <button
            onClick={onLogout}
            className="font-mono text-xs underline underline-offset-2"
            style={{ color: "var(--gw-text-2)" }}
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen w-full"
      style={{ backgroundColor: "var(--gw-bg)", fontFamily: "var(--font-sans)" }}
    >
      <div className={`max-w-2xl md:max-w-4xl mx-auto px-5 py-10 ${mode === "batch" && page === "update" ? "pb-28" : ""}`}>
        {/* Header */}
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1
              style={{
                fontFamily: "var(--font-display)",
                color: "var(--gw-text)",
                fontSize: 40,
                fontWeight: 700,
                letterSpacing: "0.01em",
                lineHeight: 1,
              }}
            >
              GROUNDWORKS
            </h1>
            <p className="text-sm mt-2" style={{ color: "var(--gw-text-2)" }}>
              {shopName}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0 mt-1">
            <Package size={28} style={{ color: "var(--gw-border-strong)" }} />
            <div className="text-right">
              <div className="font-mono text-[11px] uppercase tracking-widest" style={{ color: "var(--gw-text-3)" }}>
                {pendingSaves > 0 ? "Saving…" : "Signed in"}
              </div>
              {pinEnabled && (
                <button
                  onClick={() => (ownerUnlocked ? setOwnerUnlocked(false) : setPinDialog({ mode: "unlock" }))}
                  className="font-mono text-[11px] mt-1 mr-0 flex items-center gap-1 ml-auto min-h-8"
                  style={{ color: ownerUnlocked ? "var(--gw-accent-text)" : "var(--gw-text-2)" }}
                >
                  {ownerUnlocked ? <Unlock size={11} /> : <Lock size={11} />}
                  {ownerUnlocked ? "Owner mode · Lock" : "Owner unlock"}
                </button>
              )}
              <button
                onClick={onLogout}
                className="font-mono text-xs mt-1 underline underline-offset-2"
                style={{ color: "var(--gw-text-2)" }}
              >
                Sign out
              </button>
            </div>
          </div>
        </div>

        {/* Page switcher */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <nav
            aria-label="Sections"
            className="flex w-full sm:w-fit gap-1 p-1 rounded-lg border"
            style={{ borderColor: "var(--gw-border)", backgroundColor: "var(--gw-surface-sunk)" }}
          >
            {pageTabs.map(({ id, label, Icon, badge }) => (
              <button
                key={id}
                onClick={() => goToPage(id)}
                aria-current={page === id ? "page" : undefined}
                className="relative flex-1 sm:flex-none px-1 sm:px-4 py-2 min-h-11 rounded-md font-mono flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 text-[11px] sm:text-sm"
                style={{
                  backgroundColor: page === id ? "var(--gw-surface-selected)" : "transparent",
                  color: page === id ? "var(--gw-text)" : "var(--gw-text-3)",
                }}
              >
                <Icon size={16} /> {label}
                {badge ? (
                  <span
                    className="absolute top-0.5 right-1 sm:static min-w-[16px] h-4 px-1 rounded-full text-[10px] leading-none flex items-center justify-center"
                    style={{ backgroundColor: "var(--gw-warn)", color: "var(--gw-bg)" }}
                    aria-label={`${badge} to order`}
                  >
                    {badge}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>

        </div>

        {page === "update" && (
        <>
        {/* Status summary strip — only on Update, and only once there are items to count */}
        {items.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-8">
          {(["critical", "low", "good"] as Status[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter((cur) => (cur === s ? null : s))}
              aria-pressed={statusFilter === s}
              aria-label={`Show only ${STATUS_META[s].label} items (${counts[s]})`}
              className="rounded-lg border px-3 py-3 text-center min-h-11"
              style={{
                borderColor: statusFilter === s ? STATUS_META[s].color : "var(--gw-border)",
                backgroundColor: statusFilter === s ? "var(--gw-surface-selected)" : "transparent",
              }}
            >
              <div className="font-mono text-2xl font-bold" style={{ color: STATUS_META[s].color }}>
                {counts[s]}
              </div>
              <div className="font-mono text-[11px] uppercase tracking-widest mt-1" style={{ color: "var(--gw-text-2)" }}>
                {STATUS_META[s].label}
              </div>
            </button>
          ))}
        </div>
        )}

        {/* Mode switcher: two equal segments, and "New item" as its own deliberate row on a phone */}
        <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 mb-6">
          <button
            onClick={() => setMode("quick")}
            className="px-3 py-2 min-h-11 rounded-full text-sm font-mono flex items-center justify-center gap-2 border whitespace-nowrap"
            style={{
              borderColor: mode === "quick" ? "var(--gw-accent)" : "var(--gw-border)",
              backgroundColor: mode === "quick" ? "var(--gw-accent)" : "transparent",
              color: mode === "quick" ? "var(--gw-bg)" : "var(--gw-text-2)",
            }}
          >
            <Plus size={14} /> Quick adjust
          </button>
          <button
            onClick={enterBatchMode}
            className="px-3 py-2 min-h-11 rounded-full text-sm font-mono flex items-center justify-center gap-2 border whitespace-nowrap"
            style={{
              borderColor: mode === "batch" ? "var(--gw-accent)" : "var(--gw-border)",
              backgroundColor: mode === "batch" ? "var(--gw-accent)" : "transparent",
              color: mode === "batch" ? "var(--gw-bg)" : "var(--gw-text-2)",
            }}
          >
            <ClipboardList size={14} /> Closing Count
          </button>
          <button
            onClick={() =>
              requireOwner(() => {
                setEditingItemId(null);
                setAddingStockId(null);
                setEditingBatchesItemId(null);
                setShowAdd((v) => !v);
              })
            }
            className="col-span-2 sm:col-span-1 sm:ml-auto px-4 py-2 min-h-11 rounded-full text-sm font-mono flex items-center justify-center border border-dashed"
            style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text-2)" }}
          >
            + New item
          </button>
        </div>

        {mode === "quick" && items.length > 0 && !showAdd && (
          <p className="text-xs -mt-3 mb-5" style={{ color: "var(--gw-text-3)" }}>
            Tap − when you use something up, + when you restock. Tap the number to type an exact count.
          </p>
        )}

        {showAdd && <AddItemForm onAdd={addItem} onCancel={() => setShowAdd(false)} />}

        {items.length >= 6 && (
          <div className="mb-6 flex items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find an item…"
              aria-label="Find an item"
              className="flex-1 rounded-md border px-3 py-2 min-h-11 bg-transparent focus:outline-none"
              style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
            />
            {(query || statusFilter) && (
              <button
                onClick={() => {
                  setQuery("");
                  setStatusFilter(null);
                }}
                className="px-3 min-h-11 text-xs font-mono underline underline-offset-2"
                style={{ color: "var(--gw-text-2)" }}
              >
                Show all
              </button>
            )}
          </div>
        )}

        {mode === "batch" && (
          <div
            className="rounded-lg border px-4 py-3 mb-6 flex items-center justify-between"
            style={{ borderColor: "var(--gw-border-strong)", backgroundColor: "var(--gw-surface-raised)" }}
          >
            <span className="text-sm" style={{ color: "var(--gw-text)" }}>
              Walk the storage room, update every count, then save once.
            </span>
            <button
              onClick={saveBatch}
              className="px-4 py-2 rounded-md text-sm font-mono font-semibold flex items-center gap-1.5"
              style={{ backgroundColor: "var(--gw-accent)", color: "var(--gw-bg)" }}
            >
              <Check size={14} /> Save Closing Count
            </button>
          </div>
        )}

        {savedFlash && (
          <div className="mb-6 text-sm font-mono" style={{ color: "var(--gw-ok)" }}>
            ✓ Closing count saved.
          </div>
        )}

        {actionError && (
          <div className="mb-6 text-sm font-mono" style={{ color: "var(--gw-danger-text)" }}>
            {actionError}
          </div>
        )}

        {items.length === 0 && !showAdd && (
          <EmptyInventory onAdd={() => setShowAdd(true)} onAlerts={() => goToPage("alerts")} />
        )}

        {/* Category sections */}
        <div className="md:grid md:grid-cols-2 md:gap-x-12">
        {CATEGORIES.map((cat) => {
          const needle = query.trim().toLowerCase();
          const filtering = needle !== "" || statusFilter !== null;
          const catItems = items
            .filter((i) => i.category === cat.id)
            .filter((i) => (statusFilter === null || getStatus(i) === statusFilter) && (needle === "" || i.name.toLowerCase().includes(needle)));
          if (catItems.length === 0) return null;
          const Icon = cat.icon;
          const collapsed = collapsedCategories.has(cat.id) && !filtering;
          return (
            <div key={cat.id} className="mb-8">
              <button
                type="button"
                onClick={() => toggleCategory(cat.id)}
                className="w-full flex items-center gap-2 mb-3"
                aria-expanded={!collapsed}
              >
                <Icon size={16} style={{ color: "var(--gw-accent-text)" }} />
                <h2
                  className="font-semibold uppercase tracking-wide text-sm"
                  style={{ color: "var(--gw-text)", fontFamily: "var(--font-display)", letterSpacing: "0.08em" }}
                >
                  {cat.label}
                </h2>
                <span className="text-xs font-mono" style={{ color: "var(--gw-text-3)" }}>
                  ({catItems.length})
                </span>
                <ChevronDown
                  size={16}
                  style={{
                    color: "var(--gw-text-3)",
                    marginLeft: "auto",
                    transform: collapsed ? "rotate(-90deg)" : undefined,
                    transition: "transform 120ms ease",
                  }}
                />
              </button>
              {!collapsed && (
                <div>
                  {catItems.map((item) => (
                    <div key={item.id}>
                      <ItemRow
                        item={item}
                        mode={mode}
                        displayMode={displayMode}
                        batches={perishableBatches.filter((b) => b.itemId === item.id)}
                        onAdjust={tapAdjust}
                        onSetCount={tapSet}
                        onBatchChange={changeBatchDraft}
                        batchValue={batchDraft[item.id] ?? item.count}
                        onEdit={(id) => requireOwner(() => openPanel("edit", id))}
                        onAddStock={(id) => openPanel("stock", id)}
                        onEditBatches={(id) => openPanel("batches", id)}
                      />
                      {editingItemId === item.id && (
                        <ScrollIntoView>
                          <EditItemForm item={item} onSave={saveItemEdit} onCancel={() => setEditingItemId(null)} onDelete={deleteItem} />
                        </ScrollIntoView>
                      )}
                      {addingStockId === item.id && (
                        <ScrollIntoView>
                          <AddStockForm item={item} onAdd={addStock} onCancel={() => setAddingStockId(null)} />
                        </ScrollIntoView>
                      )}
                      {editingBatchesItemId === item.id && (
                        <ScrollIntoView>
                          <BatchEditor
                            item={item}
                            batches={perishableBatches.filter((b) => b.itemId === item.id)}
                            onAddBatch={addBatch}
                            onEditBatch={editBatch}
                            onDeleteBatch={removeBatch}
                            onClose={() => setEditingBatchesItemId(null)}
                          />
                        </ScrollIntoView>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        </div>
        {items.length > 0 && (query.trim() !== "" || statusFilter !== null) &&
          !items.some((i) => (statusFilter === null || getStatus(i) === statusFilter) && (query.trim() === "" || i.name.toLowerCase().includes(query.trim().toLowerCase()))) && (
            <p className="text-sm py-6 text-center" style={{ color: "var(--gw-text-2)" }}>
              Nothing matches. Tap Show all to see everything.
            </p>
          )}
        </>
        )}

        {page === "order" && <OrderPage shopName={shopName} items={items} marks={orderMarks} onMark={markOrdered} />}

        {page === "spreadsheet" && (
          <SpreadsheetView items={items} displayMode={displayMode} onEdit={jumpToEdit} />
        )}

        {(page === "recipes" || page === "alerts") && !isOwner && (
          <OwnerOnlyPanel onUnlock={() => setPinDialog({ mode: "unlock" })} />
        )}

        {page === "recipes" && tier === "standard" && isOwner && (
          <div
            className="rounded-lg border p-8 text-center"
            style={{ borderColor: "var(--gw-border)", backgroundColor: "var(--gw-surface)" }}
          >
            <Lock size={22} className="mx-auto mb-3" style={{ color: "var(--gw-border-strong)" }} />
            <div
              className="font-semibold mb-2"
              style={{ color: "var(--gw-text)", fontFamily: "var(--font-display)", fontSize: 20 }}
            >
              RECIPES IS A PRO FEATURE
            </div>
            <p className="text-sm mb-4 max-w-sm mx-auto" style={{ color: "var(--gw-text-2)" }}>
              Map menu items to ingredients so a sale automatically deducts stock, and import
              your end-of-shift POS sales to update everything at once.
            </p>
            <button
              onClick={() => requireOwner(openBillingPortal)}
              disabled={portalLoading}
              className="px-4 py-2 rounded-md text-sm font-mono font-semibold disabled:opacity-60"
              style={{ backgroundColor: "var(--gw-accent)", color: "var(--gw-bg)" }}
            >
              {portalLoading ? "Opening…" : "Upgrade to Pro — $50/mo"}
            </button>
          </div>
        )}

        {page === "recipes" && tier === "pro" && isOwner && (
          <RecipesPage
            shopId={shop.id}
            items={items}
            menuItems={menuItems}
            onAddMenuItem={addMenuItem}
            onDeleteMenuItem={deleteMenuItemHandler}
            onAddIngredient={addIngredientToMenuItem}
            onChangeIngredientAmount={changeIngredientAmount}
            onChangeIngredientItem={changeIngredientItem}
            onRemoveIngredient={removeIngredientFromMenuItem}
            onApplySales={applySales}
            onStockChanged={refreshStock}
          />
        )}

        {page === "alerts" && isOwner && (
          <AlertsPage
            shopId={shop.id}
            isDemoShop={isDemoShop}
            expirationAlertDays={expirationAlertDays}
            onChangeExpirationAlertDays={changeExpirationAlertDays}
          />
        )}

        <div className="mt-10 pt-5 border-t flex flex-wrap items-center justify-between gap-4" style={{ borderColor: "var(--gw-border)" }}>
          <div className="flex items-center gap-3 flex-wrap">
            {(page === "update" || page === "spreadsheet") && (
              <span className="text-[11px] font-mono" style={{ color: "var(--gw-text-3)" }}>
                Show quantities as
              </span>
            )}
            {/* Count/Amount only changes how Update and Spreadsheet show quantities */}
            {(page === "update" || page === "spreadsheet") && (
              <div
                className="flex items-center gap-1 p-1 rounded-lg border w-fit"
                style={{ borderColor: "var(--gw-border)", backgroundColor: "var(--gw-surface-sunk)" }}
                title="Units shows gallons, cartons, bags. Measure shows the total in oz, pumps, cups."
              >
                <button
                  onClick={() => changeDisplayMode("count")}
                  className="px-3 py-2 rounded-md text-xs font-mono"
                  style={{
                    backgroundColor: displayMode === "count" ? "var(--gw-surface-selected)" : "transparent",
                    color: displayMode === "count" ? "var(--gw-text)" : "var(--gw-text-3)",
                  }}
                >
                  Units
                </button>
                <button
                  onClick={() => changeDisplayMode("measurement")}
                  className="px-3 py-2 rounded-md text-xs font-mono"
                  style={{
                    backgroundColor: displayMode === "measurement" ? "var(--gw-surface-selected)" : "transparent",
                    color: displayMode === "measurement" ? "var(--gw-text)" : "var(--gw-text-3)",
                  }}
                >
                  Measure
                </button>
              </div>
            )}

            {!isDemoShop && isOwner && (
              <button
                onClick={() => setPinDialog({ mode: "settings" })}
                className="px-3 py-2 rounded-full text-[11px] font-mono border"
                style={{ borderColor: "var(--gw-border)", color: "var(--gw-text-3)" }}
              >
                {pinEnabled ? "Owner PIN" : "Set an owner PIN"}
              </button>
            )}

            {isDemoShop ? (
              <div
                className="px-3 py-2 rounded-full text-[11px] font-mono border"
                style={{ borderColor: "var(--gw-border)", color: "var(--gw-text-3)" }}
              >
                ★ Pro plan · Demo, billing off
              </div>
            ) : (
              <button
                onClick={() => requireOwner(openBillingPortal)}
                disabled={portalLoading}
                className="px-3 py-2 rounded-full text-[11px] font-mono border disabled:opacity-60"
                style={{
                  borderColor: tier === "pro" ? "var(--gw-accent)" : "var(--gw-border)",
                  color: tier === "pro" ? "var(--gw-accent-text)" : "var(--gw-text-3)",
                }}
              >
                {tier === "pro" ? "★ Pro plan" : "Standard plan"} · {portalLoading ? "Opening…" : "Manage billing"}
              </button>
            )}
          </div>
        </div>

        {mode === "batch" && page === "update" && (() => {
          const changed = items.filter((i) => {
            const d = batchDraft[i.id];
            return d !== undefined && d !== "" && d !== i.count;
          }).length;
          return (
            <div
              className="fixed inset-x-0 bottom-0 z-30 border-t px-4 py-3 flex items-center justify-center gap-4"
              style={{ borderColor: "var(--gw-border-strong)", backgroundColor: "var(--gw-surface-raised)" }}
            >
              <span className="text-sm font-mono" style={{ color: "var(--gw-text-2)" }}>
                {changed === 0 ? "No counts changed yet" : `${changed} count${changed === 1 ? "" : "s"} changed`}
              </span>
              <button
                onClick={saveBatch}
                className="px-4 py-2 min-h-11 rounded-md text-sm font-mono font-semibold flex items-center gap-1.5"
                style={{ backgroundColor: "var(--gw-accent)", color: "var(--gw-bg)" }}
              >
                <Check size={14} /> Save Closing Count
              </button>
            </div>
          );
        })()}

        {pinDialog && (
          <OwnerPinDialog
            mode={pinDialog.mode}
            pinEnabled={pinEnabled}
            onClose={() => setPinDialog(null)}
            onUnlocked={() => {
              const next = pinDialog.then;
              setOwnerUnlocked(true);
              setPinDialog(null);
              next?.();
            }}
            onPinChanged={(enabled) => {
              setPinEnabled(enabled);
              setOwnerUnlocked(false);
            }}
          />
        )}

        {(() => {
          const u = undo ? items.find((i) => i.id === undo.id) : undefined;
          if (!undo || !u || u.count === undo.from) return null;
          return <UndoBar text={`${u.name}: ${trimNumber(undo.from)} → ${trimNumber(u.count)} ${u.unit}`} onUndo={undoLast} />;
        })()}

        <div className="text-center font-mono text-[11px] uppercase tracking-widest mt-6" style={{ color: "var(--gw-text-3)" }}>
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
      style={{ backgroundColor: "var(--gw-bg)", fontFamily: "var(--font-sans)" }}
    >
      <div
        className="w-full max-w-md rounded-lg border p-6 text-center"
        style={{ borderColor: "var(--gw-border)", backgroundColor: "var(--gw-surface)" }}
      >
        <div className="font-mono text-xs uppercase tracking-[0.25em] mb-2" style={{ color: "var(--gw-accent-text)" }}>
          GroundWorks
        </div>
        <h1
          style={{ fontFamily: "var(--font-display)", color: "var(--gw-text)", fontSize: 26, fontWeight: 700 }}
          className="mb-2"
        >
          CHOOSE A PLAN FOR {shopName.toUpperCase()}
        </h1>
        <p className="text-sm mb-2" style={{ color: "var(--gw-text-2)" }}>
          Every shop needs an active plan to get into the dashboard.
        </p>
        <p className="text-xs mb-6" style={{ color: "var(--gw-text-3)" }}>
          New shops also pay a one-time $200 setup fee, charged once alongside your first month.
        </p>

        <div className="flex flex-col gap-3 mb-4">
          <button
            onClick={() => subscribe("standard")}
            disabled={loadingPlan !== null}
            className="w-full px-4 py-3 rounded-md text-sm font-mono font-semibold border disabled:opacity-60 text-left"
            style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
          >
            {loadingPlan === "standard" ? "Redirecting…" : "Standard — $40/mo"}
            <div className="text-xs font-normal mt-1" style={{ color: "var(--gw-text-2)" }}>
              Inventory tracking, no recipes
            </div>
          </button>
          <button
            onClick={() => subscribe("pro")}
            disabled={loadingPlan !== null}
            className="w-full px-4 py-3 rounded-md text-sm font-mono font-semibold disabled:opacity-60 text-left"
            style={{ backgroundColor: "var(--gw-accent)", color: "var(--gw-bg)" }}
          >
            {loadingPlan === "pro" ? "Redirecting…" : "Pro — $50/mo"}
            <div className="text-xs font-normal mt-1" style={{ color: "var(--gw-bg)", opacity: 0.7 }}>
              Everything in Standard, plus recipes
            </div>
          </button>
        </div>

        {error && (
          <div className="text-xs font-mono mb-4" style={{ color: "var(--gw-danger-text)" }}>
            {error}
          </div>
        )}

        <button
          onClick={onLogout}
          className="font-mono text-xs underline underline-offset-2"
          style={{ color: "var(--gw-text-2)" }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

// ---- Admin panel (view-only) ---------------------------------------------------------

const TIER_LABEL: Record<Tier, string> = { none: "No plan", standard: "Standard", pro: "★ Pro" };
const TIER_COLOR: Record<Tier, string> = { none: "var(--gw-text-3)", standard: "var(--gw-ok)", pro: "var(--gw-accent)" };

interface AdminShopDetailProps {
  shop: ShopSummary;
  onBack: () => void;
  onTierChanged: (shopId: string, tier: Tier) => void;
  onDeleted: (shopId: string) => void;
}

const TIER_OPTIONS: Tier[] = ["none", "standard", "pro"];

function AdminShopDetail({ shop, onBack, onTierChanged, onDeleted }: AdminShopDetailProps) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [tierUpdating, setTierUpdating] = useState(false);
  const [tierError, setTierError] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

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

  async function deleteShop() {
    if (deleting || confirmName.trim() !== shop.name) return;
    setDeleteError("");
    setDeleting(true);
    try {
      const res = await fetch("/api/admin/delete-shop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shopId: shop.id, confirmName }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        setDeleteError(data?.error || "Couldn't delete this shop.");
        return;
      }
      onDeleted(shop.id);
    } catch {
      setDeleteError("Couldn't delete this shop. Try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      <button
        onClick={onBack}
        className="font-mono text-xs mb-6 underline underline-offset-2"
        style={{ color: "var(--gw-text-2)" }}
      >
        ← All shops
      </button>
      <h2
        style={{ fontFamily: "var(--font-display)", color: "var(--gw-text)", fontSize: 28, fontWeight: 700 }}
        className="mb-1"
      >
        {shop.name.toUpperCase()}
      </h2>
      <p className="text-xs font-mono mb-4" style={{ color: TIER_COLOR[shop.tier] }}>
        {TIER_LABEL[shop.tier]}
      </p>

      <div className="rounded-lg border p-4 mb-8" style={{ borderColor: "var(--gw-border)", backgroundColor: "var(--gw-surface)" }}>
        <div className="font-mono text-xs uppercase tracking-widest mb-3" style={{ color: "var(--gw-accent-text)" }}>
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
                borderColor: t === shop.tier ? TIER_COLOR[t] : "var(--gw-border)",
                backgroundColor: t === shop.tier ? TIER_COLOR[t] : "transparent",
                color: t === shop.tier ? "var(--gw-bg)" : "var(--gw-text-2)",
              }}
            >
              {TIER_LABEL[t]}
            </button>
          ))}
          {tierUpdating && (
            <span className="font-mono text-xs" style={{ color: "var(--gw-text-3)" }}>
              Saving…
            </span>
          )}
        </div>
        {tierError && (
          <div className="text-xs font-mono mb-2" style={{ color: "var(--gw-danger-text)" }}>
            {tierError}
          </div>
        )}
        <p className="text-[11px] font-mono leading-relaxed" style={{ color: "var(--gw-text-3)" }}>
          {hasActiveSubscription
            ? `This shop has an active Stripe subscription (${shop.subscriptionStatus}) — an override here can get replaced the next time Stripe sends a billing event (renewal, plan change, etc.). Use the shop's own Stripe subscription if you need a permanent change.`
            : "This shop has no active Stripe subscription, so an override here sticks until they ever subscribe through Stripe."}
        </p>
      </div>

      <div className="rounded-lg border p-4 mb-8" style={{ borderColor: "var(--gw-danger-text)" }}>
        <div className="font-mono text-xs uppercase tracking-widest mb-2" style={{ color: "var(--gw-danger-text)" }}>
          Delete shop
        </div>
        {hasActiveSubscription ? (
          <p className="text-sm" style={{ color: "var(--gw-text-2)" }}>
            This shop has a live Stripe subscription ({shop.subscriptionStatus}). Cancel it in Stripe first, then come back to delete the shop.
          </p>
        ) : (
          <>
            <p className="text-sm mb-3" style={{ color: "var(--gw-text-2)" }}>
              Permanently deletes this shop, its login, inventory, recipes, alert numbers and Square connection. This can&apos;t be undone. Type the shop name to confirm.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <input
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder={shop.name}
                aria-label="Type the shop name to confirm"
                className="flex-1 min-w-[10rem] rounded-md border px-3 py-2 bg-transparent focus:outline-none"
                style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
              />
              <button
                onClick={deleteShop}
                disabled={deleting || confirmName.trim() !== shop.name}
                className="px-4 py-2 min-h-11 rounded-md text-sm font-mono font-semibold border disabled:opacity-40"
                style={{ borderColor: "var(--gw-danger-text)", color: "var(--gw-danger-text)" }}
              >
                {deleting ? "Deleting…" : "Delete shop"}
              </button>
            </div>
          </>
        )}
        {deleteError && (
          <div role="alert" className="text-xs font-mono mt-2" style={{ color: "var(--gw-danger-text)" }}>
            {deleteError}
          </div>
        )}
      </div>

      {loading && (
        <div className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--gw-text-3)" }}>
          Loading…
        </div>
      )}
      {loadError && (
        <div className="text-sm font-mono" style={{ color: "var(--gw-danger-text)" }}>
          {loadError}
        </div>
      )}

      {!loading && !loadError && (
        <>
          <h3 className="font-mono text-xs uppercase tracking-widest mb-2" style={{ color: "var(--gw-accent-text)" }}>
            Inventory ({items.length})
          </h3>
          {items.length === 0 ? (
            <p className="text-sm mb-8" style={{ color: "var(--gw-text-2)" }}>
              No items.
            </p>
          ) : (
            <div className="rounded-lg border overflow-x-auto mb-8" style={{ borderColor: "var(--gw-border)" }}>
              <table className="w-full border-collapse font-mono text-sm">
                <thead>
                  <tr style={{ backgroundColor: "var(--gw-surface-raised)" }}>
                    {["Item", "Category", "Count", "Threshold"].map((label) => (
                      <th
                        key={label}
                        className="text-left px-3 py-2 text-[11px] uppercase tracking-widest"
                        style={{ color: "var(--gw-text-2)", borderBottom: "1px solid var(--gw-border)" }}
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
                        backgroundColor: idx % 2 === 0 ? "transparent" : "var(--gw-surface)",
                        borderBottom: "1px solid var(--gw-border-faint)",
                      }}
                    >
                      <td className="px-3 py-2" style={{ color: "var(--gw-text)" }}>
                        {item.name}
                      </td>
                      <td className="px-3 py-2" style={{ color: "var(--gw-text-2)" }}>
                        {CATEGORY_LABEL[item.category]}
                      </td>
                      <td className="px-3 py-2" style={{ color: "var(--gw-text)" }}>
                        {item.count} {item.unit}
                      </td>
                      <td className="px-3 py-2" style={{ color: "var(--gw-text-2)" }}>
                        {item.threshold}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 className="font-mono text-xs uppercase tracking-widest mb-2" style={{ color: "var(--gw-accent-text)" }}>
            Recipes ({menuItems.length})
          </h3>
          {menuItems.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--gw-text-2)" }}>
              No recipes.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {menuItems.map((mi) => (
                <div key={mi.id} className="rounded-lg border p-3" style={{ borderColor: "var(--gw-border)" }}>
                  <div className="font-semibold mb-1" style={{ color: "var(--gw-text)" }}>
                    {mi.name}
                  </div>
                  <ul className="text-xs font-mono flex flex-col gap-0.5" style={{ color: "var(--gw-text-2)" }}>
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

  function handleDeleted(shopId: string) {
    setShops((prev) => prev.filter((s) => s.id !== shopId));
    setSelectedShopId(null);
  }

  return (
    <div className="min-h-screen w-full" style={{ backgroundColor: "var(--gw-bg)", fontFamily: "var(--font-sans)" }}>
      <div className="max-w-2xl md:max-w-4xl mx-auto px-5 py-10">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <div className="font-mono text-xs uppercase tracking-[0.25em] mb-2" style={{ color: "var(--gw-accent-text)" }}>
              GroundWorks
            </div>
            <h1
              style={{
                fontFamily: "var(--font-display)",
                color: "var(--gw-text)",
                fontSize: 40,
                fontWeight: 700,
                letterSpacing: "0.01em",
                lineHeight: 1,
              }}
            >
              ADMIN
            </h1>
            <p className="text-sm mt-2" style={{ color: "var(--gw-text-2)" }}>
              {shops.length} shop{shops.length === 1 ? "" : "s"} signed up
            </p>
          </div>
          <button
            onClick={onLogout}
            className="font-mono text-xs mt-1 underline underline-offset-2"
            style={{ color: "var(--gw-text-2)" }}
          >
            Sign out
          </button>
        </div>

        {selectedShop ? (
          <AdminShopDetail
            shop={selectedShop}
            onBack={() => setSelectedShopId(null)}
            onTierChanged={handleTierChanged}
            onDeleted={handleDeleted}
          />
        ) : (
          <>
            {loading && (
              <div className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--gw-text-3)" }}>
                Loading shops…
              </div>
            )}
            {loadError && (
              <div className="text-sm font-mono" style={{ color: "var(--gw-danger-text)" }}>
                {loadError}
              </div>
            )}
            {!loading && !loadError && shops.length === 0 && (
              <div className="text-sm" style={{ color: "var(--gw-text-2)" }}>
                No shops signed up yet.
              </div>
            )}
            {!loading && shops.length > 0 && (
              <div className="rounded-lg border overflow-x-auto" style={{ borderColor: "var(--gw-border)" }}>
                <table className="w-full border-collapse font-mono text-sm">
                  <thead>
                    <tr style={{ backgroundColor: "var(--gw-surface-raised)" }}>
                      {["Shop", "Plan", "Signed up"].map((label) => (
                        <th
                          key={label}
                          className="text-left px-3 py-2.5 text-[11px] uppercase tracking-widest"
                          style={{ color: "var(--gw-text-2)", borderBottom: "1px solid var(--gw-border)" }}
                        >
                          {label}
                        </th>
                      ))}
                      <th style={{ borderBottom: "1px solid var(--gw-border)" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {shops.map((s, idx) => (
                      <tr
                        key={s.id}
                        style={{
                          backgroundColor: idx % 2 === 0 ? "transparent" : "var(--gw-surface)",
                          borderBottom: "1px solid var(--gw-border-faint)",
                        }}
                      >
                        <td className="px-3 py-2.5" style={{ color: "var(--gw-text)" }}>
                          {s.name}
                        </td>
                        <td className="px-3 py-2.5" style={{ color: TIER_COLOR[s.tier] }}>
                          {TIER_LABEL[s.tier]}
                        </td>
                        <td className="px-3 py-2.5" style={{ color: "var(--gw-text-2)" }}>
                          {new Date(s.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <button
                            onClick={() => setSelectedShopId(s.id)}
                            className="text-xs px-2 py-1 rounded border"
                            style={{ borderColor: "var(--gw-border)", color: "var(--gw-text-2)" }}
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

export default function InventoryTracker({ initialAuthMode = "sign-in" }: { initialAuthMode?: AuthMode }) {
  const supabase = useMemo(() => createClient(), []);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [shop, setShop] = useState<ShopProfile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Signing in from /login or /signup happens client-side, so the URL would
    // otherwise stay on the auth route while the dashboard is showing.
    function leaveAuthRoute() {
      if (typeof window === "undefined") return;
      const { pathname } = window.location;
      if (pathname === "/login" || pathname === "/signup") window.history.replaceState(null, "", "/");
    }

    async function loadUser(userId: string) {
      // Admin identities (supabase/006_admin.sql) don't have a shops row
      // of their own by design — check this first, before the "no shop
      // row found" branch below would otherwise treat them as signed out.
      const { data: adminRow } = await supabase.from("admins").select("id").eq("id", userId).maybeSingle();
      if (cancelled) return;
      if (adminRow) {
        setIsAdmin(true);
        setShop(null);
        leaveAuthRoute();
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
      leaveAuthRoute();
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
      <div className="min-h-screen w-full flex items-center justify-center" style={{ backgroundColor: "var(--gw-bg)" }}>
        <div className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--gw-text-3)" }}>
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
    return <LoginScreen initialMode={initialAuthMode} />;
  }

  if (shop.tier === "none") {
    return <NoPlanScreen shopName={shop.name} onLogout={logout} />;
  }

  return <ShopDashboard key={shop.id} shop={shop} onLogout={logout} />;
}
