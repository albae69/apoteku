import { Hono } from "hono";
import { auth } from "../middleware/auth";
import { auditRoutes } from "./audit";
import { authRoutes } from "./auth";
import { dashboardRoutes } from "./dashboard";
import { inventoryRoutes } from "./inventory";
import { masterRoutes } from "./master";
import { prescriptionRoutes } from "./prescriptions";
import { productRoutes } from "./products";
import { purchaseRoutes } from "./purchases";
import { saleRoutes } from "./sales";
import { settingsRoutes } from "./settings";
import { shiftRoutes } from "./shifts";

export function registerRoutes(app: Hono) {
  app.get("/health", (c) => c.json({ status: "ok", time: new Date().toISOString() }));

  const api = new Hono();
  api.route("/auth", authRoutes);

  // Semua route di bawah ini butuh autentikasi.
  api.use("*", auth);
  api.route("/products", productRoutes);
  api.route("/master", masterRoutes);
  api.route("/inventory", inventoryRoutes);
  api.route("/purchases", purchaseRoutes);
  api.route("/sales", saleRoutes);
  api.route("/shifts", shiftRoutes);
  api.route("/prescriptions", prescriptionRoutes);
  api.route("/settings", settingsRoutes);
  api.route("/dashboard", dashboardRoutes);
  api.route("/audit", auditRoutes);

  app.route("/api", api);
}
