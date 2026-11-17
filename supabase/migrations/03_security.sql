-- =============================================================================
-- Auction — 03 row level security
-- The scraper uses the service_role key, which bypasses RLS. Everyone else goes through these policies.
-- =============================================================================
alter table public.app_settings enable row level security;
alter table public.fee_rules    enable row level security;
alter table public.profiles     enable row level security;
alter table public.ap_contacts  enable row level security;
alter table public.lots         enable row level security;
alter table public.lot_history  enable row level security;
alter table public.preferences  enable row level security;
alter table public.bids         enable row level security;

-- settings / fee rules: everyone signed in can read, admin changes
create policy settings_read  on public.app_settings for select to authenticated using (true);
create policy settings_admin on public.app_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy fees_read      on public.fee_rules for select to authenticated using (true);
create policy fees_admin     on public.fee_rules for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- profiles
create policy profiles_self   on public.profiles for select to authenticated using (id = auth.uid() or public.is_staff());
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid() or public.is_staff()) with check (id = auth.uid() or public.is_staff());
create policy profiles_staff_delete on public.profiles for delete to authenticated using (public.is_admin());

-- contacts
create policy contacts_own   on public.ap_contacts for all to authenticated using (ap_id = auth.uid() or public.is_staff()) with check (ap_id = auth.uid() or public.is_staff());

-- lots: active AP holders see eligible lots only; staff see and manage everything
create policy lots_ap    on public.lots for select to authenticated using (my_eligible and public.is_active_ap());
create policy lots_staff on public.lots for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- history: only AP holders with a running subscription
create policy history_ap on public.lot_history for select to authenticated using (
  public.is_staff() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active' and p.history_until >= current_date)
);
create policy history_staff on public.lot_history for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- preferences
create policy prefs_own   on public.preferences for all to authenticated using (ap_id = auth.uid()) with check (ap_id = auth.uid());
create policy prefs_staff on public.preferences for select to authenticated using (public.is_staff());

-- bids: AP holders read their own and write only through place_bid / cancel_bid; staff manage all
create policy bids_own   on public.bids for select to authenticated using (ap_id = auth.uid());
create policy bids_staff on public.bids for all to authenticated using (public.is_staff()) with check (public.is_staff());

grant execute on function public.place_bid(uuid, numeric, text)             to authenticated;
grant execute on function public.cancel_bid(uuid)                           to authenticated;
grant execute on function public.my_preferred_lots()                        to authenticated;
grant execute on function public.staff_set_bid(uuid, text, numeric, text)   to authenticated;
grant execute on function public.housekeeping()                            to authenticated;
revoke execute on function public.agent_fee_for(uuid, numeric) from public, anon, authenticated;
grant execute on function public.open_auction_days()                       to authenticated;
