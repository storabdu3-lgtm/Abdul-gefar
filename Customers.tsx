import { useState, useEffect, useRef } from "react";
import { fmt } from "@/lib/currency";
import { Plus, Search, Users, Edit, Trash2, Eye, Printer, DollarSign, Pencil, Share2, Ban, RotateCcw, FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useDeleteAuth } from "@/hooks/useDeleteAuth";
import { getAll, create, update, remove, COLLECTIONS, generateVoucherId, generateSerialVoucherId } from "@/lib/firestore";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { uploadImage } from "@/lib/cloudinary";
import type { Customer, CustomerPayment, Supplier, Account, AccountVoucher } from "@/lib/types";
import { useReactToPrint } from "react-to-print";
import { shareAsImage, shareAsPdf } from "@/lib/shareImage";
import { useAuth } from "@/lib/auth";

export default function Customers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [payments, setPayments] = useState<CustomerPayment[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showDialog, setShowDialog] = useState(false);
  const [showVoucher, setShowVoucher] = useState<Customer | null>(null);
  const [showPayDialog, setShowPayDialog] = useState<Customer | null>(null);
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null);
  const [form, setForm] = useState({ name: "", address: "", phone: "", beginningBalance: 0, beginningDate: "", beginningNote: "", beginningPhotoUrl: "" });
  const [beginningUploading, setBeginningUploading] = useState(false);
  const beginningPhotoRef = useRef<HTMLInputElement>(null);
  const [payForm, setPayForm] = useState({ amountPaid: 0, note: "", fsNumber: "", photoProofUrl: "", paymentDate: new Date().toISOString().slice(0, 10), payVia: "none" as "none" | "supplier" | "account", supplierId: "", accountId: "" });
  const [saving, setSaving] = useState(false);
  const [paying, setPaying] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editingPayment, setEditingPayment] = useState<CustomerPayment | null>(null);
  const [editPayForm, setEditPayForm] = useState({ amountPaid: 0, note: "", paymentDate: "" });
  const [paymentSearch, setPaymentSearch] = useState("");
  const { toast } = useToast();
  const [sharing, setSharing] = useState(false);
  const [sharingPdf, setSharingPdf] = useState(false);
  const { confirmDelete, DeleteAuthDialog } = useDeleteAuth();
  const { isAdmin } = useAuth();
  const voucherRef = useRef<HTMLDivElement>(null);
  const handlePrint = useReactToPrint({ contentRef: voucherRef });

  const [showBalancePopup, setShowBalancePopup] = useState(true);
  const [popupExpanded, setPopupExpanded] = useState(true);

  const customersWithBalance = customers
    .filter(c => (c.totalBalance || 0) > 0)
    .sort((a, b) => (b.totalBalance || 0) - (a.totalBalance || 0));

  async function handleSharePdf() {
    if (!voucherRef.current) return;
    setSharingPdf(true);
    const r = await shareAsPdf(voucherRef.current, "customer_voucher.pdf");
    if (r === "failed") toast({ title: "PDF share failed", variant: "destructive" });
    setSharingPdf(false);
  }

  async function handleVoidPayment(p: CustomerPayment) {
    await update(COLLECTIONS.CUSTOMER_PAYMENTS, p.id, { voided: !p.voided } as any);
    setPayments(prev => prev.map(x => x.id === p.id ? { ...x, voided: !p.voided } : x));
    toast({ title: p.voided ? "Payment activated" : "Payment voided" });
  }

  async function handleShare() {
    if (!voucherRef.current) return;
    setSharing(true);
    const r = await shareAsImage(voucherRef.current, "customer_payment.png");
    if (r === "failed") toast({ title: "Share failed", variant: "destructive" });
    setSharing(false);
  }

  async function loadData() {
    setLoading(true);
    const [custs, pays, sups, accs] = await Promise.all([
      getAll<Customer>(COLLECTIONS.CUSTOMERS),
      getAll<CustomerPayment>(COLLECTIONS.CUSTOMER_PAYMENTS),
      getAll<Supplier>(COLLECTIONS.SUPPLIERS),
      getAll<Account>(COLLECTIONS.ACCOUNTS),
    ]);
    setCustomers(custs.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))));
    setPayments(pays);
    setSuppliers(sups);
    setAccounts(accs);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  const filtered = customers.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search)
  );

  function openAdd() {
    setEditCustomer(null);
    setForm({ name: "", address: "", phone: "", beginningBalance: 0, beginningDate: "", beginningNote: "", beginningPhotoUrl: "" });
    setShowDialog(true);
  }

  function openEdit(c: Customer) {
    setEditCustomer(c);
    setForm({ name: c.name, address: c.address, phone: c.phone, beginningBalance: 0, beginningDate: "", beginningNote: "", beginningPhotoUrl: "" });
    setShowDialog(true);
  }

  async function handleBeginningPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBeginningUploading(true);
    try {
      const url = await uploadImage(file, "beginning");
      setForm(f => ({ ...f, beginningPhotoUrl: url }));
    } catch {
      toast({ title: "Photo upload failed", variant: "destructive" });
    } finally {
      setBeginningUploading(false);
    }
  }

  async function handleSave() {
    if (!form.name) { toast({ title: "Name required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      if (editCustomer) {
        const { beginningBalance, beginningDate, beginningNote, beginningPhotoUrl, ...basic } = form;
        await update(COLLECTIONS.CUSTOMERS, editCustomer.id, basic);
        toast({ title: "Customer updated" });
      } else {
        await create(COLLECTIONS.CUSTOMERS, {
          ...form,
          totalPaid: 0,
          totalBalance: form.beginningBalance || 0,
          beginningBalance: form.beginningBalance || 0,
          beginningDate: form.beginningDate || "",
          beginningNote: form.beginningNote || "",
          beginningPhotoUrl: form.beginningPhotoUrl || "",
          voucherId: generateVoucherId("CUST"),
        });
        toast({ title: "Customer added" });
      }
      setShowDialog(false);
      loadData();
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(c: Customer) {
    confirmDelete(async () => {
      await remove(COLLECTIONS.CUSTOMERS, c.id);
      toast({ title: "Customer deleted" });
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
    } catch (err) {
      toast({ title: "Upload failed", description: String(err instanceof Error ? err.message : err), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  function resetPayForm() {
    setPayForm({ amountPaid: 0, note: "", fsNumber: "", photoProofUrl: "", paymentDate: new Date().toISOString().slice(0, 10), payVia: "none", supplierId: "", accountId: "" });
  }

  async function handlePayment() {
    if (!showPayDialog || !payForm.amountPaid || payForm.amountPaid <= 0) {
      toast({ title: "Enter a valid payment amount", variant: "destructive" });
      return;
    }
    if (payForm.fsNumber) {
      const [existingCust, existingSupp, existingAccVouchers] = await Promise.all([
        getAll<CustomerPayment>(COLLECTIONS.CUSTOMER_PAYMENTS),
        getAll<{ fsNumber?: string }>(COLLECTIONS.SUPPLIER_PAYMENTS),
        getAll<AccountVoucher>(COLLECTIONS.ACCOUNT_VOUCHERS),
      ]);
      const inCust = existingCust.some(p => p.fsNumber === payForm.fsNumber);
      const inSupp = existingSupp.some(p => p.fsNumber === payForm.fsNumber);
      const inAcc = existingAccVouchers.some(v => v.fsNumber === payForm.fsNumber && !v.isVoided);
      if (inCust || inSupp || inAcc) {
        const where = inCust ? "Customer Payments" : inSupp ? "Supplier Payments" : "Account Vouchers";
        toast({ title: `FS Number "${payForm.fsNumber}" already exists`, description: `Found in: ${where}`, variant: "destructive" });
        return;
      }
    }
    // Validate supplier/account selection
    const supplier = payForm.payVia === "supplier" ? suppliers.find(s => s.id === payForm.supplierId) : undefined;
    const account = payForm.payVia === "account" ? accounts.find(a => a.id === payForm.accountId) : undefined;
    if (payForm.payVia === "supplier" && !supplier) {
      toast({ title: "Please select a supplier", variant: "destructive" }); return;
    }
    if (payForm.payVia === "account" && !account) {
      toast({ title: "Please select an account", variant: "destructive" }); return;
    }
    setPaying(true);
    try {
      const newPaid = (showPayDialog.totalPaid || 0) + payForm.amountPaid;
      const newBalance = Math.max(0, (showPayDialog.totalBalance || 0) - payForm.amountPaid);
      await Promise.all([
        create(COLLECTIONS.CUSTOMER_PAYMENTS, {
          customerId: showPayDialog.id,
          customerName: showPayDialog.name,
          amountPaid: payForm.amountPaid,
          remainingBalance: newBalance,
          photoProofUrl: payForm.photoProofUrl,
          fsNumber: payForm.fsNumber,
          note: payForm.note,
          paymentDate: payForm.paymentDate,
          payVia: payForm.payVia,
          supplierId: payForm.payVia === "supplier" ? payForm.supplierId : "",
          supplierName: payForm.payVia === "supplier" ? (supplier?.name || "") : "",
          accountId: payForm.payVia === "account" ? payForm.accountId : "",
          accountName: payForm.payVia === "account" ? (account ? `${account.bankName} - ${account.personName}` : "") : "",
          accountNumber: payForm.payVia === "account" ? (account?.accountNumber || "") : "",
        }),
        update(COLLECTIONS.CUSTOMERS, showPayDialog.id, { totalPaid: newPaid, totalBalance: newBalance }),
      ]);
      // Supplier: increase totalPaid, decrease totalBalance, create supplier_payments record
      if (supplier) {
        const sNewPaid = (supplier.totalPaid || 0) + payForm.amountPaid;
        const sNewBalance = Math.max(0, (supplier.totalBalance || 0) - payForm.amountPaid);
        await Promise.all([
          create(COLLECTIONS.SUPPLIER_PAYMENTS, {
            supplierId: supplier.id,
            supplierName: supplier.name,
            amountPaid: payForm.amountPaid,
            remainingBalance: sNewBalance,
            fsNumber: payForm.fsNumber,
            note: payForm.note,
            paymentDate: payForm.paymentDate,
            photoProofUrl: payForm.photoProofUrl,
          }),
          update(COLLECTIONS.SUPPLIERS, supplier.id, { totalPaid: sNewPaid, totalBalance: sNewBalance }),
        ]);
      }
      // Account: create deposit voucher and recompute balance
      if (account) {
        const avVoucherId = await generateSerialVoucherId("AV");
        await create(COLLECTIONS.ACCOUNT_VOUCHERS, {
          voucherId: avVoucherId,
          accountId: account.id,
          accountBankName: account.bankName,
          accountPersonName: account.personName,
          accountNumber: account.accountNumber,
          type: "deposit",
          amount: payForm.amountPaid,
          fsNumber: payForm.fsNumber,
          customerName: showPayDialog.name,
          note: payForm.note,
          date: payForm.paymentDate,
          photoProofUrl: payForm.photoProofUrl,
        } as Record<string, unknown>);
        const allVouchers = await getAll<AccountVoucher>(COLLECTIONS.ACCOUNT_VOUCHERS);
        const active = allVouchers.filter(v => v.accountId === account.id && !v.isVoided);
        const totalDeposit = active.filter(v => v.type === "deposit").reduce((s, v) => s + v.amount, 0);
        const totalWithdraw = active.filter(v => v.type === "withdraw").reduce((s, v) => s + v.amount, 0);
        await update(COLLECTIONS.ACCOUNTS, account.id, { totalDeposit, totalWithdraw, balance: totalDeposit - totalWithdraw });
      }
      toast({ title: "Payment recorded" });
      setShowPayDialog(null);
      resetPayForm();
      loadData();
    } finally {
      setPaying(false);
    }
  }

  function handleDeletePayment(p: CustomerPayment, customer: Customer) {
    confirmDelete(async () => {
      try {
        await remove(COLLECTIONS.CUSTOMER_PAYMENTS, p.id);
        const newPaid = Math.max(0, (customer.totalPaid || 0) - p.amountPaid);
        const newBalance = (customer.totalBalance || 0) + p.amountPaid;
        await update(COLLECTIONS.CUSTOMERS, customer.id, { totalPaid: newPaid, totalBalance: newBalance });
        toast({ title: "Payment deleted" });
        await loadData();
      } catch { toast({ title: "Failed", variant: "destructive" }); }
    });
  }

  async function handleSaveEditPayment(customer: Customer) {
    if (!editingPayment) return;
    const diff = editPayForm.amountPaid - editingPayment.amountPaid;
    const newPaid = (customer.totalPaid || 0) + diff;
    const newBalance = Math.max(0, (customer.totalBalance || 0) - diff);
    try {
      await update(COLLECTIONS.CUSTOMER_PAYMENTS, editingPayment.id, {
        amountPaid: editPayForm.amountPaid,
        note: editPayForm.note,
        paymentDate: editPayForm.paymentDate,
        remainingBalance: newBalance,
      });
      await update(COLLECTIONS.CUSTOMERS, customer.id, { totalPaid: newPaid, totalBalance: newBalance });
      toast({ title: "Payment updated" });
      setEditingPayment(null);
      await loadData();
    } catch { toast({ title: "Failed", variant: "destructive" }); }
  }

  const getPayments = (cid: string) => payments.filter(p => p.customerId === cid);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Customers</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage customer accounts and payment history</p>
        </div>
        <Button onClick={openAdd} data-testid="button-add-customer">
          <Plus className="w-4 h-4 mr-2" /> Add Customer
        </Button>
      </div>
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
        <Input className="pl-9" placeholder="Search customers..." value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search-customers" />
      </div>
      {loading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}</div>
      ) : (
        <div className="space-y-3">
          {filtered.map(c => (
            <Card key={c.id} data-testid={`card-customer-${c.id}`}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Users className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-base">{c.name}</CardTitle>
                    <p className="text-xs text-muted-foreground">{c.phone} · {c.address}</p>
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap justify-end">
                  <Button size="sm" variant="outline" onClick={() => { setShowPayDialog(c); resetPayForm(); }} data-testid={`button-pay-${c.id}`}>
                    <DollarSign className="w-3 h-3 mr-1" /> Payment
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setShowVoucher(c); setPaymentSearch(""); }} data-testid={`button-view-${c.id}`}><Eye className="w-3 h-3 mr-1" /> Voucher</Button>
                  <Button size="sm" variant="outline" onClick={() => openEdit(c)} data-testid={`button-edit-${c.id}`}><Edit className="w-3 h-3" /></Button>
                  <Button size="sm" variant="destructive" onClick={() => handleDelete(c)} data-testid={`button-delete-${c.id}`}><Trash2 className="w-3 h-3" /></Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex gap-6 text-sm">
                  <div><span className="text-muted-foreground">Total Paid: </span><span className="font-medium text-green-600">{fmt(c.totalPaid)}</span></div>
                  <div><span className="text-muted-foreground">Balance: </span><span className="font-medium text-red-500">{fmt(c.totalBalance)}</span></div>
                  <div><span className="text-muted-foreground">Transactions: </span><span className="font-medium">{getPayments(c.id).length}</span></div>
                </div>
              </CardContent>
            </Card>
          ))}
          {filtered.length === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No customers found</p>
            </div>
          )}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-md">
          <DialogHeader><DialogTitle>{editCustomer ? "Edit Customer" : "Add Customer"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Name *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} data-testid="input-customer-name" /></div>
            <div><Label>Address</Label><Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} data-testid="input-customer-address" /></div>
            <div><Label>Phone</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} data-testid="input-customer-phone" /></div>
            {!editCustomer && (
              <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3 space-y-3">
                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Beginning Outstanding Balance (optional)</p>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label className="text-xs">Outstanding Amount (ETB)</Label><Input type="number" min={0} step={0.01} value={form.beginningBalance || ""} onChange={e => setForm(f => ({ ...f, beginningBalance: Number(e.target.value) }))} className="mt-1 h-8" placeholder="0.00" /></div>
                  <div><Label className="text-xs">Date</Label><Input type="date" value={form.beginningDate} onChange={e => setForm(f => ({ ...f, beginningDate: e.target.value }))} className="mt-1 h-8" /></div>
                </div>
                <div><Label className="text-xs">Note</Label><Input value={form.beginningNote} onChange={e => setForm(f => ({ ...f, beginningNote: e.target.value }))} className="mt-1 h-8" placeholder="Optional note..." /></div>
                <div>
                  <Label className="text-xs">Photo Proof</Label>
                  <input type="file" accept="image/*" className="hidden" ref={beginningPhotoRef} onChange={handleBeginningPhoto} />
                  <Button type="button" variant="outline" size="sm" className="mt-1 w-full h-8 text-xs" onClick={() => beginningPhotoRef.current?.click()} disabled={beginningUploading}>
                    {beginningUploading ? "Uploading…" : form.beginningPhotoUrl ? "Change Photo" : "Upload Photo"}
                  </Button>
                  {form.beginningPhotoUrl && (
                    <img src={form.beginningPhotoUrl} alt="Proof" className="mt-2 h-16 rounded border object-cover" />
                  )}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} data-testid="button-save-customer">
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment Dialog */}
      <Dialog open={!!showPayDialog} onOpenChange={() => { setShowPayDialog(null); resetPayForm(); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-md">
          <DialogHeader><DialogTitle>Record Payment — {showPayDialog?.name}</DialogTitle></DialogHeader>
          {showPayDialog && (
            <div className="space-y-4">
              <div className="bg-muted rounded-lg p-3 text-sm grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">Total Paid: </span><span className="font-medium text-green-600">{fmt(showPayDialog.totalPaid ?? 0)}</span></div>
                <div><span className="text-muted-foreground">Balance: </span><span className="font-medium text-red-500">{fmt(showPayDialog.totalBalance ?? 0)}</span></div>
              </div>
              <div><Label>Payment Date</Label><Input type="date" value={payForm.paymentDate} onChange={e => setPayForm(f => ({ ...f, paymentDate: e.target.value }))} data-testid="input-pay-date" /></div>
              <div><Label>Amount Paid (ETB)</Label><Input type="number" min={0} step={0.01} value={payForm.amountPaid} onChange={e => setPayForm(f => ({ ...f, amountPaid: Number(e.target.value) }))} data-testid="input-pay-amount" /></div>
              <div><Label>FS Number</Label><Input value={payForm.fsNumber} onChange={e => setPayForm(f => ({ ...f, fsNumber: e.target.value }))} placeholder="Fiscal Number (optional)" data-testid="input-pay-fs-number" /></div>

              {/* Transfer Via */}
              <div className="rounded-lg border bg-blue-50/50 p-4 space-y-3">
                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Payment Via</p>
                <div>
                  <Label>Route Payment To</Label>
                  <Select value={payForm.payVia} onValueChange={v => setPayForm(f => ({ ...f, payVia: v as "none" | "supplier" | "account", supplierId: "", accountId: "" }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— Direct / Cash —</SelectItem>
                      <SelectItem value="supplier">Supplier</SelectItem>
                      <SelectItem value="account">Account</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {payForm.payVia === "supplier" && (
                  <div>
                    <Label>Select Supplier</Label>
                    <Select value={payForm.supplierId} onValueChange={v => setPayForm(f => ({ ...f, supplierId: v }))}>
                      <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                      <SelectContent>
                        {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {payForm.supplierId && (() => {
                      const s = suppliers.find(x => x.id === payForm.supplierId);
                      return s ? (
                        <p className="text-xs text-muted-foreground mt-1">
                          Current balance: <span className="font-semibold text-red-500">{fmt(s.totalBalance ?? 0)}</span>
                          {" · "}Total paid: <span className="font-semibold text-green-600">{fmt(s.totalPaid ?? 0)}</span>
                        </p>
                      ) : null;
                    })()}
                  </div>
                )}
                {payForm.payVia === "account" && (
                  <div>
                    <Label>Select Account</Label>
                    <Select value={payForm.accountId} onValueChange={v => setPayForm(f => ({ ...f, accountId: v }))}>
                      <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                      <SelectContent>
                        {accounts.map(a => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.bankName} — {a.personName} ({a.accountNumber})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {payForm.accountId && (() => {
                      const a = accounts.find(x => x.id === payForm.accountId);
                      return a ? (
                        <p className="text-xs text-muted-foreground mt-1">
                          Current balance: <span className="font-semibold text-green-600">{fmt(a.balance ?? 0)}</span>
                        </p>
                      ) : null;
                    })()}
                  </div>
                )}
              </div>

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
            <Button variant="outline" onClick={() => { setShowPayDialog(null); resetPayForm(); }} disabled={paying}>Cancel</Button>
            <Button onClick={handlePayment} disabled={paying || uploading} data-testid="button-confirm-payment">
              {paying ? "Recording..." : "Confirm Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Voucher Dialog */}
      <Dialog open={!!showVoucher} onOpenChange={() => setShowVoucher(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-lg">
          <DialogHeader><DialogTitle>Customer Voucher</DialogTitle></DialogHeader>
          {showVoucher && (
            <div ref={voucherRef} className="bg-white overflow-hidden" style={{ fontFamily: "'Inter','Segoe UI',sans-serif", minWidth: 320, borderRadius: 12 }}>

              {/* ── Header ── */}
              <div style={{ background: "linear-gradient(135deg, #14532d 0%, #166534 50%, #15803d 100%)", padding: "20px 20px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                  <div style={{ width: 42, height: 42, borderRadius: 10, background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Users style={{ width: 22, height: 22, color: "#fff" }} />
                  </div>
                  <div>
                    <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 2 }}>Payment Statement</div>
                    <div style={{ color: "#fff", fontWeight: 800, fontSize: 19, letterSpacing: "-0.02em" }}>CUSTOMER VOUCHER</div>
                  </div>
                </div>
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.12)", paddingTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: "rgba(255,255,255,0.45)", fontSize: 10 }}>Generated {new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span>
                  <span style={{ background: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.85)", fontSize: 10, padding: "2px 10px", borderRadius: 20, letterSpacing: "0.04em", fontFamily: "monospace" }}>{showVoucher.voucherId}</span>
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
                  const hasAnyData = payments.length > 0 || hasBegBal;

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
                          {["Date", "Amount Paid", "FS #", "Via", "Note", "Balance", ""].map(h => (
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
                            <td style={{ padding: "8px 7px", color: "#374151" }}>—</td>
                            <td style={{ padding: "8px 7px", color: "#1d4ed8", fontWeight: 600 }}>
                              Opening Balance{showVoucher.beginningNote ? ` · ${showVoucher.beginningNote}` : ""}
                            </td>
                            <td style={{ padding: "8px 7px", color: "#dc2626", fontWeight: 700, textAlign: "right" }}>{fmt(showVoucher.beginningBalance || 0)}</td>
                            <td style={{ padding: "8px 7px", textAlign: "right" }}>
                              {showVoucher.beginningPhotoUrl && (
                                <button title="View Photo Proof" onClick={() => window.open((showVoucher as any).beginningPhotoUrl, "_blank")}>
                                  <Eye className="w-3 h-3 inline text-blue-500 hover:text-blue-700" />
                                </button>
                              )}
                            </td>
                          </tr>
                        )}
                        {filtered.length === 0 && payments.length > 0 ? (
                          <tr><td colSpan={7} style={{ textAlign: "center", padding: "14px", color: "#9ca3af", fontSize: 12 }}>No payments match "{paymentSearch}"</td></tr>
                        ) : filtered.map((p, i) => (
                          <tr key={i} style={{ background: p.voided ? "#fef2f2" : i % 2 === 0 ? "#fff" : "#f9fafb", opacity: p.voided ? 0.7 : 1 }}>
                            <td style={{ padding: "8px 7px", color: "#6b7280", textDecoration: p.voided ? "line-through" : "none" }}>{(p as any).paymentDate || "—"}</td>
                            <td style={{ padding: "8px 7px", color: p.voided ? "#9ca3af" : "#059669", fontWeight: 700, textDecoration: p.voided ? "line-through" : "none" }}>
                              {fmt(p.amountPaid)}
                              {p.voided && <span style={{ marginLeft: 4, fontSize: 8, fontWeight: 700, background: "#dc2626", color: "#fff", padding: "1px 5px", borderRadius: 4, textDecoration: "none", verticalAlign: "middle" }}>VOID</span>}
                            </td>
                            <td style={{ padding: "8px 7px", color: "#374151", textDecoration: p.voided ? "line-through" : "none" }}>{p.fsNumber || "—"}</td>
                            <td style={{ padding: "8px 7px", color: "#1d4ed8", fontSize: 10, maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: p.voided ? "line-through" : "none" }}>
                              {p.payVia === "supplier" && p.supplierName ? p.supplierName :
                               p.payVia === "account" && p.accountName ? `${p.accountName}${p.accountNumber ? ` (${p.accountNumber})` : ""}` :
                               "—"}
                            </td>
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

      {/* Customer Outstanding Balance Popup */}
      {showBalancePopup && customersWithBalance.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pointer-events-none">
          <div className="pointer-events-auto w-full max-w-2xl mx-4 mb-0 rounded-t-2xl shadow-2xl border border-border overflow-hidden bg-white dark:bg-card">
            <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-red-600 to-red-700 text-white">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                <span className="font-semibold text-sm">
                  {customersWithBalance.length} Customer{customersWithBalance.length !== 1 ? "s" : ""} with Outstanding Balance — Highest First
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button className="p-1 rounded hover:bg-white/20 transition-colors" onClick={() => setPopupExpanded(e => !e)}>
                  <span className="text-xs font-bold">{popupExpanded ? "▼" : "▲"}</span>
                </button>
                <button className="p-1 rounded hover:bg-white/20 transition-colors" onClick={() => setShowBalancePopup(false)}>
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            {popupExpanded && (
              <div className="max-h-52 overflow-y-auto divide-y divide-border">
                {customersWithBalance.map((c, i) => (
                  <div key={c.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-muted/40 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold ${i === 0 ? "bg-red-600" : i === 1 ? "bg-orange-500" : "bg-yellow-500"}`}>{i + 1}</div>
                      <div>
                        <p className="font-medium text-sm text-foreground">{c.name}</p>
                        <p className="text-xs text-muted-foreground">{c.phone || c.address || "—"}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-red-600 text-sm">{fmt(c.totalBalance || 0)}</p>
                      <p className="text-xs text-muted-foreground">Paid: {fmt(c.totalPaid || 0)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
