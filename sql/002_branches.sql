-- Учёт по филиалам: филиалы, собственники филиалов, привязка счетов, объектов, операций и платежей к филиалу.
-- Обратно совместимо: у существующих строк филиал «Основной», у новых строк без указания филиала по умолчанию тоже он.

create table if not exists cl_branches (
  id bigint generated always as identity primary key,
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into cl_branches(name) values ('Основной'), ('Филиал ИП Панкратов'), ('Филиал ИП Журавский') on conflict (name) do nothing;

do $$
declare main_id bigint; t text;
begin
  select id into main_id from cl_branches where name = 'Основной';
  foreach t in array array['cl_objects','cl_accounts','cl_operations','cl_planned'] loop
    execute format('alter table %I add column if not exists branch_id bigint references cl_branches(id)', t);
    execute format('update %I set branch_id = %s where branch_id is null', t, main_id);
    execute format('alter table %I alter column branch_id set default %s', t, main_id);
    execute format('alter table %I alter column branch_id set not null', t);
    execute format('create index if not exists %I on %I(branch_id)', t||'_branch_idx', t);
  end loop;
end $$;

-- названия объектов и счетов уникальны внутри филиала
alter table cl_objects  drop constraint if exists cl_objects_name_key;
alter table cl_accounts drop constraint if exists cl_accounts_name_key;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cl_objects_branch_name_key') then
    alter table cl_objects add constraint cl_objects_branch_name_key unique (branch_id, name);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cl_accounts_branch_name_key') then
    alter table cl_accounts add constraint cl_accounts_branch_name_key unique (branch_id, name);
  end if;
end $$;

-- операция и платёж: счёт и объект должны быть из того же филиала
create or replace function cl_check_branch() returns trigger language plpgsql as $$
begin
  if new.account_id is not null and (select branch_id from cl_accounts where id = new.account_id) <> new.branch_id then
    raise exception 'Счёт относится к другому филиалу';
  end if;
  if (select branch_id from cl_objects where id = new.object_id) <> new.branch_id then
    raise exception 'Объект относится к другому филиалу';
  end if;
  return new;
end $$;
drop trigger if exists cl_operations_branch_chk on cl_operations;
create trigger cl_operations_branch_chk before insert or update on cl_operations for each row execute function cl_check_branch();
drop trigger if exists cl_planned_branch_chk on cl_planned;
create trigger cl_planned_branch_chk before insert or update on cl_planned for each row execute function cl_check_branch();

-- статьи по новым собственникам
insert into cl_articles(name, kind, dds_section, opu_group, sort) values
 ('Дивиденды Андрей', 'expense', 'financing', null, 191),
 ('Дивиденды Роман',  'expense', 'financing', null, 192),
 ('Вложения собственных средств Андрей', 'income', 'financing', null, 181),
 ('Вложения собственных средств Роман',  'income', 'financing', null, 182)
on conflict (name) do nothing;

-- собственники филиала и их доли
create table if not exists cl_branch_owners (
  id bigint generated always as identity primary key,
  branch_id bigint not null references cl_branches(id),
  name text not null,
  share numeric(5,2) not null check (share > 0 and share <= 100),
  dividend_article_id bigint references cl_articles(id),
  contribution_article_id bigint references cl_articles(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (branch_id, name)
);

insert into cl_branch_owners(branch_id, name, share, dividend_article_id, contribution_article_id)
select b.id, o.name, 50,
       (select id from cl_articles where name = 'Дивиденды ' || o.name),
       (select id from cl_articles where name = 'Вложения собственных средств ' || o.name)
from (values ('Основной','Александр'),('Основной','Сергей'),
             ('Филиал ИП Панкратов','Андрей'),('Филиал ИП Панкратов','Сергей'),
             ('Филиал ИП Журавский','Сергей'),('Филиал ИП Журавский','Роман')) as o(branch, name)
join cl_branches b on b.name = o.branch
on conflict (branch_id, name) do nothing;

-- общий объект и счета новых филиалов
insert into cl_objects(name, is_common, branch_id)
select 'Все объекты', true, id from cl_branches where name in ('Филиал ИП Панкратов','Филиал ИП Журавский')
on conflict (branch_id, name) do nothing;

insert into cl_accounts(name, opening_balance, opening_date, branch_id)
select a.name, 0, a.d::date, b.id
from (values ('Филиал ИП Панкратов','Наличные','2026-11-01'),('Филиал ИП Панкратов','Р/с ИП','2026-11-01'),('Филиал ИП Панкратов','Р/с ООО','2026-11-01'),
             ('Филиал ИП Журавский','Наличные','2026-05-01'),('Филиал ИП Журавский','Личная карта (перевод)','2026-05-01'),('Филиал ИП Журавский','Р/с ИП','2026-05-01')) as a(branch, name, d)
join cl_branches b on b.name = a.branch
on conflict (branch_id, name) do nothing;

-- права
do $$
declare t text;
begin
  foreach t in array array['cl_branches','cl_branch_owners'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t||'_read', t);
    execute format('drop policy if exists %I on %I', t||'_write', t);
    execute format('create policy %I on %I for select to authenticated using (cl_role() in (''editor'',''viewer''))', t||'_read', t);
    execute format('create policy %I on %I for all to authenticated using (cl_role() = ''editor'') with check (cl_role() = ''editor'')', t||'_write', t);
  end loop;
end $$;
revoke all on cl_branches, cl_branch_owners from anon;
grant select, insert, update, delete on cl_branches, cl_branch_owners to authenticated;
