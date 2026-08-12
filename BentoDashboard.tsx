import React, { useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ComposedChart, Line, Area
} from "recharts";
import {
  Package, Store, Truck, Users, AlertCircle,
  TrendingUp, TrendingDown, Calendar, Search,
  ArrowUpRight, ArrowRight, MoreHorizontal, Bell
} from "lucide-react";
import "./BentoDashboard.css";

// --- MOCK DATA ---
const chartDataDay = [
  { label: "6am", revenue: 1200, items: 45 },
  { label: "8am", revenue: 2400, items: 85 },
  { label: "10am", revenue: 3800, items: 120 },
  { label: "12pm", revenue: 5100, items: 190 },
  { label: "2pm", revenue: 4200, items: 150 },
  { label: "4pm", revenue: 6800, items: 210 },
  { label: "6pm", revenue: 8500, items: 290 },
  { label: "8pm", revenue: 5400, items: 175 },
  { label: "10pm", revenue: 2100, items: 60 },
];

const chartDataWeek = [
  { label: "Mon", revenue: 14500, items: 420 },
  { label: "Tue", revenue: 18200, items: 510 },
  { label: "Wed", revenue: 16800, items: 480 },
  { label: "Thu", revenue: 21500, items: 630 },
  { label: "Fri", revenue: 28400, items: 810 },
  { label: "Sat", revenue: 35200, items: 1050 },
  { label: "Sun", revenue: 29100, items: 890 },
];

const chartDataMonth = [
  { label: "W1", revenue: 125000, items: 3800 },
  { label: "W2", revenue: 142000, items: 4100 },
  { label: "W3", revenue: 138000, items: 3950 },
  { label: "W4", revenue: 165000, items: 4800 },
];

const outstandingBalances = [
  { id: "1", name: "Abebe Bekele", phone: "+251 91 123 4567", balance: 14500, due: "Today" },
  { id: "2", name: "Sara Tefera", phone: "+251 92 234 5678", balance: 8200, due: "Tomorrow" },
  { id: "3", name: "Dawit Mekonnen", phone: "+251 93 345 6789", balance: 5400, due: "In 3 days" },
  { id: "4", name: "Betelhem Alemu", phone: "+251 94 456 7890", balance: 3100, due: "In 5 days" },
  { id: "5", name: "Yared Tadesse", phone: "+251 95 567 8901", balance: 1200, due: "Overdue" },
];

const fmt = (v: number) => new Intl.NumberFormat('en-ET', { style: 'currency', currency: 'ETB', maximumFractionDigits: 0 }).format(v);
const fmtShort = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));

