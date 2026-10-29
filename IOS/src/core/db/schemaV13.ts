import { TABLES as V12_TABLES, type TableDef } from './schemaV12';
export { BACKUP_TABLES, createIndexSql, createTableSql } from './schemaV12';

/** Current Android 13.json: v12 data columns are unchanged; transfer journals
 * and the chapter lookup index are additive, preserving installed libraries. */
export const ROOM_SCHEMA_VERSION = 13;
export const ROOM_IDENTITY_HASH = '81c9b5e4e48d5daa5996f4837eafd2d4';
export const TRANSFER_JOURNAL_TABLES: TableDef[] = [
  {
    name: 'transfer_identities',
    columns: [{ name: 'localKey', type: 'TEXT', notNull: true, primaryKey: true }, { name: 'stableId', type: 'TEXT', notNull: true }],
    primaryKey: ['localKey'], autoGeneratePk: false, indices: [],
  },
  {
    name: 'transfer_receipts',
    columns: [{ name: 'packageId', type: 'TEXT', notNull: true, primaryKey: true }, { name: 'importedAt', type: 'INTEGER', notNull: true }],
    primaryKey: ['packageId'], autoGeneratePk: false, indices: [],
  },
];
export const TABLES: TableDef[] = [
  ...V12_TABLES.map((table) => table.name === 'chapters' ? {
    ...table, indices: [...table.indices, { name: 'index_chapters_bookId_chapterOrder', unique: false, columns: ['bookId', 'chapterOrder'] }],
  } : table),
  ...TRANSFER_JOURNAL_TABLES,
];
