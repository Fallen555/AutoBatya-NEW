-- АвтоБатя. Хранилище чата.
-- Выполнить один раз в Supabase: SQL Editor -> New query -> вставить -> Run.

create table if not exists public.chats (
  id                uuid primary key default gen_random_uuid(),
  secret            text not null,
  name              text,
  contact           text,
  created_at        timestamptz not null default now(),
  last_message_at   timestamptz not null default now(),
  last_notify_at    timestamptz,
  unread_for_shop   integer not null default 0,
  unread_for_user   integer not null default 0
);

create table if not exists public.messages (
  id          bigserial primary key,
  chat_id     uuid not null references public.chats(id) on delete cascade,
  author      text not null check (author in ('user', 'shop')),
  body        text not null default '',
  files       jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists messages_chat_idx on public.messages (chat_id, id);
create index if not exists chats_last_idx on public.chats (last_message_at desc);

-- Никто снаружи не ходит в таблицы напрямую: ни анонимные, ни залогиненные.
-- Работает только серверная функция, у неё служебный ключ и она обходит эти правила.
alter table public.chats    enable row level security;
alter table public.messages enable row level security;

revoke all on public.chats    from anon, authenticated;
revoke all on public.messages from anon, authenticated;

-- Хранилище файлов: приватное ведро.
insert into storage.buckets (id, name, public)
values ('chat-files', 'chat-files', false)
on conflict (id) do nothing;
