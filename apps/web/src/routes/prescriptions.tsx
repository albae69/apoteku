import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { type PrescriptionInput } from "@apoteku/shared";
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
import { formatDateTime } from "@/lib/format";

export const Route = createFileRoute("/prescriptions")({
  component: PrescriptionsPage,
});

type RxRow = {
  id: number;
  code: string;
  patientName: string;
  doctorName: string | null;
  customerName: string | null;
  status: "pending" | "dispensed" | "cancelled";
  createdAt: string;
  itemCount: number;
};

type Doctor = { id: number; name: string };
type Customer = { id: number; name: string };
type ProductLite = { id: number; name: string };

type ItemDraft = {
  productId: string;
  name: string;
  quantity: string;
  signa: string;
};

const emptyItem = (): ItemDraft => ({
  productId: "",
  name: "",
  quantity: "1",
  signa: "",
});

const statusVariant = {
  pending: "warning",
  dispensed: "success",
  cancelled: "destructive",
} as const;

function PrescriptionsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [patientName, setPatientName] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([emptyItem()]);
  const [error, setError] = useState<string | null>(null);

  const prescriptions = useQuery({
    queryKey: ["prescriptions"],
    queryFn: () => apiList<{ data: RxRow[] }>("/prescriptions"),
  });

  const doctors = useQuery({
    queryKey: ["doctors"],
    queryFn: () => apiList<PaginatedResponse<Doctor>>("/master/doctors?perPage=100"),
  });

  const customers = useQuery({
    queryKey: ["customers"],
    queryFn: () => apiList<PaginatedResponse<Customer>>("/master/customers?perPage=100"),
  });

  const products = useQuery({
    queryKey: ["products-lite"],
    queryFn: () => apiList<PaginatedResponse<ProductLite>>("/products?perPage=200"),
  });

  const createRx = useMutation({
    mutationFn: (payload: PrescriptionInput) =>
      api("/prescriptions", { method: "POST", body: payload }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prescriptions"] });
      setShowForm(false);
      setPatientName("");
      setDoctorId("");
      setCustomerId("");
      setItems([emptyItem()]);
      setError(null);
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Gagal menyimpan resep"),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const valid = items.filter((i) => i.productId || i.name.trim());
    if (!patientName.trim()) {
      setError("Nama pasien wajib diisi");
      return;
    }
    if (valid.length === 0) {
      setError("Tambahkan minimal 1 item resep");
      return;
    }
    createRx.mutate({
      patientName: patientName.trim(),
      doctorId: doctorId ? Number(doctorId) : null,
      customerId: customerId ? Number(customerId) : null,
      items: valid.map((i) => ({
        productId: i.productId ? Number(i.productId) : null,
        name: i.name || products.data?.data.find((p) => p.id === Number(i.productId))?.name || "Obat",
        quantity: Number(i.quantity || 1),
        signa: i.signa,
      })),
    });
  }

  return (
    <>
      <PageHeader
        title="Resep"
        description="Pencatatan resep dokter dan penebusan obat"
        actions={
          <Button onClick={() => setShowForm((v) => !v)}>
            {showForm ? <X className="size-4" /> : <Plus className="size-4" />}
            {showForm ? "Tutup" : "Input resep"}
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
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Nama pasien</Label>
                  <Input
                    value={patientName}
                    onChange={(e) => setPatientName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Dokter</Label>
                  <Select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                    <option value="">— Tanpa dokter —</option>
                    {doctors.data?.data.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Pelanggan</Label>
                  <Select
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}
                  >
                    <option value="">— Umum —</option>
                    {customers.data?.data.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <Label>Item resep</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setItems([...items, emptyItem()])}
                  >
                    <Plus className="size-3.5" /> Obat
                  </Button>
                </div>
                <div className="space-y-2">
                  {items.map((item, index) => (
                    <div
                      key={index}
                      className="grid gap-2 rounded-lg border p-3 md:grid-cols-[2fr_1fr_1.5fr_auto]"
                    >
                      <Select
                        value={item.productId}
                        onChange={(e) => {
                          const next = [...items];
                          next[index] = { ...item, productId: e.target.value };
                          setItems(next);
                        }}
                      >
                        <option value="">— Pilih obat —</option>
                        {products.data?.data.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </Select>
                      <Input
                        type="number"
                        placeholder="Jumlah"
                        value={item.quantity}
                        onChange={(e) => {
                          const next = [...items];
                          next[index] = { ...item, quantity: e.target.value };
                          setItems(next);
                        }}
                      />
                      <Input
                        placeholder="Signa (mis. 3 x 1 sehari)"
                        value={item.signa}
                        onChange={(e) => {
                          const next = [...items];
                          next[index] = { ...item, signa: e.target.value };
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
                <Button type="submit" disabled={createRx.isPending}>
                  {createRx.isPending ? "Menyimpan..." : "Simpan resep"}
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
                <TableHead>Pasien</TableHead>
                <TableHead>Dokter</TableHead>
                <TableHead className="text-right">Item</TableHead>
                <TableHead>Waktu</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {prescriptions.data?.data.length ? (
                prescriptions.data.data.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.code}</TableCell>
                    <TableCell className="font-medium">{r.patientName}</TableCell>
                    <TableCell>{r.doctorName ?? "-"}</TableCell>
                    <TableCell className="text-right">{r.itemCount}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(r.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[r.status]}>{r.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableEmpty colSpan={6}>Belum ada resep</TableEmpty>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
