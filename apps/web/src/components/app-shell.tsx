import { Link, useRouterState } from "@tanstack/react-router";
import {
  Boxes,
  ClipboardList,
  FileText,
  LayoutDashboard,
  Pill,
  Receipt,
  Settings,
  ShoppingCart,
  LogOut,
  Wallet,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/pos", label: "Kasir", icon: ShoppingCart },
  { to: "/sales", label: "Transaksi", icon: Receipt },
  { to: "/products", label: "Produk", icon: Pill },
  { to: "/inventory", label: "Persediaan", icon: Boxes },
  { to: "/purchases", label: "Pembelian", icon: ClipboardList },
  { to: "/prescriptions", label: "Resep", icon: FileText },
  { to: "/shift", label: "Shift Kasir", icon: Wallet },
  { to: "/settings", label: "Pengaturan", icon: Settings },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="flex min-h-screen bg-muted/30">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-background md:flex">
        <div className="flex h-14 items-center gap-2 border-b px-5">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Pill className="size-4" />
          </div>
          <span className="font-semibold tracking-tight">Apoteku</span>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {NAV.map((item) => {
            const active =
              item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t p-3">
          <div className="mb-2 px-1">
            <p className="truncate text-sm font-medium">{user?.name}</p>
            <p className="truncate text-xs capitalize text-muted-foreground">
              {user?.role}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start"
            onClick={logout}
          >
            <LogOut className="size-4" />
            Keluar
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-2 border-b bg-background px-4 md:hidden">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Pill className="size-4" />
          </div>
          <span className="font-semibold">Apoteku</span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={logout}>
            Keluar
          </Button>
        </header>
        <nav className="flex gap-1 overflow-x-auto border-b bg-background px-2 py-2 md:hidden">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-muted-foreground"
              activeProps={{ className: "bg-primary/10 text-primary" }}
              activeOptions={{ exact: item.to === "/" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
