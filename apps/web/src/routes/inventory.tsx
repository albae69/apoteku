import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { api, apiList } from "@/lib/api";
import { daysUntil, formatDate, formatIDR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/inventory")({ component: InventoryPage });

type StockRow = {
  id: number;
  sku: string;
  name: string;
  baseUnit: string;
  minStock: number;
  salePrice: number;
  costPrice: number;
  stock: number;
};

type BatchRow = {
  id: number;
  productName: string;
  sku: string;
  baseUnit: string;
  batchNumber: string | null;
  expiryDate: string | null;
  quantity: number;
  costPrice: number;
};

type Alerts = {
  lowStock: StockRow[];
  expiring: {
    id: number;
    productName: string;
    batchNumber: string | null;
    expiryDate: string | null;
    quantity: number;
    baseUnit: string;
  }[];
};

type Tab = "stock" | "batches" | "alerts";

function ExpiryBadge({ date }: { date: string | null }) {
  const days = daysUntil(date);
  if (days === null) return <span className="text-muted-foreground">-</span>;
  if (days < 0) return <Badge variant="destructive">ED lewat</Badge>;
  if (days <= 90) return <Badge variant="warning">{days} hari lagi</Badge>;
  return <Badge variant="success">{days} hari lagi</Badge>;
}

function InventoryPage() {
  const [tab, setTab] = useState<Tab>("stock");
  const [q, setQ] = useState("");
  const [batchStatus, setBatchStatus] = useState("all");

  const stock = useQuery({
    queryKey: ["inventory-stock", q],
    queryFn: () =>
      apiList<{ data: StockRow[] }>(
        `/inventory/stock?perPage=200${q ? `&q=${encodeURIComponent(q)}` : ""}`,
      ),
    enabled: tab === "stock",
  });

  const batches = useQuery({
    queryKey: ["inventory-batches", q, batchStatus],
    queryFn: () =>
      apiList<{ data: BatchRow[] }>(
        `/inventory/batches?perPage=200&status=${batchStatus}${
          q ? `&q=${encodeURIComponent(q)}` : ""
        }`,
      ),
    enabled: tab === "batches",
  });

  const alerts = useQuery({
    queryKey: ["inventory-alerts"],
    queryFn: () => api<Alerts>("/inventory/alerts"),
    enabled: tab === "alerts",
  });

  const tabs: { id: Tab; label: string }[] = [
    { id: "stock", label: "Stok Produk" },
    { id: "batches", label: "Batch & Expiry" },
    { id: "alerts", label: "Peringatan" },
  ];

  return (
    <>
      <PageHeader
        title="Persediaan"
        description="Stok, batch, tanggal kedaluwarsa, dan peringatan"
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border bg-background p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                tab === t.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab !== "alerts" && (
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Cari produk / batch..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        )}

        {tab === "batches" && (
          <Select
            className="w-40"
            value={batchStatus}
            onChange={(e) => setBatchStatus(e.target.value)}
          >
            <option value="all">Semua batch</option>
            <option value="available">Masih ada stok</option>
            <option value="expiring">Mendekati ED</option>
            <option value="expired">Sudah ED</option>
            <option value="empty">Stok habis</option>
          </Select>
        )}
      </div>

      {tab === "stock" && (
        <Card>
          <CardContent className="pt-5">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produk</TableHead>
                  <TableHead className="text-right">Stok</TableHead>
                  <TableHead className="text-right">Minimum</TableHead>
                  <TableHead className="text-right">HPP</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stock.data?.data.length ? (
                  stock.data.data.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <div className="font-medium">{p.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {p.sku}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {formatNumber(p.stock)} {p.baseUnit}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatNumber(p.minStock)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatIDR(p.costPrice)}
                      </TableCell>
                      <TableCell>
                        {p.stock <= 0 ? (
                          <Badge variant="destructive">Habis</Badge>
                        ) : p.stock <= p.minStock ? (
                          <Badge variant="warning">Stok rendah</Badge>
                        ) : (
                          <Badge variant="success">Aman</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableEmpty colSpan={5}>Belum ada data stok</TableEmpty>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {tab === "batches" && (
        <Card>
          <CardContent className="pt-5">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produk</TableHead>
                  <TableHead>No. Batch</TableHead>
                  <TableHead>Kedaluwarsa</TableHead>
                  <TableHead className="text-right">Sisa</TableHead>
                  <TableHead>Estimasi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.data?.data.length ? (
                  batches.data.data.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell>
                        <div className="font-medium">{b.productName}</div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {b.sku}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {b.batchNumber ?? "-"}
                      </TableCell>
                      <TableCell>{formatDate(b.expiryDate)}</TableCell>
                      <TableCell className="text-right">
                        {formatNumber(b.quantity)} {b.baseUnit}
                      </TableCell>
                      <TableCell>
                        <ExpiryBadge date={b.expiryDate} />
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableEmpty colSpan={5}>Tidak ada batch</TableEmpty>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {tab === "alerts" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Stok di bawah minimum</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produk</TableHead>
                    <TableHead className="text-right">Stok</TableHead>
                    <TableHead className="text-right">Min</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {alerts.data?.lowStock.length ? (
                    alerts.data.lowStock.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell className="text-right text-amber-600">
                          {formatNumber(p.stock)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {formatNumber(p.minStock)}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableEmpty colSpan={3}>Semua stok aman 🎉</TableEmpty>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Mendekati / melewati kedaluwarsa</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produk</TableHead>
                    <TableHead>Batch</TableHead>
                    <TableHead>ED</TableHead>
                    <TableHead className="text-right">Sisa</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {alerts.data?.expiring.length ? (
                    alerts.data.expiring.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell className="font-medium">{b.productName}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {b.batchNumber ?? "-"}
                        </TableCell>
                        <TableCell>
                          <ExpiryBadge date={b.expiryDate} />
                        </TableCell>
                        <TableCell className="text-right">
                          {formatNumber(b.quantity)}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableEmpty colSpan={4}>Tidak ada batch berisiko</TableEmpty>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
