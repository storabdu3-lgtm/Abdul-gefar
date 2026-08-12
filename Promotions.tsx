import { useState, useEffect, useRef } from "react";
import { Plus, Minus, Search, Pencil, Trash2, Package, Megaphone, Video, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useDeleteAuth } from "@/hooks/useDeleteAuth";
import { getAll, create, update, COLLECTIONS } from "@/lib/firestore";
import { uploadImage, uploadVideo } from "@/lib/cloudinary";
import type { Product, Promotion } from "@/lib/types";

const MAX_VIDEO_SECONDS = 30;

export default function Promotions() {
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [previewVideo, setPreviewVideo] = useState<Promotion | null>(null);

  const [form, setForm] = useState({
    title: "", description: "", link: "", photoUrl: "", videoUrl: "",
    isActive: true, showBanner: true, showPopup: false, showHighlight: true, showVideo: false,
    displaySeconds: 30,
  });
  const [selectedProducts, setSelectedProducts] = useState<Product[]>([]);

  const videoInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { confirmDelete, DeleteAuthDialog } = useDeleteAuth();

  async function loadData() {
    setLoading(true);
    const [promos, prods] = await Promise.all([
      getAll<Promotion>(COLLECTIONS.PROMOTIONS),
      getAll<Product>(COLLECTIONS.PRODUCTS),
    ]);
    setPromotions(promos.filter(p => !p.isVoided).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))));
    setProducts(prods.filter(p => !p.isVoided));
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  function resetForm() {
    setForm({ title: "", description: "", link: "", photoUrl: "", videoUrl: "", isActive: true, showBanner: true, showPopup: false, showHighlight: true, showVideo: false, displaySeconds: 30 });
    setSelectedProducts([]);
    setEditingId(null);
    setProductSearch("");
    if (videoInputRef.current) videoInputRef.current.value = "";
  }

  function openNew() { resetForm(); setShowForm(true); }

  function openEdit(p: Promotion) {
    setEditingId(p.id);
    setForm({
      title: p.title, description: p.description || "", link: p.link || "",
      photoUrl: p.photoUrl || "", videoUrl: p.videoUrl || "",
      isActive: p.isActive, showBanner: p.showBanner, showPopup: p.showPopup,
      showHighlight: p.showHighlight, showVideo: p.showVideo ?? false,
      displaySeconds: p.displaySeconds ?? 30,
    });
    setSelectedProducts(products.filter(prod => p.productIds.includes(prod.id)));
    setShowForm(true);
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true);
    try { const url = await uploadImage(file); setForm(f => ({ ...f, photoUrl: url })); }
    catch { toast({ title: "Photo upload failed", variant: "destructive" }); }
    finally { setUploading(false); }
  }

  async function handleVideoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;

    const duration = await getVideoDuration(file);
    if (duration > MAX_VIDEO_SECONDS) {
      toast({ title: `Video too long (${Math.round(duration)}s). Max ${MAX_VIDEO_SECONDS} seconds allowed.`, variant: "destructive" });
      if (videoInputRef.current) videoInputRef.current.value = "";
      return;
    }

    setUploadingVideo(true);
    try {
      const url = await uploadVideo(file);
      setForm(f => ({ ...f, videoUrl: url, showVideo: true }));
      toast({ title: "Video uploaded successfully" });
    } catch (err: any) {
      toast({ title: err?.message || "Video upload failed", variant: "destructive" });
    } finally { setUploadingVideo(false); }
  }

  function getVideoDuration(file: File): Promise<number> {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => { URL.revokeObjectURL(video.src); resolve(video.duration); };
      video.onerror = reject;
      video.src = URL.createObjectURL(file);
    });
  }

  function removeVideo() {
    setForm(f => ({ ...f, videoUrl: "", showVideo: false }));
    if (videoInputRef.current) videoInputRef.current.value = "";
  }

  const filteredProducts = products.filter(p =>
    (p.name.toLowerCase().includes(productSearch.toLowerCase()) || p.code.toLowerCase().includes(productSearch.toLowerCase())) &&
    !selectedProducts.find(sp => sp.id === p.id)
  ).slice(0, 8);

  function addProduct(p: Product) { setSelectedProducts(prev => [...prev, p]); setProductSearch(""); }
  function removeProduct(id: string) { setSelectedProducts(prev => prev.filter(p => p.id !== id)); }

  async function handleSave() {
    if (!form.title) { toast({ title: "Enter a title", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const data: Omit<Promotion, "id"> = {
        ...form,
        productIds: selectedProducts.map(p => p.id),
        productNames: selectedProducts.map(p => p.name),
      };
      if (editingId) {
        await update(COLLECTIONS.PROMOTIONS, editingId, data as Record<string, unknown>);
        toast({ title: "Promotion updated" });
      } else {
        await create(COLLECTIONS.PROMOTIONS, data as Record<string, unknown>);
        toast({ title: "Promotion created" });
      }
      setShowForm(false); resetForm(); await loadData();
    } catch { toast({ title: "Failed", variant: "destructive" }); } finally { setSaving(false); }
  }

  async function toggleActive(p: Promotion) {
    await update(COLLECTIONS.PROMOTIONS, p.id, { isActive: !p.isActive });
    await loadData();
  }

  function handleDelete(p: Promotion) {
    confirmDelete(async () => {
      await update(COLLECTIONS.PROMOTIONS, p.id, { isVoided: true });
      toast({ title: "Deleted" }); await loadData();
    });
  }

  const filtered = promotions.filter(p =>
    p.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Promotions</h1>
          <p className="text-sm text-muted-foreground">Manage banners, popups, product highlights and promotion videos</p>
        </div>
        <Button onClick={openNew}>
          <Plus className="w-4 h-4 mr-2" /> New Promotion
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search promotions…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(promo => (
            <div key={promo.id} className="bg-card border rounded-xl overflow-hidden hover:shadow-md transition-shadow">
              {promo.videoUrl ? (
                <div className="relative w-full h-32 bg-black group cursor-pointer" onClick={() => setPreviewVideo(promo)}>
                  <video src={promo.videoUrl} className="w-full h-full object-cover opacity-80" muted />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="bg-black/60 rounded-full p-3 group-hover:bg-black/80 transition-colors">
                      <Play className="w-6 h-6 text-white fill-white" />
                    </div>
                  </div>
                  <span className="absolute top-2 right-2 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded font-mono">▶ Video</span>
                </div>
              ) : promo.photoUrl ? (
                <img src={promo.photoUrl} alt={promo.title} className="w-full h-32 object-cover" />
              ) : null}
              <div className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{promo.title}</div>
                    {promo.description && <div className="text-xs text-muted-foreground line-clamp-2">{promo.description}</div>}
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold flex-shrink-0 ${promo.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                    {promo.isActive ? "Active" : "Inactive"}
                  </span>
                </div>
                <div className="flex gap-1 flex-wrap">
                  {promo.showBanner && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Banner</span>}
                  {promo.showPopup && <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">Popup</span>}
                  {promo.showHighlight && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Highlight</span>}
                  {promo.videoUrl && <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full flex items-center gap-1"><Video className="w-3 h-3" /> Video</span>}
                </div>
                {promo.productIds.length > 0 && (
                  <div className="text-xs text-muted-foreground">{promo.productIds.length} product{promo.productIds.length !== 1 ? "s" : ""} featured</div>
                )}
                <div className="flex items-center gap-1 pt-1">
                  <Button size="sm" variant="outline" onClick={() => toggleActive(promo)}>
                    {promo.isActive ? "Deactivate" : "Activate"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => openEdit(promo)}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button size="sm" variant="ghost" className="text-red-500" onClick={() => handleDelete(promo)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="col-span-3 text-center text-muted-foreground py-16">
              <Megaphone className="w-12 h-12 mx-auto mb-3 opacity-20" />
              No promotions yet
            </div>
          )}
        </div>
      )}

      {/* Video Preview Dialog */}
      <Dialog open={!!previewVideo} onOpenChange={v => { if (!v) setPreviewVideo(null); }}>
        <DialogContent className="max-w-2xl p-0 overflow-hidden">
          <DialogHeader className="px-4 pt-4 pb-0">
            <DialogTitle className="flex items-center gap-2">
              <Video className="w-4 h-4 text-red-600" />
              {previewVideo?.title}
            </DialogTitle>
          </DialogHeader>
          <div className="p-4">
            {previewVideo?.videoUrl && (
              <video
                src={previewVideo.videoUrl}
                controls
                autoPlay
                className="w-full rounded-lg max-h-[60vh] bg-black"
              />
            )}
            {previewVideo?.description && (
              <p className="mt-3 text-sm text-muted-foreground">{previewVideo.description}</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Promotion Form */}
      <Dialog open={showForm} onOpenChange={v => { if (!v) { setShowForm(false); resetForm(); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-2xl">
          <DialogHeader><DialogTitle>{editingId ? "Edit Promotion" : "New Promotion"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Title *</Label><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className="mt-1" placeholder="e.g. Summer Sale" /></div>
            <div><Label>Description</Label><Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="mt-1" placeholder="Optional description" /></div>
            <div><Label>Link URL</Label><Input value={form.link} onChange={e => setForm(f => ({ ...f, link: e.target.value }))} className="mt-1" placeholder="https://…" /></div>

            {/* Promotion Photo — disabled when video is set */}
            <div>
              <Label>Promotion Photo</Label>
              {form.videoUrl ? (
                <div className="mt-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700">
                  <Video className="w-4 h-4 text-amber-500" />
                  Remove the video first to upload a photo.
                </div>
              ) : (
                <>
                  <Input type="file" accept="image/*" onChange={handlePhotoUpload} className="mt-1" disabled={uploading} />
                  {uploading && <p className="text-xs text-muted-foreground mt-1 animate-pulse">Uploading photo…</p>}
                </>
              )}
              {form.photoUrl && (
                <div className="mt-2 relative inline-block">
                  <img src={form.photoUrl} alt="promo" className="h-32 rounded-lg object-cover" />
                  <button
                    type="button"
                    className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs"
                    onClick={() => setForm(f => ({ ...f, photoUrl: "" }))}
                    title="Remove photo"
                  >×</button>
                </div>
              )}
            </div>

            {/* Promotion Video — disabled when photo is set */}
            <div className="border rounded-xl p-4 bg-red-50/40 space-y-3">
              <div className="flex items-center gap-2">
                <Video className="w-5 h-5 text-red-600" />
                <Label className="text-base font-semibold text-red-700 m-0">Promotion Video</Label>
                <span className="ml-auto text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">Max {MAX_VIDEO_SECONDS}s</span>
              </div>
              <p className="text-xs text-muted-foreground">Upload a short video clip (MP4, MOV, WebM) to play on the storefront. Cannot be combined with a photo.</p>

              {/* Display seconds control */}
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-slate-600">Display time:</span>
                <button
                  type="button"
                  className="w-7 h-7 rounded-lg border flex items-center justify-center hover:bg-slate-100 transition-colors"
                  onClick={() => setForm(f => ({ ...f, displaySeconds: Math.max(10, f.displaySeconds - 30) }))}
                  title="−30 seconds"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span className="text-sm font-bold w-16 text-center bg-white border rounded-lg py-1">{form.displaySeconds}s</span>
                <button
                  type="button"
                  className="w-7 h-7 rounded-lg border flex items-center justify-center hover:bg-slate-100 transition-colors"
                  onClick={() => setForm(f => ({ ...f, displaySeconds: f.displaySeconds + 30 }))}
                  title="+30 seconds"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
                <span className="text-xs text-muted-foreground">per promotion</span>
              </div>

              {form.photoUrl ? (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700">
                  <X className="w-4 h-4 text-amber-500" />
                  Remove the photo first to upload a video.
                </div>
              ) : (
                <Input
                  ref={videoInputRef}
                  type="file"
                  accept="video/*"
                  onChange={handleVideoUpload}
                  disabled={uploadingVideo}
                  className="bg-white"
                />
              )}
              {uploadingVideo && (
                <div className="flex items-center gap-2 text-sm text-red-600 animate-pulse">
                  <Video className="w-4 h-4" /> Uploading video…
                </div>
              )}
              {form.videoUrl && !uploadingVideo && (
                <div className="space-y-2">
                  <video
                    src={form.videoUrl}
                    controls
                    className="w-full rounded-lg max-h-48 bg-black"
                  />
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="checkbox" checked={form.showVideo} onChange={e => setForm(f => ({ ...f, showVideo: e.target.checked }))} />
                      Show video on storefront &amp; header
                    </label>
                    <Button size="sm" variant="ghost" className="text-red-500 h-7" onClick={removeVideo}>
                      <X className="w-3 h-3 mr-1" /> Remove video
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Display Options</Label>
              <div className="flex gap-4 flex-wrap">
                {([["showBanner", "Header Banner"], ["showPopup", "Popup Notification"], ["showHighlight", "Product Highlight"]] as const).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 cursor-pointer text-sm">
                    <input type="checkbox" checked={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))} />
                    {label}
                  </label>
                ))}
                <label className="flex items-center gap-2 cursor-pointer text-sm">
                  <input type="checkbox" checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} />
                  Active
                </label>
              </div>
            </div>

            <div>
              <Label>Featured Products</Label>
              <div className="relative mt-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder="Search products…" value={productSearch} onChange={e => setProductSearch(e.target.value)} className="pl-9" />
              </div>
              {productSearch && filteredProducts.length > 0 && (
                <div className="mt-1 border rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                  {filteredProducts.map(p => (
                    <button key={p.id} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted/50 text-left" onClick={() => addProduct(p)}>
                      {p.photoUrl ? <img src={p.photoUrl} alt={p.name} className="w-8 h-8 rounded object-cover" /> : <div className="w-8 h-8 bg-muted rounded flex items-center justify-center"><Package className="w-4 h-4 text-muted-foreground" /></div>}
                      <div className="text-sm"><div className="font-medium">{p.name}</div><div className="text-xs text-muted-foreground">{p.code}</div></div>
                    </button>
                  ))}
                </div>
              )}
              {selectedProducts.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedProducts.map(p => (
                    <div key={p.id} className="flex items-center gap-1 bg-primary/10 text-primary rounded-full px-3 py-1 text-xs">
                      {p.photoUrl && <img src={p.photoUrl} alt={p.name} className="w-4 h-4 rounded-full object-cover" />}
                      {p.name}
                      <button onClick={() => removeProduct(p.id)} className="ml-1 hover:text-red-600">×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowForm(false); resetForm(); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || uploading || uploadingVideo}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {DeleteAuthDialog}
    </div>
  );
}
