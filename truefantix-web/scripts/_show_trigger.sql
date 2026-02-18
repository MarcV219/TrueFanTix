SELECT name, sql
FROM sqlite_master
WHERE type = 'trigger'
AND name = 'event_sellout_immutable_after_order';
