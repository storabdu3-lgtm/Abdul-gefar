import { useState, useEffect, useRef } from "react";
import { FileDown, Printer, FileBarChart, TrendingUp, TrendingDown, Banknote, Share2 } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  LineChart, Line, Legend, Cell,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { getAll, COLLECTIONS } from "@/lib/firestore";
import { fmt } from "@/lib/currency";
import type { Store, PosSale, StockIn, Expense, DamageReturn } from "@/lib/types";
import { useReactToPrint } from "react-to-print";
import * as XLSX from "xlsx";
import { shareAsImage, shareAsPdf } from "@/lib/shareImage";
import { useToast } from "@/hooks/use-toast";
import { ReceiptActionBar } from "@/components/ReceiptActionBar";

type Period = "daily" | "weekly" | "monthly" | "yearly" | "all" | "custom";

function toDate(val: unknown): Date | null {
  if (!val) return null;
  if (typeof val === "object" && val !== null && "seconds" in val) {
    return new Date((val as { seconds: number }).seconds * 1000);
  }
  const d = new Date(String(val));
  return isNaN(d.getTime()) ? null : d;
}

export default function Reports() {
  const [period, setPeriod] = useState<Period>("monthly");
  const [selectedStore, setSelectedStore] = useState("all");
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [customTo, setCustomTo] = useState(new Date().toISOString().slice(0, 10));
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<{
    totalRevenue: number;
    totalCost: number;
    grossProfit: number;
    totalExpenses: number;
    netProfit: number;
    totalDamages: number;
    salesCount: number;
    stockInCount: number;
    salesData: PosSale[];
    stockInData: StockIn[];
    expensesData: Expense[];
    damagesData: DamageReturn[];
    topProducts: { name: string; qty: number; revenue: number }[];
    dailySales: { date: string; revenue: number; count: number }[];
  } | null>(null);
  const reportRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    getAll<Store>(COLLECTIONS.STORES).then(setStores);
  }, []);

  useEffect(() => {
    generateReport();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, selectedStore]);

  function getDateRange(p: Period): { start: Date | null; end: Date | null } {
    if (p === "all") return { start: null, end: null };
    if (p === "custom") {
      const start = customFrom ? new Date(customFrom) : null;
      const end = customTo ? new Date(customTo + "T23:59:59") : null;
      return { start, end };
    }
    const now = new Date();
    const start = new Date();
    if (p === "daily") start.setHours(0, 0, 0, 0);
    else if (p === "weekly") start.setDate(now.getDate() - 7);
    else if (p === "monthly") start.setMonth(now.getMonth() - 1);
    else if (p === "yearly") start.setFullYear(now.getFullYear() - 1);
    return { start, end: null };
  }

  async function generateReport() {
    setLoading(true);
    const { start: startDate, end: endDate } = getDateRange(period);
    const [sales, stockIns, expenses, damages] = await Promise.all([
      getAll<PosSale>(COLLECTIONS.POS_SALES),
      getAll<StockIn>(COLLECTIONS.STOCK_IN),
      getAll<Expense>(COLLECTIONS.EXPENSES),
      getAll<DamageReturn>(COLLECTIONS.DAMAGE_RETURNS),
    ]);

    const filterByDate = <T extends { createdAt?: unknown }>(items: T[]): T[] => {
      if (!startDate && !endDate) return items;
      return items.filter(i => {
        const d = toDate(i.createdAt);
        if (!d) return true;
        if (startDate && d < startDate) return false;
        if (endDate && d > endDate) return false;
        return true;
      });
    };

    const filterByStore = <T extends { storeId?: string }>(items: T[]) =>
      selectedStore === "all" ? items : items.filter(i => i.storeId === selectedStore);

    const filteredSales = filterByStore(filterByDate(sales)).filter(
      s => s.status !== "voided" && s.status !== "pending"
    );
    const filteredStockIns = filterByStore(filterByDate(stockIns)).filter(
      s => s.status !== "voided" && s.status !== "pending"
    );
    const filteredExpenses = filterByStore(filterByDate(expenses)).filter(
      e => (e as any).status !== "voided" && (e as any).status !== "pending"
    );
    const filteredDamages = filterByStore(filterByDate(damages)).filter(
      d => (d as any).status !== "voided" && (d as any).status !== "pending"
    );

    const totalRevenue = filteredSales.reduce((s, sale) => s + (sale.totalAmount || 0), 0);
    const totalCost = filteredStockIns.reduce((s, si) => s + (si.totalPrice || 0), 0);
    const grossProfit = totalRevenue - totalCost;
    const totalExpenses = filteredExpenses.reduce((s, e) => s + (e.totalAmount || 0), 0);
    const totalDamages = filteredDamages.reduce((s, d) => s + (d.totalAmount || 0), 0);
    const netProfit = grossProfit - totalExpenses - totalDamages;

    // ── Top sold products (by units) ──
    const productMap: Record<string, { name: string; qty: number; revenue: number }> = {};
    for (const sale of filteredSales) {
      for (const item of (sale.items || [])) {
        if (!item.productId) continue;
        if (!productMap[item.productId]) productMap[item.productId] = { name: item.productName || item.productId, qty: 0, revenue: 0 };
        productMap[item.productId].qty += item.quantity || 0;
        productMap[item.productId].revenue += item.totalPrice || 0;
      }
    }
    const topProducts = Object.values(productMap).sort((a, b) => b.qty - a.qty).slice(0, 15);

    // ── Daily sales trend ──
    const dailyMap: Record<string, { date: string; revenue: number; count: number }> = {};
    for (const sale of filteredSales) {
      const d = toDate(sale.createdAt);
      if (!d) continue;
      const key = d.toISOString().slice(0, 10);
      if (!dailyMap[key]) dailyMap[key] = { date: key, revenue: 0, count: 0 };
      dailyMap[key].revenue += sale.totalAmount || 0;
      dailyMap[key].count += 1;
    }
    const dailySales = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

    setReport({
      totalRevenue,
      totalCost,
      grossProfit,
      netProfit,
      totalExpenses,
      totalDamages,
      salesCount: filteredSales.length,
      stockInCount: filteredStockIns.length,
      salesData: filteredSales,
      stockInData: filteredStockIns,
      expensesData: filteredExpenses,
      damagesData: filteredDamages,
      topProducts,
      dailySales,
    });
    setLoading(false);
  }

  const handlePrint = useReactToPrint({ contentRef: reportRef });
  const [sharing, setSharing] = useState(false);
  const [sharingPdf, setSharingPdf] = useState(false);

  async function handleShare() {
    if (!reportRef.current) return;
    setSharing(true);
    const r = await shareAsImage(reportRef.current, `report_${period}.png`);
    if (r === "failed") toast({ title: "Share failed", variant: "destructive" });
    setSharing(false);
  }

  async function handleSharePdf() {
    if (!reportRef.current) return;
    setSharingPdf(true);
    const r = await shareAsPdf(reportRef.current, `report_${period}.pdf`);
    if (r === "failed") toast({ title: "PDF share failed", variant: "destructive" });
    setSharingPdf(false);
  }

  function exportExcel() {
    if (!report) return;
    const wb = XLSX.utils.book_new();
    const summary = [
      ["Report Summary", ""],
      ["Period", period],
      ["Store", selectedStore === "all" ? "All Stores" : stores.find(s => s.id === selectedStore)?.name || selectedStore],
      ["Revenue (ETB)", report.totalRevenue],
      ["Cost (ETB)", report.totalCost],
      ["Gross Profit (ETB)", report.grossProfit],
      ["Expenses (ETB)", report.totalExpenses],
      ["Damages (ETB)", report.totalDamages],
      ["Net Profit (ETB)", report.netProfit],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Summary");
    if (report.salesData.length > 0) {
      const salesSheet = [
        ["Voucher", "Customer", "Store", "Total (ETB)", "Paid (ETB)", "Balance (ETB)", "Payment"],
        ...report.salesData.map(s => [s.voucherId, s.customerName, s.storeName, s.totalAmount, s.amountPaid, s.remainingBalance, s.paymentMethod]),
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(salesSheet), "Sales");
    }
    if (report.stockInData.length > 0) {
      const siSheet = [
        ["Voucher", "Supplier", "Store", "Total (ETB)", "Paid (ETB)", "Balance (ETB)"],
        ...report.stockInData.map(s => [s.voucherId, s.supplierName, s.storeName, s.totalPrice, s.amountPaid, s.remainingBalance]),
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(siSheet), "Stock In");
    }
    if (report.expensesData.length > 0) {
      const expSheet = [
        ["Voucher", "Store", "Type", "Total (ETB)"],
        ...report.expensesData.map(e => [e.voucherId, e.storeName || "General", e.type, e.totalAmount]),
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(expSheet), "Expenses");
    }
    XLSX.writeFile(wb, `report_${period}_${new Date().toISOString().split("T")[0]}.xlsx`);
  }

  const statCards = report ? [
    { label: "Total Revenue", value: fmt(report.totalRevenue), icon: TrendingUp, color: "text-green-600", bg: "bg-green-50" },
    { label: "Total Cost", value: fmt(report.totalCost), icon: TrendingDown, color: "text-red-500", bg: "bg-red-50" },
    { label: "Gross Profit", value: fmt(report.grossProfit), icon: Banknote, color: report.grossProfit >= 0 ? "text-green-600" : "text-red-500", bg: report.grossProfit >= 0 ? "bg-green-50" : "bg-red-50" },
    { label: "Expenses", value: fmt(report.totalExpenses), icon: TrendingDown, color: "text-orange-500", bg: "bg-orange-50" },
    { label: "Damages / Returns", value: fmt(report.totalDamages), icon: TrendingDown, color: "text-purple-500", bg: "bg-purple-50" },
    { label: "Net Profit", value: fmt(report.netProfit), icon: Banknote, color: report.netProfit >= 0 ? "text-green-600" : "text-red-600", bg: report.netProfit >= 0 ? "bg-green-50" : "bg-red-50" },
    { label: "Total Sales", value: report.salesCount.toString(), icon: FileBarChart, color: "text-blue-600", bg: "bg-blue-50" },
    { label: "Stock-In Records", value: report.stockInCount.toString(), icon: FileBarChart, color: "text-indigo-600", bg: "bg-indigo-50" },
  ] : [];

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
          <p className="text-muted-foreground text-sm">Financial summaries and business insights</p>
        </div>
        <ReceiptActionBar
          onExportExcel={exportExcel}
          onSharePdf={handleSharePdf}
          onShare={handleShare}
          onPrint={() => handlePrint()}
          sharing={sharing}
          sharingPdf={sharingPdf}
          disabled={!report}
        />
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap items-end">
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Period</Label>
          <Select value={period} onValueChange={v => setPeriod(v as Period)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Today</SelectItem>
              <SelectItem value="weekly">Last 7 Days</SelectItem>
              <SelectItem value="monthly">Last 30 Days</SelectItem>
              <SelectItem value="yearly">Last Year</SelectItem>
              <SelectItem value="all">All Time</SelectItem>
              <SelectItem value="custom">Custom Range</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {period === "custom" && (
          <>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">From</Label>
              <Input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="w-40" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">To</Label>
              <Input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="w-40" />
            </div>
          </>
        )}
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Store</Label>
          <Select value={selectedStore} onValueChange={setSelectedStore}>
            <SelectTrigger className="w-52"><SelectValue placeholder="All Stores" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Stores</SelectItem>
              {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={generateReport} variant="default" data-testid="button-generate-report">Generate Report</Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-28 rounded-lg" />)}
        </div>
      ) : report ? (
        <div ref={reportRef} className="space-y-6">
          {/* Stat Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {statCards.map(card => {
              const Icon = card.icon;
              return (
                <Card key={card.label} className="overflow-hidden">
                  <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-4">
                    <CardTitle className="text-xs font-medium text-muted-foreground">{card.label}</CardTitle>
                    <div className={`w-7 h-7 rounded-full ${card.bg} flex items-center justify-center`}>
                      <Icon className={`w-4 h-4 ${card.color}`} />
                    </div>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className={`text-xl font-bold ${card.color}`}>{card.value}</div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Detailed Tables */}
          <Tabs defaultValue="charts">
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="charts">Charts</TabsTrigger>
              <TabsTrigger value="sales">Sales ({report.salesData.length})</TabsTrigger>
              <TabsTrigger value="stockin">Stock In ({report.stockInData.length})</TabsTrigger>
              <TabsTrigger value="expenses">Expenses ({report.expensesData.length})</TabsTrigger>
              <TabsTrigger value="damages">Damages ({report.damagesData.length})</TabsTrigger>
            </TabsList>

            {/* ── Charts Tab ── */}
            <TabsContent value="charts">
              <div className="space-y-8 mt-4">

                {/* Daily Sales Trend */}
                <div className="rounded-xl border bg-white p-5 shadow-sm">
                  <div className="mb-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Day-by-Day Revenue</p>
                    <p className="text-lg font-bold text-gray-900 mt-0.5">Daily Sales Trend</p>
                  </div>
                  {report.dailySales.length === 0 ? (
                    <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">No sales data for this period</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={report.dailySales} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={d => d.slice(5)} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                        <Tooltip
                          formatter={(val: number) => [`ETB ${val.toLocaleString()}`, "Revenue"]}
                          labelFormatter={l => `Date: ${l}`}
                        />
                        <Legend />
                        <Line type="monotone" dataKey="revenue" name="Revenue (ETB)" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                        <Line type="monotone" dataKey="count" name="# Sales" stroke="#16a34a" strokeWidth={2} dot={{ r: 3 }} yAxisId={0} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>

                {/* Most Sold Items — horizontal bar chart top→bottom */}
                <div className="rounded-xl border bg-white p-5 shadow-sm">
                  <div className="mb-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">By Units Sold</p>
                    <p className="text-lg font-bold text-gray-900 mt-0.5">Most Sold Items</p>
                  </div>
                  {report.topProducts.length === 0 ? (
                    <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">No product sales data for this period</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={Math.max(280, report.topProducts.length * 38)}>
                      <BarChart
                        layout="vertical"
                        data={report.topProducts}
                        margin={{ top: 4, right: 60, left: 8, bottom: 4 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                        <XAxis type="number" tick={{ fontSize: 11 }} />
                        <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} />
                        <Tooltip
                          formatter={(val: number, name: string) => [
                            name === "qty" ? `${val} units` : `ETB ${val.toLocaleString()}`,
                            name === "qty" ? "Units Sold" : "Revenue",
                          ]}
                        />
                        <Legend formatter={v => v === "qty" ? "Units Sold" : "Revenue (ETB)"} />
                        <Bar dataKey="qty" name="qty" radius={[0, 4, 4, 0]}>
                          {report.topProducts.map((_, i) => (
                            <Cell key={i} fill={`hsl(${220 + i * 8}, 70%, ${55 - i * 1.5}%)`} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>

                {/* Fast Sales — revenue-ranked */}
                <div className="rounded-xl border bg-white p-5 shadow-sm">
                  <div className="mb-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">By Revenue Generated</p>
                    <p className="text-lg font-bold text-gray-900 mt-0.5">Fast Sales (Highest Revenue)</p>
                  </div>
                  {report.topProducts.length === 0 ? (
                    <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">No product data for this period</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={Math.max(280, report.topProducts.length * 38)}>
                      <BarChart
                        layout="vertical"
                        data={[...report.topProducts].sort((a, b) => b.revenue - a.revenue)}
                        margin={{ top: 4, right: 60, left: 8, bottom: 4 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                        <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                        <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} />
                        <Tooltip
                          formatter={(val: number) => [`ETB ${val.toLocaleString()}`, "Revenue"]}
                        />
                        <Bar dataKey="revenue" name="Revenue (ETB)" radius={[0, 4, 4, 0]}>
                          {report.topProducts.map((_, i) => (
                            <Cell key={i} fill={`hsl(${145 + i * 6}, 60%, ${48 - i * 1.2}%)`} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>

              </div>
            </TabsContent>

            <TabsContent value="sales">
              <div className="rounded-md border overflow-x-auto mt-4">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>{["Voucher", "Customer", "Store", "Total", "Paid", "Balance", "Payment"].map(h => (
                      <th key={h} className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody className="divide-y">
                    {report.salesData.map(s => (
                      <tr key={s.id} className="hover:bg-muted/30">
                        <td className="px-4 py-2 font-mono text-xs">{s.voucherId}</td>
                        <td className="px-4 py-2 text-xs">{s.customerName}</td>
                        <td className="px-4 py-2 text-xs">{s.storeName}</td>
                        <td className="px-4 py-2 text-xs font-semibold">{fmt(s.totalAmount)}</td>
                        <td className="px-4 py-2 text-xs text-green-600">{fmt(s.amountPaid)}</td>
                        <td className="px-4 py-2 text-xs text-red-500">{fmt(s.remainingBalance)}</td>
                        <td className="px-4 py-2 text-xs capitalize">{s.paymentMethod}</td>
                      </tr>
                    ))}
                    {report.salesData.length === 0 && <tr><td colSpan={7} className="text-center py-6 text-muted-foreground text-sm">No sales in this period</td></tr>}
                  </tbody>
                  {report.salesData.length > 0 && (
                    <tfoot className="bg-muted/30">
                      <tr>
                        <td colSpan={3} className="px-4 py-2 text-xs font-semibold">Totals</td>
                        <td className="px-4 py-2 text-xs font-bold">{fmt(report.totalRevenue)}</td>
                        <td className="px-4 py-2 text-xs font-bold text-green-600">{fmt(report.salesData.reduce((s, x) => s + (x.amountPaid || 0), 0))}</td>
                        <td className="px-4 py-2 text-xs font-bold text-red-500">{fmt(report.salesData.reduce((s, x) => s + (x.remainingBalance || 0), 0))}</td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </TabsContent>

            <TabsContent value="stockin">
              <div className="rounded-md border overflow-x-auto mt-4">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>{["Voucher", "Supplier", "Store", "Total", "Paid", "Balance"].map(h => (
                      <th key={h} className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody className="divide-y">
                    {report.stockInData.map(s => (
                      <tr key={s.id} className="hover:bg-muted/30">
                        <td className="px-4 py-2 font-mono text-xs">{s.voucherId}</td>
                        <td className="px-4 py-2 text-xs">{s.supplierName}</td>
                        <td className="px-4 py-2 text-xs">{s.storeName}</td>
                        <td className="px-4 py-2 text-xs font-semibold">{fmt(s.totalPrice)}</td>
                        <td className="px-4 py-2 text-xs text-green-600">{fmt(s.amountPaid)}</td>
                        <td className="px-4 py-2 text-xs text-red-500">{fmt(s.remainingBalance)}</td>
                      </tr>
                    ))}
                    {report.stockInData.length === 0 && <tr><td colSpan={6} className="text-center py-6 text-muted-foreground text-sm">No stock-in in this period</td></tr>}
                  </tbody>
                  {report.stockInData.length > 0 && (
                    <tfoot className="bg-muted/30">
                      <tr>
                        <td colSpan={3} className="px-4 py-2 text-xs font-semibold">Totals</td>
                        <td className="px-4 py-2 text-xs font-bold">{fmt(report.totalCost)}</td>
                        <td className="px-4 py-2 text-xs font-bold text-green-600">{fmt(report.stockInData.reduce((s, x) => s + (x.amountPaid || 0), 0))}</td>
                        <td className="px-4 py-2 text-xs font-bold text-red-500">{fmt(report.stockInData.reduce((s, x) => s + (x.remainingBalance || 0), 0))}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </TabsContent>

            <TabsContent value="expenses">
              <div className="rounded-md border overflow-x-auto mt-4">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>{["Voucher", "Store", "Type", "Total"].map(h => (
                      <th key={h} className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody className="divide-y">
                    {report.expensesData.map(e => (
                      <tr key={e.id} className="hover:bg-muted/30">
                        <td className="px-4 py-2 font-mono text-xs">{e.voucherId}</td>
                        <td className="px-4 py-2 text-xs">{e.storeName || "General"}</td>
                        <td className="px-4 py-2 text-xs capitalize">{e.type}</td>
                        <td className="px-4 py-2 text-xs font-semibold">{fmt(e.totalAmount)}</td>
                      </tr>
                    ))}
                    {report.expensesData.length === 0 && <tr><td colSpan={4} className="text-center py-6 text-muted-foreground text-sm">No expenses in this period</td></tr>}
                  </tbody>
                  {report.expensesData.length > 0 && (
                    <tfoot className="bg-muted/30">
                      <tr>
                        <td colSpan={3} className="px-4 py-2 text-xs font-semibold">Total</td>
                        <td className="px-4 py-2 text-xs font-bold">{fmt(report.totalExpenses)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </TabsContent>

            <TabsContent value="damages">
              <div className="rounded-md border overflow-x-auto mt-4">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>{["Voucher", "Store", "Type", "Total"].map(h => (
                      <th key={h} className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody className="divide-y">
                    {report.damagesData.map(d => (
                      <tr key={d.id} className="hover:bg-muted/30">
                        <td className="px-4 py-2 font-mono text-xs">{d.voucherId}</td>
                        <td className="px-4 py-2 text-xs">{d.storeName}</td>
                        <td className="px-4 py-2 text-xs capitalize">{d.type}</td>
                        <td className="px-4 py-2 text-xs font-semibold">{fmt(d.totalAmount)}</td>
                      </tr>
                    ))}
                    {report.damagesData.length === 0 && <tr><td colSpan={4} className="text-center py-6 text-muted-foreground text-sm">No damage/return records</td></tr>}
                  </tbody>
                  {report.damagesData.length > 0 && (
                    <tfoot className="bg-muted/30">
                      <tr>
                        <td colSpan={3} className="px-4 py-2 text-xs font-semibold">Total</td>
                        <td className="px-4 py-2 text-xs font-bold">{fmt(report.totalDamages)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      ) : (
        <div className="text-center py-20 text-muted-foreground">
          <FileBarChart className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p>Loading report…</p>
        </div>
      )}
    </div>
  );
}
