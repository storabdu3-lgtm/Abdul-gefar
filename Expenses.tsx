import { useState, useEffect, useRef } from "react";
import { fmt } from "@/lib/currency";
import { Plus, Search, Eye, Printer, Trash2, Share2, Package, Pencil, CheckCircle, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useDeleteAuth } from "@/hooks/useDeleteAuth";
import { getAll, create, update, remove, COLLECTIONS, generateVoucherId, generateSerialVoucherId } from "@/lib/firestore";
import { useAuth } from "@/lib/auth";
import { shareAsImage, shareAsPdf } from "@/lib/shareImage";
import { computeStockBalances } from "@/lib/stockUtils";
import type { Store, Expense, Product, PricingRecord } from "@/lib/types";
import { useReactToPrint } from "react-to-print";

interface ExpenseItem {
  description: string;
  productId?: string;
  productCode?: string;
  photoUrl?: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  isByCarton?: boolean;
  availableStock?: number;
}

export default function Expenses() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [pricing, setPricing] = useState<PricingRecord[]>([]);
  const [storeStockMap, setStoreStockMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showVoucher, setShowVoucher] = useState<Expense | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [form, setForm] = useState({ storeId: "", type: "general" as "product" | "general", remark: "" });
  const [items, setItems] = useState<ExpenseItem[]>([{ description: "", quantity: 1, unitPrice: 0, totalPrice: 0 }]);
  const [productSearches, setProductSearches] = useState<string[]>([""]);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const [sharing, setSharing] = useState(false);
  const { confirmDelete, DeleteAuthDialog } = useDeleteAuth();
  const { user, isAdmin } = useAuth();
  const receiptRef = useRef<HTMLDivElement>(null);

  async function loadData() {
    setLoading(true);
    const [exps, sts, prods, pric] = await Promise.all([
      getAll<Expense>(COLLECTIONS.EXPENSES),
      getAll<Store>(COLLECTIONS.STORES),
      getAll<Product>(COLLECTIONS.PRODUCTS),
      getAll<PricingRecord>(COLLECTIONS.PRICING),
    ]);
    setExpenses(exps.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))));
    setStores(sts);
    setProducts(prods);
    setPricing(pric);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  // Reload store balances when store changes (for product type)
  async function loadStoreBalances(storeId: string) {
    if (!storeId || storeId === "general") { setStoreStockMap({}); return; }
    const balanceMap = await computeStockBalances(storeId);
    const qtyMap: Record<string, number> = {};
    for (const [pid, bal] of Object.entries(balanceMap)) {
      qtyMap[pid] = bal.quantity;
    }
    setStoreStockMap(qtyMap);
  }

  function getAvailableStock(productId: string): number {
    return storeStockMap[productId] || 0;
  }

  function getSellingPrice(productId: string): number {
    return pricing.find(p => p.productId === productId)?.sellingPrice || 0;
  }

  function resetForm() {
    setEditingId(null);
    setEditingExpense(null);
    setForm({ storeId: "", type: "general", remark: "" });
    setItems([{ description: "", quantity: 1, unitPrice: 0, totalPrice: 0 }]);
    setProductSearches([""]);
    setStoreStockMap({});
  }

  function openNew() { resetForm(); setShowForm(true); }

  async function openEdit(exp: Expense) {
    setEditingId(exp.id);
    setEditingExpense(exp);
    setForm({ storeId: exp.storeId || "", type: exp.type || "general", remark: exp.remark || "" });
    setItems((exp.items || []).map(i => ({ ...i })));
    setProductSearches((exp.items || []).map(() => ""));
    if (exp.type === "product" && exp.storeId && exp.storeId !== "general") {
      await loadStoreBalances(exp.storeId);
    }
    setShowForm(true);
  }

  async function handleApprove(exp: Expense) {
    await update(COLLECTIONS.EXPENSES, exp.id, { status: "active" });
    toast({ title: "Expense approved" });
    loadData();
  }

  function handleDelete(exp: Expense) {
    confirmDelete(async () => {
      await remove(COLLECTIONS.EXPENSES, exp.id);
      toast({ title: "Expense deleted" });
      loadData();
    });
  }

  const filtered = expenses.filter(e =>
    e.voucherId?.toLowerCase().includes(search.toLowerCase()) ||
    e.storeName?.toLowerCase().includes(search.toLowerCase())
  );

  function addItem() {
    setItems(prev => [...prev, { description: "", quantity: 1, unitPrice: 0, totalPrice: 0 }]);
    setProductSearches(prev => [...prev, ""]);
  }

  function removeItem(idx: number) {
    setItems(prev => prev.filter((_, i) => i !== idx));
    setProductSearches(prev => prev.filter((_, i) => i !== idx));
  }

  function updateItem(idx: number, field: string, value: string | number | boolean) {
    setItems(prev => {
      const updated = [...prev];
      const item = { ...updated[idx], [field]: value };
      item.totalPrice = (item.unitPrice || 0) * (item.quantity || 1);
      updated[idx] = item;
      return updated;
    });
  }

  function selectProduct(idx: number, product: Product) {
    const price = getSellingPrice(product.id);
    const available = getAvailableStock(product.id);
    setItems(prev => {
      const updated = [...prev];
      updated[idx] = {
        ...updated[idx],
        productId: product.id,
        productCode: product.code,
        photoUrl: product.photoUrl || "",
        description: product.name,
        unitPrice: price,
        totalPrice: price * (updated[idx].quantity || 1),
        availableStock: available,
      };
      return updated;
    });
    setProductSearches(prev => {
      const updated = [...prev];
      updated[idx] = "";
      return updated;
    });
  }

  const totalAmount = items.reduce((s, i) => s + i.totalPrice, 0);

  async function handleSave() {
    setSaving(true);
    try {
      if (form.type === "product") {
        if (!form.storeId || form.storeId === "general") {
          toast({ title: "Select a store for product expenses", variant: "destructive" }); return;
        }
        for (const item of items) {
          if (!item.productId) {
            toast({ title: "Select a product for each row", variant: "destructive" }); return;
          }
          if (item.quantity <= 0) {
            toast({ title: "All quantities must be greater than zero", variant: "destructive" }); return;
          }
          const oldQty = editingExpense?.items?.find(i => i.productId === item.productId)?.quantity || 0;
          const available = getAvailableStock(item.productId) + oldQty;
          if (item.quantity > available) {
            toast({ title: `Insufficient stock for "${item.description}" (available: ${available})`, variant: "destructive" }); return;
          }
        }
      } else {
        if (items.some(i => !i.description)) {
          toast({ title: "All items need a description", variant: "destructive" }); return;
        }
        if (items.some(i => i.quantity <= 0)) {
          toast({ title: "All quantities must be greater than zero", variant: "destructive" }); return;
        }
        if (items.some(i => i.unitPrice < 0)) {
          toast({ title: "Prices cannot be negative", variant: "destructive" }); return;
        }
      }
      const store = stores.find(s => s.id === form.storeId);
      const cleanItems = items.map(item =>
        Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined))
      );
      if (editingId) {
        await update(COLLECTIONS.EXPENSES, editingId, {
          storeId: form.storeId || null,
          storeName: store?.name || "General",
          type: form.type,
          items: cleanItems,
          totalAmount,
          remark: form.remark || "",
        } as Record<string, unknown>);
        toast({ title: "Expense updated" });
      } else {
        await create(COLLECTIONS.EXPENSES, {
          voucherId: await generateSerialVoucherId("EXP"),
          storeId: form.storeId || null,
          storeName: store?.name || "General",
          type: form.type,
          items: cleanItems,
          totalAmount,
          remark: form.remark || "",
          status: isAdmin ? "active" : "pending",
          createdByName: user?.name || "",
        });
        toast({ title: isAdmin ? "Expense recorded" : "Submitted for admin approval" });
      }
      setShowForm(false);
      resetForm();
      loadData();
    } finally {
      setSaving(false);
    }
  }

  const handlePrint = useReactToPrint({ contentRef: receiptRef });
  const [sharingPdf, setSharingPdf] = useState(false);
  async function handleShare() {
    if (!receiptRef.current) return;
    setSharing(true);
    const r = await shareAsImage(receiptRef.current, "expense_receipt.png");
    if (r === "failed") toast({ title: "Share failed", variant: "destructive" });
    setSharing(false);
  }
  async function handleSharePdf() {
    if (!receiptRef.current) return;
    setSharingPdf(true);
    const r = await shareAsPdf(receiptRef.current, "expense_receipt.pdf");
    if (r === "failed") toast({ title: "PDF share failed", variant: "destructive" });
    setSharingPdf(false);
  }

  const isProduct = form.type === "product";

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Expenses</h1>
          <p className="text-muted-foreground text-sm">Track business expenses</p>
        </div>
        <Button onClick={openNew} data-testid="button-new-expense"><Plus className="w-4 h-4 mr-2" /> New Expense</Button>
      </div>
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
        <Input className="pl-9" placeholder="Search expenses..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      {loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 rounded" />)}</div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>{["Voucher", "Store", "Type", "Items", "Total Amount", "Status", "Actions"].map(h => (
                <th key={h} className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(e => (
                <tr key={e.id} className="hover:bg-muted/30" data-testid={`row-expense-${e.id}`}>
                  <td className="px-4 py-2 font-mono text-xs">{e.voucherId}</td>
                  <td className="px-4 py-2">{e.storeName || "General"}</td>
                  <td className="px-4 py-2 capitalize">
                    <Badge variant={e.type === "product" ? "default" : "secondary"}>
                      {e.type === "product" ? "Product" : "General"}
                    </Badge>
                  </td>
                  <td className="px-4 py-2">{e.items?.length || 0}</td>
                  <td className="px-4 py-2 font-medium">{fmt(e.totalAmount)}</td>
                  <td className="px-4 py-2">
                    <Badge
                      variant={e.status === "active" ? "default" : e.status === "pending" ? "outline" : "destructive"}
                      className={e.status === "pending" ? "border-amber-500 text-amber-600 bg-amber-50" : ""}
                    >{e.status || "active"}</Badge>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => setShowVoucher(e)} title="View" data-testid={`button-view-${e.id}`}>
                        <Eye className="w-3 h-3" />
                      </Button>
                      {isAdmin && e.status === "pending" && (
                        <Button size="sm" variant="outline" className="text-emerald-600 border-emerald-400 hover:bg-emerald-50" onClick={() => handleApprove(e)} title="Approve" data-testid={`button-approve-${e.id}`}>
                          <CheckCircle className="w-3 h-3" />
                        </Button>
                      )}
                      {e.status !== "pending" && (
                        <Button size="sm" variant="outline" onClick={() => openEdit(e)} title="Edit" data-testid={`button-edit-${e.id}`}>
                          <Pencil className="w-3 h-3" />
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => handleDelete(e)} title="Delete" data-testid={`button-delete-${e.id}`}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={7} className="text-center py-10 text-muted-foreground">No expenses found</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* New / Edit Expense Dialog */}
      <Dialog open={showForm} onOpenChange={open => { if (!open) { setShowForm(false); resetForm(); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-3xl">
          <DialogHeader><DialogTitle>{editingId ? "Edit Expense" : "New Expense"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Store {isProduct && <span className="text-destructive">*</span>}</Label>
                <Select
                  value={form.storeId}
                  onValueChange={v => {
                    setForm(f => ({ ...f, storeId: v }));
                    loadStoreBalances(v);
                    // reset product selections when store changes
                    setItems(prev => prev.map(() => ({ description: "", quantity: 1, unitPrice: 0, totalPrice: 0 })));
                    setProductSearches(prev => prev.map(() => ""));
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="General (no store)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">General</SelectItem>
                    {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Type</Label>
                <Select
                  value={form.type}
                  onValueChange={v => {
                    const t = v as "product" | "general";
                    setForm(f => ({ ...f, type: t }));
                    setItems([{ description: "", quantity: 1, unitPrice: 0, totalPrice: 0 }]);
                    setProductSearches([""]);
                    if (t === "product" && form.storeId && form.storeId !== "general") {
                      loadStoreBalances(form.storeId);
                    }
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">General Expense</SelectItem>
                    <SelectItem value="product">Product Related</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {isProduct && (!form.storeId || form.storeId === "general") && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
                <Package className="w-4 h-4 flex-shrink-0" />
                Please select a store first to see available product stock.
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>{isProduct ? "Products to Expense" : "Expense Items"}</Label>
                <Button size="sm" variant="outline" onClick={addItem}><Plus className="w-3 h-3 mr-1" /> Add Row</Button>
              </div>

              {isProduct ? (
                // ── Product rows ──
                <div className="space-y-2">
                  {items.map((item, idx) => {
                    const search = productSearches[idx] || "";
                    const results = products.filter(p =>
                      search.trim() &&
                      (p.name.toLowerCase().includes(search.toLowerCase()) ||
                       p.code.toLowerCase().includes(search.toLowerCase()))
                    ).slice(0, 5);

                    return (
                      <div key={idx} className="rounded-lg border p-3 space-y-2 bg-muted/20">
                        <div className="flex items-center gap-2">
                          {item.photoUrl ? (
                            <img src={item.photoUrl} alt={item.description} className="w-10 h-10 rounded object-cover border flex-shrink-0" />
                          ) : (
                            <div className="w-10 h-10 rounded border bg-muted flex items-center justify-center flex-shrink-0">
                              <Package className="w-4 h-4 text-muted-foreground" />
                            </div>
                          )}
                          <div className="flex-1 relative">
                            {item.productId ? (
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm">{item.description}</span>
                                <span className="text-xs text-muted-foreground">{item.productCode}</span>
                                {item.availableStock !== undefined && (
                                  <Badge variant={item.quantity > item.availableStock ? "destructive" : "secondary"} className="text-xs">
                                    Stock: {item.availableStock}
                                  </Badge>
                                )}
                                <Button
                                  size="sm" variant="ghost" className="h-6 px-2 text-xs text-muted-foreground"
                                  onClick={() => {
                                    setItems(prev => {
                                      const u = [...prev];
                                      u[idx] = { description: "", quantity: 1, unitPrice: 0, totalPrice: 0 };
                                      return u;
                                    });
                                    setProductSearches(prev => { const u = [...prev]; u[idx] = ""; return u; });
                                  }}
                                >
                                  Change
                                </Button>
                              </div>
                            ) : (
                              <div className="relative">
                                <Input
                                  className="h-8 text-sm"
                                  placeholder="Search product by name or code…"
                                  value={search}
                                  onChange={e => setProductSearches(prev => { const u = [...prev]; u[idx] = e.target.value; return u; })}
                                  disabled={!form.storeId || form.storeId === "general"}
                                />
                                {results.length > 0 && (
                                  <div className="absolute z-20 top-full left-0 right-0 bg-card border rounded-b shadow-lg">
                                    {results.map(p => {
                                      const stock = getAvailableStock(p.id);
                                      return (
                                        <div
                                          key={p.id}
                                          className="px-3 py-2 hover:bg-muted cursor-pointer flex items-center gap-3"
                                          onClick={() => selectProduct(idx, p)}
                                        >
                                          {p.photoUrl && <img src={p.photoUrl} alt={p.name} className="w-7 h-7 rounded object-cover" />}
                                          <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium truncate">{p.name}</p>
                                            <p className="text-xs text-muted-foreground">{p.code}</p>
                                          </div>
                                          <Badge variant={stock > 0 ? "secondary" : "destructive"} className="text-xs flex-shrink-0">
                                            {stock} in stock
                                          </Badge>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                          {items.length > 1 && (
                            <Button size="sm" variant="ghost" onClick={() => removeItem(idx)} className="flex-shrink-0">
                              <Trash2 className="w-3 h-3 text-destructive" />
                            </Button>
                          )}
                        </div>

                        {item.productId && (
                          <div className="grid grid-cols-3 gap-2 pl-12">
                            <div>
                              <Label className="text-xs">Quantity</Label>
                              <Input
                                type="number" min={1} className="h-7 text-xs"
                                value={item.quantity}
                                onChange={e => {
                                  const qty = Number(e.target.value);
                                  setItems(prev => {
                                    const u = [...prev];
                                    u[idx] = { ...u[idx], quantity: qty, totalPrice: u[idx].unitPrice * qty };
                                    return u;
                                  });
                                }}
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Unit Price (ETB)</Label>
                              <Input
                                type="number" min={0} step={0.01} className="h-7 text-xs"
                                value={item.unitPrice}
                                onChange={e => updateItem(idx, "unitPrice", Number(e.target.value))}
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Total</Label>
                              <Input value={`ETB ${item.totalPrice.toFixed(2)}`} readOnly className="h-7 text-xs bg-muted font-semibold" />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                // ── General rows ──
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>{["Description", "Qty", "Unit Price (ETB)", "Total", ""].map(h => (
                      <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody className="divide-y">
                    {items.map((item, idx) => (
                      <tr key={idx}>
                        <td className="px-3 py-2">
                          <Input className="h-7 text-xs" value={item.description} onChange={e => updateItem(idx, "description", e.target.value)} placeholder="Description" />
                        </td>
                        <td className="px-3 py-2">
                          <Input type="number" min={1} className="w-16 h-7 text-xs" value={item.quantity} onChange={e => updateItem(idx, "quantity", Number(e.target.value))} />
                        </td>
                        <td className="px-3 py-2">
                          <Input type="number" min={0} step={0.01} className="w-24 h-7 text-xs" value={item.unitPrice} onChange={e => updateItem(idx, "unitPrice", Number(e.target.value))} />
                        </td>
                        <td className="px-3 py-2 font-medium">${item.totalPrice.toFixed(2)}</td>
                        <td className="px-3 py-2">
                          {items.length > 1 && (
                            <Button size="sm" variant="ghost" onClick={() => removeItem(idx)}><Trash2 className="w-3 h-3 text-destructive" /></Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted/30 font-semibold">
                    <tr>
                      <td colSpan={3} className="px-3 py-2 text-xs">Total</td>
                      <td className="px-3 py-2 text-xs">${totalAmount.toFixed(2)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              )}

              {isProduct && items.length > 0 && items.some(i => i.productId) && (
                <div className="flex justify-end text-sm font-semibold pt-1">
                  Total: <span className="ml-2">${totalAmount.toFixed(2)}</span>
                </div>
              )}
            </div>

            <div><Label>Remark</Label><Input value={form.remark} onChange={e => setForm(f => ({ ...f, remark: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowForm(false); resetForm(); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} data-testid="button-save-expense">
              {saving ? "Saving…" : editingId ? "Save Changes" : "Save Expense"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Voucher Detail */}
      <Dialog open={!!showVoucher} onOpenChange={() => setShowVoucher(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-xl">
          <DialogHeader><DialogTitle>Expense Voucher</DialogTitle></DialogHeader>
          {showVoucher && (
            <div ref={receiptRef} className="receipt-a4 p-4 space-y-4">
              <div className="text-center border-b pb-3">
                <h2 className="text-xl font-bold">EXPENSE VOUCHER</h2>
                <p className="text-sm text-muted-foreground">ID: {showVoucher.voucherId}</p>
                <Badge variant={showVoucher.type === "product" ? "default" : "secondary"} className="mt-1 capitalize">
                  {showVoucher.type === "product" ? "Product Related" : "General"}
                </Badge>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Store: </span>{showVoucher.storeName || "General"}
              </div>
              <table className="w-full text-sm border-collapse border">
                <thead>
                  <tr className="bg-muted">
                    {["Description", "Qty", "Unit Price", "Total"].map(h => (
                      <th key={h} className="border px-2 py-1 text-xs text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {showVoucher.items?.map((item, i) => (
                    <tr key={i}>
                      <td className="border px-2 py-1 text-xs">{item.description}</td>
                      <td className="border px-2 py-1 text-xs text-center">{item.quantity}</td>
                      <td className="border px-2 py-1 text-xs">${item.unitPrice.toFixed(2)}</td>
                      <td className="border px-2 py-1 text-xs font-medium">${item.totalPrice.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex justify-end text-sm font-bold">Total: ${showVoucher.totalAmount?.toFixed(2)}</div>
              {showVoucher.remark && <div className="text-xs text-muted-foreground">Remark: {showVoucher.remark}</div>}
              <div className="border-t pt-3 mt-2 space-y-1 text-xs text-muted-foreground">
                <div className="flex justify-between"><span>Authorized by:</span><span className="font-medium text-foreground">{showVoucher.storeName || "General"}</span></div>
                {showVoucher.createdByName && <div className="flex justify-between"><span>Created by:</span><span className="font-medium text-foreground">{showVoucher.createdByName}</span></div>}
                <div className="flex justify-between mt-2"><span>Page 1 of 1</span><span>{new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span></div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={handleSharePdf} disabled={sharingPdf}><FileText className="w-4 h-4 mr-2" />{sharingPdf ? "Generating…" : "PDF Share"}</Button>
            <Button variant="outline" onClick={handleShare} disabled={sharing}><Share2 className="w-4 h-4 mr-2" />{sharing ? "Sharing…" : "Share"}</Button>
            <Button variant="outline" onClick={() => handlePrint()}><Printer className="w-4 h-4 mr-2" /> Print</Button>
            <Button onClick={() => setShowVoucher(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {DeleteAuthDialog}
    </div>
  );
}
