import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { LockKeyhole, Unlock } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError, api, apiList } from "@/lib/api";
import { formatDateTime, formatIDR } from "@/lib/format";

export const Route = createFileRoute("/shift")({ component: ShiftPage });

type Shift = {
  id: number;
  userName?: string | null;
  status: "open" | "closed";
  openedAt: string;
  closedAt: string | null;
  openingCash: number;
  closingCash: number | null;
  expectedCash: number | null;
  difference: number | null;
  totalSales: number;
  totalCash: number;
  totalNonCash: number;
  transactionCount: number;
  note: string | null;
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function ShiftPage() {
  const qc = useQueryClient();
  const [openingCash, setOpeningCash] = useState("0");
  const [closingCash, setClosingCash] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const current = useQuery({
    queryKey: ["shift-current"],
    queryFn: () => api<Shift | null>("/shifts/current"),
  });

  const history = useQuery({
    queryKey: ["shifts"],
    queryFn: () => apiList<{ data: Shift[] }>("/shifts"),
  });

  useEffect(() => {
    if (current.data?.expectedCash != null) {
      setClosingCash(String(current.data.expectedCash));
    }
  }, [current.data?.expectedCash]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["shift-current"] });
    qc.invalidateQueries({ queryKey: ["shifts"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["sales"] });
  }

  const openShift = useMutation({
    mutationFn: () =>
      api("/shifts/open", {
        method: "POST",
        body: { openingCash: Number(openingCash || 0), note },
      }),
    onSuccess: () => {
      setError(null);
      setNote("");
      invalidate();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Gagal membuka shift"),
  });

  const closeShift = useMutation({
    mutationFn: (id: number) =>
      api(`/shifts/${id}/close`, {
        method: "POST",
        body: { closingCash: Number(closingCash || 0), note },
      }),
    onSuccess: () => {
      setError(null);
      setNote("");
      setClosingCash("");
      invalidate();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Gagal menutup shift"),
  });

  const shift = current.data ?? null;
  const expected = shift?.expectedCash ?? 0;
  const counted = Number(closingCash || 0);
  const previewDiff = shift ? counted - expected : 0;

  return (
    <>
      <PageHeader
        title="Shift Kasir"
        description="Buka/tutup shift dan rekonsiliasi uang tunai laci"
      />

      {error && (
        <p className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Shift saat ini</CardTitle>
            {shift ? (
              <Badge variant="success">Terbuka</Badge>
            ) : (
              <Badge variant="secondary">Belum dibuka</Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {shift ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Dibuka {formatDateTime(shift.openedAt)}
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <Stat label="Uang awal" value={formatIDR(shift.openingCash)} />
                  <Stat label="Transaksi" value={String(shift.transactionCount)} />
                  <Stat label="Total penjualan" value={formatIDR(shift.totalSales)} />
                  <Stat label="Tunai" value={formatIDR(shift.totalCash)} />
                  <Stat label="Non-tunai" value={formatIDR(shift.totalNonCash)} />
                  <Stat
                    label="Kas seharusnya"
                    value={formatIDR(shift.expectedCash ?? 0)}
                  />
                </div>

                <div className="space-y-3 border-t pt-4">
                  <div className="space-y-1.5">
                    <Label>Uang fisik dihitung</Label>
                    <Input
                      type="number"
                      value={closingCash}
                      onChange={(e) => setClosingCash(e.target.value)}
                    />
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Selisih</span>
                    <span
                      className={
                        previewDiff === 0
                          ? "font-medium text-emerald-600"
                          : "font-medium text-destructive"
                      }
                    >
                      {formatIDR(previewDiff)}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Catatan</Label>
                    <Input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Opsional"
                    />
                  </div>
                  <Button
                    variant="destructive"
                    className="w-full"
                    onClick={() => closeShift.mutate(shift.id)}
                    disabled={closeShift.isPending}
                  >
                    <LockKeyhole className="size-4" />
                    {closeShift.isPending ? "Menutup..." : "Tutup shift"}
                  </Button>
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Buka shift sebelum mulai bertransaksi di kasir.
                </p>
                <div className="space-y-1.5">
                  <Label>Uang awal di laci</Label>
                  <Input
                    type="number"
                    value={openingCash}
                    onChange={(e) => setOpeningCash(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Catatan</Label>
                  <Input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Opsional"
                  />
                </div>
                <Button
                  className="w-full"
                  onClick={() => openShift.mutate()}
                  disabled={openShift.isPending}
                >
                  <Unlock className="size-4" />
                  {openShift.isPending ? "Membuka..." : "Buka shift"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Riwayat shift</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kasir</TableHead>
                  <TableHead>Buka</TableHead>
                  <TableHead className="text-right">Penjualan</TableHead>
                  <TableHead className="text-right">Seharusnya</TableHead>
                  <TableHead className="text-right">Fisik</TableHead>
                  <TableHead className="text-right">Selisih</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.data?.data.length ? (
                  history.data.data.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <div className="font-medium">{s.userName ?? "-"}</div>
                        <div className="text-xs text-muted-foreground">
                          {s.status === "open" ? (
                            <Badge variant="success">terbuka</Badge>
                          ) : (
                            formatDateTime(s.closedAt)
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDateTime(s.openedAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatIDR(s.totalSales)}
                        <div className="text-xs text-muted-foreground">
                          {s.transactionCount} trx
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {s.expectedCash == null ? "-" : formatIDR(s.expectedCash)}
                      </TableCell>
                      <TableCell className="text-right">
                        {s.closingCash == null ? "-" : formatIDR(s.closingCash)}
                      </TableCell>
                      <TableCell className="text-right">
                        {s.difference == null ? (
                          "-"
                        ) : (
                          <span
                            className={
                              s.difference === 0
                                ? "text-emerald-600"
                                : "text-destructive"
                            }
                          >
                            {formatIDR(s.difference)}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableEmpty colSpan={6}>Belum ada shift</TableEmpty>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
