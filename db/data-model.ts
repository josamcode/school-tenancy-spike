import pg from 'pg';

export type TableKind =
  'core' | `module: ${string}` | 'global catalog' | 'reference';

// The one thing the catalog cannot say. Every table of the public schema is
// listed here, and the generator refuses a table that is not.
export const TABLE_KINDS: Record<string, TableKind> = {
  tenants: 'core',
  users: 'core',
  memberships: 'core',
  grants: 'core',
  groups: 'core',
  group_schools: 'core',
  group_admins: 'core',
  tenant_modules: 'core',
  students: 'core',
  outbox_events: 'core',
  processed_events: 'core',
  event_failures: 'core',
  webhook_endpoints: 'core',
  webhook_deliveries: 'core',
  webhook_attempts: 'core',

  invoices: 'module: finance',
  finance_settings: 'module: finance',
  financial_years: 'module: finance',
  ledger_periods: 'module: finance',
  ledger_accounts: 'module: finance',
  fx_rates: 'module: finance',
  fx_positions: 'module: finance',
  ledger_entries: 'module: finance',
  ledger_lines: 'module: finance',
  registration_fees: 'module: finance',

  admission_applications: 'module: admissions',

  modules: 'global catalog',
  permissions: 'global catalog',
  roles: 'global catalog',
  currencies: 'global catalog',
  countries: 'global catalog',

  role_permissions: 'reference',
  hijri_month_overrides: 'reference',
};

const KIND_ORDER = ['core', 'module', 'global catalog', 'reference'];

const KINDS_EXPLAINED = [
  '- **core**: always on. A school cannot switch it off, and modules may refer to it.',
  '- **module**: belongs to a module that is on or off for each school. A module refers to core tables and never to another module.',
  '- **global catalog**: a fixed list, the same for every school, that code and foreign keys refer to. Its rows come from migrations.',
  '- **reference**: data that is the same for every school and that only the owner role maintains.',
];

// The roles that are not the owner. The owner is described once, in the text.
const ROLES = ['app_runtime', 'app_dispatcher', 'app_queue'];
const PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'];

type Db = Pick<pg.ClientBase, 'query'>;

interface Table {
  oid: number;
  name: string;
  enabled: boolean;
  forced: boolean;
}

interface ForeignKey {
  table: string;
  references: string;
  columns: string[];
  ref_columns: string[];
}

interface Privilege {
  role: string;
  table: string;
  privilege: string;
  whole: boolean;
  columns: string[] | null;
}

interface Policy {
  table: string;
  name: string;
  command: string;
  roles: string[];
  using: string | null;
  check: string | null;
}

const code = (value: string) => `\`${value}\``;
const names = (values: string[]) => values.map(code).join(', ');
const groupOf = (kind: TableKind) => kind.split(':')[0];
const title = (kind: string) =>
  kind.startsWith('module: ')
    ? `Module: ${kind.slice('module: '.length)}`
    : kind === 'core'
      ? 'Core'
      : kind === 'global catalog'
        ? 'Global catalogs'
        : 'Reference data';

