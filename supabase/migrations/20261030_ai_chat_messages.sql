-- Cronologia sincronizzata della chat Tasca IA.
create table if not exists public.ai_chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_message_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 6000),
  created_at timestamptz not null default now(),
  unique (user_id, client_message_id)
);
create index if not exists ai_chat_messages_user_created_idx
  on public.ai_chat_messages (user_id, created_at desc);
alter table public.ai_chat_messages enable row level security;
drop policy if exists "Users can read own AI chat messages" on public.ai_chat_messages;
create policy "Users can read own AI chat messages" on public.ai_chat_messages
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users can insert own AI chat messages" on public.ai_chat_messages;
create policy "Users can insert own AI chat messages" on public.ai_chat_messages
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users can update own AI chat messages" on public.ai_chat_messages;
create policy "Users can update own AI chat messages" on public.ai_chat_messages
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users can delete own AI chat messages" on public.ai_chat_messages;
create policy "Users can delete own AI chat messages" on public.ai_chat_messages
  for delete to authenticated using (auth.uid() = user_id);
grant select, insert, update, delete on public.ai_chat_messages to authenticated;
