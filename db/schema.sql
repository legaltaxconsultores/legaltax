-- LegalTax · esquema de base de datos (PostgreSQL 14+)
-- Ejecutar como el propietario de la base (rol NO superusuario, para que RLS aplique).
SET client_min_messages = warning;

-- ───────── Contexto de seguridad por petición ─────────
-- El servidor fija app.role / app.client_id / app.user_id en cada transacción.
CREATE OR REPLACE FUNCTION app_role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT coalesce(current_setting('app.role', true), '') $$;
CREATE OR REPLACE FUNCTION app_staff() RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT app_role() IN ('admin','expedientes','cobros','system') $$;
CREATE OR REPLACE FUNCTION app_client() RETURNS integer LANGUAGE sql STABLE AS
$$ SELECT CASE WHEN app_role() = 'cliente' THEN nullif(current_setting('app.client_id', true), '')::int END $$;

-- ───────── Usuarios y configuración ─────────
CREATE TABLE IF NOT EXISTS clients (
  id              serial PRIMARY KEY,
  kind            text NOT NULL CHECK (kind IN ('persona','empresa')),
  name            text NOT NULL,
  trade_name      text,
  id_type         text NOT NULL CHECK (id_type IN ('cedula','rnc','pasaporte')),
  id_number       text NOT NULL,
  id_digits       text GENERATED ALWAYS AS (regexp_replace(id_number, '[^0-9A-Za-z]', '', 'g')) STORED,
  representative  text,
  representative_id text,
  email           text,
  phone           text,
  address         text,
  responsible_user_id integer,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id_type, id_number)
);

