SELECT type, name, tbl_name, sql
FROM sqlite_master
WHERE sql LIKE '%"Orders"%';
