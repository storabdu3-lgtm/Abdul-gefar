import { useState, useEffect, useRef } from "react";
import { Search, FileDown, Printer, Package, Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { getAll, COLLECTIONS, clearCollection } from "@/lib/firestore";
import { computeStockBalances } from "@/lib/stockUtils";
import type { Store, StockIn as StockInType } from "@/lib/types";
import { useReactToPrint } from "react-to-print";
import { fmt } from "@/lib/currency";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { auth } from "@/lib/firebase";
import { EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import * as XLSX from "xlsx";

const BALANCE_COLLECTIONS = [
  COLLECTIONS.STOCK_IN,
  COLLECTIONS.POS_SALES,
  COLLECTIONS.TRANSFERS,
  COLLECTIONS.DAMAGE_RETURNS,
  COLLECTIONS.DIRECT_SALES,
  COLLECTIONS.ORDER_VOUCHERS,
  COLLECTIONS.STORE_REQUESTS,
];

interface BalanceRow {
  productId: string;
  productName: string;
  productCode: string;
  photoUrl: string;
  quantity: number;
  quantityPerCarton: number;
  unitPrice: number;
  cartonPrice: number;
}

export default function StoreBalance() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { toast } = useToast();

  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStore, setSelectedStore] = useState("");
  const [balance, setBalance] = useState<BalanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const tableRef = useRef<HTMLDivElement>(null);

  const [showClearDialog, setShowClearDialog] = useState(false);
  const [clearEmail, setClearEmail] = useState("");
  const [clearPassword, setClearPassword] = useState("");
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    getAll<Store>(COLLECTIONS.STORES).then(setStores);
  }, []);

  async function handleClearAll() {
    if (!clearEmail.trim() || !clearPassword.trim()) {
      toast({ title: "Email and password required", variant: "destructive" });
      return;
    }
    setClearing(true);
    try {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) throw new Error("Not signed in");
      const cred = EmailAuthProvider.credential(clearEmail.trim(), clearPassword);
      await reauthenticateWithCredential(firebaseUser, cred);
      await Promise.all(BALANCE_COLLECTIONS.map(col => clearCollection(col)));
      setBalance([]);
      setShowClearDialog(false);
      setClearEmail("");
      setClearPassword("");
      toast({ title: "Store balance cleared successfully" });
      if (selectedStore) calculateBalance(selectedStore);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("wrong-password") || msg.includes("invalid-credential") || msg.includes("INVALID_PASSWORD")) {
        toast({ title: "Incorrect email or password", variant: "destructive" });
      } else {
        toast({ title: "Clear failed", description: msg, variant: "destructive" });
      }
    } finally {
      setClearing(false);
    }
  }

  async function calculateBalance(storeId: string) {
    if (!storeId) return;
    setLoading(true);

    const [balanceMap, allStockIns] = await Promise.all([
      computeStockBalances(storeId),
      getAll<StockInType>(COLLECTIONS.STOCK_IN),
    ]);

    const activeStockIns = allStockIns
      .filter(si => si.status !== "voided")
      .sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt as any).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt as any).getTime() : 0;
        return tb - ta;
      });

    const priceMap: Record<string, { unitPrice: number; cartonPrice: number }> = {};
    for (const si of activeStockIns) {
      for (const item of si.items) {
        if (!priceMap[item.productId] && (item.unitPrice > 0 || item.cartonPrice > 0)) {
          priceMap[item.productId] = {
            unitPrice: item.unitPrice,
            cartonPrice: item.cartonPrice,
          };
        }
      }
    }

    const rows: BalanceRow[] = Object.values(balanceMap).map(b => ({
      ...b,
      unitPrice: priceMap[b.productId]?.unitPrice ?? 0,
      cartonPrice: priceMap[b.productId]?.cartonPrice ?? 0,
    }));

    setBalance(rows);
    setLoading(false);
  }

  useEffect(() => { calculateBalance(selectedStore); }, [selectedStore]);

  const filtered = balance.filter(b =>
    b.productName.toLowerCase().includes(search.toLowerCase()) ||
    b.productCode.toLowerCase().includes(search.toLowerCase())
  );

  const selectedStoreName = stores.find(s => s.id === selectedStore)?.name || "";
  const handlePrint = useReactToPrint({
    contentRef: tableRef,
    pageStyle: `
      @page { size: A4 landscape; margin: 10mm; }
      @media print {
        body * { visibility: hidden; }
        .receipt-a4, .receipt-a4 * { visibility: visible; }
        .receipt-a4 {
          position: fixed; top: 0; left: 0;
          width: 100%; padding: 8mm;
          background: white; color: #000;
          font-size: 9pt; box-sizing: border-box;
        }
        .receipt-a4 table { width: 100%; border-collapse: collapse; }
        .receipt-a4 th, .receipt-a4 td { border: 1px solid #ccc; padding: 3pt 5pt; }
        .print-hide { display: none !important; }
      }
    `,
  });

  function exportExcel() {
    const storeName = stores.find(s => s.id === selectedStore)?.name || "Store";
    const wb = XLSX.utils.book_new();
    const totalUnits = filtered.reduce((s, b) => s + b.quantity, 0);
    const totalCartons = filtered.reduce((s, b) => s + (b.quantityPerCarton > 0 ? Math.floor(b.quantity / b.quantityPerCarton) : 0), 0);
    const data = [
      ["Product", "Code", "Qty/Carton", "Unit Price", "Balance (Units)", "Cartons", "Total Price"],
      ...filtered.map(b => {
        const cartons = b.quantityPerCarton > 0 ? Math.floor(b.quantity / b.quantityPerCarton) : 0;
        const rowTotal = b.unitPrice > 0 ? b.unitPrice * b.quantity : 0;
        return [
          b.productName,
          b.productCode,
          b.quantityPerCarton || "—",
          b.unitPrice > 0 ? b.unitPrice : "—",
          b.quantity,
          cartons || "—",
          rowTotal > 0 ? rowTotal : "—",
        ];
      }),
      ["TOTAL", "All Products", "", "", totalUnits, totalCartons,
        filtered.reduce((s, b) => s + (b.unitPrice > 0 ? b.unitPrice * b.quantity : 0), 0)
      ],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, "Balance");
    XLSX.writeFile(wb, `${storeName}_balance.xlsx`);
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Store Balance</h1>
          <p className="text-muted-foreground text-sm">View current inventory balance per store</p>
        </div>
        <div className="flex w-full flex-wrap gap-2 lg:w-auto">
          <Button className="flex-1 sm:flex-none" variant="outline" onClick={() => handlePrint()} disabled={!selectedStore}><Printer className="w-4 h-4 mr-2" /> Print</Button>
          <Button className="flex-1 sm:flex-none" variant="outline" onClick={exportExcel} disabled={!selectedStore}><FileDown className="w-4 h-4 mr-2" /> Excel</Button>
          {isAdmin && (
            <Button
              className="w-full sm:w-auto"
              variant="destructive"
              onClick={() => { setClearEmail(""); setClearPassword(""); setShowClearDialog(true); }}
            >
              <Trash2 className="w-4 h-4 mr-2" /> Clear Store Balance
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center">
        <Select value={selectedStore} onValueChange={setSelectedStore}>
          <SelectTrigger className="w-full sm:w-64" data-testid="select-store">
            <SelectValue placeholder="Select a store" />
          </SelectTrigger>
          <SelectContent>{stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
        </Select>
        <div className="relative w-full sm:max-w-sm sm:flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <Input className="pl-9" placeholder="Search products..." value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search-balance" />
        </div>
      </div>

      {!selectedStore ? (
        <div className="text-center py-20 text-muted-foreground">
          <Package className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p>Select a store to view its balance</p>
        </div>
      ) : loading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-14 rounded" />)}</div>
      ) : (
        <>
          {/* ── Summary Cards ── */}
          {filtered.length > 0 && (() => {
            const totalUnits = filtered.reduce((s, b) => s + b.quantity, 0);
            const totalCartons = filtered.reduce((s, b) => s + (b.quantityPerCarton > 0 ? Math.floor(b.quantity / b.quantityPerCarton) : 0), 0);
            const totalUnitValue = filtered.reduce((s, b) => s + (b.unitPrice > 0 ? b.unitPrice * b.quantity : 0), 0);
            const totalCartonValue = filtered.reduce((s, b) => {
              const cartons = b.quantityPerCarton > 0 ? Math.floor(b.quantity / b.quantityPerCarton) : 0;
              return s + (b.cartonPrice > 0 ? b.cartonPrice * cartons : 0);
            }, 0);
            const grandTotal = filtered.reduce((s, b) => s + (b.unitPrice > 0 ? b.unitPrice * b.quantity : 0), 0);
            return (
              <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5 print-hide">
                {[
                  { label: "Total Products", value: filtered.length, unit: "items", color: "from-slate-600 to-slate-800", text: "text-white" },
                  { label: "Balance Units", value: totalUnits.toLocaleString(), unit: "units", color: "from-emerald-500 to-green-700", text: "text-white" },
                  { label: "Balance Cartons", value: totalCartons.toLocaleString(), unit: "cartons", color: "from-blue-500 to-blue-700", text: "text-white" },
                  { label: "Total Carton Value", value: fmt(totalCartonValue), unit: "carton × ctns", color: "from-purple-500 to-purple-700", text: "text-white" },
                ].map(card => (
                  <div key={card.label} className={`rounded-xl p-4 bg-gradient-to-br ${card.color} shadow-sm`}>
                    <p className="text-xs font-semibold text-white/70 uppercase tracking-wide mb-1">{card.label}</p>
                    <p className={`text-xl font-extrabold ${card.text} leading-tight`}>{card.value}</p>
                    <p className="text-[10px] text-white/50 mt-0.5">{card.unit}</p>
                  </div>
                ))}
                {/* Grand Total spanning full width */}
                <div className="col-span-2 sm:col-span-2 lg:col-span-4 rounded-xl p-4 flex items-center justify-between bg-gradient-to-r from-amber-400 to-yellow-500 shadow-md">
                  <div>
                    <p className="text-xs font-bold text-amber-900/70 uppercase tracking-wider">Grand Total — All Products</p>
                    <p className="text-xs text-amber-900/60 mt-0.5">{selectedStoreName} · {new Date().toLocaleDateString()}</p>
                  </div>
                  <p className="text-3xl font-extrabold text-amber-900">{fmt(grandTotal)}</p>
                </div>
              </div>
            );
          })()}

        <div ref={tableRef} className="receipt-a4 w-full max-w-full overflow-x-auto overscroll-x-contain rounded-xl print:overflow-visible" style={{ background: "#fff", borderRadius: 12, fontFamily: "'Inter','Segoe UI',sans-serif" }}>
          {/* Print header */}
          <div className="hidden print:block mb-4 border-b pb-3">
            <h2 className="text-lg font-bold">Store Balance Report</h2>
            <p className="text-sm">Store: <strong>{selectedStoreName}</strong></p>
            <p className="text-sm">Date: {new Date().toLocaleDateString()}</p>
          </div>
          <table className="w-full min-w-[900px] print:min-w-0" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f1f5f9" }}>
                <th style={{ textAlign: "left", padding: "10px 14px", color: "#475569", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em" }}>Photo</th>
                <th style={{ textAlign: "left", padding: "10px 14px", color: "#475569", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em" }}>Product Name</th>
                <th style={{ textAlign: "left", padding: "10px 14px", color: "#475569", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em" }}>Code</th>
                <th style={{ textAlign: "right", padding: "10px 14px", color: "#475569", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em" }}>Qty/Ctn</th>
                <th style={{ textAlign: "right", padding: "10px 14px", color: "#475569", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em" }}>Unit Price</th>
                <th style={{ textAlign: "right", padding: "10px 14px", color: "#475569", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em" }}>Balance (Units)</th>
                <th style={{ textAlign: "right", padding: "10px 14px", color: "#1d4ed8", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em", background: "#eff6ff" }}>Cartons</th>
                <th style={{ textAlign: "right", padding: "10px 14px", color: "#92400e", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em", background: "#fef3c7" }}>Total Price</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b, i) => (
                <tr
                  key={b.productId}
                  style={{ background: b.quantity <= 0 ? "#fef2f2" : i % 2 === 0 ? "#fff" : "#f9fafb", opacity: b.quantity <= 0 ? 0.6 : 1 }}
                  data-testid={`row-balance-${b.productId}`}
                >
                  <td style={{ padding: "10px 14px" }}>
                    {b.photoUrl ? (
                      <img src={b.photoUrl} alt={b.productName} style={{ width: 40, height: 40, borderRadius: 6, objectFit: "cover" }} />
                    ) : (
                      <div style={{ width: 40, height: 40, borderRadius: 6, background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Package style={{ width: 20, height: 20, color: "#94a3b8" }} />
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "10px 14px", fontWeight: 600, color: "#111827" }}>{b.productName}</td>
                  <td style={{ padding: "10px 14px", color: "#6b7280", fontSize: 12 }}>{b.productCode}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", color: "#6b7280" }}>
                    {b.quantityPerCarton > 0 ? b.quantityPerCarton : <span style={{ color: "#d1d5db" }}>—</span>}
                  </td>
                  <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 600, color: "#ea580c" }}>
                    {b.unitPrice > 0 ? fmt(b.unitPrice) : <span style={{ color: "#d1d5db" }}>—</span>}
                  </td>
                  <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 800, fontSize: 15, color: b.quantity <= 0 ? "#ef4444" : b.quantity < 10 ? "#d97706" : "#16a34a" }}>
                    {b.quantity}
                  </td>
                  <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, fontSize: 14, color: "#1d4ed8", background: i % 2 === 0 ? "#f0f7ff" : "#e8f2ff" }}>
                    {b.quantityPerCarton > 0 ? Math.floor(b.quantity / b.quantityPerCarton) : <span style={{ color: "#d1d5db" }}>—</span>}
                  </td>
                  <td style={{ padding: "10px 14px", textAlign: "right", background: i % 2 === 0 ? "#fffbeb" : "#fef9e7" }}>
                    {b.unitPrice > 0
                      ? <span style={{ fontWeight: 700, color: "#92400e" }}>{fmt(b.unitPrice * b.quantity)}</span>
                      : <span style={{ color: "#d1d5db" }}>—</span>}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: "center", padding: "40px 0", color: "#9ca3af", fontSize: 13 }}>No products found for this store</td></tr>
              )}
              {filtered.length > 0 && (() => {
                const totalUnits = filtered.reduce((s, b) => s + b.quantity, 0);
                const totalCartons = filtered.reduce((s, b) => s + (b.quantityPerCarton > 0 ? Math.floor(b.quantity / b.quantityPerCarton) : 0), 0);
                const grandTotalPrice = filtered.reduce((s, b) => s + (b.unitPrice > 0 ? b.unitPrice * b.quantity : 0), 0);
                return (
                  <tr style={{ background: "#fef9e7", borderTop: "2px solid #fde68a" }}>
                    <td style={{ padding: "12px 14px" }} />
                    <td style={{ padding: "12px 14px", fontWeight: 800, color: "#111827", fontSize: 13 }}>TOTAL</td>
                    <td style={{ padding: "12px 14px", color: "#6b7280", fontSize: 12 }}>All Products</td>
                    <td style={{ padding: "12px 14px" }} />
                    <td style={{ padding: "12px 14px" }} />
                    <td style={{ padding: "12px 14px", textAlign: "right", fontWeight: 800, fontSize: 16, color: "#16a34a" }}>{totalUnits}</td>
                    <td style={{ padding: "12px 14px", textAlign: "right", fontWeight: 800, fontSize: 16, color: "#1d4ed8", background: "#eff6ff" }}>{totalCartons}</td>
                    <td style={{ padding: "12px 14px", textAlign: "right", background: "#fef3c7" }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                        <span style={{ fontSize: 10, color: "#92400e", opacity: 0.7 }}>Grand Total</span>
                        <span style={{ fontWeight: 800, fontSize: 16, color: "#92400e" }}>{fmt(grandTotalPrice)}</span>
                      </div>
                    </td>
                  </tr>
                );
              })()}
            </tbody>
          </table>
        </div>
        </>
      )}

      {/* ── Clear Store Balance Dialog ── */}
      <Dialog open={showClearDialog} onOpenChange={open => { if (!clearing) { setShowClearDialog(open); setClearEmail(""); setClearPassword(""); } }}>
        <DialogContent className="w-[calc(100%-1rem)] max-w-sm max-h-[90vh] overflow-y-auto overscroll-contain p-4 sm:w-[calc(100%-2rem)] sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" /> Clear Store Balance
            </DialogTitle>
            <DialogDescription className="sr-only">
              Confirm your admin credentials to permanently clear all store balance records.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
              This will permanently delete all <strong>Stock In, Sales, Transfers, Damage/Returns, Direct Sales, Orders</strong> and <strong>Store Request</strong> records, clearing the full store balance for every store. This cannot be undone.
            </div>
            <div>
              <Label className="text-xs mb-1 block">Admin Email</Label>
              <Input
                type="email"
                placeholder="your@email.com"
                value={clearEmail}
                onChange={e => setClearEmail(e.target.value)}
                disabled={clearing}
                autoComplete="off"
              />
            </div>
            <div>
              <Label className="text-xs mb-1 block">Password</Label>
              <Input
                type="password"
                placeholder="••••••••"
                value={clearPassword}
                onChange={e => setClearPassword(e.target.value)}
                disabled={clearing}
                autoComplete="current-password"
                onKeyDown={e => { if (e.key === "Enter") handleClearAll(); }}
              />
            </div>
            <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row">
              <Button variant="outline" className="w-full sm:flex-1" onClick={() => { setShowClearDialog(false); setClearEmail(""); setClearPassword(""); }} disabled={clearing}>
                Cancel
              </Button>
              <Button variant="destructive" className="w-full sm:flex-1" onClick={handleClearAll} disabled={clearing || !clearEmail || !clearPassword}>
                {clearing ? "Clearing…" : "Clear All"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
