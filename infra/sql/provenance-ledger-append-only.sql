-- Provenance ledger: database-layer append-only hardening (Phase K and M).
--
-- The provenance ledger is append-only by contract: the application module
-- exposes only appendEntry and verifyChain, links every entry to its predecessor
-- by content hash, and never updates or trims a row, so any edit breaks
-- verifyChain. This script adds the SECOND line of defence the schema comment and
-- the drift rollup call for: it removes UPDATE and DELETE on provenance_ledger
-- from the RUNTIME database role, so even a defect or a compromised app process
-- cannot mutate or trim the chain. INSERT and SELECT remain, so appending and
-- reading and chain verification are unaffected.
--
-- WHY a role grant and not a blanket block trigger: tenant deletion cascades
-- through the tenant_id foreign key (ON DELETE CASCADE), so a tenant lifecycle
-- delete legitimately removes that tenant's ledger rows. That delete is a
-- privileged, deliberate operation run by an operator or a migration role, never
-- by the request-serving runtime. Revoking DELETE from the RUNTIME role alone is
-- surgical: it closes the runtime mutation path while leaving the privileged
-- cascade intact. A blanket BEFORE DELETE trigger would also break the legitimate
-- cascade, so it is the wrong tool here. The application code confirms the
-- boundary: no runtime path updates or deletes provenance_ledger; the only
-- deletes are the cascade and test cleanup, both under a privileged role.
--
-- WHEN to run: at deploy time, ONCE per environment, as a PRIVILEGED role (the
-- database owner or a superuser), NOT as the runtime role. It is idempotent:
-- REVOKE and GRANT can be re-applied safely.
--
-- This is NOT demonstrable on a single-role development database, where the one
-- DATABASE_URL connects as the owner and therefore always retains every
-- privilege. It is a production hardening that requires a distinct, least-
-- privilege runtime role, which is the correct production posture regardless.
--
-- HOW to run (replace the role name with your runtime role):
--
--   psql "$ADMIN_DATABASE_URL" \
--     -v app_role=elevated_runtime \
--     -f infra/sql/provenance-ledger-append-only.sql
--
-- ADMIN_DATABASE_URL must connect as a privileged role; app_role is the least-
-- privilege role your application's DATABASE_URL connects as.

\set ON_ERROR_STOP on

-- 1. The runtime role may read and append, never mutate or trim the chain.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE provenance_ledger FROM :"app_role";
GRANT SELECT, INSERT ON TABLE provenance_ledger TO :"app_role";

-- 2. Verify, and FAIL LOUDLY if the hardening is not fully in place. The gate
-- uses has_table_privilege, which answers the EFFECTIVE question (can this role
-- mutate the ledger through ANY path: a direct grant, a role it inherits, or a
-- grant to PUBLIC), not just the direct grants that information_schema reports.
-- A direct-grant-only check could falsely pass while the role still holds UPDATE
-- or DELETE by inheritance. With ON_ERROR_STOP on, any RAISE EXCEPTION here
-- aborts the script, so a partial hardening can never look complete.
--
-- The role name is carried into a session setting first because psql does not
-- interpolate :'app_role' inside a dollar-quoted body; the DO block reads it back
-- with current_setting at runtime.
SELECT set_config('provenance.app_role', :'app_role', false) AS app_role;

DO $$
DECLARE
  r text := current_setting('provenance.app_role');
BEGIN
  IF has_table_privilege(r, 'provenance_ledger', 'UPDATE')
     OR has_table_privilege(r, 'provenance_ledger', 'DELETE')
     OR has_table_privilege(r, 'provenance_ledger', 'TRUNCATE') THEN
    RAISE EXCEPTION
      'provenance_ledger hardening FAILED: role % can still mutate the ledger (UPDATE, DELETE, or TRUNCATE is held through a direct, inherited, group, or PUBLIC grant)', r;
  END IF;
  IF NOT (has_table_privilege(r, 'provenance_ledger', 'SELECT')
          AND has_table_privilege(r, 'provenance_ledger', 'INSERT')) THEN
    RAISE EXCEPTION
      'provenance_ledger hardening FAILED: role % is missing SELECT or INSERT, so appending and chain verification would break', r;
  END IF;
  RAISE NOTICE 'provenance_ledger hardening verified: role % has SELECT and INSERT only, with no UPDATE, DELETE, or TRUNCATE through any path', r;
END $$;

-- 3. For a human-readable record, also print the direct grants. This is
-- informational only; the DO block above is the authoritative gate.
SELECT privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'provenance_ledger'
  AND grantee = :'app_role'
ORDER BY privilege_type;
