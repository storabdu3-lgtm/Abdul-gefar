import { useState, useEffect, useRef } from "react";
import { Search, FileDown, Printer, Share2, ClipboardList, AlertTriangle, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { getAll, COLLECTIONS } from "@/lib/firestore";
import type { Product, StockIn, PosSale, Transfer, DamageReturn, Category } from "@/lib/types";
import { useReactToPrint } from "react-to-print";
import { shareAsImage } from "@/lib/shareImage";
import { useToast } from "@/hooks/use-toast";
import * as XLSX from "xlsx";

interface ProductSummary {
  id: string;
  name: string;
  code: string;
  categoryId: string;
  categoryName: string;
  quantityPerCarton: number;
  minCartonAlert: number;
  photoUrl?: string;
  description?: string;
  barcodeValue?: string;
  totalIn: number;
  totalOut: number;
  balance: number;
  balanceCartons: number;
}

export default function BincardSummary() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [summaries, setSummaries] = useState<ProductSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState("all");
  const [sharing, setSharing] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const handlePrint = useReactToPrint({ contentRef: tableRef });

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    const [prods, cats, stockIns, sales, transfers, damages] = await Promise.all([
      getAll<Product>(COLLECTIONS.PRODUCTS),
      getAll<Category>(COLLECTIONS.CATEGORIES),
      getAll<StockIn>(COLLECTIONS.STOCK_IN),
      getAll<PosSale>(COLLECTIONS.POS_SALES),
      getAll<Transfer>(COLLECTIONS.TRANSFERS),
      getAll<DamageReturn>(COLLECTIONS.DAMAGE_RETURNS),
    ]);

    setCategories(cats);

    const map: Record<string, { totalIn: number; totalOut: number }> = {};
    const init = (id: string) => { if (!map[id]) map[id] = { totalIn: 0, totalOut: 0 }; };

    for (const si of stockIns.filter(s => s.status !== "voided")) {
      for (const item of si.items || []) {
        init(item.productId);
        map[item.productId].totalIn += item.cartonsReceived * item.quantityPerCarton;
      }
    }

    for (const sale of sales.filter(s => s.status !== "voided")) {
      for (const item of sale.items || []) {
        init(item.productId);
        map[item.productId].totalOut += item.quantity;
      }
    }

    for (const t of transfers.filter(t => t.status !== "voided")) {
      for (const item of t.items || []) {
        init(item.productId);
        map[item.productId].totalOut += item.quantity;
        map[item.productId].totalIn += item.quantity;
      }
    }

    for (const d of damages.filter(d => d.status !== "voided")) {
      for (const item of d.items || []) {
        init(item.productId);
        if (d.type === "damage") {
          map[item.productId].totalOut += item.quantity;
        } else {
          map[item.productId].totalIn += item.quantity;
        }
      }
    }

    const catMap: Record<string, string> = {};
    for (const c of cats) catMap[c.id] = c.name;

    const result: ProductSummary[] = prods
      .filter(p => !p.isVoided)
      .map(p => {
        const qpc = p.quantityPerCarton || 1;
        const totalIn = map[p.id]?.totalIn || 0;
        const totalOut = map[p.id]?.totalOut || 0;
        const balance = totalIn - totalOut;
        return {
          id: p.id,
          name: p.name,
          code: p.code,
          categoryId: p.categoryId || "",
          categoryName: catMap[p.categoryId || ""] || "—",
          quantityPerCarton: qpc,
          minCartonAlert: p.minCartonAlert || 0,
          photoUrl: p.photoUrl || (p.photoUrls && p.photoUrls[0]),
          description: p.description,
          barcodeValue: p.barcodeValue,
          totalIn,
          totalOut,
          balance,
          balanceCartons: Math.floor(balance / qpc),
        };
      })
      .sort((a, b) => b.balance - a.balance);

    setSummaries(result);
    setLoading(false);
  }

  const filtered = summaries.filter(s => {
    const matchSearch = !search ||
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.code.toLowerCase().includes(search.toLowerCase()) ||
      (s.description || "").toLowerCase().includes(search.toLowerCase()) ||
      (s.barcodeValue || "").toLowerCase().includes(search.toLowerCase());
    const matchCat = categoryFilter === "all" || s.categoryId === categoryFilter;
    const isLow = s.balanceCartons < s.minCartonAlert && s.minCartonAlert > 0;
    const isOut = s.balance <= 0;
    const matchStock =
      stockFilter === "all" ? true :
      stockFilter === "low" ? (isLow && !isOut) :
      stockFilter === "out" ? isOut :
      !isLow && !isOut;
    return matchSearch && matchCat && matchStock;
  });

  const totalIn = filtered.reduce((sum, s) => sum + s.totalIn, 0);
  const totalOut = filtered.reduce((sum, s) => sum + s.totalOut, 0);
  const totalBalance = filtered.reduce((sum, s) => sum + s.balance, 0);
  const lowStockCount = summaries.filter(s => s.balanceCartons < s.minCartonAlert && s.minCartonAlert > 0 && s.balance > 0).length;
  const outOfStockCount = summaries.filter(s => s.balance <= 0).length;

  function exportExcel() {
    const wb = XLSX.utils.book_new();
    const headers = ["#", "Product", "Code", "Category", "Description", "Barcode", "Qty/Ctn", "Min Alert (Ctns)", "Total In", "Total Out", "Balance (Units)", "Balance (Ctns)", "Status"];
    const data = [
      headers,
      ...filtered.map((s, i) => {
        const isOut = s.balance <= 0;
        const isLow = !isOut && s.balanceCartons < s.minCartonAlert && s.minCartonAlert > 0;
        return [
          i + 1, s.name, s.code, s.categoryName, s.description || "", s.barcodeValue || "",
          s.quantityPerCarton, s.minCartonAlert,
          s.totalIn, s.totalOut, s.balance, s.balanceCartons,
          isOut ? "OUT OF STOCK" : isLow ? "LOW STOCK" : "OK",
        ];
      }),
      [],
      ["", "TOTALS", "", "", "", "", "", "", totalIn, totalOut, totalBalance, "", ""],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 4 }, { wch: 28 }, { wch: 14 }, { wch: 18 }, { wch: 30 }, { wch: 14 }, { wch: 9 }, { wch: 14 }, { wch: 11 }, { wch: 11 }, { wch: 13 }, { wch: 13 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, "Bincard Summary");
    XLSX.writeFile(wb, `bincard_summary_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  async function handleShare() {
    if (!tableRef.current) return;
    setSharing(true);
    const result = await shareAsImage(tableRef.current, "bincard_summary.png");
    if (result === "failed") toast({ title: "Share failed", variant: "destructive" });
    setSharing(false);
  }

  function stockBadge(s: ProductSummary) {
    if (s.balance <= 0) return <Badge variant="destructive" className="text-xs whitespace-nowrap">Out of Stock</Badge>;
    if (s.minCartonAlert > 0 && s.balanceCartons < s.minCartonAlert)
      return <Badge className="text-xs bg-amber-500 hover:bg-amber-500 whitespace-nowrap"><AlertTriangle className="w-3 h-3 mr-1" />Low Stock</Badge>;
    return <Badge variant="outline" className="text-xs text-green-700 border-green-300 whitespace-nowrap">OK</Badge>;
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ClipboardList className="w-6 h-6" /> Bincard Summary
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Detailed stock balance overview for all products</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => handlePrint()}><Printer className="w-4 h-4 mr-1.5" /> Print</Button>
          <Button variant="outline" size="sm" onClick={exportExcel}><FileDown className="w-4 h-4 mr-1.5" /> Excel</Button>
          <Button variant="outline" size="sm" onClick={handleShare} disabled={sharing}>
            <Share2 className="w-4 h-4 mr-1.5" /> {sharing ? "Sharing…" : "Share"}
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <div className="border rounded-lg p-3 text-center bg-green-50">
          <p className="text-xs text-muted-foreground">Total In</p>
          <p className="text-xl font-bold text-green-600">{totalIn.toLocaleString()}</p>
        </div>
        <div className="border rounded-lg p-3 text-center bg-red-50">
          <p className="text-xs text-muted-foreground">Total Out</p>
          <p className="text-xl font-bold text-red-600">{totalOut.toLocaleString()}</p>
        </div>
        <div className="border rounded-lg p-3 text-center bg-card">
          <p className="text-xs text-muted-foreground">Net Balance</p>
          <p className={`text-xl font-bold ${totalBalance < 0 ? "text-red-600" : "text-blue-600"}`}>{totalBalance.toLocaleString()}</p>
        </div>
        <div className="border rounded-lg p-3 text-center bg-amber-50">
          <p className="text-xs text-muted-foreground">Alerts</p>
          <p className="text-sm font-semibold text-amber-700">
            {lowStockCount} low · {outOfStockCount} out
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <Input className="pl-9" placeholder="Search name, code, barcode, description…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All Categories" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={stockFilter} onValueChange={setStockFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="All Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="ok">OK Only</SelectItem>
            <SelectItem value="low">Low Stock</SelectItem>
            <SelectItem value="out">Out of Stock</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="space-y-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-16 rounded" />)}</div>
      ) : (
        <div ref={tableRef}>
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  {["#", "Product", "Category", "Qty/Ctn", "Min Alert", "Total In", "Total Out", "Units Balance", "Carton Balance", "Status"].map(h => (
                    <th key={h} className="text-left px-3 py-3 font-medium text-muted-foreground text-xs whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((s, i) => (
                  <tr key={s.id} className={`hover:bg-muted/30 align-top ${s.balance <= 0 ? "bg-red-50/40" : s.balanceCartons < s.minCartonAlert && s.minCartonAlert > 0 ? "bg-amber-50/40" : ""}`}>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{i + 1}</td>
                    <td className="px-3 py-2 min-w-[200px]">
                      <div className="flex items-start gap-2">
                        {s.photoUrl ? (
                          <img src={s.photoUrl} alt={s.name} className="w-10 h-10 rounded object-cover flex-shrink-0 border" />
                        ) : (
                          <div className="w-10 h-10 rounded border bg-muted flex items-center justify-center flex-shrink-0">
                            <Package className="w-5 h-5 text-muted-foreground" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="font-medium leading-tight">{s.name}</p>
                          <p className="text-xs text-muted-foreground font-mono">{s.code}</p>
                          {s.description && (
                            <p className="text-xs text-muted-foreground mt-0.5 leading-snug max-w-[220px]">{s.description}</p>
                          )}
                          {s.barcodeValue && (
                            <p className="text-xs text-muted-foreground/60 font-mono mt-0.5">#{s.barcodeValue}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="text-xs whitespace-nowrap">{s.categoryName}</Badge>
                    </td>
                    <td className="px-3 py-2 text-center text-xs text-muted-foreground">{s.quantityPerCarton}</td>
                    <td className="px-3 py-2 text-center text-xs text-muted-foreground">{s.minCartonAlert || "—"}</td>
                    <td className="px-3 py-2 text-green-600 font-medium text-right">+{s.totalIn.toLocaleString()}</td>
                    <td className="px-3 py-2 text-red-500 font-medium text-right">-{s.totalOut.toLocaleString()}</td>
                    <td className={`px-3 py-2 font-semibold text-right ${s.balance < 0 ? "text-red-600" : s.balance === 0 ? "text-muted-foreground" : "text-foreground"}`}>
                      {s.balance.toLocaleString()}
                    </td>
                    <td className={`px-3 py-2 font-semibold text-right ${s.balanceCartons < 0 ? "text-red-600" : s.balanceCartons === 0 ? "text-muted-foreground" : "text-foreground"}`}>
                      {s.balanceCartons.toLocaleString()} ctn
                    </td>
                    <td className="px-3 py-2">{stockBadge(s)}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={10} className="text-center py-12 text-muted-foreground">No products found</td></tr>
                )}
              </tbody>
              {filtered.length > 0 && (
                <tfoot className="bg-muted/40 font-bold text-sm">
                  <tr>
                    <td colSpan={5} className="px-3 py-2 text-muted-foreground">Total — {filtered.length} products</td>
                    <td className="px-3 py-2 text-green-600 text-right">+{totalIn.toLocaleString()}</td>
                    <td className="px-3 py-2 text-red-500 text-right">-{totalOut.toLocaleString()}</td>
                    <td className={`px-3 py-2 text-right ${totalBalance < 0 ? "text-red-600" : "text-blue-600"}`}>{totalBalance.toLocaleString()}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <p className="text-xs text-muted-foreground mt-2 text-right">
            Showing {filtered.length} of {summaries.length} products
          </p>
        </div>
      )}
    </div>
  );
}
