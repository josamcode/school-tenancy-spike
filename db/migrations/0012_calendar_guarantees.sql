-- Catalog rows, the invoice triggers, grants and row-level security for the
-- calendar tables. Written by hand.

INSERT INTO countries (code) VALUES ('AE'), ('BH'), ('KW'), ('OM'), ('QA'), ('SA');
--> statement-breakpoint

-- An invoice gets its number and its issue date here, whoever inserts it.
-- The number is the school's highest plus one, read under an advisory lock
-- that every insert in that school takes, so two inserts cannot read the same
-- highest number. It is an advisory lock because a school with no invoice has
-- no row to lock. The issue date is issued_at in the school's timezone. The
-- runtime role cannot name issued_at, so for it the instant is the clock.
CREATE FUNCTION invoices_issue() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  zone text;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.tenant_id::text || ':invoice_number', 0));
  SELECT coalesce(max(i.number), 0) + 1 INTO NEW.number
    FROM invoices i WHERE i.tenant_id = NEW.tenant_id;

  IF NEW.issued_at IS NULL THEN
    NEW.issued_at := clock_timestamp();
  END IF;
  SELECT t.timezone INTO zone FROM tenants t WHERE t.id = NEW.tenant_id;
  NEW.issue_date := (NEW.issued_at AT TIME ZONE zone)::date;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER invoices_issue BEFORE INSERT ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoices_issue();
--> statement-breakpoint

CREATE FUNCTION invoices_issue_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.number IS DISTINCT FROM OLD.number
     OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
     OR NEW.issue_date IS DISTINCT FROM OLD.issue_date THEN
    RAISE EXCEPTION 'an invoice''s number and issue date cannot be changed';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER invoices_issue_immutable BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoices_issue_immutable();
--> statement-breakpoint

-- The runtime role names only what a writer decides. It cannot insert number,
-- issued_at or issue_date, so the application cannot back-date an invoice.
-- The owner still can supply issued_at, for an import of existing invoices.
REVOKE INSERT ON invoices FROM app_runtime;
--> statement-breakpoint
GRANT INSERT (tenant_id, id, student_id, amount, currency, description, due_date)
  ON invoices TO app_runtime;
--> statement-breakpoint

GRANT SELECT ON countries, hijri_month_overrides TO app_runtime;
--> statement-breakpoint

ALTER TABLE countries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE countries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE hijri_month_overrides ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE hijri_month_overrides FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Reference data, the same for every school. Only the owner writes it.
CREATE POLICY reference_read ON countries FOR SELECT USING (true);
--> statement-breakpoint
CREATE POLICY provisioning ON countries TO app_owner USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY reference_read ON hijri_month_overrides FOR SELECT USING (true);
--> statement-breakpoint
CREATE POLICY provisioning ON hijri_month_overrides TO app_owner USING (true) WITH CHECK (true);
