import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PackageCheck, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { type PurchaseInput } from "@apoteku/shared";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError, api, apiList, type PaginatedResponse } from "@/lib/api";
import { formatDate, formatIDR } from "@/lib/format";

export const Route = createFileRoute("/purchases")({ component: PurchasesPage });

type PurchaseRow = {
  id: number;
  code: string;
  supplierName: string | null;
  status: "draft" | "ordered" | "received" | "cancelled";
  orderDate: string;
  receivedDate: string | null;
  total: number;
  itemCount: number;
};

type Supplier = { id: number; name: string };
type ProductLite = { id: number; name: string; sku: string; baseUnit: string; costPrice: number };

type ItemDraft = {
  productId: string;
  batchNumber: string;
  expiryDate: string;
  quantity: string;
  unitCost: string;
};

const emptyItem = (): ItemDraft => ({
  productId: "",
  batchNumber: "",
  expiryDate: "",
  quantity: "1",
  unitCost: "",
});

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
};

const statusVariant = {
  draft: "secondary",
  ordered: "warning",
  received: "success",
  cancelled: "destructive",
} as const;

function PurchasesPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [orderDate, setOrderDate] = useState(today());
  const [items, setItems] = useState<ItemDraft[]>([emptyItem()]);
  const [error, setError] = useState<string | null>(null);

  const purchases = useQuery({
    queryKey: ["purchases"],
    queryFn: () => apiList<{ data: PurchaseRow[] }>("/purchases"),
  });

  const suppliers = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => apiList<PaginatedResponse<Supplier>>("/master/suppliers?perPage=100"),
  });

  const products = useQuery({
    queryKey: ["products-lite"],
    queryFn: () => apiList<PaginatedResponse<ProductLite>>("/products?perPage=200"),
  });

  const createPurchase = useMutation({
    mutationFn: (payload: PurchaseInput) =>
      api("/purchases", { method: "POST", body: payload }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchases"] });
      setShowForm(false);
      setSupplierId("");
      setItems([emptyItem()]);
      setError(null);
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Gagal menyimpan"),
  });

  const receive = useMutation({
    mutationFn: (id: number) =>
      api(`/purchases/${id}/receive`, { method: "POST", body: {} }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchases"] });
      qc.invalidateQueries({ queryKey: ["inventory-stock"] });
      qc.invalidateQueries({ queryKey: ["inventory-batches"] });
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Gagal menerima barang"),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!supplierId) {
      setError("Pilih supplier terlebih dahulu");
      return;
    }
    const validItems = items.filter((i) => i.productId && Number(i.quantity) > 0);
    if (validItems.length === 0) {
      setError("Tambahkan minimal 1 item");
      return;
    }
    createPurchase.mutate({
      supplierId: Number(supplierId),
      orderDate,
      discount: 0,
      tax: 0,
      items: validItems.map((i) => ({
        productId: Number(i.productId),
        batchNumber: i.batchNumber,
        expiryDate: i.expiryDate || null,
        quantity: Number(i.quantity),
        unitCost: Number(i.unitCost || 0),
      })),
    });
  }

  return (
    <>
      <PageHeader
        title="Pembelian"
        description="Purchase order dan penerimaan barang dari PBF/supplier"
        actions={
          <Button onClick={() => setShowForm((v) => !v)}>
            {showForm ? <X className="size-4" /> : <Plus className="size-4" />}
            {showForm ? "Tutup" : "Buat PO"}
          </Button>
        }
      />

      {error && (
        <p className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {showForm && (
        <Card className="mb-5">
          <CardContent className="pt-5">
            <form onSubmit={submit} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Supplier</Label>
                  <Select
                    value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}
                  >
                    <option value="">— Pilih supplier —</option>
                    {suppliers.data?.data.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Tanggal order</Label>
                  <Input
                    type="date"
                    value={orderDate}
                    onChange={(e) => setOrderDate(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <Label>Item pembelian</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setItems([...items, emptyItem()])}
                  >
                    <Plus className="size-3.5" /> Item
                  </Button>
                </div>
                <div className="space-y-2">
                  {items.map((item, index) => (
                    <div
                      key={index}
                      className="grid gap-2 rounded-lg border p-3 md:grid-cols-[2fr_1fr_1fr_0.7fr_1fr_auto]"
                    >
                      <Select
                        value={item.productId}
                        onChange={(e) => {
                          const next = [...items];
                          const product = products.data?.data.find(
                            (p) => p.id === Number(e.target.value),
                          );
                          next[index] = {
                            ...item,
                            productId: e.target.value,
                            unitCost: item.unitCost || String(product?.costPrice ?? ""),
                          };
                          setItems(next);
                        }}
                      >
                        <option value="">— Produk —</option>
                        {products.data?.data.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.baseUnit})
                          </option>
                        ))}
                      </Select>
                      <Input
                        placeholder="No. batch"
                        value={item.batchNumber}
                        onChange={(e) => {
                          const next = [...items];
                          next[index] = { ...item, batchNumber: e.target.value };
                          setItems(next);
                        }}
                      />
                      <Input
                        type="date"
                        value={item.expiryDate}
                        onChange={(e) => {
                          const next = [...items];
                          next[index] = { ...item, expiryDate: e.target.value };
                          setItems(next);
                        }}
                      />
                      <Input
                        type="number"
                        placeholder="Qty"
                        value={item.quantity}
                        onChange={(e) => {
                          const next = [...items];
                          next[index] = { ...item, quantity: e.target.value };
                          setItems(next);
                        }}
                      />
                      <Input
                        type="number"
                        placeholder="Harga"
                        value={item.unitCost}
                        onChange={(e) => {
                          const next = [...items];
                          next[index] = { ...item, unitCost: e.target.value };
                          setItems(next);
                        }}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => setItems(items.filter((_, i) => i !== index))}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                  Batal
                </Button>
                <Button type="submit" disabled={createPurchase.isPending}>
                  {createPurchase.isPending ? "Menyimpan..." : "Simpan PO"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-5">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kode</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Tanggal</TableHead>
                <TableHead className="text-right">Item</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {purchases.data?.data.length ? (
                purchases.data.data.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.code}</TableCell>
                    <TableCell className="font-medium">
                      {p.supplierName ?? "-"}
                    </TableCell>
                    <TableCell>{formatDate(p.orderDate)}</TableCell>
                    <TableCell className="text-right">{p.itemCount}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatIDR(p.total)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[p.status]}>{p.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {p.status === "ordered" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => receive.mutate(p.id)}
                          disabled={receive.isPending}
                        >
                          <PackageCheck className="size-3.5" /> Terima
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableEmpty colSpan={7}>Belum ada pembelian</TableEmpty>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
