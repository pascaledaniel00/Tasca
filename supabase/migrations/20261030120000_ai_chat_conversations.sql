-- Separa le conversazioni senza rimuovere lo storico già sincronizzato.
alter table public.ai_chat_messages
  add column if not exists conversation_id uuid;

with legacy_conversations as (
  select user_id, gen_random_uuid() as conversation_id
  from public.ai_chat_messages
  where conversation_id is null
  group by user_id
)
update public.ai_chat_messages as messages
set conversation_id = legacy_conversations.conversation_id
from legacy_conversations
where messages.user_id = legacy_conversations.user_id
  and messages.conversation_id is null;

create index if not exists ai_chat_messages_user_conversation_created_idx
  on public.ai_chat_messages (user_id, conversation_id, created_at asc);
