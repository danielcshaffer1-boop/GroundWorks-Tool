import type { InventoryItem, SaleLine } from "./types";

// Reads a pasted or uploaded POS item-sales report and turns it into
// "this many of this menu item sold" rows. Pure functions, no React, so the
// logic can be tested on its own.
//
// What it understands:
//  - CSV (comma, semicolon or pipe), TSV (copied out of a spreadsheet), with
//    quoted fields, a BOM, and Windows line endings.
//  - A header row from a real POS export, matched by name rather than
//    position, so extra columns (category, gross sales, tax...) are ignored.
//    Item-name headers like "Item Name" / "Menu Item" / "Product", quantity
//    headers like "Items Sold" / "Qty" / "Item Qty" / "Quantity". Header
//    names are based on Toast's data-export docs and a Square community
//    thread; they have not been checked against real exports from either.
//  - No header at all: two columns, name then quantity (or the reverse).
//  - Voided rows (a "Void?" column), total rows, refunds/negatives, and
//    thousands separators ("1,204") in quantities.
//  - Duplicate rows for the same item (e.g. one per size) are summed.

export interface ParsedRow {
  key: string;
  name: string;
  variation: string | null;
  qty: number;
}

export interface ParseResult {
  rows: ParsedRow[];
  notes: string[];
  error: string | null;
  // Set when the file has a header row we couldn't read by name: the labels,
  // so the owner can pick the item-name and quantity columns themselves.
  columns?: string[];
}

export interface ColumnChoice {
  nameCol: number;
  qtyCol: number;
}

export interface Recipe {
  id: number;
  name: string;
}

export type MatchKind = "exact" | "alias" | "cleaned" | "none";

export interface Match {
  recipeId: number | null;
  kind: MatchKind;
  suggestionId: number | null;
  suggestionScore: number;
}

const NAME_HEADERS = [
  "menu item",
  "item name",
  "item",
  "product name",
  "product",
  "product option", // SumUp: "Product / option"
  "product title",
  "menu item name",
  "item description",
  "description",
  "recipe",
  "name",
];
// Order matters: the most specific / least-ambiguous header wins ("Item Qty"
// is Toast's quantity excluding voids, preferred over the "(incl voids)" one,
// which normalizes to something different and is never matched).
const QTY_HEADERS = [
  "item qty",
  "qty sold",
  "items sold",
  "quantity sold",
  "units sold",
  "net qty",
  "net quantity",
  "item quantity",
  "total quantity",
  "total qty",
  "sales qty",
  "number sold",
  "quantity",
  "qty",
  "units",
  "count",
  "sold",
];
const VARIATION_HEADERS = ["item variation", "variation", "size"];
const BANNED_IN_QTY = ["void", "refund", "return", "waste", "incl"];
const GENERIC_VARIATIONS = new Set(["", "regular", "default", "standard", "none", "original", "normal"]);

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeHeader(h: string): string {
  return normalizeName(h);
}

