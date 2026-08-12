import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  increment,
  runTransaction,
  Timestamp,
  QueryConstraint,
} from "firebase/firestore";
import { db } from "./firebase";

export const COLLECTIONS = {
  PRODUCTS: "products",
  CATEGORIES: "categories",
  STORES: "stores",
  SUPPLIERS: "suppliers",
  CUSTOMERS: "customers",
  STOCK_IN: "stock_in",
  POS_SALES: "pos_sales",
  ORDER_VOUCHERS: "order_vouchers",
  TRANSFERS: "transfers",
  DAMAGE_RETURNS: "damage_returns",
  EXPENSES: "expenses",
  PRICING: "pricing",
  STORE_BALANCE: "store_balance",
  BINCARD: "bincard",
  SUPPLIER_PAYMENTS: "supplier_payments",
  CUSTOMER_PAYMENTS: "customer_payments",
  PRODUCT_REQUESTS: "product_requests",
  STORE_REQUESTS: "store_requests",
  ACCOUNTS: "accounts",
  ACCOUNT_VOUCHERS: "account_vouchers",
  PROMOTIONS: "promotions",
  DIRECT_SALES: "direct_sales",
  APP_SETTINGS: "app_settings",
  USERS: "users",
  BINNING: "binning",
  SYSTEMS: "systems",
  COUNTERS: "counters",
} as const;

export function generateVoucherId(prefix: string): string {
  const now = new Date();
  const year = now.getFullYear().toString().slice(-2);
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const time = String(now.getTime()).slice(-5);
  return `${prefix}-${year}${month}${day}-${time}`;
}

/** Generates a sequential serial voucher ID like POS-00001, POS-00002 …
 *  Uses a Firestore counter document in the "counters" collection. */
export async function generateSerialVoucherId(prefix: string): Promise<string> {
  const counterRef = doc(db, "counters", prefix);
  const newCount = await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(counterRef);
    const current: number = snap.exists() ? (snap.data().count as number) || 0 : 0;
    const next = current + 1;
    transaction.set(counterRef, { count: next }, { merge: true });
    return next;
  });
  return `${prefix}-${String(newCount).padStart(5, "0")}`;
}

export async function getAll<T>(collectionName: string, constraints: QueryConstraint[] = []): Promise<T[]> {
  const q = constraints.length > 0
    ? query(collection(db, collectionName), ...constraints)
    : collection(db, collectionName);
  const snapshot = await getDocs(q);
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as T));
}

export async function getById<T>(collectionName: string, id: string): Promise<T | null> {
  const docRef = doc(db, collectionName, id);
  const docSnap = await getDoc(docRef);
  if (!docSnap.exists()) return null;
  return { id: docSnap.id, ...docSnap.data() } as T;
}

export async function create<T extends Record<string, unknown>>(
  collectionName: string,
  data: T
): Promise<string> {
  const docRef = await addDoc(collection(db, collectionName), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return docRef.id;
}

export async function createWithId<T extends Record<string, unknown>>(
  collectionName: string,
  id: string,
  data: T
): Promise<void> {
  const docRef = doc(db, collectionName, id);
  await setDoc(docRef, {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function update<T extends Record<string, unknown>>(
  collectionName: string,
  id: string,
  data: Partial<T>
): Promise<void> {
  const docRef = doc(db, collectionName, id);
  await updateDoc(docRef, {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

export async function remove(collectionName: string, id: string): Promise<void> {
  const docRef = doc(db, collectionName, id);
  await deleteDoc(docRef);
}

/** Propagates updated product info (name, code, photo, category, qty/carton) to every
 *  historical record that stores a denormalized copy of it, so edits made on the
 *  Products page retroactively fix history across Stock In, Sales, Transfers,
 *  Damage/Return, Store Requests, Binning, Direct Sales and Store Balance. */
export async function syncProductAcrossCollections(
  productId: string,
  info: { name: string; code: string; photoUrl?: string; categoryName?: string; quantityPerCarton?: number }
): Promise<void> {
  const itemCollections = [
    COLLECTIONS.STOCK_IN,
    COLLECTIONS.POS_SALES,
    COLLECTIONS.TRANSFERS,
    COLLECTIONS.DAMAGE_RETURNS,
    COLLECTIONS.STORE_REQUESTS,
    COLLECTIONS.BINNING,
    COLLECTIONS.DIRECT_SALES,
  ];

  type PendingUpdate = { ref: ReturnType<typeof doc>; data: Record<string, unknown> };
  const pending: PendingUpdate[] = [];

  for (const colName of itemCollections) {
    const snapshot = await getDocs(collection(db, colName));
    for (const d of snapshot.docs) {
      const raw = d.data() as Record<string, unknown>;
      const items = raw.items as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(items)) continue;
      let changed = false;
      const newItems = items.map(it => {
        if (it.productId !== productId) return it;
        changed = true;
        const updatedItem: Record<string, unknown> = {
          ...it,
          productName: info.name,
          productCode: info.code,
        };
        if ("photoUrl" in it && info.photoUrl !== undefined) updatedItem.photoUrl = info.photoUrl;
        if ("categoryName" in it && info.categoryName !== undefined) updatedItem.categoryName = info.categoryName;
        if ("quantityPerCarton" in it && info.quantityPerCarton !== undefined) updatedItem.quantityPerCarton = info.quantityPerCarton;
        return updatedItem;
      });
      if (changed) {
        pending.push({ ref: doc(db, colName, d.id), data: { items: newItems } });
      }
    }
  }

  const balanceSnapshot = await getDocs(collection(db, COLLECTIONS.STORE_BALANCE));
  for (const d of balanceSnapshot.docs) {
    const raw = d.data() as Record<string, unknown>;
    if (raw.productId !== productId) continue;
    const updatedData: Record<string, unknown> = { productName: info.name, productCode: info.code };
    if ("photoUrl" in raw && info.photoUrl !== undefined) updatedData.photoUrl = info.photoUrl;
    pending.push({ ref: doc(db, COLLECTIONS.STORE_BALANCE, d.id), data: updatedData });
  }

  const batchSize = 450;
  for (let i = 0; i < pending.length; i += batchSize) {
    const chunk = pending.slice(i, i + batchSize);
    const batch = writeBatch(db);
    for (const { ref, data } of chunk) batch.update(ref, data);
    await batch.commit();
  }
}

export async function clearCollection(collectionName: string): Promise<void> {
  const snapshot = await getDocs(collection(db, collectionName));
  const batchSize = 500;
  let batch = writeBatch(db);
  let count = 0;
  for (const d of snapshot.docs) {
    batch.delete(d.ref);
    count++;
    if (count >= batchSize) {
      await batch.commit();
      batch = writeBatch(db);
      count = 0;
    }
  }
  if (count > 0) await batch.commit();
}

export {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  increment,
  runTransaction,
  Timestamp,
};

export { db };
