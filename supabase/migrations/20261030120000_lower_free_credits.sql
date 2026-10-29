-- Free credits lowered (Oct 30 2026): visitor grant 10 -> 5, so farming
-- credits from incognito windows and extra browsers pays less, and the
-- sign-in bonus 30 -> 10. Accounts that already received a grant keep it.
update private.app_settings set value = '5' where key = 'visitor_grant';
update private.app_settings set value = '10' where key = 'signup_bonus';
