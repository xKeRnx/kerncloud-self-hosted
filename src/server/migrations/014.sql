DO $$ BEGIN
IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=14) THEN
 CREATE TABLE billing_recipients(account_id text PRIMARY KEY REFERENCES accounts ON DELETE CASCADE,payload text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE invoice_counters(year integer PRIMARY KEY,next_number bigint NOT NULL CHECK(next_number>0));
 CREATE TABLE einvoices(
  id text PRIMARY KEY,account_id text REFERENCES accounts ON DELETE SET NULL,number text NOT NULL UNIQUE,
  source text NOT NULL CHECK(source IN('manual','stripe')),source_id text UNIQUE,
  kind text NOT NULL CHECK(kind IN('invoice','credit_note')),original_id text REFERENCES einvoices,
  fingerprint text NOT NULL,document text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','processing','issued','failed')),
  formats text,reports text,hashes jsonb,validators jsonb,error text NOT NULL DEFAULT '',
  currency text NOT NULL DEFAULT 'EUR',amount bigint NOT NULL,issue_date date NOT NULL,retain_until date NOT NULL,
  attempts integer NOT NULL DEFAULT 0,started_at timestamptz,issued_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
 );
 CREATE UNIQUE INDEX einvoice_single_reversal ON einvoices(original_id) WHERE original_id IS NOT NULL;
 CREATE INDEX einvoice_account ON einvoices(account_id,created_at DESC);
 CREATE INDEX einvoice_queue ON einvoices(status,created_at);
 CREATE TABLE stripe_einvoice_jobs(invoice_id text PRIMARY KEY REFERENCES invoices ON DELETE CASCADE,account_id text NOT NULL REFERENCES accounts ON DELETE CASCADE,payload text NOT NULL,status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','done','blocked')),error text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now());
 CREATE FUNCTION protect_einvoice() RETURNS trigger LANGUAGE plpgsql AS $f$
 BEGIN
  IF TG_OP='DELETE' THEN
   IF OLD.status='issued' THEN RAISE EXCEPTION 'Issued electronic invoices must be retained'; END IF;
   RETURN OLD;
  END IF;
  IF (NEW.number,NEW.document,NEW.source,NEW.source_id,NEW.kind,NEW.original_id,NEW.fingerprint,NEW.currency,NEW.amount,NEW.issue_date,NEW.retain_until) IS DISTINCT FROM (OLD.number,OLD.document,OLD.source,OLD.source_id,OLD.kind,OLD.original_id,OLD.fingerprint,OLD.currency,OLD.amount,OLD.issue_date,OLD.retain_until) THEN RAISE EXCEPTION 'Invoice snapshot is immutable'; END IF;
  IF NEW.account_id IS DISTINCT FROM OLD.account_id AND NEW.account_id IS NOT NULL THEN RAISE EXCEPTION 'Invoice ownership is immutable'; END IF;
  IF OLD.status='issued' AND (NEW.status,NEW.formats,NEW.reports,NEW.hashes,NEW.validators,NEW.issued_at) IS DISTINCT FROM (OLD.status,OLD.formats,OLD.reports,OLD.hashes,OLD.validators,OLD.issued_at) THEN RAISE EXCEPTION 'Issued invoice is immutable'; END IF;
  RETURN NEW;
 END $f$;
 CREATE TRIGGER einvoice_immutable BEFORE UPDATE OR DELETE ON einvoices FOR EACH ROW EXECUTE FUNCTION protect_einvoice();
 INSERT INTO schema_migrations(version) VALUES(14);
END IF;
END $$;
