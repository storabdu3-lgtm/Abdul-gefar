import React, { useEffect, useState, useMemo } from "react";
import {
  Package, Store, Truck, Users, AlertCircle, DollarSign,
  ShoppingCart, TrendingUp, X, ChevronDown, ChevronUp, BarChart2,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ComposedChart, Line,
} from "recharts";
import { fmt } from "@/lib/currency";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getAll, COLLECTIONS } from "@/lib/firestore";
import type { Product, Store as StoreType, Supplier, Customer, PosSale, EcommerceOrder, Category } from "@/lib/types";

type Period = "day" | "week" | "month";

interface ChartPoint { label: string; revenue: number; items: number; }

function toDate(ts: any): Date {
  if (!ts) return new Date(0);
  if (ts && typeof ts.toDate === "function") return ts.toDate();
  return new Date(ts);
}

function aggregateSales(sales: PosSale[], period: Period): ChartPoint[] {
  const now = new Date();

  if (period === "week") {
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    const data: ChartPoint[] = dayNames.map(d => ({ label: d, revenue: 0, items: 0 }));
    for (const sale of sales) {
      const d = toDate(sale.createdAt);
      if (d >= startOfWeek) {
        const idx = d.getDay();
        data[idx].revenue += sale.totalAmount || 0;
        data[idx].items += sale.items.reduce((s, i) => s + i.quantity, 0);
      }
    }
    return data;
  }

  if (period === "month") {
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const data: ChartPoint[] = Array.from({ length: daysInMonth }, (_, i) => ({
      label: String(i + 1), revenue: 0, items: 0,
    }));
    for (const sale of sales) {
      const d = toDate(sale.createdAt);
      if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) {
        data[d.getDate() - 1].revenue += sale.totalAmount || 0;
        data[d.getDate() - 1].items += sale.items.reduce((s, i) => s + i.quantity, 0);
      }
    }
    return data;
  }

  // day — show 6am to 10pm
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const hours: ChartPoint[] = Array.from({ length: 24 }, (_, i) => ({
    label: i === 0 ? "12am" : i < 12 ? `${i}am` : i === 12 ? "12pm" : `${i - 12}pm`,
    revenue: 0, items: 0,
  }));
  for (const sale of sales) {
    const d = toDate(sale.createdAt);
    if (d >= startOfToday) {
      const hr = d.getHours();
      hours[hr].revenue += sale.totalAmount || 0;
      hours[hr].items += sale.items.reduce((s, i) => s + i.quantity, 0);
    }
  }
  return hours.slice(6, 23);
}

const fmtShort = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));

