import type { InventoryItem, Status } from "./types";

// The "What to order" list: everything at or below its reorder level, most
// urgent first, with a suggested amount to buy. Pure functions so the rules
// can be tested on their own. The status thresholds match the rest of the app
// (and the text alerts): critical at half the reorder level or below, low at
// the reorder level or below.

export function statusOf(item: Pick<InventoryItem, "count" | "threshold">): Status {
  if (item.count <= item.threshold * 0.5) return "critical";
  if (item.count <= item.threshold) return "low";
  return "good";
}

export interface OrderLine {
  item: InventoryItem;
  status: "critical" | "low";
  // How many stocking units to buy: enough to get back to twice the reorder
  // level, and always at least one.
  suggested: number;
  ordered: boolean;
}

export function suggestedQuantity(item: Pick<InventoryItem, "count" | "threshold">): number {
  const par = item.threshold * 2;
  return Math.max(1, Math.ceil(par - item.count));
}

export interface OrderList {
  toOrder: OrderLine[];
  ordered: OrderLine[];
}

export function buildOrderList(items: InventoryItem[], orderedIds: ReadonlySet<number>): OrderList {
  const lines: OrderLine[] = [];
  for (const item of items) {
    const status = statusOf(item);
    // An item that's back above its reorder level is simply not on the list,
    // whether or not somebody had marked it ordered.
    if (status === "good") continue;
    lines.push({ item, status, suggested: suggestedQuantity(item), ordered: orderedIds.has(item.id) });
  }
  lines.sort((a, b) => {
    if (a.status !== b.status) return a.status === "critical" ? -1 : 1;
    return a.item.name.localeCompare(b.item.name);
  });
  return { toOrder: lines.filter((l) => !l.ordered), ordered: lines.filter((l) => l.ordered) };
}

function trim(n: number): string {
  return String(Math.round(n * 100) / 100);
}

// Plain text for sharing or pasting into a supplier's order form.
export function orderText(shopName: string, lines: OrderLine[], date: Date): string {
  const day = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const body = lines.map((l) => `• ${l.item.name}: ${trim(l.suggested)} ${l.item.unit} (have ${trim(l.item.count)})`);
  return [`Order list for ${shopName} — ${day}`, ...body].join("\n");
}
