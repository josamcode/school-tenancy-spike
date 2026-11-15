import { sql, SQL } from 'drizzle-orm';
import { AnyPgColumn } from 'drizzle-orm/pg-core';

// Translated content is kept on its row, keyed by language.
export interface I18nText {
  ar?: string;
  en?: string;
}

const isText = (column: AnyPgColumn, language: string): SQL =>
  sql`(${column} -> ${sql.raw(`'${language}'`)} is null
       or (jsonb_typeof(${column} -> ${sql.raw(`'${language}'`)}) = 'string'
           and btrim(${column} ->> ${sql.raw(`'${language}'`)}) <> ''))`;

// A check constraint: null, or an object with ar, en or both, each a
// non-empty string, and no other key.
export const isI18nText = (column: AnyPgColumn): SQL =>
  sql`${column} is null or case
        when jsonb_typeof(${column}) <> 'object' then false
        else ${column} <> '{}'::jsonb
         and ${column} - 'ar' - 'en' = '{}'::jsonb
         and ${isText(column, 'ar')}
         and ${isText(column, 'en')}
      end`;
