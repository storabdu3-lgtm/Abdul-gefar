import { useState, useEffect, useRef } from "react";
import { fmt } from "@/lib/currency";
import { Plus, Search, Trash2, Eye, Printer, FileDown, Share2, Pencil, CheckCircle, Ban, RotateCcw, FileText } from "lucide-react";
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
import { uploadImage } from "@/lib/cloudinary";
import type { Product, Category, Store, Supplier, StockIn as StockInType, StockInItem } from "@/lib/types";
import { useReactToPrint } from "react-to-print";
import { BarcodeScannerButton } from "@/components/BarcodeScannerButton";
import { ReceiptActionBar } from "@/components/ReceiptActionBar";
import * as XLSX from "xlsx";

export default function StockIn() {
  const [stockIns, setStockIns] = useState<StockInType[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showVoucher, setShowVoucher] = useState<StockInType | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({ supplierId: "", storeId: "", categoryId: "", fsNumber: "", remark: "", amountPaid: 0, photoProofUrl: "", voucherDate: new Date().toISOString().slice(0, 10) });
  const [items, setItems] = useState<StockInItem[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [byPieceSet, setByPieceSet] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  const [sharing, setSharing] = useState(false);
  const { confirmDelete, DeleteAuthDialog } = useDeleteAuth();
  const { isAdmin, user } = useAuth();
  const receiptRef = useRef<HTMLDivElement>(null);

  async function loadData() {
    setLoading(true);
    const [sis, prods, cats, sts, sups] = await Promise.all([
      getAll<StockInType>(COLLECTIONS.STOCK_IN),
      getAll<Product>(COLLECTIONS.PRODUCTS),
      getAll<Category>(COLLECTIONS.CATEGORIES),
      getAll<Store>(COLLECTIONS.STORES),
      getAll<Supplier>(COLLECTIONS.SUPPLIERS),
    ]);
    setStockIns(sis.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))));
    setProducts(prods);
    setCategories(cats);
    setStores(sts);
    setSuppliers(sups);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  const filtered = stockIns.filter(s =>
    s.voucherId?.toLowerCase().includes(search.toLowerCase()) ||
    s.supplierName?.toLowerCase().includes(search.toLowerCase()) ||
    s.storeName?.toLowerCase().includes(search.toLowerCase())
  );

  function resetForm() {
    setEditingId(null);
    setForm({ supplierId: "", storeId: "", categoryId: "", fsNumber: "", remark: "", amountPaid: 0, photoProofUrl: "", voucherDate: new Date().toISOString().slice(0, 10) });
    setItems([]);
    setProductSearch("");
    setByPieceSet(new Set());
  }

  function toggleByPiece(productId: string) {
    setByPieceSet(prev => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  function openNew() { resetForm(); setShowForm(true); }

  function openEdit(si: StockInType) {
    setEditingId(si.id);
    setForm({
      supplierId: si.supplierId,
      storeId: si.storeId,
      categoryId: si.categoryId || "",
      fsNumber: si.fsNumber || "",
      remark: si.remark || "",
      amountPaid: si.amountPaid || 0,
      photoProofUrl: si.photoProofUrl || "",
      voucherDate: si.voucherDate || new Date().toISOString().slice(0, 10),
    });
    setItems(si.items);
    setShowForm(true);
  }

  function addProduct(prod: Product) {
    const existing = items.find(i => i.productId === prod.id);
    if (existing) { toast({ title: "Product already added" }); return; }
    setItems(prev => [...prev, {
      productId: prod.id, productName: prod.name, productCode: prod.code,
      quantityPerCarton: prod.quantityPerCarton, cartonsReceived: 1,
      unitPrice: 0, cartonPrice: 0, totalPrice: 0, photoUrl: prod.photoUrl || ""
    }]);
    setProductSearch("");
  }

  function updateItem(idx: number, field: string, value: number) {
    setItems(prev => {
      const updated = [...prev];
      const item = { ...updated[idx], [field]: value };
      item.cartonPrice = item.unitPrice * item.quantityPerCarton;
      item.totalPrice = item.cartonPrice * item.cartonsReceived;
      updated[idx] = item;
      return updated;
    });
  }

  function removeItem(idx: number) { setItems(prev => prev.filter((_, i) => i !== idx)); }

  const totalCartons = items.reduce((s, i) => s + i.cartonsReceived, 0);
  const totalPrice = items.reduce((s, i) => s + i.totalPrice, 0);
  const remaining = Math.max(0, totalPrice - form.amountPaid);

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadImage(file, "stock-in");
      setForm(f => ({ ...f, photoProofUrl: url }));
    } catch { toast({ title: "Upload failed", variant: "destructive" }); }
    finally { setUploading(false); }
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (!form.supplierId || !form.storeId || items.length === 0) {
        toast({ title: "Select supplier, store and add at least one product", variant: "destructive" }); return;
      }
      if (items.some(i => i.cartonsReceived <= 0)) {
        toast({ title: "All carton quantities must be greater than zero", variant: "destructive" }); return;
      }
      if (items.some(i => i.unitPrice < 0)) {
        toast({ title: "Unit prices cannot be negative", variant: "destructive" }); return;
      }
      if (form.amountPaid < 0) {
        toast({ title: "Amount paid cannot be negative", variant: "destructive" }); return;
      }
      if (form.fsNumber) {
        const duplicate = stockIns.find(s => s.fsNumber && s.fsNumber.trim() === form.fsNumber.trim() && s.id !== editingId);
        if (duplicate) {
          toast({ title: `FS Number "${form.fsNumber}" is already registered (Voucher: ${duplicate.voucherId})`, variant: "destructive" }); return;
        }
      }
      const supplier = suppliers.find(s => s.id === form.supplierId);
      const store = stores.find(s => s.id === form.storeId);

      if (editingId) {
        const oldRecord = stockIns.find(s => s.id === editingId);
        const newRemaining = Math.max(0, totalPrice - form.amountPaid);

        await update(COLLECTIONS.STOCK_IN, editingId, {
          supplierId: form.supplierId,
          supplierName: supplier?.name || "",
          storeId: form.storeId,
          storeName: store?.name || "",
          categoryId: form.categoryId,
          categoryName: categories.find(c => c.id === form.categoryId)?.name || "",
          items,
          totalCartons,
          totalPrice,
          amountPaid: form.amountPaid,
          remainingBalance: newRemaining,
          fsNumber: form.fsNumber,
          remark: form.remark,
          photoProofUrl: form.photoProofUrl,
          voucherDate: form.voucherDate,
        } as Record<string, unknown>);

        // Adjust supplier balance: reverse old remaining, apply new
        if (supplier && oldRecord) {
          const balanceDiff = newRemaining - (oldRecord.remainingBalance || 0);
          if (balanceDiff !== 0) {
            await update(COLLECTIONS.SUPPLIERS, supplier.id, {
              totalBalance: Math.max(0, (supplier.totalBalance || 0) + balanceDiff),
            });
          }
        }
        toast({ title: "Stock In updated" });
      } else {
        const data: Omit<StockInType, "id"> = {
          voucherId: await generateSerialVoucherId("STK"),
          supplierId: form.supplierId,
          supplierName: supplier?.name || "",
          storeId: form.storeId,
          storeName: store?.name || "",
          categoryId: form.categoryId,
          categoryName: categories.find(c => c.id === form.categoryId)?.name || "",
          items,
          totalCartons,
          totalPrice,
          amountPaid: form.amountPaid,
          remainingBalance: remaining,
          fsNumber: form.fsNumber,
          remark: form.remark,
          photoProofUrl: form.photoProofUrl,
          voucherDate: form.voucherDate,
          status: isAdmin ? "active" : "pending",
          createdByName: user?.name || "",
        };
        const newId = await create(COLLECTIONS.STOCK_IN, data as Record<string, unknown>);
        if (isAdmin && supplier && remaining > 0) {
          await update(COLLECTIONS.SUPPLIERS, supplier.id, {
            totalBalance: (supplier.totalBalance || 0) + remaining,
          });
        }
        toast({ title: isAdmin ? `Stock In saved — ${data.voucherId}` : "Submitted for admin approval" });
        setShowForm(false);
        resetForm();
        loadData();
        setShowVoucher({ ...data, id: newId } as StockInType);
        return;
      }

      setShowForm(false);
      resetForm();
      loadData();
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(si: StockInType) {
    confirmDelete(async () => {
      await remove(COLLECTIONS.STOCK_IN, si.id);
      // Reverse supplier balance
      if (si.supplierId && (si.remainingBalance || 0) > 0) {
        const supplier = suppliers.find(s => s.id === si.supplierId);
        if (supplier) {
          await update(COLLECTIONS.SUPPLIERS, supplier.id, {
            totalBalance: Math.max(0, (supplier.totalBalance || 0) - (si.remainingBalance || 0)),
          });
        }
      }
      toast({ title: "Stock In deleted" });
      loadData();
    });
  }

  async function handleApprove(si: StockInType) {
    await update(COLLECTIONS.STOCK_IN, si.id, { status: "active" });
    const supplier = suppliers.find(s => s.id === si.supplierId);
    if (supplier && (si.remainingBalance || 0) > 0) {
      await update(COLLECTIONS.SUPPLIERS, supplier.id, {
        totalBalance: (supplier.totalBalance || 0) + (si.remainingBalance || 0),
      });
    }
    toast({ title: "Stock In approved" });
    loadData();
  }

  async function handleVoid(si: StockInType) {
    if (!confirm("Void this Stock In voucher? This will mark it as voided.")) return;
    await update(COLLECTIONS.STOCK_IN, si.id, { status: "voided" });
    toast({ title: "Stock In voided" });
    loadData();
  }

  async function handleActivate(si: StockInType) {
    await update(COLLECTIONS.STOCK_IN, si.id, { status: "active" });
    toast({ title: "Stock In activated" });
    loadData();
  }

  const handlePrint = useReactToPrint({ contentRef: receiptRef });
  const [sharingPdf, setSharingPdf] = useState(false);
  async function handleShare() {
    if (!receiptRef.current) return;
    setSharing(true);
    const r = await shareAsImage(receiptRef.current, "stockin_receipt.png");
    if (r === "failed") toast({ title: "Share failed", variant: "destructive" });
    setSharing(false);
  }
  async function handleSharePdf() {
    if (!receiptRef.current) return;
    setSharingPdf(true);
    const r = await shareAsPdf(receiptRef.current, "stockin_receipt.pdf");
    if (r === "failed") toast({ title: "PDF share failed", variant: "destructive" });
    setSharingPdf(false);
  }

  function exportExcel(si: StockInType) {
    const wb = XLSX.utils.book_new();
    const data = [["Product", "Qty/Carton", "Cartons", "Unit Price", "Carton Price", "Total"], ...si.items.map(i => [i.productName, i.quantityPerCarton, i.cartonsReceived, i.unitPrice, i.cartonPrice, i.totalPrice])];
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, "Stock In");
    XLSX.writeFile(wb, `${si.voucherId}.xlsx`);
  }

  const productResults = products.filter(p =>
    productSearch && (
      p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
      p.code.toLowerCase().includes(productSearch.toLowerCase()) ||
      (p.barcodeValue || "").toLowerCase().includes(productSearch.toLowerCase())
    )
  ).slice(0, 8);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Stock In (Goods Receiving)</h1>
          <p className="text-muted-foreground text-sm mt-1">Record incoming stock from suppliers</p>
        </div>
        <Button onClick={openNew} data-testid="button-new-stockin" className="flex-shrink-0"><Plus className="w-4 h-4 mr-2" /> New Stock In</Button>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
        <Input className="pl-9" placeholder="Search by voucher, supplier, store..." value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search-stockin" />
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded" />)}</div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>{["Voucher ID", "Date", "Supplier", "Store", "Total Cartons", "Total Price", "Paid", "Balance", "Status", "Actions"].map(h => (
                <th key={h} className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(si => (
                <tr key={si.id} className="hover:bg-muted/30" data-testid={`row-stockin-${si.id}`}>
                  <td className="px-4 py-2 font-mono text-xs">{si.voucherId}</td>
                  <td className="px-4 py-2 text-xs">{si.voucherDate || "—"}</td>
                  <td className="px-4 py-2">{si.supplierName}</td>
                  <td className="px-4 py-2">{si.storeName}</td>
                  <td className="px-4 py-2">{si.totalCartons}</td>
                  <td className="px-4 py-2">{fmt(si.totalPrice)}</td>
                  <td className="px-4 py-2 text-green-600">{fmt(si.amountPaid)}</td>
                  <td className="px-4 py-2 text-red-500">{fmt(si.remainingBalance)}</td>
                  <td className="px-4 py-2">
                    <Badge
                      variant={si.status === "active" ? "default" : si.status === "pending" ? "outline" : "destructive"}
                      className={si.status === "pending" ? "border-amber-500 text-amber-600 bg-amber-50" : ""}
                    >{si.status}</Badge>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => setShowVoucher(si)} title="View receipt" data-testid={`button-view-${si.id}`}>
                        <Eye className="w-3 h-3" />
                      </Button>
                      {isAdmin && si.status === "pending" && (
                        <Button size="sm" variant="outline" className="text-emerald-600 border-emerald-400 hover:bg-emerald-50" onClick={() => handleApprove(si)} title="Approve" data-testid={`button-approve-${si.id}`}>
                          <CheckCircle className="w-3 h-3" />
                        </Button>
                      )}
                      {si.status === "active" && (
                        <Button size="sm" variant="outline" onClick={() => openEdit(si)} title="Edit" data-testid={`button-edit-${si.id}`}>
                          <Pencil className="w-3 h-3" />
                        </Button>
                      )}
                      {isAdmin && si.status === "active" && (
                        <Button size="sm" variant="outline" className="text-orange-500 border-orange-300 hover:bg-orange-50" onClick={() => handleVoid(si)} title="Void" data-testid={`button-void-${si.id}`}>
                          <Ban className="w-3 h-3" />
                        </Button>
                      )}
                      {isAdmin && si.status === "voided" && (
                        <Button size="sm" variant="outline" className="text-green-600 border-green-400 hover:bg-green-50" onClick={() => handleActivate(si)} title="Activate" data-testid={`button-activate-${si.id}`}>
                          <RotateCcw className="w-3 h-3" />
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => exportExcel(si)} title="Export Excel" data-testid={`button-export-${si.id}`}>
                        <FileDown className="w-3 h-3" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={9} className="text-center py-10 text-muted-foreground">No stock-in records found</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* New / Edit Stock In Dialog */}
      <Dialog open={showForm} onOpenChange={open => { if (!open) { setShowForm(false); resetForm(); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-4xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Stock In" : "New Stock In"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Supplier *</Label>
                <Select value={form.supplierId} onValueChange={v => setForm(f => ({ ...f, supplierId: v }))}>
                  <SelectTrigger data-testid="select-supplier"><SelectValue placeholder="Select supplier" /></SelectTrigger>
                  <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Store *</Label>
                <Select value={form.storeId} onValueChange={v => setForm(f => ({ ...f, storeId: v }))}>
                  <SelectTrigger data-testid="select-store"><SelectValue placeholder="Select store" /></SelectTrigger>
                  <SelectContent>{stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {/* Category removed — product photos shown in search results instead */}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div><Label>FS Number</Label><Input value={form.fsNumber} onChange={e => setForm(f => ({ ...f, fsNumber: e.target.value }))} data-testid="input-fs-number" /></div>
              <div><Label>Date</Label><Input type="date" value={form.voucherDate} onChange={e => setForm(f => ({ ...f, voucherDate: e.target.value }))} data-testid="input-voucher-date" /></div>
            </div>
            <div>
              <Label>Remark</Label><Input value={form.remark} onChange={e => setForm(f => ({ ...f, remark: e.target.value }))} data-testid="input-remark" />
            </div>

            <div>
                <Label>Add Products</Label>
                <div className="relative">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Search by name, code or scan barcode…"
                      value={productSearch}
                      onChange={e => setProductSearch(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && productResults.length === 1) addProduct(productResults[0]); }}
                      data-testid="input-product-search"
                      className="flex-1"
                    />
                    <BarcodeScannerButton onScan={val => {
                      const exact = products.find(p => (p.barcodeValue || "").toLowerCase() === val.toLowerCase() || p.code.toLowerCase() === val.toLowerCase());
                      if (exact) addProduct(exact);
                      else setProductSearch(val);
                    }} />
                  </div>
                  {productResults.length > 0 && (
                    <div className="absolute z-10 top-full left-0 right-0 bg-card border rounded-b shadow-lg max-h-72 overflow-y-auto">
                      {productResults.map(p => (
                        <div key={p.id} className="px-3 py-2 hover:bg-muted cursor-pointer flex items-center gap-3" onClick={() => addProduct(p)}>
                          {p.photoUrl
                            ? <img src={p.photoUrl} alt={p.name} className="w-16 h-16 rounded-md object-cover flex-shrink-0 border" />
                            : <div className="w-16 h-16 rounded-md bg-muted flex items-center justify-center flex-shrink-0 border text-muted-foreground text-xs">No photo</div>
                          }
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">{p.name}</div>
                            <div className="text-xs text-muted-foreground">{p.code}</div>
                            <div className="text-xs text-muted-foreground">{p.quantityPerCarton} pcs/ctn</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

            {items.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>{["Product", "Qty/Ctn", "Cartons / Pieces", "Unit Price", "Carton Price", "Total", ""].map(h => (
                      <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground text-xs">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody className="divide-y">
                    {items.map((item, idx) => (
                      <tr key={idx}>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            {item.photoUrl
                              ? <img src={item.photoUrl} alt={item.productName} className="w-16 h-16 rounded-md object-cover flex-shrink-0 border" />
                              : <div className="w-16 h-16 rounded-md bg-muted flex-shrink-0 border" />
                            }
                            <div><div className="font-medium text-xs">{item.productName}</div><div className="text-xs text-muted-foreground">{item.productCode}</div></div>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-center">{item.quantityPerCarton}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-col items-start gap-1">
                            <button
                              type="button"
                              onClick={() => toggleByPiece(item.productId)}
                              className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold transition-colors ${
                                byPieceSet.has(item.productId)
                                  ? "bg-blue-100 border-blue-400 text-blue-700"
                                  : "bg-muted border-muted-foreground/30 text-muted-foreground"
                              }`}
                            >
                              {byPieceSet.has(item.productId) ? "Pcs" : "Ctns"}
                            </button>
                            {byPieceSet.has(item.productId) ? (
                              <Input
                                type="number" min={0} className="w-20 h-7 text-xs"
                                value={Math.round(item.cartonsReceived * item.quantityPerCarton)}
                                onChange={e => {
                                  const pcs = Number(e.target.value);
                                  const ctns = item.quantityPerCarton > 0 ? pcs / item.quantityPerCarton : 0;
                                  updateItem(idx, "cartonsReceived", ctns);
                                }}
                              />
                            ) : (
                              <Input type="number" min={1} className="w-20 h-7 text-xs" value={item.cartonsReceived} onChange={e => updateItem(idx, "cartonsReceived", Number(e.target.value))} />
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2"><Input type="number" min={0} step={0.01} className="w-24 h-7 text-xs" value={item.unitPrice} onChange={e => updateItem(idx, "unitPrice", Number(e.target.value))} /></td>
                        <td className="px-3 py-2 text-xs">${item.cartonPrice.toFixed(2)}</td>
                        <td className="px-3 py-2 text-xs font-medium">${item.totalPrice.toFixed(2)}</td>
                        <td className="px-3 py-2"><Button size="sm" variant="ghost" onClick={() => removeItem(idx)}><Trash2 className="w-3 h-3 text-destructive" /></Button></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted/30 font-semibold">
                    <tr>
                      <td className="px-3 py-2 text-xs" colSpan={2}>Totals</td>
                      <td className="px-3 py-2 text-xs">{totalCartons} cartons</td>
                      <td colSpan={2} />
                      <td className="px-3 py-2 text-xs">${totalPrice.toFixed(2)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Amount Paid (ETB)</Label>
                <Input type="number" min={0} step={0.01} value={form.amountPaid} onChange={e => setForm(f => ({ ...f, amountPaid: Number(e.target.value) }))} data-testid="input-amount-paid" />
              </div>
              <div>
                <Label>Remaining Balance ($)</Label>
                <Input value={remaining.toFixed(2)} readOnly className="bg-muted" />
              </div>
            </div>

            <div>
              <Label>Payment Photo Proof</Label>
              <Input type="file" accept="image/*" onChange={handlePhotoUpload} />
              {uploading && <p className="text-xs text-muted-foreground mt-1">Uploading...</p>}
              {form.photoProofUrl && <img src={form.photoProofUrl} alt="Proof" className="mt-2 h-16 rounded" />}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowForm(false); resetForm(); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} data-testid="button-save-stockin">
              {saving ? "Saving…" : editingId ? "Save Changes" : "Save Stock In"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Receipt Dialog */}
      <Dialog open={!!showVoucher} onOpenChange={() => setShowVoucher(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-2xl">
          <DialogHeader><DialogTitle>Stock In Receipt</DialogTitle></DialogHeader>
          {showVoucher && (
            <div ref={receiptRef} className="receipt-a4 p-4 space-y-4" style={{ position: "relative" }}>
              {showVoucher.status === "voided" && (
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", zIndex: 10 }}>
                  <span style={{ fontSize: "10rem", fontWeight: 900, color: "rgba(220,38,38,0.38)", transform: "rotate(-35deg)", letterSpacing: "0.12em", userSelect: "none", border: "10px solid rgba(220,38,38,0.38)", borderRadius: "8px", padding: "0 1.5rem", lineHeight: 1 }}>VOID</span>
                </div>
              )}
              <div className="text-center border-b pb-4">
                <h2 className="text-xl font-bold">STOCK IN RECEIPT</h2>
                <p className="text-sm text-muted-foreground">Voucher: {showVoucher.voucherId}</p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-muted-foreground">Supplier: </span>{showVoucher.supplierName}</div>
                <div><span className="text-muted-foreground">Store: </span>{showVoucher.storeName}</div>
                <div><span className="text-muted-foreground">Date: </span>{showVoucher.voucherDate || "—"}</div>
                <div><span className="text-muted-foreground">FS Number: </span>{showVoucher.fsNumber || "—"}</div>
                <div><span className="text-muted-foreground">Remark: </span>{showVoucher.remark || "—"}</div>
              </div>
              <table className="w-full text-sm border-collapse border">
                <thead><tr className="bg-muted">
                  {["Product", "Qty/Ctn", "Cartons", "Unit Price", "Total"].map(h => <th key={h} className="border px-2 py-1 text-left text-xs">{h}</th>)}
                </tr></thead>
                <tbody>{showVoucher.items.map((item, i) => (
                  <tr key={i}>
                    <td className="border px-2 py-1 text-xs">{item.productName}</td>
                    <td className="border px-2 py-1 text-xs text-center">{item.quantityPerCarton}</td>
                    <td className="border px-2 py-1 text-xs text-center">{item.cartonsReceived}</td>
                    <td className="border px-2 py-1 text-xs">${item.unitPrice.toFixed(2)}</td>
                    <td className="border px-2 py-1 text-xs font-medium">${item.totalPrice.toFixed(2)}</td>
                  </tr>
                ))}</tbody>
                <tfoot><tr className="font-bold bg-muted/30">
                  <td className="border px-2 py-1 text-xs" colSpan={2}>Total</td>
                  <td className="border px-2 py-1 text-xs text-center">{showVoucher.totalCartons}</td>
                  <td className="border px-2 py-1 text-xs" />
                  <td className="border px-2 py-1 text-xs">${showVoucher.totalPrice?.toFixed(2)}</td>
                </tr></tfoot>
              </table>
              <div className="flex justify-end gap-8 text-sm">
                <div><span className="text-muted-foreground">Paid: </span><span className="text-green-600 font-semibold">${showVoucher.amountPaid?.toFixed(2)}</span></div>
                <div><span className="text-muted-foreground">Balance: </span><span className="text-red-500 font-semibold">${showVoucher.remainingBalance?.toFixed(2)}</span></div>
              </div>
              {showVoucher.photoProofUrl && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Payment Proof</p>
                  <img src={showVoucher.photoProofUrl} alt="Proof" className="rounded max-h-32 border" />
                </div>
              )}
              <div className="border-t pt-3 mt-2 space-y-1 text-xs text-muted-foreground">
                <div className="flex justify-between"><span>Received by:</span><span className="font-medium text-foreground">{showVoucher.storeName}</span></div>
                <div className="flex justify-between"><span>Supplier:</span><span className="font-medium text-foreground">{showVoucher.supplierName}</span></div>
                {showVoucher.createdByName && <div className="flex justify-between"><span>Created by:</span><span className="font-medium text-foreground">{showVoucher.createdByName}</span></div>}
                <div className="flex justify-between mt-2"><span>Page 1 of 1</span><span>{new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span></div>
              </div>
            </div>
          )}
          <DialogFooter className="flex-wrap gap-2 sm:justify-between">
            <ReceiptActionBar
              onExportExcel={() => showVoucher && exportExcel(showVoucher)}
              onSharePdf={handleSharePdf}
              onShare={handleShare}
              onPrint={() => handlePrint()}
              sharing={sharing}
              sharingPdf={sharingPdf}
            />
            <Button onClick={() => setShowVoucher(null)} className="w-full sm:w-auto">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {DeleteAuthDialog}
    </div>
  );
}
