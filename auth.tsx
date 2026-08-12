import React, { createContext, useContext, useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { auth } from "./firebase";
import { getAll, getById, createWithId, update, remove, COLLECTIONS } from "./firestore";
import type { AppUser } from "./types";

export const ADMIN_EMAIL = "admin@nexusstock.com";
export const ADMIN_PASSWORD = "Admin@123456";

interface AuthContextType {
  user: AppUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  isAdmin: boolean;
  hasPermission: (page: string) => boolean;
  createUser: (email: string, password: string, name: string, permissions: string[]) => Promise<void>;
  updateUserPermissions: (uid: string, name: string, permissions: string[]) => Promise<void>;
  deleteUser: (uid: string) => Promise<void>;
  allUsers: AppUser[];
  reloadUsers: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const ALL_PERMISSIONS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "products", label: "Products" },
  { key: "categories", label: "Categories" },
  { key: "stores", label: "Stores" },
  { key: "suppliers", label: "Suppliers" },
  { key: "customers", label: "Customers" },
  { key: "stock-in", label: "Stock In" },
  { key: "pricing", label: "Pricing" },
  { key: "pos-sales", label: "POS Sales" },
  { key: "order-vouchers", label: "Order Vouchers" },
  { key: "transfers", label: "Transfers" },
  { key: "damage-returns", label: "Damage/Returns" },
  { key: "expenses", label: "Expenses" },
  { key: "payment-transactions", label: "Payment Transactions" },
  { key: "store-balance", label: "Store Balance" },
  { key: "bincard", label: "Bincard" },
  { key: "bincard-summary", label: "Bincard Summary" },
  { key: "reports", label: "Reports" },
  { key: "inventory", label: "Inventory" },
  { key: "store-requests", label: "Store Requests" },
  { key: "accounts", label: "Accounts" },
  { key: "promotions", label: "Promotions" },
  { key: "direct-sales", label: "Direct Sales" },
  { key: "binning", label: "Binning" },
  { key: "settings", label: "Settings" },
  { key: "delete", label: "Delete Records" },
];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [allUsers, setAllUsers] = useState<AppUser[]>([]);

  async function loadUsers() {
    const users = await getAll<AppUser>(COLLECTIONS.USERS);
    setAllUsers(users);
    return users;
  }

  useEffect(() => {
    return onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          let profile = await getById<AppUser>(COLLECTIONS.USERS, firebaseUser.uid);
          if (!profile && firebaseUser.email === ADMIN_EMAIL) {
            const adminUser = {
              uid: firebaseUser.uid,
              email: ADMIN_EMAIL,
              name: "Admin",
              role: "admin" as const,
              permissions: ["*"],
            };
            await createWithId(COLLECTIONS.USERS, firebaseUser.uid, adminUser as Record<string, unknown>);
            profile = { ...adminUser, id: firebaseUser.uid };
          }
          if (profile) {
            setUser(profile);
            loadUsers();
          } else {
            setUser(null);
            await firebaseSignOut(auth);
          }
        } catch {
          setUser(null);
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    });
  }, []);

  async function signIn(email: string, password: string) {
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if ((code === "auth/user-not-found" || code === "auth/invalid-credential") && email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
        const credential = await createUserWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASSWORD);
        const uid = credential.user.uid;
        await createWithId(COLLECTIONS.USERS, uid, {
          uid,
          email: ADMIN_EMAIL,
          name: "Admin",
          role: "admin",
          permissions: ["*"],
        } as Record<string, unknown>);
      } else {
        throw err;
      }
    }
  }

  async function signOut() {
    await firebaseSignOut(auth);
    setUser(null);
  }

  async function createUser(email: string, password: string, name: string, permissions: string[]) {
    const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      }
    );
    const data = await res.json();
    if (!res.ok) throw new Error((data.error?.message as string) || "Failed to create user");
    const uid = data.localId as string;
    await createWithId(COLLECTIONS.USERS, uid, {
      uid,
      email,
      name,
      role: "user",
      permissions,
    } as Record<string, unknown>);
    await loadUsers();
  }

  async function updateUserPermissions(uid: string, name: string, permissions: string[]) {
    await update(COLLECTIONS.USERS, uid, { name, permissions } as Record<string, unknown>);
    await loadUsers();
  }

  async function deleteUser(uid: string) {
    await remove(COLLECTIONS.USERS, uid);
    await loadUsers();
  }

  async function reloadUsers() {
    await loadUsers();
  }

  const isAdmin = user?.role === "admin";

  function hasPermission(page: string): boolean {
    if (!user) return false;
    if (user.role === "admin") return true;
    return user.permissions.includes("*") || user.permissions.includes(page);
  }

  return (
    <AuthContext.Provider value={{
      user, loading, signIn, signOut, isAdmin, hasPermission,
      createUser, updateUserPermissions, deleteUser, allUsers, reloadUsers,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