export default function BentoDashboard() {
  const [period, setPeriod] = useState<"day" | "week" | "month">("week");
  
  const currentData = period === "day" ? chartDataDay : period === "week" ? chartDataWeek : chartDataMonth;
  const totalRevenue = currentData.reduce((acc, curr) => acc + curr.revenue, 0);
  const totalItems = currentData.reduce((acc, curr) => acc + curr.items, 0);
  const totalTxns = Math.floor(totalItems * 0.4);
  const avgSale = totalRevenue / totalTxns;

  return (
    <div className="bento-dashboard-wrapper p-4 md:p-8">
      <div className="max-w-[1600px] mx-auto space-y-8">
        
        {/* Header section */}
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <p className="text-slate-500 font-medium mb-1 flex items-center gap-2">
              <Calendar className="w-4 h-4" /> 
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
            <h1 className="text-3xl md:text-4xl font-bold text-slate-900 tracking-tight bento-gradient-text">
              Good morning, Admin
            </h1>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="flex bg-white rounded-full p-1 border border-slate-200 shadow-sm">
              {(["day", "week", "month"] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-5 py-2 rounded-full text-sm font-semibold capitalize transition-all ${
                    period === p 
                      ? "bg-slate-900 text-white shadow-md" 
                      : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            <button className="bg-white p-3 rounded-full border border-slate-200 shadow-sm text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-colors relative">
              <Bell className="w-5 h-5" />
              <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border-2 border-white"></span>
            </button>
          </div>
        </header>

        {/* Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          
          {/* Main Chart Area (Spans 8 cols) */}
          <div className="bento-card md:col-span-8 flex flex-col p-6 md:p-8 relative overflow-hidden group">
            {/* Background decoration */}
            <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-blue-50 rounded-full blur-3xl opacity-50 group-hover:opacity-70 transition-opacity pointer-events-none"></div>
            
            <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6 mb-8 relative z-10">
              <div>
                <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2">Total Revenue</p>
                <div className="flex items-end gap-4">
                  <h2 className="text-4xl md:text-5xl font-extrabold text-slate-900 tracking-tight">
                    {fmt(totalRevenue)}
                  </h2>
                  <div className="flex items-center gap-1 mb-2 px-2.5 py-1 rounded-full metric-trend-up text-sm font-bold">
                    <TrendingUp className="w-4 h-4" />
                    <span>+12.5%</span>
                  </div>
                </div>
              </div>

              {/* Sub-metrics inline */}
              <div className="flex gap-8 bg-slate-50/80 p-4 rounded-2xl border border-slate-100">
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase mb-1">Items Sold</p>
                  <p className="text-xl font-bold text-slate-800">{totalItems.toLocaleString()}</p>
                </div>
                <div className="w-px bg-slate-200"></div>
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase mb-1">Orders</p>
                  <p className="text-xl font-bold text-slate-800">{totalTxns.toLocaleString()}</p>
                </div>
                <div className="w-px bg-slate-200"></div>
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase mb-1">Avg Order</p>
                  <p className="text-xl font-bold text-slate-800">{fmt(avgSale)}</p>
                </div>
              </div>
            </div>

            <div className="flex-1 min-h-[300px] w-full mt-auto relative z-10 bento-chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={currentData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="4 4" vertical={false} />
                  <XAxis 
                    dataKey="label" 
                    tick={{ fontSize: 12, fill: "#94a3b8", fontWeight: 500 }} 
                    tickLine={false} 
                    axisLine={false} 
                    dy={10}
                  />
                  <YAxis 
                    yAxisId="left" 
                    tickFormatter={fmtShort} 
                    tick={{ fontSize: 12, fill: "#94a3b8", fontWeight: 500 }} 
                    tickLine={false} 
                    axisLine={false} 
                  />
                  <Tooltip
                    cursor={{ fill: '#f8fafc' }}
                    contentStyle={{ 
                      borderRadius: '16px', 
                      border: 'none',
                      boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)',
                      padding: '12px 16px',
                      fontWeight: 600,
                      fontFamily: "'Outfit', sans-serif"
                    }}
                    itemStyle={{ color: '#0f172a' }}
                    formatter={(value: number, name: string) => [
                      name === "revenue" ? fmt(value) : value.toLocaleString(),
                      name === "revenue" ? "Revenue" : "Items",
                    ]}
                  />
                  <Area yAxisId="left" type="monotone" dataKey="revenue" stroke="none" fillOpacity={1} fill="url(#colorRevenue)" />
                  <Bar yAxisId="left" dataKey="revenue" fill="#0f172a" radius={[6, 6, 0, 0]} maxBarSize={40} name="revenue" />
                  <Line yAxisId="left" type="monotone" dataKey="items" stroke="#3b82f6" strokeWidth={3} dot={{ fill: "#ffffff", stroke: "#3b82f6", strokeWidth: 2, r: 4 }} activeDot={{ r: 6 }} name="items" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Outstanding Balances - The replacement for the annoying popup (Spans 4 cols) */}
          <div className="bento-card md:col-span-4 flex flex-col bg-slate-900 text-white overflow-hidden relative">
            <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/20 blur-3xl rounded-full -mr-10 -mt-10 pointer-events-none"></div>
            
            <div className="p-6 md:p-8 flex-1 flex flex-col z-10">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center text-red-400">
                    <AlertCircle className="w-5 h-5" />
                  </div>
                  <h3 className="text-xl font-bold">Action Required</h3>
                </div>
                <span className="bg-red-500 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                  {outstandingBalances.length} pending
                </span>
              </div>

              <p className="text-slate-400 text-sm mb-6">
                These customers have outstanding balances that need immediate attention.
              </p>

              <div className="flex-1 overflow-y-auto bento-scrollbar pr-2 space-y-4">
                {outstandingBalances.map((customer, idx) => (
                  <div key={customer.id} className="group flex items-center justify-between p-4 rounded-2xl bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 transition-colors cursor-pointer">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center font-bold text-slate-300 group-hover:bg-slate-600 transition-colors">
                        {customer.name.charAt(0)}
                      </div>
                      <div>
                        <p className="font-bold text-sm text-slate-200">{customer.name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{customer.due}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-red-400">{fmt(customer.balance)}</p>
                      <p className="text-xs text-slate-500 mt-0.5 group-hover:text-slate-400 transition-colors flex items-center justify-end gap-1">
                        Collect <ArrowRight className="w-3 h-3" />
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <button className="mt-6 w-full py-3.5 rounded-xl bg-white text-slate-900 font-bold text-sm hover:bg-slate-100 transition-colors flex items-center justify-center gap-2">
                View All Receivables
              </button>
            </div>
          </div>

          {/* Bottom Row - System Summary (4 Cards) */}
          <div className="bento-card md:col-span-3 p-6 group cursor-pointer">
            <div className="flex justify-between items-start mb-4">
              <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center text-blue-600 group-hover:scale-110 group-hover:rotate-3 transition-transform">
                <Package className="w-6 h-6" />
              </div>
              <button className="text-slate-400 hover:text-slate-900 transition-colors">
                <ArrowUpRight className="w-5 h-5" />
              </button>
            </div>
            <p className="text-slate-500 font-medium text-sm mb-1">Total Products</p>
            <div className="flex items-end gap-3">
              <h3 className="text-3xl font-bold text-slate-900">1,248</h3>
              <span className="text-xs font-bold text-emerald-500 mb-1 flex items-center">
                <TrendingUp className="w-3 h-3 mr-0.5" /> 12 new
              </span>
            </div>
          </div>

          <div className="bento-card md:col-span-3 p-6 group cursor-pointer">
            <div className="flex justify-between items-start mb-4">
              <div className="w-12 h-12 rounded-2xl bg-purple-50 flex items-center justify-center text-purple-600 group-hover:scale-110 group-hover:-rotate-3 transition-transform">
                <Store className="w-6 h-6" />
              </div>
              <button className="text-slate-400 hover:text-slate-900 transition-colors">
                <ArrowUpRight className="w-5 h-5" />
              </button>
            </div>
            <p className="text-slate-500 font-medium text-sm mb-1">Active Stores</p>
            <div className="flex items-end gap-3">
              <h3 className="text-3xl font-bold text-slate-900">4</h3>
              <span className="text-xs font-bold text-slate-400 mb-1">All operational</span>
            </div>
          </div>

          <div className="bento-card md:col-span-3 p-6 group cursor-pointer">
            <div className="flex justify-between items-start mb-4">
              <div className="w-12 h-12 rounded-2xl bg-orange-50 flex items-center justify-center text-orange-600 group-hover:scale-110 group-hover:rotate-3 transition-transform">
                <Truck className="w-6 h-6" />
              </div>
              <button className="text-slate-400 hover:text-slate-900 transition-colors">
                <ArrowUpRight className="w-5 h-5" />
              </button>
            </div>
            <p className="text-slate-500 font-medium text-sm mb-1">Suppliers</p>
            <div className="flex items-end gap-3">
              <h3 className="text-3xl font-bold text-slate-900">24</h3>
              <span className="text-xs font-bold text-emerald-500 mb-1 flex items-center">
                <TrendingUp className="w-3 h-3 mr-0.5" /> 2 pending
              </span>
            </div>
          </div>

          <div className="bento-card md:col-span-3 p-6 group cursor-pointer">
            <div className="flex justify-between items-start mb-4">
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center text-emerald-600 group-hover:scale-110 group-hover:-rotate-3 transition-transform">
                <Users className="w-6 h-6" />
              </div>
              <button className="text-slate-400 hover:text-slate-900 transition-colors">
                <ArrowUpRight className="w-5 h-5" />
              </button>
            </div>
            <p className="text-slate-500 font-medium text-sm mb-1">Total Customers</p>
            <div className="flex items-end gap-3">
              <h3 className="text-3xl font-bold text-slate-900">842</h3>
              <span className="text-xs font-bold text-emerald-500 mb-1 flex items-center">
                <TrendingUp className="w-3 h-3 mr-0.5" /> +18%
              </span>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
