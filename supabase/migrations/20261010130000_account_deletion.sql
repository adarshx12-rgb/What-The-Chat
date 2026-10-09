-- Self-serve account deletion (DPDP / GDPR). Deleting the auth user cascades
-- to profiles and credit_ledger. Two things must survive it:
--  * email_claims keeps the email hash (owner set to null), so deleting and
--    signing up again never earns a second sign-in bonus;
--  * a late order.paid webhook for a deleted user must not fail forever
--    (Razorpay would keep retrying), so grant_credit_pack ignores it.

alter table private.email_claims alter column user_id drop not null;
alter table private.email_claims drop constraint email_claims_user_id_fkey;
alter table private.email_claims add constraint email_claims_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete set null;

create or replace function public.grant_credit_pack(p_order_id text, p_user uuid, p_credits integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare inserted text;
begin
  if p_order_id is null or p_user is null or p_credits is null or p_credits <= 0 or p_credits > 10000 then
    raise exception 'bad pack' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then return false; end if;
  insert into private.credit_pack_orders (order_id, user_id, credits) values (p_order_id, p_user, p_credits)
    on conflict do nothing returning order_id into inserted;
  if inserted is null then return false; end if;
  perform private.grant_credits(p_user, p_credits, 'credit_pack');
  return true;
end $$;
