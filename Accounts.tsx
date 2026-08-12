import { useState, useEffect, useRef } from "react";
import { fmt } from "@/lib/currency";
import { Plus, Search, Eye, Pencil, Trash2, Printer, Share2, ArrowUpCircle, ArrowDownCircle, Building2, CheckCircle2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import type { Account, AccountVoucher, Supplier } from "@/lib/types";
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
function todayStr() { return new Date().toISOString().slice(0, 10); }

export default function Accounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [vouchers, setVouchers] = useState<AccountVoucher[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [showAccountForm, setShowAccountForm] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [accForm, setAccForm] = useState({ bankName: "", personName: "", accountNumber: "" });

  const [showDepositForm, setShowDepositForm] = useState(false);
  const [showWithdrawForm, setShowWithdrawForm] = useState(false);
  const [editingVoucher, setEditingVoucher] = useState<AccountVoucher | null>(null);

  const [depositForm, setDepositForm] = useState({
    accountId: "", amount: 0, fsNumber: "", customerName: "", date: todayStr(), note: "", photoProofUrl: "",
  });
  const [withdrawForm, setWithdrawForm] = useState({
    accountId: "", amount: 0, reason: "", date: todayStr(), note: "",
    fsNumber: "", photoProofUrl: "", payToSupplier: false, supplierId: "",
  });

  const [showHistory, setShowHistory] = useState<Account | null>(null);
  const [showVoucherView, setShowVoucherView] = useState<AccountVoucher | null>(null);
  const [txSearch, setTxSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [withdrawUpload, setWithdrawUpload] = useState(false);

  const { toast } = useToast();
  const [sharing, setSharing] = useState(false);
  const { confirmDelete, DeleteAuthDialog } = useDeleteAuth();
  const { user, isAdmin } = useAuth();
  const receiptRef = useRef<HTMLDivElement>(null);
  const handlePrint = useReactToPrint({ contentRef: receiptRef });
  const [sharingPdf, setSharingPdf] = useState(false);
  async function handleShare() {
    if (!receiptRef.current) return;
    setSharing(true);
    const r = await shareAsImage(receiptRef.current, "account_voucher.png");
    if (r === "failed") toast({ title: "Share failed", variant: "destructive" });
    setSharing(false);
  }
  async function handleSharePdf() {
    if (!receiptRef.current) return;
    setSharingPdf(true);
    const r = await shareAsPdf(receiptRef.current, "account_voucher.pdf");
    if (r === "failed") toast({ title: "PDF share failed", variant: "destructive" });
    setSharingPdf(false);
  }

  async function loadData() {
    setLoading(true);
    const [accs, vcs, sups] = await Promise.all([
      getAll<Account>(COLLECTIONS.ACCOUNTS),
      getAll<AccountVoucher>(COLLECTIONS.ACCOUNT_VOUCHERS),
      getAll<Supplier>(COLLECTIONS.SUPPLIERS),
    ]);
    setAccounts(accs.filter(a => !a.isVoided).sort((a, b) => a.bankName.localeCompare(b.bankName)));
    setVouchers(vcs.filter(v => !v.isVoided).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))));
    setSuppliers(sups.filter(s => !(s as any).isVoided).sort((a, b) => a.name.localeCompare(b.name)));
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  const filtered = accounts.filter(a =>
    a.bankName.toLowerCase().includes(search.toLowerCase()) ||
    a.personName.toLowerCase().includes(search.toLowerCase()) ||
    a.accountNumber.toLowerCase().includes(search.toLowerCase())
  );

  // --- Account CRUD ---
  function resetAccForm() { setAccForm({ bankName: "", personName: "", accountNumber: "" }); setEditingAccount(null); }

  async function handleSaveAccount() {
    if (!accForm.bankName || !accForm.personName || !accForm.accountNumber) {
      toast({ title: "Fill all fields", variant: "destructive" }); return;
    }
    setSaving(true);
    try {
      if (editingAccount) {
        await update(COLLECTIONS.ACCOUNTS, editingAccount.id, accForm as Record<string, unknown>);
        toast({ title: "Account updated" });
      } else {
        await create(COLLECTIONS.ACCOUNTS, { ...accForm, totalDeposit: 0, totalWithdraw: 0, balance: 0 } as Record<string, unknown>);
        toast({ title: "Account created" });
      }
      setShowAccountForm(false); resetAccForm(); await loadData();
    } catch { toast({ title: "Failed", variant: "destructive" }); } finally { setSaving(false); }
  }

  function handleDeleteAccount(a: Account) {
    if (!isAdmin) return;
    confirmDelete(async () => {
      await update(COLLECTIONS.ACCOUNTS, a.id, { isVoided: true });
      toast({ title: "Account deleted" }); await loadData();
    });
  }

  // --- Recompute account balance from all vouchers (safe, no stale state) ---
  async function recomputeBalance(accountId: string) {
    const all = await getAll<AccountVoucher>(COLLECTIONS.ACCOUNT_VOUCHERS);
    const active = all.filter(v => v.accountId === accountId && !v.isVoided);
    const totalDeposit = active.filter(v => v.type === "deposit").reduce((s, v) => s + v.amount, 0);
    const totalWithdraw = active.filter(v => v.type === "withdraw").reduce((s, v) => s + v.amount, 0);
    await update(COLLECTIONS.ACCOUNTS, accountId, { totalDeposit, totalWithdraw, balance: totalDeposit - totalWithdraw } as Record<string, unknown>);
  }

  // --- Deposit ---
  function resetDeposit() { setDepositForm({ accountId: "", amount: 0, fsNumber: "", customerName: "", date: todayStr(), note: "", photoProofUrl: "" }); setEditingVoucher(null); }

  async function checkFsUnique(fsNumber: string, excludeId?: string): Promise<boolean> {
    const all = await getAll<AccountVoucher>(COLLECTIONS.ACCOUNT_VOUCHERS);
    return !all.some(v => v.fsNumber === fsNumber && !v.isVoided && v.id !== excludeId);
  }

  async function handleSaveDeposit() {
    if (!depositForm.accountId || !depositForm.amount) {
      toast({ title: "Select account and enter amount", variant: "destructive" }); return;
    }
    if (!depositForm.fsNumber) {
      toast({ title: "FS Number is required for deposits", variant: "destructive" }); return;
    }
    const isUnique = await checkFsUnique(depositForm.fsNumber, editingVoucher?.id);
    if (!isUnique) {
      toast({ title: "FS Number already exists", description: "Each deposit must have a unique FS number", variant: "destructive" }); return;
    }
    const account = accounts.find(a => a.id === depositForm.accountId)!;
    setSaving(true);
    try {
      if (editingVoucher) {
        await update(COLLECTIONS.ACCOUNT_VOUCHERS, editingVoucher.id, {
          amount: depositForm.amount, fsNumber: depositForm.fsNumber,
          customerName: depositForm.customerName, date: depositForm.date,
          note: depositForm.note, photoProofUrl: depositForm.photoProofUrl,
        } as Record<string, unknown>);
        await recomputeBalance(account.id);
        toast({ title: "Deposit updated" });
      } else {
        const voucherId = await generateSerialVoucherId("AV");
        await create(COLLECTIONS.ACCOUNT_VOUCHERS, {
          voucherId, accountId: account.id, accountBankName: account.bankName,
          accountPersonName: account.personName, accountNumber: account.accountNumber,
          type: "deposit", amount: depositForm.amount, fsNumber: depositForm.fsNumber,
          customerName: depositForm.customerName, date: depositForm.date, note: depositForm.note,
          photoProofUrl: depositForm.photoProofUrl, createdByName: user?.name || "",
        } as Record<string, unknown>);
        await recomputeBalance(account.id);
        toast({ title: "Deposit saved", description: voucherId });
      }
      setShowDepositForm(false); resetDeposit(); await loadData();
    } catch { toast({ title: "Failed", variant: "destructive" }); } finally { setSaving(false); }
  }

  // --- Withdraw ---
  function resetWithdraw() {
    setWithdrawForm({ accountId: "", amount: 0, reason: "", date: todayStr(), note: "", fsNumber: "", photoProofUrl: "", payToSupplier: false, supplierId: "" });
    setEditingVoucher(null);
  }

  async function handleWithdrawPhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setWithdrawUpload(true);
    try { const url = await uploadImage(file); setWithdrawForm(prev => ({ ...prev, photoProofUrl: url })); }
    catch { toast({ title: "Upload failed", variant: "destructive" }); } finally { setWithdrawUpload(false); }
  }

  async function handleSaveWithdraw() {
    if (!withdrawForm.accountId || !withdrawForm.amount) {
      toast({ title: "Select account and enter amount", variant: "destructive" }); return;
    }
    if (!withdrawForm.reason && !withdrawForm.payToSupplier) {
      toast({ title: "Reason is required for withdrawals", variant: "destructive" }); return;
    }
    if (withdrawForm.payToSupplier && !withdrawForm.supplierId) {
      toast({ title: "Please select a supplier", variant: "destructive" }); return;
    }
    const account = accounts.find(a => a.id === withdrawForm.accountId)!;
    const selectedSupplier = withdrawForm.payToSupplier ? suppliers.find(s => s.id === withdrawForm.supplierId) : null;
    const autoReason = selectedSupplier ? `Payment to supplier: ${selectedSupplier.name}` : withdrawForm.reason;
    setSaving(true);
    try {
      if (editingVoucher) {
        await update(COLLECTIONS.ACCOUNT_VOUCHERS, editingVoucher.id, {
          amount: withdrawForm.amount, reason: autoReason,
          date: withdrawForm.date, note: withdrawForm.note,
          fsNumber: withdrawForm.fsNumber, photoProofUrl: withdrawForm.photoProofUrl,
        } as Record<string, unknown>);
        await recomputeBalance(account.id);
        toast({ title: "Withdrawal updated" });
      } else {
        const voucherId = await generateSerialVoucherId("AV");
        await create(COLLECTIONS.ACCOUNT_VOUCHERS, {
          voucherId, accountId: account.id, accountBankName: account.bankName,
          accountPersonName: account.personName, accountNumber: account.accountNumber,
          type: "withdraw", amount: withdrawForm.amount, reason: autoReason,
          date: withdrawForm.date, note: withdrawForm.note, createdByName: user?.name || "",
          fsNumber: withdrawForm.fsNumber, photoProofUrl: withdrawForm.photoProofUrl,
          supplierId: selectedSupplier?.id || "", supplierName: selectedSupplier?.name || "",
        } as Record<string, unknown>);
        await recomputeBalance(account.id);

        // If paying to supplier, create a supplier payment record and update supplier balance
        if (selectedSupplier) {
          const newTotalPaid = (selectedSupplier.totalPaid || 0) + withdrawForm.amount;
          const newBalance = Math.max(0, (selectedSupplier.totalBalance || 0) - withdrawForm.amount);
          await create(COLLECTIONS.SUPPLIER_PAYMENTS, {
            supplierId: selectedSupplier.id,
            supplierName: selectedSupplier.name,
            amountPaid: withdrawForm.amount,
            remainingBalance: newBalance,
            fsNumber: withdrawForm.fsNumber,
            photoProofUrl: withdrawForm.photoProofUrl,
            note: withdrawForm.note || `Paid via account: ${account.bankName} — ${account.personName}`,
            paymentDate: withdrawForm.date,
            fromAccountVoucherId: voucherId,
            fromAccountBankName: account.bankName,
          } as Record<string, unknown>);
          await update(COLLECTIONS.SUPPLIERS, selectedSupplier.id, {
            totalPaid: newTotalPaid,
            totalBalance: newBalance,
          } as Record<string, unknown>);
        }

        toast({ title: "Withdrawal saved", description: voucherId });
      }
      setShowWithdrawForm(false); resetWithdraw(); await loadData();
    } catch { toast({ title: "Failed", variant: "destructive" }); } finally { setSaving(false); }
  }

  // --- Edit voucher ---
  function openEditVoucher(v: AccountVoucher) {
    setEditingVoucher(v);
    if (v.type === "deposit") {
      setDepositForm({
        accountId: v.accountId, amount: v.amount, fsNumber: v.fsNumber || "",
        customerName: v.customerName || "", date: v.date || todayStr(),
        note: v.note || "", photoProofUrl: v.photoProofUrl || "",
      });
      setShowDepositForm(true);
    } else {
      setWithdrawForm({
        accountId: v.accountId, amount: v.amount, reason: v.reason || "",
        date: v.date || todayStr(), note: v.note || "",
        fsNumber: v.fsNumber || "", photoProofUrl: v.photoProofUrl || "",
        payToSupplier: false, supplierId: v.supplierId || "",
      });
      setShowWithdrawForm(true);
    }
  }

  // --- Delete voucher ---
  function handleDeleteVoucher(v: AccountVoucher) {
    if (!isAdmin) return;
    confirmDelete(async () => {
      const account = accounts.find(a => a.id === v.accountId);
      await update(COLLECTIONS.ACCOUNT_VOUCHERS, v.id, { isVoided: true });
      if (account) await recomputeBalance(account.id);
      toast({ title: "Voucher deleted" }); await loadData();
    });
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true);
    try { const url = await uploadImage(file); setDepositForm(prev => ({ ...prev, photoProofUrl: url })); }
    catch { toast({ title: "Upload failed", variant: "destructive" }); } finally { setUploading(false); }
  }

  function buildShareText(v: AccountVoucher) {
    return [
      "ACCOUNT VOUCHER", `Voucher: ${v.voucherId}`,
      `Date: ${v.date || fmtDate(v.createdAt)}`,
      `Bank: ${v.accountBankName}`, `Person: ${v.accountPersonName}`,
      `Account No: ${v.accountNumber}`, `Type: ${v.type.toUpperCase()}`,
      `Amount: ${fmt(v.amount)}`,
      v.fsNumber ? `FS Number: ${v.fsNumber}` : "",
      v.customerName ? `Customer: ${v.customerName}` : "",
      v.supplierName ? `Paid to Supplier: ${v.supplierName}` : "",
      v.reason && !v.supplierName ? `Reason: ${v.reason}` : "",
      v.note ? `Note: ${v.note}` : "",
    ].filter(Boolean).join("\n");
  }

  const historyVouchers = showHistory ? vouchers.filter(v => v.accountId === showHistory.id) : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Accounts</h1>
          <p className="text-sm text-muted-foreground">Bank account management and transaction vouchers</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" className="border-green-300 text-green-700 hover:bg-green-50" onClick={() => { resetDeposit(); setShowDepositForm(true); }}>
            <ArrowUpCircle className="w-4 h-4 mr-2" /> Deposit
          </Button>
          <Button variant="outline" className="border-red-300 text-red-700 hover:bg-red-50" onClick={() => { resetWithdraw(); setShowWithdrawForm(true); }}>
            <ArrowDownCircle className="w-4 h-4 mr-2" /> Withdraw
          </Button>
          <Button onClick={() => { resetAccForm(); setShowAccountForm(true); }}>
            <Plus className="w-4 h-4 mr-2" /> New Account
          </Button>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search accounts…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(acc => (
            <div key={acc.id} className="bg-card border rounded-xl p-5 space-y-3 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-semibold">{acc.bankName}</div>
                  <div className="text-sm text-muted-foreground">{acc.personName}</div>
                  <div className="text-xs font-mono text-muted-foreground">{acc.accountNumber}</div>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => { setShowHistory(acc); setTxSearch(""); }}><Eye className="w-4 h-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditingAccount(acc); setAccForm({ bankName: acc.bankName, personName: acc.personName, accountNumber: acc.accountNumber }); setShowAccountForm(true); }}><Pencil className="w-4 h-4" /></Button>
                  {isAdmin && <Button size="sm" variant="ghost" className="text-red-500" onClick={() => handleDeleteAccount(acc)}><Trash2 className="w-4 h-4" /></Button>}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs border-t pt-3">
                <div><div className="text-muted-foreground">Deposit</div><div className="font-semibold text-green-600">{fmt(acc.totalDeposit || 0)}</div></div>
                <div><div className="text-muted-foreground">Withdraw</div><div className="font-semibold text-red-600">{fmt(acc.totalWithdraw || 0)}</div></div>
                <div><div className="text-muted-foreground">Balance</div><div className={`font-bold text-sm ${(acc.balance || 0) >= 0 ? "text-primary" : "text-red-600"}`}>{fmt(acc.balance || 0)}</div></div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div className="col-span-3 text-center text-muted-foreground py-16">No accounts found</div>}
        </div>
      )}

      {/* Account Form */}
      <Dialog open={showAccountForm} onOpenChange={v => { if (!v) { setShowAccountForm(false); resetAccForm(); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-md">
          <DialogHeader><DialogTitle>{editingAccount ? "Edit Account" : "New Account"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Bank Name</Label><Input value={accForm.bankName} onChange={e => setAccForm(p => ({ ...p, bankName: e.target.value }))} className="mt-1" placeholder="e.g. Commercial Bank of Ethiopia" /></div>
            <div><Label>Person Name</Label><Input value={accForm.personName} onChange={e => setAccForm(p => ({ ...p, personName: e.target.value }))} className="mt-1" /></div>
            <div><Label>Account Number</Label><Input value={accForm.accountNumber} onChange={e => setAccForm(p => ({ ...p, accountNumber: e.target.value }))} className="mt-1" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAccountForm(false); resetAccForm(); }}>Cancel</Button>
            <Button onClick={handleSaveAccount} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deposit Form */}
      <Dialog open={showDepositForm} onOpenChange={v => { if (!v) { setShowDepositForm(false); resetDeposit(); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-md">
          <DialogHeader><DialogTitle>{editingVoucher ? "Edit Deposit" : "New Deposit"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Account</Label>
              <Select value={depositForm.accountId} onValueChange={v => setDepositForm(p => ({ ...p, accountId: v }))} disabled={!!editingVoucher}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>{accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.bankName} — {a.personName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Date</Label><Input type="date" value={depositForm.date} onChange={e => setDepositForm(p => ({ ...p, date: e.target.value }))} className="mt-1" /></div>
            <div><Label>Amount (ETB)</Label><Input type="number" min={0} value={depositForm.amount || ""} onChange={e => setDepositForm(p => ({ ...p, amount: Number(e.target.value) }))} className="mt-1" /></div>
            <div><Label>FS Number <span className="text-red-500">*</span></Label><Input value={depositForm.fsNumber} onChange={e => setDepositForm(p => ({ ...p, fsNumber: e.target.value }))} className="mt-1" placeholder="Must be unique" /></div>
            <div><Label>Customer Name</Label><Input value={depositForm.customerName} onChange={e => setDepositForm(p => ({ ...p, customerName: e.target.value }))} className="mt-1" /></div>
            <div><Label>Note (optional)</Label><Input value={depositForm.note} onChange={e => setDepositForm(p => ({ ...p, note: e.target.value }))} className="mt-1" /></div>
            <div>
              <Label>Photo Proof (optional)</Label>
              <Input type="file" accept="image/*" onChange={handlePhotoUpload} className="mt-1" disabled={uploading} />
              {depositForm.photoProofUrl && <img src={depositForm.photoProofUrl} alt="proof" className="mt-2 h-24 rounded object-cover" />}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowDepositForm(false); resetDeposit(); }}>Cancel</Button>
            <Button className="bg-green-600 hover:bg-green-700" onClick={handleSaveDeposit} disabled={saving || uploading}>{saving ? "Saving…" : editingVoucher ? "Update Deposit" : "Save Deposit"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Withdraw Form */}
      <Dialog open={showWithdrawForm} onOpenChange={v => { if (!v) { setShowWithdrawForm(false); resetWithdraw(); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-md">
          <DialogHeader><DialogTitle>{editingVoucher ? "Edit Withdrawal" : "New Withdrawal"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Account</Label>
              <Select value={withdrawForm.accountId} onValueChange={v => setWithdrawForm(p => ({ ...p, accountId: v }))} disabled={!!editingVoucher}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>{accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.bankName} — {a.personName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Date</Label><Input type="date" value={withdrawForm.date} onChange={e => setWithdrawForm(p => ({ ...p, date: e.target.value }))} className="mt-1" /></div>
            <div><Label>Amount (ETB)</Label><Input type="number" min={0} value={withdrawForm.amount || ""} onChange={e => setWithdrawForm(p => ({ ...p, amount: Number(e.target.value) }))} className="mt-1" /></div>
            <div><Label>FS Number</Label><Input value={withdrawForm.fsNumber} onChange={e => setWithdrawForm(p => ({ ...p, fsNumber: e.target.value }))} className="mt-1" placeholder="Enter FS number (optional)" /></div>

            {/* Pay to Supplier toggle */}
            <div
              className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors select-none ${withdrawForm.payToSupplier ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30" : "border-muted hover:border-muted-foreground/40"}`}
              onClick={() => !editingVoucher && setWithdrawForm(p => ({ ...p, payToSupplier: !p.payToSupplier, supplierId: "" }))}
            >
              <div className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-colors ${withdrawForm.payToSupplier ? "bg-blue-600 border-blue-600" : "border-muted-foreground/40"}`}>
                {withdrawForm.payToSupplier && <CheckCircle2 className="w-4 h-4 text-white" />}
              </div>
              <Building2 className={`w-4 h-4 ${withdrawForm.payToSupplier ? "text-blue-600" : "text-muted-foreground"}`} />
              <span className={`text-sm font-medium ${withdrawForm.payToSupplier ? "text-blue-700 dark:text-blue-300" : "text-muted-foreground"}`}>
                Pay to Supplier
              </span>
            </div>

            {/* Supplier selector — shown only when Pay to Supplier is checked */}
            {withdrawForm.payToSupplier && (
              <div>
                <Label>Select Supplier <span className="text-red-500">*</span></Label>
                <Select value={withdrawForm.supplierId} onValueChange={v => setWithdrawForm(p => ({ ...p, supplierId: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Choose a supplier…" /></SelectTrigger>
                  <SelectContent>
                    {suppliers.map(s => (
                      <SelectItem key={s.id} value={s.id}>
                        <span className="font-medium">{s.name}</span>
                        <span className="ml-2 text-muted-foreground text-xs">Balance: {fmt(s.totalBalance || 0)}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {withdrawForm.supplierId && (() => {
                  const sup = suppliers.find(s => s.id === withdrawForm.supplierId);
                  return sup ? (
                    <div className="mt-2 rounded-md bg-muted/50 px-3 py-2 text-sm space-y-0.5">
                      <div><span className="text-muted-foreground">Current Balance:</span> <span className="font-semibold text-red-600">{fmt(sup.totalBalance || 0)}</span></div>
                      <div><span className="text-muted-foreground">Total Paid so far:</span> <span className="font-semibold">{fmt(sup.totalPaid || 0)}</span></div>
                      {withdrawForm.amount > 0 && <div className="pt-1 border-t"><span className="text-muted-foreground">Balance after payment:</span> <span className="font-semibold text-green-600">{fmt(Math.max(0, (sup.totalBalance || 0) - withdrawForm.amount))}</span></div>}
                    </div>
                  ) : null;
                })()}
              </div>
            )}

            {!withdrawForm.payToSupplier && (
              <div><Label>Reason <span className="text-red-500">*</span></Label><Input value={withdrawForm.reason} onChange={e => setWithdrawForm(p => ({ ...p, reason: e.target.value }))} className="mt-1" placeholder="Purpose of withdrawal" /></div>
            )}
            <div><Label>Note (optional)</Label><Input value={withdrawForm.note} onChange={e => setWithdrawForm(p => ({ ...p, note: e.target.value }))} className="mt-1" /></div>
            <div>
              <Label>Photo Proof (optional)</Label>
              <Input type="file" accept="image/*" onChange={handleWithdrawPhotoUpload} className="mt-1" disabled={withdrawUpload} />
              {withdrawForm.photoProofUrl && <img src={withdrawForm.photoProofUrl} alt="proof" className="mt-2 h-24 rounded object-cover" />}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowWithdrawForm(false); resetWithdraw(); }}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700" onClick={handleSaveWithdraw} disabled={saving || withdrawUpload}>{saving ? "Saving…" : editingVoucher ? "Update Withdrawal" : "Save Withdrawal"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Account History */}
      {showHistory && (
        <Dialog open onOpenChange={() => setShowHistory(null)}>
          <DialogContent className="max-h-[90vh] overflow-y-auto max-w-3xl">
            <DialogHeader><DialogTitle>Transaction History — {showHistory.bankName}</DialogTitle></DialogHeader>
            <div className="space-y-1 text-sm mb-4">
              <div><span className="text-muted-foreground">Person:</span> {showHistory.personName}</div>
              <div><span className="text-muted-foreground">Account No:</span> {showHistory.accountNumber}</div>
              <div className="flex gap-6 mt-2">
                <div><span className="text-muted-foreground">Total Deposit:</span> <span className="font-semibold text-green-600">{fmt(showHistory.totalDeposit || 0)}</span></div>
                <div><span className="text-muted-foreground">Total Withdraw:</span> <span className="font-semibold text-red-600">{fmt(showHistory.totalWithdraw || 0)}</span></div>
                <div><span className="text-muted-foreground">Balance:</span> <span className="font-bold">{fmt(showHistory.balance || 0)}</span></div>
              </div>
            </div>
            <div className="mb-3">
              <Input
                placeholder="Search by voucher, date, type, amount or reason..."
                value={txSearch}
                onChange={e => setTxSearch(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2">Voucher</th>
                    <th className="text-left px-3 py-2">Date</th>
                    <th className="text-left px-3 py-2">Type</th>
                    <th className="text-right px-3 py-2">Amount</th>
                    <th className="text-left px-3 py-2">FS No / Reason</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {historyVouchers.filter(v => {
                    const q = txSearch.toLowerCase();
                    return !q ||
                      (v.voucherId || "").toLowerCase().includes(q) ||
                      (v.date || fmtDate(v.createdAt) || "").toLowerCase().includes(q) ||
                      (v.type || "").toLowerCase().includes(q) ||
                      String(v.amount).includes(q) ||
                      (v.fsNumber || "").toLowerCase().includes(q) ||
                      (v.reason || "").toLowerCase().includes(q);
                  }).length === 0 && (
                    <tr><td colSpan={6} className="text-center text-muted-foreground py-8">{txSearch ? `No results for "${txSearch}"` : "No transactions yet"}</td></tr>
                  )}
                  {historyVouchers.filter(v => {
                    const q = txSearch.toLowerCase();
                    return !q ||
                      (v.voucherId || "").toLowerCase().includes(q) ||
                      (v.date || fmtDate(v.createdAt) || "").toLowerCase().includes(q) ||
                      (v.type || "").toLowerCase().includes(q) ||
                      String(v.amount).includes(q) ||
                      (v.fsNumber || "").toLowerCase().includes(q) ||
                      (v.reason || "").toLowerCase().includes(q);
                  }).map(v => (
                    <tr key={v.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2 font-mono text-xs text-primary">{v.voucherId}</td>
                      <td className="px-3 py-2 text-xs">{v.date || fmtDate(v.createdAt)}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${v.type === "deposit" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                          {v.type === "deposit" ? <ArrowUpCircle className="w-3 h-3" /> : <ArrowDownCircle className="w-3 h-3" />}
                          {v.type}
                        </span>
                      </td>
                      <td className={`px-3 py-2 text-right font-semibold ${v.type === "deposit" ? "text-green-600" : "text-red-600"}`}>{fmt(v.amount)}</td>
                      <td className="px-3 py-2 text-xs">{v.fsNumber || v.reason || "—"}</td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setShowVoucherView(v)}><Eye className="w-4 h-4" /></Button>
                          <Button size="sm" variant="ghost" onClick={() => openEditVoucher(v)}><Pencil className="w-4 h-4" /></Button>
                          {isAdmin && <Button size="sm" variant="ghost" className="text-red-500" onClick={() => handleDeleteVoucher(v)}><Trash2 className="w-4 h-4" /></Button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Voucher View */}
      {showVoucherView && (
        <Dialog open onOpenChange={() => setShowVoucherView(null)}>
          <DialogContent className="max-h-[90vh] overflow-y-auto max-w-md">
            <DialogHeader><DialogTitle>Account Voucher</DialogTitle></DialogHeader>
            <div ref={receiptRef} className="receipt-a4 space-y-3 p-4 text-sm">
              <div className="text-center border-b pb-3">
                <h2 className="text-lg font-bold">ACCOUNT VOUCHER</h2>
                <p className="font-mono text-primary text-sm">{showVoucherView.voucherId}</p>
                <p className="text-xs text-muted-foreground">{showVoucherView.date || fmtDate(showVoucherView.createdAt)}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><span className="text-muted-foreground">Bank:</span><div className="font-semibold">{showVoucherView.accountBankName}</div></div>
                <div><span className="text-muted-foreground">Person:</span><div className="font-semibold">{showVoucherView.accountPersonName}</div></div>
                <div><span className="text-muted-foreground">Account No:</span><div className="font-mono">{showVoucherView.accountNumber}</div></div>
                <div><span className="text-muted-foreground">Type:</span><div className={`font-bold uppercase ${showVoucherView.type === "deposit" ? "text-green-600" : "text-red-600"}`}>{showVoucherView.type}</div></div>
                <div className="col-span-2"><span className="text-muted-foreground">Amount:</span><div className="font-bold text-xl">{fmt(showVoucherView.amount)}</div></div>
                {showVoucherView.fsNumber && <div><span className="text-muted-foreground">FS Number:</span><div>{showVoucherView.fsNumber}</div></div>}
                {showVoucherView.customerName && <div><span className="text-muted-foreground">Customer:</span><div>{showVoucherView.customerName}</div></div>}
                {showVoucherView.supplierName && (
                  <div className="col-span-2 rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950/30 px-3 py-2">
                    <span className="text-muted-foreground text-xs">Paid to Supplier:</span>
                    <div className="font-semibold text-blue-700 dark:text-blue-300">{showVoucherView.supplierName}</div>
                  </div>
                )}
                {showVoucherView.reason && !showVoucherView.supplierName && <div className="col-span-2"><span className="text-muted-foreground">Reason:</span><div>{showVoucherView.reason}</div></div>}
                {showVoucherView.note && <div className="col-span-2"><span className="text-muted-foreground">Note:</span><div>{showVoucherView.note}</div></div>}
              </div>
              {showVoucherView.photoProofUrl && (
                <img src={showVoucherView.photoProofUrl} alt="proof" className="w-full rounded-lg object-cover max-h-48" />
              )}
              {/* Footer */}
              <div className="border-t pt-3 mt-2 text-xs text-muted-foreground space-y-1">
                {showVoucherView?.createdByName && <div className="flex justify-between"><span>Created by:</span><span className="font-medium text-foreground">{showVoucherView.createdByName}</span></div>}
                <div className="flex justify-between"><span>Authorized signature: _______________</span><span>Page 1 of 1</span></div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { openEditVoucher(showVoucherView); setShowVoucherView(null); }}><Pencil className="w-4 h-4 mr-2" /> Edit</Button>
              <Button variant="outline" onClick={handleSharePdf} disabled={sharingPdf}><FileText className="w-4 h-4 mr-2" />{sharingPdf ? "Generating…" : "PDF Share"}</Button>
              <Button variant="outline" onClick={handleShare} disabled={sharing}><Share2 className="w-4 h-4 mr-2" />{sharing ? "Sharing…" : "Share"}</Button>
              <Button variant="outline" onClick={() => handlePrint()}><Printer className="w-4 h-4 mr-2" /> Print</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {DeleteAuthDialog}
    </div>
  );
}
