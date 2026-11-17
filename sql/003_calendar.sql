-- Платёжный календарь: счета, которые не учитываются в календаре (например, чужой счёт третьего юрлица)
alter table cl_accounts add column if not exists in_calendar boolean not null default true;
