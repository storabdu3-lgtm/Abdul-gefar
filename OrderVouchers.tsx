import { useState, useEffect, useRef } from "react";
import { fmt } from "@/lib/currency";
import { Search, CheckCircle, XCircle, Eye, Printer, Share2, FileDown, Trash2, Minus, Plus, Package, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { getAll, create, update, COLLECTIONS, generateVoucherId, generateSerialVoucherId } from "@/lib/firestore";
import { computeStockBalances } from "@/lib/stockUtils";
import { shareAsImage, shareAsPdf } from "@/lib/shareImage";
import { uploadImage } from "@/lib/cloudinary";
import type { EcommerceOrder, Store, Customer } from "@/lib/types";
import { useReactToPrint } from "react-to-print";
import * as XLSX from "xlsx";

type PaymentMethod = "cash" | "transfer" | "credit";

interface EditItem {
  productId: string;
  productName: string;
  productCode: string;
  photoUrl: string;
  price: number;
  quantity: number;
  totalPrice: number;
}

export default function OrderVouchers() {
  const [orders, setOrders] = useState<EcommerceOrder[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showVoucher, setShowVoucher] = useState<EcommerceOrder | null>(null);
  const [approveDialog, setApproveDialog] = useState<EcommerceOrder | null>(null);
  const [editItems, setEditItems] = useState<EditItem[]>([]);
  const [selectedStore, setSelectedStore] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [amountPaid, setAmountPaid] = useState(0);
  const [photoProofUrl, setPhotoProofUrl] = useState("");
  const [remark, setRemark] = useState("");
  const [uploading, setUploading] = useState(false);
  const [approving, setApproving] = useState(false);
  const [stockLoading, setStockLoading] = useState(false);
  const [storeStockMap, setStoreStockMap] = useState<Record<string, Record<string, number>>>({});
  const { toast } = useToast();
  const [sharing, setSharing] = useState(false);
  const receiptRef = useRef<HTMLDivElement>(null);

  async function loadData() {
    setLoading(true);
    const [ords, sts, custs] = await Promise.all([
      getAll<EcommerceOrder>(COLLECTIONS.ORDER_VOUCHERS),
      getAll<Store>(COLLECTIONS.STORES),
      getAll<Customer>(COLLECTIONS.CUSTOMERS),
    ]);
    setOrders(ords.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))));
    setStores(sts);
    setCustomers(custs);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  const filtered = orders.filter(o =>
    o.orderVoucherId?.toLowerCase().includes(search.toLowerCase()) ||
    o.customerName?.toLowerCase().includes(search.toLowerCase())
  );

  async function openApprove(order: EcommerceOrder) {
    const items: EditItem[] = order.items.map(i => ({
      productId: i.productId,
      productName: i.productName,
      productCode: i.productCode,
      photoUrl: i.photoUrl || "",
      price: i.price,
      quantity: i.quantity,
      totalPrice: i.price * i.quantity,
    }));
    setEditItems(items);
    setApproveDialog(order);
    setSelectedStore("");
    setPaymentMethod("cash");
    const total = items.reduce((s, i) => s + i.totalPrice, 0);
    setAmountPaid(total);
    setPhotoProofUrl("");
    setRemark("");
    setStoreStockMap({});
    setStockLoading(true);
    try {
      const results = await Promise.all(
        stores.map(async s => {
          const bal = await computeStockBalances(s.id);
          const productQtys: Record<string, number> = {};
          for (const item of items) {
            productQtys[item.productId] = bal[item.productId]?.quantity ?? 0;
          }
          return { storeId: s.id, qtys: productQtys };
        })
      );
      const map: Record<string, Record<string, number>> = {};
      for (const r of results) map[r.storeId] = r.qtys;
      setStoreStockMap(map);
    } finally {
      setStockLoading(false);
    }
  }

  function updateItemQty(idx: number, qty: number) {
    if (qty < 1) return;
    setEditItems(prev => {
      const updated = prev.map((item, i) =>
        i === idx ? { ...item, quantity: qty, totalPrice: item.price * qty } : item
      );
      const newTotal = updated.reduce((s, i) => s + i.totalPrice, 0);
      setAmountPaid(newTotal);
      return updated;
    });
  }

  function updateItemPrice(idx: number, price: number) {
    const p = Math.max(0, price);
    setEditItems(prev => {
      const updated = prev.map((item, i) =>
        i === idx ? { ...item, price: p, totalPrice: p * item.quantity } : item
      );
      const newTotal = updated.reduce((s, i) => s + i.totalPrice, 0);
      setAmountPaid(newTotal);
      return updated;
    });
  }

  function removeItem(idx: number) {
    setEditItems(prev => {
      const updated = prev.filter((_, i) => i !== idx);
      const newTotal = updated.reduce((s, i) => s + i.totalPrice, 0);
      setAmountPaid(newTotal);
      return updated;
    });
  }

  const editTotal = editItems.reduce((s, i) => s + i.totalPrice, 0);
  const approveBalance = Math.max(0, editTotal - amountPaid);

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadImage(file, "orders");
      setPhotoProofUrl(url);
    } catch {
      toast({ title: "Upload failed", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function handleApprove() {
    if (!approveDialog || !selectedStore) {
      toast({ title: "Select a store to fulfill the order", variant: "destructive" });
      return;
    }
    if (editItems.length === 0) {
      toast({ title: "Order must have at least one item", variant: "destructive" });
      return;
    }
    const store = stores.find(s => s.id === selectedStore);
    const total = editTotal;
    const paid = Math.min(amountPaid, total);
    const remaining = Math.max(0, total - paid);

    const customer = approveDialog.customerId
      ? customers.find(c => c.id === approveDialog.customerId)
      : customers.find(c => c.name.toLowerCase() === approveDialog.customerName.toLowerCase());

    setApproving(true);
    try {
      // Stock check against selected store
      const stockMap = await computeStockBalances(selectedStore);
      for (const item of editItems) {
        const available = stockMap[item.productId]?.quantity || 0;
        if (item.quantity > available) {
          toast({
            title: "Insufficient stock",
            description: `"${item.productName}" only has ${available} unit(s) available in the selected store.`,
            variant: "destructive",
          });
          return;
        }
      }

      await update(COLLECTIONS.ORDER_VOUCHERS, approveDialog.id, {
        status: "approved",
        storeId: selectedStore,
        items: editItems,
        totalAmount: total,
      });

      await create(COLLECTIONS.POS_SALES, {
        voucherId: await generateSerialVoucherId("POS"),
        customerId: customer?.id || approveDialog.customerId || "",
        customerName: approveDialog.customerName,
        storeId: selectedStore,
        storeName: store?.name || "",
        items: editItems.map(i => ({
          productId: i.productId,
          productName: i.productName,
          productCode: i.productCode,
          photoUrl: i.photoUrl || "",
          quantityPerCarton: 1,
          remainingStock: 0,
          sellingPrice: i.price,
          adjustedPrice: i.price,
          sellByCarton: false,
          quantity: i.quantity,
          totalPrice: i.totalPrice,
        })),
        subtotal: total,
        totalAmount: total,
        paymentMethod,
        amountPaid: paid,
        remainingBalance: remaining,
        remark,
        photoProofUrl,
        status: "active",
      });

      if (customer) {
        await update(COLLECTIONS.CUSTOMERS, customer.id, {
          totalPaid: (customer.totalPaid || 0) + paid,
          totalBalance: Math.max(0, (customer.totalBalance || 0) + remaining),
        });
      }

      toast({ title: "Order approved and converted to sale" });
      setApproveDialog(null);
      loadData();
    } finally {
      setApproving(false);
    }
  }

  async function handleDeny(order: EcommerceOrder) {
    if (!confirm("Deny this order?")) return;
    await update(COLLECTIONS.ORDER_VOUCHERS, order.id, { status: "denied" });
    toast({ title: "Order denied" });
    loadData();
  }

  const statusVariant = (status: string) => {
    if (status === "approved" || status === "converted") return "default";
    if (status === "denied") return "destructive";
    return "secondary";
  };

  const handlePrint = useReactToPrint({ contentRef: receiptRef });
  const [sharingPdf, setSharingPdf] = useState(false);
  async function handleShare() {
    if (!receiptRef.current) return;
    setSharing(true);
    const r = await shareAsImage(receiptRef.current, "order_voucher.png");
    if (r === "failed") toast({ title: "Share failed", variant: "destructive" });
    setSharing(false);
  }
  async function handleSharePdf() {
    if (!receiptRef.current) return;
    setSharingPdf(true);
    const r = await shareAsPdf(receiptRef.current, "order_voucher.pdf");
    if (r === "failed") toast({ title: "PDF share failed", variant: "destructive" });
    setSharingPdf(false);
  }

  function exportExcel(order: EcommerceOrder) {
    const data = [
      ["Item", "Code", "Qty", "Unit Price", "Total"],
      ...order.items.map(i => [i.productName, i.productCode, i.quantity, i.price, i.totalPrice]),
      [],
      ["", "", "", "Grand Total", order.totalAmount],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Order");
    XLSX.writeFile(wb, `${order.orderVoucherId}.xlsx`);
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Order Vouchers</h1>
          <p className="text-muted-foreground text-sm">Review and process e-commerce orders</p>
        </div>
      </div>
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
        <Input className="pl-9" placeholder="Search orders..." value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search-orders" />
      </div>
      {loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 rounded" />)}</div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>{["Order ID", "Customer", "Items", "Total", "Status", "Actions"].map(h => (
                <th key={h} className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(order => (
                <tr key={order.id} className="hover:bg-muted/30" data-testid={`row-order-${order.id}`}>
                  <td className="px-4 py-2 font-mono text-xs">{order.orderVoucherId}</td>
                  <td className="px-4 py-2">{order.customerName}</td>
                  <td className="px-4 py-2">{order.items?.length || 0} items</td>
                  <td className="px-4 py-2 font-medium">{fmt(order.totalAmount)}</td>
                  <td className="px-4 py-2">
                    <Badge variant={statusVariant(order.status)}>{order.status}</Badge>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => setShowVoucher(order)} data-testid={`button-view-${order.id}`}>
                        <Eye className="w-3 h-3" />
                      </Button>
                      {order.status === "pending" && (
                        <>
                          <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => openApprove(order)} data-testid={`button-approve-${order.id}`}>
                            <CheckCircle className="w-3 h-3 mr-1" /> Allow
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => handleDeny(order)} data-testid={`button-deny-${order.id}`}>
                            <XCircle className="w-3 h-3 mr-1" /> Deny
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-muted-foreground">No orders found</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Approve Dialog ── */}
      <Dialog open={!!approveDialog} onOpenChange={open => { if (!open) setApproveDialog(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-2xl">
          <DialogHeader>
            <DialogTitle>Approve Order</DialogTitle>
            <DialogDescription>
              {approveDialog?.orderVoucherId} · {approveDialog?.customerName}
            </DialogDescription>
          </DialogHeader>

          {approveDialog && (
            <div className="space-y-5">
              {/* ── Editable items table ── */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-sm font-semibold">Order Items</Label>
                  <span className="text-xs text-muted-foreground">{editItems.length} item{editItems.length !== 1 ? "s" : ""}</span>
                </div>
                <div className="rounded-lg border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Product</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground w-24">Unit Price</th>
                        <th className="text-center px-3 py-2 text-xs font-medium text-muted-foreground w-28">Qty</th>
                        <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground w-20">Total</th>
                        <th className="px-2 py-2 w-8" />
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {editItems.map((item, idx) => (
                        <tr key={idx} className="hover:bg-muted/20">
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              {item.photoUrl ? (
                                <img src={item.photoUrl} alt={item.productName} className="w-8 h-8 rounded object-cover flex-shrink-0" />
                              ) : (
                                <div className="w-8 h-8 rounded bg-muted flex items-center justify-center flex-shrink-0 text-muted-foreground text-xs">?</div>
                              )}
                              <div className="min-w-0">
                                <p className="font-medium text-xs truncate">{item.productName}</p>
                                <p className="text-[10px] text-muted-foreground">{item.productCode}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="relative">
                              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                              <Input
                                type="number"
                                min={0}
                                step={0.01}
                                value={item.price}
                                onChange={e => updateItemPrice(idx, Number(e.target.value))}
                                className="pl-5 h-7 text-xs w-24"
                                data-testid={`input-item-price-${idx}`}
                              />
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={() => updateItemQty(idx, item.quantity - 1)}
                                disabled={item.quantity <= 1}
                                className="w-6 h-6 rounded border bg-white flex items-center justify-center hover:bg-muted disabled:opacity-40"
                                data-testid={`button-item-dec-${idx}`}
                              >
                                <Minus className="w-3 h-3" />
                              </button>
                              <Input
                                type="number"
                                min={1}
                                value={item.quantity}
                                onChange={e => updateItemQty(idx, Number(e.target.value))}
                                className="h-7 text-xs text-center w-12 px-1"
                                data-testid={`input-item-qty-${idx}`}
                              />
                              <button
                                onClick={() => updateItemQty(idx, item.quantity + 1)}
                                className="w-6 h-6 rounded border bg-white flex items-center justify-center hover:bg-muted"
                                data-testid={`button-item-inc-${idx}`}
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-xs">
                            ${item.totalPrice.toFixed(2)}
                          </td>
                          <td className="px-2 py-2">
                            <button
                              onClick={() => removeItem(idx)}
                              disabled={editItems.length <= 1}
                              className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-30 disabled:cursor-not-allowed"
                              title="Remove item"
                              data-testid={`button-item-remove-${idx}`}
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="px-3 py-2 bg-muted/30 border-t flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Order Total</span>
                    <span className="text-base font-bold">${editTotal.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* ── Stock Availability Panel ── */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-sm font-semibold flex items-center gap-1.5">
                    <Package className="w-4 h-4" /> Stock Availability by Store
                  </Label>
                  {stockLoading && <span className="text-xs text-muted-foreground animate-pulse">Loading…</span>}
                </div>
                {!stockLoading && Object.keys(storeStockMap).length > 0 ? (
                  <div className="rounded-lg border overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Store</th>
                          {editItems.map(item => (
                            <th key={item.productId} className="text-center px-2 py-2 font-medium text-muted-foreground max-w-[90px]">
                              <div className="truncate max-w-[80px] mx-auto" title={item.productName}>{item.productName}</div>
                              <div className="text-[10px] text-muted-foreground/70 font-normal">need: {item.quantity}</div>
                            </th>
                          ))}
                          <th className="text-center px-2 py-2 font-medium text-muted-foreground whitespace-nowrap">Can Fulfill</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {stores.map(store => {
                          const qtys = storeStockMap[store.id] || {};
                          const canFulfillAll = editItems.every(i => (qtys[i.productId] ?? 0) >= i.quantity);
                          const canFulfillSome = editItems.some(i => (qtys[i.productId] ?? 0) > 0);
                          return (
                            <tr
                              key={store.id}
                              className={`cursor-pointer transition-colors ${
                                selectedStore === store.id
                                  ? "bg-blue-50 ring-1 ring-inset ring-blue-200"
                                  : canFulfillAll
                                  ? "hover:bg-green-50/60"
                                  : "hover:bg-muted/30"
                              }`}
                              onClick={() => setSelectedStore(store.id)}
                            >
                              <td className="px-3 py-2 font-medium whitespace-nowrap">
                                <div className="flex items-center gap-1.5">
                                  {selectedStore === store.id && <CheckCircle className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />}
                                  {store.name}
                                </div>
                              </td>
                              {editItems.map(item => {
                                const qty = qtys[item.productId] ?? 0;
                                const enough = qty >= item.quantity;
                                const none = qty <= 0;
                                return (
                                  <td key={item.productId} className="px-2 py-2 text-center">
                                    <span className={`inline-block px-1.5 py-0.5 rounded font-semibold ${
                                      none ? "bg-red-100 text-red-600" :
                                      enough ? "bg-green-100 text-green-700" :
                                      "bg-amber-100 text-amber-700"
                                    }`}>
                                      {qty.toLocaleString()}
                                    </span>
                                  </td>
                                );
                              })}
                              <td className="px-2 py-2 text-center">
                                {canFulfillAll
                                  ? <Badge className="bg-green-500 hover:bg-green-500 text-xs px-1.5">Full</Badge>
                                  : canFulfillSome
                                  ? <Badge className="bg-amber-500 hover:bg-amber-500 text-xs px-1.5">Partial</Badge>
                                  : <Badge variant="destructive" className="text-xs px-1.5">None</Badge>
                                }
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <p className="px-3 py-1.5 text-[10px] text-muted-foreground bg-muted/20 border-t">
                      Click a row to select the store · Green = enough stock · Amber = partial · Red = none
                    </p>
                  </div>
                ) : !stockLoading ? (
                  <p className="text-xs text-muted-foreground italic">No stock data available</p>
                ) : null}
              </div>

              {/* Store */}
              <div>
                <Label>Fulfill from Store *</Label>
                <Select value={selectedStore} onValueChange={setSelectedStore}>
                  <SelectTrigger data-testid="select-store-approve">
                    <SelectValue placeholder="Select store" />
                  </SelectTrigger>
                  <SelectContent>
                    {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* Payment Method */}
              <div>
                <Label>Payment Method</Label>
                <Select value={paymentMethod} onValueChange={v => setPaymentMethod(v as PaymentMethod)}>
                  <SelectTrigger data-testid="select-payment-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="transfer">Bank Transfer</SelectItem>
                    <SelectItem value="credit">Credit</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Amount paid + balance */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Amount Paid (ETB)</Label>
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    value={amountPaid}
                    onChange={e => setAmountPaid(Number(e.target.value))}
                    data-testid="input-amount-paid-approve"
                  />
                </div>
                <div>
                  <Label>Balance Due ($)</Label>
                  <Input
                    value={approveBalance.toFixed(2)}
                    readOnly
                    className="bg-muted font-semibold text-red-500"
                  />
                </div>
              </div>

              {/* Transfer proof */}
              {paymentMethod === "transfer" && (
                <div>
                  <Label>Transfer Proof Photo</Label>
                  <Input type="file" accept="image/*" onChange={handlePhoto} />
                  {uploading && <p className="text-xs text-muted-foreground mt-1">Uploading…</p>}
                  {photoProofUrl && (
                    <img src={photoProofUrl} alt="proof" className="mt-2 h-20 rounded border object-cover" />
                  )}
                </div>
              )}

              {/* Remark */}
              <div>
                <Label>Remark</Label>
                <Input
                  placeholder="Optional note..."
                  value={remark}
                  onChange={e => setRemark(e.target.value)}
                />
              </div>
            </div>
          )}

          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => setApproveDialog(null)} disabled={approving}>Cancel</Button>
            <Button
              onClick={handleApprove}
              className="bg-green-600 hover:bg-green-700 text-white"
              disabled={approving}
              data-testid="button-confirm-approve"
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              {approving ? "Processing…" : "Approve & Convert"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Voucher Detail Dialog ── */}
      <Dialog open={!!showVoucher} onOpenChange={() => setShowVoucher(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-xl">
          <DialogHeader>
            <DialogTitle>Order Details</DialogTitle>
            <DialogDescription>
              {showVoucher?.orderVoucherId}
            </DialogDescription>
          </DialogHeader>
          {showVoucher && (
            <div ref={receiptRef} className="receipt-a4 p-4 space-y-4">
              <div className="text-center border-b pb-3">
                <h2 className="text-xl font-bold">CUSTOMER ORDER</h2>
                <p className="text-sm text-muted-foreground">Order ID: {showVoucher.orderVoucherId}</p>
                <Badge variant={statusVariant(showVoucher.status)} className="mt-1">{showVoucher.status}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-muted-foreground">Customer: </span>{showVoucher.customerName}</div>
                {showVoucher.customerPhone && <div><span className="text-muted-foreground">Phone: </span>{showVoucher.customerPhone}</div>}
                {showVoucher.customerAddress && <div className="col-span-2"><span className="text-muted-foreground">Address: </span>{showVoucher.customerAddress}</div>}
              </div>
              <table className="w-full text-sm border-collapse border">
                <thead>
                  <tr className="bg-muted">
                    {["Item", "Price", "Qty", "Total"].map(h => (
                      <th key={h} className="border px-2 py-1 text-xs text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {showVoucher.items?.map((item, i) => (
                    <tr key={i}>
                      <td className="border px-2 py-1 text-xs">
                        <div className="flex items-center gap-2">
                          {item.photoUrl && <img src={item.photoUrl} alt={item.productName} className="w-7 h-7 rounded object-cover" />}
                          {item.productName}
                        </div>
                      </td>
                      <td className="border px-2 py-1 text-xs">{fmt(item.price)}</td>
                      <td className="border px-2 py-1 text-xs text-center">{item.quantity}</td>
                      <td className="border px-2 py-1 text-xs font-medium">{fmt(item.totalPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex justify-end text-lg font-bold">
                <span>Total: <span className="text-primary">{fmt(showVoucher.totalAmount)}</span></span>
              </div>
              <div className="border-t pt-3 mt-2 space-y-1 text-xs text-muted-foreground">
                <div className="flex justify-between"><span>Customer:</span><span className="font-medium text-foreground">{showVoucher.customerName}</span></div>
                {showVoucher.status === "approved" && <div className="flex justify-between"><span>Status:</span><span className="font-medium text-green-600">Approved</span></div>}
                {showVoucher.createdByName && <div className="flex justify-between"><span>Created by:</span><span className="font-medium text-foreground">{showVoucher.createdByName}</span></div>}
                <div className="flex justify-between mt-2"><span>Page 1 of 1</span><span>{new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span></div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => showVoucher && exportExcel(showVoucher)}>
              <FileDown className="w-4 h-4 mr-2" /> Excel
            </Button>
            <Button variant="outline" onClick={handleSharePdf} disabled={sharingPdf}>
              <FileText className="w-4 h-4 mr-2" />{sharingPdf ? "Generating…" : "PDF Share"}
            </Button>
            <Button variant="outline" onClick={handleShare} disabled={sharing}>
              <Share2 className="w-4 h-4 mr-2" />{sharing ? "Sharing…" : "Share"}
            </Button>
            <Button variant="outline" onClick={() => handlePrint()}>
              <Printer className="w-4 h-4 mr-2" /> Print
            </Button>
            <Button onClick={() => setShowVoucher(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
