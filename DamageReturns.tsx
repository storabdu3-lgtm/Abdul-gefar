import { useState, useEffect, useRef } from "react";
import { fmt } from "@/lib/currency";
import { Plus, Search, Eye, Printer, Trash2, Share2, Pencil, CheckCircle, FileText } from "lucide-react";
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
import type { Product, Store, DamageReturn, DamageReturnItem } from "@/lib/types";
import { useReactToPrint } from "react-to-print";

export default function DamageReturns() {
  const [records, setRecords] = useState<DamageReturn[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showVoucher, setShowVoucher] = useState<DamageReturn | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ storeId: "", type: "damage" as "damage" | "return", voucherDate: new Date().toISOString().slice(0, 10) });
  const [items, setItems] = useState<DamageReturnItem[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const [sharing, setSharing] = useState(false);
  const { confirmDelete, DeleteAuthDialog } = useDeleteAuth();
  const { user, isAdmin } = useAuth();
  const receiptRef = useRef<HTMLDivElement>(null);

  async function loadData() {
    setLoading(true);
    const [recs, prods, sts] = await Promise.all([
      getAll<DamageReturn>(COLLECTIONS.DAMAGE_RETURNS),
      getAll<Product>(COLLECTIONS.PRODUCTS),
      getAll<Store>(COLLECTIONS.STORES),
    ]);
    setRecords(recs.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))));
    setProducts(prods);
    setStores(sts);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  const filtered = records.filter(r =>
    r.voucherId?.toLowerCase().includes(search.toLowerCase()) ||
    r.storeName?.toLowerCase().includes(search.toLowerCase())
  );

  function resetForm() {
    setEditingId(null);
    setForm({ storeId: "", type: "damage", voucherDate: new Date().toISOString().slice(0, 10) });
    setItems([]);
    setProductSearch("");
  }

  function openNew() { resetForm(); setShowForm(true); }

  function openEdit(rec: DamageReturn) {
    setEditingId(rec.id);
    setForm({ storeId: rec.storeId, type: rec.type, voucherDate: rec.voucherDate || new Date().toISOString().slice(0, 10) });
    setItems((rec.items || []).map(i => ({ ...i })));
    setProductSearch("");
    setShowForm(true);
  }

  function addProduct(prod: Product) {
    if (items.find(i => i.productId === prod.id)) { toast({ title: "Already added" }); return; }
    setItems(prev => [...prev, {
      productId: prod.id, productName: prod.name, productCode: prod.code,
      sellBySingle: true, quantity: 1, unitPrice: 0, totalPrice: 0, reason: ""
    }]);
    setProductSearch("");
  }

  function updateItem(idx: number, field: string, value: number | boolean | string) {
    setItems(prev => {
      const updated = [...prev];
      const item = { ...updated[idx], [field]: value };
      item.totalPrice = item.unitPrice * (typeof item.quantity === "number" ? item.quantity : 1);
      updated[idx] = item;
      return updated;
    });
  }

  const totalAmount = items.reduce((s, i) => s + i.totalPrice, 0);

  async function handleSave() {
    setSaving(true);
    try {
      if (!form.storeId || items.length === 0) {
        toast({ title: "Select a store and add products", variant: "destructive" }); return;
      }
      if (items.some(i => i.quantity <= 0)) {
        toast({ title: "All quantities must be greater than zero", variant: "destructive" }); return;
      }
      if (items.some(i => i.unitPrice < 0)) {
        toast({ title: "Prices cannot be negative", variant: "destructive" }); return;
      }
      const store = stores.find(s => s.id === form.storeId);
      if (editingId) {
        await update(COLLECTIONS.DAMAGE_RETURNS, editingId, {
          storeId: form.storeId,
          storeName: store?.name || "",
          type: form.type,
          items,
          totalAmount,
          voucherDate: form.voucherDate,
        } as Record<string, unknown>);
        toast({ title: `${form.type === "damage" ? "Damage" : "Return"} updated` });
      } else {
        await create(COLLECTIONS.DAMAGE_RETURNS, {
          voucherId: await generateSerialVoucherId("DMG"),
          storeId: form.storeId,
          storeName: store?.name || "",
          type: form.type,
          items,
          totalAmount,
          voucherDate: form.voucherDate,
          status: isAdmin ? "active" : "pending",
          createdByName: user?.name || "",
        });
        toast({ title: isAdmin ? `${form.type === "damage" ? "Damage" : "Return"} registered` : "Submitted for admin approval" });
      }
      setShowForm(false);
      resetForm();
      loadData();
    } finally {
      setSaving(false);
    }
  }

  async function handleApprove(rec: DamageReturn) {
    await update(COLLECTIONS.DAMAGE_RETURNS, rec.id, { status: "active" });
    toast({ title: `${rec.type === "damage" ? "Damage" : "Return"} approved` });
    loadData();
  }

  function handleDelete(rec: DamageReturn) {
    confirmDelete(async () => {
      await remove(COLLECTIONS.DAMAGE_RETURNS, rec.id);
      toast({ title: "Record deleted" });
      loadData();
    });
  }

  const handlePrint = useReactToPrint({ contentRef: receiptRef });
  const [sharingPdf, setSharingPdf] = useState(false);
  async function handleShare() {
    if (!receiptRef.current) return;
    setSharing(true);
    const r = await shareAsImage(receiptRef.current, "damage_return_receipt.png");
    if (r === "failed") toast({ title: "Share failed", variant: "destructive" });
    setSharing(false);
  }
  async function handleSharePdf() {
    if (!receiptRef.current) return;
    setSharingPdf(true);
    const r = await shareAsPdf(receiptRef.current, "damage_return_receipt.pdf");
    if (r === "failed") toast({ title: "PDF share failed", variant: "destructive" });
    setSharingPdf(false);
  }
  const productResults = products.filter(p =>
    productSearch && (p.name.toLowerCase().includes(productSearch.toLowerCase()) || p.code.toLowerCase().includes(productSearch.toLowerCase()))
  ).slice(0, 5);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Damage / Returns</h1>
          <p className="text-muted-foreground text-sm">Register damaged or returned goods</p>
        </div>
        <Button onClick={openNew} data-testid="button-new-damage"><Plus className="w-4 h-4 mr-2" /> New Record</Button>
      </div>
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
        <Input className="pl-9" placeholder="Search records..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      {loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 rounded" />)}</div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>{["Voucher", "Date", "Store", "Type", "Items", "Total Amount", "Status", "Actions"].map(h => (
                <th key={h} className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(r => (
                <tr key={r.id} className="hover:bg-muted/30" data-testid={`row-damage-${r.id}`}>
                  <td className="px-4 py-2 font-mono text-xs">{r.voucherId}</td>
                  <td className="px-4 py-2 text-xs">{r.voucherDate || "—"}</td>
                  <td className="px-4 py-2">{r.storeName}</td>
                  <td className="px-4 py-2"><Badge variant={r.type === "damage" ? "destructive" : "secondary"} className="capitalize">{r.type}</Badge></td>
                  <td className="px-4 py-2">{r.items?.length || 0}</td>
                  <td className="px-4 py-2">{fmt(r.totalAmount)}</td>
                  <td className="px-4 py-2">
                    <Badge
                      variant={r.status === "active" ? "default" : r.status === "pending" ? "outline" : "destructive"}
                      className={r.status === "pending" ? "border-amber-500 text-amber-600 bg-amber-50" : ""}
                    >{r.status}</Badge>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => setShowVoucher(r)} title="View" data-testid={`button-view-${r.id}`}>
                        <Eye className="w-3 h-3" />
                      </Button>
                      {isAdmin && r.status === "pending" && (
                        <Button size="sm" variant="outline" className="text-emerald-600 border-emerald-400 hover:bg-emerald-50" onClick={() => handleApprove(r)} title="Approve" data-testid={`button-approve-${r.id}`}>
                          <CheckCircle className="w-3 h-3" />
                        </Button>
                      )}
                      {r.status === "active" && (
                        <Button size="sm" variant="outline" onClick={() => openEdit(r)} title="Edit" data-testid={`button-edit-${r.id}`}>
                          <Pencil className="w-3 h-3" />
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => handleDelete(r)} title="Delete" data-testid={`button-delete-${r.id}`}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={7} className="text-center py-10 text-muted-foreground">No records found</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* New / Edit Dialog */}
      <Dialog open={showForm} onOpenChange={open => { if (!open) { setShowForm(false); resetForm(); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Damage / Return" : "New Damage / Return"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Store *</Label>
                <Select value={form.storeId} onValueChange={v => setForm(f => ({ ...f, storeId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select store" /></SelectTrigger>
                  <SelectContent>{stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Type</Label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v as "damage" | "return" }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="damage">Damage</SelectItem>
                    <SelectItem value="return">Return</SelectItem>
                  </SelectContent>
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
                  <Input placeholder="Search products..." value={productSearch} onChange={e => setProductSearch(e.target.value)} />
                  {productResults.length > 0 && (
                    <div className="absolute z-10 top-full left-0 right-0 bg-card border rounded-b shadow-lg">
                      {productResults.map(p => (
                        <div key={p.id} className="px-4 py-2 hover:bg-muted cursor-pointer text-sm" onClick={() => addProduct(p)}>
                          {p.name} <span className="text-muted-foreground text-xs">({p.code})</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

            {items.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>{["Product", "By Single", "Qty", "Unit Price", "Total", "Reason", ""].map(h => (
                      <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody className="divide-y">
                    {items.map((item, idx) => (
                      <tr key={idx}>
                        <td className="px-3 py-2">{item.productName}</td>
                        <td className="px-3 py-2">
                          <input type="checkbox" checked={item.sellBySingle} onChange={e => updateItem(idx, "sellBySingle", e.target.checked)} />
                        </td>
                        <td className="px-3 py-2">
                          <Input type="number" min={1} className="w-16 h-6 text-xs" value={item.quantity} onChange={e => updateItem(idx, "quantity", Number(e.target.value))} />
                        </td>
                        <td className="px-3 py-2">
                          <Input type="number" min={0} step={0.01} className="w-20 h-6 text-xs" value={item.unitPrice} onChange={e => updateItem(idx, "unitPrice", Number(e.target.value))} />
                        </td>
                        <td className="px-3 py-2 font-medium">${item.totalPrice.toFixed(2)}</td>
                        <td className="px-3 py-2">
                          <Input className="w-28 h-6 text-xs" value={item.reason || ""} onChange={e => updateItem(idx, "reason", e.target.value)} placeholder="Reason" />
                        </td>
                        <td className="px-3 py-2">
                          <Button size="sm" variant="ghost" onClick={() => setItems(prev => prev.filter((_, i) => i !== idx))}>
                            <Trash2 className="w-3 h-3 text-destructive" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted/30 font-semibold">
                    <tr>
                      <td colSpan={4} className="px-3 py-2 text-xs">Total</td>
                      <td className="px-3 py-2 text-xs">${totalAmount.toFixed(2)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowForm(false); resetForm(); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} data-testid="button-save-damage">
              {saving ? "Saving…" : editingId ? "Save Changes" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Receipt Dialog */}
      <Dialog open={!!showVoucher} onOpenChange={() => setShowVoucher(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-xl">
          <DialogHeader><DialogTitle>Damage/Return Receipt</DialogTitle></DialogHeader>
          {showVoucher && (
            <div ref={receiptRef} className="receipt-a4 p-4 space-y-4">
              <div className="text-center border-b pb-3">
                <h2 className="text-xl font-bold">{showVoucher.type === "damage" ? "DAMAGE" : "RETURN"} VOUCHER</h2>
                <p className="text-sm text-muted-foreground">ID: {showVoucher.voucherId}</p>
              </div>
              <div className="text-sm"><span className="text-muted-foreground">Store: </span>{showVoucher.storeName}</div>
              <div className="text-sm"><span className="text-muted-foreground">Date: </span>{showVoucher.voucherDate || "—"}</div>
              <table className="w-full text-sm border-collapse border">
                <thead><tr className="bg-muted">{["Product", "Qty", "Unit Price", "Total", "Reason"].map(h => <th key={h} className="border px-2 py-1 text-xs text-left">{h}</th>)}</tr></thead>
                <tbody>{showVoucher.items?.map((item, i) => (
                  <tr key={i}>
                    <td className="border px-2 py-1 text-xs">{item.productName}</td>
                    <td className="border px-2 py-1 text-xs text-center">{item.quantity}</td>
                    <td className="border px-2 py-1 text-xs">${item.unitPrice.toFixed(2)}</td>
                    <td className="border px-2 py-1 text-xs font-medium">${item.totalPrice.toFixed(2)}</td>
                    <td className="border px-2 py-1 text-xs">{item.reason || "—"}</td>
                  </tr>
                ))}</tbody>
              </table>
              <div className="flex justify-end text-sm font-bold">Total: ${showVoucher.totalAmount?.toFixed(2)}</div>
              <div className="border-t pt-3 mt-2 space-y-1 text-xs text-muted-foreground">
                <div className="flex justify-between"><span>Reported by:</span><span className="font-medium text-foreground">{showVoucher.storeName}</span></div>
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
