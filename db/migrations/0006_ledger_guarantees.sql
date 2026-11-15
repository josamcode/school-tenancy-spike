-- Ledger guarantees, grants, row-level security and policies. Written by hand.
--
-- The triggers bind every role that writes rows, the owner included. The owner
-- owns the tables, so it can still disable or drop a trigger with DDL.

-- Catalog rows that must exist in every environment.
INSERT INTO currencies (code, minor_units) VALUES
  ('AED', 2), ('SAR', 2), ('QAR', 2),
  ('BHD', 3), ('KWD', 3), ('OMR', 3);
--> statement-breakpoint

-- A school's periods cannot overlap, so a date belongs to at most one period.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE ledger_periods ADD CONSTRAINT ledger_periods_no_overlap
  EXCLUDE USING gist (tenant_id WITH =, daterange(start_date, end_date, '[]') WITH &&);
--> statement-breakpoint

-- Base currency: set once, never changed, for every role.
CREATE FUNCTION finance_settings_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'the base currency cannot be changed';
END
$$;
--> statement-breakpoint
CREATE TRIGGER finance_settings_immutable BEFORE UPDATE OR DELETE ON finance_settings
  FOR EACH ROW EXECUTE FUNCTION finance_settings_immutable();
--> statement-breakpoint

-- Periods: inside their year; the only change allowed is open -> locked.
CREATE FUNCTION ledger_period_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM financial_years y
     WHERE y.tenant_id = NEW.tenant_id AND y.id = NEW.year_id
       AND NEW.start_date >= y.start_date AND NEW.end_date <= y.end_date
  ) THEN
    RAISE EXCEPTION 'period is outside its financial year';
  END IF;
  NEW.status := 'open';
  NEW.locked_at := NULL;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_period_before_insert BEFORE INSERT ON ledger_periods
  FOR EACH ROW EXECUTE FUNCTION ledger_period_before_insert();
--> statement-breakpoint
CREATE FUNCTION ledger_period_before_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.tenant_id, NEW.id, NEW.year_id, NEW.start_date, NEW.end_date)
     IS DISTINCT FROM (OLD.tenant_id, OLD.id, OLD.year_id, OLD.start_date, OLD.end_date) THEN
    RAISE EXCEPTION 'only the status of a period can change';
  END IF;
  IF OLD.status = 'locked' AND NEW.status <> 'locked' THEN
    RAISE EXCEPTION 'a locked period cannot be reopened';
  END IF;
  IF OLD.status = 'open' AND NEW.status = 'locked' THEN
    NEW.locked_at := now();
  ELSE
    NEW.locked_at := OLD.locked_at;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_period_before_update BEFORE UPDATE ON ledger_periods
  FOR EACH ROW EXECUTE FUNCTION ledger_period_before_update();
--> statement-breakpoint

-- Guarantee 3: nothing posts into a locked period.
-- The share lock makes a concurrent lock of the period wait for this
-- transaction, and makes this transaction wait for a lock that is in progress.
CREATE FUNCTION ledger_entry_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  period ledger_periods%ROWTYPE;
BEGIN
  SELECT * INTO period FROM ledger_periods p
   WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.period_id
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'period not found';
  END IF;
  IF period.status <> 'open' THEN
    RAISE EXCEPTION 'period is locked';
  END IF;
  IF NEW.entry_date < period.start_date OR NEW.entry_date > period.end_date THEN
    RAISE EXCEPTION 'entry date is outside its period';
  END IF;
  -- Set here, so a caller cannot supply them.
  NEW.posted_at := now();
  NEW.posted_txid := txid_current();
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_entry_before_insert BEFORE INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entry_before_insert();
--> statement-breakpoint

-- Lines: only in the transaction that posts their entry, with no more decimals
-- than the currency has, and with a student exactly when the account is a
-- control account.
CREATE FUNCTION ledger_line_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  minor smallint;
  control boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ledger_entries e
     WHERE e.tenant_id = NEW.tenant_id AND e.id = NEW.entry_id
       AND e.posted_txid = txid_current()
  ) THEN
    RAISE EXCEPTION 'lines can only be added in the transaction that posts their entry';
  END IF;

  SELECT c.minor_units INTO minor FROM currencies c WHERE c.code = NEW.currency;
  IF FOUND AND NEW.amount <> round(NEW.amount, minor) THEN
    RAISE EXCEPTION 'amount has more decimals than % allows', NEW.currency;
  END IF;

  SELECT a.is_control INTO control FROM ledger_accounts a
   WHERE a.tenant_id = NEW.tenant_id AND a.id = NEW.account_id;
  IF FOUND AND control AND NEW.student_id IS NULL THEN
    RAISE EXCEPTION 'a line on a control account needs a student';
  END IF;
  IF FOUND AND NOT control AND NEW.student_id IS NOT NULL THEN
    RAISE EXCEPTION 'only a control account line can have a student';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_line_before_insert BEFORE INSERT ON ledger_lines
  FOR EACH ROW EXECUTE FUNCTION ledger_line_before_insert();
