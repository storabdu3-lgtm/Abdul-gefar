import { useState, useEffect, useRef } from "react";
import { Plus, Search, Eye, Ban, Printer, Trash2, Edit, Share2, CheckCircle, RotateCcw, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { getAll, create, update, COLLECTIONS, generateVoucherId, generateSerialVoucherId } from "@/lib/firestore";
import { computeStockBalances } from "@/lib/stockUtils";
import { useAuth } from "@/lib/auth";
import { shareAsImage, shareAsPdf } from "@/lib/shareImage";
import type { Product, Store, Transfer, TransferItem } from "@/lib/types";
import { useReactToPrint } from "react-to-print";
import { BarcodeScannerButton } from "@/components/BarcodeScannerButton";
import { Package } from "lucide-react";
import { ReceiptActionBar } from "@/components/ReceiptActionBar";
import * as XLSX from "xlsx";

export default function Transfers() {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showVoucher, setShowVoucher] = useState<Transfer | null>(null);
  const [editTransfer, setEditTransfer] = useState<Transfer | null>(null);
  const [form, setForm] = useState({ fromStoreId: "", toStoreId: "", voucherDate: new Date().toISOString().slice(0, 10) });
  const [items, setItems] = useState<TransferItem[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [fromStoreStockMap, setFromStoreStockMap] = useState<Record<string, number>>({});
  const { toast } = useToast();
  const [sharing, setSharing] = useState(false);
  const { user, isAdmin } = useAuth();
  const receiptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (form.fromStoreId) {
      computeStockBalances(form.fromStoreId).then(m =>
        setFromStoreStockMap(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, (v as {quantity: number}).quantity])))
      );
    } else {
      setFromStoreStockMap({});
    }
  }, [form.fromStoreId]);

  async function loadData() {
    setLoading(true);
    const [trans, prods, sts] = await Promise.all([
      getAll<Transfer>(COLLECTIONS.TRANSFERS),
      getAll<Product>(COLLECTIONS.PRODUCTS),
      getAll<Store>(COLLECTIONS.STORES),
    ]);
    setTransfers(trans.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))));
    setProducts(prods);
    setStores(sts);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  const filtered = transfers.filter(t =>
    t.voucherId?.toLowerCase().includes(search.toLowerCase()) ||
    t.fromStoreName?.toLowerCase().includes(search.toLowerCase()) ||
    t.toStoreName?.toLowerCase().includes(search.toLowerCase())
  );

  function openNew() {
    setEditTransfer(null);
    setForm({ fromStoreId: "", toStoreId: "", voucherDate: new Date().toISOString().slice(0, 10) });
    setItems([]);
    setProductSearch("");
    setShowForm(true);
  }

  function openEdit(t: Transfer) {
    setEditTransfer(t);
    setForm({ fromStoreId: t.fromStoreId, toStoreId: t.toStoreId, voucherDate: t.voucherDate || new Date().toISOString().slice(0, 10) });
    setItems(t.items ? [...t.items] : []);
    setProductSearch("");
    setShowForm(true);
  }

  function addProduct(prod: Product) {
    if (items.find(i => i.productId === prod.id)) { toast({ title: "Already added" }); return; }
    setItems(prev => [...prev, {
      productId: prod.id, productName: prod.name, productCode: prod.code,
      photoUrl: prod.photoUrl || "", quantityPerCarton: prod.quantityPerCarton,
      availableQty: 0, price: 0, quantity: 1
    }]);
    setProductSearch("");
  }

  function updateItem(idx: number, field: string, value: number | boolean) {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  }

  function updateItemQty(idx: number, displayQty: number) {
    setItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      const qpc = item.quantityPerCarton || 1;
      const actual = item.sellByCarton ? Math.max(1, displayQty) * qpc : Math.max(1, displayQty);
      return { ...item, quantity: actual };
    }));
  }

  function toggleSellByCarton(idx: number) {
    setItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      return { ...item, sellByCarton: !item.sellByCarton };
    }));
  }

  async function checkStockAvailability(storeId: string, transferItems: TransferItem[]): Promise<boolean> {
    if (!storeId) return true;
    const stockMap = await computeStockBalances(storeId);
    for (const item of transferItems) {
      const available = stockMap[item.productId]?.quantity || 0;
      if (item.quantity > available) {
        toast({
          title: "Insufficient stock",
          description: `"${item.productName}" has only ${available} unit(s) in the source store, but ${item.quantity} requested.`,
          variant: "destructive",
        });
        return false;
      }
    }
    return true;
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (!form.fromStoreId || !form.toStoreId || items.length === 0) {
        toast({ title: "Select both stores and add products", variant: "destructive" });
        return;
      }
      if (form.fromStoreId === form.toStoreId) {
        toast({ title: "From and To stores cannot be the same", variant: "destructive" });
        return;
      }
      for (const item of items) {
        if (item.quantity <= 0) {
          toast({ title: `Quantity for "${item.productName}" must be greater than 0`, variant: "destructive" });
          return;
        }
      }
      const ok = await checkStockAvailability(form.fromStoreId, items);
      if (!ok) return;

      const fromStore = stores.find(s => s.id === form.fromStoreId);
      const toStore = stores.find(s => s.id === form.toStoreId);

      if (editTransfer) {
        await update(COLLECTIONS.TRANSFERS, editTransfer.id, {
          fromStoreId: form.fromStoreId,
          fromStoreName: fromStore?.name || "",
          toStoreId: form.toStoreId,
          toStoreName: toStore?.name || "",
          items,
          voucherDate: form.voucherDate,
        });
        toast({ title: "Transfer updated" });
      } else {
        const transferData = {
          voucherId: await generateSerialVoucherId("TRF"),
          fromStoreId: form.fromStoreId,
          fromStoreName: fromStore?.name || "",
          toStoreId: form.toStoreId,
          toStoreName: toStore?.name || "",
          items,
          voucherDate: form.voucherDate,
          status: isAdmin ? "active" : "pending",
          createdByName: user?.name || "",
        };
        const newId = await create(COLLECTIONS.TRANSFERS, transferData);
        toast({ title: isAdmin ? "Transfer recorded" : "Submitted for admin approval" });
        setShowForm(false);
        setItems([]);
        setForm({ fromStoreId: "", toStoreId: "", voucherDate: new Date().toISOString().slice(0, 10) });
        setEditTransfer(null);
        loadData();
        setShowVoucher({ ...transferData, id: newId } as Transfer);
        return;
      }
      setShowForm(false);
      setItems([]);
      setForm({ fromStoreId: "", toStoreId: "", voucherDate: new Date().toISOString().slice(0, 10) });
      setEditTransfer(null);
      loadData();
    } finally {
      setSaving(false);
    }
  }

  async function handleApprove(t: Transfer) {
    const ok = await checkStockAvailability(t.fromStoreId, t.items || []);
    if (!ok) return;
    await update(COLLECTIONS.TRANSFERS, t.id, { status: "active" });
    toast({ title: "Transfer approved" });
    loadData();
  }

  async function handleVoid(t: Transfer) {
    if (!confirm("Void this transfer?")) return;
    await update(COLLECTIONS.TRANSFERS, t.id, { status: "voided" });
    toast({ title: "Transfer voided" });
    loadData();
  }

  async function handleActivate(t: Transfer) {
    await update(COLLECTIONS.TRANSFERS, t.id, { status: "active" });
    toast({ title: "Transfer activated" });
    loadData();
  }

  const handlePrint = useReactToPrint({ contentRef: receiptRef });
  const [sharingPdf, setSharingPdf] = useState(false);
  async function handleShare() {
    if (!receiptRef.current) return;
    setSharing(true);
    const r = await shareAsImage(receiptRef.current, "transfer_receipt.png");
    if (r === "failed") toast({ title: "Share failed", variant: "destructive" });
    setSharing(false);
  }
  async function handleSharePdf() {
    if (!receiptRef.current) return;
    setSharingPdf(true);
    const r = await shareAsPdf(receiptRef.current, "transfer_receipt.pdf");
    if (r === "failed") toast({ title: "PDF share failed", variant: "destructive" });
    setSharingPdf(false);
  }

  function exportExcel(t: Transfer) {
    const wb = XLSX.utils.book_new();
    const data = [
      ["Product", "Code", "Qty/Carton", "Quantity", "Price", "Total"],
      ...t.items.map(i => [i.productName, i.productCode, i.quantityPerCarton, i.quantity, i.price, i.price * i.quantity]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, "Transfer");
    XLSX.writeFile(wb, `${t.voucherId}.xlsx`);
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
          <h1 className="text-2xl font-bold tracking-tight">Store Transfers</h1>
          <p className="text-muted-foreground text-sm">Move products between stores</p>
        </div>
        <Button onClick={openNew} data-testid="button-new-transfer"><Plus className="w-4 h-4 mr-2" /> New Transfer</Button>
      </div>
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
        <Input className="pl-9" placeholder="Search transfers..." value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search-transfers" />
      </div>
      {loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 rounded" />)}</div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>{["Voucher", "Date", "From Store", "To Store", "Items", "Status", "Actions"].map(h => (
                <th key={h} className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(t => (
                <tr key={t.id} className="hover:bg-muted/30" data-testid={`row-transfer-${t.id}`}>
                  <td className="px-4 py-2 font-mono text-xs">{t.voucherId}</td>
                  <td className="px-4 py-2 text-xs">{t.voucherDate || "—"}</td>
                  <td className="px-4 py-2">{t.fromStoreName}</td>
                  <td className="px-4 py-2">{t.toStoreName}</td>
                  <td className="px-4 py-2">{t.items?.length || 0}</td>
                  <td className="px-4 py-2">
                    <Badge
                      variant={t.status === "active" ? "default" : t.status === "pending" ? "outline" : "destructive"}
                      className={t.status === "pending" ? "border-amber-500 text-amber-600 bg-amber-50" : ""}
                    >{t.status}</Badge>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => setShowVoucher(t)} data-testid={`button-view-${t.id}`}><Eye className="w-3 h-3" /></Button>
                      {isAdmin && t.status === "pending" && (
                        <Button size="sm" variant="outline" className="text-emerald-600 border-emerald-400 hover:bg-emerald-50" onClick={() => handleApprove(t)} title="Approve" data-testid={`button-approve-${t.id}`}>
                          <CheckCircle className="w-3 h-3" />
                        </Button>
                      )}
                      {t.status === "active" && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => openEdit(t)} data-testid={`button-edit-${t.id}`}><Edit className="w-3 h-3" /></Button>
                          <Button size="sm" variant="outline" className="text-orange-500 border-orange-300 hover:bg-orange-50" onClick={() => handleVoid(t)}><Ban className="w-3 h-3" /></Button>
                        </>
                      )}
                      {isAdmin && t.status === "voided" && (
                        <Button size="sm" variant="outline" className="text-green-600 border-green-400 hover:bg-green-50" onClick={() => handleActivate(t)} title="Activate transfer" data-testid={`button-activate-${t.id}`}>
                          <RotateCcw className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-muted-foreground">No transfers found</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* New / Edit Transfer Dialog */}
      <Dialog open={showForm} onOpenChange={(open) => { if (!open) { setShowForm(false); setEditTransfer(null); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-3xl">
          <DialogHeader><DialogTitle>{editTransfer ? "Edit Transfer" : "New Transfer"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>From Store *</Label>
                <Select value={form.fromStoreId} onValueChange={v => setForm(f => ({ ...f, fromStoreId: v }))}>
                  <SelectTrigger><SelectValue placeholder="From store" /></SelectTrigger>
                  <SelectContent>{stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>To Store *</Label>
                <Select value={form.toStoreId} onValueChange={v => setForm(f => ({ ...f, toStoreId: v }))}>
                  <SelectTrigger><SelectValue placeholder="To store" /></SelectTrigger>
                  <SelectContent>{stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Date</Label>
              <Input type="date" value={form.voucherDate} onChange={e => setForm(f => ({ ...f, voucherDate: e.target.value }))} data-testid="input-voucher-date" />
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
                    className="flex-1"
                  />
                  <BarcodeScannerButton onScan={val => {
                    const exact = products.find(p => (p.barcodeValue || "").toLowerCase() === val.toLowerCase() || p.code.toLowerCase() === val.toLowerCase());
                    if (exact) addProduct(exact);
                    else setProductSearch(val);
                  }} />
                </div>
                {productResults.length > 0 && (
                  <div className="absolute z-10 top-full left-0 right-0 bg-card border rounded-b shadow-lg">
                    {productResults.map(p => (
                      <div key={p.id} className="px-4 py-2 hover:bg-muted cursor-pointer flex items-center gap-2 justify-between" onClick={() => addProduct(p)}>
                        <div className="flex items-center gap-2">
                          {p.photoUrl ? (
                            <img src={p.photoUrl} alt={p.name} className="w-6 h-6 rounded object-cover" />
                          ) : (
                            <div className="w-6 h-6 rounded bg-muted flex items-center justify-center"><Package className="w-3 h-3 text-muted-foreground" /></div>
                          )}
                          <span className="font-medium text-sm">{p.name}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">{p.code}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {items.length > 0 && (
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>{["Product", "Code", "Qty/Ctn", "By Carton", "Quantity", ""].map(h => <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground text-xs">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((item, idx) => {
                    const qpc = item.quantityPerCarton || 1;
                    const displayQty = item.sellByCarton ? Math.round(item.quantity / qpc) : item.quantity;
                    return (
                      <tr key={idx}>
                        <td className="px-3 py-2 text-sm">
                          <div className="flex items-center gap-2">
                            {item.photoUrl ? (
                              <img src={item.photoUrl} alt={item.productName} className="w-7 h-7 rounded object-cover" />
                            ) : (
                              <div className="w-7 h-7 rounded bg-muted flex items-center justify-center"><Package className="w-3 h-3 text-muted-foreground" /></div>
                            )}
                            {item.productName}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{item.productCode}</td>
                        <td className="px-3 py-2 text-xs">{qpc}</td>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={!!item.sellByCarton}
                            onChange={() => toggleSellByCarton(idx)}
                            title="Transfer by carton"
                          />
                        </td>
                        <td className="px-3 py-2">
                          {(() => {
                            const avail = fromStoreStockMap[item.productId] ?? 0;
                            const overstock = form.fromStoreId && item.quantity > avail;
                            return (
                              <div className="flex flex-col gap-0.5">
                                <Input
                                  type="number"
                                  min={1}
                                  className={`w-20 h-7 text-xs ${overstock ? "border-red-400" : ""}`}
                                  value={displayQty}
                                  onChange={e => updateItemQty(idx, Number(e.target.value))}
                                />
                                {item.sellByCarton && item.quantity > 0 && (
                                  <span className="text-[10px] text-muted-foreground">{item.quantity} pcs total</span>
                                )}
                                {form.fromStoreId && <span className={`text-[10px] ${overstock ? "text-red-500 font-semibold" : "text-muted-foreground"}`}>Avail: {avail}</span>}
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-3 py-2"><Button size="sm" variant="ghost" onClick={() => setItems(prev => prev.filter((_, i) => i !== idx))}><Trash2 className="w-3 h-3 text-destructive" /></Button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowForm(false); setEditTransfer(null); }} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} data-testid="button-save-transfer">
              {saving ? "Saving..." : (editTransfer ? "Update Transfer" : "Save Transfer")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Voucher Dialog */}
      <Dialog open={!!showVoucher} onOpenChange={() => setShowVoucher(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-xl">
          <DialogHeader><DialogTitle>Transfer Receipt</DialogTitle></DialogHeader>
          {showVoucher && (
            <div ref={receiptRef} className="receipt-a4 p-4 space-y-4" style={{ position: "relative" }}>
              {showVoucher.status === "voided" && (
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", zIndex: 10 }}>
                  <span style={{ fontSize: "10rem", fontWeight: 900, color: "rgba(220,38,38,0.38)", transform: "rotate(-35deg)", letterSpacing: "0.12em", userSelect: "none", border: "10px solid rgba(220,38,38,0.38)", borderRadius: "8px", padding: "0 1.5rem", lineHeight: 1 }}>VOID</span>
                </div>
              )}
              <div className="text-center border-b pb-3">
                <h2 className="text-xl font-bold">TRANSFER VOUCHER</h2>
                <p className="text-sm text-muted-foreground">Voucher: {showVoucher.voucherId}</p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-muted-foreground">From: </span>{showVoucher.fromStoreName}</div>
                <div><span className="text-muted-foreground">To: </span>{showVoucher.toStoreName}</div>
                <div><span className="text-muted-foreground">Date: </span>{showVoucher.voucherDate || "—"}</div>
              </div>
              <table className="w-full text-sm border-collapse border">
                <thead><tr className="bg-muted">{["Product", "Code", "Qty/Ctn", "Quantity"].map(h => <th key={h} className="border px-2 py-1 text-xs text-left">{h}</th>)}</tr></thead>
                <tbody>{showVoucher.items?.map((item, i) => {
                  const qpc = item.quantityPerCarton || 1;
                  const displayQty = item.sellByCarton
                    ? `${Math.round(item.quantity / qpc)} ctn (${item.quantity} pcs)`
                    : `${item.quantity} pcs`;
                  return (
                    <tr key={i}>
                      <td className="border px-2 py-1 text-xs">
                        <div className="flex items-center gap-2">
                          {item.photoUrl ? (
                            <img src={item.photoUrl} alt={item.productName} className="w-6 h-6 rounded object-cover" />
                          ) : (
                            <div className="w-6 h-6 rounded bg-muted flex items-center justify-center"><Package className="w-3 h-3 text-muted-foreground" /></div>
                          )}
                          {item.productName}
                        </div>
                      </td>
                      <td className="border px-2 py-1 text-xs">{item.productCode}</td>
                      <td className="border px-2 py-1 text-xs text-center">{qpc}</td>
                      <td className="border px-2 py-1 text-xs text-center">{displayQty}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
              {/* Receipt footer */}
              <div className="border-t pt-3 mt-2 space-y-1 text-xs text-muted-foreground">
                <div className="flex justify-between"><span>From Store:</span><span className="font-medium text-foreground">{showVoucher.fromStoreName}</span></div>
                <div className="flex justify-between"><span>To Store:</span><span className="font-medium text-foreground">{showVoucher.toStoreName}</span></div>
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
    </div>
  );
}