function detectDelimiter(text: string): string {
  const sample = text.split("\n").slice(0, 12).join("\n");
  if (sample.includes("\t")) return "\t";
  let best = ",";
  let bestCount = 0;
  for (const d of [",", ";", "|"]) {
    const count = sample.split(d).length - 1;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

// Small quote-aware delimited-text parser: handles "a, b" fields, "" escapes
// and newlines inside quotes.
function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export function parseQty(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const cleaned = raw.trim().replace(/^"|"$/g, "").replace(/\s/g, "");
  if (!/^-?\d[\d,]*(\.\d+)?$/.test(cleaned) && !/^-?\.\d+$/.test(cleaned)) return null;
  const n = Number(cleaned.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function findColumn(headers: string[], candidates: string[], banned: string[] = []): number {
  for (const candidate of candidates) {
    const idx = headers.findIndex((h) => h === candidate && !banned.some((b) => h.includes(b)));
    if (idx >= 0) return idx;
  }
  return -1;
}

// One sold line (also used for lines that arrive from a POS connection rather
// than a file): drops "Regular"-style placeholder variations and builds the
// key that identical lines are grouped and remembered under.
export function buildRow(name: string, variation: string | null | undefined, qty: number): ParsedRow {
  const rawVar = (variation ?? "").trim();
  const cleanVar = GENERIC_VARIATIONS.has(rawVar.toLowerCase()) ? null : rawVar;
  return { key: `${normalizeName(name)}|${normalizeName(cleanVar ?? "")}`, name: name.trim(), variation: cleanVar, qty };
}

const TOTAL_ROW = /^(grand\s+)?(sub)?totals?$/i;
const TRUTHY = new Set(["true", "yes", "y", "1"]);

// The row holding column labels when none of them are ones we know: the first
// of the top few rows that has several filled cells and no numbers in them.
function findHeaderRow(table: string[][]): number {
  for (let r = 0; r < Math.min(table.length, 6); r++) {
    const filled = table[r].filter((c) => c.trim() !== "");
    if (filled.length >= 3 && filled.every((c) => parseQty(c) === null)) return r;
  }
  return -1;
}

export function parseSalesText(input: string, override?: ColumnChoice): ParseResult {
  const text = input.replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
  if (!text) return { rows: [], notes: [], error: "Paste your sales report first." };

  const delimiter = detectDelimiter(text);
  const table = parseDelimited(text, delimiter);
  if (table.length === 0) return { rows: [], notes: [], error: "Paste your sales report first." };

  const notes: string[] = [];
  let nameIdx = -1;
  let qtyIdx = -1;
  let varIdx = -1;
  let voidIdx = -1;
  let start = 0;

  // 0) The owner picked the columns themselves (the file's labels weren't ones
  //    we know).
  if (override) {
    const headerRow = findHeaderRow(table);
    const labels = headerRow >= 0 ? table[headerRow] : [];
    nameIdx = override.nameCol;
    qtyIdx = override.qtyCol;
    start = headerRow + 1;
    voidIdx = labels.map(normalizeHeader).findIndex((h) => h === "void");
    notes.push(`Reading item names from "${labels[nameIdx]?.trim()}" and quantities from "${labels[qtyIdx]?.trim()}".`);
  }

  // 1) A header row, found anywhere in the first few rows (some exports put
  //    a title or date range above it).
  for (let r = 0; r < Math.min(table.length, 6) && nameIdx < 0; r++) {
    const headers = table[r].map(normalizeHeader);
    const n = findColumn(headers, NAME_HEADERS);
    const q = findColumn(headers, QTY_HEADERS, BANNED_IN_QTY);
    if (n >= 0 && q >= 0 && n !== q) {
      nameIdx = n;
      qtyIdx = q;
      varIdx = findColumn(headers, VARIATION_HEADERS);
      voidIdx = headers.findIndex((h) => h === "void");
      start = r + 1;
      notes.push(`Reading item names from "${table[r][n].trim()}" and quantities from "${table[r][q].trim()}".`);
      break;
    }
  }

  // 2) No recognizable header. A wide file with a header row we can't read
  //    must not be guessed at (it would happily pick "Tax" as the quantity),
  //    so hand the labels back and let the owner choose. Otherwise infer which
  //    column holds quantities.
  if (nameIdx < 0) {
    const headerRow = findHeaderRow(table);
    if (headerRow >= 0) {
      return {
        rows: [],
        notes,
        columns: table[headerRow].map((c) => c.trim()),
        error: "We don't recognize this report's column names yet. Pick which column is the item name and which is the quantity sold.",
      };
    }
    const sample = table.slice(0, 20);
    const width = Math.max(...sample.map((r) => r.length));
    let bestCol = -1;
    let bestRatio = 0;
    for (let c = 0; c < width; c++) {
      const cells = sample.map((r) => r[c]).filter((v) => v !== undefined && v.trim() !== "");
      if (cells.length === 0) continue;
      const ratio = cells.filter((v) => parseQty(v) !== null).length / cells.length;
      // Last numeric-looking column wins ties: names come first in practice.
      if (ratio >= bestRatio && ratio >= 0.5) {
        bestCol = c;
        bestRatio = ratio;
      }
    }
    if (bestCol < 0 || width < 2) {
      const first = table[0].map((c) => c.trim()).filter(Boolean);
      const hint = first.length > 1 ? ` (the first row has the columns: ${first.join(", ")})` : "";
      return {
        rows: [],
        notes,
        error:
          `Couldn't find a quantity column${hint}. Use an export with columns like "Item Name" and "Items Sold" ` +
          `(or "Menu Item" and "Qty"), or paste two columns: item name, then quantity sold.`,
      };
    }
    qtyIdx = bestCol;
    nameIdx = bestCol === 0 ? 1 : 0;
  }

  const bucket = new Map<string, ParsedRow>();
  let noQty = 0;
  let voided = 0;
  let negative = 0;

  for (const cells of table.slice(start)) {
    const name = (cells[nameIdx] ?? "").trim();
    if (!name || TOTAL_ROW.test(name)) continue;
    if (voidIdx >= 0 && TRUTHY.has((cells[voidIdx] ?? "").trim().toLowerCase())) {
      voided++;
      continue;
    }
    const qty = parseQty(cells[qtyIdx]);
    if (qty === null) {
      noQty++;
      continue;
    }
    if (qty <= 0) {
      negative++;
      continue;
    }
    const rawVar = varIdx >= 0 ? (cells[varIdx] ?? "").trim() : "";
    const row = buildRow(name, rawVar, qty);
    const existing = bucket.get(row.key);
    if (existing) existing.qty += qty;
    else bucket.set(row.key, row);
  }

  const rows = [...bucket.values()];
  if (voided) notes.push(`Skipped ${voided} voided row${voided === 1 ? "" : "s"}.`);
  if (negative) notes.push(`Skipped ${negative} row${negative === 1 ? "" : "s"} with a zero or negative quantity (returns).`);
  if (noQty) notes.push(`Skipped ${noQty} row${noQty === 1 ? "" : "s"} with no quantity.`);

  if (rows.length === 0) {
    return {
      rows,
      notes,
      error: "Found the columns, but no rows with a sold quantity above zero. Check the report covers the dates you meant.",
    };
  }
  return { rows, notes, error: null };
}

// ---- Matching POS item names to recipes -----------------------------------

const SIZE_WORDS = /\b(small|medium|large|sm|md|lg|xl|short|tall|grande|venti|regular|iced|hot|\d+\s?oz)\s*$/i;

function cleanedForms(name: string): string[] {
  const forms = new Set<string>();
  const noParens = name.replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ");
  forms.add(noParens);
  forms.add(noParens.split(/\s[-–—]\s/)[0]);
  let trimmed = noParens.split(/\s[-–—]\s/)[0].trim();
  for (let i = 0; i < 3 && SIZE_WORDS.test(trimmed); i++) {
    trimmed = trimmed.replace(SIZE_WORDS, "").trim();
    forms.add(trimmed);
  }
  return [...forms].map(normalizeName).filter(Boolean);
}

function tokenScore(a: string, b: string): number {
  const ta = new Set(normalizeName(a).split(" ").filter(Boolean));
  const tb = new Set(normalizeName(b).split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

export function matchRecipe(row: ParsedRow, recipes: Recipe[], aliases: Record<string, number>): Match {
  const byNorm = new Map<string, Recipe[]>();
  for (const r of recipes) {
    const k = normalizeName(r.name);
    byNorm.set(k, [...(byNorm.get(k) ?? []), r]);
  }
  const recipeById = new Map(recipes.map((r) => [r.id, r]));

  const candidates = row.variation ? [`${row.name} ${row.variation}`, row.name] : [row.name];

  for (const c of candidates) {
    const hit = byNorm.get(normalizeName(c));
    if (hit && hit.length === 1) return { recipeId: hit[0].id, kind: "exact", suggestionId: null, suggestionScore: 1 };
  }
  for (const c of candidates) {
    const aliased = aliases[normalizeName(c)];
    if (aliased !== undefined && recipeById.has(aliased)) {
      return { recipeId: aliased, kind: "alias", suggestionId: null, suggestionScore: 1 };
    }
  }
  const cleanedHits = new Set<number>();
  for (const form of cleanedForms(row.name)) {
    const hit = byNorm.get(form);
    if (hit && hit.length === 1) cleanedHits.add(hit[0].id);
  }
  if (cleanedHits.size === 1) {
    return { recipeId: [...cleanedHits][0], kind: "cleaned", suggestionId: null, suggestionScore: 1 };
  }

  let bestId: number | null = null;
  let bestScore = 0;
  for (const r of recipes) {
    const s = tokenScore(row.name, r.name);
    if (s > bestScore) {
      bestScore = s;
      bestId = r.id;
    }
  }
  return {
    recipeId: null,
    kind: "none",
    suggestionId: bestScore >= 0.5 ? bestId : null,
    suggestionScore: bestScore,
  };
}

// ---- Stock math (shared by the preview and the real apply) ----------------

export interface DeductionResult {
  // inventory item id -> amount used, in that item's own stocking unit
  byItem: Record<number, number>;
  // ingredients that cannot be deducted because the item has no amount-per-unit
  skipped: { recipe: string; item: string }[];
}

export function computeDeductions(sales: SaleLine[], items: InventoryItem[]): DeductionResult {
  const byItem: Record<number, number> = {};
  const skipped: { recipe: string; item: string }[] = [];
  for (const { menuItem, qty } of sales) {
    for (const ing of menuItem.ingredients) {
      const item = items.find((i) => i.id === ing.itemId);
      if (!item || !item.unitSize) {
        skipped.push({ recipe: menuItem.name, item: item?.name ?? "a removed item" });
        continue;
      }
      byItem[ing.itemId] = (byItem[ing.itemId] || 0) + (ing.amount * qty) / item.unitSize;
    }
  }
  return { byItem, skipped };
}

// Cheap stable fingerprint of a parsed report, used to warn before the same
// report is applied twice (which would deduct everything twice).
export function fingerprintRows(rows: ParsedRow[]): string {
  const canon = rows
    .map((r) => `${r.key}=${r.qty}`)
    .sort()
    .join(";");
  let h = 5381;
  for (let i = 0; i < canon.length; i++) h = ((h << 5) + h + canon.charCodeAt(i)) | 0;
  return String(h >>> 0);
}
