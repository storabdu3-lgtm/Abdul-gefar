import { useState, useEffect } from "react";
import { Save, User, Globe, Palette, Upload, Eye, EyeOff, Lock, Plus, Building2, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { getAll, create, createWithId, update, COLLECTIONS } from "@/lib/firestore";
import { useAuth } from "@/lib/auth";
import { uploadImage } from "@/lib/cloudinary";
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import { auth } from "@/lib/firebase";
import type { AppSettings, InventorySystem } from "@/lib/types";
import { cn } from "@/lib/utils";

type Tab = "user" | "ecommerce" | "systems";

async function verifyFirebaseCredentials(email: string, password: string): Promise<boolean> {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: false }),
    }
  );
  return res.ok;
}

async function createFirebaseUser(email: string, password: string): Promise<string> {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error((data.error?.message as string) || "Failed to create user");
  return data.localId as string;
}

export default function Settings() {
  const [tab, setTab] = useState<Tab>("user");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);

  const [userForm, setUserForm] = useState({ name: "", currentPassword: "", newPassword: "", confirmPassword: "" });
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const [ecomForm, setEcomForm] = useState<Partial<AppSettings>>({
    ecommerceLogo: "", ecommerceName: "NexusStock", ecommerceTagline: "Your trusted supply partner",
    ecommerceHeroText: "Order by piece or full carton", ecommerceFooterText: "© NexusStock. All rights reserved.",
    ecommerceUsername: "", ecommercePassword: "",
    primaryColor: "#4f46e5", fontStyle: "inter", menuStyle: "horizontal",
  });
  const [showEcomPass, setShowEcomPass] = useState(false);

  const [ecomUnlocked, setEcomUnlocked] = useState(false);
  const [ecomGateEmail, setEcomGateEmail] = useState("");
  const [ecomGatePassword, setEcomGatePassword] = useState("");
  const [ecomGateChecking, setEcomGateChecking] = useState(false);
  const [showEcomGatePass, setShowEcomGatePass] = useState(false);

  const [systems, setSystems] = useState<InventorySystem[]>([]);
  const [systemsLoading, setSystemsLoading] = useState(false);
  const [showCreateSystem, setShowCreateSystem] = useState(false);
  const [createStep, setCreateStep] = useState<"auth" | "form">("auth");
  const [sysAuthEmail, setSysAuthEmail] = useState("");
  const [sysAuthPassword, setSysAuthPassword] = useState("");
  const [sysAuthChecking, setSysAuthChecking] = useState(false);
  const [showSysAuthPass, setShowSysAuthPass] = useState(false);
  const [newSysForm, setNewSysForm] = useState({ name: "", adminEmail: "", adminPassword: "", confirmPassword: "" });
  const [showNewSysPass, setShowNewSysPass] = useState(false);
  const [creatingSys, setCreatingSys] = useState(false);

  const { toast } = useToast();
  const { user, allUsers } = useAuth();

  useEffect(() => {
    if (user) setUserForm(f => ({ ...f, name: user.name }));
  }, [user]);

  async function loadSettings() {
    setLoading(true);
    const settings = await getAll<AppSettings>(COLLECTIONS.APP_SETTINGS);
    if (settings.length > 0) {
      const s = settings[0];
      setSettingsId(s.id);
      setEcomForm({
        ecommerceLogo: s.ecommerceLogo || "",
        ecommerceName: s.ecommerceName || "NexusStock",
        ecommerceTagline: s.ecommerceTagline || "Your trusted supply partner",
        ecommerceHeroText: s.ecommerceHeroText || "Order by piece or full carton",
        ecommerceFooterText: s.ecommerceFooterText || "© NexusStock. All rights reserved.",
        ecommerceUsername: s.ecommerceUsername || "",
        ecommercePassword: s.ecommercePassword || "",
        primaryColor: s.primaryColor || "#4f46e5",
        fontStyle: s.fontStyle || "inter",
        menuStyle: s.menuStyle || "horizontal",
      });
    }
    setLoading(false);
  }

  async function loadSystems() {
    setSystemsLoading(true);
    const list = await getAll<InventorySystem>(COLLECTIONS.SYSTEMS);
    setSystems(list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    setSystemsLoading(false);
  }

  useEffect(() => { loadSettings(); }, []);
  useEffect(() => { if (tab === "systems") loadSystems(); }, [tab]);

  async function handleSaveUser() {
    if (!userForm.name.trim()) { toast({ title: "Name required", variant: "destructive" }); return; }
    if (saving) return;
    setSaving(true);
    try {
      if (userForm.newPassword) {
        if (userForm.newPassword !== userForm.confirmPassword) {
          toast({ title: "Passwords do not match", variant: "destructive" }); return;
        }
        if (userForm.newPassword.length < 6) {
          toast({ title: "Password must be at least 6 characters", variant: "destructive" }); return;
        }
        const firebaseUser = auth.currentUser;
        if (firebaseUser && userForm.currentPassword) {
          const cred = EmailAuthProvider.credential(firebaseUser.email!, userForm.currentPassword);
          await reauthenticateWithCredential(firebaseUser, cred);
          await updatePassword(firebaseUser, userForm.newPassword);
        }
      }
      if (user) {
        await update(COLLECTIONS.USERS, user.uid, { name: userForm.name } as Record<string, unknown>);
      }
      setUserForm(f => ({ ...f, currentPassword: "", newPassword: "", confirmPassword: "" }));
      toast({ title: "Profile updated" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update";
      if (msg.includes("wrong-password") || msg.includes("invalid-credential")) {
        toast({ title: "Current password is incorrect", variant: "destructive" });
      } else {
        toast({ title: msg, variant: "destructive" });
      }
    } finally { setSaving(false); }
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true);
    try { const url = await uploadImage(file); setEcomForm(f => ({ ...f, ecommerceLogo: url })); }
    catch { toast({ title: "Upload failed", variant: "destructive" }); } finally { setUploading(false); }
  }

  async function handleSaveEcom() {
    if (saving) return;
    setSaving(true);
    try {
      if (settingsId) {
        await update(COLLECTIONS.APP_SETTINGS, settingsId, ecomForm as Record<string, unknown>);
      } else {
        const id = await create(COLLECTIONS.APP_SETTINGS, ecomForm as Record<string, unknown>);
        setSettingsId(id);
      }
      toast({ title: "E-commerce settings saved" });
    } catch { toast({ title: "Failed", variant: "destructive" }); } finally { setSaving(false); }
  }

  async function handleEcomGateUnlock() {
    if (!ecomGateEmail || !ecomGatePassword) {
      toast({ title: "Enter email and password", variant: "destructive" }); return;
    }
    setEcomGateChecking(true);
    try {
      const ok = await verifyFirebaseCredentials(ecomGateEmail, ecomGatePassword);
      if (!ok) { toast({ title: "Invalid credentials", variant: "destructive" }); return; }
      const matchedUser = allUsers.find(u => u.email === ecomGateEmail);
      const isAdmin = matchedUser?.role === "admin" || matchedUser?.permissions?.includes("*");
      if (!isAdmin) {
        toast({ title: "Access denied", description: "Admin access required for E-commerce settings.", variant: "destructive" }); return;
      }
      setEcomUnlocked(true);
      setEcomGateEmail("");
      setEcomGatePassword("");
    } catch {
      toast({ title: "Verification failed", variant: "destructive" });
    } finally { setEcomGateChecking(false); }
  }

  function openCreateSystem() {
    setCreateStep("auth");
    setSysAuthEmail("");
    setSysAuthPassword("");
    setNewSysForm({ name: "", adminEmail: "", adminPassword: "", confirmPassword: "" });
    setShowCreateSystem(true);
  }

  async function handleSysAuth() {
    if (!sysAuthEmail || !sysAuthPassword) {
      toast({ title: "Enter admin email and password", variant: "destructive" }); return;
    }
    setSysAuthChecking(true);
    try {
      const ok = await verifyFirebaseCredentials(sysAuthEmail, sysAuthPassword);
      if (!ok) { toast({ title: "Invalid credentials", variant: "destructive" }); return; }
      const matchedUser = allUsers.find(u => u.email === sysAuthEmail);
      const isAdmin = matchedUser?.role === "admin" || matchedUser?.permissions?.includes("*");
      if (!isAdmin) {
        toast({ title: "Admin access required", description: "Only admins can create new inventory systems.", variant: "destructive" }); return;
      }
      setCreateStep("form");
    } catch {
      toast({ title: "Verification failed", variant: "destructive" });
    } finally { setSysAuthChecking(false); }
  }

  async function handleCreateSystem() {
    const { name, adminEmail, adminPassword, confirmPassword } = newSysForm;
    if (!name.trim()) { toast({ title: "System name required", variant: "destructive" }); return; }
    if (!adminEmail) { toast({ title: "Admin email required", variant: "destructive" }); return; }
    if (!adminPassword || adminPassword.length < 6) { toast({ title: "Password must be at least 6 characters", variant: "destructive" }); return; }
    if (adminPassword !== confirmPassword) { toast({ title: "Passwords do not match", variant: "destructive" }); return; }
    if (creatingSys) return;
    setCreatingSys(true);
    try {
      const uid = await createFirebaseUser(adminEmail, adminPassword);
      await createWithId(COLLECTIONS.USERS, uid, {
        uid, email: adminEmail, name: `${name} Admin`, role: "admin", permissions: ["*"],
      } as Record<string, unknown>);
      await create(COLLECTIONS.SYSTEMS, {
        name: name.trim(),
        adminEmail,
        createdAt: new Date().toISOString(),
        createdBy: user?.name || user?.email || "Unknown",
      } as Record<string, unknown>);
      toast({ title: `System "${name}" created`, description: `Admin: ${adminEmail}` });
      setShowCreateSystem(false);
      loadSystems();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create system";
      toast({ title: msg, variant: "destructive" });
    } finally { setCreatingSys(false); }
  }

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "user", label: "User Settings", icon: <User className="w-4 h-4" /> },
    { key: "ecommerce", label: "E-commerce", icon: <Globe className="w-4 h-4" /> },
    { key: "systems", label: "Systems", icon: <Building2 className="w-4 h-4" /> },
  ];

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your profile, e-commerce configuration, and inventory systems</p>
      </div>

      <div className="flex gap-1 border-b">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.icon} {t.label}
            {t.key === "ecommerce" && !ecomUnlocked && <Lock className="w-3 h-3 ml-1 opacity-50" />}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : tab === "user" ? (
        <div className="space-y-6 bg-card border rounded-xl p-6">
          <h2 className="font-semibold text-lg flex items-center gap-2"><User className="w-5 h-5" /> Profile</h2>
          <div className="space-y-4">
            <div>
              <Label>Display Name</Label>
              <Input value={userForm.name} onChange={e => setUserForm(f => ({ ...f, name: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label>Email</Label>
              <Input value={user?.email || ""} readOnly className="mt-1 bg-muted" />
            </div>
          </div>

          <div className="border-t pt-4 space-y-4">
            <h3 className="font-medium text-sm text-muted-foreground">Change Password (optional)</h3>
            <div>
              <Label>Current Password</Label>
              <div className="relative mt-1">
                <Input type={showCurrent ? "text" : "password"} value={userForm.currentPassword} onChange={e => setUserForm(f => ({ ...f, currentPassword: e.target.value }))} />
                <button className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowCurrent(v => !v)}>
                  {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <Label>New Password</Label>
              <div className="relative mt-1">
                <Input type={showNew ? "text" : "password"} value={userForm.newPassword} onChange={e => setUserForm(f => ({ ...f, newPassword: e.target.value }))} />
                <button className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowNew(v => !v)}>
                  {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <Label>Confirm New Password</Label>
              <Input type="password" value={userForm.confirmPassword} onChange={e => setUserForm(f => ({ ...f, confirmPassword: e.target.value }))} className="mt-1" />
            </div>
          </div>

          <Button onClick={handleSaveUser} disabled={saving}>
            <Save className="w-4 h-4 mr-2" /> {saving ? "Saving…" : "Save Changes"}
          </Button>
        </div>

      ) : tab === "ecommerce" ? (
        !ecomUnlocked ? (
          <div className="flex items-center justify-center py-16">
            <div className="bg-card border rounded-2xl p-8 max-w-sm w-full text-center shadow-sm space-y-5">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                <Lock className="w-8 h-8 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-bold">E-commerce Settings</h2>
                <p className="text-sm text-muted-foreground mt-1">Enter admin credentials to access e-commerce configuration.</p>
              </div>
              <div className="space-y-3 text-left">
                <div className="space-y-1">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={ecomGateEmail}
                    onChange={e => setEcomGateEmail(e.target.value)}
                    placeholder="admin@example.com"
                    disabled={ecomGateChecking}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Password</Label>
                  <div className="relative">
                    <Input
                      type={showEcomGatePass ? "text" : "password"}
                      value={ecomGatePassword}
                      onChange={e => setEcomGatePassword(e.target.value)}
                      placeholder="••••••••"
                      disabled={ecomGateChecking}
                      onKeyDown={e => e.key === "Enter" && handleEcomGateUnlock()}
                    />
                    <button className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowEcomGatePass(v => !v)}>
                      {showEcomGatePass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
              <Button className="w-full" onClick={handleEcomGateUnlock} disabled={ecomGateChecking}>
                {ecomGateChecking ? "Verifying…" : "Unlock E-commerce Settings"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-6 bg-card border rounded-xl p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-lg flex items-center gap-2"><Globe className="w-5 h-5" /> E-commerce Settings</h2>
              <Badge variant="outline" className="text-green-600 border-green-400 gap-1">
                <ShieldCheck className="w-3 h-3" /> Unlocked
              </Badge>
            </div>

            <div className="space-y-4">
              <div>
                <Label>Store Logo</Label>
                <div className="mt-1 flex items-center gap-3">
                  {ecomForm.ecommerceLogo && <img src={ecomForm.ecommerceLogo} alt="logo" className="h-16 w-16 rounded-lg object-contain border bg-white" />}
                  <label className="cursor-pointer">
                    <div className="flex items-center gap-2 px-3 py-2 border rounded-md text-sm hover:bg-muted transition-colors">
                      <Upload className="w-4 h-4" /> {uploading ? "Uploading…" : "Upload Logo"}
                    </div>
                    <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" disabled={uploading} />
                  </label>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div><Label>Store Name</Label><Input value={ecomForm.ecommerceName || ""} onChange={e => setEcomForm(f => ({ ...f, ecommerceName: e.target.value }))} className="mt-1" /></div>
                <div><Label>Tagline</Label><Input value={ecomForm.ecommerceTagline || ""} onChange={e => setEcomForm(f => ({ ...f, ecommerceTagline: e.target.value }))} className="mt-1" /></div>
                <div><Label>Hero Text</Label><Input value={ecomForm.ecommerceHeroText || ""} onChange={e => setEcomForm(f => ({ ...f, ecommerceHeroText: e.target.value }))} className="mt-1" /></div>
                <div><Label>Footer Text</Label><Input value={ecomForm.ecommerceFooterText || ""} onChange={e => setEcomForm(f => ({ ...f, ecommerceFooterText: e.target.value }))} className="mt-1" /></div>
              </div>

              <div className="border-t pt-4">
                <p className="text-sm font-semibold mb-3 flex items-center gap-2"><Lock className="w-4 h-4" /> Store Login Credentials</p>
                <p className="text-xs text-muted-foreground mb-3">Set the username and password customers must use to sign in to the e-commerce store.</p>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <Label>Username</Label>
                    <Input
                      className="mt-1"
                      placeholder="e.g. customer"
                      value={ecomForm.ecommerceUsername || ""}
                      onChange={e => setEcomForm(f => ({ ...f, ecommerceUsername: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label>Password</Label>
                    <div className="relative mt-1">
                      <Input
                        type={showEcomPass ? "text" : "password"}
                        placeholder="Store password"
                        value={ecomForm.ecommercePassword || ""}
                        onChange={e => setEcomForm(f => ({ ...f, ecommercePassword: e.target.value }))}
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowEcomPass(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                      >
                        {showEcomPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <Label>Font Style</Label>
                <select
                  value={ecomForm.fontStyle || "inter"}
                  onChange={e => setEcomForm(f => ({ ...f, fontStyle: e.target.value }))}
                  className="mt-1 w-full border rounded-md px-3 py-2 text-sm bg-background"
                >
                  <option value="inter">Inter (Modern)</option>
                  <option value="roboto">Roboto (Clean)</option>
                  <option value="poppins">Poppins (Friendly)</option>
                  <option value="merriweather">Merriweather (Classic)</option>
                </select>
              </div>

              <div>
                <Label className="flex items-center gap-2"><Palette className="w-4 h-4" /> Primary Color</Label>
                <div className="mt-1 flex items-center gap-3">
                  <input type="color" value={ecomForm.primaryColor || "#4f46e5"} onChange={e => setEcomForm(f => ({ ...f, primaryColor: e.target.value }))} className="h-10 w-16 rounded border cursor-pointer" />
                  <Input value={ecomForm.primaryColor || "#4f46e5"} onChange={e => setEcomForm(f => ({ ...f, primaryColor: e.target.value }))} className="w-36 font-mono" />
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={handleSaveEcom} disabled={saving || uploading}>
                <Save className="w-4 h-4 mr-2" /> {saving ? "Saving…" : "Save Settings"}
              </Button>
              <Button variant="outline" onClick={() => setEcomUnlocked(false)}>
                <Lock className="w-4 h-4 mr-2" /> Lock
              </Button>
            </div>
          </div>
        )

      ) : (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-lg flex items-center gap-2"><Building2 className="w-5 h-5" /> Inventory Management Systems</h2>
              <p className="text-sm text-muted-foreground mt-0.5">Create and manage separate inventory system instances</p>
            </div>
            <Button onClick={openCreateSystem}>
              <Plus className="w-4 h-4 mr-2" /> Create New System
            </Button>
          </div>

          {systemsLoading ? (
            <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
          ) : systems.length === 0 ? (
            <div className="border rounded-xl p-12 text-center text-muted-foreground">
              <Building2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No systems created yet</p>
              <p className="text-sm mt-1">Click "Create New System" to set up a new inventory management system.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {systems.map(sys => (
                <div key={sys.id} className="border rounded-xl p-4 bg-card flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Building2 className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-semibold">{sys.name}</p>
                      <p className="text-xs text-muted-foreground">Admin: {sys.adminEmail}</p>
                      <p className="text-xs text-muted-foreground">
                        Created by {sys.createdBy} · {new Date(sys.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-green-600 border-green-400">Active</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Dialog open={showCreateSystem} onOpenChange={v => { if (!creatingSys && !sysAuthChecking) setShowCreateSystem(v); }}>
        <DialogContent className="max-w-md">
          {createStep === "auth" ? (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2 mb-1">
                  <ShieldCheck className="w-5 h-5 text-primary" />
                  <DialogTitle>Admin Verification</DialogTitle>
                </div>
                <DialogDescription>
                  Enter your admin credentials to authorize creating a new inventory management system.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div className="space-y-1">
                  <Label>Admin Email</Label>
                  <Input
                    type="email"
                    value={sysAuthEmail}
                    onChange={e => setSysAuthEmail(e.target.value)}
                    placeholder="admin@example.com"
                    disabled={sysAuthChecking}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Admin Password</Label>
                  <div className="relative">
                    <Input
                      type={showSysAuthPass ? "text" : "password"}
                      value={sysAuthPassword}
                      onChange={e => setSysAuthPassword(e.target.value)}
                      placeholder="••••••••"
                      disabled={sysAuthChecking}
                      onKeyDown={e => e.key === "Enter" && handleSysAuth()}
                    />
                    <button className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowSysAuthPass(v => !v)}>
                      {showSysAuthPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowCreateSystem(false)} disabled={sysAuthChecking}>Cancel</Button>
                <Button onClick={handleSysAuth} disabled={sysAuthChecking}>
                  {sysAuthChecking ? "Verifying…" : "Continue"}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2 mb-1">
                  <Building2 className="w-5 h-5 text-primary" />
                  <DialogTitle>Create New Inventory System</DialogTitle>
                </div>
                <DialogDescription>
                  Set up a new inventory management system with its own admin account.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div className="space-y-1">
                  <Label>System Name</Label>
                  <Input
                    value={newSysForm.name}
                    onChange={e => setNewSysForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Branch Office System"
                    disabled={creatingSys}
                  />
                </div>
                <div className="border-t pt-3 space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">New Admin Credentials</p>
                  <Label>Admin Email</Label>
                  <Input
                    type="email"
                    value={newSysForm.adminEmail}
                    onChange={e => setNewSysForm(f => ({ ...f, adminEmail: e.target.value }))}
                    placeholder="newadmin@example.com"
                    disabled={creatingSys}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Admin Password</Label>
                  <div className="relative">
                    <Input
                      type={showNewSysPass ? "text" : "password"}
                      value={newSysForm.adminPassword}
                      onChange={e => setNewSysForm(f => ({ ...f, adminPassword: e.target.value }))}
                      placeholder="Min. 6 characters"
                      disabled={creatingSys}
                    />
                    <button className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowNewSysPass(v => !v)}>
                      {showNewSysPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Confirm Password</Label>
                  <Input
                    type="password"
                    value={newSysForm.confirmPassword}
                    onChange={e => setNewSysForm(f => ({ ...f, confirmPassword: e.target.value }))}
                    placeholder="Repeat password"
                    disabled={creatingSys}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateStep("auth")} disabled={creatingSys}>Back</Button>
                <Button onClick={handleCreateSystem} disabled={creatingSys}>
                  {creatingSys ? "Creating…" : "Create System"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
