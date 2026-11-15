-- Runs once, as the image superuser, when the data directory is empty.
-- The passwords are local development values and are used nowhere else.
CREATE ROLE app_owner LOGIN PASSWORD 'dev_only_owner'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE ROLE app_runtime LOGIN PASSWORD 'dev_only_runtime'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
-- The worker's two other roles. The dispatcher reads which event belongs to
-- which school; the queue role works only inside pg-boss's schema.
CREATE ROLE app_dispatcher LOGIN PASSWORD 'dev_only_dispatcher'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE ROLE app_queue LOGIN PASSWORD 'dev_only_queue'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I OWNER TO app_owner', current_database());
END
$$;
