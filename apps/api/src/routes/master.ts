import { Hono } from "hono";
import type { UserRole } from "@apoteku/shared";
import {
  categoryInput,
  customerInput,
  doctorInput,
  manufacturerInput,
  supplierInput,
} from "@apoteku/shared";
import {
  categories,
  customers,
  doctors,
  manufacturers,
  suppliers,
} from "../db/schema";
import { crudRoutes } from "../lib/crud";

export const masterRoutes = new Hono();

/** Master data hanya boleh diubah owner/admin/apoteker. */
const MASTER_WRITE: UserRole[] = ["owner", "admin", "pharmacist"];
/** Data pelanggan boleh didaftarkan kasir saat melayani. */
const CUSTOMER_WRITE: UserRole[] = ["owner", "admin", "pharmacist", "cashier"];

masterRoutes.route(
  "/categories",
  crudRoutes({
    table: categories,
    createSchema: categoryInput,
    searchColumns: ["name"],
    writeRoles: MASTER_WRITE,
  }),
);

masterRoutes.route(
  "/manufacturers",
  crudRoutes({
    table: manufacturers,
    createSchema: manufacturerInput,
    searchColumns: ["name"],
    writeRoles: MASTER_WRITE,
  }),
);

masterRoutes.route(
  "/suppliers",
  crudRoutes({
    table: suppliers,
    createSchema: supplierInput,
    searchColumns: ["name", "phone", "email"],
    writeRoles: MASTER_WRITE,
  }),
);

masterRoutes.route(
  "/customers",
  crudRoutes({
    table: customers,
    createSchema: customerInput,
    searchColumns: ["name", "phone"],
    writeRoles: CUSTOMER_WRITE,
  }),
);

masterRoutes.route(
  "/doctors",
  crudRoutes({
    table: doctors,
    createSchema: doctorInput,
    searchColumns: ["name", "sipNumber"],
    writeRoles: MASTER_WRITE,
  }),
);
