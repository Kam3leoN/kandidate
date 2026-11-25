/**
 * Schema migrations. One statement per array entry (the Neon HTTP driver runs
 * a single statement per query). Never edit a shipped migration: add a new one.
 */
export interface Migration {
  version: number;
  name: string;
  statements: string[];
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'init',
    statements: [
      `create table if not exists profile (
        id int primary key default 1 check (id = 1),
        data jsonb not null default '{}'::jsonb,
        updated_at timestamptz not null default now()
      )`,
      `create table if not exists settings (
        id int primary key default 1 check (id = 1),
        data jsonb not null default '{}'::jsonb,
        updated_at timestamptz not null default now()
      )`,
      `create table if not exists searches (
        id serial primary key,
        name text not null,
        keywords text not null default '',
        location jsonb,
        radius_km int not null default 30,
        contracts text[] not null default '{}',
        remote text not null default 'any',
        salary_min int,
        published_since_days int not null default 7,
        sources text[] not null default '{}',
        rome_codes text[] not null default '{}',
        exclude_keywords text[] not null default '{}',
        min_score int not null default 60,
        alert boolean not null default true,
        last_run_at timestamptz,
        last_new_count int,
        created_at timestamptz not null default now()
      )`,
      `create table if not exists offers (
        id serial primary key,
        source text not null,
        source_id text not null,
        dedupe_key text not null,
        url text not null default '',
        title text not null,
        company text not null default '',
        location text not null default '',
        lat double precision,
        lon double precision,
        contract text,
        remote text,
        salary_min int,
        salary_max int,
        salary_text text not null default '',
        description text not null default '',
        published_at timestamptz,
        fetched_at timestamptz not null default now(),
        status text not null default 'new',
        match_score int,
        analysis jsonb,
        match jsonb,
        search_id int references searches(id) on delete set null,
        unique (source, source_id)
      )`,
      `create index if not exists offers_dedupe_idx on offers (dedupe_key)`,
      `create index if not exists offers_status_idx on offers (status, fetched_at desc)`,
      `create index if not exists offers_score_idx on offers (match_score desc nulls last)`,
      `create table if not exists applications (
        id serial primary key,
        offer_id int references offers(id) on delete set null,
        title text not null,
        company text not null default '',
        location text not null default '',
        url text not null default '',
        source text,
        contract text,
        salary_text text not null default '',
        status text not null default 'wishlist',
        priority int not null default 2,
        match_score int,
        applied_at timestamptz,
        next_followup_at timestamptz,
        followup_count int not null default 0,
        followup_notified_at timestamptz,
        contact_name text not null default '',
        contact_email text not null default '',
        contact_phone text not null default '',
        contact_role text not null default '',
        notes text not null default '',
        cover_letter text not null default '',
        description text not null default '',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`,
      `create index if not exists applications_status_idx on applications (status)`,
      `create index if not exists applications_followup_idx on applications (next_followup_at)`,
      `create table if not exists application_events (
        id serial primary key,
        application_id int not null references applications(id) on delete cascade,
        type text not null,
        title text not null default '',
        body text not null default '',
        at timestamptz not null default now(),
        meta jsonb not null default '{}'::jsonb
      )`,
      `create index if not exists events_app_idx on application_events (application_id, at desc)`,
      `create table if not exists notifications (
        id serial primary key,
        kind text not null,
        title text not null,
        body text not null default '',
        url text not null default '',
        meta jsonb not null default '{}'::jsonb,
        read_at timestamptz,
        emailed_at timestamptz,
        created_at timestamptz not null default now()
      )`,
      `create index if not exists notifications_created_idx on notifications (created_at desc)`,
      `create table if not exists push_subscriptions (
        id serial primary key,
        endpoint text not null unique,
        p256dh text not null,
        auth text not null,
        user_agent text not null default '',
        created_at timestamptz not null default now()
      )`,
      `create table if not exists inbound_emails (
        id serial primary key,
        provider_id text,
        sender text not null default '',
        subject text not null default '',
        offers_found int not null default 0,
        received_at timestamptz not null default now()
      )`,
      `create table if not exists cron_runs (
        id serial primary key,
        trigger text not null,
        started_at timestamptz not null default now(),
        finished_at timestamptz,
        stats jsonb not null default '{}'::jsonb,
        error text
      )`,
      `insert into profile (id) values (1) on conflict do nothing`,
      `insert into settings (id) values (1) on conflict do nothing`,
    ],
  },
];
