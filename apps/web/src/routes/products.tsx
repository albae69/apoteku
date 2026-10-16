import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Search, Trash2, X } from "lucide-react";
import { useState } from "react";
import {
  DRUG_CLASSES,
  PRODUCT_FORMS,
  type ProductInput,
} from "@apoteku/shared";
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
import { formatIDR, formatNumber } from "@/lib/format";

export const Route = createFileRoute("/products")({ component: ProductsPage });

type ProductRow = {
  id: number;
  sku: string;
  name: string;
  genericName: string | null;
  form: string;
  drugClass: string;
  baseUnit: string;
  salePrice: number;
  costPrice: number;
  minStock: number;
  requiresPrescription: boolean;
  stock: number;
  categoryName: string | null;
  isActive: boolean;
};

type Category = { id: number; name: string };

type UnitDraft = { name: string; conversion: string; price: string };

const emptyUnit = (): UnitDraft => ({ name: "", conversion: "1", price: "" });

function ProductsPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    sku: "",
    barcode: "",
    form: "tablet",
    drugClass: "obat_bebas",
    baseUnit: "tablet",
    salePrice: "",
    costPrice: "",
    minStock: "0",
    categoryId: "",
    requiresPrescription: false,
  });
  const [units, setUnits] = useState<UnitDraft[]>([emptyUnit()]);

  const products = useQuery({
    queryKey: ["products", q],
    queryFn: () =>
      apiList<PaginatedResponse<ProductRow>>(
        `/products?perPage=100${q ? `&q=${encodeURIComponent(q)}` : ""}`,
      ),
  });

  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiList<PaginatedResponse<Category>>("/master/categories?perPage=100"),
  });

  const createProduct = useMutation({
    mutationFn: (payload: ProductInput) =>
      api("/products", { method: "POST", body: payload }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      setShowForm(false);
      setForm({
        name: "",
        sku: "",
        barcode: "",
        form: "tablet",
        drugClass: "obat_bebas",
        baseUnit: "tablet",
        salePrice: "",
        costPrice: "",
        minStock: "0",
        categoryId: "",
        requiresPrescription: false,
      });
      setUnits([emptyUnit()]);
      setError(null);
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Gagal menyimpan"),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const payload = {
      name: form.name,
      sku: form.sku,
      barcode: form.barcode,
      form: form.form as ProductInput["form"],
      drugClass: form.drugClass as ProductInput["drugClass"],
      baseUnit: form.baseUnit,
      salePrice: Number(form.salePrice || 0),
      costPrice: Number(form.costPrice || 0),
      minStock: Number(form.minStock || 0),
      categoryId: form.categoryId ? Number(form.categoryId) : null,
      requiresPrescription: form.requiresPrescription,
      isActive: true,
      units: units
        .filter((u) => u.name.trim())
        .map((u) => ({
          name: u.name.trim(),
          conversion: Number(u.conversion || 1),
          price: u.price ? Number(u.price) : undefined,
          isBase: u.name.trim() === form.baseUnit,
        })),
    };
    createProduct.mutate(payload);
  }

  return (
    <>
      <PageHeader
        title="Produk & Obat"
        description="Master data obat, alkes, dan BHP"
        actions={
          <Button onClick={() => setShowForm((v) => !v)}>
            {showForm ? <X className="size-4" /> : <Plus className="size-4" />}
            {showForm ? "Tutup" : "Tambah produk"}
          </Button>
        }
      />

      {showForm && (
        <Card className="mb-5">
          <CardContent className="pt-5">
            <form onSubmit={submit} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-1.5 md:col-span-2">
                  <Label>Nama produk</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>SKU</Label>
                  <Input
                    value={form.sku}
                    onChange={(e) => setForm({ ...form, sku: e.target.value })}
                    placeholder="OBT-0001"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Barcode</Label>
                  <Input
                    value={form.barcode}
                    onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Kategori</Label>
                  <Select
                    value={form.categoryId}
                    onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                  >
                    <option value="">— Tanpa kategori —</option>
                    {categories.data?.data.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Bentuk sediaan</Label>
                  <Select
                    value={form.form}
                    onChange={(e) => setForm({ ...form, form: e.target.value })}
                  >
                    {PRODUCT_FORMS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Golongan</Label>
                  <Select
                    value={form.drugClass}
                    onChange={(e) => setForm({ ...form, drugClass: e.target.value })}
                  >
                    {DRUG_CLASSES.map((d) => (
                      <option key={d} value={d}>
                        {d.replaceAll("_", " ")}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Satuan dasar</Label>
                  <Input
                    value={form.baseUnit}
                    onChange={(e) => setForm({ ...form, baseUnit: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Harga jual / satuan dasar</Label>
                  <Input
                    type="number"
                    value={form.salePrice}
                    onChange={(e) => setForm({ ...form, salePrice: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Harga pokok</Label>
                  <Input
                    type="number"
                    value={form.costPrice}
                    onChange={(e) => setForm({ ...form, costPrice: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Stok minimum</Label>
                  <Input
                    type="number"
                    value={form.minStock}
                    onChange={(e) => setForm({ ...form, minStock: e.target.value })}
                  />
                </div>
                <label className="flex items-center gap-2 pt-6 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={form.requiresPrescription}
                    onChange={(e) =>
                      setForm({ ...form, requiresPrescription: e.target.checked })
                    }
                  />
                  Wajib resep
                </label>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <Label>Satuan &amp; konversi</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setUnits([...units, emptyUnit()])}
                  >
                    <Plus className="size-3.5" /> Satuan
                  </Button>
                </div>
                <div className="space-y-2">
                  {units.map((u, index) => (
                    <div key={index} className="flex gap-2">
                      <Input
                        placeholder="Nama (mis. strip)"
                        value={u.name}
                        onChange={(e) => {
                          const next = [...units];
                          next[index] = { ...u, name: e.target.value };
                          setUnits(next);
                        }}
                      />
                      <Input
                        type="number"
                        placeholder="Konversi"
                        value={u.conversion}
                        onChange={(e) => {
                          const next = [...units];
                          next[index] = { ...u, conversion: e.target.value };
                          setUnits(next);
                        }}
                      />
                      <Input
                        type="number"
                        placeholder="Harga jual"
                        value={u.price}
                        onChange={(e) => {
                          const next = [...units];
                          next[index] = { ...u, price: e.target.value };
                          setUnits(next);
                        }}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => setUnits(units.filter((_, i) => i !== index))}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Konversi = jumlah satuan dasar dalam 1 satuan ini (1 strip = 10 tablet
                  → 10).
                </p>
              </div>

              {error && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                  Batal
                </Button>
                <Button type="submit" disabled={createProduct.isPending}>
                  {createProduct.isPending ? "Menyimpan..." : "Simpan produk"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-5">
          <div className="mb-4 flex items-center gap-2">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Cari nama / SKU / barcode..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <span className="text-sm text-muted-foreground">
              {products.data?.meta.total ?? 0} produk
            </span>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Golongan</TableHead>
                <TableHead className="text-right">Stok</TableHead>
                <TableHead className="text-right">Harga jual</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.data?.data.length ? (
                products.data.data.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {p.genericName ?? p.categoryName ?? "-"}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                    <TableCell>
                      <Badge variant={p.drugClass === "obat_keras" ? "warning" : "secondary"}>
                        {p.drugClass.replaceAll("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className={
                          p.stock <= p.minStock ? "font-medium text-amber-600" : ""
                        }
                      >
                        {formatNumber(p.stock)} {p.baseUnit}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {formatIDR(p.salePrice)}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableEmpty colSpan={5}>
                  {products.isLoading ? "Memuat..." : "Belum ada produk"}
                </TableEmpty>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
