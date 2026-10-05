-- Local e2e runs create many anonymous visitors from 127.0.0.1.
update private.app_settings set value = '1000' where key = 'visitor_ip_daily_limit';
