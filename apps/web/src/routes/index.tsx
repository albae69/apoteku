import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  Boxes,
  CalendarClock,
  Package,
  Receipt,
  TrendingUp,
} from "lucide-react";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import { formatDateTime, formatIDR, formatNumber } from "@/lib/format";

export const Route = createFileRoute("/")({ component: DashboardPage });

type Summary = {
  today: { transactions: number; revenue: number; profit: number };
  counts: { products: number; lowStock: number; expiring: number };
  stockValue: number;
  topProducts: {
    productId: number;
    name: string;
    quantity: number;
    revenue: number;
  }[];
  recentSales: { id: number; code: string; total: number; createdAt: string }[];
};

function StatCard({
  title,
  value,
  icon,
  hint,
}: {
  title: string;
  value: string;
  icon: ReactNode;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between pt-5">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </div>
      </CardContent>
    </Card>
  );
}

function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<Summary>("/dashboard/summary"),
  });

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Ringkasan operasional apotek hari ini"
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Penjualan hari ini"
          value={formatIDR(data?.today.revenue)}
          icon={<TrendingUp className="size-4" />}
          hint={`${data?.today.transactions ?? 0} transaksi`}
        />
        <StatCard
          title="Laba hari ini"
          value={formatIDR(data?.today.profit)}
          icon={<Receipt className="size-4" />}
        />
        <StatCard
          title="Nilai persediaan"
          value={formatIDR(data?.stockValue)}
          icon={<Boxes className="size-4" />}
          hint={`${data?.counts.products ?? 0} produk aktif`}
        />
        <StatCard
          title="Perlu perhatian"
          value={`${data?.counts.lowStock ?? 0} / ${data?.counts.expiring ?? 0}`}
          icon={<AlertTriangle className="size-4" />}
          hint="stok rendah / mendekati ED"
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center gap-2">
            <Package className="size-4 text-muted-foreground" />
            <CardTitle>Produk terlaris hari ini</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produk</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Omzet</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.topProducts.length ? (
                  data.topProducts.map((p) => (
                    <TableRow key={p.productId}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell className="text-right">
                        {formatNumber(p.quantity)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatIDR(p.revenue)}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableEmpty colSpan={3}>
                    {isLoading ? "Memuat..." : "Belum ada penjualan hari ini"}
                  </TableEmpty>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center gap-2">
            <CalendarClock className="size-4 text-muted-foreground" />
            <CardTitle>Transaksi terbaru</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kode</TableHead>
                  <TableHead>Waktu</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.recentSales.length ? (
                  data.recentSales.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <Badge variant="secondary">{s.code}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDateTime(s.createdAt)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatIDR(s.total)}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableEmpty colSpan={3}>Belum ada transaksi</TableEmpty>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
