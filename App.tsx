import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect } from "react";
import { AuthProvider, useAuth } from "@/lib/auth";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import Products from "@/pages/Products";
import Categories from "@/pages/Categories";
import Stores from "@/pages/Stores";
import Suppliers from "@/pages/Suppliers";
import Customers from "@/pages/Customers";
import StockIn from "@/pages/StockIn";
import Pricing from "@/pages/Pricing";
import PosSales from "@/pages/PosSales";
import Ecommerce from "@/pages/Ecommerce";
import OrderVouchers from "@/pages/OrderVouchers";
import Transfers from "@/pages/Transfers";
import DamageReturns from "@/pages/DamageReturns";
import Expenses from "@/pages/Expenses";
import StoreBalance from "@/pages/StoreBalance";
import Bincard from "@/pages/Bincard";
import BincardSummary from "@/pages/BincardSummary";
import Reports from "@/pages/Reports";
import Inventory from "@/pages/Inventory";
import PaymentTransactions from "@/pages/PaymentTransactions";
import UserManagement from "@/pages/UserManagement";
import StoreRequests from "@/pages/StoreRequests";
import Accounts from "@/pages/Accounts";
import Promotions from "@/pages/Promotions";
import DirectSales from "@/pages/DirectSales";
import Binning from "@/pages/Binning";
import Settings from "@/pages/Settings";
import Login from "@/pages/Login";

const queryClient = new QueryClient();

function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="text-5xl mb-4">🔒</div>
      <h2 className="text-xl font-bold mb-2">Access Denied</h2>
      <p className="text-muted-foreground text-sm">
        You don't have permission to view this page.<br />
        Contact your admin to request access.
      </p>
    </div>
  );
}

function RequireAuth({ page, children }: { page: string; children: React.ReactNode }) {
  const { user, loading, hasPermission } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!loading && !user) setLocation("/login");
  }, [user, loading]);

  if (loading) return null;
  if (!user) return null;
  if (!hasPermission(page)) return <AccessDenied />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user, loading, isAdmin } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!loading && !user) setLocation("/login");
  }, [user, loading]);

  if (loading) return null;
  if (!user) return null;
  if (!isAdmin) return <AccessDenied />;
  return <>{children}</>;
}

function DashboardRouter() {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!loading && !user) setLocation("/login");
  }, [user, loading]);

  if (loading) return null;
  if (!user) return null;

  return (
    <Layout>
      <Switch>
        <Route path="/dashboard">
          <RequireAuth page="dashboard"><Dashboard /></RequireAuth>
        </Route>
        <Route path="/products">
          <RequireAuth page="products"><Products /></RequireAuth>
        </Route>
        <Route path="/categories">
          <RequireAuth page="categories"><Categories /></RequireAuth>
        </Route>
        <Route path="/stores">
          <RequireAuth page="stores"><Stores /></RequireAuth>
        </Route>
        <Route path="/suppliers">
          <RequireAuth page="suppliers"><Suppliers /></RequireAuth>
        </Route>
        <Route path="/customers">
          <RequireAuth page="customers"><Customers /></RequireAuth>
        </Route>
        <Route path="/stock-in">
          <RequireAuth page="stock-in"><StockIn /></RequireAuth>
        </Route>
        <Route path="/pricing">
          <RequireAuth page="pricing"><Pricing /></RequireAuth>
        </Route>
        <Route path="/pos-sales">
          <RequireAuth page="pos-sales"><PosSales /></RequireAuth>
        </Route>
        <Route path="/order-vouchers">
          <RequireAuth page="order-vouchers"><OrderVouchers /></RequireAuth>
        </Route>
        <Route path="/transfers">
          <RequireAuth page="transfers"><Transfers /></RequireAuth>
        </Route>
        <Route path="/damage-returns">
          <RequireAuth page="damage-returns"><DamageReturns /></RequireAuth>
        </Route>
        <Route path="/expenses">
          <RequireAuth page="expenses"><Expenses /></RequireAuth>
        </Route>
        <Route path="/payment-transactions">
          <RequireAuth page="payment-transactions"><PaymentTransactions /></RequireAuth>
        </Route>
        <Route path="/store-balance">
          <RequireAuth page="store-balance"><StoreBalance /></RequireAuth>
        </Route>
        <Route path="/bincard">
          <RequireAuth page="bincard"><Bincard /></RequireAuth>
        </Route>
        <Route path="/bincard-summary">
          <RequireAuth page="bincard-summary"><BincardSummary /></RequireAuth>
        </Route>
        <Route path="/reports">
          <RequireAuth page="reports"><Reports /></RequireAuth>
        </Route>
        <Route path="/inventory">
          <RequireAuth page="inventory"><Inventory /></RequireAuth>
        </Route>
        <Route path="/store-requests">
          <RequireAuth page="store-requests"><StoreRequests /></RequireAuth>
        </Route>
        <Route path="/accounts">
          <RequireAuth page="accounts"><Accounts /></RequireAuth>
        </Route>
        <Route path="/promotions">
          <RequireAuth page="promotions"><Promotions /></RequireAuth>
        </Route>
        <Route path="/direct-sales">
          <RequireAuth page="direct-sales"><DirectSales /></RequireAuth>
        </Route>
        <Route path="/binning">
          <RequireAuth page="binning"><Binning /></RequireAuth>
        </Route>
        <Route path="/settings">
          <RequireAuth page="settings"><Settings /></RequireAuth>
        </Route>
        <Route path="/users">
          <RequireAdmin><UserManagement /></RequireAdmin>
        </Route>
        <Route><NotFound /></Route>
      </Switch>
    </Layout>
  );
}

function AppRoutes() {
  return (
    <Switch>
      <Route path="/"><Ecommerce /></Route>
      <Route path="/login"><Login /></Route>
      <Route><DashboardRouter /></Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
