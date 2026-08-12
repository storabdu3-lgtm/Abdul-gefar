import React, { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Package,
  Tags,
  Store as StoreIcon,
  Truck,
  Users,
  ArrowDownToLine,
  DollarSign,
  MonitorSmartphone,
  ClipboardList,
  ArrowRightLeft,
  AlertTriangle,
  Receipt,
  Layers,
  History,
  FileBarChart,
  Boxes,
  ShieldCheck,
  LogOut,
  Bell,
  CreditCard,
  X,
  AlertCircle,
  Package2,
  Menu,
  SendToBack,
  Landmark,
  Megaphone,
  ShoppingBag,
  ClipboardCheck,
  Settings,
  LayoutGrid,
  Play,
  ChevronLeft,
  ChevronRight,
  Plus,
  Minus,
  Video,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { useNotifications } from "@/hooks/useNotifications";
import { getAll, COLLECTIONS } from "@/lib/firestore";
import type { Promotion } from "@/lib/types";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, page: "dashboard" },
  { href: "/products", label: "Products", icon: Package, page: "products" },
  { href: "/categories", label: "Categories", icon: Tags, page: "categories" },
  { href: "/stores", label: "Stores", icon: StoreIcon, page: "stores" },
  { href: "/suppliers", label: "Suppliers", icon: Truck, page: "suppliers" },
  { href: "/customers", label: "Customers", icon: Users, page: "customers" },
  { href: "/stock-in", label: "Stock In", icon: ArrowDownToLine, page: "stock-in" },
  { href: "/pricing", label: "Pricing", icon: DollarSign, page: "pricing" },
  { href: "/pos-sales", label: "POS Sales", icon: MonitorSmartphone, page: "pos-sales" },
  { href: "/order-vouchers", label: "Order Vouchers", icon: ClipboardList, page: "order-vouchers" },
  { href: "/transfers", label: "Transfers", icon: ArrowRightLeft, page: "transfers" },
  { href: "/damage-returns", label: "Damage/Returns", icon: AlertTriangle, page: "damage-returns" },
  { href: "/expenses", label: "Expenses", icon: Receipt, page: "expenses" },
  { href: "/payment-transactions", label: "Payment Transactions", icon: CreditCard, page: "payment-transactions" },
  { href: "/store-balance", label: "Store Balance", icon: Layers, page: "store-balance" },
  { href: "/bincard", label: "Bincard", icon: History, page: "bincard" },
  { href: "/bincard-summary", label: "Bincard Summary", icon: LayoutGrid, page: "bincard-summary" },
  { href: "/reports", label: "Reports", icon: FileBarChart, page: "reports" },
  { href: "/inventory", label: "Inventory", icon: Boxes, page: "inventory" },
  { href: "/store-requests", label: "Store Requests", icon: SendToBack, page: "store-requests" },
  { href: "/accounts", label: "Accounts", icon: Landmark, page: "accounts" },
  { href: "/promotions", label: "Promotions", icon: Megaphone, page: "promotions" },
  { href: "/direct-sales", label: "Direct Sales", icon: ShoppingBag, page: "direct-sales" },
  { href: "/binning", label: "Binning", icon: ClipboardCheck, page: "binning" },
  { href: "/settings", label: "Settings", icon: Settings, page: "settings" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, isAdmin, hasPermission, signOut } = useAuth();
  const { notifications, requestPermission } = useNotifications();
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  // ── Promotion video state ──
  const [promoVideos, setPromoVideos] = useState<Promotion[]>([]);
  const [currentPromoIdx, setCurrentPromoIdx] = useState(0);
  const [promoDuration, setPromoDuration] = useState(30); // seconds per promo
  const promoVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    getAll<Promotion>(COLLECTIONS.PROMOTIONS).then(promos => {
      setPromoVideos(
        promos.filter(p => p.isActive && !(p as any).isVoided && p.showVideo && p.videoUrl)
      );
    });
  }, []);

  // Auto-cycle through promo videos
  useEffect(() => {
    if (promoVideos.length <= 1) return;
    const timer = setInterval(() => {
      setCurrentPromoIdx(i => (i + 1) % promoVideos.length);
    }, promoDuration * 1000);
    return () => clearInterval(timer);
  }, [promoVideos, promoDuration]);

  // Restart video when index changes
  useEffect(() => {
    if (promoVideoRef.current) {
      promoVideoRef.current.load();
      promoVideoRef.current.play().catch(() => {});
    }
  }, [currentPromoIdx]);

  const currentPromo = promoVideos[currentPromoIdx] ?? null;

  const visibleItems = NAV_ITEMS.filter(item => hasPermission(item.page));
  const unreadCount = notifications.length;

  function NavLinks({ onClose }: { onClose?: () => void }) {
    return (
      <>
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href ||
              (item.href !== "/dashboard" && location.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors text-sm font-medium",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}
                data-testid={`nav-${item.label.toLowerCase().replace(/[\s/]+/g, "-")}`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
          {isAdmin && (
            <>
              <div className="px-3 pt-3 pb-1">
                <span className="text-xs font-semibold text-sidebar-foreground/40 uppercase tracking-wider">Admin</span>
              </div>
              <Link
                href="/users"
                onClick={onClose}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors text-sm font-medium",
                  location === "/users"
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}
                data-testid="nav-users"
              >
                <ShieldCheck className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">Users</span>
              </Link>
            </>
          )}
        </nav>
        <div className="p-4 border-t border-sidebar-border space-y-2">
          {user && (
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-sidebar-accent/30">
              <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-bold text-primary">{user.name.charAt(0).toUpperCase()}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-sidebar-foreground truncate">{user.name}</p>
                <p className="text-xs text-sidebar-foreground/50 truncate">{user.role}</p>
              </div>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 px-2"
            onClick={() => { onClose?.(); signOut(); }}
          >
            <LogOut className="w-4 h-4 mr-2" />
            Sign Out
          </Button>
          <p className="text-xs text-sidebar-foreground/40 text-center">NexusStock v2.5.0</p>
        </div>
      </>
    );
  }

  return (
    <div className="flex min-h-screen w-full bg-background">
      {/* ── Mobile Drawer Backdrop ── */}
      {showMobileMenu && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setShowMobileMenu(false)}
        />
      )}

      {/* ── Mobile Slide-in Drawer ── */}
      <div className={cn(
        "fixed top-0 left-0 h-full w-72 z-50 bg-sidebar text-sidebar-foreground flex flex-col transition-transform duration-300 ease-in-out md:hidden",
        showMobileMenu ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="flex items-center justify-between p-4 border-b border-sidebar-border">
          <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            <Package className="w-6 h-6 text-primary" />
            NexusStock
          </h1>
          <Button
            variant="ghost"
            size="sm"
            className="text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
            onClick={() => setShowMobileMenu(false)}
          >
            <X className="w-5 h-5" />
          </Button>
        </div>
        <NavLinks onClose={() => setShowMobileMenu(false)} />
      </div>

      {/* ── Desktop Sidebar ── */}
      <aside className="w-64 flex-shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border hidden md:flex flex-col h-screen sticky top-0 overflow-y-auto">
        <div className="p-4 md:p-6 border-b border-sidebar-border">
          <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            <Package className="w-6 h-6 text-primary" />
            <span className="truncate">NexusStock</span>
          </h1>
        </div>
        <NavLinks />
      </aside>

      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto">
        {/* Top bar with notification bell */}
        <header className="flex items-center justify-end gap-2 px-4 md:px-8 py-3 border-b border-border bg-card sticky top-0 z-20">
          {/* Mobile: hamburger + brand */}
          <div className="flex items-center gap-2 flex-1 md:hidden">
            <Button
              variant="ghost"
              size="sm"
              className="p-1.5"
              onClick={() => setShowMobileMenu(true)}
              data-testid="btn-mobile-menu"
            >
              <Menu className="w-5 h-5" />
            </Button>
            <h1 className="font-bold tracking-tight text-foreground flex items-center gap-1.5">
              <Package className="w-5 h-5 text-primary" />
              NexusStock
            </h1>
          </div>

          {/* Notification Bell */}
          <div className="relative">
            <Button
              variant="ghost"
              size="sm"
              className="relative"
              onClick={() => {
                requestPermission();
                setShowNotifPanel(v => !v);
              }}
              data-testid="btn-notifications"
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </Button>

            {/* Notification dropdown */}
            {showNotifPanel && (
              <div className="absolute right-0 top-full mt-2 w-96 bg-card border border-border rounded-xl shadow-2xl z-50 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                  <span className="font-semibold text-sm">Notifications</span>
                  <div className="flex items-center gap-2">
                    {unreadCount > 0 && (
                      <span className="text-xs text-muted-foreground">{unreadCount} alert{unreadCount !== 1 ? "s" : ""}</span>
                    )}
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setShowNotifPanel(false)}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                {/* Promotion Videos in notification panel */}
                {promoVideos.length > 0 && (
                  <div className="border-b border-border bg-gradient-to-r from-indigo-950 to-slate-900 p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Video className="w-3.5 h-3.5 text-yellow-400" />
                      <span className="text-xs font-semibold text-yellow-300">Promotion Videos</span>
                      <span className="ml-auto text-xs text-slate-400">{promoDuration}s each</span>
                    </div>
                    <div className="space-y-2">
                      {promoVideos.map((promo, i) => (
                        <div
                          key={promo.id}
                          className={cn(
                            "flex items-center gap-2 p-1.5 rounded-lg transition-colors cursor-pointer",
                            i === currentPromoIdx ? "bg-white/10 ring-1 ring-yellow-400/50" : "hover:bg-white/5"
                          )}
                          onClick={() => setCurrentPromoIdx(i)}
                        >
                          <div className="relative flex-shrink-0">
                            <video
                              src={promo.videoUrl}
                              muted
                              autoPlay={i === currentPromoIdx}
                              loop
                              className="w-20 h-12 object-cover rounded border border-indigo-700"
                            />
                            {i === currentPromoIdx && (
                              <div className="absolute inset-0 flex items-center justify-center">
                                <Play className="w-4 h-4 text-yellow-300 drop-shadow" />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-white truncate">{promo.title}</p>
                            {promo.description && <p className="text-xs text-slate-400 truncate">{promo.description}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="max-h-80 overflow-y-auto divide-y divide-border">
                  {notifications.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                      <Bell className="w-8 h-8 mb-2 opacity-30" />
                      <p className="text-sm">No alerts right now</p>
                    </div>
                  ) : (
                    notifications.map(notif => (
                      <div key={notif.id} className={cn(
                        "flex gap-3 px-4 py-3 hover:bg-muted/50 transition-colors",
                      )}>
                        {/* Icon or product photo */}
                        {notif.type === "low_stock" && notif.photoUrl ? (
                          <img
                            src={notif.photoUrl}
                            alt={notif.title}
                            className="w-10 h-10 rounded-lg object-cover flex-shrink-0 border border-amber-200 mt-0.5"
                          />
                        ) : (
                          <div className={cn(
                            "w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5",
                            notif.severity === "error" ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600"
                          )}>
                            {notif.type === "overdue_payment"
                              ? <AlertCircle className="w-4 h-4" />
                              : <Package2 className="w-4 h-4" />
                            }
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium leading-snug">{notif.title}</p>
                          {notif.type === "low_stock" && notif.code && (
                            <p className="text-[10px] font-mono text-blue-600 font-semibold leading-none mb-0.5">{notif.code}</p>
                          )}
                          <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{notif.message}</p>
                        </div>
                        <div className={cn(
                          "w-1.5 rounded-full flex-shrink-0 self-stretch",
                          notif.severity === "error" ? "bg-red-400" : "bg-amber-400"
                        )} />
                      </div>
                    ))
                  )}
                </div>
                {notifications.length > 0 && (
                  <div className="px-4 py-2 border-t border-border bg-muted/20 text-xs text-muted-foreground">
                    Overdue = unpaid balance &gt; 30 days · Low stock = at or below min alert level
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Mobile sign out */}
          <div className="md:hidden">
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </header>

        {/* Click outside to close notification panel */}
        {showNotifPanel && (
          <div className="fixed inset-0 z-10" onClick={() => setShowNotifPanel(false)} />
        )}


        <div className="p-4 md:p-8 flex-1">
          {children}
        </div>
      </main>
    </div>
  );
}
