import { useState, useRef, useEffect } from "react";
import { Upload, Download, Trash2, Package, AlertTriangle, Loader2, ShieldAlert, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { getAll, create, clearCollection, COLLECTIONS, generateVoucherId } from "@/lib/firestore";
import { shareAsPdf } from "@/lib/shareImage";
import type { Product, Category, Store, StoreBalance } from "@/lib/types";
import * as XLSX from "xlsx";

const ALL_DATA_COLLECTIONS = [
  COLLECTIONS.PRODUCTS,
  COLLECTIONS.CATEGORIES,
  COLLECTIONS.STORES,
  COLLECTIONS.SUPPLIERS,
  COLLECTIONS.CUSTOMERS,
  COLLECTIONS.STOCK_IN,
  COLLECTIONS.POS_SALES,
  COLLECTIONS.ORDER_VOUCHERS,
  COLLECTIONS.TRANSFERS,
  COLLECTIONS.DAMAGE_RETURNS,
  COLLECTIONS.EXPENSES,
  COLLECTIONS.PRICING,
  COLLECTIONS.STORE_BALANCE,
  COLLECTIONS.BINCARD,
  COLLECTIONS.SUPPLIER_PAYMENTS,
  COLLECTIONS.CUSTOMER_PAYMENTS,
  COLLECTIONS.PRODUCT_REQUESTS,
  COLLECTIONS.ACCOUNT_VOUCHERS,
  COLLECTIONS.ACCOUNTS,
  COLLECTIONS.COUNTERS,
] as const;

export default function Inventory() {
  const { toast } = useToast();
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearTarget, setClearTarget] = useState<"products" | "stock" | "all" | "">("");
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [resetting, setResetting] = useState(false);
  const [importMode, setImportMode] = useState<"products" | "stock">("products");
  const fileRef = useRef<HTMLInputElement>(null);
  const inventoryPdfRef = useRef<HTMLDivElement>(null);
  const [sharingInventoryPdf, setSharingInventoryPdf] = useState(false);
  const [inventoryProducts, setInventoryProducts] = useState<Product[]>([]);

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const wb = XLSX.read(arrayBuffer, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);

      if (importMode === "products") {
        const categories = await getAll<Category>(COLLECTIONS.CATEGORIES);
        let imported = 0;
        for (const row of rows) {
          const name = String(row["Name"] || row["name"] || "").trim();
          const code = String(row["Code"] || row["code"] || "").trim();
          if (!name || !code) continue;
          const categoryName = String(row["Category"] || row["category"] || "").trim();
          const cat = categories.find(c => c.name.toLowerCase() === categoryName.toLowerCase());
          await create(COLLECTIONS.PRODUCTS, {
            name,
            code,
            categoryId: cat?.id || "",
            categoryName: cat?.name || categoryName,
            quantityPerCarton: Number(row["Qty Per Carton"] || row["qty_per_carton"] || 1),
            minCartonAlert: Number(row["Min Alert"] || row["min_alert"] || 1),
            description: String(row["Description"] || row["description"] || ""),
            photoUrl: "",
            barcodeValue: code,
            voucherId: generateVoucherId("PROD"),
            isVoided: false,
          } as Record<string, unknown>);
          imported++;
        }
        toast({ title: `Imported ${imported} products` });
      } else {
        const products = await getAll<Product>(COLLECTIONS.PRODUCTS);
        const stores = await getAll<Store>(COLLECTIONS.STORES);
        let imported = 0;
        for (const row of rows) {
          const productCode = String(row["Product Code"] || row["product_code"] || "").trim();
          const storeName = String(row["Store"] || row["store"] || "").trim();
          const quantity = Number(row["Balance"] || row["balance"] || row["Quantity"] || row["quantity"] || 0);
          if (!productCode || !storeName || quantity <= 0) continue;
          const product = products.find(p => p.code === productCode);
          const store = stores.find(s => s.name.toLowerCase() === storeName.toLowerCase());
          if (!product || !store) continue;
          await create(COLLECTIONS.STORE_BALANCE, {
            storeId: store.id,
            storeName: store.name,
            productId: product.id,
            productName: product.name,
            productCode: product.code,
            photoUrl: product.photoUrl || "",
            quantity,
          } as Record<string, unknown>);
          imported++;
        }
        toast({ title: `Imported ${imported} stock records` });
      }
    } catch (err) {
      toast({ title: "Import failed", description: String(err instanceof Error ? err.message : err), variant: "destructive" });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleInventoryPdf() {
    setSharingInventoryPdf(true);
    try {
      const [products] = await Promise.all([
        getAll<Product>(COLLECTIONS.PRODUCTS),
      ]);
      setInventoryProducts(products);
      await new Promise(r => setTimeout(r, 400));
      if (!inventoryPdfRef.current) return;
      const result = await shareAsPdf(inventoryPdfRef.current, "inventory.pdf");
      if (result === "failed") toast({ title: "PDF generation failed", variant: "destructive" });
    } finally {
      setSharingInventoryPdf(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const [products, categories, storeBalances, stores] = await Promise.all([
        getAll<Product>(COLLECTIONS.PRODUCTS),
        getAll<Category>(COLLECTIONS.CATEGORIES),
        getAll<StoreBalance>(COLLECTIONS.STORE_BALANCE),
        getAll<Store>(COLLECTIONS.STORES),
      ]);

      const wb = XLSX.utils.book_new();

      // Products sheet
      const productData = [
        ["Name", "Code", "Category", "Qty Per Carton", "Min Alert", "Description"],
        ...products.map(p => [p.name, p.code, p.categoryName || "", p.quantityPerCarton, p.minCartonAlert, p.description || ""]),
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(productData), "Products");

      // Categories sheet
      const catData = [["Name", "Description"], ...categories.map(c => [c.name, c.description || ""])];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(catData), "Categories");

      // Stock Balance sheet
      const stockData = [
        ["Store", "Product Code", "Product Name", "Quantity"],
        ...storeBalances.map(sb => [sb.storeName, sb.productCode, sb.productName, sb.quantity]),
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(stockData), "Stock Balance");

      // Stores sheet
      const storeData = [["Name", "Level", "Address"], ...stores.map(s => [s.name, s.level, s.address])];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(storeData), "Stores");

      XLSX.writeFile(wb, `NexusStock-Export-${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast({ title: "Export complete" });
    } catch (err) {
      toast({ title: "Export failed", description: String(err instanceof Error ? err.message : err), variant: "destructive" });
    } finally {
      setExporting(false);
    }
  }

  async function handleClear() {
    if (!clearTarget) return;
    setClearing(true);
    try {
      if (clearTarget === "stock" || clearTarget === "all") {
        await clearCollection(COLLECTIONS.STORE_BALANCE);
      }
      if (clearTarget === "products" || clearTarget === "all") {
        await clearCollection(COLLECTIONS.PRODUCTS);
      }
      const labels: Record<string, string> = { products: "all products", stock: "all stock balances", all: "all products and stock" };
      toast({ title: `Cleared ${labels[clearTarget]}` });
      setShowClearDialog(false);
      setClearTarget("");
    } catch (err) {
      toast({ title: "Clear failed", description: String(err instanceof Error ? err.message : err), variant: "destructive" });
    } finally {
      setClearing(false);
    }
  }

  async function handleResetAll() {
    if (resetConfirmText !== "DELETE") return;
    setResetting(true);
    try {
      await Promise.all(ALL_DATA_COLLECTIONS.map(col => clearCollection(col)));
      toast({ title: "All data deleted", description: "User accounts have been preserved." });
      setShowResetDialog(false);
      setResetConfirmText("");
    } catch (err) {
      toast({ title: "Reset failed", description: String(err instanceof Error ? err.message : err), variant: "destructive" });
    } finally {
      setResetting(false);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Inventory Management</h1>
        <p className="text-muted-foreground text-sm mt-1">Import, export, and manage your inventory data</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* Import Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Upload className="w-4 h-4 text-primary" /> Import Data
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">Upload an Excel (.xlsx) or CSV file to bulk-import records.</p>
            <div>
              <Label>Import Type</Label>
              <Select value={importMode} onValueChange={v => setImportMode(v as "products" | "stock")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="products">Products (Name, Code, Category, Qty Per Carton, Min Alert, Description)</SelectItem>
                  <SelectItem value="stock">Stock Balance (Product Code, Store, Quantity)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="bg-muted rounded p-2 text-xs space-y-0.5 text-muted-foreground">
              {importMode === "products" ? (
                <>
                  <p className="font-medium">Required columns:</p>
                  <p>Name, Code</p>
                  <p className="font-medium mt-1">Optional:</p>
                  <p>Category, Qty Per Carton, Min Alert, Description</p>
                </>
              ) : (
                <>
                  <p className="font-medium">Required columns:</p>
                  <p>Product Code, Store, Quantity</p>
                </>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={handleImport}
            />
            <Button
              className="w-full"
              onClick={() => fileRef.current?.click()}
              disabled={importing}
            >
              {importing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
              {importing ? "Importing..." : "Select File & Import"}
            </Button>
          </CardContent>
        </Card>

        {/* Export Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Download className="w-4 h-4 text-green-600" /> Export Data
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">Download your complete inventory data as an Excel file.</p>
            <div className="bg-muted rounded p-2 text-xs space-y-0.5 text-muted-foreground">
              <p className="font-medium">Includes sheets:</p>
              <p>• Products</p>
              <p>• Categories</p>
              <p>• Stock Balance</p>
              <p>• Stores</p>
            </div>
            <Button
              className="w-full bg-green-600 hover:bg-green-700 text-white"
              onClick={handleExport}
              disabled={exporting}
            >
              {exporting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Download className="w-4 h-4 mr-2" />}
              {exporting ? "Exporting..." : "Export to Excel"}
            </Button>
          </CardContent>
        </Card>

        {/* PDF Share Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="w-4 h-4 text-blue-600" /> PDF Inventory Report
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">Generate and share a PDF report of all products in your inventory.</p>
            <div className="bg-muted rounded p-2 text-xs space-y-0.5 text-muted-foreground">
              <p className="font-medium">Includes:</p>
              <p>• Product list with codes</p>
              <p>• Categories & qty per carton</p>
              <p>• Min stock alerts</p>
            </div>
            <Button
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              onClick={handleInventoryPdf}
              disabled={sharingInventoryPdf}
            >
              {sharingInventoryPdf ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <FileText className="w-4 h-4 mr-2" />}
              {sharingInventoryPdf ? "Generating PDF…" : "Generate & Share PDF"}
            </Button>
          </CardContent>
        </Card>

        {/* Clear Card */}
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-destructive">
              <Trash2 className="w-4 h-4" /> Clear Inventory
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">Permanently delete inventory records. This action cannot be undone.</p>
            <div className="space-y-2">
              <Button
                variant="outline"
                className="w-full border-destructive/40 text-destructive hover:bg-destructive/10"
                onClick={() => { setClearTarget("stock"); setShowClearDialog(true); }}
              >
                <Trash2 className="w-4 h-4 mr-2" /> Clear Stock Balances
              </Button>
              <Button
                variant="outline"
                className="w-full border-destructive/40 text-destructive hover:bg-destructive/10"
                onClick={() => { setClearTarget("products"); setShowClearDialog(true); }}
              >
                <Package className="w-4 h-4 mr-2" /> Clear All Products
              </Button>
              <Button
                variant="destructive"
                className="w-full"
                onClick={() => { setClearTarget("all"); setShowClearDialog(true); }}
              >
                <AlertTriangle className="w-4 h-4 mr-2" /> Clear Products & Stock
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Reset All Data Card — full width, very prominent */}
      <div className="mt-4">
        <Card className="border-2 border-destructive bg-destructive/5">
          <CardContent className="pt-6 pb-5">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 justify-between">
              <div className="flex items-start gap-3">
                <ShieldAlert className="w-8 h-8 text-destructive flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-destructive text-base">Reset All Data</p>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Permanently deletes <strong>every record</strong> — products, categories, stores, suppliers, customers, stock, sales, transfers, expenses, orders, and more.
                    <br />
                    <span className="text-destructive font-medium">User accounts and login credentials are NOT affected.</span>
                  </p>
                </div>
              </div>
              <Button
                variant="destructive"
                className="flex-shrink-0 whitespace-nowrap"
                onClick={() => { setResetConfirmText(""); setShowResetDialog(true); }}
                data-testid="button-reset-all"
              >
                <ShieldAlert className="w-4 h-4 mr-2" /> Reset All Data
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Reset All Data Dialog */}
      <Dialog open={showResetDialog} onOpenChange={open => { if (!open && !resetting) { setShowResetDialog(false); setResetConfirmText(""); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <ShieldAlert className="w-5 h-5" /> Reset All Data
            </DialogTitle>
            <DialogDescription>
              This will permanently erase every record in the system. User accounts and login credentials will <strong>not</strong> be deleted.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive space-y-1">
              <p className="font-semibold">The following will be deleted:</p>
              <p className="text-xs text-muted-foreground">Products · Categories · Stores · Suppliers · Customers · Stock In · POS Sales · Transfers · Damage Returns · Expenses · Pricing · Orders · Payments · Bincards</p>
            </div>
            <div>
              <Label className="text-sm">Type <span className="font-mono font-bold text-destructive">DELETE</span> to confirm</Label>
              <Input
                className="mt-1 font-mono"
                placeholder="DELETE"
                value={resetConfirmText}
                onChange={e => setResetConfirmText(e.target.value.toUpperCase())}
                disabled={resetting}
                data-testid="input-reset-confirm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowResetDialog(false); setResetConfirmText(""); }} disabled={resetting}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleResetAll}
              disabled={resetConfirmText !== "DELETE" || resetting}
              data-testid="button-confirm-reset"
            >
              {resetting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ShieldAlert className="w-4 h-4 mr-2" />}
              {resetting ? "Deleting..." : "Reset All Data"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Clear Dialog */}
      <Dialog open={showClearDialog} onOpenChange={setShowClearDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" /> Confirm Clear
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm">
              {clearTarget === "stock" && "This will permanently delete ALL stock balance records across all stores."}
              {clearTarget === "products" && "This will permanently delete ALL products from the catalog."}
              {clearTarget === "all" && "This will permanently delete ALL products AND all stock balance records. This is irreversible."}
            </p>
            <p className="text-sm font-semibold text-destructive">Are you absolutely sure?</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowClearDialog(false)} disabled={clearing}>Cancel</Button>
            <Button variant="destructive" onClick={handleClear} disabled={clearing}>
              {clearing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {clearing ? "Clearing..." : "Yes, Clear It"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hidden PDF content for Inventory Report */}
      <div ref={inventoryPdfRef} style={{ position: "fixed", left: "-9999px", top: 0, width: 800, background: "#fff", padding: 32, fontFamily: "sans-serif" }}>
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#1e40af" }}>Inventory Product Report</h2>
          <p style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>{new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}</p>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ background: "#1e40af", color: "#fff" }}>
              {["#", "Code", "Name", "Category", "Qty/Carton", "Min Alert"].map(h => (
                <th key={h} style={{ padding: "6px 8px", textAlign: "left", fontWeight: 700 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {inventoryProducts.map((p, i) => (
              <tr key={p.id} style={{ background: i % 2 === 0 ? "#fff" : "#f0f4ff" }}>
                <td style={{ padding: "5px 8px", color: "#374151" }}>{i + 1}</td>
                <td style={{ padding: "5px 8px", fontFamily: "monospace", color: "#1d4ed8" }}>{p.code}</td>
                <td style={{ padding: "5px 8px", color: "#111827", fontWeight: 500 }}>{p.name}</td>
                <td style={{ padding: "5px 8px", color: "#6b7280" }}>{p.categoryName || "—"}</td>
                <td style={{ padding: "5px 8px", color: "#374151", textAlign: "center" }}>{p.quantityPerCarton}</td>
                <td style={{ padding: "5px 8px", color: "#dc2626", textAlign: "center" }}>{p.minCartonAlert}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ marginTop: 16, fontSize: 10, color: "#9ca3af", textAlign: "center" }}>
          Total: {inventoryProducts.length} products — Generated by NexusStock
        </p>
      </div>
    </div>
  );
}
