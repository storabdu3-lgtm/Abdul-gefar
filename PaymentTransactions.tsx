import { useState, useEffect } from "react";
import { fmt } from "@/lib/currency";
import { Search, FileDown, Share2, X, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { getAll, COLLECTIONS } from "@/lib/firestore";
import { shareText } from "@/lib/share";
import type { CustomerPayment, SupplierPayment, PosSale } from "@/lib/types";
import * as XLSX from "xlsx";
import { Timestamp } from "firebase/firestore";

function fmtDate(val: unknown): string {
  if (!val) return "—";
  if (val instanceof Timestamp) return val.toDate().toLocaleDateString();
  if (val instanceof Date) return val.toLocaleDateString();
  if (typeof val === "string") return new Date(val).toLocaleDateString();
  return String(val);
}

type TxType = "all" | "customer" | "supplier" | "sales";

interface UnifiedRow {
  id: string;
  type: "customer_payment" | "supplier_payment" | "sale";
  voucherId: string;
  party: string;
  amount: number;
  remaining: number;
  method: string;
  photoUrl?: string;
  note?: string;
  date: unknown;
}

export default function PaymentTransactions() {
  const [custPayments, setCustPayments] = useState<CustomerPayment[]>([]);
  const [suppPayments, setSuppPayments] = useState<SupplierPayment[]>([]);
  const [sales, setSales] = useState<PosSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<TxType>("all");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const { toast } = useToast();

  async function loadData() {
    setLoading(true);
    const [cp, sp, s] = await Promise.all([
      getAll<CustomerPayment>(COLLECTIONS.CUSTOMER_PAYMENTS),
      getAll<SupplierPayment>(COLLECTIONS.SUPPLIER_PAYMENTS),
      getAll<PosSale>(COLLECTIONS.POS_SALES),
    ]);
    setCustPayments(cp);
    setSuppPayments(sp);
    setSales(s.filter(s => s.amountPaid > 0 || s.photoProofUrl));
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  const rows: UnifiedRow[] = [
    ...custPayments.map(p => ({
      id: p.id,
      type: "customer_payment" as const,
      voucherId: p.saleVoucherId || "—",
      party: p.customerName,
      amount: p.amountPaid,
      remaining: p.remainingBalance,
      method: "payment",
      photoUrl: p.photoProofUrl,
      note: p.note,
      date: p.createdAt,
    })),
    ...suppPayments.map(p => ({
      id: p.id,
      type: "supplier_payment" as const,
      voucherId: p.stockInVoucherId || "—",
      party: p.supplierName,
      amount: p.amountPaid,
      remaining: p.remainingBalance,
      method: "payment",
      photoUrl: p.photoProofUrl,
      note: p.note,
      date: p.createdAt,
    })),
    ...sales.map(s => ({
      id: s.id,
      type: "sale" as const,
      voucherId: s.voucherId,
      party: s.customerName || "Walk-in",
      amount: s.amountPaid,
      remaining: s.remainingBalance,
      method: s.paymentMethod,
      photoUrl: s.photoProofUrl,
      note: s.remark,
      date: s.createdAt,
    })),
  ];

  const filtered = rows
    .filter(r => {
      if (tab === "customer") return r.type === "customer_payment";
      if (tab === "supplier") return r.type === "supplier_payment";
      if (tab === "sales") return r.type === "sale";
      return true;
    })
    .filter(r =>
      r.party.toLowerCase().includes(search.toLowerCase()) ||
      r.voucherId.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      const da = a.date instanceof Timestamp ? a.date.toDate().getTime() : new Date(String(a.date || 0)).getTime();
      const db2 = b.date instanceof Timestamp ? b.date.toDate().getTime() : new Date(String(b.date || 0)).getTime();
      return db2 - da;
    });

  function typeLabel(type: UnifiedRow["type"]) {
    if (type === "customer_payment") return <Badge className="bg-blue-100 text-blue-800 border-blue-200">Customer Pay</Badge>;
    if (type === "supplier_payment") return <Badge className="bg-purple-100 text-purple-800 border-purple-200">Supplier Pay</Badge>;
    return <Badge className="bg-green-100 text-green-800 border-green-200">Sale</Badge>;
  }

  function exportExcel() {
    const data = [
      ["Type", "Voucher", "Party", "Amount Paid", "Remaining", "Method", "Date", "Note"],
      ...filtered.map(r => [
        r.type, r.voucherId, r.party, r.amount, r.remaining, r.method, fmtDate(r.date), r.note || ""
      ])
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Transactions");
    XLSX.writeFile(wb, "payment_transactions.xlsx");
  }

  async function handleShare() {
    const text = [
      "PAYMENT TRANSACTIONS",
      `Date: ${new Date().toLocaleDateString()}`,
      "---",
      ...filtered.map(r =>
        `[${r.type.replace(/_/g, " ").toUpperCase()}] ${r.voucherId} | ${r.party} | Paid: ETB ${r.amount.toFixed(2)} | Bal: ETB ${r.remaining.toFixed(2)} | ${fmtDate(r.date)}`
      )
    ].join("\n");
    const result = await shareText("Payment Transactions", text);
    if (result === "copied") toast({ title: "Copied to clipboard" });
  }

  const totals = {
    paid: filtered.reduce((s, r) => s + (r.amount || 0), 0),
    remaining: filtered.reduce((s, r) => s + (r.remaining || 0), 0),
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payment Transactions</h1>
          <p className="text-muted-foreground text-sm mt-1">All payment records across customers, suppliers and sales</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleShare}><Share2 className="w-4 h-4 mr-2" /> Share</Button>
          <Button variant="outline" onClick={exportExcel}><FileDown className="w-4 h-4 mr-2" /> Export</Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Total Records</p>
          <p className="text-2xl font-bold">{filtered.length}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Total Paid</p>
          <p className="text-2xl font-bold text-green-600">${totals.paid.toFixed(2)}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Total Remaining</p>
          <p className="text-2xl font-bold text-red-500">${totals.remaining.toFixed(2)}</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <Tabs value={tab} onValueChange={v => setTab(v as TxType)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="customer">Customer</TabsTrigger>
            <TabsTrigger value="supplier">Supplier</TabsTrigger>
            <TabsTrigger value="sales">Sales</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <Input className="pl-9" placeholder="Search by party or voucher..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 rounded" />)}</div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {["Type", "Voucher", "Party", "Paid", "Remaining", "Method", "Date", "Proof", "Note"].map(h => (
                  <th key={h} className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(row => (
                <tr key={`${row.type}-${row.id}`} className="hover:bg-muted/30">
                  <td className="px-4 py-2">{typeLabel(row.type)}</td>
                  <td className="px-4 py-2 font-mono text-xs">{row.voucherId}</td>
                  <td className="px-4 py-2 font-medium">{row.party}</td>
                  <td className="px-4 py-2 text-green-600 font-semibold">${row.amount?.toFixed(2)}</td>
                  <td className="px-4 py-2 text-red-500">${row.remaining?.toFixed(2)}</td>
                  <td className="px-4 py-2 capitalize">{row.method}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{fmtDate(row.date)}</td>
                  <td className="px-4 py-2">
                    {row.photoUrl ? (
                      <button
                        onClick={() => setLightbox(row.photoUrl!)}
                        className="relative group"
                        title="View full image"
                      >
                        <img src={row.photoUrl} alt="proof" className="w-10 h-10 rounded object-cover border" />
                        <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 rounded transition-opacity">
                          <ZoomIn className="w-4 h-4 text-white" />
                        </div>
                      </button>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground max-w-[160px] truncate">{row.note || "—"}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center py-10 text-muted-foreground">No transactions found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            className="absolute top-4 right-4 text-white bg-black/50 rounded-full p-2 hover:bg-black/70 transition-colors"
            onClick={() => setLightbox(null)}
          >
            <X className="w-5 h-5" />
          </button>
          <img
            src={lightbox}
            alt="Payment proof"
            className="max-w-full max-h-[90vh] rounded-lg shadow-2xl object-contain"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
