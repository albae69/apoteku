import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { formatDate, formatDateTime, formatIDR, formatNumber } from "@/lib/format";

export type ReceiptSale = {
  code: string;
  createdAt: string;
  cashierName?: string | null;
  customerName?: string | null;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paidAmount: number;
  changeAmount: number;
  items: {
    id: number;
    productName: string;
    quantity: number;
    unitPrice: number;
    discount: number;
    subtotal: number;
    baseUnit?: string | null;
  }[];
  payments: { id: number; method: string; amount: number; reference?: string | null }[];
};

export type ReceiptSettings = {
  pharmacyName: string;
  address?: string | null;
  phone?: string | null;
  pharmacistName?: string | null;
  receiptFooter?: string | null;
} | null;

const METHOD_LABEL: Record<string, string> = {
  cash: "Tunai",
  debit: "Debit",
  credit: "Kredit",
  qris: "QRIS",
  ewallet: "E-Wallet",
  transfer: "Transfer",
};

/** Gabungkan baris yang berasal dari batch berbeda untuk produk yang sama. */
function groupItems(sale: ReceiptSale) {
  const map = new Map<string, { name: string; qty: number; price: number; total: number }>();
  for (const item of sale.items) {
    const key = `${item.productName}|${item.unitPrice}`;
    const found = map.get(key);
    if (found) {
      found.qty += item.quantity;
      found.total += item.subtotal;
    } else {
      map.set(key, {
        name: item.productName,
        qty: item.quantity,
        price: item.unitPrice,
        total: item.subtotal,
      });
    }
  }
  return [...map.values()];
}

export function Receipt({
  sale,
  settings,
}: {
  sale: ReceiptSale;
  settings: ReceiptSettings;
}) {
  const items = groupItems(sale);
  const tendered = sale.payments.reduce((s, p) => s + p.amount, 0);

  return (
    <div className="receipt">
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>
          {settings?.pharmacyName ?? "Apotek"}
        </div>
        {settings?.address && <div>{settings.address}</div>}
        {settings?.phone && <div>Telp. {settings.phone}</div>}
      </div>

      <hr />

      <table>
        <tbody>
          <tr>
            <td>No. Nota</td>
            <td className="num">{sale.code}</td>
          </tr>
          <tr>
            <td>Tanggal</td>
            <td className="num">{formatDateTime(sale.createdAt)}</td>
          </tr>
          <tr>
            <td>Kasir</td>
            <td className="num">{sale.cashierName ?? "-"}</td>
          </tr>
          {sale.customerName && (
            <tr>
              <td>Pelanggan</td>
              <td className="num">{sale.customerName}</td>
            </tr>
          )}
        </tbody>
      </table>

      <hr />

      <table>
        <tbody>
          {items.map((item, index) => (
            <tr key={index}>
              <td colSpan={2} style={{ paddingTop: 4 }}>
                {item.name}
              </td>
            </tr>
          ))}
          {items.map((item, index) => (
            <tr key={`detail-${index}`}>
              <td className="num" style={{ textAlign: "left" }}>
                {formatNumber(item.qty)} x {formatIDR(item.price)}
              </td>
              <td className="num">{formatIDR(item.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <hr />

      <table>
        <tbody>
          <tr>
            <td>Subtotal</td>
            <td className="num">{formatIDR(sale.subtotal)}</td>
          </tr>
          {sale.discount > 0 && (
            <tr>
              <td>Diskon</td>
              <td className="num">-{formatIDR(sale.discount)}</td>
            </tr>
          )}
          {sale.tax > 0 && (
            <tr>
              <td>Pajak</td>
              <td className="num">{formatIDR(sale.tax)}</td>
            </tr>
          )}
          <tr style={{ fontWeight: 700 }}>
            <td>TOTAL</td>
            <td className="num">{formatIDR(sale.total)}</td>
          </tr>
        </tbody>
      </table>

      <hr />

      <table>
        <tbody>
          {sale.payments.map((p) => (
            <tr key={p.id}>
              <td>{METHOD_LABEL[p.method] ?? p.method}</td>
              <td className="num">{formatIDR(p.amount)}</td>
            </tr>
          ))}
          {sale.payments.some((p) => p.method === "cash") && (
            <tr>
              <td>Kembalian</td>
              <td className="num">{formatIDR(sale.changeAmount)}</td>
            </tr>
          )}
          <tr>
            <td>Dibayar</td>
            <td className="num">{formatIDR(tendered)}</td>
          </tr>
        </tbody>
      </table>

      <hr />

      <div style={{ textAlign: "center", marginTop: 6 }}>
        {settings?.receiptFooter && <div>{settings.receiptFooter}</div>}
        {settings?.pharmacistName && <div>Apoteker: {settings.pharmacistName}</div>}
        <div style={{ marginTop: 6 }}>{formatDate(sale.createdAt)}</div>
      </div>
    </div>
  );
}

/**
 * Hook cetak struk: mengembalikan fungsi `print(sale, settings)` dan node portal
 * yang hanya tampil saat mencetak.
 */
export function usePrintReceipt() {
  const [payload, setPayload] = useState<{
    sale: ReceiptSale;
    settings: ReceiptSettings;
    nonce: number;
  } | null>(null);

  useEffect(() => {
    if (!payload) return;
    const timer = setTimeout(() => window.print(), 60);
    return () => clearTimeout(timer);
  }, [payload]);

  const print = (sale: ReceiptSale, settings: ReceiptSettings) =>
    setPayload((prev) => ({ sale, settings, nonce: (prev?.nonce ?? 0) + 1 }));

  const node =
    payload && typeof document !== "undefined"
      ? createPortal(
          <Receipt sale={payload.sale} settings={payload.settings} />,
          document.getElementById("print-root") ?? document.body,
        )
      : null;

  return { print, node };
}
