-- templates: the design definition.
--
-- The template document is the product's file format and the most important
-- decision in Phase 0, so the split is enforced by the schema rather than left
-- to convention:
--
--   definition  structure only: { version, blocks: [...] } with per-block
--               default content. Zod validates the shape in the app.
--   theme       tokens only: { version, tokens: { palette, fonts, radii,
--               spacing } }. A block consumes tokens and nothing else.
--
-- Two columns, not one JSON blob with two keys, because the separation is the
-- thing that later lets a buyer pick a palette without touching structure. If
-- they shared a column the first person in a hurry would nest content under a
-- token key and nobody would notice for a month.
--
-- Each document carries its own `version`. They evolve independently: adding a
-- token is not the same change as adding a block, and an event pins the
-- definition version it was activated against (see events.template_definition_version).

create table public.templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  key text not null,
  name text not null,
  status public.template_status not null default 'draft',
  definition_version integer not null,
  definition jsonb not null,
  theme jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint templates_key_format
    check (key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(key) between 3 and 64),
  constraint templates_name_length
    check (char_length(name) between 1 and 120),
  constraint templates_definition_version_positive
    check (definition_version >= 1),

  constraint templates_definition_is_object
    check (jsonb_typeof(definition) = 'object'),
  -- coalesce, not a bare comparison: a missing key makes `->` return SQL NULL,
  -- jsonb_typeof(NULL) is NULL, and a check constraint that evaluates to NULL
  -- passes. Without it these constraints would accept exactly the documents
  -- they exist to reject.
  constraint templates_definition_has_blocks
    check (coalesce(jsonb_typeof(definition -> 'blocks'), '') = 'array'),
  -- The version column and the version inside the document must agree. CASE,
  -- not AND, because Postgres does not promise left-to-right evaluation and the
  -- cast would raise instead of failing the constraint.
  constraint templates_definition_version_matches_document
    check (case
      when jsonb_typeof(definition -> 'version') = 'number'
        then definition_version = (definition ->> 'version')::integer
      else false
    end),

  constraint templates_theme_is_object
    check (jsonb_typeof(theme) = 'object'),
  constraint templates_theme_has_tokens
    check (coalesce(jsonb_typeof(theme -> 'tokens'), '') = 'object'),
  constraint templates_theme_has_version
    check (coalesce(jsonb_typeof(theme -> 'version'), '') = 'number'),
  -- Content must not leak into the theme document. This catches the mistake the
  -- separation exists to prevent.
  constraint templates_theme_carries_no_blocks
    check (not (theme ? 'blocks'))
);

-- Scoped to owner so that seller-authored templates can reuse a key later
-- without a migration.
create unique index templates_owner_id_key_key on public.templates (owner_id, key);
create index templates_owner_id_idx on public.templates (owner_id);
create index templates_status_idx on public.templates (status) where status = 'published';

comment on table public.templates is
  'A design a buyer can activate. definition holds structure and default content, theme holds tokens, and the two are never mixed.';
comment on column public.templates.definition_version is
  'Mirrors definition->>version. Stored as a column so events can pin it and so a query can find every event on an old block set without unpacking JSON.';

create trigger templates_set_updated_at
  before update on public.templates
  for each row execute function public.set_updated_at();


-- Row level security -------------------------------------------------------

alter table public.templates enable row level security;
alter table public.templates force row level security;

revoke all on table public.templates from public, anon;
grant select, insert, update, delete on table public.templates to authenticated;
grant all on table public.templates to service_role;

create policy "templates: anon has no access"
  on public.templates as restrictive to anon
  using (false) with check (false);

create policy "templates: owner full access"
  on public.templates for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- There is no "any authenticated user can read published templates" policy yet.
-- Buyers reach the catalogue through an API route with the service role, same
-- as guests reach event pages. When a real catalogue exists it gets a policy
-- written against that requirement rather than a guess at it now.
