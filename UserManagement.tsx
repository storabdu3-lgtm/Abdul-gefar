import { useState } from "react";
import { Plus, Edit, Trash2, Shield, User, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useDeleteAuth } from "@/hooks/useDeleteAuth";
import { useAuth, ALL_PERMISSIONS } from "@/lib/auth";
import type { AppUser } from "@/lib/types";

export default function UserManagement() {
  const { user: currentUser, allUsers, createUser, updateUserPermissions, deleteUser, reloadUsers } = useAuth();
  const { toast } = useToast();
  const { confirmDelete, DeleteAuthDialog } = useDeleteAuth();

  const [showDialog, setShowDialog] = useState(false);
  const [editUser, setEditUser] = useState<AppUser | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", name: "", permissions: [] as string[] });

  function openAdd() {
    setEditUser(null);
    setForm({ email: "", password: "", name: "", permissions: [] });
    setShowDialog(true);
  }

  function openEdit(u: AppUser) {
    setEditUser(u);
    setForm({ email: u.email, password: "", name: u.name, permissions: [...u.permissions] });
    setShowDialog(true);
  }

  function togglePermission(key: string) {
    setForm(f => ({
      ...f,
      permissions: f.permissions.includes(key)
        ? f.permissions.filter(p => p !== key)
        : [...f.permissions, key],
    }));
  }

  function selectAll() { setForm(f => ({ ...f, permissions: ALL_PERMISSIONS.map(p => p.key) })); }
  function clearAll() { setForm(f => ({ ...f, permissions: [] })); }

  async function handleSave() {
    if (!form.name) { toast({ title: "Name required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      if (editUser) {
        await updateUserPermissions(editUser.uid, form.name, form.permissions);
        toast({ title: "User updated" });
      } else {
        if (!form.email || !form.password) { toast({ title: "Email and password required", variant: "destructive" }); setSaving(false); return; }
        if (form.password.length < 6) { toast({ title: "Password must be at least 6 characters", variant: "destructive" }); setSaving(false); return; }
        await createUser(form.email, form.password, form.name, form.permissions);
        toast({ title: "User created successfully" });
      }
      setShowDialog(false);
      await reloadUsers();
    } catch (err) {
      toast({ title: "Error", description: String(err instanceof Error ? err.message : err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(u: AppUser) {
    if (u.uid === currentUser?.uid) { toast({ title: "Cannot delete your own account", variant: "destructive" }); return; }
    confirmDelete(async () => {
      try {
        await deleteUser(u.uid);
        toast({ title: "User removed" });
      } catch (err) {
        toast({ title: "Error", description: String(err instanceof Error ? err.message : err), variant: "destructive" });
      }
    });
  }

  const otherUsers = allUsers.filter(u => u.uid !== currentUser?.uid);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">User Management</h1>
          <p className="text-muted-foreground text-sm mt-1">Create and manage staff accounts with permissions</p>
        </div>
        <Button onClick={openAdd} data-testid="button-add-user">
          <Plus className="w-4 h-4 mr-2" /> Add User
        </Button>
      </div>

      {/* Current User Card */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Your Account</h2>
        <Card className="border-primary/30">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Shield className="w-5 h-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base">{currentUser?.name}</CardTitle>
                <p className="text-xs text-muted-foreground">{currentUser?.email}</p>
              </div>
            </div>
            <Badge className="bg-primary">Admin</Badge>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Full access to all features</p>
          </CardContent>
        </Card>
      </div>

      {/* Other Users */}
      <h2 className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Staff Accounts ({otherUsers.length})</h2>
      {otherUsers.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground border rounded-lg">
          <User className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>No staff accounts yet</p>
          <p className="text-xs mt-1">Click "Add User" to create a staff account with specific permissions</p>
        </div>
      ) : (
        <div className="space-y-3">
          {otherUsers.map(u => (
            <Card key={u.uid} data-testid={`card-user-${u.uid}`}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                    <User className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div>
                    <CardTitle className="text-base">{u.name}</CardTitle>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => openEdit(u)}><Edit className="w-3 h-3 mr-1" /> Edit</Button>
                  <Button size="sm" variant="destructive" onClick={() => handleDelete(u)}><Trash2 className="w-3 h-3" /></Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1">
                  {u.permissions.includes("*") ? (
                    <Badge variant="secondary">All Permissions</Badge>
                  ) : u.permissions.length === 0 ? (
                    <span className="text-xs text-muted-foreground">No permissions assigned</span>
                  ) : (
                    u.permissions.map(p => {
                      const perm = ALL_PERMISSIONS.find(ap => ap.key === p);
                      return <Badge key={p} variant="secondary" className="text-xs">{perm?.label || p}</Badge>;
                    })
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-lg">
          <DialogHeader>
            <DialogTitle>{editUser ? `Edit — ${editUser.name}` : "Create Staff Account"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Full Name *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} data-testid="input-user-name" />
            </div>
            {!editUser && (
              <>
                <div>
                  <Label>Email *</Label>
                  <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} data-testid="input-user-email" />
                </div>
                <div>
                  <Label>Password * (min 6 characters)</Label>
                  <Input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} data-testid="input-user-password" />
                </div>
              </>
            )}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Page Permissions</Label>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={selectAll}>Select All</Button>
                  <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={clearAll}>Clear</Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 border rounded-lg p-3 bg-muted/30">
                {ALL_PERMISSIONS.map(p => (
                  <div key={p.key} className="flex items-center gap-2">
                    <Checkbox
                      id={`perm-${p.key}`}
                      checked={form.permissions.includes(p.key)}
                      onCheckedChange={() => togglePermission(p.key)}
                    />
                    <label htmlFor={`perm-${p.key}`} className="text-sm cursor-pointer">{p.label}</label>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} data-testid="button-save-user">
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {editUser ? "Update" : "Create User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {DeleteAuthDialog}
    </div>
  );
}
