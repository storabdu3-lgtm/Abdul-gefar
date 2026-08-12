import { useState, useEffect, useRef } from "react";
import { fmt } from "@/lib/currency";
import { Plus, Search, Eye, Trash2, Printer, Share2, XCircle, Package, CheckCircle, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { getAll, create, update, COLLECTIONS, generateVoucherId, generateSerialVoucherId } from "@/lib/firestore";
import { useAuth } from "@/lib/auth";
import { shareAsImage, shareAsPdf } from "@/lib/shareImage";
import { computeStockBalances } from "@/lib/stockUtils";
import type { Product, Store, DirectSale, DirectSaleItem, PricingRecord } from "@/lib/types";
import { useReactToPrint } from "react-to-print";

function toDate(val: unknown): Date {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val === "object" && "seconds" in (val as Record<string,unknown>)) {
    return new Date((val as { seconds: number }).seconds * 1000);
  }
  return new Date(String(val));
}
function fmtDate(val: unknown) {
  return toDate(val).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

const statusColor: Record<string, string> = {
  active: "bg-blue-100 text-blue-700",
  approved: "bg-green-100 text-green-700",
  voided: "bg-red-100 text-red-700",
};

export default function DirectSales() {
  const [sales, setSales] = useState<DirectSale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [pricing, setPricing] = useState<PricingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showVoucher, setShowVoucher] = useState<DirectSale | null>(null);
  const [saving, setSaving] = useState(false);
  const [stockMap, setStockMap] = useState<Record<string, number>>({});

  const [storeId, setStoreId] = useState("");
  const [remark, setRemark] = useState("");
  const [items, setItems] = useState<DirectSaleItem[]>([]);
  const [productSearch, setProductSearch] = useState("");

  const { toast } = useToast();
  const { user, isAdmin } = useAuth();
  const [sharing, setSharing] = useState(false);
  const [sharingPdf, setSharingPdf] = useState(false);
  const receiptRef = useRef<HTMLDivElement>(null);
  const handlePrint = useReactToPrint({ contentRef: receiptRef });
  async function handleShare() {
    if (!receiptRef.current) return;
    setSharing(true);
    const r = await shareAsImage(receiptRef.current, "direct_sale_receipt.png");
    if (r === "failed") toast({ title: "Share failed", variant: "destructive" });
    setSharing(false);
  }
  async function handleSharePdf() {
    if (!receiptRef.current) return;
    setSharingPdf(true);
    const r = await shareAsPdf(receiptRef.current, "direct_sale_receipt.pdf");
    if (r === "failed") toast({ title: "PDF share failed", variant: "destructive" });
    setSharingPdf(false);
  }

  async function loadData() {
    setLoading(true);
    const [sls, prods, sts, prs] = await Promise.all([
      getAll<DirectSale>(COLLECTIONS.DIRECT_SALES),
      getAll<Product>(COLLECTIONS.PRODUCTS),
      getAll<Store>(COLLECTIONS.STORES),
      getAll<PricingRecord>(COLLECTIONS.PRICING),
    ]);
    setSales(sls.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))));
    setProducts(prods.filter(p => !p.isVoided));
    setStores(sts.filter(s => !s.isVoided));
    setPricing(prs);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  async function loadStockForStore(sid: string) {
    const balances = await computeStockBalances(sid);
    setStockMap(Object.fromEntries(Object.entries(balances).map(([pid, b]) => [pid, b.quantity])));
  }

  useEffect(() => { if (storeId) loadStockForStore(storeId); }, [storeId]);

  const filtered = sales.filter(s =>
    s.voucherId?.toLowerCase().includes(search.toLowerCase()) ||
    s.storeName?.toLowerCase().includes(search.toLowerCase()) ||
    s.soldByName?.toLowerCase().includes(search.toLowerCase())
  );

  function resetForm() { setStoreId(""); setRemark(""); setItems([]); setProductSearch(""); }
  function openNew() { resetForm(); setShowForm(true); }

  const filteredProducts = products.filter(p =>
    (p.name.toLowerCase().includes(productSearch.toLowerCase()) || p.code.toLowerCase().includes(productSearch.toLowerCase())) &&
    !items.find(i => i.productId === p.id)
  ).slice(0, 8);

  function getDefaultPrice(productId: string) {
    return pricing.find(p => p.productId === productId)?.sellingPrice || 0;
  }

  function addProduct(prod: Product) {
    setItems(prev => [...prev, {
      productId: prod.id, productName: prod.name, productCode: prod.code,
      photoUrl: prod.photoUrl || "", quantityPerCarton: prod.quantityPerCarton,
      quantity: 1, sellByCarton: false,
      unitPrice: getDefaultPrice(prod.id),
      totalPrice: getDefaultPrice(prod.id),
    }]);
    setProductSearch("");
  }

  function updateItem(idx: number, field: string, value: number | boolean) {
    setItems(prev => prev.map((it, i) => {
      if (i !== idx) return it;
      const updated = { ...it, [field]: value };
      const qty = updated.sellByCarton ? updated.quantity * updated.quantityPerCarton : updated.quantity;
      updated.totalPrice = qty * updated.unitPrice;
      return updated;
    }));
  }

  function toggleCarton(idx: number) {
    setItems(prev => prev.map((it, i) => {
      if (i !== idx) return it;
      const updated = { ...it, sellByCarton: !it.sellByCarton, quantity: 1 };
      const qty = updated.sellByCarton ? updated.quantityPerCarton : 1;
      updated.totalPrice = qty * updated.unitPrice;
      return updated;
    }));
  }

  function removeItem(idx: number) { setItems(prev => prev.filter((_, i) => i !== idx)); }

  const total = items.reduce((s, i) => s + i.totalPrice, 0);

  async function handleSave() {
    if (!storeId) { toast({ title: "Select a store", variant: "destructive" }); return; }
    if (items.length === 0) { toast({ title: "Add at least one product", variant: "destructive" }); return; }

    for (const it of items) {
      const actualQty = it.sellByCarton ? it.quantity * it.quantityPerCarton : it.quantity;
      if (actualQty > (stockMap[it.productId] || 0)) {
        toast({ title: `Insufficient stock for ${it.productName}`, variant: "destructive" }); return;
      }
    }

    setSaving(true);
    try {
      const store = stores.find(s => s.id === storeId)!;
      const voucherId = await generateSerialVoucherId("DS");
      const doc: Omit<DirectSale, "id"> = {
        voucherId, storeId, storeName: store.name,
        soldByName: user?.name || "Unknown",
        items, totalAmount: total, remark, status: "active",
        createdByName: user?.name || "",
      };
      await create(COLLECTIONS.DIRECT_SALES, doc as Record<string, unknown>);
      toast({ title: "Sale recorded", description: voucherId });
      setShowForm(false); resetForm(); await loadData();
    } catch { toast({ title: "Failed", variant: "destructive" }); } finally { setSaving(false); }
  }

  async function handleVoid(sale: DirectSale) {
    if (!confirm(`Void sale ${sale.voucherId}? Stock will be restored.`)) return;
    await update(COLLECTIONS.DIRECT_SALES, sale.id, { isVoided: true, status: "voided" });
    toast({ title: "Voided — stock restored" }); await loadData();
  }

  async function handleApprove(sale: DirectSale) {
    if (!isAdmin) return;
    setSaving(true);
    try {
      const posVoucherId = await generateSerialVoucherId("POS");

      // Build POS sale items from direct sale items
      const posItems = sale.items.map(it => ({
        productId: it.productId, productName: it.productName, productCode: it.productCode,
        photoUrl: it.photoUrl || "", quantityPerCarton: it.quantityPerCarton,
        remainingStock: stockMap[it.productId] ?? 0,
        sellingPrice: it.unitPrice, adjustedPrice: it.unitPrice,
        sellByCarton: it.sellByCarton,
        quantity: it.sellByCarton ? it.quantity * it.quantityPerCarton : it.quantity,
        totalPrice: it.totalPrice,
      }));

      // Create POS sale
      await create(COLLECTIONS.POS_SALES, {
        voucherId: posVoucherId,
        storeId: sale.storeId, storeName: sale.storeName,
        items: posItems,
        subtotal: sale.totalAmount, totalAmount: sale.totalAmount,
        paymentMethod: "cash",
        amountPaid: sale.totalAmount, remainingBalance: 0,
        remark: `From Direct Sale: ${sale.voucherId}`,
        status: "active",
      } as Record<string, unknown>);

      // Mark direct sale as approved
      await update(COLLECTIONS.DIRECT_SALES, sale.id, {
        status: "approved",
        approvedBy: user?.name || "Admin",
        approvedAt: new Date(),
        posVoucherId,
      } as Record<string, unknown>);

      toast({ title: "Approved & added to POS", description: `POS Voucher: ${posVoucherId}` });
      setShowVoucher(null);
      await loadData();
    } catch { toast({ title: "Failed", variant: "destructive" }); } finally { setSaving(false); }
  }

  function buildShareText(s: DirectSale) {
    return [
      "DIRECT SALE VOUCHER", `Voucher: ${s.voucherId}`, `Date: ${fmtDate(s.createdAt)}`,
      `Store: ${s.storeName}`, `Sold By: ${s.soldByName}`, "",
      ...s.items.map(it => {
        const qty = it.sellByCarton ? it.quantity * it.quantityPerCarton : it.quantity;
        return `• ${it.productName} [${it.productCode}]: ${it.sellByCarton ? `${it.quantity} ctn (${qty} pcs)` : `${qty} pcs`} × ${fmt(it.unitPrice)} = ${fmt(it.totalPrice)}`;
      }),
      "", `TOTAL: ${fmt(s.totalAmount)}`,
      s.approvedBy ? `\nApproved By: ${s.approvedBy}` : "",
    ].filter(l => l !== undefined).join("\n");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Direct Sales</h1>
          <p className="text-sm text-muted-foreground">Record direct product sales from store. Approve to push to POS.</p>
        </div>
        <Button onClick={openNew}><Plus className="w-4 h-4 mr-2" /> New Sale</Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search voucher, store, seller…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : (
        <div className="rounded-xl border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Voucher</th>
                <th className="text-left px-4 py-3 font-medium">Store</th>
                <th className="text-left px-4 py-3 font-medium">Sold By</th>
                <th className="text-left px-4 py-3 font-medium">Date</th>
                <th className="text-right px-4 py-3 font-medium">Total</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="text-center text-muted-foreground py-12">No sales yet</td></tr>
              )}
              {filtered.map(sale => (
                <tr key={sale.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-primary">{sale.voucherId}</td>
                  <td className="px-4 py-3 text-xs">{sale.storeName}</td>
                  <td className="px-4 py-3 text-xs">{sale.soldByName}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(sale.createdAt)}</td>
                  <td className="px-4 py-3 text-right font-semibold">{fmt(sale.totalAmount)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusColor[sale.status] || ""}`}>
                      {sale.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setShowVoucher(sale)}><Eye className="w-4 h-4" /></Button>
                      {isAdmin && sale.status === "active" && (
                        <Button size="sm" variant="ghost" className="text-green-600" title="Approve & push to POS" onClick={() => handleApprove(sale)}>
                          <CheckCircle className="w-4 h-4" />
                        </Button>
                      )}
                      {sale.status === "active" && (
                        <Button size="sm" variant="ghost" className="text-red-500" onClick={() => handleVoid(sale)}><XCircle className="w-4 h-4" /></Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* New Sale Dialog */}
      <Dialog open={showForm} onOpenChange={v => { if (!v) { setShowForm(false); resetForm(); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-4xl">
          <DialogHeader><DialogTitle>New Direct Sale</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Store</Label>
                <Select value={storeId} onValueChange={setStoreId}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select store" /></SelectTrigger>
                  <SelectContent>{stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Sold By</Label>
                <Input value={user?.name || ""} readOnly className="mt-1 bg-muted" />
              </div>
            </div>

            <div className="relative">
              <Label>Add Products</Label>
              <div className="relative mt-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder="Search by name or code…" value={productSearch} onChange={e => setProductSearch(e.target.value)} className="pl-9" disabled={!storeId} />
              </div>
              {productSearch && filteredProducts.length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-card border rounded-lg shadow-lg max-h-64 overflow-y-auto">
                  {filteredProducts.map(p => (
                    <button key={p.id} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted/50 text-left" onClick={() => addProduct(p)}>
                      {p.photoUrl ? <img src={p.photoUrl} alt={p.name} className="w-8 h-8 rounded object-cover" /> : <div className="w-8 h-8 bg-muted rounded flex items-center justify-center"><Package className="w-4 h-4 text-muted-foreground" /></div>}
                      <div>
                        <div className="font-medium text-sm">{p.name}</div>
                        <div className="text-xs text-muted-foreground">{p.code} · Stock: {stockMap[p.id] ?? "…"} pcs</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {items.length > 0 && (
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2">Product</th>
                      <th className="text-center px-3 py-2">By Carton</th>
                      <th className="text-left px-3 py-2">Quantity</th>
                      <th className="text-right px-3 py-2">Unit Price</th>
                      <th className="text-right px-3 py-2">Total</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {items.map((it, idx) => {
                      const actualQty = it.sellByCarton ? it.quantity * it.quantityPerCarton : it.quantity;
                      const overStock = actualQty > (stockMap[it.productId] || 0);
                      return (
                        <tr key={it.productId} className={overStock ? "bg-red-50" : ""}>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              {it.photoUrl ? <img src={it.photoUrl} alt={it.productName} className="w-8 h-8 rounded object-cover" /> : <div className="w-8 h-8 bg-muted rounded flex items-center justify-center"><Package className="w-4 h-4 text-muted-foreground" /></div>}
                              <div>
                                <div className="font-medium text-xs">{it.productName}</div>
                                <div className="text-xs text-muted-foreground">{it.productCode} · {stockMap[it.productId] ?? "…"} pcs left</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-center">
                            {it.quantityPerCarton > 1 && <input type="checkbox" checked={it.sellByCarton} onChange={() => toggleCarton(idx)} />}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-col gap-0.5">
                              <Input type="number" min={1} value={it.quantity} onChange={e => updateItem(idx, "quantity", Number(e.target.value))} className="w-20 h-7 text-xs" />
                              {it.sellByCarton && <span className="text-xs text-muted-foreground">{actualQty} pcs</span>}
                              {overStock && <span className="text-xs text-red-600">Over stock!</span>}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Input type="number" min={0} value={it.unitPrice} onChange={e => updateItem(idx, "unitPrice", Number(e.target.value))} className="w-24 h-7 text-xs text-right" />
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-sm">{fmt(it.totalPrice)}</td>
                          <td className="px-3 py-2">
                            <Button size="sm" variant="ghost" onClick={() => removeItem(idx)}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-muted/30">
                    <tr>
                      <td colSpan={4} className="px-3 py-2 text-right font-semibold text-sm">Total:</td>
                      <td className="px-3 py-2 text-right font-bold">{fmt(total)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            <div><Label>Remark (optional)</Label><Input value={remark} onChange={e => setRemark(e.target.value)} placeholder="Notes…" className="mt-1" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowForm(false); resetForm(); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save Sale"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Voucher View */}
      {showVoucher && (
        <Dialog open onOpenChange={() => setShowVoucher(null)}>
          <DialogContent className="max-h-[90vh] overflow-y-auto max-w-2xl">
            <DialogHeader><DialogTitle>Sale Voucher</DialogTitle></DialogHeader>
            <div ref={receiptRef} className="receipt-a4 space-y-4 p-4 text-sm">
              <div className="text-center border-b pb-4">
                <h2 className="text-xl font-bold">DIRECT SALE VOUCHER</h2>
                <p className="font-mono text-primary">{showVoucher.voucherId}</p>
                <p className="text-xs text-muted-foreground">{fmtDate(showVoucher.createdAt)}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><span className="text-muted-foreground">Store:</span><div className="font-semibold">{showVoucher.storeName}</div></div>
                <div><span className="text-muted-foreground">Sold By:</span><div className="font-semibold">{showVoucher.soldByName}</div></div>
                <div>
                  <span className="text-muted-foreground">Status:</span>
                  <div><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusColor[showVoucher.status] || ""}`}>{showVoucher.status}</span></div>
                </div>
                {showVoucher.posVoucherId && <div><span className="text-muted-foreground">POS Voucher:</span><div className="font-mono text-xs text-primary">{showVoucher.posVoucherId}</div></div>}
              </div>
              {showVoucher.remark && <div><span className="text-muted-foreground">Remark:</span> {showVoucher.remark}</div>}
              <table className="w-full border rounded-lg overflow-hidden">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2">Product</th>
                    <th className="text-right px-3 py-2">Qty</th>
                    <th className="text-right px-3 py-2">Unit Price</th>
                    <th className="text-right px-3 py-2">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {showVoucher.items.map((it, i) => {
                    const actualQty = it.sellByCarton ? it.quantity * it.quantityPerCarton : it.quantity;
                    return (
                      <tr key={i}>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            {it.photoUrl ? <img src={it.photoUrl} alt={it.productName} className="w-10 h-10 rounded object-cover" /> : <div className="w-10 h-10 bg-muted rounded flex items-center justify-center"><Package className="w-4 h-4 text-muted-foreground" /></div>}
                            <div><div className="font-medium">{it.productName}</div><div className="text-xs text-muted-foreground">{it.productCode}</div></div>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">{it.sellByCarton ? `${it.quantity} ctn (${actualQty} pcs)` : `${actualQty} pcs`}</td>
                        <td className="px-3 py-2 text-right">{fmt(it.unitPrice)}</td>
                        <td className="px-3 py-2 text-right font-semibold">{fmt(it.totalPrice)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-muted/30">
                  <tr>
                    <td colSpan={3} className="px-3 py-2 text-right font-bold">TOTAL</td>
                    <td className="px-3 py-2 text-right font-bold text-lg">{fmt(showVoucher.totalAmount)}</td>
                  </tr>
                </tfoot>
              </table>

              {/* Footer */}
              <div className="border-t pt-4 mt-2 space-y-1 text-xs text-muted-foreground">
                <div className="flex justify-between"><span>Placed by:</span><span className="font-medium text-foreground">{showVoucher.soldByName}</span></div>
                {showVoucher.approvedBy && (
                  <div className="flex justify-between"><span>Approved by:</span><span className="font-medium text-foreground">{showVoucher.approvedBy} · {showVoucher.approvedAt ? fmtDate(showVoucher.approvedAt) : ""}</span></div>
                )}
                <div className="flex justify-between mt-2"><span>Page 1 of 1</span><span>{fmtDate(showVoucher.createdAt)}</span></div>
              </div>
            </div>
            <DialogFooter className="gap-2">
              {isAdmin && showVoucher.status === "active" && (
                <Button className="bg-green-600 hover:bg-green-700" onClick={() => handleApprove(showVoucher)} disabled={saving}>
                  <CheckCircle className="w-4 h-4 mr-2" /> {saving ? "Approving…" : "Approve & Push to POS"}
                </Button>
              )}
              <Button variant="outline" onClick={handleSharePdf} disabled={sharingPdf}><FileText className="w-4 h-4 mr-2" />{sharingPdf ? "Generating…" : "PDF Share"}</Button>
              <Button variant="outline" onClick={handleShare} disabled={sharing}><Share2 className="w-4 h-4 mr-2" />{sharing ? "Sharing…" : "Share"}</Button>
              <Button variant="outline" onClick={() => handlePrint()}><Printer className="w-4 h-4 mr-2" /> Print</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
