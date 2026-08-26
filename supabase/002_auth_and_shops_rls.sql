-- Ground Work — Auth wiring (step 2 of 6)
-- Run in Supabase Dashboard -> SQL Editor, AFTER schema.sql has succeeded.

-- ---------------------------------------------------------------------
-- On signup, create the matching shops row automatically. shop_name comes
-- from the client's supabase.auth.signUp({ options: { data: { shop_name }}})
-- call — see LoginScreen in src/components/InventoryTracker.tsx. Falls back
-- to the email's local part if that's somehow missing.
--
-- security definer: this function runs with its owner's privileges (the
-- role that creates it here, which Supabase's SQL editor runs as), not the
-- privileges of whoever triggered it. That's what lets it insert into
-- shops despite RLS being enabled with no policies yet — the standard,
-- Supabase-documented pattern for this exact "create a profile row on
-- signup" trigger.
-- ---------------------------------------------------------------------
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.shops (id, name, tier)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'shop_name', split_part(new.email, '@', 1)),
    'basic'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Minimal RLS preview: a shop owner can read and update ONLY their own
-- shops row (auth.uid() = id, since shops.id IS the auth user id). This is
-- the bare minimum needed for step 2 to be end-to-end testable — sign up,
-- get a shops row, read it back to show the shop name/tier in the
-- dashboard header. It does NOT touch items/menu_items/ingredients; that
-- full sweep — plus a review/hardening pass on this policy pair — is
-- step 3, done deliberately, not accidentally already finished here.
-- ---------------------------------------------------------------------
create policy "Shop owners can view their own shop"
  on shops for select
  using (auth.uid() = id);

create policy "Shop owners can update their own shop"
  on shops for update
  using (auth.uid() = id)
  with check (auth.uid() = id);
