import { useState, useEffect, useRef } from "react";
import { Plus, Search, Edit, Trash2, Printer, FileDown, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useDeleteAuth } from "@/hooks/useDeleteAuth";
import { getAll, create, update, remove, COLLECTIONS } from "@/lib/firestore";
import { fmt } from "@/lib/currency";
import type { Product, PricingRecord } from "@/lib/types";
import { useReactToPrint } from "react-to-print";
import * as XLSX from "xlsx";

export default function Pricing() {
  const [products, setProducts] = useState<Product[]>([]);
  const [pricing, setPricing] = useState<PricingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showDialog, setShowDialog] = useState(false);
  const [editRecord, setEditRecord] = useState<PricingRecord | null>(null);
  const [form, setForm] = useState({ productId: "", unitCost: 0, profitMargin: 0, sellingPrice: 0, ecommercePiecePrice: 0 });
  const [productSearch, setProductSearch] = useState("");
  const [productDropdown, setProductDropdown] = useState(false);
  const productSearchRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const { confirmDelete, DeleteAuthDialog } = useDeleteAuth();
  const tableRef = useRef<HTMLDivElement>(null);
  const handlePrint = useReactToPrint({ contentRef: tableRef });

  async function loadData() {
    setLoading(true);
    const [prods, prices] = await Promise.all([
      getAll<Product>(COLLECTIONS.PRODUCTS),
      getAll<PricingRecord>(COLLECTIONS.PRICING),
    ]);
    setProducts(prods);
    setPricing(prices);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    const cost = form.unitCost;
    const margin = form.profitMargin;
    const sp = cost * (1 + margin / 100);
    setForm(f => ({ ...f, sellingPrice: Math.round(sp * 100) / 100 }));
  }, [form.unitCost, form.profitMargin]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (productSearchRef.current && !productSearchRef.current.contains(e.target as Node)) {
        setProductDropdown(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = pricing.filter(p =>
    (p.productName || "").toLowerCase().includes(search.toLowerCase()) ||
    (p.productCode || "").toLowerCase().includes(search.toLowerCase())
  );

  // Products not yet priced (for add mode)
  const unpricedProducts = products.filter(p => !p.isVoided && !pricing.some(r => r.productId === p.id));
  // For edit mode, include the currently edited product too
  const availableProducts = editRecord
    ? products.filter(p => !p.isVoided && (!pricing.some(r => r.productId === p.id) || p.id === editRecord.productId))
    : unpricedProducts;

  const filteredProductOptions = availableProducts.filter(p =>
    p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
    (p.code || "").toLowerCase().includes(productSearch.toLowerCase())
  );

  const selectedProduct = products.find(p => p.id === form.productId);

  function openAdd() {
    setEditRecord(null);
    setForm({ productId: "", unitCost: 0, profitMargin: 20, sellingPrice: 0, ecommercePiecePrice: 0 });
    setProductSearch("");
    setShowDialog(true);
  }

  function openEdit(r: PricingRecord) {
    setEditRecord(r);
    setForm({ productId: r.productId, unitCost: r.unitCost, profitMargin: r.profitMargin, sellingPrice: r.sellingPrice, ecommercePiecePrice: r.ecommercePiecePrice || 0 });
    const prod = products.find(p => p.id === r.productId);
    setProductSearch(prod ? `${prod.name} (${prod.code})` : "");
    setShowDialog(true);
  }

  async function handleSave() {
    if (!form.productId) { toast({ title: "Select a product", variant: "destructive" }); return; }
    if (!editRecord && pricing.some(r => r.productId === form.productId)) {
      toast({ title: "Price already exists", description: "This product already has a pricing record. Edit it instead.", variant: "destructive" }); return;
    }
    const prod = products.find(p => p.id === form.productId);
    const data = { ...form, productName: prod?.name || "", productCode: prod?.code || "" };
    if (editRecord) {
      await update(COLLECTIONS.PRICING, editRecord.id, data);
      toast({ title: "Price updated" });
    } else {
      await create(COLLECTIONS.PRICING, data);
      toast({ title: "Price saved" });
    }
    setShowDialog(false);
    loadData();
  }

  function handleDelete(r: PricingRecord) {
    confirmDelete(async () => {
      await remove(COLLECTIONS.PRICING, r.id);
      toast({ title: "Deleted" });
      loadData();
    });
  }

  function exportExcel() {
    const wb = XLSX.utils.book_new();
    const data = [
      ["Product", "Code", "Description", "Unit Cost (ETB)", "Margin %", "Selling Price (ETB)", "Carton Price (ETB)", "Units/Carton"],
      ...filtered.map(r => {
        const prod = products.find(p => p.id === r.productId);
        return [
          r.productName,
          r.productCode,
          prod?.description || "",
          r.unitCost,
          r.profitMargin,
          r.sellingPrice,
          r.sellingPrice * (prod?.quantityPerCarton || 1),
          prod?.quantityPerCarton || 1,
        ];
      }),
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, "Pricing");
    XLSX.writeFile(wb, `pricing_list_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pricing Management</h1>
          <p className="text-muted-foreground text-sm mt-1">Set product selling prices with profit margins</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => handlePrint()} disabled={filtered.length === 0}>
            <Printer className="w-4 h-4 mr-2" /> Print
          </Button>
          <Button variant="outline" onClick={exportExcel} disabled={filtered.length === 0}>
            <FileDown className="w-4 h-4 mr-2" /> Excel
          </Button>
          <Button onClick={openAdd} data-testid="button-add-price">
            <Plus className="w-4 h-4 mr-2" /> Add Price
          </Button>
        </div>
      </div>
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
        <Input className="pl-9" placeholder="Search products..." value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search-pricing" />
      </div>
      {loading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 rounded" />)}</div>
      ) : (
        <div ref={tableRef} className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {["Product", "Code", "Description", "Unit Cost", "Margin %", "Unit Price", "E-com Price", "Carton Price", "Actions"].map(h => (
                  <th key={h} className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(r => {
                const prod = products.find(p => p.id === r.productId);
                const cartonPrice = r.sellingPrice * (prod?.quantityPerCarton || 1);
                return (
                  <tr key={r.id} className="hover:bg-muted/30" data-testid={`row-pricing-${r.id}`}>
                    <td className="px-4 py-3 font-medium">{r.productName}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{r.productCode}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs max-w-32 truncate">{prod?.description || "—"}</td>
                    <td className="px-4 py-3 text-xs">{fmt(r.unitCost)}</td>
                    <td className="px-4 py-3 text-xs">{r.profitMargin}%</td>
                    <td className="px-4 py-3 font-semibold text-primary">{fmt(r.sellingPrice)}</td>
                    <td className="px-4 py-3 text-xs font-medium text-violet-600">
                      {r.ecommercePiecePrice && r.ecommercePiecePrice > 0
                        ? <span className="font-semibold">{fmt(r.ecommercePiecePrice)}</span>
                        : <span className="text-muted-foreground text-xs italic">—</span>}
                    </td>
                    <td className="px-4 py-3 text-xs font-medium text-blue-600">
                      {prod && (prod.quantityPerCarton || 1) > 1
                        ? <span>{fmt(cartonPrice)}<span className="text-muted-foreground font-normal"> /{prod.quantityPerCarton} pcs</span></span>
                        : <span className="text-muted-foreground">—</span>
                      }
                    </td>
                    <td className="px-4 py-3 print:hidden">
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => openEdit(r)} data-testid={`button-edit-${r.id}`}><Edit className="w-3 h-3" /></Button>
                        <Button size="sm" variant="destructive" onClick={() => handleDelete(r)} data-testid={`button-delete-${r.id}`}><Trash2 className="w-3 h-3" /></Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="text-center py-10 text-muted-foreground">No pricing records found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-md">
          <DialogHeader><DialogTitle>{editRecord ? "Edit Price" : "Add Price"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Product *</Label>
              <div ref={productSearchRef} className="relative mt-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    className="pl-9 pr-8"
                    placeholder="Search product by name or code…"
                    value={productSearch}
                    onChange={e => {
                      setProductSearch(e.target.value);
                      setProductDropdown(true);
                      if (!e.target.value) setForm(f => ({ ...f, productId: "" }));
                    }}
                    onFocus={() => setProductDropdown(true)}
                    data-testid="input-product-search"
                  />
                  {form.productId && (
                    <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => { setForm(f => ({ ...f, productId: "" })); setProductSearch(""); setProductDropdown(true); }}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {productDropdown && filteredProductOptions.length > 0 && (
                  <div className="absolute z-50 w-full bg-white border rounded-md shadow-lg mt-1 max-h-48 overflow-y-auto">
                    {filteredProductOptions.map(p => (
                      <button key={p.id} className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => {
                          setForm(f => ({ ...f, productId: p.id }));
                          setProductSearch(`${p.name} (${p.code})`);
                          setProductDropdown(false);
                        }}>
                        {p.photoUrl && <img src={p.photoUrl} alt={p.name} className="w-7 h-7 rounded object-cover flex-shrink-0" />}
                        <div>
                          <div className="font-medium">{p.name}</div>
                          <div className="text-xs text-muted-foreground">{p.code}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {productDropdown && filteredProductOptions.length === 0 && productSearch && (
                  <div className="absolute z-50 w-full bg-white border rounded-md shadow-lg mt-1 px-3 py-2 text-sm text-muted-foreground">
                    {editRecord ? "No other products found" : "No unpriced products match — all products may already have prices"}
                  </div>
                )}
              </div>
              {selectedProduct && (
                <p className="text-xs text-green-600 mt-1">Selected: <span className="font-medium">{selectedProduct.name}</span></p>
              )}
              {!editRecord && unpricedProducts.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">All products already have pricing records.</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Unit Cost (ETB)</Label>
                <Input type="number" min={0} step={0.01} value={form.unitCost} onChange={e => setForm(f => ({ ...f, unitCost: Number(e.target.value) }))} data-testid="input-unit-cost" />
              </div>
              <div>
                <Label>Profit Margin (%)</Label>
                <Input type="number" min={0} step={0.1} value={form.profitMargin} onChange={e => setForm(f => ({ ...f, profitMargin: Number(e.target.value) }))} data-testid="input-margin" />
              </div>
            </div>
            <div>
              <Label>Selling Price (ETB)</Label>
              <Input type="number" value={form.sellingPrice} readOnly className="bg-muted" data-testid="input-selling-price" />
              <p className="text-xs text-muted-foreground mt-1">Auto-calculated from cost + margin</p>
            </div>
            <div className="border rounded-lg p-3 bg-violet-50/50 space-y-1">
              <Label className="text-violet-700 font-semibold">E-commerce Piece Price (ETB)</Label>
              <Input
                type="number"
                min={0}
                step={0.01}
                value={form.ecommercePiecePrice}
                onChange={e => setForm(f => ({ ...f, ecommercePiecePrice: Number(e.target.value) }))}
                placeholder="0.00"
                data-testid="input-ecommerce-piece-price"
              />
              <p className="text-xs text-muted-foreground">Price shown per piece on the E-commerce website. If left at 0, the standard selling price is used.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button onClick={handleSave} data-testid="button-save-price">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {DeleteAuthDialog}
    </div>
  );
}
