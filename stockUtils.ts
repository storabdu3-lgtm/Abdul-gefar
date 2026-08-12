import { getAll, COLLECTIONS } from "@/lib/firestore";
import type { StockIn, PosSale, Transfer, DamageReturn, Expense, DirectSale, StoreRequest } from "@/lib/types";

export interface StockBalance {
  productId: string;
  productName: string;
  productCode: string;
  photoUrl: string;
  quantity: number;
  quantityPerCarton: number;
}

/**
 * Compute live stock balances by replaying all transactions.
 * If storeId is provided, returns balances for that store only.
 * If storeId is omitted, returns totals summed across all stores.
 */
export async function computeStockBalances(storeId?: string): Promise<Record<string, StockBalance>> {
  const [stockIns, sales, transfers, damages, expenses, directSales, storeRequests] = await Promise.all([
    getAll<StockIn>(COLLECTIONS.STOCK_IN),
    getAll<PosSale>(COLLECTIONS.POS_SALES),
    getAll<Transfer>(COLLECTIONS.TRANSFERS),
    getAll<DamageReturn>(COLLECTIONS.DAMAGE_RETURNS),
    getAll<Expense>(COLLECTIONS.EXPENSES),
    getAll<DirectSale>(COLLECTIONS.DIRECT_SALES),
    getAll<StoreRequest>(COLLECTIONS.STORE_REQUESTS),
  ]);

  const balance: Record<string, StockBalance> = {};

  function ensureRow(pid: string, name: string, code: string, photo: string, qpc = 1) {
    if (!balance[pid]) {
      balance[pid] = { productId: pid, productName: name, productCode: code, photoUrl: photo, quantity: 0, quantityPerCarton: qpc };
    } else if (qpc > 1) {
      balance[pid].quantityPerCarton = qpc;
    }
  }

  // Stock In → adds
  for (const si of stockIns.filter(s => s.status !== "voided" && s.status !== "pending" && (!storeId || s.storeId === storeId))) {
    for (const item of si.items || []) {
      ensureRow(item.productId, item.productName, item.productCode, item.photoUrl || "", item.quantityPerCarton || 1);
      balance[item.productId].quantity += item.cartonsReceived * item.quantityPerCarton;
    }
  }

  // Sales → deducts
  for (const sale of sales.filter(s => s.status !== "voided" && s.status !== "pending" && (!storeId || s.storeId === storeId))) {
    for (const item of sale.items || []) {
      ensureRow(item.productId, item.productName, item.productCode, item.photoUrl || "");
      balance[item.productId].quantity -= item.quantity;
    }
  }

  // Transfers Out → deducts
  for (const t of transfers.filter(tr => tr.status !== "voided" && tr.status !== "pending" && (!storeId || tr.fromStoreId === storeId))) {
    for (const item of t.items || []) {
      ensureRow(item.productId, item.productName, item.productCode, item.photoUrl || "", item.quantityPerCarton || 1);
      balance[item.productId].quantity -= item.quantity;
    }
  }

  // Transfers In → adds
  for (const t of transfers.filter(tr => tr.status !== "voided" && tr.status !== "pending" && (!storeId || tr.toStoreId === storeId))) {
    for (const item of t.items || []) {
      ensureRow(item.productId, item.productName, item.productCode, item.photoUrl || "", item.quantityPerCarton || 1);
      balance[item.productId].quantity += item.quantity;
    }
  }

  // Damages/Returns → deducts
  for (const d of damages.filter(dm => dm.status !== "voided" && dm.status !== "pending" && (!storeId || dm.storeId === storeId))) {
    for (const item of d.items || []) {
      ensureRow(item.productId, item.productName, item.productCode, "");
      balance[item.productId].quantity -= item.quantity;
    }
  }

  // Product Expenses → deducts
  for (const exp of expenses.filter(e => e.type === "product" && e.status !== "voided" && e.status !== "pending" && (!storeId || e.storeId === storeId))) {
    for (const item of (exp.items || []) as Array<{ productId?: string; productName?: string; productCode?: string; quantity: number }>) {
      if (!item.productId) continue;
      ensureRow(item.productId, item.productName || "", item.productCode || "", "");
      balance[item.productId].quantity -= item.quantity;
    }
  }

  // Direct Sales → deducts (active or approved)
  for (const ds of directSales.filter(d => d.status !== "voided" && (!storeId || d.storeId === storeId))) {
    for (const item of ds.items || []) {
      ensureRow(item.productId, item.productName, item.productCode, item.photoUrl || "", item.quantityPerCarton || 1);
      const actualQty = item.sellByCarton ? item.quantity * (item.quantityPerCarton || 1) : item.quantity;
      balance[item.productId].quantity -= actualQty;
    }
  }

  // storeRequests used only to prevent unused variable warning — stock movement handled via Transfer docs created on receive
  void storeRequests;

  return balance;
}
