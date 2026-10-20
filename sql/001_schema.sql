-- Управленческий учёт клининга: структура базы. Все таблицы с префиксом cl_
-- Доступ: editor (вносит и меняет), viewer (только смотрит), pending (ждёт одобрения, ничего не видит)

create table if not exists cl_members (
  user_id uuid primary key,
  email text not null,
  role text not null default 'pending' check (role in ('editor','viewer','pending')),
  created_at timestamptz not null default now()
);

create or replace function cl_role() returns text
language sql stable security definer set search_path = public as $$
  select role from cl_members where user_id = auth.uid()
$$;

-- Регистрация при первом входе: первый пользователь становится editor, остальные pending
create or replace function cl_register() returns text
language plpgsql security definer set search_path = public as $$
declare r text;
begin
  if auth.uid() is null then return null; end if;
  select role into r from cl_members where user_id = auth.uid();
  if r is null then
    insert into cl_members(user_id, email, role)
    values (auth.uid(), coalesce(auth.jwt() ->> 'email', ''),
            case when exists (select 1 from cl_members) then 'pending' else 'editor' end)
    returning role into r;
  end if;
  return r;
end $$;

create table if not exists cl_objects (
  id bigint generated always as identity primary key,
  name text not null unique,
  legal_entity text,
  is_common boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists cl_accounts (
  id bigint generated always as identity primary key,
  name text not null unique,
  opening_balance numeric(14,2) not null default 0,
  opening_date date not null default date '2026-01-01',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists cl_articles (
  id bigint generated always as identity primary key,
  name text not null unique,
  kind text not null check (kind in ('income','expense')),
  dds_section text not null check (dds_section in ('operating','investing','financing','internal')),
  opu_group text,            -- null: статья не входит в ОПУ
  sort int not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists cl_operations (
  id bigint generated always as identity primary key,
  op_date date,              -- дата оплаты (ДДС); null: только начисление
  account_id bigint references cl_accounts(id),
  article_id bigint not null references cl_articles(id),
  object_id bigint not null references cl_objects(id),
  period date,               -- месяц начисления, первое число (ОПУ); null: только оплата
  amount numeric(14,2) not null check (amount > 0),
  counterparty text,
  comment text,
  created_at timestamptz not null default now(),
  check (op_date is not null or period is not null),
  check ((op_date is null) = (account_id is null)),
  check (period is null or extract(day from period) = 1)
);
create index if not exists cl_operations_date_idx on cl_operations(op_date);
create index if not exists cl_operations_period_idx on cl_operations(period);

create table if not exists cl_planned (
  id bigint generated always as identity primary key,
  plan_date date not null,
  article_id bigint not null references cl_articles(id),
  object_id bigint not null references cl_objects(id),
  account_id bigint references cl_accounts(id),
  amount numeric(14,2) not null check (amount > 0),
  comment text,
  recurrence text not null default 'none' check (recurrence in ('none','monthly')),
  until date,
  done_dates date[] not null default '{}',
  created_at timestamptz not null default now()
);

-- Права: доступ только через RLS
do $$
declare t text;
begin
  foreach t in array array['cl_objects','cl_accounts','cl_articles','cl_operations','cl_planned'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t||'_read', t);
    execute format('drop policy if exists %I on %I', t||'_write', t);
    execute format('create policy %I on %I for select to authenticated using (cl_role() in (''editor'',''viewer''))', t||'_read', t);
    execute format('create policy %I on %I for all to authenticated using (cl_role() = ''editor'') with check (cl_role() = ''editor'')', t||'_write', t);
  end loop;
end $$;

alter table cl_members enable row level security;
drop policy if exists cl_members_read on cl_members;
drop policy if exists cl_members_write on cl_members;
drop policy if exists cl_members_delete on cl_members;
create policy cl_members_read on cl_members for select to authenticated
  using (user_id = auth.uid() or cl_role() = 'editor');
create policy cl_members_write on cl_members for update to authenticated
  using (cl_role() = 'editor' and user_id <> auth.uid()) with check (cl_role() = 'editor' and user_id <> auth.uid());
create policy cl_members_delete on cl_members for delete to authenticated
  using (cl_role() = 'editor' and user_id <> auth.uid());

revoke all on cl_members, cl_objects, cl_accounts, cl_articles, cl_operations, cl_planned from anon;
grant select, insert, update, delete on cl_members, cl_objects, cl_accounts, cl_articles, cl_operations, cl_planned to authenticated;
grant execute on function cl_register(), cl_role() to authenticated;

-- Структура справочников (не данные клиента): общий объект и базовые статьи
insert into cl_objects(name, is_common) values ('Все объекты', true) on conflict (name) do nothing;

insert into cl_articles(name, kind, dds_section, opu_group, sort) values
 ('Выручка от клиентов',               'income',  'operating', 'Выручка', 10),
 ('Прочие доходы',                     'income',  'operating', 'Прочие доходы и расходы', 20),
 ('Возврат от поставщика',             'income',  'operating', 'Прочие доходы и расходы', 30),
 ('ЗП клининг (самозанятые)',          'expense', 'operating', 'Прямые расходы', 40),
 ('Расходные материалы и химия',       'expense', 'operating', 'Прямые расходы', 50),
 ('Транспорт на объекты',              'expense', 'operating', 'Прямые расходы', 60),
 ('Агентские и процент менеджера',     'expense', 'operating', 'Коммерческие и агентские', 70),
 ('Реклама и привлечение',             'expense', 'operating', 'Коммерческие и агентские', 80),
 ('ЗП офисный персонал',               'expense', 'operating', 'Административные', 90),
 ('Аренда офиса и склада',             'expense', 'operating', 'Административные', 100),
 ('Связь, софт, сервисы',              'expense', 'operating', 'Административные', 110),
 ('Банковские комиссии',               'expense', 'operating', 'Административные', 120),
 ('Прочие расходы',                    'expense', 'operating', 'Административные', 130),
 ('Налоги',                            'expense', 'operating', 'Налоги', 140),
 ('Покупка оборудования',              'expense', 'investing', null, 150),
 ('Получение займа',                   'income',  'financing', null, 160),
 ('Погашение займа',                   'expense', 'financing', null, 170),
 ('Вложения собственников',            'income',  'financing', null, 180),
 ('Дивиденды',                         'expense', 'financing', null, 190),
 ('Перемещение между счетами: приход', 'income',  'internal',  null, 200),
 ('Перемещение между счетами: расход', 'expense', 'internal',  null, 210)
on conflict (name) do nothing;
