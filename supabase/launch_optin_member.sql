-- Launch list: signed-in members join in one click. Run after launch_optin.sql. Safe to run again.
-- A member's email was already verified when they signed in (Google, or the link we email for password sign-ups), so a member who
-- ticks the consent line is recorded as confirmed straight away with optin_method = 'member'. Nothing else changes.
alter table public.launch_subscribers drop constraint if exists launch_subscribers_optin_method_check;
alter table public.launch_subscribers add constraint launch_subscribers_optin_method_check check (optin_method in ('double', 'single_legacy', 'member'));
