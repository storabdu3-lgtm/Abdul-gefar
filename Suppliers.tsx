import { useState, useEffect, useRef } from "react";
import { Plus, Search, Truck, Edit, Trash2, DollarSign, Eye, Printer, Pencil, Share2, Ban, RotateCcw, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useDeleteAuth } from "@/hooks/useDeleteAuth";
import { getAll, create, update, remove, COLLECTIONS } from "@/lib/firestore";
import { uploadImage } from "@/lib/cloudinary";
import { fmt } from "@/lib/currency";
import type { Supplier, SupplierPayment } from "@/lib/types";
import { useReactToPrint } from "react-to-print";
import { shareAsImage, shareAsPdf } from "@/lib/shareImage";
import { useAuth } from "@/lib/auth";

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [payments, setPayments] = useState<SupplierPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showDialog, setShowDialog] = useState(false);
  const [showPayDialog, setShowPayDialog] = useState<Supplier | null>(null);
  const [showVoucher, setShowVoucher] = useState<Supplier | null>(null);
  const [editSupplier, setEditSupplier] = useState<Supplier | null>(null);
  const [form, setForm] = useState({ name: "", address: "", phone: "", beginningBalance: 0, beginningDate: "", beginningPaid: 0, beginningPaidDate: "" });
  const [payForm, setPayForm] = useState({ amountPaid: 0, note: "", fsNumber: "", photoProofUrl: "", paymentDate: new Date().toISOString().slice(0, 10) });
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [paying, setPaying] = useState(false);
  const [editingPayment, setEditingPayment] = useState<SupplierPayment | null>(null);
  const [editPayForm, setEditPayForm] = useState({ amountPaid: 0, note: "", paymentDate: "" });
  const [paymentSearch, setPaymentSearch] = useState("");
  const { toast } = useToast();
  const [sharing, setSharing] = useState(false);
  const [sharingPdf, setSharingPdf] = useState(false);
  const { confirmDelete, DeleteAuthDialog } = useDeleteAuth();
  const { isAdmin } = useAuth();
  const voucherRef = useRef<HTMLDivElement>(null);
  const handlePrint = useReactToPrint({ contentRef: voucherRef });

  async function handleSharePdf() {
    if (!voucherRef.current) return;
    setSharingPdf(true);
    const r = await shareAsPdf(voucherRef.current, "supplier_voucher.pdf");
    if (r === "failed") toast({ title: "PDF share failed", variant: "destructive" });
    setSharingPdf(false);
  }

  async function handleVoidPayment(p: SupplierPayment) {
    await update(COLLECTIONS.SUPPLIER_PAYMENTS, p.id, { voided: !p.voided } as any);
    setPayments(prev => prev.map(x => x.id === p.id ? { ...x, voided: !p.voided } : x));
    toast({ title: p.voided ? "Payment activated" : "Payment voided" });
  }

  async function handleShare() {
    if (!voucherRef.current) return;
    setSharing(true);
    const r = await shareAsImage(voucherRef.current, "supplier_payment.png");
    if (r === "failed") toast({ title: "Share failed", variant: "destructive" });
    setSharing(false);
  }

  async function loadData() {
    setLoading(true);
    const [sups, pays] = await Promise.all([
      getAll<Supplier>(COLLECTIONS.SUPPLIERS),
      getAll<SupplierPayment>(COLLECTIONS.SUPPLIER_PAYMENTS)
    ]);
    setSuppliers(sups.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))));
    setPayments(pays);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  const filtered = suppliers.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.phone.includes(search)
  );

  function openAdd() {
    setEditSupplier(null);
    setForm({ name: "", address: "", phone: "", beginningBalance: 0, beginningDate: "", beginningPaid: 0, beginningPaidDate: "" });
    setShowDialog(true);
  }

  function openEdit(s: Supplier) {
    setEditSupplier(s);
    setForm({ name: s.name, address: s.address, phone: s.phone, beginningBalance: 0, beginningDate: "", beginningPaid: 0, beginningPaidDate: "" });
    setShowDialog(true);
  }

  async function handleSave() {
    if (!form.name) { toast({ title: "Name required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      if (editSupplier) {
        const { beginningBalance, beginningDate, beginningPaid, beginningPaidDate, ...basic } = form;
        await update(COLLECTIONS.SUPPLIERS, editSupplier.id, basic);
        toast({ title: "Supplier updated" });
      } else {
        const bPaid = form.beginningPaid || 0;
        const bBal = form.beginningBalance || 0;
        await create(COLLECTIONS.SUPPLIERS, {
          ...form,
          totalPaid: bPaid,
          totalBalance: bBal - bPaid,
          beginningBalance: bBal,
          beginningDate: form.beginningDate || "",
          beginningPaid: bPaid,
          beginningPaidDate: form.beginningPaidDate || "",
        });
        toast({ title: "Supplier added" });
      }
      setShowDialog(false);
      loadData();
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(s: Supplier) {
    confirmDelete(async () => {
      await remove(COLLECTIONS.SUPPLIERS, s.id);
      toast({ title: "Supplier deleted" });
      loadData();
    });
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadImage(file, "payments");
      setPayForm(f => ({ ...f, photoProofUrl: url }));
    } catch { toast({ title: "Upload failed", variant: "destructive" }); }
    finally { setUploading(false); }
  }

  async function handlePayment() {
    if (!showPayDialog || !payForm.amountPaid || payForm.amountPaid <= 0) {
      toast({ title: "Enter a valid payment amount", variant: "destructive" });
      return;
    }
    if (payForm.fsNumber) {
      const [existingSupp, existingCust] = await Promise.all([
        getAll<SupplierPayment>(COLLECTIONS.SUPPLIER_PAYMENTS),
        getAll<{ fsNumber?: string }>(COLLECTIONS.CUSTOMER_PAYMENTS),
      ]);
      const isDuplicate =
        existingSupp.some(p => p.fsNumber === payForm.fsNumber) ||
        existingCust.some(p => p.fsNumber === payForm.fsNumber);
      if (isDuplicate) {
        toast({ title: `FS Number "${payForm.fsNumber}" already exists`, description: "Each payment must have a unique FS Number.", variant: "destructive" });
        return;
      }
    }
    setPaying(true);
    try {
      const newPaid = (showPayDialog.totalPaid || 0) + payForm.amountPaid;
      const newBalance = Math.max(0, (showPayDialog.totalBalance || 0) - payForm.amountPaid);
      await Promise.all([
        create(COLLECTIONS.SUPPLIER_PAYMENTS, {
          supplierId: showPayDialog.id,
          supplierName: showPayDialog.name,
          amountPaid: payForm.amountPaid,
          remainingBalance: newBalance,
          photoProofUrl: payForm.photoProofUrl,
          fsNumber: payForm.fsNumber,
          note: payForm.note,
          paymentDate: payForm.paymentDate,
        }),
        update(COLLECTIONS.SUPPLIERS, showPayDialog.id, { totalPaid: newPaid, totalBalance: newBalance })
      ]);
      toast({ title: "Payment recorded" });
      setShowPayDialog(null);
      setPayForm({ amountPaid: 0, note: "", fsNumber: "", photoProofUrl: "", paymentDate: new Date().toISOString().slice(0, 10) });
      loadData();
    } finally {
      setPaying(false);
    }
  }

  function handleDeletePayment(p: SupplierPayment, supplier: Supplier) {
    confirmDelete(async () => {
      try {
        await remove(COLLECTIONS.SUPPLIER_PAYMENTS, p.id);
        const newPaid = Math.max(0, (supplier.totalPaid || 0) - p.amountPaid);
        const newBalance = (supplier.totalBalance || 0) + p.amountPaid;
        await update(COLLECTIONS.SUPPLIERS, supplier.id, { totalPaid: newPaid, totalBalance: newBalance });
        toast({ title: "Payment deleted" });
        await loadData();
      } catch { toast({ title: "Failed", variant: "destructive" }); }
    });
  }

  async function handleSaveEditPayment(supplier: Supplier) {
    if (!editingPayment) return;
    const diff = editPayForm.amountPaid - editingPayment.amountPaid;
    const newPaid = (supplier.totalPaid || 0) + diff;
    const newBalance = Math.max(0, (supplier.totalBalance || 0) - diff);
    try {
      await update(COLLECTIONS.SUPPLIER_PAYMENTS, editingPayment.id, {
        amountPaid: editPayForm.amountPaid,
        note: editPayForm.note,
        paymentDate: editPayForm.paymentDate,
        remainingBalance: newBalance,
      });
      await update(COLLECTIONS.SUPPLIERS, supplier.id, { totalPaid: newPaid, totalBalance: newBalance });
      toast({ title: "Payment updated" });
      setEditingPayment(null);
      await loadData();
    } catch { toast({ title: "Failed", variant: "destructive" }); }
  }

  const getPayments = (sid: string) => payments.filter(p => p.supplierId === sid);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Suppliers</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage suppliers and payments</p>
        </div>
        <Button onClick={openAdd} data-testid="button-add-supplier">
          <Plus className="w-4 h-4 mr-2" /> Add Supplier
        </Button>
      </div>
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
        <Input className="pl-9" placeholder="Search suppliers..." value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search-suppliers" />
      </div>
      {loading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}</div>
      ) : (
        <div className="space-y-3">
          {filtered.map(s => (
            <Card key={s.id} data-testid={`card-supplier-${s.id}`}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Truck className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-base">{s.name}</CardTitle>
                    <p className="text-xs text-muted-foreground">{s.phone} · {s.address}</p>
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap justify-end">
                  <Button size="sm" variant="outline" onClick={() => { setShowPayDialog(s); setPayForm({ amountPaid: 0, note: "", fsNumber: "", photoProofUrl: "", paymentDate: new Date().toISOString().slice(0, 10) }); }} data-testid={`button-pay-${s.id}`}>
                    <DollarSign className="w-3 h-3 mr-1" /> Payment
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setShowVoucher(s); setPaymentSearch(""); }} data-testid={`button-view-${s.id}`}>
                    <Eye className="w-3 h-3 mr-1" /> Voucher
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openEdit(s)} data-testid={`button-edit-${s.id}`}><Edit className="w-3 h-3" /></Button>
                  <Button size="sm" variant="destructive" onClick={() => handleDelete(s)} data-testid={`button-delete-${s.id}`}><Trash2 className="w-3 h-3" /></Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex gap-6 text-sm">
                  <div><span className="text-muted-foreground">Total Paid: </span><span className="font-medium text-green-600">{fmt(s.totalPaid)}</span></div>
                  <div><span className="text-muted-foreground">Balance: </span><span className="font-medium text-red-500">{fmt(s.totalBalance)}</span></div>
                  <div><span className="text-muted-foreground">Payments: </span><span className="font-medium">{getPayments(s.id).length}</span></div>
                </div>
              </CardContent>
            </Card>
          ))}
          {filtered.length === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              <Truck className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No suppliers found</p>
            </div>
          )}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-md">
          <DialogHeader><DialogTitle>{editSupplier ? "Edit Supplier" : "Add Supplier"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Name *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} data-testid="input-supplier-name" /></div>
            <div><Label>Address</Label><Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} data-testid="input-supplier-address" /></div>
            <div><Label>Phone</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} data-testid="input-supplier-phone" /></div>
            {!editSupplier && (
              <>
                <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3 space-y-3">
                  <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Beginning Balance (optional)</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label className="text-xs">Balance Amount (ETB)</Label><Input type="number" min={0} step={0.01} value={form.beginningBalance || ""} onChange={e => setForm(f => ({ ...f, beginningBalance: Number(e.target.value) }))} className="mt-1 h-8" placeholder="0.00" /></div>
                    <div><Label className="text-xs">Balance Date</Label><Input type="date" value={form.beginningDate} onChange={e => setForm(f => ({ ...f, beginningDate: e.target.value }))} className="mt-1 h-8" /></div>
                  </div>
                </div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 space-y-3">
                  <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Beginning Amount Paid (optional)</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label className="text-xs">Amount Paid (ETB)</Label><Input type="number" min={0} step={0.01} value={form.beginningPaid || ""} onChange={e => setForm(f => ({ ...f, beginningPaid: Number(e.target.value) }))} className="mt-1 h-8" placeholder="0.00" /></div>
                    <div><Label className="text-xs">Payment Date</Label><Input type="date" value={form.beginningPaidDate} onChange={e => setForm(f => ({ ...f, beginningPaidDate: e.target.value }))} className="mt-1 h-8" /></div>
                  </div>
                  <p className="text-xs text-emerald-600">This will appear as the first payment entry in the supplier voucher.</p>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} data-testid="button-save-supplier">
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment Dialog */}
      <Dialog open={!!showPayDialog} onOpenChange={() => setShowPayDialog(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-md">
          <DialogHeader><DialogTitle>Record Payment — {showPayDialog?.name}</DialogTitle></DialogHeader>
          {showPayDialog && (
            <div className="space-y-4">
              <div className="bg-muted rounded-lg p-3 text-sm grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">Total Paid: </span><span className="font-medium text-green-600">{fmt(showPayDialog.totalPaid)}</span></div>
                <div><span className="text-muted-foreground">Balance: </span><span className="font-medium text-red-500">{fmt(showPayDialog.totalBalance)}</span></div>
              </div>
              <div><Label>Payment Date</Label><Input type="date" value={payForm.paymentDate} onChange={e => setPayForm(f => ({ ...f, paymentDate: e.target.value }))} data-testid="input-pay-date" /></div>
              <div><Label>Amount Paid (ETB)</Label><Input type="number" min={0} step={0.01} value={payForm.amountPaid} onChange={e => setPayForm(f => ({ ...f, amountPaid: Number(e.target.value) }))} data-testid="input-pay-amount" /></div>
              <div><Label>FS Number</Label><Input value={payForm.fsNumber} onChange={e => setPayForm(f => ({ ...f, fsNumber: e.target.value }))} placeholder="Fiscal Number (optional)" data-testid="input-pay-fs-number" /></div>
              <div><Label>Note</Label><Input value={payForm.note} onChange={e => setPayForm(f => ({ ...f, note: e.target.value }))} data-testid="input-pay-note" /></div>
              <div>
                <Label>Photo Proof</Label>
                <Input type="file" accept="image/*" onChange={handlePhotoUpload} />
                {uploading && <p className="text-xs text-muted-foreground mt-1">Uploading...</p>}
                {payForm.photoProofUrl && <img src={payForm.photoProofUrl} alt="Proof" className="mt-2 h-16 rounded" />}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPayDialog(null)} disabled={paying}>Cancel</Button>
            <Button onClick={handlePayment} disabled={paying || uploading} data-testid="button-confirm-payment">
              {paying ? "Recording..." : "Confirm Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Voucher Dialog */}
      <Dialog open={!!showVoucher} onOpenChange={() => setShowVoucher(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-lg">
          <DialogHeader><DialogTitle>Supplier Voucher</DialogTitle></DialogHeader>
          {showVoucher && (
            <div ref={voucherRef} className="bg-white overflow-hidden" style={{ fontFamily: "'Inter','Segoe UI',sans-serif", minWidth: 320, borderRadius: 12 }}>

              {/* ── Header ── */}
              <div style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e3a8a 60%, #1d4ed8 100%)", padding: "20px 20px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                  <div style={{ width: 42, height: 42, borderRadius: 10, background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Truck style={{ width: 22, height: 22, color: "#fff" }} />
                  </div>
                  <div>
                    <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 2 }}>Payment Statement</div>
                    <div style={{ color: "#fff", fontWeight: 800, fontSize: 19, letterSpacing: "-0.02em" }}>SUPPLIER VOUCHER</div>
                  </div>
                </div>
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.12)", paddingTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: "rgba(255,255,255,0.45)", fontSize: 10 }}>Generated {new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span>
                  <span style={{ background: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.85)", fontSize: 10, padding: "2px 10px", borderRadius: 20, letterSpacing: "0.04em" }}>OFFICIAL RECORD</span>
                </div>
              </div>

              {/* ── Contact Info ── */}
              <div style={{ padding: "14px 20px", borderBottom: "1px solid #e5e7eb" }}>
                {([["Name", showVoucher.name], ["Address", showVoucher.address], ["Phone", showVoucher.phone]] as [string, string][])
                  .filter(([, v]) => v)
                  .map(([k, v], idx, arr) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: idx < arr.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                      <span style={{ color: "#6b7280", fontSize: 12, fontWeight: 500 }}>{k}</span>
                      <span style={{ color: "#111827", fontSize: 12, fontWeight: 600 }}>{v}</span>
                    </div>
                  ))}
              </div>

              {/* ── Summary Cards ── */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, padding: "14px 20px", borderBottom: "1px solid #e5e7eb" }}>
                <div style={{ background: "linear-gradient(135deg, #065f46, #059669)", borderRadius: 10, padding: "13px 14px" }}>
                  <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 5 }}>Total Paid</div>
                  <div style={{ color: "#fff", fontSize: 16, fontWeight: 800, wordBreak: "break-word" }}>{fmt(showVoucher.totalPaid)}</div>
                </div>
                <div style={{ background: "linear-gradient(135deg, #7f1d1d, #dc2626)", borderRadius: 10, padding: "13px 14px" }}>
                  <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 5 }}>Outstanding</div>
                  <div style={{ color: "#fff", fontSize: 16, fontWeight: 800, wordBreak: "break-word" }}>{fmt(showVoucher.totalBalance)}</div>
                </div>
              </div>

              {/* ── Payment History ── */}
              <div style={{ padding: "0 20px 20px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 0 8px" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>Payment History</div>
                  <Input
                    placeholder="Search by date, amount or note..."
                    value={paymentSearch}
                    onChange={e => setPaymentSearch(e.target.value)}
                    className="h-7 text-xs w-48 no-print"
                  />
                </div>
                {(() => {
                  const payments = getPayments(showVoucher.id);
                  const hasBegBal = (showVoucher.beginningBalance || 0) > 0;
                  const hasBegPaid = (showVoucher.beginningPaid || 0) > 0;
                  const hasAnyData = payments.length > 0 || hasBegBal || hasBegPaid;

                  if (!hasAnyData) {
                    return <div style={{ textAlign: "center", padding: "20px 0", color: "#9ca3af", fontSize: 13 }}>No payments recorded yet</div>;
                  }

                  const filtered = payments.filter(p => {
                    const q = paymentSearch.toLowerCase();
                    if (!q) return true;
                    return (
                      ((p as any).paymentDate || "").includes(q) ||
                      (p.note || "").toLowerCase().includes(q) ||
                      String(p.amountPaid).includes(q) ||
                      String(p.remainingBalance).includes(q)
                    );
                  });

                  return (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                      <thead>
                        <tr style={{ background: "#f1f5f9" }}>
                          {["Date", "Amount Paid", "FS #", "Note", "Balance", ""].map(h => (
                            <th key={h} style={{ textAlign: h === "Balance" ? "right" : "left", padding: "8px 7px", color: "#475569", fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {hasBegBal && (
                          <tr style={{ background: "#eff6ff" }}>
                            <td style={{ padding: "8px 7px", color: "#6b7280", fontStyle: "italic" }}>{showVoucher.beginningDate || "—"}</td>
                            <td style={{ padding: "8px 7px", color: "#1d4ed8", fontWeight: 700 }}>—</td>
                            <td style={{ padding: "8px 7px", color: "#374151" }}>—</td>
                            <td style={{ padding: "8px 7px", color: "#1d4ed8", fontWeight: 600 }}>Opening Balance</td>
                            <td style={{ padding: "8px 7px", color: "#dc2626", fontWeight: 700, textAlign: "right" }}>{fmt(showVoucher.beginningBalance || 0)}</td>
                            <td></td>
                          </tr>
                        )}
                        {hasBegPaid && (
                          <tr style={{ background: "#f0fdf4" }}>
                            <td style={{ padding: "8px 7px", color: "#6b7280", fontStyle: "italic" }}>{showVoucher.beginningPaidDate || "—"}</td>
                            <td style={{ padding: "8px 7px", color: "#059669", fontWeight: 700 }}>{fmt(showVoucher.beginningPaid || 0)}</td>
                            <td style={{ padding: "8px 7px", color: "#374151" }}>—</td>
                            <td style={{ padding: "8px 7px", color: "#059669", fontWeight: 600 }}>Opening Payment</td>
                            <td style={{ padding: "8px 7px", color: "#dc2626", fontWeight: 700, textAlign: "right" }}>{fmt((showVoucher.beginningBalance || 0) - (showVoucher.beginningPaid || 0))}</td>
                            <td></td>
                          </tr>
                        )}
                        {filtered.length === 0 && payments.length > 0 ? (
                          <tr><td colSpan={6} style={{ textAlign: "center", padding: "14px", color: "#9ca3af", fontSize: 12 }}>No payments match "{paymentSearch}"</td></tr>
                        ) : filtered.map((p, i) => (
                          <tr key={i} style={{ background: p.voided ? "#fef2f2" : i % 2 === 0 ? "#fff" : "#f9fafb", opacity: p.voided ? 0.7 : 1 }}>
                            <td style={{ padding: "8px 7px", color: "#6b7280", textDecoration: p.voided ? "line-through" : "none" }}>{(p as any).paymentDate || "—"}</td>
                            <td style={{ padding: "8px 7px", color: p.voided ? "#9ca3af" : "#059669", fontWeight: 700, textDecoration: p.voided ? "line-through" : "none" }}>
                              {fmt(p.amountPaid)}
                              {p.voided && <span style={{ marginLeft: 4, fontSize: 8, fontWeight: 700, background: "#dc2626", color: "#fff", padding: "1px 5px", borderRadius: 4, textDecoration: "none", verticalAlign: "middle" }}>VOID</span>}
                            </td>
                            <td style={{ padding: "8px 7px", color: "#374151", textDecoration: p.voided ? "line-through" : "none" }}>{(p as any).fsNumber || "—"}</td>
                            <td style={{ padding: "8px 7px", color: "#6b7280", maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: p.voided ? "line-through" : "none" }}>{p.note || "—"}</td>
                            <td style={{ padding: "8px 7px", color: p.voided ? "#9ca3af" : "#dc2626", fontWeight: 700, textAlign: "right", textDecoration: p.voided ? "line-through" : "none" }}>{fmt(p.remainingBalance)}</td>
                            <td style={{ padding: "8px 7px", textAlign: "right", whiteSpace: "nowrap" }} className="no-print">
                              {(p as any).photoProofUrl && (
                                <button className="text-emerald-600 hover:text-emerald-800 mr-1" title="View Photo Proof" onClick={() => window.open((p as any).photoProofUrl, "_blank")}><Eye className="w-3 h-3 inline" /></button>
                              )}
                              {!p.voided && <button className="text-blue-500 hover:text-blue-700 mr-1" title="Edit" onClick={() => { setEditingPayment(p); setEditPayForm({ amountPaid: p.amountPaid, note: p.note || "", paymentDate: (p as any).paymentDate || "" }); }}><Pencil className="w-3 h-3 inline" /></button>}
                              <button className="text-red-500 hover:text-red-700 mr-1" title="Delete" onClick={() => handleDeletePayment(p, showVoucher)}><Trash2 className="w-3 h-3 inline" /></button>
                              {isAdmin && (
                                p.voided
                                  ? <button className="text-green-600 hover:text-green-800" title="Activate payment" onClick={() => handleVoidPayment(p)}><RotateCcw className="w-3 h-3 inline" /></button>
                                  : <button className="text-orange-500 hover:text-orange-700" title="Void payment" onClick={() => handleVoidPayment(p)}><Ban className="w-3 h-3 inline" /></button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  );
                })()}
              </div>

              {/* ── Footer ── */}
              <div style={{ background: "#f8fafc", borderTop: "1px solid #e5e7eb", padding: "10px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "#9ca3af", fontSize: 10 }}>Computer-generated document · No signature required</span>
                <span style={{ color: "#9ca3af", fontSize: 10 }}>{new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            </div>
          )}
          {editingPayment && showVoucher && (
            <div className="border rounded p-3 space-y-2 bg-muted/30 mx-4">
              <h4 className="text-sm font-semibold">Edit Payment</h4>
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-xs">Amount</Label><Input type="number" value={editPayForm.amountPaid} onChange={e => setEditPayForm(f => ({ ...f, amountPaid: parseFloat(e.target.value) || 0 }))} className="h-8" /></div>
                <div><Label className="text-xs">Date</Label><Input type="date" value={editPayForm.paymentDate} onChange={e => setEditPayForm(f => ({ ...f, paymentDate: e.target.value }))} className="h-8" /></div>
              </div>
              <div><Label className="text-xs">Note</Label><Input value={editPayForm.note} onChange={e => setEditPayForm(f => ({ ...f, note: e.target.value }))} className="h-8" /></div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => handleSaveEditPayment(showVoucher)}>Save</Button>
                <Button size="sm" variant="outline" onClick={() => setEditingPayment(null)}>Cancel</Button>
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