CREATE TABLE IF NOT EXISTS users (
  id            serial PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  role          text NOT NULL CHECK (role IN ('admin','expedientes','cobros','cliente')),
  client_id     integer REFERENCES clients(id),
  password_hash text,
  active        boolean NOT NULL DEFAULT true,
  invite_token  text UNIQUE,
  invite_expires timestamptz,
  last_login    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((role = 'cliente') = (client_id IS NOT NULL))
);
DO $$ BEGIN
  ALTER TABLE clients ADD CONSTRAINT clients_resp_fk FOREIGN KEY (responsible_user_id) REFERENCES users(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS settings (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS doc_sequences (
  doc_type    text PRIMARY KEY,
  label       text NOT NULL,
  prefix      text NOT NULL,
  next_number integer NOT NULL DEFAULT 1,
  padding     integer NOT NULL DEFAULT 4,
  yearly      boolean NOT NULL DEFAULT true,
  year        integer
);

CREATE TABLE IF NOT EXISTS templates (
  doc_type   text PRIMARY KEY,
  title      text NOT NULL,
  intro      text NOT NULL DEFAULT '',
  closing    text NOT NULL DEFAULT '',
  terms      text NOT NULL DEFAULT '',
  updated_by integer REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ───────── Expedientes ─────────
CREATE TABLE IF NOT EXISTS cases (
  id               serial PRIMARY KEY,
  code             text NOT NULL UNIQUE,
  client_id        integer NOT NULL REFERENCES clients(id),
  title            text NOT NULL,
  matter           text,
  institution      text,
  official_number  text,
  fiscal_periods   text,
  status           text NOT NULL DEFAULT 'abierto' CHECK (status IN ('abierto','en_tramite','en_espera','cerrado','archivado')),
  public_status    text,
  responsible_user_id integer REFERENCES users(id),
  next_action      text,
  next_action_date date,
  opened_on        date NOT NULL DEFAULT current_date,
  closed_on        date,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cases_client_idx ON cases(client_id);

CREATE TABLE IF NOT EXISTS case_events (
  id          serial PRIMARY KEY,
  case_id     integer NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  client_id   integer NOT NULL REFERENCES clients(id),
  kind        text NOT NULL CHECK (kind IN ('actuacion','deposito','notificacion','decision','documento','reunion','nota')),
  title       text NOT NULL,
  description text,
  event_date  date NOT NULL DEFAULT current_date,
  visibility  text NOT NULL DEFAULT 'interna' CHECK (visibility IN ('interna','cliente')),
  document_id integer,
  created_by  integer REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS case_events_case_idx ON case_events(case_id);

CREATE TABLE IF NOT EXISTS deadlines (
  id          serial PRIMARY KEY,
  case_id     integer REFERENCES cases(id) ON DELETE CASCADE,
  client_id   integer REFERENCES clients(id),
  kind        text NOT NULL CHECK (kind IN ('audiencia','reunion','plazo','tarea')),
  title       text NOT NULL,
  description text,
  due_at      timestamptz NOT NULL,
  confirmed   boolean NOT NULL DEFAULT false,
  confirmed_by integer REFERENCES users(id),
  responsible_user_id integer REFERENCES users(id),
  alert_days  integer NOT NULL DEFAULT 3,
  status      text NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','completada','cancelada')),
  completed_at timestamptz,
  created_by  integer REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ───────── Archivos ─────────
CREATE TABLE IF NOT EXISTS documents (
  id                serial PRIMARY KEY,
  client_id         integer NOT NULL REFERENCES clients(id),
  case_id           integer REFERENCES cases(id),
  deadline_id       integer REFERENCES deadlines(id),
  request_id        integer,
  category          text NOT NULL DEFAULT 'otro' CHECK (category IN ('resolucion','acuse','constancia_deposito','notificacion','voucher','contrato','identificacion','estado_financiero','declaracion','correspondencia','otro')),
  title             text NOT NULL,
  resolution_number text,
  institution       text,
  doc_date          date,
  storage_key       text NOT NULL,
  filename          text NOT NULL,
  mime              text NOT NULL,
  size_bytes        integer NOT NULL,
  visibility        text NOT NULL DEFAULT 'privado' CHECK (visibility IN ('privado','cliente')),
  uploaded_by       integer REFERENCES users(id),
  uploaded_by_client boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS documents_client_idx ON documents(client_id);
CREATE INDEX IF NOT EXISTS documents_resnum_idx ON documents(lower(resolution_number));

-- ───────── Cotizaciones, cuotas y pagos ─────────
CREATE TABLE IF NOT EXISTS quotes (
  id            serial PRIMARY KEY,
  number        text NOT NULL UNIQUE,
  client_id     integer NOT NULL REFERENCES clients(id),
  case_id       integer REFERENCES cases(id),
  title         text NOT NULL,
  scope         text NOT NULL DEFAULT '',
  discount      numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  itbis_applies boolean NOT NULL DEFAULT true,
  itbis_rate    numeric(5,2) NOT NULL DEFAULT 18,
  fees_total    numeric(14,2) NOT NULL DEFAULT 0,
  expenses_total numeric(14,2) NOT NULL DEFAULT 0,
  subtotal      numeric(14,2) NOT NULL DEFAULT 0,
  itbis         numeric(14,2) NOT NULL DEFAULT 0,
  total         numeric(14,2) NOT NULL DEFAULT 0,
  valid_until   date,
  status        text NOT NULL DEFAULT 'borrador' CHECK (status IN ('borrador','publicada','aceptada','rechazada','anulada')),
  published_at  timestamptz,
  accepted_at   timestamptz,
  accepted_by   integer REFERENCES users(id),
  accepted_note text,
  created_by    integer REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quote_items (
  id          serial PRIMARY KEY,
  quote_id    integer NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  client_id   integer NOT NULL REFERENCES clients(id),
  kind        text NOT NULL CHECK (kind IN ('honorario','gasto')),
  description text NOT NULL,
  amount      numeric(14,2) NOT NULL CHECK (amount >= 0),
  position    integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS installments (
  id        serial PRIMARY KEY,
  quote_id  integer NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  client_id integer NOT NULL REFERENCES clients(id),
  seq       integer NOT NULL,
  due_date  date NOT NULL,
  amount    numeric(14,2) NOT NULL CHECK (amount > 0),
  UNIQUE (quote_id, seq)
);

CREATE TABLE IF NOT EXISTS payments (
  id               serial PRIMARY KEY,
  client_id        integer NOT NULL REFERENCES clients(id),
  quote_id         integer NOT NULL REFERENCES quotes(id),
  amount_declared  numeric(14,2) NOT NULL CHECK (amount_declared > 0),
  amount_validated numeric(14,2),
  method           text NOT NULL CHECK (method IN ('transferencia','deposito','efectivo','cheque','tarjeta')),
  bank             text,
  reference        text,
  paid_on          date NOT NULL,
  voucher_document_id integer REFERENCES documents(id),
  status           text NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','validado','rechazado','anulado')),
  reject_reason    text,
  submitted_by     integer REFERENCES users(id),
  validated_by     integer REFERENCES users(id),
  validated_at     timestamptz,
  void_reason      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'validado' OR amount_validated > 0),
  CHECK (status <> 'rechazado' OR coalesce(reject_reason,'') <> '')
);

-- ───────── Solicitudes de documentos ─────────
CREATE TABLE IF NOT EXISTS doc_requests (
  id          serial PRIMARY KEY,
  client_id   integer NOT NULL REFERENCES clients(id),
  case_id     integer REFERENCES cases(id),
  title       text NOT NULL,
  description text,
  due_date    date,
  status      text NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','recibida','devuelta')),
  staff_note  text,
  client_note text,
  created_by  integer REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ───────── Documentos PDF generados (copias emitidas inmutables) ─────────
CREATE TABLE IF NOT EXISTS generated_docs (
  id           serial PRIMARY KEY,
  doc_type     text NOT NULL,
  number       text NOT NULL,
  version      integer NOT NULL DEFAULT 1,
  parent_id    integer REFERENCES generated_docs(id),
  client_id    integer NOT NULL REFERENCES clients(id),
  case_id      integer REFERENCES cases(id),
  quote_id     integer REFERENCES quotes(id),
  payment_id   integer REFERENCES payments(id),
  title        text NOT NULL,
  data         jsonb NOT NULL,          -- copia de los datos tal como se emitieron
  storage_key  text NOT NULL,
  void_storage_key text,
  status       text NOT NULL DEFAULT 'vigente' CHECK (status IN ('vigente','reemplazado','anulado')),
  void_reason  text,
  voided_by    integer REFERENCES users(id),
  voided_at    timestamptz,
  shared       boolean NOT NULL DEFAULT false,
  created_by   integer REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (doc_type, number, version)
);
-- Un pago validado solo puede tener un recibo original (evita doble registro)
CREATE UNIQUE INDEX IF NOT EXISTS one_receipt_per_payment ON generated_docs(payment_id) WHERE doc_type = 'recibo_dinero' AND version = 1;

-- ───────── Consultas guardadas y auditoría ─────────
CREATE TABLE IF NOT EXISTS saved_queries (
  id         serial PRIMARY KEY,
  user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  entity     text NOT NULL,
  params     jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         bigserial PRIMARY KEY,
  user_id    integer,
  user_name  text,
  role       text,
  action     text NOT NULL,
  entity     text NOT NULL,
  entity_id  text,
  client_id  integer,
  details    jsonb,
  ip         text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_log (
  id          bigserial PRIMARY KEY,
  kind        text NOT NULL,
  ref         text,
  client_id   integer,
  to_addr     text NOT NULL,
  cc_addr     text,
  subject     text NOT NULL,
  attachments jsonb,
  status      text NOT NULL CHECK (status IN ('enviado','error','no_enviado')),
  error       text,
  sent_by     integer,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ───────── Facturas y avisos ─────────
ALTER TABLE doc_sequences ADD COLUMN IF NOT EXISTS sep text NOT NULL DEFAULT '-';
ALTER TABLE doc_sequences ADD COLUMN IF NOT EXISTS max_number integer;
ALTER TABLE doc_sequences ADD COLUMN IF NOT EXISTS valid_until date;

CREATE TABLE IF NOT EXISTS invoices (
  id             serial PRIMARY KEY,
  number         text NOT NULL UNIQUE,
  client_id      integer NOT NULL REFERENCES clients(id),
  quote_id       integer NOT NULL REFERENCES quotes(id),
  installment_id integer REFERENCES installments(id),
  case_id        integer REFERENCES cases(id),
  description    text NOT NULL,
  issue_date     date NOT NULL DEFAULT current_date,
  due_date       date NOT NULL,
  subtotal       numeric(14,2) NOT NULL,
  itbis          numeric(14,2) NOT NULL,
  expenses       numeric(14,2) NOT NULL DEFAULT 0,
  total          numeric(14,2) NOT NULL CHECK (total > 0),
  status         text NOT NULL DEFAULT 'emitida' CHECK (status IN ('emitida','anulada')),
  void_reason    text,
  gendoc_id      integer REFERENCES generated_docs(id),
  created_by     integer REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
-- una cuota no se factura dos veces (salvo que la factura anterior se anule)
CREATE UNIQUE INDEX IF NOT EXISTS one_invoice_per_installment ON invoices(installment_id) WHERE status = 'emitida' AND installment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS one_full_invoice_per_quote ON invoices(quote_id) WHERE status = 'emitida' AND installment_id IS NULL;

CREATE TABLE IF NOT EXISTS notices (
  id             bigserial PRIMARY KEY,
  client_id      integer NOT NULL REFERENCES clients(id),
  channel        text NOT NULL CHECK (channel IN ('email','whatsapp')),
  kind           text NOT NULL,
  ref            text,
  installment_id integer,
  to_addr        text,
  message        text,
  automatic      boolean NOT NULL DEFAULT false,
  sent_by        integer,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notices_inst_idx ON notices(installment_id, kind);

-- ───────── Tipos de documento (documentos escaneados por expediente) ─────────
CREATE TABLE IF NOT EXISTS doc_types (
  id       serial PRIMARY KEY,
  name     text NOT NULL UNIQUE,
  category text NOT NULL DEFAULT 'otro',
  position integer NOT NULL DEFAULT 0,
  active   boolean NOT NULL DEFAULT true
);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS doc_type_id integer REFERENCES doc_types(id);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS scanned boolean NOT NULL DEFAULT false;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS pages integer;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS notes text;
CREATE INDEX IF NOT EXISTS documents_case_idx ON documents(case_id);

-- ───────── Acceso desde la app móvil (tokens por dispositivo) ─────────
CREATE TABLE IF NOT EXISTS api_tokens (
  id          serial PRIMARY KEY,
  user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  device      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_used   timestamptz,
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '90 days',
  revoked     boolean NOT NULL DEFAULT false
);

-- ───────── Carpetas del sistema (Documentos LegalTax / Cliente / Expediente) ─────────
ALTER TABLE clients ADD COLUMN IF NOT EXISTS folder_name text;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS folder_name text;

-- ───────── Acceso: nombre de usuario, cambio obligatorio de contraseña y bloqueo por intentos ─────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_logins integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS users_username_uq ON users (lower(username)) WHERE username IS NOT NULL;

-- ───────── Contabilidad: formatos fiscales, declaraciones mensuales y accesos ─────────
CREATE TABLE IF NOT EXISTS tax_formats (
  code        text PRIMARY KEY,
  name        text NOT NULL,
  description text,
  frequency   text NOT NULL DEFAULT 'mensual' CHECK (frequency IN ('mensual','anual')),
  due_day     integer NOT NULL DEFAULT 15 CHECK (due_day BETWEEN 1 AND 31),   -- mensual: día del mes siguiente
  annual_due  text,                                                          -- anual: 'MM-DD' del año siguiente
  default_on  boolean NOT NULL DEFAULT false,
  position    integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS client_tax_formats (
  client_id   integer NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  format_code text NOT NULL REFERENCES tax_formats(code) ON DELETE CASCADE,
  PRIMARY KEY (client_id, format_code)
);
CREATE TABLE IF NOT EXISTS tax_filings (
  id          serial PRIMARY KEY,
  client_id   integer NOT NULL REFERENCES clients(id),
  format_code text NOT NULL REFERENCES tax_formats(code),
  period      text NOT NULL CHECK (period ~ '^\d{4}(-\d{2})?$'),             -- 'AAAA-MM' (mensual) o 'AAAA' (anual)
  status      text NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','enviado','sin_movimiento','no_aplica')),
  sent_on     date,
  ack_number  text,
  amount      numeric(14,2),
  notes       text,
  case_id     integer REFERENCES cases(id),
  updated_by  integer REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, format_code, period)
);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS filing_id integer REFERENCES tax_filings(id);
CREATE TABLE IF NOT EXISTS client_credentials (
  id          serial PRIMARY KEY,
  client_id   integer NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform    text NOT NULL,
  url         text,
  username    text,
  secret_enc  text,
  notes       text,
  updated_by  integer REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ───────── Seguridad a nivel de fila (RLS) ─────────
-- Personal: acceso completo. Cliente: solo sus registros y solo lo publicado.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['clients','cases','case_events','deadlines','documents','quotes','quote_items',
                           'installments','payments','doc_requests','generated_docs','audit_log','saved_queries','email_log','invoices','notices','tax_filings','client_tax_formats','client_credentials'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS staff_all ON %I', t);
    EXECUTE format('CREATE POLICY staff_all ON %I FOR ALL USING (app_staff()) WITH CHECK (app_staff())', t);
    EXECUTE format('DROP POLICY IF EXISTS client_read ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS client_write ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS client_update ON %I', t);
  END LOOP;
END $$;

CREATE POLICY client_read ON clients      FOR SELECT USING (id = app_client());
CREATE POLICY client_read ON cases        FOR SELECT USING (client_id = app_client());
CREATE POLICY client_read ON case_events  FOR SELECT USING (client_id = app_client() AND visibility = 'cliente');
CREATE POLICY client_read ON documents    FOR SELECT USING (client_id = app_client() AND visibility = 'cliente');
CREATE POLICY client_write ON documents   FOR INSERT WITH CHECK (client_id = app_client() AND visibility = 'cliente' AND uploaded_by_client);
CREATE POLICY client_read ON quotes       FOR SELECT USING (client_id = app_client() AND status <> 'borrador');
CREATE POLICY client_update ON quotes     FOR UPDATE USING (client_id = app_client() AND status = 'publicada')
                                                     WITH CHECK (client_id = app_client() AND status IN ('aceptada','rechazada'));
CREATE POLICY client_read ON quote_items  FOR SELECT USING (client_id = app_client() AND quote_id IN (SELECT id FROM quotes));
CREATE POLICY client_read ON installments FOR SELECT USING (client_id = app_client() AND quote_id IN (SELECT id FROM quotes));
CREATE POLICY client_read ON payments     FOR SELECT USING (client_id = app_client());
CREATE POLICY client_write ON payments    FOR INSERT WITH CHECK (client_id = app_client() AND status = 'pendiente' AND amount_validated IS NULL);
CREATE POLICY client_read ON doc_requests FOR SELECT USING (client_id = app_client());
CREATE POLICY client_update ON doc_requests FOR UPDATE USING (client_id = app_client() AND status IN ('pendiente','devuelta'))
                                                       WITH CHECK (client_id = app_client() AND status IN ('pendiente','devuelta'));
CREATE POLICY client_read ON generated_docs FOR SELECT USING (client_id = app_client() AND shared AND status <> 'reemplazado');
CREATE POLICY client_write ON audit_log   FOR INSERT WITH CHECK (app_role() = 'cliente');
CREATE POLICY client_read ON saved_queries FOR SELECT USING (false);
CREATE POLICY client_read ON invoices FOR SELECT USING (client_id = app_client() AND status = 'emitida');
CREATE POLICY client_read ON notices FOR SELECT USING (false);
CREATE POLICY client_read ON tax_filings FOR SELECT USING (false);
CREATE POLICY client_read ON client_tax_formats FOR SELECT USING (false);
CREATE POLICY client_read ON client_credentials FOR SELECT USING (false);
