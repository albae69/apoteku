import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, api } from "@/lib/api";

export const Route = createFileRoute("/settings")({ component: SettingsPage });

type Settings = {
  pharmacyName: string;
  address: string | null;
  phone: string | null;
  npwp: string | null;
  pharmacistName: string | null;
  sipaNumber: string | null;
  taxPercent: number;
  receiptFooter: string | null;
};

const blank: Settings = {
  pharmacyName: "",
  address: "",
  phone: "",
  npwp: "",
  pharmacistName: "",
  sipaNumber: "",
  taxPercent: 0,
  receiptFooter: "",
};

function SettingsPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Settings>(blank);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<Settings | null>("/settings"),
  });

  useEffect(() => {
    if (settings.data) setForm({ ...blank, ...settings.data });
  }, [settings.data]);

  const save = useMutation({
    mutationFn: (payload: Settings) =>
      api("/settings", { method: "PUT", body: payload }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      setSaved(true);
      setError(null);
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Gagal menyimpan"),
  });

  function field<K extends keyof Settings>(key: K, value: Settings[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <>
      <PageHeader
        title="Pengaturan"
        description="Profil apotek, apoteker penanggung jawab, dan struk"
      />

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Profil apotek</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(form);
            }}
            className="space-y-4"
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Nama apotek</Label>
                <Input
                  value={form.pharmacyName}
                  onChange={(e) => field("pharmacyName", e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Telepon</Label>
                <Input
                  value={form.phone ?? ""}
                  onChange={(e) => field("phone", e.target.value)}
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label>Alamat</Label>
                <Input
                  value={form.address ?? ""}
                  onChange={(e) => field("address", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>NPWP</Label>
                <Input
                  value={form.npwp ?? ""}
                  onChange={(e) => field("npwp", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>PPN (%)</Label>
                <Input
                  type="number"
                  value={form.taxPercent}
                  onChange={(e) => field("taxPercent", Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Apoteker penanggung jawab</Label>
                <Input
                  value={form.pharmacistName ?? ""}
                  onChange={(e) => field("pharmacistName", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>No. SIPA</Label>
                <Input
                  value={form.sipaNumber ?? ""}
                  onChange={(e) => field("sipaNumber", e.target.value)}
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label>Catatan kaki struk</Label>
                <Input
                  value={form.receiptFooter ?? ""}
                  onChange={(e) => field("receiptFooter", e.target.value)}
                />
              </div>
            </div>

            {saved && (
              <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                Pengaturan tersimpan.
              </p>
            )}
            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <div className="flex justify-end">
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? "Menyimpan..." : "Simpan"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
