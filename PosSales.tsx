import { useState, useEffect, useRef } from "react";
import { Plus, Search, Eye, Ban, Trash2, Printer, FileDown, Share2, Pencil, CheckCircle, RotateCcw, FileText } from "lucide-react";
import { fmt } from "@/lib/currency";
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
import { computeStockBalances } from "@/lib/stockUtils";
import { useAuth } from "@/lib/auth";
import { shareAsImage, shareAsPdf } from "@/lib/shareImage";
import { uploadImage } from "@/lib/cloudinary";
import type { Product, Store, Customer, Supplier, PosSale, SaleItem, PricingRecord, Account, AccountVoucher, SupplierPayment } from "@/lib/types";
import { useReactToPrint } from "react-to-print";
import { BarcodeScannerButton } from "@/components/BarcodeScannerButton";
import { ReceiptActionBar } from "@/components/ReceiptActionBar";
import * as XLSX from "xlsx";

export default function PosSales() {
  const [sales, setSales] = useState<PosSale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [pricing, setPricing] = useState<PricingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showVoucher, setShowVoucher] = useState<PosSale | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({
    customerId: "", storeId: "", paymentMethod: "cash" as "cash" | "transfer" | "credit",
    transferType: "supplier" as "supplier" | "account",
    supplierId: "", accountId: "", fsNumber: "",
    amountPaid: 0, remark: "", photoProofUrl: "", voucherDate: new Date().toISOString().slice(0, 10)
  });
  const [items, setItems] = useState<SaleItem[]>([]);
  const [storeStockMap, setStoreStockMap] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const [sharing, setSharing] = useState(false);
  const { confirmDelete, DeleteAuthDialog } = useDeleteAuth();
  const { user, isAdmin } = useAuth();
  const receiptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (form.storeId) {
      computeStockBalances(form.storeId).then(m =>
        setStoreStockMap(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, (v as {quantity: number}).quantity])))
      );
    } else {
      setStoreStockMap({});
    }
  }, [form.storeId]);

  async function loadData() {
    setLoading(true);
    const [s, p, st, c, pr, sups, accs] = await Promise.all([
      getAll<PosSale>(COLLECTIONS.POS_SALES),
      getAll<Product>(COLLECTIONS.PRODUCTS),
      getAll<Store>(COLLECTIONS.STORES),
      getAll<Customer>(COLLECTIONS.CUSTOMERS),
      getAll<PricingRecord>(COLLECTIONS.PRICING),
      getAll<Supplier>(COLLECTIONS.SUPPLIERS),
      getAll<Account>(COLLECTIONS.ACCOUNTS),
    ]);
    setSales(s.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))));
    setProducts(p);
    setStores(st);
    setCustomers(c);
    setPricing(pr);
    setSuppliers(sups);
    setAccounts(accs);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  const filtered = sales.filter(s =>
    s.voucherId?.toLowerCase().includes(search.toLowerCase()) ||
    s.customerName?.toLowerCase().includes(search.toLowerCase()) ||
    s.storeName?.toLowerCase().includes(search.toLowerCase())
  );

  function getPrice(productId: string) {
    const p = pricing.find(pr => pr.productId === productId);
    return p?.sellingPrice || 0;
  }

  function addProduct(prod: Product) {
    const existing = items.find(i => i.productId === prod.id);
    if (existing) { toast({ title: "Product already added" }); return; }
    const price = getPrice(prod.id);
    setItems(prev => [...prev, {
      productId: prod.id, productName: prod.name, productCode: prod.code,
      quantityPerCarton: prod.quantityPerCarton, photoUrl: prod.photoUrl || "",
      remainingStock: 0, sellingPrice: price, adjustedPrice: price,
      sellByCarton: false, quantity: 1, totalPrice: price
    }]);
    setProductSearch("");
  }

  function updateItem(idx: number, field: string, value: number | boolean) {
    setItems(prev => {
      const updated = [...prev];
      const item = { ...updated[idx], [field]: value };
      item.totalPrice = item.adjustedPrice * (item.sellByCarton ? item.quantity * item.quantityPerCarton : item.quantity);
      updated[idx] = item;
      return updated;
    });
  }

  function removeItem(idx: number) { setItems(prev => prev.filter((_, i) => i !== idx)); }

  const subtotal = items.reduce((s, i) => s + i.totalPrice, 0);
  const remaining = Math.max(0, subtotal - form.amountPaid);

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadImage(file, "sales");
      setForm(f => ({ ...f, photoProofUrl: url }));
    } catch { toast({ title: "Upload failed", variant: "destructive" }); }
    finally { setUploading(false); }
  }

  function openEdit(sale: PosSale) {
    setEditingId(sale.id);
    setForm({
      customerId: sale.customerId || "",
      storeId: sale.storeId,
      paymentMethod: sale.paymentMethod,
      transferType: sale.transferType || "supplier",
      supplierId: sale.supplierId || "",
      accountId: sale.accountId || "",
      fsNumber: sale.fsNumber || "",
      amountPaid: sale.amountPaid,
      remark: sale.remark || "",
      photoProofUrl: sale.photoProofUrl || "",
      voucherDate: sale.voucherDate || new Date().toISOString().slice(0, 10),
    });
    setItems(sale.items);
    setShowForm(true);
  }

  function resetForm() {
    setEditingId(null);
    setForm({ customerId: "", storeId: "", paymentMethod: "cash", transferType: "supplier", supplierId: "", accountId: "", fsNumber: "", amountPaid: 0, remark: "", photoProofUrl: "", voucherDate: new Date().toISOString().slice(0, 10) });
    setItems([]);
    setProductSearch("");
  }

  async function checkStockAvailability(): Promise<boolean> {
    if (!form.storeId) return true;
    const stockMap = await computeStockBalances(form.storeId);
    for (const item of items) {
      const qty = item.sellByCarton ? item.quantity * item.quantityPerCarton : item.quantity;
      const available = stockMap[item.productId]?.quantity || 0;
      if (qty > available) {
        toast({
          title: "Insufficient stock",
          description: `"${item.productName}" only has ${available} unit(s) available in this store.`,
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
      if (!form.storeId || items.length === 0) {
        toast({ title: "Select a store and add products", variant: "destructive" });
        return;
      }
      const stockOk = await checkStockAvailability();
      if (!stockOk) return;
      const store = stores.find(s => s.id === form.storeId);
      const customer = customers.find(c => c.id === form.customerId);
      const supplier = form.paymentMethod === "transfer" && form.transferType === "supplier"
        ? suppliers.find(s => s.id === form.supplierId) : undefined;
      const account = form.paymentMethod === "transfer" && form.transferType === "account"
        ? accounts.find(a => a.id === form.accountId) : undefined;
      const newSubtotal = items.reduce((s, i) => s + i.totalPrice, 0);
      const newRemaining = Math.max(0, newSubtotal - form.amountPaid);

      // FS Number uniqueness check
      if (form.paymentMethod === "transfer" && form.fsNumber) {
        const [existingSupp, existingCust, existingAccVouchers] = await Promise.all([
          getAll<SupplierPayment>(COLLECTIONS.SUPPLIER_PAYMENTS),
          getAll<{ fsNumber?: string }>(COLLECTIONS.CUSTOMER_PAYMENTS),
          getAll<AccountVoucher>(COLLECTIONS.ACCOUNT_VOUCHERS),
        ]);
        const inSupp = existingSupp.find(p => p.fsNumber === form.fsNumber && (!editingId));
        const inCust = existingCust.find(p => p.fsNumber === form.fsNumber);
        const inAcc = existingAccVouchers.find(v => v.fsNumber === form.fsNumber && !v.isVoided);
        if (inSupp || inCust || inAcc) {
          const where = inSupp ? "Supplier Payments" : inCust ? "Customer Payments" : "Account Vouchers";
          toast({ title: `FS Number "${form.fsNumber}" already used`, description: `Found in: ${where}`, variant: "destructive" });
          return;
        }
      }

      // Normalize carton items to actual piece quantities before saving
      const normalizedItems = items.map(item => ({
        ...item,
        quantity: item.sellByCarton ? item.quantity * (item.quantityPerCarton || 1) : item.quantity,
        sellByCarton: false,
      }));

      const transferFields = form.paymentMethod === "transfer" ? {
        transferType: form.transferType,
        supplierId: form.transferType === "supplier" ? form.supplierId : "",
        supplierName: form.transferType === "supplier" ? (supplier?.name || "") : "",
        accountId: form.transferType === "account" ? form.accountId : "",
        accountName: form.transferType === "account" ? (account ? `${account.bankName} - ${account.personName}` : "") : "",
        accountBankName: form.transferType === "account" ? (account?.bankName || "") : "",
        accountPersonName: form.transferType === "account" ? (account?.personName || "") : "",
        accountNumber: form.transferType === "account" ? (account?.accountNumber || "") : "",
        fsNumber: form.fsNumber,
      } : {};

      if (editingId) {
        const oldSale = sales.find(s => s.id === editingId);
        await update(COLLECTIONS.POS_SALES, editingId, {
          customerId: form.customerId,
          customerName: customer?.name || "Walk-in",
          storeId: form.storeId,
          storeName: store?.name || "",
          items: normalizedItems,
          subtotal: newSubtotal,
          totalAmount: newSubtotal,
          paymentMethod: form.paymentMethod,
          ...transferFields,
          amountPaid: form.amountPaid,
          remainingBalance: newRemaining,
          remark: form.remark,
          photoProofUrl: form.photoProofUrl,
          voucherDate: form.voucherDate,
        } as Record<string, unknown>);
        if (customer && oldSale) {
          const balanceDiff = newRemaining - (oldSale.remainingBalance || 0);
          if (balanceDiff !== 0) {
            await update(COLLECTIONS.CUSTOMERS, customer.id, {
              totalBalance: Math.max(0, (customer.totalBalance || 0) + balanceDiff),
            });
          }
        }
        toast({ title: "Sale updated" });
      } else {
        const data: Omit<PosSale, "id"> = {
          voucherId: await generateSerialVoucherId("POS"),
          customerId: form.customerId,
          customerName: customer?.name || "Walk-in",
          storeId: form.storeId,
          storeName: store?.name || "",
          items: normalizedItems,
          subtotal: newSubtotal,
          totalAmount: newSubtotal,
          paymentMethod: form.paymentMethod,
          ...transferFields,
          amountPaid: form.amountPaid,
          remainingBalance: newRemaining,
          remark: form.remark,
          photoProofUrl: form.photoProofUrl,
          voucherDate: form.voucherDate,
          status: isAdmin ? "active" : "pending",
          createdByName: user?.name || "",
        };
        const newId = await create(COLLECTIONS.POS_SALES, data as Record<string, unknown>);
        if (isAdmin && customer && newRemaining > 0) {
          await update(COLLECTIONS.CUSTOMERS, customer.id, {
            totalBalance: (customer.totalBalance || 0) + newRemaining,
          });
        }
        // Supplier transfer: record payment to supplier (increases totalPaid, decreases totalBalance)
        if (isAdmin && supplier && form.amountPaid > 0) {
          const newPaid = (supplier.totalPaid || 0) + form.amountPaid;
          const newBalance = Math.max(0, (supplier.totalBalance || 0) - form.amountPaid);
          await Promise.all([
            create(COLLECTIONS.SUPPLIER_PAYMENTS, {
              supplierId: supplier.id,
              supplierName: supplier.name,
              amountPaid: form.amountPaid,
              remainingBalance: newBalance,
              fsNumber: form.fsNumber,
              note: form.remark,
              paymentDate: new Date().toISOString().slice(0, 10),
              photoProofUrl: form.photoProofUrl,
            }),
            update(COLLECTIONS.SUPPLIERS, supplier.id, { totalPaid: newPaid, totalBalance: newBalance }),
          ]);
        }
        // Account transfer: record deposit to account and recompute balance
        if (isAdmin && account && form.amountPaid > 0) {
          const avVoucherId = await generateSerialVoucherId("AV");
          await create(COLLECTIONS.ACCOUNT_VOUCHERS, {
            voucherId: avVoucherId,
            accountId: account.id,
            accountBankName: account.bankName,
            accountPersonName: account.personName,
            accountNumber: account.accountNumber,
            type: "deposit",
            amount: form.amountPaid,
            fsNumber: form.fsNumber,
            customerName: customer?.name || "Walk-in",
            note: form.remark,
            date: new Date().toISOString().slice(0, 10),
            photoProofUrl: form.photoProofUrl,
            createdByName: user?.name || "",
          } as Record<string, unknown>);
          // Recompute account balance
          const allVouchers = await getAll<AccountVoucher>(COLLECTIONS.ACCOUNT_VOUCHERS);
          const active = allVouchers.filter(v => v.accountId === account.id && !v.isVoided);
          const totalDeposit = active.filter(v => v.type === "deposit").reduce((s, v) => s + v.amount, 0);
          const totalWithdraw = active.filter(v => v.type === "withdraw").reduce((s, v) => s + v.amount, 0);
          await update(COLLECTIONS.ACCOUNTS, account.id, { totalDeposit, totalWithdraw, balance: totalDeposit - totalWithdraw });
        }
        toast({ title: isAdmin ? "Sale recorded" : "Submitted for admin approval" });
        setShowForm(false);
        resetForm();
        loadData();
        setShowVoucher({ ...data, id: newId } as PosSale);
        return;
      }

      setShowForm(false);
      resetForm();
      loadData();
    } finally {
      setSaving(false);
    }
  }

  async function handleApprove(sale: PosSale) {
    await update(COLLECTIONS.POS_SALES, sale.id, { status: "active" });
    const customer = customers.find(c => c.id === sale.customerId);
    if (customer && (sale.remainingBalance || 0) > 0) {
      await update(COLLECTIONS.CUSTOMERS, customer.id, {
        totalBalance: (customer.totalBalance || 0) + (sale.remainingBalance || 0),
      });
    }
    toast({ title: "Sale approved" });
    loadData();
  }

  function handleVoid(sale: PosSale) {
    confirmDelete(async () => {
      await update(COLLECTIONS.POS_SALES, sale.id, { status: "voided" });
      toast({ title: "Sale voided" });
      loadData();
    });
  }

  async function handleActivate(sale: PosSale) {
    await update(COLLECTIONS.POS_SALES, sale.id, { status: "active" });
    toast({ title: "Sale activated" });
    loadData();
  }

  function handleDelete(sale: PosSale) {
    confirmDelete(async () => {
      await remove(COLLECTIONS.POS_SALES, sale.id);
      // Reverse customer balance
      if (sale.customerId && sale.remainingBalance > 0) {
        const customer = customers.find(c => c.id === sale.customerId);
        if (customer) {
          await update(COLLECTIONS.CUSTOMERS, customer.id, {
            totalBalance: Math.max(0, (customer.totalBalance || 0) - sale.remainingBalance),
          });
        }
      }
      toast({ title: "Sale deleted" });
      loadData();
    });
  }

  const handlePrint = useReactToPrint({ contentRef: receiptRef });
  const [sharingPdf, setSharingPdf] = useState(false);
  async function handleShare() {
    if (!receiptRef.current) return;
    setSharing(true);
    const r = await shareAsImage(receiptRef.current, "pos_receipt.png");
    if (r === "failed") toast({ title: "Share failed", variant: "destructive" });
    setSharing(false);
  }
  async function handleSharePdf() {
    if (!receiptRef.current) return;
    setSharingPdf(true);
    const r = await shareAsPdf(receiptRef.current, "pos_receipt.pdf");
    if (r === "failed") toast({ title: "PDF share failed", variant: "destructive" });
    setSharingPdf(false);
  }

  function exportExcel(sale: PosSale) {
    const wb = XLSX.utils.book_new();
    const data = [["Product", "Code", "Qty", "Price", "Total"], ...sale.items.map(i => [i.productName, i.productCode, i.quantity, i.adjustedPrice, i.totalPrice])];
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, "Sale");
    XLSX.writeFile(wb, `${sale.voucherId}.xlsx`);
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
          <h1 className="text-2xl font-bold tracking-tight">POS Sales</h1>
          <p className="text-muted-foreground text-sm mt-1">Point-of-sale transactions</p>
        </div>
        <Button onClick={() => { resetForm(); setShowForm(true); }} data-testid="button-new-sale" className="flex-shrink-0">
          <Plus className="w-4 h-4 mr-2" /> New Sale
        </Button>
      </div>
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
        <Input className="pl-9" placeholder="Search sales..." value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search-sales" />
      </div>
      {loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 rounded" />)}</div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>{["Voucher", "Date", "Customer", "Store", "Total", "Payment", "Paid", "Balance", "Status", "Actions"].map(h => (
                <th key={h} className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(sale => (
                <tr key={sale.id} className="hover:bg-muted/30" data-testid={`row-sale-${sale.id}`}>
                  <td className="px-4 py-2 font-mono text-xs">{sale.voucherId}</td>
                  <td className="px-4 py-2 text-xs">{sale.voucherDate || "—"}</td>
                  <td className="px-4 py-2">{sale.customerName}</td>
                  <td className="px-4 py-2">{sale.storeName}</td>
                  <td className="px-4 py-2 font-medium">{fmt(sale.totalAmount)}</td>
                  <td className="px-4 py-2 capitalize">{sale.paymentMethod}</td>
                  <td className="px-4 py-2 text-green-600">{fmt(sale.amountPaid)}</td>
                  <td className="px-4 py-2 text-red-500">{fmt(sale.remainingBalance)}</td>
                  <td className="px-4 py-2">
                    <Badge
                      variant={sale.status === "active" ? "default" : sale.status === "pending" ? "outline" : "destructive"}
                      className={sale.status === "pending" ? "border-amber-500 text-amber-600 bg-amber-50" : ""}
                    >{sale.status}</Badge>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => setShowVoucher(sale)} data-testid={`button-view-${sale.id}`} title="View receipt">
                        <Eye className="w-3 h-3" />
                      </Button>
                      {isAdmin && sale.status === "pending" && (
                        <Button size="sm" variant="outline" className="text-emerald-600 border-emerald-400 hover:bg-emerald-50" onClick={() => handleApprove(sale)} title="Approve" data-testid={`button-approve-${sale.id}`}>
                          <CheckCircle className="w-3 h-3" />
                        </Button>
                      )}
                      {sale.status === "active" && (
                        <Button size="sm" variant="outline" onClick={() => openEdit(sale)} data-testid={`button-edit-${sale.id}`} title="Edit sale">
                          <Pencil className="w-3 h-3" />
                        </Button>
                      )}
                      {sale.status === "active" && (
                        <Button size="sm" variant="outline" className="text-orange-500 border-orange-300 hover:bg-orange-50" onClick={() => handleVoid(sale)} data-testid={`button-void-${sale.id}`} title="Void sale">
                          <Ban className="w-3 h-3" />
                        </Button>
                      )}
                      {isAdmin && sale.status === "voided" && (
                        <Button size="sm" variant="outline" className="text-green-600 border-green-400 hover:bg-green-50" onClick={() => handleActivate(sale)} title="Activate sale" data-testid={`button-activate-${sale.id}`}>
                          <RotateCcw className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={9} className="text-center py-10 text-muted-foreground">No sales found</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* New / Edit Sale Dialog */}
      <Dialog open={showForm} onOpenChange={open => { if (!open) { setShowForm(false); resetForm(); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-4xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit POS Sale" : "New POS Sale"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Customer</Label>
                <Select value={form.customerId} onValueChange={v => setForm(f => ({ ...f, customerId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Walk-in customer" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="walk-in">Walk-in</SelectItem>
                    {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Store *</Label>
                <Select value={form.storeId} onValueChange={v => setForm(f => ({ ...f, storeId: v }))}>
                  <SelectTrigger data-testid="select-store"><SelectValue placeholder="Select store" /></SelectTrigger>
                  <SelectContent>{stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Payment Method</Label>
                <Select value={form.paymentMethod} onValueChange={v => setForm(f => ({ ...f, paymentMethod: v as "cash" | "transfer" | "credit" }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="transfer">Transfer</SelectItem>
                    <SelectItem value="credit">Credit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
                <Label>Search Products</Label>
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
                    <div className="absolute z-10 top-full left-0 right-0 bg-card border rounded-b shadow-lg">
                      {productResults.map(p => (
                        <div key={p.id} className="px-4 py-2 hover:bg-muted cursor-pointer flex items-center gap-3" onClick={() => addProduct(p)}>
                          {p.photoUrl && <img src={p.photoUrl} alt={p.name} className="w-8 h-8 rounded object-cover" />}
                          <div>
                            <div className="font-medium text-sm">{p.name}</div>
                            <div className="text-xs text-muted-foreground">{p.code} · Price: {fmt(getPrice(p.id))}</div>
                          </div>
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
                    <tr>{["Product", "Price", "Adj. Price", "By Carton", "Qty", "Total", ""].map(h => <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y">
                    {items.map((item, idx) => (
                      <tr key={idx}>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            {item.photoUrl && <img src={item.photoUrl} alt={item.productName} className="w-7 h-7 rounded object-cover" />}
                            <span>{item.productName}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2">{fmt(item.sellingPrice)}</td>
                        <td className="px-3 py-2"><Input type="number" min={0} step={0.01} className="w-24 h-7 text-xs" value={item.adjustedPrice} onChange={e => updateItem(idx, "adjustedPrice", Number(e.target.value))} /></td>
                        <td className="px-3 py-2">
                          <input type="checkbox" checked={item.sellByCarton} onChange={e => updateItem(idx, "sellByCarton", e.target.checked)} />
                        </td>
                        <td className="px-3 py-2">
                          {(() => {
                            const avail = storeStockMap[item.productId] ?? 0;
                            const overstock = form.storeId && item.quantity > avail;
                            return (
                              <div className="flex flex-col gap-0.5">
                                <Input type="number" min={1} className={`w-20 h-7 text-xs ${overstock ? "border-red-400" : ""}`} value={item.quantity} onChange={e => updateItem(idx, "quantity", Number(e.target.value))} />
                                {form.storeId && <span className={`text-[10px] ${overstock ? "text-red-500 font-semibold" : "text-muted-foreground"}`}>Avail: {avail}</span>}
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-3 py-2 font-medium">{fmt(item.totalPrice)}</td>
                        <td className="px-3 py-2"><Button size="sm" variant="ghost" onClick={() => removeItem(idx)}><Trash2 className="w-3 h-3 text-destructive" /></Button></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted/30 font-semibold">
                    <tr>
                      <td colSpan={5} className="px-3 py-2 text-xs">Subtotal</td>
                      <td className="px-3 py-2 text-xs">{fmt(subtotal)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {form.paymentMethod === "transfer" && (
              <div className="rounded-lg border bg-blue-50/50 p-4 space-y-3">
                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Transfer Details</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Transfer To</Label>
                    <Select value={form.transferType} onValueChange={v => setForm(f => ({ ...f, transferType: v as "supplier" | "account", supplierId: "", accountId: "" }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="supplier">Supplier</SelectItem>
                        <SelectItem value="account">Account</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {form.transferType === "supplier" ? (
                    <div>
                      <Label>Supplier</Label>
                      <Select value={form.supplierId} onValueChange={v => setForm(f => ({ ...f, supplierId: v }))}>
                        <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                        <SelectContent>
                          {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <div>
                      <Label>Account</Label>
                      <Select value={form.accountId} onValueChange={v => setForm(f => ({ ...f, accountId: v }))}>
                        <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                        <SelectContent>
                          {accounts.map(a => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.bankName} — {a.personName} ({a.accountNumber})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
                <div>
                  <Label>FS Number</Label>
                  <Input
                    placeholder="Fiscal / receipt number"
                    value={form.fsNumber}
                    onChange={e => setForm(f => ({ ...f, fsNumber: e.target.value }))}
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Amount Paid (ETB)</Label>
                <Input type="number" min={0} step={0.01} value={form.amountPaid} onChange={e => setForm(f => ({ ...f, amountPaid: Number(e.target.value) }))} data-testid="input-amount-paid" />
              </div>
              <div>
                <Label>Balance Due (ETB)</Label>
                <Input value={remaining.toFixed(2)} readOnly className="bg-muted" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div><Label>Date</Label><Input type="date" value={form.voucherDate} onChange={e => setForm(f => ({ ...f, voucherDate: e.target.value }))} data-testid="input-voucher-date" /></div>
              <div><Label>Remark</Label><Input value={form.remark} onChange={e => setForm(f => ({ ...f, remark: e.target.value }))} /></div>
            </div>

            {form.paymentMethod === "transfer" && (
              <div>
                <Label>Transfer Photo Proof</Label>
                <Input type="file" accept="image/*" onChange={handlePhoto} />
                {uploading && <p className="text-xs text-muted-foreground mt-1">Uploading...</p>}
                {form.photoProofUrl && <img src={form.photoProofUrl} alt="Proof" className="mt-2 h-16 rounded" />}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowForm(false); resetForm(); }} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} data-testid="button-save-sale">
              {saving ? "Saving…" : editingId ? "Save Changes" : "Complete Sale"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Receipt */}
      <Dialog open={!!showVoucher} onOpenChange={() => setShowVoucher(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-xl">
          <DialogHeader><DialogTitle>Sale Receipt</DialogTitle></DialogHeader>
          {showVoucher && (
            <div ref={receiptRef} className="receipt-a4 p-4 space-y-4" style={{ position: "relative" }}>
              {showVoucher.status === "voided" && (
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", zIndex: 10 }}>
                  <span style={{ fontSize: "10rem", fontWeight: 900, color: "rgba(220,38,38,0.38)", transform: "rotate(-35deg)", letterSpacing: "0.12em", userSelect: "none", border: "10px solid rgba(220,38,38,0.38)", borderRadius: "8px", padding: "0 1.5rem", lineHeight: 1 }}>VOID</span>
                </div>
              )}
              <div className="text-center border-b pb-3">
                <h2 className="text-xl font-bold">SALES RECEIPT</h2>
                <p className="text-sm text-muted-foreground">Voucher: {showVoucher.voucherId}</p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-muted-foreground">Customer: </span>{showVoucher.customerName}</div>
                <div><span className="text-muted-foreground">Store: </span>{showVoucher.storeName}</div>
                <div className="col-span-2 space-y-0.5">
                  <div>
                    <span className="text-muted-foreground">Payment: </span>
                    <span className="capitalize">{showVoucher.paymentMethod}</span>
                    {showVoucher.paymentMethod === "transfer" && showVoucher.transferType === "supplier" && showVoucher.supplierName && (
                      <span className="ml-1 text-blue-700 font-medium">→ {showVoucher.supplierName}</span>
                    )}
                    {showVoucher.paymentMethod === "transfer" && showVoucher.transferType === "account" && (
                      <span className="ml-1 text-blue-700 font-medium">
                        → {showVoucher.accountBankName} — {showVoucher.accountPersonName}
                        {showVoucher.accountNumber && <span className="text-xs text-muted-foreground ml-1">({showVoucher.accountNumber})</span>}
                      </span>
                    )}
                  </div>
                  {showVoucher.paymentMethod === "transfer" && showVoucher.fsNumber && (
                    <div className="text-xs"><span className="text-muted-foreground">FS Number: </span><span className="font-mono font-semibold">{showVoucher.fsNumber}</span></div>
                  )}
                </div>
                <div><span className="text-muted-foreground">Status: </span><Badge variant={showVoucher.status === "active" ? "default" : "destructive"}>{showVoucher.status}</Badge></div>
              </div>
              <table className="w-full text-sm border-collapse border">
                <thead>
                  <tr className="bg-muted">
                    {["", "Code", "Product", "Qty", "Unit Price", "Total"].map(h => <th key={h} className="border px-2 py-1 text-left text-xs">{h}</th>)}
                  </tr>
                </thead>
                <tbody>{showVoucher.items.map((item, i) => (
                  <tr key={i}>
                    <td className="border px-2 py-1 text-center">
                      {item.photoUrl
                        ? <img src={item.photoUrl} alt={item.productName} className="w-8 h-8 rounded object-cover mx-auto" />
                        : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                    <td className="border px-2 py-1 text-xs font-mono text-muted-foreground">{item.productCode || "—"}</td>
                    <td className="border px-2 py-1 text-xs">{item.productName}</td>
                    <td className="border px-2 py-1 text-xs text-center">{item.quantity}</td>
                    <td className="border px-2 py-1 text-xs">{fmt(item.adjustedPrice)}</td>
                    <td className="border px-2 py-1 text-xs font-medium">{fmt(item.totalPrice)}</td>
                  </tr>
                ))}</tbody>
              </table>
              <div className="flex justify-end gap-6 text-sm">
                <div><span className="text-muted-foreground">Total: </span><span className="font-bold">{fmt(showVoucher.totalAmount)}</span></div>
                <div><span className="text-muted-foreground">Paid: </span><span className="text-green-600 font-semibold">{fmt(showVoucher.amountPaid)}</span></div>
                <div><span className="text-muted-foreground">Balance: </span><span className="text-red-500 font-semibold">{fmt(showVoucher.remainingBalance)}</span></div>
              </div>
              {showVoucher.photoProofUrl && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Payment Proof</p>
                  <img src={showVoucher.photoProofUrl} alt="Proof" className="rounded max-h-32 border" />
                </div>
              )}
              {/* Receipt footer */}
              <div className="border-t pt-3 mt-2 space-y-1 text-xs text-muted-foreground">
                <div className="flex justify-between"><span>Placed by:</span><span className="font-medium text-foreground">{showVoucher.storeName}</span></div>
                {showVoucher.remark && <div className="flex justify-between"><span>Remark:</span><span className="font-medium text-foreground">{showVoucher.remark}</span></div>}
                {showVoucher.createdByName && <div className="flex justify-between"><span>Created by:</span><span className="font-medium text-foreground">{showVoucher.createdByName}</span></div>}
                <div className="flex justify-between mt-2"><span>Page 1 of 1</span><span>{showVoucher.voucherDate || new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span></div>
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
