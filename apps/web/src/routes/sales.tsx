import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Printer, ReceiptText } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import {
  Receipt,
  usePrintReceipt,
  type ReceiptSale,
  type ReceiptSettings,
} from "@/components/receipt";
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
import { api, apiList } from "@/lib/api";
import { formatDateTime, formatIDR } from "@/lib/format";

export const Route = createFileRoute("/sales")({ component: SalesPage });

type SaleRow = {
  id: number;
  code: string;
  createdAt: string;
  customerName: string | null;
  userName: string | null;
  total: number;
  status: "completed" | "void";
  itemCount: number;
  shiftId: number | null;
};

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
};

function SalesPage() {
  const [from, setFrom] = useState(today());
  const [all, setAll] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { print, node } = usePrintReceipt();

  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<ReceiptSettings>("/settings"),
  });

  const sales = useQuery({
    queryKey: ["sales", all ? "all" : from],
    queryFn: () =>
      apiList<{ data: SaleRow[] }>(`/sales${all ? "" : `?from=${from}`}`),
  });

  const detail = useQuery({
    queryKey: ["sale-detail", selectedId],
    queryFn: () => api<ReceiptSale>(`/sales/${selectedId}`),
    enabled: selectedId !== null,
  });

  const rows = sales.data?.data ?? [];
  const completed = rows.filter((r) => r.status === "completed");
  const summary = {
    count: completed.length,
    revenue: completed.reduce((s, r) => s + r.total, 0),
  };

  return (
    <>
      {node}
      <PageHeader
        title="Transaksi"
        description="Riwayat penjualan dan cetak ulang struk"
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label>Sejak tanggal</Label>
          <Input
            type="date"
            className="w-44"
            value={from}
            disabled={all}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <label className="flex h-9 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={all}
            onChange={(e) => setAll(e.target.checked)}
          />
          Semua transaksi
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardContent className="pt-5">
            <div className="mb-4 flex flex-wrap gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Transaksi: </span>
                <span className="font-medium">{summary.count}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Omzet: </span>
                <span className="font-medium">{formatIDR(summary.revenue)}</span>
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kode</TableHead>
                  <TableHead>Waktu</TableHead>
                  <TableHead>Kasir</TableHead>
                  <TableHead className="text-right">Item</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length ? (
                  rows.map((s) => (
                    <TableRow
                      key={s.id}
                      className={selectedId === s.id ? "bg-muted/60" : ""}
                    >
                      <TableCell className="font-mono text-xs">
                        {s.code}
                        {s.status === "void" && (
                          <Badge variant="destructive" className="ml-2">
                            void
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDateTime(s.createdAt)}
                      </TableCell>
                      <TableCell>{s.userName ?? "-"}</TableCell>
                      <TableCell className="text-right">{s.itemCount}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatIDR(s.total)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedId(s.id)}
                        >
                          <ReceiptText className="size-3.5" /> Struk
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableEmpty colSpan={6}>
                    {sales.isLoading ? "Memuat..." : "Belum ada transaksi"}
                  </TableEmpty>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="lg:sticky lg:top-6 lg:self-start">
          <CardHeader className="flex-row items-center gap-2">
            <ReceiptText className="size-4 text-muted-foreground" />
            <CardTitle>Pratinjau struk</CardTitle>
          </CardHeader>
          <CardContent>
            {detail.data ? (
              <>
                <div className="mb-3 flex justify-center overflow-hidden rounded-lg border bg-white py-3">
                  <Receipt sale={detail.data} settings={settings.data ?? null} />
                </div>
                <Button
                  className="w-full"
                  onClick={() => print(detail.data!, settings.data ?? null)}
                >
                  <Printer className="size-4" /> Cetak struk
                </Button>
              </>
            ) : (
              <p className="py-16 text-center text-sm text-muted-foreground">
                {detail.isFetching
                  ? "Memuat struk..."
                  : "Pilih transaksi untuk melihat struk"}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
