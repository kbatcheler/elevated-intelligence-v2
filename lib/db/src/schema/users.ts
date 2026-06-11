import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { orgsTable } from "./orgs";

// One role model for the whole platform, designed once. Provider seats run
// Different Day, client seats are fenced to their own org.
export const userRoleEnum = pgEnum("user_role", [
  "provider-owner",
  "provider-member",
  "client-admin",
  "client-viewer",
]);

export const userStatusEnum = pgEnum("user_status", ["active", "disabled"]);

export const usersTable = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").unique().notNull(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: userRoleEnum("role").notNull().default("provider-member"),
  status: userStatusEnum("status").notNull().default("active"),
  // The org this user belongs to. Provider users belong to the provider org;
  // client users to their client or portfolio org. Nullable only for the
  // bootstrapped owner created before any org row exists.
  orgId: uuid("org_id").references(() => orgsTable.id, { onDelete: "set null" }),
  // The invite_pins.id this user consumed at registration. Null for the
  // bootstrapped owner. Kept as a plain reference value to avoid a circular
  // table dependency with invite_pins (which references users.created_by).
  invitePinId: uuid("invite_pin_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

export const insertUserSchema = createInsertSchema(usersTable, {
  email: z.string().email().max(320),
  displayName: z.string().min(1).max(200),
}).omit({ id: true, createdAt: true, lastLoginAt: true });

export type User = typeof usersTable.$inferSelect;
export type InsertUser = typeof usersTable.$inferInsert;
export type UserRole = User["role"];
export type UserStatus = User["status"];