--> statement-breakpoint

-- Guarantee 1: every entry balances, in each currency, when its transaction
-- commits. If the check can see fewer than two lines, it fails.
CREATE FUNCTION ledger_assert_balanced(p_tenant uuid, p_entry uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  line_count integer;
  unbalanced text;
BEGIN
  SELECT count(*) INTO line_count FROM ledger_lines l
   WHERE l.tenant_id = p_tenant AND l.entry_id = p_entry;
  IF line_count < 2 THEN
    RAISE EXCEPTION 'ledger entry needs at least two lines';
  END IF;

  SELECT l.currency INTO unbalanced FROM ledger_lines l
   WHERE l.tenant_id = p_tenant AND l.entry_id = p_entry
   GROUP BY l.currency
  HAVING sum(l.amount) <> 0
   LIMIT 1;
  IF unbalanced IS NOT NULL THEN
    RAISE EXCEPTION 'ledger entry does not balance in %', unbalanced;
  END IF;
END
$$;
--> statement-breakpoint
CREATE FUNCTION ledger_entry_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ledger_assert_balanced(NEW.tenant_id, NEW.id);
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE FUNCTION ledger_line_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ledger_assert_balanced(NEW.tenant_id, NEW.entry_id);
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_entry_balanced AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_entry_balanced();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_line_balanced AFTER INSERT ON ledger_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_line_balanced();
--> statement-breakpoint

-- Guarantee 2: posted entries and lines cannot be updated or deleted.
-- The runtime role also has no UPDATE, DELETE or TRUNCATE privilege.
CREATE FUNCTION ledger_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_append_only();
--> statement-breakpoint
CREATE TRIGGER ledger_entries_no_truncate BEFORE TRUNCATE ON ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_append_only();
--> statement-breakpoint
CREATE TRIGGER ledger_lines_append_only BEFORE UPDATE OR DELETE ON ledger_lines
  FOR EACH ROW EXECUTE FUNCTION ledger_append_only();
--> statement-breakpoint
CREATE TRIGGER ledger_lines_no_truncate BEFORE TRUNCATE ON ledger_lines
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_append_only();
--> statement-breakpoint

-- A posted invoice cannot be changed or deleted.
CREATE FUNCTION invoice_posted_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM ledger_entries e
     WHERE e.tenant_id = OLD.tenant_id AND e.invoice_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'a posted invoice cannot be changed';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER invoice_posted_immutable BEFORE UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoice_posted_immutable();
--> statement-breakpoint

-- Privileges. The runtime role never gets UPDATE or DELETE on entries or lines.
GRANT SELECT ON currencies, finance_settings TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON financial_years, ledger_periods, ledger_accounts, fx_rates,
  fx_positions, ledger_entries, ledger_lines TO app_runtime;
--> statement-breakpoint
-- Locking a period is the one update the runtime role may make.
GRANT UPDATE (status) ON ledger_periods TO app_runtime;
--> statement-breakpoint

ALTER TABLE currencies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE currencies FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE finance_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE finance_settings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE financial_years ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE financial_years FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ledger_periods ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ledger_periods FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ledger_accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ledger_accounts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE fx_rates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE fx_rates FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE fx_positions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE fx_positions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ledger_entries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ledger_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ledger_lines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Reference data, the same for every school.
CREATE POLICY reference_read ON currencies FOR SELECT USING (true);
--> statement-breakpoint
CREATE POLICY provisioning ON currencies TO app_owner USING (true) WITH CHECK (true);
--> statement-breakpoint

CREATE POLICY tenant_isolation ON finance_settings
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY tenant_isolation ON financial_years
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY tenant_isolation ON ledger_periods
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY tenant_isolation ON ledger_accounts
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY tenant_isolation ON fx_rates
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY tenant_isolation ON fx_positions
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY tenant_isolation ON ledger_entries
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY tenant_isolation ON ledger_lines
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
