import { useState, useEffect, useRef } from "react";
import { Search, FileDown, Printer, History, Share2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { getAll, COLLECTIONS } from "@/lib/firestore";
import { Timestamp } from "firebase/firestore";
import type { Product, StockIn, PosSale, Transfer, DamageReturn, Store } from "@/lib/types";
import { useReactToPrint } from "react-to-print";
import { shareAsImage } from "@/lib/shareImage";
import { useToast } from "@/hooks/use-toast";
import * as XLSX from "xlsx";

function toDateStr(val: unknown): string {
  if (!val) return "";
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (val instanceof Date) return val.toISOString();
  if (typeof val === "string") return val;
  if (typeof val === "object" && "seconds" in (val as object)) {
    return new Date((val as { seconds: number }).seconds * 1000).toISOString();
  }
  return String(val);
}

interface BincardEntry {
  date: string;
  type: string;
  voucherId: string;
  storeName: string;
  quantity: number;
  cartons: number;
  direction: "in" | "out";
  balance: number;
  details: string;
}

export default function Bincard() {
  const [products, setProducts] = useState<Product[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [selectedStore, setSelectedStore] = useState("all");
  const [entries, setEntries] = useState<BincardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [sharing, setSharing] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    getAll<Product>(COLLECTIONS.PRODUCTS).then(setProducts);
    getAll<Store>(COLLECTIONS.STORES).then(setStores);
  }, []);

  async function loadBincard(productId: string) {
    if (!productId) return;
    setLoading(true);
    const [stockIns, sales, transfers, damages] = await Promise.all([
      getAll<StockIn>(COLLECTIONS.STOCK_IN),
      getAll<PosSale>(COLLECTIONS.POS_SALES),
      getAll<Transfer>(COLLECTIONS.TRANSFERS),
      getAll<DamageReturn>(COLLECTIONS.DAMAGE_RETURNS),
    ]);

    const allEntries: Array<Omit<BincardEntry, "balance">> = [];

    for (const si of stockIns.filter(s => s.status !== "voided")) {
      for (const item of si.items || []) {
        if (item.productId === productId) {
          const qpc = item.quantityPerCarton || 1;
          const pcs = item.cartonsReceived * qpc;
          allEntries.push({
            date: toDateStr(si.createdAt),
            type: "Stock In",
            voucherId: si.voucherId,
            storeName: si.storeName,
            quantity: pcs,
            cartons: item.cartonsReceived,
            direction: "in",
            details: si.remark || "",
          });
        }
      }
    }

    for (const sale of sales.filter(s => s.status !== "voided")) {
      for (const item of sale.items || []) {
        if (item.productId === productId) {
          allEntries.push({
            date: toDateStr(sale.createdAt),
            type: "Sale",
            voucherId: sale.voucherId,
            storeName: sale.storeName,
            quantity: item.quantity,
            cartons: 0,
            direction: "out",
            details: sale.customerName || "",
          });
        }
      }
    }

    for (const t of transfers.filter(t => t.status !== "voided")) {
      for (const item of t.items || []) {
        if (item.productId === productId) {
          const qpc = item.quantityPerCarton || 1;
          const ctns = Math.round(item.quantity / qpc);
          allEntries.push({
            date: toDateStr(t.createdAt),
            type: "Transfer Out",
            voucherId: t.voucherId,
            storeName: t.fromStoreName,
            quantity: item.quantity,
            cartons: ctns,
            direction: "out",
            details: `→ ${t.toStoreName}`,
          });
          allEntries.push({
            date: toDateStr(t.createdAt),
            type: "Transfer In",
            voucherId: t.voucherId,
            storeName: t.toStoreName,
            quantity: item.quantity,
            cartons: ctns,
            direction: "in",
            details: `← ${t.fromStoreName}`,
          });
        }
      }
    }

    for (const d of damages.filter(d => d.status !== "voided")) {
      for (const item of d.items || []) {
        if (item.productId === productId) {
          allEntries.push({
            date: toDateStr(d.createdAt),
            type: d.type === "damage" ? "Damage" : "Return",
            voucherId: d.voucherId,
            storeName: d.storeName,
            quantity: item.quantity,
            cartons: 0,
            direction: "out",
            details: item.reason || "",
          });
        }
      }
    }

    allEntries.sort((a, b) => a.date.localeCompare(b.date));

    let balance = 0;
    const withBalance: BincardEntry[] = allEntries.map(e => {
      if (e.direction === "in") balance += e.quantity;
      else balance -= e.quantity;
      return { ...e, balance };
    });

    setEntries(withBalance);
    setLoading(false);
  }

  useEffect(() => { loadBincard(selectedProduct); }, [selectedProduct]);

  const selectedStoreName = selectedStore === "all" ? null : stores.find(s => s.id === selectedStore)?.name;
  let storeBalance = 0;
  const storeFilteredEntries: BincardEntry[] = entries
    .filter(e => !selectedStoreName || e.storeName === selectedStoreName)
    .map(e => {
      if (e.direction === "in") storeBalance += e.quantity;
      else storeBalance -= e.quantity;
      return { ...e, balance: storeBalance };
    });

  const filteredEntries = storeFilteredEntries.filter(e =>
    !search ||
    e.storeName.toLowerCase().includes(search.toLowerCase()) ||
    e.voucherId.toLowerCase().includes(search.toLowerCase()) ||
    e.type.toLowerCase().includes(search.toLowerCase()) ||
    e.details.toLowerCase().includes(search.toLowerCase())
  );

  const selectedProductName = products.find(p => p.id === selectedProduct)?.name;

  const handlePrint = useReactToPrint({ contentRef: tableRef });

  async function handleShare() {
    if (!tableRef.current || !selectedProduct) return;
    setSharing(true);
    const result = await shareAsImage(tableRef.current, `bincard_${selectedProductName || "product"}.png`);
    if (result === "failed") toast({ title: "Share failed", variant: "destructive" });
    setSharing(false);
  }

  function exportExcel() {
    const wb = XLSX.utils.book_new();
    const data = [
      ["Date", "Type", "Voucher", "Store", "Details", "Ctns", "In (pcs)", "Out (pcs)", "Balance (pcs)"],
      ...filteredEntries.map(e => [
        e.date, e.type, e.voucherId, e.storeName,
        e.details || "",
        e.cartons || "",
        e.direction === "in" ? e.quantity : 0,
        e.direction === "out" ? e.quantity : 0,
        e.balance,
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, "Bincard");
    XLSX.writeFile(wb, `bincard_${selectedProductName || "product"}.xlsx`);
  }

  const filteredProducts = products.filter(p =>
    productSearch && (p.name.toLowerCase().includes(productSearch.toLowerCase()) || p.code.toLowerCase().includes(productSearch.toLowerCase()))
  ).slice(0, 8);

  const typeColor = (type: string) => {
    if (type === "Stock In" || type === "Transfer In") return "default";
    if (type === "Sale") return "secondary";
    if (type === "Damage") return "destructive";
    return "outline";
  };

  const detailsColor = (type: string) => {
    if (type === "Sale") return "text-blue-600";
    if (type === "Transfer Out") return "text-orange-600";
    if (type === "Transfer In") return "text-emerald-600";
    return "text-muted-foreground";
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Bincard (Stock Card)</h1>
          <p className="text-muted-foreground text-sm">Full movement history per product</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => handlePrint()} disabled={!selectedProduct}><Printer className="w-4 h-4 mr-1.5" /> Print</Button>
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={!selectedProduct}><FileDown className="w-4 h-4 mr-1.5" /> Excel</Button>
          <Button variant="outline" size="sm" onClick={handleShare} disabled={!selectedProduct || sharing}>
            <Share2 className="w-4 h-4 mr-1.5" /> {sharing ? "Sharing…" : "Share"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Input
            placeholder="Search products by name or code…"
            value={productSearch}
            onChange={e => { setProductSearch(e.target.value); if (!e.target.value) setSelectedProduct(""); }}
            data-testid="input-product-search"
          />
          {filteredProducts.length > 0 && (
            <div className="absolute z-10 top-full left-0 right-0 bg-card border rounded-b shadow-lg">
              {filteredProducts.map(p => (
                <div key={p.id} className="px-4 py-2 hover:bg-muted cursor-pointer text-sm flex items-center gap-3"
                  onClick={() => { setSelectedProduct(p.id); setProductSearch(""); }}>
                  {p.photoUrl
                    ? <img src={p.photoUrl} alt={p.name} className="w-8 h-8 rounded object-cover flex-shrink-0" />
                    : <div className="w-8 h-8 rounded bg-muted flex items-center justify-center flex-shrink-0"><History className="w-4 h-4 text-muted-foreground" /></div>}
                  <div>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{p.code}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <Select value={selectedStore} onValueChange={setSelectedStore}>
          <SelectTrigger className="w-[180px]" data-testid="select-store-bincard">
            <SelectValue placeholder="All Stores" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stores</SelectItem>
            {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <Input className="pl-9" placeholder="Filter entries..." value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search-bincard" />
        </div>
      </div>

      {selectedProduct && (() => {
        const sp = products.find(p => p.id === selectedProduct);
        if (!sp) return null;
        return (
          <div className="flex items-center gap-4 p-3 mb-4 rounded-lg border bg-card shadow-sm">
            {sp.photoUrl
              ? <img src={sp.photoUrl} alt={sp.name} className="w-14 h-14 rounded-lg object-cover flex-shrink-0 border" />
              : <div className="w-14 h-14 rounded-lg bg-muted flex items-center justify-center flex-shrink-0"><History className="w-6 h-6 text-muted-foreground" /></div>}
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-base truncate">{sp.name}</div>
              <div className="text-xs text-muted-foreground mt-0.5 font-mono">{sp.code}</div>
              {sp.quantityPerCarton > 1 && <div className="text-xs text-muted-foreground">Qty/Carton: {sp.quantityPerCarton}</div>}
            </div>
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => { setSelectedProduct(""); setProductSearch(""); }}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        );
      })()}

      {!selectedProduct ? (
        <div className="text-center py-20 text-muted-foreground">
          <History className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p>Search and select a product to view its bincard</p>
        </div>
      ) : loading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12 rounded" />)}</div>
      ) : (
        <div ref={tableRef}>
          {selectedProductName && <h2 className="text-lg font-bold mb-3">{selectedProductName} — Movement History</h2>}
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  {["Date", "Type", "Details", "Voucher ID", "Store", "Ctns", "In (+)", "Out (-)", "Balance"].map(h => (
                    <th key={h} className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredEntries.map((e, i) => (
                  <tr key={i} className="hover:bg-muted/30">
                    <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">
                      {e.date ? new Date(e.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant={typeColor(e.type)} className="text-xs whitespace-nowrap">{e.type}</Badge>
                    </td>
                    <td className={`px-4 py-2 text-xs font-medium max-w-[140px] truncate ${detailsColor(e.type)}`} title={e.details || undefined}>
                      {e.details || "—"}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{e.voucherId}</td>
                    <td className="px-4 py-2 text-xs">{e.storeName}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground font-medium">{e.cartons > 0 ? e.cartons : "—"}</td>
                    <td className="px-4 py-2 text-green-600 font-medium">{e.direction === "in" ? `+${e.quantity}` : ""}</td>
                    <td className="px-4 py-2 text-red-500 font-medium">{e.direction === "out" ? `-${e.quantity}` : ""}</td>
                    <td className={`px-4 py-2 font-bold ${e.balance < 0 ? "text-red-600" : "text-foreground"}`}>{e.balance}</td>
                  </tr>
                ))}
                {filteredEntries.length === 0 && (
                  <tr><td colSpan={9} className="text-center py-10 text-muted-foreground">No movement records found</td></tr>
                )}
              </tbody>
              {filteredEntries.length > 0 && (
                <tfoot className="bg-muted/30 font-bold">
                  <tr>
                    <td colSpan={8} className="px-4 py-2 text-sm">Current Balance</td>
                    <td className={`px-4 py-2 text-lg font-bold ${(filteredEntries[filteredEntries.length - 1]?.balance || 0) < 0 ? "text-red-600" : "text-green-600"}`}>
                      {filteredEntries[filteredEntries.length - 1]?.balance || 0}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
