import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Minus, Plus, Printer, Search, ShoppingCart, Trash2, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PAYMENT_METHODS, type SaleInput } from "@apoteku/shared";
import { PageHeader } from "@/components/page-header";
import {
  usePrintReceipt,
  type ReceiptSale,
  type ReceiptSettings,
} from "@/components/receipt";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ApiError, api, apiList, type PaginatedResponse } from "@/lib/api";
import { formatIDR } from "@/lib/format";

export const Route = createFileRoute("/pos")({ component: PosPage });

type LookupProduct = {
  id: number;
  name: string;
  sku: string;
  baseUnit: string;
  salePrice: number;
  stock: number;
  requiresPrescription: boolean;
  units: {
    id: number;
    name: string;
    conversion: number;
    price: number | null;
    isBase: boolean;
  }[];
};

type CartItem = {
  key: string;
  productId: number;
  name: string;
  unitId: number | null;
  unitName: string;
  conversion: number;
  unitPrice: number;
  quantity: number;
  stockBase: number;
};

type Customer = { id: number; name: string };

type CurrentShift = { id: number; openingCash: number; openedAt: string };

function PosPage() {
  const qc = useQueryClient();
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [lastSale, setLastSale] = useState<ReceiptSale | null>(null);
  const [openingCash, setOpeningCash] = useState("0");
  const { print, node } = usePrintReceipt();

  const shift = useQuery({
    queryKey: ["shift-current"],
    queryFn: () => api<CurrentShift | null>("/shifts/current"),
  });

  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<ReceiptSettings>("/settings"),
  });

  const openShift = useMutation({
    mutationFn: () =>
      api("/shifts/open", {
        method: "POST",
        body: { openingCash: Number(openingCash || 0) },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shift-current"] }),
  });
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [discount, setDiscount] = useState("0");
  const [tax, setTax] = useState("0");
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]>("cash");
  const [paid, setPaid] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(timer);
  }, [term]);

  const lookup = useQuery({
    queryKey: ["lookup", debounced],
    queryFn: () =>
      api<LookupProduct[]>(`/products/lookup?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 1,
  });

  const customers = useQuery({
    queryKey: ["customers"],
    queryFn: () => apiList<PaginatedResponse<Customer>>("/master/customers?perPage=100"),
  });

  const subtotal = useMemo(
    () => cart.reduce((s, i) => s + i.quantity * i.unitPrice, 0),
    [cart],
  );
  const total = useMemo(
    () => Math.max(0, subtotal - Number(discount || 0) + Number(tax || 0)),
    [subtotal, discount, tax],
  );
  const paidValue = paid === "" ? total : Number(paid);
  const change = paidValue - total;

  function addToCart(product: LookupProduct, unitId: number | null) {
    const unit =
      unitId === null
        ? null
        : product.units.find((u) => u.id === unitId) ?? null;
    const conversion = unit?.conversion ?? 1;
    const unitName = unit?.name ?? product.baseUnit;
    const unitPrice = unit?.price ?? product.salePrice * conversion;
    const key = `${product.id}:${unitId ?? "base"}`;
    const maxUnits = Math.floor(product.stock / conversion);
    if (maxUnits <= 0) {
      setError(`${product.name} tidak memiliki stok`);
      return;
    }
    setError(null);
    setCart((prev) => {
      const found = prev.find((i) => i.key === key);
      if (found) {
        return prev.map((i) =>
          i.key === key
            ? { ...i, quantity: Math.min(i.quantity + 1, maxUnits) }
            : i,
        );
      }
      return [
        ...prev,
        {
          key,
          productId: product.id,
          name: product.name,
          unitId,
          unitName,
          conversion,
          unitPrice,
          quantity: 1,
          stockBase: product.stock,
        },
      ];
    });
  }

  function updateQty(key: string, delta: number) {
    setCart((prev) =>
      prev.flatMap((i) => {
        if (i.key !== key) return [i];
        const maxUnits = Math.floor(i.stockBase / i.conversion);
        const next = Math.min(Math.max(1, i.quantity + delta), maxUnits);
        return [{ ...i, quantity: next }];
      }),
    );
  }

  const createSale = useMutation({
    mutationFn: (payload: SaleInput) =>
      api<ReceiptSale>("/sales", {
        method: "POST",
        body: payload,
      }),
    onSuccess: (sale) => {
      setLastSale(sale);
      setMessage(null);
      setError(null);
      setCart([]);
      setDiscount("0");
      setTax("0");
      setPaid("");
      setCustomerId("");
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["lookup"] });
      qc.invalidateQueries({ queryKey: ["shift-current"] });
      qc.invalidateQueries({ queryKey: ["sales"] });
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Gagal menyimpan transaksi"),
  });

  function checkout() {
    if (cart.length === 0) {
      setError("Keranjang masih kosong");
      return;
    }
    const payload: SaleInput = {
      customerId: customerId ? Number(customerId) : null,
      discount: Number(discount || 0),
      tax: Number(tax || 0),
      items: cart.map((i) => ({
        productId: i.productId,
        unitId: i.unitId,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        discount: 0,
      })),
      payments: [{ method, amount: paidValue, reference: "" }],
    };
    createSale.mutate(payload);
  }

  if (shift.isLoading) {
    return (
      <>
        <PageHeader title="Kasir" description="Transaksi penjualan & penebusan resep" />
        <p className="text-sm text-muted-foreground">Memuat status shift...</p>
      </>
    );
  }

  if (!shift.data) {
    return (
      <>
        <PageHeader title="Kasir" description="Transaksi penjualan & penebusan resep" />
        <Card className="max-w-md">
          <CardHeader className="flex-row items-center gap-2">
            <Wallet className="size-4 text-muted-foreground" />
            <CardTitle>Buka shift dulu</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Kasir harus membuka shift sebelum melayani transaksi.
            </p>
            <div className="space-y-1.5">
              <Label>Uang awal di laci</Label>
              <Input
                type="number"
                value={openingCash}
                onChange={(e) => setOpeningCash(e.target.value)}
              />
            </div>
            {openShift.isError && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {openShift.error instanceof ApiError
                  ? openShift.error.message
                  : "Gagal membuka shift"}
              </p>
            )}
            <Button
              className="w-full"
              onClick={() => openShift.mutate()}
              disabled={openShift.isPending}
            >
              {openShift.isPending ? "Membuka..." : "Buka shift"}
            </Button>
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      {node}
      <PageHeader title="Kasir" description="Transaksi penjualan & penebusan resep" />

      {lastSale && (
        <Card className="mb-4 border-emerald-300 bg-emerald-50/60">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-5">
            <div>
              <p className="font-medium text-emerald-800">
                Transaksi {lastSale.code} berhasil
              </p>
              <p className="text-sm text-emerald-700">
                Total {formatIDR(lastSale.total)} • Kembalian{" "}
                {formatIDR(lastSale.changeAmount)}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => print(lastSale, settings.data ?? null)}
              >
                <Printer className="size-4" /> Cetak struk
              </Button>
              <Button variant="ghost" onClick={() => setLastSale(null)}>
                Tutup
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardContent className="pt-5">
            <div className="relative mb-4">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                autoFocus
                className="pl-8"
                placeholder="Scan barcode atau cari nama obat..."
                value={term}
                onChange={(e) => setTerm(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              {lookup.data?.length ? (
                lookup.data.map((p) => (
                  <div
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{p.name}</span>
                        {p.requiresPrescription && (
                          <Badge variant="warning">Resep</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Stok {p.stock} {p.baseUnit} • {formatIDR(p.salePrice)}/
                        {p.baseUnit}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => addToCart(p, null)}
                        disabled={p.stock <= 0}
                      >
                        + {p.baseUnit}
                      </Button>
                      {p.units
                        .filter((u) => !u.isBase)
                        .map((u) => (
                          <Button
                            key={u.id}
                            size="sm"
                            variant="outline"
                            onClick={() => addToCart(p, u.id)}
                            disabled={p.stock < u.conversion}
                          >
                            + {u.name} ({formatIDR(u.price ?? p.salePrice * u.conversion)})
                          </Button>
                        ))}
                    </div>
                  </div>
                ))
              ) : (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  {debounced
                    ? "Produk tidak ditemukan"
                    : "Ketik nama atau scan barcode untuk mulai"}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:sticky lg:top-6 lg:self-start">
          <CardHeader className="flex-row items-center gap-2">
            <ShoppingCart className="size-4 text-muted-foreground" />
            <CardTitle>Keranjang</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {cart.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Belum ada item
                </p>
              ) : (
                cart.map((i) => (
                  <div key={i.key} className="flex items-center gap-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{i.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatIDR(i.unitPrice)} / {i.unitName}
                      </div>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      onClick={() => updateQty(i.key, -1)}
                    >
                      <Minus className="size-3.5" />
                    </Button>
                    <span className="w-8 text-center tabular-nums">{i.quantity}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      onClick={() => updateQty(i.key, 1)}
                    >
                      <Plus className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 text-destructive"
                      onClick={() =>
                        setCart((prev) => prev.filter((x) => x.key !== i.key))
                      }
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))
              )}
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

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>Diskon</Label>
                <Input
                  type="number"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Pajak</Label>
                <Input
                  type="number"
                  value={tax}
                  onChange={(e) => setTax(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1 border-t pt-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatIDR(subtotal)}</span>
              </div>
              <div className="flex justify-between text-base font-semibold">
                <span>Total</span>
                <span>{formatIDR(total)}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>Metode</Label>
                <Select
                  value={method}
                  onChange={(e) =>
                    setMethod(e.target.value as (typeof PAYMENT_METHODS)[number])
                  }
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Dibayar</Label>
                <Input
                  type="number"
                  value={paid}
                  placeholder={String(total)}
                  onChange={(e) => setPaid(e.target.value)}
                />
              </div>
            </div>

            {method === "cash" && change >= 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Kembalian</span>
                <span className="font-medium">{formatIDR(change)}</span>
              </div>
            )}

            {message && (
              <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {message}
              </p>
            )}
            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <Button
              className="w-full"
              size="lg"
              onClick={checkout}
              disabled={createSale.isPending || cart.length === 0}
            >
              {createSale.isPending ? "Memproses..." : `Bayar ${formatIDR(total)}`}
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