export default function Dashboard() {
  const [allSales, setAllSales] = useState<PosSale[]>([]);
  const [stores, setStores] = useState<StoreType[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [productCatMap, setProductCatMap] = useState<Record<string, string>>({});
  const [stats, setStats] = useState<{ products: number; stores: number; suppliers: number; customers: number } | null>(null);
  const [customersWithBalance, setCustomersWithBalance] = useState<Customer[]>([]);
  const [showBalancePopup, setShowBalancePopup] = useState(true);
  const [popupExpanded, setPopupExpanded] = useState(true);
  const [loading, setLoading] = useState(true);

  const [period, setPeriod] = useState<Period>("week");
  const [selectedStore, setSelectedStore] = useState("all");
  const [selectedCategory, setSelectedCategory] = useState("all");

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [products, storeList, suppliers, customers, sales, , catList] = await Promise.all([
          getAll<Product>(COLLECTIONS.PRODUCTS),
          getAll<StoreType>(COLLECTIONS.STORES),
          getAll<Supplier>(COLLECTIONS.SUPPLIERS),
          getAll<Customer>(COLLECTIONS.CUSTOMERS),
          getAll<PosSale>(COLLECTIONS.POS_SALES),
          getAll<EcommerceOrder>(COLLECTIONS.ORDER_VOUCHERS),
          getAll<Category>(COLLECTIONS.CATEGORIES),
        ]);

        setAllSales(sales);
        setStores(storeList);
        setCategories(catList);

        const map: Record<string, string> = {};
        products.forEach(p => { if (p.categoryId) map[p.id] = p.categoryId; });
        setProductCatMap(map);

        setCustomersWithBalance(
          customers.filter(c => (c.totalBalance || 0) > 0)
            .sort((a, b) => (b.totalBalance || 0) - (a.totalBalance || 0))
        );
        setStats({
          products: products.length,
          stores: storeList.length,
          suppliers: suppliers.length,
          customers: customers.length,
        });
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const filteredSales = useMemo(() => allSales.filter(sale => {
    if (selectedStore !== "all" && sale.storeId !== selectedStore) return false;
    if (selectedCategory !== "all") {
      const ok = sale.items.some(item => productCatMap[item.productId] === selectedCategory);
      if (!ok) return false;
    }
    return true;
  }), [allSales, selectedStore, selectedCategory, productCatMap]);

  const chartData = useMemo(() => aggregateSales(filteredSales, period), [filteredSales, period]);

  const periodRevenue = useMemo(() => chartData.reduce((s, d) => s + d.revenue, 0), [chartData]);
  const periodItems = useMemo(() => chartData.reduce((s, d) => s + d.items, 0), [chartData]);
  const periodTxns = useMemo(() => {
    const now = new Date();
    if (period === "day") {
      const start = new Date(now); start.setHours(0, 0, 0, 0);
      return filteredSales.filter(s => toDate(s.createdAt) >= start).length;
    }
    if (period === "week") {
      const start = new Date(now); start.setDate(now.getDate() - now.getDay()); start.setHours(0, 0, 0, 0);
      return filteredSales.filter(s => toDate(s.createdAt) >= start).length;
    }
    return filteredSales.filter(s => {
      const d = toDate(s.createdAt);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;
  }, [filteredSales, period]);

  const avgPerSale = periodTxns > 0 ? periodRevenue / periodTxns : 0;
  const periodLabel = period === "day" ? "Today" : period === "week" ? "This Week" : "This Month";

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-28">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Overview of your enterprise operations.</p>
      </div>

      {/* System Summary Cards */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}><CardHeader className="pb-2"><Skeleton className="h-4 w-24" /></CardHeader><CardContent><Skeleton className="h-8 w-16" /></CardContent></Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard title="Products" value={stats?.products ?? 0} icon={Package} />
          <StatCard title="Stores" value={stats?.stores ?? 0} icon={Store} />
          <StatCard title="Suppliers" value={stats?.suppliers ?? 0} icon={Truck} />
          <StatCard title="Customers" value={stats?.customers ?? 0} icon={Users} />
        </div>
      )}

      {/* Sales Analytics */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold tracking-tight">Sales Analytics</h2>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Period toggle */}
            <div className="flex rounded-lg border border-border overflow-hidden">
              {(["day", "week", "month"] as Period[]).map(p => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${period === p ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
                >
                  {p === "day" ? "Today" : p === "week" ? "Week" : "Month"}
                </button>
              ))}
            </div>

            {/* Store filter */}
            <Select value={selectedStore} onValueChange={setSelectedStore}>
              <SelectTrigger className="h-8 text-xs w-36">
                <SelectValue placeholder="All Stores" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stores</SelectItem>
                {stores.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Category filter */}
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="h-8 text-xs w-36">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Period summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-950/30 dark:to-blue-900/20 border-blue-200/60">
            <CardContent className="p-4">
              <p className="text-xs text-blue-600 font-medium uppercase tracking-wide">{periodLabel} Revenue</p>
              <p className="text-2xl font-bold text-blue-700 mt-1">{fmt(periodRevenue)}</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:from-emerald-950/30 dark:to-emerald-900/20 border-emerald-200/60">
            <CardContent className="p-4">
              <p className="text-xs text-emerald-600 font-medium uppercase tracking-wide">Items Sold</p>
              <p className="text-2xl font-bold text-emerald-700 mt-1">{periodItems.toLocaleString()}</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-violet-50 to-violet-100/50 dark:from-violet-950/30 dark:to-violet-900/20 border-violet-200/60">
            <CardContent className="p-4">
              <p className="text-xs text-violet-600 font-medium uppercase tracking-wide">Transactions</p>
              <p className="text-2xl font-bold text-violet-700 mt-1">{periodTxns.toLocaleString()}</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-orange-50 to-orange-100/50 dark:from-orange-950/30 dark:to-orange-900/20 border-orange-200/60">
            <CardContent className="p-4">
              <p className="text-xs text-orange-600 font-medium uppercase tracking-wide">Avg per Sale</p>
              <p className="text-2xl font-bold text-orange-700 mt-1">{fmt(avgPerSale)}</p>
            </CardContent>
          </Card>
        </div>

        {/* Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Revenue & Items Sold — {periodLabel}
              {selectedStore !== "all" && ` · ${stores.find(s => s.id === selectedStore)?.name}`}
              {selectedCategory !== "all" && ` · ${categories.find(c => c.id === selectedCategory)?.name}`}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <Skeleton className="h-56 w-full rounded-md" />
            ) : chartData.every(d => d.revenue === 0) ? (
              <div className="h-56 flex flex-col items-center justify-center text-muted-foreground gap-2">
                <BarChart2 className="w-8 h-8 opacity-30" />
                <p className="text-sm">No sales data for {periodLabel.toLowerCase()}</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={chartData} margin={{ top: 4, right: 20, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                  <YAxis yAxisId="left" tickFormatter={fmtShort} tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      name === "revenue" ? fmt(value) : value.toLocaleString(),
                      name === "revenue" ? "Revenue" : "Items Sold",
                    ]}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
                  />
                  <Legend formatter={(v) => v === "revenue" ? "Revenue (ETB)" : "Items Sold"} wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="left" dataKey="revenue" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={48} name="revenue" />
                  <Line yAxisId="right" type="monotone" dataKey="items" stroke="#10b981" strokeWidth={2} dot={{ fill: "#10b981", r: 3 }} name="items" />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Customer Outstanding Balance Popup */}
      {showBalancePopup && customersWithBalance.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pointer-events-none">
          <div className="pointer-events-auto w-full max-w-2xl mx-4 mb-0 rounded-t-2xl shadow-2xl border border-border overflow-hidden" style={{ background: "white" }}>
            <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-red-600 to-red-700 text-white">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                <span className="font-semibold text-sm">
                  {customersWithBalance.length} Customer{customersWithBalance.length !== 1 ? "s" : ""} with Outstanding Balance
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button className="p-1 rounded hover:bg-white/20 transition-colors" onClick={() => setPopupExpanded(e => !e)}>
                  {popupExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                </button>
                <button className="p-1 rounded hover:bg-white/20 transition-colors" onClick={() => setShowBalancePopup(false)}>
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            {popupExpanded && (
              <div className="max-h-52 overflow-y-auto divide-y divide-border">
                {customersWithBalance.map((c, i) => (
                  <div key={c.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-muted/40 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold ${i === 0 ? "bg-red-600" : i === 1 ? "bg-orange-500" : "bg-yellow-500"}`}>
                        {i + 1}
                      </div>
                      <div>
                        <p className="font-medium text-sm text-foreground">{c.name}</p>
                        <p className="text-xs text-muted-foreground">{c.phone || c.address || "—"}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-red-600 text-sm">{fmt(c.totalBalance || 0)}</p>
                      <p className="text-xs text-muted-foreground">Paid: {fmt(c.totalPaid || 0)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ title, value, icon: Icon, trend, className, iconClass }: {
  title: string; value: string | number; icon: React.ElementType; trend?: string; className?: string; iconClass?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className={`w-4 h-4 text-muted-foreground ${iconClass || ""}`} />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {trend && <p className="text-xs text-muted-foreground mt-1">{trend}</p>}
      </CardContent>
    </Card>
  );
}
