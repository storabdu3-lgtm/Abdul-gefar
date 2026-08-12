import { useState, useEffect, useCallback } from "react";
import { getAll, COLLECTIONS } from "@/lib/firestore";
import type { Customer, Product, PosSale, StoreBalance } from "@/lib/types";
import { Timestamp } from "firebase/firestore";

export interface AppNotification {
  id: string;
  type: "overdue_payment" | "low_stock";
  title: string;
  message: string;
  severity: "warning" | "error";
  photoUrl?: string;
  code?: string;
}

function toDate(val: unknown): Date | null {
  if (!val) return null;
  if (val instanceof Timestamp) return val.toDate();
  if (val instanceof Date) return val;
  if (typeof val === "string") return new Date(val);
  return null;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const LS_KEY = "nexusstock_notified_ids";

function getPersistedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function persistId(id: string) {
  try {
    const existing = getPersistedIds();
    existing.add(id);
    localStorage.setItem(LS_KEY, JSON.stringify([...existing]));
  } catch {
    // ignore storage errors
  }
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [permissionGranted, setPermissionGranted] = useState(false);

  const requestPermission = useCallback(async () => {
    if ("Notification" in window && Notification.permission === "default") {
      const result = await Notification.requestPermission();
      setPermissionGranted(result === "granted");
    } else if ("Notification" in window && Notification.permission === "granted") {
      setPermissionGranted(true);
    }
  }, []);

  function sendBrowserNotification(id: string, title: string, body: string) {
    // Only fire if this exact alert ID has never been shown before (persisted across sessions)
    const alreadySeen = getPersistedIds().has(id);
    if (alreadySeen) return;
    persistId(id);
    if ("Notification" in window && Notification.permission === "granted") {
      try {
        new Notification(title, { body, icon: "/favicon.ico" });
      } catch {
        // silently ignore if blocked
      }
    }
  }

  const refresh = useCallback(async () => {
    try {
      const [customers, sales, products, balances] = await Promise.all([
        getAll<Customer>(COLLECTIONS.CUSTOMERS),
        getAll<PosSale>(COLLECTIONS.POS_SALES),
        getAll<Product>(COLLECTIONS.PRODUCTS),
        getAll<StoreBalance>(COLLECTIONS.STORE_BALANCE),
      ]);

      const now = Date.now();
      const newNotifs: AppNotification[] = [];

      // ── Overdue customer payments (remaining balance on a sale older than 30 days) ──
      const oldSalesWithBalance = sales.filter(sale => {
        if (sale.status === "voided") return false;
        if (!sale.remainingBalance || sale.remainingBalance <= 0) return false;
        const date = toDate(sale.createdAt);
        if (!date) return false;
        return now - date.getTime() > THIRTY_DAYS_MS;
      });

      const overdueByCustomer: Record<string, { name: string; total: number; count: number }> = {};
      for (const sale of oldSalesWithBalance) {
        const key = sale.customerId || sale.customerName || "walk-in";
        const name = sale.customerName || "Walk-in";
        if (!overdueByCustomer[key]) overdueByCustomer[key] = { name, total: 0, count: 0 };
        overdueByCustomer[key].total += sale.remainingBalance;
        overdueByCustomer[key].count += 1;
      }

      for (const [key, data] of Object.entries(overdueByCustomer)) {
        const id = `overdue-${key}`;
        newNotifs.push({
          id,
          type: "overdue_payment",
          title: `Overdue Payment: ${data.name}`,
          message: `$${data.total.toFixed(2)} unpaid across ${data.count} sale(s) — over 30 days`,
          severity: "error",
        });
        sendBrowserNotification(id, `Overdue Payment: ${data.name}`, `$${data.total.toFixed(2)} unpaid across ${data.count} sale(s) — over 30 days`);
      }

      // ── Also check customers with totalBalance > 0 (direct balance, e.g. from ecommerce) ──
      for (const customer of customers) {
        if (!customer.totalBalance || customer.totalBalance <= 0) continue;
        const key = customer.id;
        if (overdueByCustomer[key]) continue;
        const date = toDate(customer.createdAt);
        if (!date) continue;
        if (now - date.getTime() > THIRTY_DAYS_MS) {
          const id = `overdue-cust-${key}`;
          newNotifs.push({
            id,
            type: "overdue_payment",
            title: `Overdue Payment: ${customer.name}`,
            message: `$${customer.totalBalance.toFixed(2)} outstanding balance — over 30 days`,
            severity: "error",
          });
          sendBrowserNotification(id, `Overdue Payment: ${customer.name}`, `$${customer.totalBalance.toFixed(2)} outstanding balance — over 30 days`);
        }
      }

      // ── Low stock alerts (per store, showing store name & remaining balance) ──
      const productMap: Record<string, Product> = {};
      for (const product of products) productMap[product.id] = product;

      for (const bal of balances) {
        const product = productMap[bal.productId];
        if (!product) continue;
        const minAlert = product.minCartonAlert || 0;
        if (minAlert <= 0) continue;
        const qtyPerCarton = product.quantityPerCarton || 1;
        const balanceCartons = bal.quantity / qtyPerCarton;
        // Only alert when AT OR BELOW the minimum alert level
        if (balanceCartons > minAlert) continue;
        const id = `low-stock-${product.id}-${bal.storeId}`;
        const msgStore = bal.storeName || "Unknown Store";
        const msgUnits = `${bal.quantity} unit${bal.quantity !== 1 ? "s" : ""}`;
        const msgCartons = balanceCartons % 1 === 0
          ? `${balanceCartons} carton${balanceCartons !== 1 ? "s" : ""}`
          : `${balanceCartons.toFixed(1)} cartons`;
        newNotifs.push({
          id,
          type: "low_stock",
          title: `Low Stock: ${product.name}`,
          message: `${msgStore} — ${msgUnits} (${msgCartons}) remaining · Min alert: ${minAlert} cartons`,
          severity: bal.quantity <= 0 ? "error" : "warning",
          photoUrl: product.photoUrl || bal.photoUrl,
          code: product.code,
        });
        sendBrowserNotification(
          id,
          `Low Stock: ${product.name}`,
          `${msgStore}: ${msgUnits} remaining (min: ${minAlert} cartons)`
        );
      }

      setNotifications(newNotifs);
    } catch {
      // ignore errors silently
    }
  }, []);

  useEffect(() => {
    requestPermission();
    refresh();
    const interval = setInterval(refresh, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [refresh, requestPermission]);

  return { notifications, refresh, permissionGranted, requestPermission };
}
