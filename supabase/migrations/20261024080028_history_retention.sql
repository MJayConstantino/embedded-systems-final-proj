-- Hosted Supabase supports pg_cron. A database job removes old data even while the board is offline.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('verdant-history-retention','* * * * *','select public.prune_plant_history();');
