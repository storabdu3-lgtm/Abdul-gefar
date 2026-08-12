import { useState, useEffect, useRef, useCallback } from "react";
import { Plus, Search, Pencil, Trash2, Eye, Package, CheckCircle, Printer, Share2, X, ClipboardCheck, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useDeleteAuth } from "@/hooks/useDeleteAuth";
import { getAll, create, update, COLLECTIONS, generateVoucherId, generateSerialVoucherId } from "@/lib/firestore";
import { useAuth } from "@/lib/auth";
import { fmt } from "@/lib/currency";
import { shareAsImage, shareAsPdf } from "@/lib/shareImage";
import { BarcodeScannerButton } from "@/components/BarcodeScannerButton";
import { useReactToPrint } from "react-to-print";
import type { Product, Store, BinningVoucher, BinningItem, StockIn, StockInItem } from "@/lib/types";

export default function Binning() {
  const [vouchers, setVouchers] = useState<BinningVoucher[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [showReceipt, setShowReceipt] = useState<BinningVoucher | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<BinningVoucher | null>(null);

  const [storeId, setStoreId] = useState("");
  const [remark, setRemark] = useState("");
  const [items, setItems] = useState<BinningItem[]>([]);
  const [byPieceSet, setByPieceSet] = useState<Set<string>>(new Set());

  const receiptRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth();
  const { toast } = useToast();
  const [sharing, setSharing] = useState(false);
  const { confirmDelete, DeleteAuthDialog } = useDeleteAuth();

  const loadData = useCallback(async () => {
    setLoading(true);
    const [vs, ps, ss] = await Promise.all([
      getAll<BinningVoucher>(COLLECTIONS.BINNING),
      getAll<Product>(COLLECTIONS.PRODUCTS),
      getAll<Store>(COLLECTIONS.STORES),
    ]);
    setVouchers(
      vs.filter(v => !v.isVoided && v.status !== "voided")
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
    );
    setProducts(ps.filter(p => !p.isVoided));
    setStores(ss);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  function resetForm() {
    setEditingId(null);
    setStoreId("");
    setRemark("");
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

  function openEdit(v: BinningVoucher) {
    setEditingId(v.id);
    setStoreId(v.storeId);
    setRemark(v.remark || "");
    setItems(v.items.map(i => ({ ...i })));
    setShowForm(true);
  }

  const filteredProducts = products.filter(p => {
    if (!productSearch) return true;
    const q = productSearch.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      p.code.toLowerCase().includes(q) ||
      (p.barcodeValue || "").toLowerCase().includes(q)
    );
  });

  function addProductToItems(p: Product) {
    if (items.find(i => i.productId === p.id)) {
      toast({ title: `${p.name} is already in the list` }); return;
    }
    const newItem: BinningItem = {
      productId: p.id,
      productName: p.name,
      productCode: p.code,
      photoUrl: p.photoUrl || "",
      quantityPerCarton: p.quantityPerCarton || 1,
      cartons: 1,
      units: p.quantityPerCarton || 1,
      unitPrice: 0,
      cartonPrice: 0,
    };
    setItems(prev => [...prev, newItem]);
    setProductSearch("");
  }

  function updateItem(idx: number, field: keyof BinningItem, value: number) {
    setItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      const updated = { ...item, [field]: value };
      if (field === "cartons") {
        updated.units = value * updated.quantityPerCarton;
      }
      if (field === "quantityPerCarton") {
        updated.units = updated.cartons * value;
        updated.cartonPrice = updated.unitPrice * value;
      }
      if (field === "unitPrice") {
        updated.cartonPrice = value * updated.quantityPerCarton;
      }
      return updated;
    }));
  }

  function removeItem(idx: number) {
    setItems(prev => prev.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (!storeId) { toast({ title: "Select a store", variant: "destructive" }); return; }
      if (items.length === 0) { toast({ title: "Add at least one product", variant: "destructive" }); return; }
      const store = stores.find(s => s.id === storeId);
      const totalCartons = items.reduce((s, i) => s + i.cartons, 0);
      const totalUnits = items.reduce((s, i) => s + i.units, 0);
      const data: Omit<BinningVoucher, "id"> = {
        voucherId: editingId
          ? vouchers.find(v => v.id === editingId)?.voucherId || await generateSerialVoucherId("BIN")
          : await generateSerialVoucherId("BIN"),
        storeId,
        storeName: store?.name || "",
        items,
        totalCartons,
        totalUnits,
        status: "draft",
        remark,
        createdByName: user?.name || "",
      };
      if (editingId) {
        await update(COLLECTIONS.BINNING, editingId, data as Record<string, unknown>);
        toast({ title: "Binning voucher updated" });
      } else {
        await create(COLLECTIONS.BINNING, data as Record<string, unknown>);
        toast({ title: "Binning voucher saved as draft" });
      }
      setShowForm(false); resetForm(); await loadData();
    } catch { toast({ title: "Failed to save", variant: "destructive" }); }
    finally { setSaving(false); }
  }

  async function handleApprove(v: BinningVoucher) {
    setApproving(true);
    try {
      const stockInItems: StockInItem[] = v.items.map(item => ({
        productId: item.productId,
        productName: item.productName,
        productCode: item.productCode,
        quantityPerCarton: item.quantityPerCarton,
        cartonsReceived: item.cartons,
        unitPrice: item.unitPrice,
        cartonPrice: item.cartonPrice,
        totalPrice: item.cartonPrice * item.cartons,
        photoUrl: item.photoUrl || "",
      }));

      const stockIn: Omit<StockIn, "id"> = {
        voucherId: `SI-${v.voucherId}`,
        supplierId: "binning",
        supplierName: `Binning: ${v.voucherId}`,
        storeId: v.storeId,
        storeName: v.storeName,
        items: stockInItems,
        totalCartons: v.totalCartons,
        totalPrice: v.items.reduce((s, i) => s + i.cartonPrice * i.cartons, 0),
        amountPaid: 0,
        remainingBalance: 0,
        remark: v.remark,
        status: "active",
        createdByName: user?.name || "",
      };

      const stockInId = await create(COLLECTIONS.STOCK_IN, stockIn as Record<string, unknown>);
      await update(COLLECTIONS.BINNING, v.id, {
        status: "approved",
        approvedAt: new Date().toISOString(),
        approvedBy: user?.name || "",
        stockInId,
      } as Record<string, unknown>);

      toast({ title: "✅ Binning approved & added to stock balance!" });
      await loadData();
    } catch { toast({ title: "Approval failed", variant: "destructive" }); }
    finally { setApproving(false); }
  }

  async function handleDelete(v: BinningVoucher) {
    await update(COLLECTIONS.BINNING, v.id, { status: "voided", isVoided: true } as Record<string, unknown>);
    toast({ title: "Voucher deleted" });
    setDeleteConfirm(null);
    await loadData();
  }

  const handlePrint = useReactToPrint({
    contentRef: receiptRef,
    pageStyle: `
      @page { size: A4 portrait; margin: 12mm; }
      @media print {
        body * { visibility: hidden; }
        .receipt-a4, .receipt-a4 * { visibility: visible; }
        .receipt-a4 { position: fixed; top: 0; left: 0; width: 210mm; padding: 14mm; background: white; color: #000; font-size: 10pt; box-sizing: border-box; }
        .receipt-a4 table { width: 100%; border-collapse: collapse; }
        .receipt-a4 th, .receipt-a4 td { border: 1px solid #aaa; padding: 4pt 6pt; }
      }
    `,
  });
  const [sharingPdf, setSharingPdf] = useState(false);
  async function handleShare() {
    if (!receiptRef.current) return;
    setSharing(true);
    const r = await shareAsImage(receiptRef.current, "binning_receipt.png");
    if (r === "failed") toast({ title: "Share failed", variant: "destructive" });
    setSharing(false);
  }
  async function handleSharePdf() {
    if (!receiptRef.current) return;
    setSharingPdf(true);
    const r = await shareAsPdf(receiptRef.current, "binning_receipt.pdf");
    if (r === "failed") toast({ title: "PDF share failed", variant: "destructive" });
    setSharingPdf(false);
  }

  const filteredVouchers = vouchers.filter(v =>
    v.voucherId.toLowerCase().includes(search.toLowerCase()) ||
    v.storeName.toLowerCase().includes(search.toLowerCase())
  );

  const statusColor: Record<string, string> = {
    draft: "bg-yellow-100 text-yellow-800",
    approved: "bg-green-100 text-green-800",
    voided: "bg-red-100 text-red-700",
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ClipboardCheck className="w-6 h-6 text-primary" /> Binning
          </h1>
          <p className="text-sm text-muted-foreground">Create binning vouchers, receive products by photo and add to stock balance on approval</p>
        </div>
        <Button onClick={openNew}>
          <Plus className="w-4 h-4 mr-2" /> New Binning
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search by voucher ID or store…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Voucher List */}
      {loading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : filteredVouchers.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <ClipboardCheck className="w-12 h-12 mx-auto mb-4 opacity-20" />
          <p>No binning vouchers yet. Click "New Binning" to create one.</p>
        </div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Voucher ID</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Store</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs">Items</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs">Cartons</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs">Units</th>
                <th className="text-center px-4 py-3 font-medium text-muted-foreground text-xs">Status</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredVouchers.map(v => (
                <tr key={v.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 font-mono text-xs font-medium">{v.voucherId}</td>
                  <td className="px-4 py-3">{v.storeName}</td>
                  <td className="px-4 py-3 text-right">{v.items.length}</td>
                  <td className="px-4 py-3 text-right font-semibold text-blue-700">{v.totalCartons}</td>
                  <td className="px-4 py-3 text-right font-semibold text-green-700">{v.totalUnits}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusColor[v.status] || ""}`}>
                      {v.status.charAt(0).toUpperCase() + v.status.slice(1)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="ghost" title="View Receipt" onClick={() => setShowReceipt(v)}>
                        <Eye className="w-4 h-4" />
                      </Button>
                      {v.status === "draft" && (
                        <>
                          <Button size="sm" variant="ghost" title="Edit" onClick={() => openEdit(v)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Approve & Add to Stock"
                            className="text-green-600 hover:text-green-700 hover:bg-green-50"
                            disabled={approving}
                            onClick={() => handleApprove(v)}
                          >
                            <CheckCircle className="w-4 h-4" />
                          </Button>
                          <Button size="sm" variant="ghost" className="text-red-500" title="Delete" onClick={() => setDeleteConfirm(v)}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                      {v.status === "approved" && (
                        <span className="text-xs text-green-600 font-medium px-2">
                          ✓ Approved{v.approvedBy ? ` by ${v.approvedBy}` : ""}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit Form Dialog */}
      <Dialog open={showForm} onOpenChange={v => { if (!v) { setShowForm(false); resetForm(); } }}>
        <DialogContent className="max-w-5xl max-h-[95vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5" />
              {editingId ? "Edit Binning Voucher" : "New Binning Voucher"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            {/* Store */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Store *</Label>
                <Select value={storeId} onValueChange={setStoreId}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select store" />
                  </SelectTrigger>
                  <SelectContent>
                    {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Remark</Label>
                <Input className="mt-1" placeholder="Optional note…" value={remark} onChange={e => setRemark(e.target.value)} />
              </div>
            </div>

            {/* Product Search */}
            <div>
              <Label>Search & Add Products</Label>
              <div className="flex gap-2 mt-1">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder="Search by name, code or scan barcode…"
                    value={productSearch}
                    onChange={e => setProductSearch(e.target.value)}
                  />
                </div>
                <BarcodeScannerButton onScan={val => {
                  const exact = products.find(p =>
                    (p.barcodeValue || "").toLowerCase() === val.toLowerCase() ||
                    p.code.toLowerCase() === val.toLowerCase()
                  );
                  if (exact) addProductToItems(exact);
                  else setProductSearch(val);
                }} />
              </div>
            </div>

            {/* Product Photo Grid */}
            <div>
              <Label className="text-xs text-muted-foreground mb-2 block">
                {productSearch ? `${filteredProducts.length} products found — click to add` : `All ${filteredProducts.length} products — click to add`}
              </Label>
              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2 max-h-64 overflow-y-auto p-1 border rounded-lg bg-muted/20">
                {filteredProducts.map(p => {
                  const already = items.some(i => i.productId === p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => addProductToItems(p)}
                      disabled={already}
                      className={`relative group flex flex-col items-center gap-1 p-1.5 rounded-lg border transition-all text-center
                        ${already
                          ? "border-green-400 bg-green-50 opacity-60 cursor-not-allowed"
                          : "border-transparent hover:border-primary hover:bg-primary/5 cursor-pointer hover:shadow-md"
                        }`}
                      title={p.name}
                    >
                      <div className="w-14 h-14 rounded-md overflow-hidden bg-muted flex items-center justify-center flex-shrink-0">
                        {p.photoUrl
                          ? <img src={p.photoUrl} alt={p.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                          : <Package className="w-6 h-6 text-muted-foreground" />
                        }
                      </div>
                      <span className="text-[9px] leading-tight line-clamp-2 w-full">{p.name}</span>
                      {already && <span className="absolute top-0.5 right-0.5 bg-green-500 text-white text-[8px] rounded-full w-4 h-4 flex items-center justify-center">✓</span>}
                    </button>
                  );
                })}
                {filteredProducts.length === 0 && (
                  <div className="col-span-8 text-center text-muted-foreground py-8 text-sm">No products found</div>
                )}
              </div>
            </div>

            {/* Items Table */}
            {items.length > 0 && (
              <div>
                <Label>Binning Items ({items.length})</Label>
                <div className="mt-2 rounded-lg border overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left px-3 py-2 text-xs text-muted-foreground">Photo</th>
                        <th className="text-left px-3 py-2 text-xs text-muted-foreground">Product</th>
                        <th className="text-center px-3 py-2 text-xs text-muted-foreground">Qty/Ctn</th>
                        <th className="text-center px-3 py-2 text-xs text-muted-foreground">Cartons / Pieces</th>
                        <th className="text-center px-3 py-2 text-xs text-muted-foreground">Units</th>
                        <th className="text-center px-3 py-2 text-xs text-muted-foreground">Unit Price</th>
                        <th className="text-center px-3 py-2 text-xs text-muted-foreground">Ctn Price</th>
                        <th className="px-3 py-2 text-xs text-muted-foreground"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {items.map((item, idx) => (
                        <tr key={item.productId} className="hover:bg-muted/20">
                          <td className="px-3 py-2">
                            {item.photoUrl
                              ? <img src={item.photoUrl} alt={item.productName} className="w-10 h-10 rounded object-cover" />
                              : <div className="w-10 h-10 rounded bg-muted flex items-center justify-center"><Package className="w-5 h-5 text-muted-foreground" /></div>
                            }
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-medium text-sm">{item.productName}</div>
                            <div className="text-xs text-muted-foreground">{item.productCode}</div>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <Input
                              type="number" min={1} className="w-16 h-7 text-xs text-center"
                              value={item.quantityPerCarton}
                              onChange={e => updateItem(idx, "quantityPerCarton", Number(e.target.value))}
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <div className="flex flex-col items-center gap-1">
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
                                  type="number" min={0} className="w-16 h-7 text-xs text-center"
                                  value={Math.round(item.cartons * item.quantityPerCarton)}
                                  onChange={e => {
                                    const pcs = Number(e.target.value);
                                    const ctns = item.quantityPerCarton > 0 ? pcs / item.quantityPerCarton : 0;
                                    setItems(prev => prev.map((it, i) => i !== idx ? it : {
                                      ...it,
                                      units: pcs,
                                      cartons: ctns,
                                    }));
                                  }}
                                />
                              ) : (
                                <Input
                                  type="number" min={0} className="w-16 h-7 text-xs text-center"
                                  value={item.cartons}
                                  onChange={e => updateItem(idx, "cartons", Number(e.target.value))}
                                />
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-center font-semibold text-green-700">
                            {item.units}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <Input
                              type="number" min={0} step={0.01} className="w-20 h-7 text-xs text-center"
                              value={item.unitPrice}
                              onChange={e => updateItem(idx, "unitPrice", Number(e.target.value))}
                            />
                          </td>
                          <td className="px-3 py-2 text-center text-purple-700 font-medium text-xs">
                            {fmt(item.cartonPrice)}
                          </td>
                          <td className="px-3 py-2">
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" onClick={() => removeItem(idx)}>
                              <X className="w-4 h-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-muted/40 font-semibold border-t-2">
                      <tr>
                        <td colSpan={3} className="px-3 py-2 text-sm font-bold">TOTAL</td>
                        <td className="px-3 py-2 text-center text-blue-700 text-sm">
                          {items.reduce((s, i) => s + i.cartons, 0)} ctns
                        </td>
                        <td className="px-3 py-2 text-center text-green-700 text-sm">
                          {items.reduce((s, i) => s + i.units, 0)} units
                        </td>
                        <td colSpan={3} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowForm(false); resetForm(); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : editingId ? "Update Draft" : "Save as Draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Receipt Dialog */}
      <Dialog open={!!showReceipt} onOpenChange={v => { if (!v) setShowReceipt(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Binning Receipt</DialogTitle>
          </DialogHeader>

          {showReceipt && (
            <div ref={receiptRef} className="receipt-a4 p-5 space-y-4 font-sans">
              {/* Header */}
              <div className="text-center border-b-2 border-black pb-3">
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">Multi-Store Inventory System</p>
                <h2 className="text-2xl font-extrabold uppercase tracking-wide">Binning Voucher</h2>
                <p className="text-sm font-mono font-semibold mt-0.5">{showReceipt.voucherId}</p>
              </div>

              {/* Meta info */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs border-b pb-3">
                <div className="flex gap-1"><span className="text-muted-foreground w-20">Store:</span><strong>{showReceipt.storeName}</strong></div>
                <div className="flex gap-1"><span className="text-muted-foreground w-20">Status:</span>
                  <span className={`font-bold ${showReceipt.status === "approved" ? "text-green-600" : "text-amber-600"}`}>
                    {showReceipt.status.toUpperCase()}
                  </span>
                </div>
                <div className="flex gap-1"><span className="text-muted-foreground w-20">Created by:</span><span>{showReceipt.createdByName || "—"}</span></div>
                <div className="flex gap-1"><span className="text-muted-foreground w-20">Approved by:</span><span>{showReceipt.approvedBy || "—"}</span></div>
                <div className="flex gap-1"><span className="text-muted-foreground w-20">Date:</span><span>{new Date(showReceipt.createdAt?.toDate?.() ?? Date.now()).toLocaleDateString()}</span></div>
                {showReceipt.remark && (
                  <div className="col-span-2 flex gap-1"><span className="text-muted-foreground w-20">Remark:</span><span>{showReceipt.remark}</span></div>
                )}
              </div>

              {/* Items table */}
              <table className="w-full text-xs border-collapse border border-gray-400">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="border border-gray-400 px-1.5 py-1.5 text-left w-12">Photo</th>
                    <th className="border border-gray-400 px-1.5 py-1.5 text-left">Product</th>
                    <th className="border border-gray-400 px-1.5 py-1.5 text-center w-12">Qty/Ctn</th>
                    <th className="border border-gray-400 px-1.5 py-1.5 text-center w-14">Cartons</th>
                    <th className="border border-gray-400 px-1.5 py-1.5 text-center w-14">Units</th>
                    <th className="border border-gray-400 px-1.5 py-1.5 text-right w-20">Unit Price</th>
                    <th className="border border-gray-400 px-1.5 py-1.5 text-right w-20">Ctn Price</th>
                    <th className="border border-gray-400 px-1.5 py-1.5 text-right w-20">Unit Total</th>
                    <th className="border border-gray-400 px-1.5 py-1.5 text-right w-20">Ctn Total</th>
                  </tr>
                </thead>
                <tbody>
                  {showReceipt.items.map((item, i) => {
                    const unitTotal = item.unitPrice > 0 ? item.unitPrice * item.units : 0;
                    const ctnTotal  = item.cartonPrice > 0 ? item.cartonPrice * item.cartons : 0;
                    return (
                      <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                        <td className="border border-gray-300 px-1.5 py-1">
                          {item.photoUrl
                            ? <img src={item.photoUrl} alt={item.productName} className="w-10 h-10 rounded object-cover" />
                            : <div className="w-10 h-10 bg-gray-200 rounded flex items-center justify-center"><Package className="w-4 h-4 text-gray-400" /></div>
                          }
                        </td>
                        <td className="border border-gray-300 px-1.5 py-1">
                          <div className="font-semibold">{item.productName}</div>
                          <div className="text-[10px] text-gray-400">{item.productCode}</div>
                        </td>
                        <td className="border border-gray-300 px-1.5 py-1 text-center">{item.quantityPerCarton}</td>
                        <td className="border border-gray-300 px-1.5 py-1 text-center font-bold text-blue-700">{item.cartons}</td>
                        <td className="border border-gray-300 px-1.5 py-1 text-center font-bold text-green-700">{item.units}</td>
                        <td className="border border-gray-300 px-1.5 py-1 text-right">{item.unitPrice > 0 ? fmt(item.unitPrice) : "—"}</td>
                        <td className="border border-gray-300 px-1.5 py-1 text-right">{item.cartonPrice > 0 ? fmt(item.cartonPrice) : "—"}</td>
                        <td className="border border-gray-300 px-1.5 py-1 text-right font-semibold">{unitTotal > 0 ? fmt(unitTotal) : "—"}</td>
                        <td className="border border-gray-300 px-1.5 py-1 text-right font-semibold">{ctnTotal > 0 ? fmt(ctnTotal) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  {(() => {
                    const totUnits   = showReceipt.totalUnits;
                    const totCtns    = showReceipt.totalCartons;
                    const totUnitVal = showReceipt.items.reduce((s, i) => s + (i.unitPrice > 0 ? i.unitPrice * i.units : 0), 0);
                    const totCtnVal  = showReceipt.items.reduce((s, i) => s + (i.cartonPrice > 0 ? i.cartonPrice * i.cartons : 0), 0);
                    const grandTotal = totUnitVal > 0 ? totUnitVal : totCtnVal;
                    return (
                      <>
                        <tr className="bg-gray-200 font-bold text-xs">
                          <td colSpan={3} className="border border-gray-400 px-1.5 py-1.5">TOTAL</td>
                          <td className="border border-gray-400 px-1.5 py-1.5 text-center text-blue-700">{totCtns} ctns</td>
                          <td className="border border-gray-400 px-1.5 py-1.5 text-center text-green-700">{totUnits} units</td>
                          <td className="border border-gray-400 px-1.5 py-1.5" />
                          <td className="border border-gray-400 px-1.5 py-1.5" />
                          <td className="border border-gray-400 px-1.5 py-1.5 text-right">{totUnitVal > 0 ? fmt(totUnitVal) : "—"}</td>
                          <td className="border border-gray-400 px-1.5 py-1.5 text-right">{totCtnVal > 0 ? fmt(totCtnVal) : "—"}</td>
                        </tr>
                        <tr className="bg-yellow-50">
                          <td colSpan={7} className="border border-gray-400 px-1.5 py-2 text-sm font-extrabold text-right text-amber-800">GRAND TOTAL</td>
                          <td colSpan={2} className="border border-gray-400 px-1.5 py-2 text-sm font-extrabold text-right text-amber-800">{fmt(grandTotal)}</td>
                        </tr>
                      </>
                    );
                  })()}
                </tfoot>
              </table>

              {/* Signature section */}
              <div className="grid grid-cols-3 gap-6 pt-6 text-xs border-t mt-4">
                {["Prepared By", "Checked By", "Received By"].map(label => (
                  <div key={label} className="text-center">
                    <div className="border-b border-black mb-1 h-8" />
                    <p className="font-semibold">{label}</p>
                    <p className="text-[10px] text-muted-foreground">Name / Signature / Date</p>
                  </div>
                ))}
              </div>

              <div className="text-[10px] text-muted-foreground text-right pt-1">
                Page 1 of 1 · Printed: {new Date().toLocaleString()}
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 flex-wrap">
            <Button variant="outline" onClick={handleSharePdf} disabled={sharingPdf}>
              <FileText className="w-4 h-4 mr-2" />{sharingPdf ? "Generating…" : "PDF Share"}
            </Button>
            <Button variant="outline" onClick={handleShare} disabled={sharing}>
              <Share2 className="w-4 h-4 mr-2" />{sharing ? "Sharing…" : "Share"}
            </Button>
            <Button variant="outline" onClick={() => handlePrint()}>
              <Printer className="w-4 h-4 mr-2" /> Print
            </Button>
            {showReceipt?.status === "draft" && (
              <Button
                className="bg-green-600 hover:bg-green-700 text-white"
                disabled={approving}
                onClick={() => { handleApprove(showReceipt!); setShowReceipt(null); }}
              >
                <CheckCircle className="w-4 h-4 mr-2" />
                {approving ? "Approving…" : "Approve & Add to Stock"}
              </Button>
            )}
            <Button onClick={() => setShowReceipt(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={!!deleteConfirm} onOpenChange={v => { if (!v) setDeleteConfirm(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete Voucher?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete <strong>{deleteConfirm?.voucherId}</strong>? This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { if (deleteConfirm) { setDeleteConfirm(null); confirmDelete(() => handleDelete(deleteConfirm)); } }}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {DeleteAuthDialog}
    </div>
  );
}
