import React, { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Plus, Search, Pencil, Trash2, Store as StoreIcon } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useDeleteAuth } from "@/hooks/useDeleteAuth";
import { getAll, create, update, remove, COLLECTIONS, generateVoucherId } from "@/lib/firestore";
import type { Store } from "@/lib/types";

const storeSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  level: z.string().min(1, "Level is required"),
  address: z.string().min(5, "Address is required"),
});

type StoreFormValues = z.infer<typeof storeSchema>;

export default function Stores() {
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const { toast } = useToast();
  const { confirmDelete, DeleteAuthDialog } = useDeleteAuth();

  const form = useForm<StoreFormValues>({
    resolver: zodResolver(storeSchema),
    defaultValues: { name: "", level: "", address: "" },
  });

  const loadStores = async () => {
    setLoading(true);
    try {
      const data = await getAll<Store>(COLLECTIONS.STORES);
      setStores(data.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))));
    } catch (error) {
      toast({ title: "Error", description: "Failed to load stores", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStores();
  }, []);

  const onSubmit = async (values: StoreFormValues) => {
    try {
      if (editingId) {
        await update(COLLECTIONS.STORES, editingId, values);
        toast({ title: "Success", description: "Store updated successfully" });
      } else {
        const voucherId = generateVoucherId("STR");
        await create(COLLECTIONS.STORES, { ...values, voucherId });
        toast({ title: "Success", description: "Store created successfully" });
      }
      setIsDialogOpen(false);
      form.reset();
      setEditingId(null);
      loadStores();
    } catch (error) {
      toast({ title: "Error", description: "Operation failed", variant: "destructive" });
    }
  };

  const handleEdit = (store: Store) => {
    setEditingId(store.id);
    form.reset({ name: store.name, level: store.level, address: store.address });
    setIsDialogOpen(true);
  };

  const handleDelete = (id: string) => {
    confirmDelete(async () => {
      try {
        await remove(COLLECTIONS.STORES, id);
        toast({ title: "Success", description: "Store deleted" });
        loadStores();
      } catch (error) {
        toast({ title: "Error", description: "Failed to delete", variant: "destructive" });
      }
    });
  };

  const filteredStores = stores.filter(s => 
    s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.voucherId.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Stores</h1>
          <p className="text-muted-foreground">Manage multiple store locations</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) {
            form.reset({ name: "", level: "", address: "" });
            setEditingId(null);
          }
        }}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-store">
              <Plus className="w-4 h-4 mr-2" /> Add Store
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingId ? "Edit Store" : "Add Store"}</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Store Name</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Main Branch" {...field} data-testid="input-store-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="level"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Store Level</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-store-level">
                            <SelectValue placeholder="Select level" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="HQ">Headquarters (HQ)</SelectItem>
                          <SelectItem value="Branch">Branch</SelectItem>
                          <SelectItem value="Warehouse">Warehouse</SelectItem>
                          <SelectItem value="Shop">Shop</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="address"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Address</FormLabel>
                      <FormControl>
                        <Input placeholder="Full address" {...field} data-testid="input-store-address" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" data-testid="button-submit-store">
                  {editingId ? "Update" : "Create"}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center space-x-2">
            <Search className="w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Search stores..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="max-w-sm"
              data-testid="input-search-stores"
            />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Voucher ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Level</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredStores.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                      No stores found.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredStores.map((store) => (
                    <TableRow key={store.id} data-testid={`row-store-${store.id}`}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {store.voucherId}
                      </TableCell>
                      <TableCell className="font-medium flex items-center gap-2">
                        <StoreIcon className="w-4 h-4 text-muted-foreground" />
                        {store.name}
                      </TableCell>
                      <TableCell>{store.level}</TableCell>
                      <TableCell className="max-w-xs truncate" title={store.address}>
                        {store.address}
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => handleEdit(store)}
                          data-testid={`button-edit-store-${store.id}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => handleDelete(store.id)}
                          data-testid={`button-delete-store-${store.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {DeleteAuthDialog}
    </div>
  );
}
