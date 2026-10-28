-- Tasca: progressi dei quiz di benessere finanziario
-- Eseguire una sola volta nel Supabase SQL Editor del progetto.
create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  attempt_key uuid not null,
  question_fingerprint text not null,
  category text not null check (category in ('all','budget','saving','debt','spending','banking','economy')),
  difficulty smallint not null check (difficulty between 1 and 3),
  correct_answers smallint not null check (correct_answers >= 0),
  total_questions smallint not null check (total_questions between 1 and 10),
  percent smallint not null check (percent between 0 and 100),
  xp_earned smallint not null check (xp_earned between 0 and 120),
  source text not null check (source in ('verified','ai','mixed')),
  completed_at timestamptz not null default now(),
  constraint quiz_attempts_unique_attempt unique (user_id, attempt_key),
  constraint quiz_attempts_unique_question_set unique (user_id, question_fingerprint),
  constraint quiz_attempts_score_consistent check (
    correct_answers <= total_questions
    and percent = round((correct_answers::numeric / total_questions::numeric) * 100)::smallint
    and xp_earned <= (correct_answers * 10 + 30)
  )
);
create index if not exists quiz_attempts_user_completed_idx
  on public.quiz_attempts (user_id, completed_at desc);
alter table public.quiz_attempts enable row level security;
drop policy if exists "Users can read their own quiz attempts" on public.quiz_attempts;
create policy "Users can read their own quiz attempts"
  on public.quiz_attempts for select to authenticated
  using (auth.uid() = user_id);
drop policy if exists "Users can create their own quiz attempts" on public.quiz_attempts;
create policy "Users can create their own quiz attempts"
  on public.quiz_attempts for insert to authenticated
  with check (
    auth.uid() = user_id
    and correct_answers <= total_questions
    and percent = round((correct_answers::numeric / total_questions::numeric) * 100)::smallint
    and xp_earned <= (correct_answers * 10 + 30)
  );
-- I tentativi sono append-only: nessuna policy di update/delete viene concessa al client.
grant select, insert on public.quiz_attempts to authenticated;