// The whole document, from the catalog of a migrated database.
export async function dataModel(db: Db): Promise<string> {
  const tables = (
    await db.query<Table>(
      `select c.oid::int as oid, c.relname::text as name,
              c.relrowsecurity as enabled, c.relforcerowsecurity as forced
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p')
        order by c.relname`,
    )
  ).rows;
  for (const { name } of tables) {
    if (!Object.hasOwn(TABLE_KINDS, name)) {
      throw new Error(`${name} has no kind in db/data-model.ts`);
    }
  }
  for (const name of Object.keys(TABLE_KINDS)) {
    if (!tables.some((table) => table.name === name)) {
      throw new Error(`${name} has a kind in db/data-model.ts but is no table`);
    }
  }
  const oids = tables.map((table) => table.oid);

  const keys = new Map(
    (
      await db.query<{ table: string; columns: string[] }>(
        `select c.relname::text as table,
                array_agg(a.attname::text
                          order by array_position(x.indkey::int2[], a.attnum)) as columns
           from pg_index x
           join pg_class c on c.oid = x.indrelid
           join pg_attribute a on a.attrelid = x.indrelid and a.attnum = any (x.indkey)
          where x.indisprimary and x.indrelid = any ($1::oid[])
          group by c.relname`,
        [oids],
      )
    ).rows.map((row) => [row.table, row.columns]),
  );

  const foreignKeys = (
    await db.query<ForeignKey>(
      `select c.relname::text as table, f.relname::text as references,
              (select array_agg(a.attname::text order by k.ord)
                 from unnest(con.conkey) with ordinality k(attnum, ord)
                 join pg_attribute a
                   on a.attrelid = con.conrelid and a.attnum = k.attnum) as columns,
              (select array_agg(a.attname::text order by k.ord)
                 from unnest(con.confkey) with ordinality k(attnum, ord)
                 join pg_attribute a
                   on a.attrelid = con.confrelid and a.attnum = k.attnum) as ref_columns
         from pg_constraint con
         join pg_class c on c.oid = con.conrelid
         join pg_class f on f.oid = con.confrelid
        where con.contype = 'f' and con.conrelid = any ($1::oid[])
        order by c.relname, f.relname, con.conname`,
      [oids],
    )
  ).rows;

  const privileges = (
    await db.query<Privilege>(
      `select r.role, c.relname::text as table, p.privilege,
              has_table_privilege(r.role, c.oid, p.privilege) as whole,
              (select array_agg(a.attname::text order by a.attnum)
                 from pg_attribute a
                where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                  and p.privilege in ('SELECT', 'INSERT', 'UPDATE')
                  and has_column_privilege(r.role, c.oid, a.attnum, p.privilege)) as columns
         from unnest($1::text[]) with ordinality r(role, role_no)
        cross join unnest($2::text[]) with ordinality p(privilege, privilege_no)
        cross join pg_class c
        where c.oid = any ($3::oid[])
        order by c.relname, r.role_no, p.privilege_no`,
      [ROLES, PRIVILEGES, oids],
    )
  ).rows;

  const policies = (
    await db.query<Policy>(
      `select tablename::text as table, policyname::text as name, cmd as command,
              roles::text[] as roles, qual as using, with_check as check
         from pg_policies
        where schemaname = 'public'
        order by tablename, policyname`,
    )
  ).rows;

  const held = (role: string, table: string) =>
    privileges
      .filter((p) => p.role === role && p.table === table)
      .flatMap((p) =>
        p.whole
          ? [p.privilege]
          : p.columns
            ? [`${p.privilege} (${names(p.columns)})`]
            : [],
      );

  const section = (table: Table): string[] => {
    const lines = [
      `### ${table.name}`,
      '',
      `- **Kind:** ${TABLE_KINDS[table.name]}`,
      `- **Key:** ${names(keys.get(table.name) ?? [])}`,
    ];
    const references = foreignKeys.filter((fk) => fk.table === table.name);
    if (references.length > 0) {
      lines.push(
        `- **References:** ${references
          .map((fk) => `${code(fk.references)} by ${names(fk.columns)}`)
          .join('; ')}`,
      );
    }
    lines.push(
      `- **Row-level security:** ${
        table.enabled && table.forced
          ? 'enabled and forced'
          : table.enabled
            ? 'enabled, not forced'
            : 'not enabled'
      }`,
      '- **Roles:**',
    );
    for (const role of ROLES) {
      const may = held(role, table.name);
      // The runtime role is always shown, so "none" is said out loud.
      if (may.length === 0 && role !== 'app_runtime') continue;
      lines.push(
        `  - ${code(role)}: ${may.length > 0 ? may.join(', ') : 'none'}`,
      );
    }
    lines.push('- **Policies:**');
    for (const policy of policies.filter((p) => p.table === table.name)) {
      const who =
        policy.roles.length === 1 && policy.roles[0] === 'public'
          ? 'all roles'
          : names(policy.roles);
      const parts = [`${code(policy.name)}: ${policy.command}, ${who}`];
      if (policy.using) parts.push(`USING ${code(policy.using)}`);
      if (policy.check) parts.push(`WITH CHECK ${code(policy.check)}`);
      lines.push(`  - ${parts.join('. ')}`);
    }
    return [...lines, ''];
  };

  // One line per foreign key, from the table it points to. A key that is the
  // whole primary key of its table can match one row at most.
  const diagram = (group: Table[]): string[] => {
    const inGroup = new Set(group.map((table) => table.name));
    const lines = ['```mermaid', 'erDiagram'];
    const drawn = new Set<string>();
    for (const fk of foreignKeys.filter((key) => inGroup.has(key.table))) {
      const key = keys.get(fk.table) ?? [];
      const one =
        key.length === fk.columns.length &&
        key.every((column) => fk.columns.includes(column));
      lines.push(
        `    ${fk.references} ||--o${one ? '|' : '{'} ${fk.table} : "${fk.columns.join(', ')}"`,
      );
      drawn.add(fk.table).add(fk.references);
    }
    for (const { name } of group) {
      if (!drawn.has(name)) lines.push(`    ${name}`);
    }
    return [...lines, '```', ''];
  };

  const kinds = [...new Set(Object.values(TABLE_KINDS))].sort(
    (a, b) =>
      KIND_ORDER.indexOf(groupOf(a)) - KIND_ORDER.indexOf(groupOf(b)) ||
      a.localeCompare(b),
  );

  const lines = [
    '# Data model',
    '',
    '<!-- Generated. Do not edit: run `pnpm docs:data-model`. -->',
    '',
    'This document is generated by `pnpm docs:data-model` from the catalog of a',
    'PostgreSQL 16 database after every migration in `db/migrations` has run.',
    '`test/db/data-model.spec.ts` generates it again and fails when this file differs.',
    '',
    '## How to read it',
    '',
    'Each table has a kind:',
    '',
    ...KINDS_EXPLAINED,
    '',
    'Each table also has:',
    '',
    '- **Key:** the primary key. A table that belongs to a school has `tenant_id` first in it.',
    '- **References:** its foreign keys. Between two tables of a school, the key includes `tenant_id`.',
    '- **Roles:** what each role other than the owner may do, down to the columns where the grant is by column. A role that is not listed holds nothing on the table.',
    '- **Policies:** each row-level security policy with its command, the roles it applies to and its expressions.',
    '',
    'The roles:',
    '',
    '- `app_owner` owns every table and runs the migrations and the provisioning. Row-level security is forced, so the policies bind it too.',
    "- `app_runtime` is the application and the worker's handlers.",
    '- `app_dispatcher` reads which event belongs to which school, and nothing else.',
    '- `app_queue` runs the job queue in its own schema, `pgboss`. The queue library creates those tables when a worker starts, so they are not in the migrations and not in this document.',
    '',
    'In the diagrams a line runs from the table that is referenced to the table',
    'that refers to it, and its label is the referring columns.',
    '',
    '## Tables by kind',
    '',
    ...kinds.map(
      (kind) =>
        `- **${kind}:** ${names(
          tables
            .filter((table) => TABLE_KINDS[table.name] === kind)
            .map((table) => table.name),
        )}`,
    ),
    '',
  ];
  for (const kind of kinds) {
    const group = tables.filter((table) => TABLE_KINDS[table.name] === kind);
    lines.push(`## ${title(kind)}`, '', ...diagram(group));
    for (const table of group) lines.push(...section(table));
  }
  return lines.join('\n');
}
