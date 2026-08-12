import { useState, useEffect, useRef } from "react";
import { fmt } from "@/lib/currency";
import {
  Plus, Search, Trash2, Eye, Printer, Share2, CheckCircle, PackageCheck, FileText,
  XCircle, Package, Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { getAll, create, update, COLLECTIONS, generateVoucherId, generateSerialVoucherId } from "@/lib/firestore";
import { useAuth } from "@/lib/auth";
import { shareAsImage, shareAsPdf } from "@/lib/shareImage";
import { computeStockBalances } from "@/lib/stockUtils";
import type { Product, Store, StoreRequest, StoreRequestItem, Transfer } from "@/lib/types";
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
  pending: "bg-yellow-100 text-yellow-800",
  approved: "bg-blue-100 text-blue-800",
  received: "bg-green-100 text-green-800",
  voided: "bg-red-100 text-red-800",
};

export default function StoreRequests() {
  const [requests, setRequests] = useState<StoreRequest[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingRequest, setEditingRequest] = useState<StoreRequest | null>(null);
  const [showVoucher, setShowVoucher] = useState<StoreRequest | null>(null);
  const [saving, setSaving] = useState(false);
  const [stockMap, setStockMap] = useState<Record<string, Record<string, number>>>({});
  const [allStoresStockMap, setAllStoresStockMap] = useState<Record<string, Record<string, number>>>({});
  const [allStoresLoading, setAllStoresLoading] = useState(false);

  const [fromStoreId, setFromStoreId] = useState("");
  const [toStoreId, setToStoreId] = useState("");
  const [remark, setRemark] = useState("");
  const [voucherDate, setVoucherDate] = useState(new Date().toISOString().slice(0, 10));
  const [items, setItems] = useState<StoreRequestItem[]>([]);
  const [productSearch, setProductSearch] = useState("");

  const { toast } = useToast();
  const [sharing, setSharing] = useState(false);
  const { user, isAdmin } = useAuth();
  const receiptRef = useRef<HTMLDivElement>(null);

  const handlePrint = useReactToPrint({ contentRef: receiptRef });
  const [sharingPdf, setSharingPdf] = useState(false);
  async function handleShare() {
    if (!receiptRef.current) return;
    setSharing(true);
    const r = await shareAsImage(receiptRef.current, "store_request.png");
    if (r === "failed") toast({ title: "Share failed", variant: "destructive" });
    setSharing(false);
  }
  async function handleSharePdf() {
    if (!receiptRef.current) return;
    setSharingPdf(true);
    const r = await shareAsPdf(receiptRef.current, "store_request.pdf");
    if (r === "failed") toast({ title: "PDF share failed", variant: "destructive" });
    setSharingPdf(false);
  }

  async function loadData() {
    setLoading(true);
    const [reqs, prods, sts] = await Promise.all([
      getAll<StoreRequest>(COLLECTIONS.STORE_REQUESTS),
      getAll<Product>(COLLECTIONS.PRODUCTS),
      getAll<Store>(COLLECTIONS.STORES),
    ]);
    setRequests(reqs.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))));
    setProducts(prods.filter(p => !p.isVoided));
    setStores(sts.filter(s => !s.isVoided));
    setLoading(false);
  }

  async function loadStockForStore(storeId: string) {
    if (stockMap[storeId]) return;
    const balances = await computeStockBalances(storeId);
    setStockMap(prev => ({ ...prev, [storeId]: Object.fromEntries(Object.entries(balances).map(([pid, b]) => [pid, b.quantity])) }));
  }

  async function loadAllStoresStock() {
    if (stores.length === 0) return;
    setAllStoresLoading(true);
    try {
      const results = await Promise.all(stores.map(async s => {
        const bal = await computeStockBalances(s.id);
        return { storeId: s.id, qtys: Object.fromEntries(Object.entries(bal).map(([pid, b]) => [pid, b.quantity])) };
      }));
      const map: Record<string, Record<string, number>> = {};
      for (const r of results) map[r.storeId] = r.qtys;
      setAllStoresStockMap(map);
      // also prime stockMap for from/to stores
      setStockMap(prev => {
        const next = { ...prev };
        for (const r of results) if (!next[r.storeId]) next[r.storeId] = r.qtys;
        return next;
      });
    } finally {
      setAllStoresLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);
  useEffect(() => { if (fromStoreId) loadStockForStore(fromStoreId); }, [fromStoreId]);
  useEffect(() => { if (toStoreId) loadStockForStore(toStoreId); }, [toStoreId]);
  useEffect(() => {
    if (toStoreId && fromStoreId && showForm && !editingRequest) loadAllStoresStock();
  }, [toStoreId, fromStoreId, showForm]);

  const filtered = requests.filter(r =>
    r.voucherId?.toLowerCase().includes(search.toLowerCase()) ||
    r.fromStoreName?.toLowerCase().includes(search.toLowerCase()) ||
    r.toStoreName?.toLowerCase().includes(search.toLowerCase())
  );

  function resetForm() {
    setFromStoreId(""); setToStoreId(""); setRemark(""); setItems([]); setProductSearch(""); setEditingRequest(null);
    setVoucherDate(new Date().toISOString().slice(0, 10));
  }

  function openNew() { resetForm(); setShowForm(true); }

  function openEdit(req: StoreRequest) {
    setEditingRequest(req);
    setFromStoreId(req.fromStoreId);
    setToStoreId(req.toStoreId);
    setRemark(req.remark || "");
    setVoucherDate(req.voucherDate || new Date().toISOString().slice(0, 10));
    setItems(req.items);
    setShowForm(true);
  }

  const filteredProducts = products.filter(p =>
    (p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
      p.code.toLowerCase().includes(productSearch.toLowerCase())) &&
    !items.find(i => i.productId === p.id)
  ).slice(0, 8);

  function addProduct(prod: Product) {
    const fromQty = stockMap[fromStoreId]?.[prod.id] ?? 0;
    const toQty = stockMap[toStoreId]?.[prod.id] ?? 0;
    setItems(prev => [...prev, {
      productId: prod.id, productName: prod.name, productCode: prod.code,
      photoUrl: prod.photoUrl || "", quantityPerCarton: prod.quantityPerCarton,
      availableQtyFrom: fromQty, availableQtyTo: toQty,
      price: 0, quantity: 1, sellByCarton: false,
    }]);
    setProductSearch("");
  }

  function toggleCarton(idx: number) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, sellByCarton: !it.sellByCarton, quantity: 1 } : it));
  }

  function updateQty(idx: number, val: number) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, quantity: Math.max(1, val) } : it));
  }

  function removeItem(idx: number) { setItems(prev => prev.filter((_, i) => i !== idx)); }

  async function handleSave() {
    setSaving(true);
    try {
      if (!fromStoreId || !toStoreId) { toast({ title: "Select both stores", variant: "destructive" }); return; }
      if (fromStoreId === toStoreId) { toast({ title: "From and To stores must be different", variant: "destructive" }); return; }
      if (items.length === 0) { toast({ title: "Add at least one product", variant: "destructive" }); return; }

      for (const it of items) {
        const actualQty = it.sellByCarton ? it.quantity * it.quantityPerCarton : it.quantity;
        if (actualQty > it.availableQtyFrom) {
          toast({ title: `Insufficient stock for ${it.productName}`, description: `Available: ${it.availableQtyFrom} pcs`, variant: "destructive" });
          return;
        }
      }
      const fromStore = stores.find(s => s.id === fromStoreId)!;
      const toStore = stores.find(s => s.id === toStoreId)!;

      if (editingRequest) {
        await update(COLLECTIONS.STORE_REQUESTS, editingRequest.id, {
          fromStoreId, fromStoreName: fromStore.name,
          toStoreId, toStoreName: toStore.name,
          items, remark, voucherDate,
        } as Record<string, unknown>);
        toast({ title: "Request updated" });
      } else {
        const voucherId = await generateSerialVoucherId("REQ");
        const reqDoc: Omit<StoreRequest, "id"> = {
          voucherId, fromStoreId, fromStoreName: fromStore.name,
          toStoreId, toStoreName: toStore.name,
          items, status: "pending", remark, voucherDate, createdByName: user?.name || "Unknown",
        };
        const newId = await create(COLLECTIONS.STORE_REQUESTS, reqDoc as Record<string, unknown>);
        toast({ title: "Request created", description: voucherId });
        setShowForm(false); resetForm(); await loadData();
        setShowVoucher({ ...reqDoc, id: newId } as StoreRequest);
        return;
      }
      setShowForm(false); resetForm(); await loadData();
    } catch { toast({ title: "Failed to save", variant: "destructive" }); } finally { setSaving(false); }
  }

  async function handleApprove(req: StoreRequest) {
    if (!isAdmin) return;
    await update(COLLECTIONS.STORE_REQUESTS, req.id, { status: "approved", approvedBy: user?.name || "Admin" });
    toast({ title: "Request approved" });
    await loadData();
  }

  async function handleReceive(req: StoreRequest) {
    try {
      await update(COLLECTIONS.STORE_REQUESTS, req.id, { status: "received", receivedBy: user?.name || "Staff", receivedAt: new Date() });

      // Create a Transfer record so stock movement shows in Transfers module
      const transferItems = req.items.map(it => ({
        productId: it.productId, productName: it.productName, productCode: it.productCode,
        photoUrl: it.photoUrl || "", quantityPerCarton: it.quantityPerCarton,
        availableQty: it.availableQtyFrom,
        price: it.price || 0,
        quantity: it.sellByCarton ? it.quantity * it.quantityPerCarton : it.quantity,
        sellByCarton: it.sellByCarton,
      }));
      const transferDoc: Omit<Transfer, "id"> = {
        voucherId: generateVoucherId("TRF"),
        fromStoreId: req.fromStoreId, fromStoreName: req.fromStoreName,
        toStoreId: req.toStoreId, toStoreName: req.toStoreName,
        items: transferItems, status: "active",
      };
      await create(COLLECTIONS.TRANSFERS, transferDoc as Record<string, unknown>);

      toast({ title: "Stock transferred", description: "Transfer record also created" });
      setShowVoucher(null);
      await loadData();
    } catch { toast({ title: "Failed", variant: "destructive" }); }
  }

  async function handleVoid(req: StoreRequest) {
    await update(COLLECTIONS.STORE_REQUESTS, req.id, { isVoided: true, status: "voided" });
    toast({ title: "Voided" }); await loadData();
  }

  function buildShareText(r: StoreRequest) {
    const lines = [
      `STORE REQUEST VOUCHER`, `Voucher: ${r.voucherId}`, `Date: ${fmtDate(r.createdAt)}`,
      `From: ${r.fromStoreName}`, `To: ${r.toStoreName}`, `Status: ${r.status.toUpperCase()}`,
      r.approvedBy ? `Approved By: ${r.approvedBy}` : "",
      r.receivedBy ? `Received By: ${r.receivedBy}` : "", ``,
      ...r.items.map(it => {
        const actualQty = it.sellByCarton ? it.quantity * it.quantityPerCarton : it.quantity;
        const display = it.sellByCarton ? `${it.quantity} ctn (${actualQty} pcs)` : `${it.quantity} pcs`;
        return `• ${it.productName} [${it.productCode}]: ${display}`;
      }),
    ];
    return lines.filter(Boolean).join("\n");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Store Requests</h1>
          <p className="text-sm text-muted-foreground">Request products from one store to another</p>
        </div>
        <Button onClick={openNew} data-testid="btn-new-request">
          <Plus className="w-4 h-4 mr-2" /> New Request
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search voucher, store…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : (
        <div className="rounded-xl border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Voucher</th>
                <th className="text-left px-4 py-3 font-medium">From → To</th>
                <th className="text-left px-4 py-3 font-medium">Date</th>
                <th className="text-left px-4 py-3 font-medium">Items</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="text-center text-muted-foreground py-12">No requests found</td></tr>
              )}
              {filtered.map(req => (
                <tr key={req.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-primary">{req.voucherId}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-xs">{req.fromStoreName}</div>
                    <div className="text-muted-foreground text-xs">→ {req.toStoreName}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{req.voucherDate || fmtDate(req.createdAt)}</td>
                  <td className="px-4 py-3 text-xs">{req.items.length} product{req.items.length !== 1 ? "s" : ""}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusColor[req.status] || ""}`}>
                      {req.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 flex-wrap">
                      <Button size="sm" variant="ghost" onClick={() => setShowVoucher(req)}>
                        <Eye className="w-4 h-4" />
                      </Button>
                      {req.status === "pending" && (
                        <Button size="sm" variant="ghost" className="text-primary" onClick={() => openEdit(req)}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                      )}
                      {isAdmin && req.status === "pending" && (
                        <Button size="sm" variant="ghost" className="text-blue-600" onClick={() => handleApprove(req)}>
                          <CheckCircle className="w-4 h-4" />
                        </Button>
                      )}
                      {req.status === "approved" && (
                        <Button size="sm" variant="ghost" className="text-green-600" onClick={() => handleReceive(req)}>
                          <PackageCheck className="w-4 h-4" />
                        </Button>
                      )}
                      {!req.isVoided && req.status !== "received" && (
                        <Button size="sm" variant="ghost" className="text-red-500" onClick={() => handleVoid(req)}>
                          <XCircle className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* New / Edit Request Dialog */}
      <Dialog open={showForm} onOpenChange={v => { if (!v) { setShowForm(false); resetForm(); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-4xl">
          <DialogHeader>
            <DialogTitle>{editingRequest ? "Edit Store Request" : "New Store Request"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>From Store</Label>
                <Select value={fromStoreId} onValueChange={setFromStoreId} disabled={!!editingRequest}>
                  <SelectTrigger><SelectValue placeholder="Select source store" /></SelectTrigger>
                  <SelectContent>{stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>To Store</Label>
                <Select value={toStoreId} onValueChange={setToStoreId} disabled={!!editingRequest}>
                  <SelectTrigger><SelectValue placeholder="Select destination store" /></SelectTrigger>
                  <SelectContent>{stores.filter(s => s.id !== fromStoreId).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            {/* ── Low-Stock Panel ── */}
            {toStoreId && fromStoreId && !editingRequest && (() => {
              const pendingItems = new Set(
                requests
                  .filter(r => r.status === "pending" && r.toStoreId === toStoreId)
                  .flatMap(r => r.items.map(i => i.productId))
              );
              const toStore = stores.find(s => s.id === toStoreId);
              const isBranch = (toStore?.level || "").toLowerCase().includes("branch");

              // Branch threshold = 2 cartons (product-specific), Shop threshold = 24 pcs
              const lowStockProds = products.filter(p => {
                const toQty = stockMap[toStoreId]?.[p.id] ?? allStoresStockMap[toStoreId]?.[p.id] ?? null;
                if (toQty === null) return false;
                const qpc = p.quantityPerCarton || 1;
                const threshold = isBranch ? 2 * qpc : 24;
                return toQty <= threshold && !items.find(i => i.productId === p.id);
              });

              if (allStoresLoading) return (
                <div className="rounded-lg border bg-amber-50/50 p-3 text-xs text-amber-700 animate-pulse flex items-center gap-2">
                  <Package className="w-4 h-4" /> Loading stock data for all stores…
                </div>
              );
              if (lowStockProds.length === 0 && Object.keys(allStoresStockMap).length > 0) return (
                <div className="rounded-lg border bg-green-50 p-3 text-xs text-green-700 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" /> All products have enough stock in the destination store.
                </div>
              );
              if (lowStockProds.length === 0) return null;

              return (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Package className="w-4 h-4 text-amber-600" />
                    <span className="text-sm font-semibold text-amber-700">
                      Low Stock in Destination Store
                      <span className="ml-1 font-normal text-amber-600">
                        ({isBranch ? "≤ 2 Cartons — Branch" : "≤ 24 Pcs — Shop"})
                      </span>
                    </span>
                    <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">
                      {lowStockProds.length} item{lowStockProds.length !== 1 ? "s" : ""}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-96 overflow-y-auto pr-1">
                    {lowStockProds.map(p => {
                      const qpc = p.quantityPerCarton || 1;
                      const toQty = stockMap[toStoreId]?.[p.id] ?? allStoresStockMap[toStoreId]?.[p.id] ?? 0;
                      const toCtns = Math.floor(toQty / qpc);
                      const hasPending = pendingItems.has(p.id);

                      // All stores except the To Store, split by level
                      const otherBranchStores = stores.filter(s =>
                        s.id !== toStoreId && (s.level || "").toLowerCase().includes("branch")
                      );
                      const otherShopStores = stores.filter(s =>
                        s.id !== toStoreId && (s.level || "").toLowerCase().includes("shop")
                      );

                      return (
                        <button
                          key={p.id}
                          className="text-left rounded-xl border bg-white hover:bg-amber-50 hover:border-amber-300 transition-all p-2.5 shadow-sm group"
                          onClick={() => addProduct(p)}
                        >
                          {/* Photo + name + code */}
                          <div className="flex gap-2 items-start mb-1.5">
                            {p.photoUrl
                              ? <img src={p.photoUrl} alt={p.name} className="w-12 h-12 rounded-lg object-cover flex-shrink-0 border" />
                              : <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center flex-shrink-0"><Package className="w-5 h-5 text-muted-foreground" /></div>}
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-semibold leading-snug line-clamp-2 group-hover:text-amber-800">{p.name}</div>
                              <div className="text-[10px] font-mono text-blue-600 font-semibold">{p.code}</div>
                            </div>
                          </div>

                          {/* To Store balance */}
                          <div className="text-[10px] pb-1.5 border-b mb-1.5">
                            <div className="flex justify-between mb-0.5">
                              <span className="text-muted-foreground font-medium">Destination:</span>
                              <span className={`font-bold ${toQty === 0 ? "text-red-600" : "text-amber-600"}`}>
                                {isBranch
                                  ? `${toCtns} ctn${toCtns !== 1 ? "s" : ""} (${toQty} pcs)`
                                  : `${toQty} pcs`}
                              </span>
                            </div>
                          </div>

                          {/* Other Branch stores — excluding To Store */}
                          {otherBranchStores.length > 0 && (
                            <div className="mb-1">
                              <div className="text-[9px] font-bold text-purple-600 uppercase tracking-wide mb-0.5">Branch Stores</div>
                              {otherBranchStores.map(s => {
                                const qty = allStoresStockMap[s.id]?.[p.id] ?? 0;
                                const ctns = Math.floor(qty / qpc);
                                const isLow = qty <= 2 * qpc;
                                return (
                                  <div key={s.id} className="flex justify-between text-[10px]">
                                    <span className={`truncate max-w-[60%] ${s.id === fromStoreId ? "font-bold text-foreground" : "text-muted-foreground"}`}>
                                      {s.id === fromStoreId ? "▶ " : ""}{s.name}
                                    </span>
                                    <span className={`font-bold ${qty === 0 ? "text-red-500" : isLow ? "text-amber-600" : "text-green-600"}`}>
                                      {ctns} ctn{ctns !== 1 ? "s" : ""}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Other Shop stores — excluding To Store */}
                          {otherShopStores.length > 0 && (
                            <div className="mb-1">
                              <div className="text-[9px] font-bold text-indigo-600 uppercase tracking-wide mb-0.5">Shop Stores</div>
                              {otherShopStores.map(s => {
                                const qty = allStoresStockMap[s.id]?.[p.id] ?? 0;
                                const isLow = qty <= 24;
                                return (
                                  <div key={s.id} className="flex justify-between text-[10px]">
                                    <span className={`truncate max-w-[60%] ${s.id === fromStoreId ? "font-bold text-foreground" : "text-muted-foreground"}`}>
                                      {s.id === fromStoreId ? "▶ " : ""}{s.name}
                                    </span>
                                    <span className={`font-bold ${qty === 0 ? "text-red-500" : isLow ? "text-amber-600" : "text-green-600"}`}>
                                      {qty} pcs
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          <div className="flex flex-wrap gap-1 mt-1">
                            {hasPending && <span className="text-[9px] bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded-full font-semibold">Pending Request</span>}
                            <span className="text-[9px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full font-semibold group-hover:bg-amber-100 group-hover:text-amber-700">+ Add to Request</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            <div className="relative">
              <Label>Add Products</Label>
              <div className="relative mt-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder="Search by name or code…" value={productSearch} onChange={e => setProductSearch(e.target.value)} className="pl-9" disabled={!fromStoreId || !toStoreId} />
              </div>
              {productSearch && filteredProducts.length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-card border rounded-lg shadow-lg max-h-64 overflow-y-auto">
                  {filteredProducts.map(p => {
                    const fromQty = stockMap[fromStoreId]?.[p.id] ?? "…";
                    const toQty = stockMap[toStoreId]?.[p.id] ?? "…";
                    return (
                      <button key={p.id} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted/50 text-left" onClick={() => addProduct(p)}>
                        {p.photoUrl ? <img src={p.photoUrl} alt={p.name} className="w-8 h-8 rounded object-cover flex-shrink-0" /> : <div className="w-8 h-8 bg-muted rounded flex items-center justify-center flex-shrink-0"><Package className="w-4 h-4 text-muted-foreground" /></div>}
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">{p.name}</div>
                          <div className="text-xs text-muted-foreground">{p.code} · From: {fromQty} pcs · To: {toQty} pcs</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {items.length > 0 && (
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2">Product</th>
                      <th className="text-left px-3 py-2">Avail. (From)</th>
                      <th className="text-left px-3 py-2">Avail. (To)</th>
                      <th className="text-center px-3 py-2">By Carton</th>
                      <th className="text-left px-3 py-2">Quantity</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {items.map((it, idx) => {
                      const actualQty = it.sellByCarton ? it.quantity * it.quantityPerCarton : it.quantity;
                      const overStock = actualQty > it.availableQtyFrom;
                      return (
                        <tr key={it.productId} className={overStock ? "bg-red-50" : ""}>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              {it.photoUrl ? <img src={it.photoUrl} alt={it.productName} className="w-8 h-8 rounded object-cover" /> : <div className="w-8 h-8 bg-muted rounded flex items-center justify-center"><Package className="w-4 h-4 text-muted-foreground" /></div>}
                              <div>
                                <div className="font-medium text-xs">{it.productName}</div>
                                <div className="text-xs text-muted-foreground">{it.productCode}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-xs">{it.availableQtyFrom} pcs</td>
                          <td className="px-3 py-2 text-xs">{it.availableQtyTo} pcs</td>
                          <td className="px-3 py-2 text-center">
                            {it.quantityPerCarton > 1 && <input type="checkbox" checked={it.sellByCarton} onChange={() => toggleCarton(idx)} className="rounded" />}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-col gap-0.5">
                              <Input type="number" min={1} value={it.quantity} onChange={e => updateQty(idx, Number(e.target.value))} className="w-20 h-7 text-xs" />
                              {it.sellByCarton && <span className="text-xs text-muted-foreground">{actualQty} pcs total</span>}
                              {overStock && <span className="text-xs text-red-600 font-medium">Over stock!</span>}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <Button size="sm" variant="ghost" onClick={() => removeItem(idx)}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div>
              <Label>Remark (optional)</Label>
              <Input value={remark} onChange={e => setRemark(e.target.value)} placeholder="Notes…" className="mt-1" />
            </div>
            <div>
              <Label>Date</Label>
              <Input type="date" value={voucherDate} onChange={e => setVoucherDate(e.target.value)} className="mt-1" data-testid="input-voucher-date" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowForm(false); resetForm(); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : editingRequest ? "Update Request" : "Save Request"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Voucher Dialog */}
      {showVoucher && (
        <Dialog open onOpenChange={() => setShowVoucher(null)}>
          <DialogContent className="max-h-[90vh] overflow-y-auto max-w-2xl">
            <DialogHeader><DialogTitle>Request Voucher</DialogTitle></DialogHeader>
            <div ref={receiptRef} className="receipt-a4 space-y-4 p-4 text-sm">
              <div className="text-center border-b pb-4">
                <h2 className="text-xl font-bold">STORE REQUEST VOUCHER</h2>
                <p className="text-sm font-mono text-primary">{showVoucher.voucherId}</p>
                <p className="text-xs text-muted-foreground">{fmtDate(showVoucher.createdAt)}</p>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><span className="font-semibold">From Store:</span><div>{showVoucher.fromStoreName}</div></div>
                <div><span className="font-semibold">To Store:</span><div>{showVoucher.toStoreName}</div></div>
                <div><span className="font-semibold">Created By:</span><div>{showVoucher.createdByName || "—"}</div></div>
                <div>
                  <span className="font-semibold">Status:</span>
                  <div><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusColor[showVoucher.status] || ""}`}>{showVoucher.status}</span></div>
                </div>
              </div>

              {showVoucher.remark && (
                <div className="text-sm"><span className="font-semibold">Remark:</span> {showVoucher.remark}</div>
              )}
              <div className="text-sm"><span className="font-semibold">Date:</span> {showVoucher.voucherDate || fmtDate(showVoucher.createdAt)}</div>

              <table className="w-full text-sm border rounded-lg overflow-hidden">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2">Product</th>
                    <th className="text-left px-3 py-2">Code</th>
                    <th className="text-right px-3 py-2">From Bal.</th>
                    <th className="text-right px-3 py-2">Quantity</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {showVoucher.items.map((it, i) => {
                    const actualQty = it.sellByCarton ? it.quantity * it.quantityPerCarton : it.quantity;
                    const display = it.sellByCarton ? `${it.quantity} ctn (${actualQty} pcs)` : `${it.quantity} pcs`;
                    return (
                      <tr key={i}>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            {it.photoUrl ? <img src={it.photoUrl} alt={it.productName} className="w-8 h-8 rounded object-cover" /> : <div className="w-8 h-8 bg-muted rounded flex items-center justify-center"><Package className="w-4 h-4 text-muted-foreground" /></div>}
                            <span className="font-medium">{it.productName}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{it.productCode}</td>
                        <td className="px-3 py-2 text-right text-xs">{it.availableQtyFrom} pcs</td>
                        <td className="px-3 py-2 text-right font-semibold">{display}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Receipt Footer with actions */}
              <div className="border-t pt-4 mt-4 space-y-1 text-xs text-muted-foreground">
                <div className="flex justify-between"><span>Requested by:</span><span className="font-medium text-foreground">{showVoucher.createdByName || "—"}</span></div>
                {showVoucher.approvedBy && <div className="flex justify-between"><span>Approved by:</span><span className="font-medium text-foreground">{showVoucher.approvedBy}</span></div>}
                {showVoucher.receivedBy && <div className="flex justify-between"><span>Received by:</span><span className="font-medium text-foreground">{showVoucher.receivedBy} · {showVoucher.receivedAt ? fmtDate(showVoucher.receivedAt) : ""}</span></div>}
                <div className="flex justify-between mt-2"><span>Page 1 of 1</span><span>{fmtDate(showVoucher.createdAt)}</span></div>
              </div>
            </div>
            <DialogFooter className="gap-2">
              {isAdmin && showVoucher.status === "pending" && (
                <Button variant="outline" className="text-blue-600 border-blue-200" onClick={() => { handleApprove(showVoucher); setShowVoucher(null); }}>
                  <CheckCircle className="w-4 h-4 mr-2" /> Approve
                </Button>
              )}
              {showVoucher.status === "approved" && (
                <Button variant="outline" className="text-green-600 border-green-200" onClick={() => handleReceive(showVoucher)}>
                  <PackageCheck className="w-4 h-4 mr-2" /> Mark Received
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
