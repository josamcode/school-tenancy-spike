import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { dataModel, TABLE_KINDS } from '../../db/data-model.js';
import { ownerPool, runtimePool } from '../support/db.js';

const repo = path.resolve(import.meta.dirname, '../..');
const file = path.join(repo, 'docs/data-model.md');
// Read before any test runs, because the comparison below can write the file.
const committed = existsSync(file);

describe('the data model document', () => {
  let pool: pg.Pool;
  let generated: string;

  // One table's section: from its heading to the next one.
  const section = (table: string) =>
    generated.split(/^### /m).find((part) => part.startsWith(`${table}\n`)) ??
    '';

  beforeAll(async () => {
    pool = runtimePool(1);
    generated = await dataModel(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  // `pnpm docs:data-model` runs this test with -u, which rewrites the file.
  it('is what the migrated database generates, byte for byte', async () => {
    await expect(generated).toMatchFileSnapshot(file);
    expect(
      committed,
      'docs/data-model.md did not exist. Run pnpm docs:data-model and commit it.',
    ).toBe(true);
  });

  it('is the same on a second run', async () => {
    expect(await dataModel(pool)).toBe(generated);
  });

  it('has a section and a kind for every table of the public schema, and for nothing else', async () => {
    const { rows } = await pool.query<{ name: string }>(
      `select c.relname::text as name
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p')
        order by 1`,
    );
    const tables = rows.map((row) => row.name);
    expect(tables.length).toBeGreaterThan(30);
    expect(Object.keys(TABLE_KINDS).sort()).toEqual(tables);
    expect(
      [...generated.matchAll(/^### (.+)$/gm)].map((m) => m[1]).sort(),
    ).toEqual(tables);
  });

  it('uses four kinds: core, module, global catalog and reference', () => {
    const kinds = new Set(Object.values(TABLE_KINDS));
    for (const kind of kinds) {
      expect(kind).toMatch(/^(core|module: [a-z]+|global catalog|reference)$/);
    }
    expect([...kinds].map((kind) => kind.split(':')[0]).sort()).toEqual(
      expect.arrayContaining(['core', 'global catalog', 'module', 'reference']),
    );
    expect(TABLE_KINDS.students).toBe('core');
    expect(TABLE_KINDS.outbox_events).toBe('core');
    expect(TABLE_KINDS.ledger_entries).toBe('module: finance');
    expect(TABLE_KINDS.admission_applications).toBe('module: admissions');
    expect(TABLE_KINDS.currencies).toBe('global catalog');
    expect(TABLE_KINDS.hijri_month_overrides).toBe('reference');
  });

  it('refuses a database that has a table with no kind', async () => {
    const owner = ownerPool();
    const client = await owner.connect();
    try {
      // Never committed, so no other test sees the table.
      await client.query('begin');
      await client.query('create table unclassified (id uuid primary key)');
      await expect(dataModel(client)).rejects.toThrow(
        'unclassified has no kind',
      );
    } finally {
      await client.query('rollback');
      client.release();
      await owner.end();
    }
  });

  it('gives a table its kind, its key and whether row-level security is forced', () => {
    expect(section('students')).toContain('core');
    expect(section('students')).toMatch(/Key[^\n]*`tenant_id`, `id`/);
    expect(section('students')).toMatch(/Row-level security[^\n]*forced/);
  });

  it('gives the roles that reach a table, down to the columns', () => {
    const outbox = section('outbox_events');
    expect(outbox).toMatch(/`app_runtime`[^\n]*SELECT/);
    expect(outbox).toMatch(/`app_runtime`[^\n]*INSERT \(`type`, `payload`\)/);
    expect(outbox).toMatch(
      /`app_dispatcher`[^\n]*SELECT \(`tenant_id`, `id`, `created_at`, `dispatched_at`\)/,
    );
    expect(outbox).toMatch(/`app_dispatcher`[^\n]*UPDATE \(`dispatched_at`\)/);
    // A catalog the application never reads.
    expect(section('modules')).toMatch(/`app_runtime`[^\n]*none/);
    expect(section('modules')).not.toContain('`app_dispatcher`');
  });

  it('gives each policy with its command, its roles and its expressions', () => {
    const students = section('students');
    expect(students).toContain('`tenant_isolation`');
    expect(students).toMatch(/`tenant_isolation`[^\n]*ALL/);
    expect(students).toMatch(/`tenant_isolation`[^\n]*app\.tenant_id/);
    expect(section('tenants')).toMatch(
      /`provisioning_insert`[^\n]*INSERT[^\n]*`app_owner`/,
    );
  });

  it('draws the foreign keys as Mermaid diagrams, with the school in the key', () => {
    const diagrams = [...generated.matchAll(/^```mermaid\n([\s\S]*?)^```$/gm)];
    expect(diagrams.length).toBeGreaterThan(1);
    for (const [, diagram] of diagrams) {
      expect(diagram.startsWith('erDiagram\n')).toBe(true);
    }
    expect(generated).toMatch(
      /^ +students \|\|--o\{ invoices : "tenant_id, student_id"$/m,
    );
  });

  it('says that it is generated and how', () => {
    expect(generated.split('\n').slice(0, 8).join('\n')).toContain(
      'pnpm docs:data-model',
    );
    const { scripts } = JSON.parse(
      readFileSync(path.join(repo, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    expect(scripts['docs:data-model']).toBe(
      'vitest run test/db/data-model.spec.ts -u',
    );
  });
});
