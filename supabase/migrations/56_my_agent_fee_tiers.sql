-- 56: an AP holder can keep their own "Agent fee & shipping" table (from their own supplier) instead of the AIM preset table.
--     tiers = [{ "upTo": 5000000, "fee": 250000, "pct": false }, ..., { "upTo": null, "fee": 5, "pct": true }]
--     a car priced below upTo pays fee yen (or fee % of the car price when pct); upTo null = and above. No row = the AIM table. Safe to run again.
create table if not exists public.ap_agent_fee_tiers (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  tiers      jsonb not null check (jsonb_typeof(tiers) = 'array' and jsonb_array_length(tiers) between 1 and 30),
  updated_at timestamptz not null default now()
);
alter table public.ap_agent_fee_tiers enable row level security;
revoke all on public.ap_agent_fee_tiers from anon, authenticated;

create or replace function public.my_agent_tiers() returns jsonb
language sql stable security definer set search_path = public as $$
  select t.tiers from public.ap_agent_fee_tiers t where t.user_id = auth.uid()
$$;
revoke all on function public.my_agent_tiers() from public, anon;
grant execute on function public.my_agent_tiers() to authenticated;

-- null = go back to the AIM table
create or replace function public.save_my_agent_tiers(p_tiers jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('ap_holder', 'admin', 'staff') and p.status = 'active') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_tiers is null then
    delete from public.ap_agent_fee_tiers where user_id = auth.uid();
  else
    insert into public.ap_agent_fee_tiers (user_id, tiers, updated_at) values (auth.uid(), p_tiers, now())
    on conflict (user_id) do update set tiers = excluded.tiers, updated_at = now();
  end if;
end $$;
revoke all on function public.save_my_agent_tiers(jsonb) from public, anon;
grant execute on function public.save_my_agent_tiers(jsonb) to authenticated;
