import { customType, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { brands, users, workspaces } from './schema';
const bytea = customType<{data: Buffer; driverData: Buffer}>({dataType: () => 'bytea', toDriver: value => value, fromDriver: value => value});
export const mediaAssets = pgTable('media_assets', {
  id: text('id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, {onDelete:'cascade'}),
  brandId: uuid('brand_id').references(() => brands.id, {onDelete:'set null'}),
  uploaderUserId: text('uploader_user_id').notNull().references(() => users.id, {onDelete:'cascade'}),
  mime: text('mime').notNull(), bytes: integer('bytes').notNull(),
  width: integer('width').notNull(), height: integer('height').notNull(),
  sha256: text('sha256').notNull(), data: bytea('data').notNull(),
  createdAt: timestamp('created_at',{withTimezone:true}).defaultNow().notNull(),
}, t => [index('media_assets_workspace_idx').on(t.workspaceId)]);
