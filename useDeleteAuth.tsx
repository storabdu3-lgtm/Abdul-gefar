import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { ShieldAlert } from "lucide-react";

export function useDeleteAuth() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [checking, setChecking] = useState(false);
  const [pendingFn, setPendingFn] = useState<(() => void) | null>(null);
  const { toast } = useToast();
  const { allUsers } = useAuth();

  function confirmDelete(fn: () => void | Promise<void>) {
    setPendingFn(() => fn);
    setEmail("");
    setPassword("");
    setOpen(true);
  }

  async function handleVerify() {
    if (!email || !password) {
      toast({ title: "Enter email and password", variant: "destructive" });
      return;
    }
    setChecking(true);
    try {
      const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
      const res = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, returnSecureToken: false }),
        }
      );
      if (!res.ok) {
        toast({ title: "Invalid credentials", description: "Email or password is incorrect.", variant: "destructive" });
        return;
      }
      const matchedUser = allUsers.find(u => u.email === email);
      const canDelete =
        matchedUser?.role === "admin" ||
        matchedUser?.permissions?.includes("*") ||
        matchedUser?.permissions?.includes("delete");
      if (!canDelete) {
        toast({ title: "Permission denied", description: "This account does not have delete permission.", variant: "destructive" });
        return;
      }
      setOpen(false);
      pendingFn?.();
    } catch {
      toast({ title: "Verification failed", description: "Could not verify credentials.", variant: "destructive" });
    } finally {
      setChecking(false);
    }
  }

  const DeleteAuthDialog = (
    <Dialog open={open} onOpenChange={(v) => { if (!checking) setOpen(v); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <ShieldAlert className="w-5 h-5 text-destructive" />
            <DialogTitle>Confirm Delete</DialogTitle>
          </div>
          <DialogDescription>
            Enter authorized credentials to proceed with this deletion.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label>Email</Label>
            <Input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com"
              disabled={checking}
            />
          </div>
          <div className="space-y-1">
            <Label>Password</Label>
            <Input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={checking}
              onKeyDown={e => e.key === "Enter" && handleVerify()}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={checking}>Cancel</Button>
          <Button variant="destructive" onClick={handleVerify} disabled={checking}>
            {checking ? "Verifying…" : "Confirm Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { confirmDelete, DeleteAuthDialog };
}
