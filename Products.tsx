import { useState, useEffect, useRef } from "react";
import { Plus, Search, Package, Eye, Edit, Trash2, Ban, Printer, X, ImagePlus, ChevronLeft, ChevronRight, AlertTriangle, FileUp, FileDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useDeleteAuth } from "@/hooks/useDeleteAuth";
import { getAll, create, update, remove, COLLECTIONS, generateVoucherId, syncProductAcrossCollections } from "@/lib/firestore";
import { uploadImage } from "@/lib/cloudinary";
import type { Product, Category } from "@/lib/types";
import Barcode from "react-barcode";
import { useReactToPrint } from "react-to-print";
import * as XLSX from "xlsx";

const MAX_IMAGES = 5;

export default function Products() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showDialog, setShowDialog] = useState(false);
  const [showVoucher, setShowVoucher] = useState<Product | null>(null);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [lightbox, setLightbox] = useState<{ urls: string[]; idx: number } | null>(null);
  const [form, setForm] = useState({
    name: "", code: "", categoryId: "", quantityPerCarton: 1, minCartonAlert: 1,
    photoUrls: [] as string[], description: ""
  });
  const [importing, setImporting] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { confirmDelete, DeleteAuthDialog } = useDeleteAuth();
  const voucherRef = useRef<HTMLDivElement>(null);

  async function loadData() {
    setLoading(true);
    const [prods, cats] = await Promise.all([
      getAll<Product>(COLLECTIONS.PRODUCTS),
      getAll<Category>(COLLECTIONS.CATEGORIES)
    ]);
    setProducts(prods.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))));
    setCategories(cats);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  const filtered = products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.code.toLowerCase().includes(search.toLowerCase())
  );

  function getProductImages(p: Product): string[] {
    if (p.photoUrls && p.photoUrls.length > 0) return p.photoUrls;
    if (p.photoUrl) return [p.photoUrl];
    return [];
  }

  function openAdd() {
    setEditProduct(null);
    setForm({ name: "", code: "", categoryId: "", quantityPerCarton: 1, minCartonAlert: 1, photoUrls: [], description: "" });
    setShowDialog(true);
  }

  function openEdit(p: Product) {
    setEditProduct(p);
    const imgs = getProductImages(p);
    setForm({
      name: p.name, code: p.code, categoryId: p.categoryId,
      quantityPerCarton: p.quantityPerCarton, minCartonAlert: p.minCartonAlert,
      photoUrls: imgs, description: p.description || ""
    });
    setShowDialog(true);
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const remaining = MAX_IMAGES - form.photoUrls.length;
    const toUpload = files.slice(0, remaining);
    if (toUpload.length === 0) {
      toast({ title: `Maximum ${MAX_IMAGES} images allowed`, variant: "destructive" });
      return;
    }
    setUploadingIdx(-1);
    try {
      const urls = await Promise.all(toUpload.map(f => uploadImage(f, "products")));
      setForm(f => ({ ...f, photoUrls: [...f.photoUrls, ...urls].slice(0, MAX_IMAGES) }));
    } catch (err) {
      toast({ title: "Image upload failed", description: String(err instanceof Error ? err.message : err), variant: "destructive" });
    } finally {
      setUploadingIdx(null);
      e.target.value = "";
    }
  }

  function removeImage(idx: number) {
    setForm(f => ({ ...f, photoUrls: f.photoUrls.filter((_, i) => i !== idx) }));
  }

  function moveImage(from: number, to: number) {
    if (to < 0 || to >= form.photoUrls.length) return;
    const arr = [...form.photoUrls];
    const [item] = arr.splice(from, 1);
    arr.splice(to, 0, item);
    setForm(f => ({ ...f, photoUrls: arr }));
  }

  async function handleSave() {
    if (!form.name || !form.code) {
      toast({ title: "Name and code are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const cat = categories.find(c => c.id === form.categoryId);
      const data = {
        name: form.name,
        code: form.code,
        categoryId: form.categoryId,
        description: form.description,
        quantityPerCarton: form.quantityPerCarton,
        minCartonAlert: form.minCartonAlert,
        photoUrls: form.photoUrls,
        photoUrl: form.photoUrls[0] || "",
        categoryName: cat?.name || "",
        barcodeValue: form.code,
        voucherId: editProduct?.voucherId || generateVoucherId("PROD"),
        isVoided: false,
      };
      if (editProduct) {
        await update(COLLECTIONS.PRODUCTS, editProduct.id, data);
        toast({ title: "Updating product across all records…" });
        await syncProductAcrossCollections(editProduct.id, {
          name: data.name,
          code: data.code,
          photoUrl: data.photoUrl,
          categoryName: data.categoryName,
          quantityPerCarton: data.quantityPerCarton,
        });
        toast({ title: "Product updated everywhere", description: "Stock In, Sales, Transfers, Damage/Return, Store Requests and Balances now show the new details." });
      } else {
        await create(COLLECTIONS.PRODUCTS, data);
        toast({ title: "Product created" });
      }
      setShowDialog(false);
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Failed to save product", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(p: Product) {
    confirmDelete(async () => {
      await remove(COLLECTIONS.PRODUCTS, p.id);
      toast({ title: "Product deleted" });
      loadData();
    });
  }

  async function handleVoid(p: Product) {
    await update(COLLECTIONS.PRODUCTS, p.id, { isVoided: true });
    toast({ title: "Product voided" });
    loadData();
  }

  function exportExcel() {
    const rows = products.map(p => ({
      Name: p.name,
      Code: p.code,
      Category: p.categoryName || "",
      "Qty Per Carton": p.quantityPerCarton,
      "Min Alert": p.minCartonAlert,
      "Photo URL": p.photoUrl || "",
      Description: p.description || "",
      Status: p.isVoided ? "Voided" : "Active",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 24 }, { wch: 16 }, { wch: 18 }, { wch: 14 }, { wch: 10 }, { wch: 30 }, { wch: 30 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Products");
    XLSX.writeFile(wb, `products_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const wb = XLSX.read(arrayBuffer, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });

      if (rows.length === 0) {
        toast({ title: "No rows found in file", variant: "destructive" });
        return;
      }

      const existingCodes = new Set(products.map(p => p.code.trim().toLowerCase()));
      const seenInFile = new Set<string>();

      let imported = 0;
      let skippedInvalid = 0;
      let skippedDuplicate = 0;

      const getField = (row: Record<string, unknown>, ...keys: string[]) => {
        for (const k of keys) {
          if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== "") return String(row[k]).trim();
        }
        return "";
      };

      for (const row of rows) {
        const name = getField(row, "Name", "name", "Product Name", "product_name");
        const code = getField(row, "Code", "code", "Product Code", "product_code");

        if (!name || !code) {
          skippedInvalid++;
          continue;
        }

        const codeKey = code.toLowerCase();
        if (existingCodes.has(codeKey) || seenInFile.has(codeKey)) {
          skippedDuplicate++;
          continue;
        }
        seenInFile.add(codeKey);

        const categoryName = getField(row, "Category", "category", "Category Name", "category_name");
        const cat = categoryName
          ? categories.find(c => c.name.toLowerCase() === categoryName.toLowerCase())
          : undefined;

        const quantityPerCarton = Number(getField(row, "Qty Per Carton", "Carton Quantity", "qty_per_carton", "carton_quantity", "quantityPerCarton")) || 1;
        const minCartonAlert = Number(getField(row, "Min Alert", "min_alert", "minCartonAlert")) || 1;
        const photoUrl = getField(row, "Photo URL", "PhotoUrl", "photo_url", "photoUrl");
        const description = getField(row, "Description", "description");

        try {
          await create(COLLECTIONS.PRODUCTS, {
            name,
            code,
            categoryId: cat?.id || "",
            categoryName: cat?.name || categoryName,
            quantityPerCarton,
            minCartonAlert,
            photoUrl,
            photoUrls: photoUrl ? [photoUrl] : [],
            description,
            barcodeValue: code,
            voucherId: generateVoucherId("PROD"),
            isVoided: false,
          } as Record<string, unknown>);
          imported++;
        } catch {
          skippedInvalid++;
        }
      }

      if (imported > 0) {
        toast({
          title: `Successfully imported ${imported} product${imported === 1 ? "" : "s"}!`,
          description: skippedDuplicate || skippedInvalid
            ? `Skipped ${skippedDuplicate} duplicate${skippedDuplicate === 1 ? "" : "s"}, ${skippedInvalid} invalid row${skippedInvalid === 1 ? "" : "s"}.`
            : undefined,
        });
      } else {
        toast({
          title: "No products imported",
          description: `Skipped ${skippedDuplicate} duplicate${skippedDuplicate === 1 ? "" : "s"} and ${skippedInvalid} invalid row${skippedInvalid === 1 ? "" : "s"}.`,
          variant: "destructive",
        });
      }
      loadData();
    } catch (err) {
      toast({ title: "Import failed", description: String(err instanceof Error ? err.message : err), variant: "destructive" });
    } finally {
      setImporting(false);
      if (importFileRef.current) importFileRef.current.value = "";
    }
  }

  const handlePrint = useReactToPrint({
    contentRef: voucherRef,
    pageStyle: `
      @page { size: A4 portrait; margin: 12mm; }
      @media print {
        body * { visibility: hidden; }
        .receipt-a4, .receipt-a4 * { visibility: visible; }
        .receipt-a4 {
          position: fixed; top: 0; left: 0;
          width: 210mm; padding: 14mm;
          background: white; color: #000;
          font-size: 11pt; box-sizing: border-box;
        }
        .receipt-a4 table { width: 100%; border-collapse: collapse; }
        .receipt-a4 th, .receipt-a4 td { border: 1px solid #ccc; padding: 4pt 6pt; }
      }
    `,
  });

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Products</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage your product catalog</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={importFileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleImportFile}
            data-testid="input-import-products"
          />
          <Button
            variant="outline"
            className="flex-1 sm:flex-none min-w-[140px]"
            onClick={() => importFileRef.current?.click()}
            disabled={importing}
            data-testid="button-import-products"
          >
            {importing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileUp className="w-4 h-4 mr-2" />}
            {importing ? "Importing…" : "Import Products"}
          </Button>
          <Button
            variant="outline"
            className="flex-1 sm:flex-none min-w-[100px]"
            onClick={exportExcel}
            disabled={products.length === 0}
            data-testid="button-export-products"
          >
            <FileDown className="w-4 h-4 mr-2" /> Export
          </Button>
          <Button className="flex-1 sm:flex-none min-w-[100px]" onClick={openAdd} data-testid="button-add-product">
            <Plus className="w-4 h-4 mr-2" /> Add Product
          </Button>
        </div>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
        <Input
          className="pl-9"
          placeholder="Search by name or code..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          data-testid="input-search-products"
        />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-48 rounded-lg" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(p => {
            const imgs = getProductImages(p);
            return (
              <Card key={p.id} className={p.isVoided ? "opacity-50" : ""} data-testid={`card-product-${p.id}`}>
                <CardHeader className="flex flex-row items-start gap-3 pb-2">
                  <div
                    className="relative w-14 h-14 rounded overflow-hidden flex-shrink-0 cursor-pointer group"
                    onClick={() => imgs.length > 0 && setLightbox({ urls: imgs, idx: 0 })}
                  >
                    {imgs.length > 0 ? (
                      <>
                        <img src={imgs[0]} alt={p.name} className="w-full h-full object-cover group-hover:opacity-80 transition-opacity" />
                        {imgs.length > 1 && (
                          <span className="absolute bottom-0 right-0 bg-black/60 text-white text-[10px] px-1 rounded-tl font-medium">
                            +{imgs.length - 1}
                          </span>
                        )}
                      </>
                    ) : (
                      <div className="w-full h-full bg-muted flex items-center justify-center">
                        <Package className="w-6 h-6 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base truncate">{p.name}</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">Code: {p.code}</p>
                    <p className="text-xs text-muted-foreground">{p.categoryName}</p>
                  </div>
                  {p.isVoided && <Badge variant="destructive" className="text-xs">Voided</Badge>}
                </CardHeader>
                <CardContent>
                  <div className="text-xs text-muted-foreground mb-3">
                    <span>{p.quantityPerCarton} units/carton</span>
                    <span className="mx-2">·</span>
                    <span>Min alert: {p.minCartonAlert} cartons</span>
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    <Button size="sm" variant="outline" onClick={() => setShowVoucher(p)} data-testid={`button-view-${p.id}`}>
                      <Eye className="w-3 h-3 mr-1" /> View
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openEdit(p)} data-testid={`button-edit-${p.id}`}>
                      <Edit className="w-3 h-3 mr-1" /> Edit
                    </Button>
                    {!p.isVoided && (
                      <Button size="sm" variant="outline" onClick={() => handleVoid(p)} data-testid={`button-void-${p.id}`}>
                        <Ban className="w-3 h-3 mr-1" /> Void
                      </Button>
                    )}
                    <Button size="sm" variant="destructive" onClick={() => handleDelete(p)} data-testid={`button-delete-${p.id}`}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {filtered.length === 0 && (
            <div className="col-span-3 text-center py-16 text-muted-foreground">
              <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No products found</p>
            </div>
          )}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-lg">
          <DialogHeader>
            <DialogTitle>{editProduct ? "Edit Product" : "Add Product"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Product Name *</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} data-testid="input-product-name" />
              </div>
              <div>
                <Label>Product Code *</Label>
                <Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} data-testid="input-product-code" />
                {(() => {
                  const q = form.code.trim().toLowerCase();
                  if (q.length < 2) return null;
                  const similar = products.filter(p => {
                    if (editProduct && p.id === editProduct.id) return false;
                    const pc = (p.code || "").toLowerCase();
                    return pc.includes(q) || q.includes(pc);
                  });
                  if (similar.length === 0) return null;
                  return (
                    <div className="mt-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 flex gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-amber-700 mb-1">Similar code{similar.length > 1 ? "s" : ""} found</p>
                        <ul className="space-y-0.5">
                          {similar.slice(0, 5).map(p => (
                            <li key={p.id} className="text-xs text-amber-800 flex items-center gap-1.5">
                              <span className="font-mono bg-amber-100 rounded px-1 py-0.5 border border-amber-200">{p.code}</span>
                              <span className="truncate text-amber-600">{p.name}</span>
                            </li>
                          ))}
                          {similar.length > 5 && <li className="text-xs text-amber-500">+{similar.length - 5} more</li>}
                        </ul>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
            <div>
              <Label>Category</Label>
              <Select value={form.categoryId} onValueChange={v => setForm(f => ({ ...f, categoryId: v }))}>
                <SelectTrigger data-testid="select-category"><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Qty per Carton</Label>
                <Input type="number" min={1} value={form.quantityPerCarton} onChange={e => setForm(f => ({ ...f, quantityPerCarton: Number(e.target.value) }))} data-testid="input-qty-carton" />
              </div>
              <div>
                <Label>Min Carton Alert</Label>
                <Input type="number" min={1} value={form.minCartonAlert} onChange={e => setForm(f => ({ ...f, minCartonAlert: Number(e.target.value) }))} data-testid="input-min-alert" />
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} data-testid="input-description" />
            </div>

            {/* Multi-image upload */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Product Photos</Label>
                <span className="text-xs text-muted-foreground">{form.photoUrls.length}/{MAX_IMAGES}</span>
              </div>

              <div className="grid grid-cols-5 gap-2">
                {form.photoUrls.map((url, idx) => (
                  <div key={idx} className="relative group aspect-square rounded-lg overflow-hidden border-2 border-border">
                    <img src={url} alt={`Photo ${idx + 1}`} className="w-full h-full object-cover" />
                    {idx === 0 && (
                      <span className="absolute top-0 left-0 bg-primary text-primary-foreground text-[9px] px-1 py-0.5 rounded-br font-semibold">
                        Main
                      </span>
                    )}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                      {idx > 0 && (
                        <button
                          onClick={() => moveImage(idx, idx - 1)}
                          className="w-5 h-5 rounded bg-white/80 flex items-center justify-center hover:bg-white"
                          title="Move left"
                        >
                          <ChevronLeft className="w-3 h-3" />
                        </button>
                      )}
                      <button
                        onClick={() => removeImage(idx)}
                        className="w-5 h-5 rounded bg-red-500 flex items-center justify-center hover:bg-red-600"
                        title="Remove"
                      >
                        <X className="w-3 h-3 text-white" />
                      </button>
                      {idx < form.photoUrls.length - 1 && (
                        <button
                          onClick={() => moveImage(idx, idx + 1)}
                          className="w-5 h-5 rounded bg-white/80 flex items-center justify-center hover:bg-white"
                          title="Move right"
                        >
                          <ChevronRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                {form.photoUrls.length < MAX_IMAGES && (
                  <label
                    className={`aspect-square rounded-lg border-2 border-dashed border-border flex flex-col items-center justify-center cursor-pointer hover:border-primary hover:bg-muted/50 transition-colors ${uploadingIdx !== null ? "opacity-50 pointer-events-none" : ""}`}
                    data-testid="label-upload-photo"
                  >
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={handleImageUpload}
                      disabled={uploadingIdx !== null}
                      data-testid="input-photo"
                    />
                    {uploadingIdx !== null ? (
                      <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <>
                        <ImagePlus className="w-5 h-5 text-muted-foreground mb-1" />
                        <span className="text-[10px] text-muted-foreground text-center leading-tight px-1">Add Photo</span>
                      </>
                    )}
                  </label>
                )}
              </div>

              {form.photoUrls.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1.5">
                  First image is the main photo. Hover to reorder or remove.
                </p>
              )}
            </div>

            {form.code && (
              <div>
                <Label>Barcode Preview</Label>
                <div className="mt-1 p-2 bg-white rounded border">
                  <Barcode value={form.code} height={50} width={1.5} fontSize={12} />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)} disabled={saving || uploadingIdx !== null}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || uploadingIdx !== null} data-testid="button-save-product">
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Voucher Dialog */}
      <Dialog open={!!showVoucher} onOpenChange={() => setShowVoucher(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-md">
          <DialogHeader>
            <DialogTitle>Product Voucher</DialogTitle>
          </DialogHeader>
          {showVoucher && (() => {
            const imgs = getProductImages(showVoucher);
            return (
              <div ref={voucherRef} className="receipt-a4 p-4 space-y-4">
                <div className="text-center border-b pb-4">
                  <h2 className="text-lg font-bold">Product Voucher</h2>
                  <p className="text-sm text-muted-foreground">ID: {showVoucher.voucherId}</p>
                </div>
                {imgs.length > 0 && (
                  <div className="flex gap-2 justify-center flex-wrap">
                    {imgs.map((url, i) => (
                      <img
                        key={i}
                        src={url}
                        alt={`${showVoucher.name} ${i + 1}`}
                        className="h-20 w-20 rounded object-cover border cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={() => setLightbox({ urls: imgs, idx: i })}
                      />
                    ))}
                  </div>
                )}
                <table className="w-full text-sm">
                  <tbody>
                    {[
                      ["Name", showVoucher.name],
                      ["Code", showVoucher.code],
                      ["Category", showVoucher.categoryName || "—"],
                      ["Qty/Carton", showVoucher.quantityPerCarton],
                      ["Min Carton Alert", showVoucher.minCartonAlert],
                      ["Description", showVoucher.description || "—"],
                    ].map(([k, v]) => (
                      <tr key={k} className="border-b">
                        <td className="py-1.5 font-medium text-muted-foreground">{k}</td>
                        <td className="py-1.5 text-right">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex justify-center pt-2">
                  <Barcode value={showVoucher.barcodeValue || showVoucher.code} height={50} width={1.5} fontSize={12} />
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => handlePrint()}>
              <Printer className="w-4 h-4 mr-2" /> Print
            </Button>
            <Button onClick={() => setShowVoucher(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={() => setLightbox(null)}
        >
          <button
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
            onClick={() => setLightbox(null)}
          >
            <X className="w-5 h-5" />
          </button>
          <div className="relative max-w-3xl max-h-[80vh] flex items-center" onClick={e => e.stopPropagation()}>
            {lightbox.idx > 0 && (
              <button
                className="absolute left-2 z-10 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
                onClick={() => setLightbox(l => l ? { ...l, idx: l.idx - 1 } : null)}
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}
            <img
              src={lightbox.urls[lightbox.idx]}
              alt=""
              className="max-w-full max-h-[80vh] object-contain rounded-lg"
            />
            {lightbox.idx < lightbox.urls.length - 1 && (
              <button
                className="absolute right-2 z-10 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
                onClick={() => setLightbox(l => l ? { ...l, idx: l.idx + 1 } : null)}
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            )}
          </div>
          <div className="absolute bottom-4 flex gap-2">
            {lightbox.urls.map((_, i) => (
              <button
                key={i}
                className={`w-2 h-2 rounded-full transition-colors ${i === lightbox.idx ? "bg-white" : "bg-white/40"}`}
                onClick={e => { e.stopPropagation(); setLightbox(l => l ? { ...l, idx: i } : null); }}
              />
            ))}
          </div>
        </div>
      )}
      {DeleteAuthDialog}
    </div>
  );
}
