export const USER_ROLES = ["owner", "admin", "pharmacist", "cashier"] as const;
export type UserRole = (typeof USER_ROLES)[number];
