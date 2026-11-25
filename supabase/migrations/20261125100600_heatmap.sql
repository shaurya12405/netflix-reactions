-- Comment and reaction counts per 10-second bucket for one video.
-- SECURITY INVOKER: runs under the caller's RLS, so anything hidden from the
-- caller (e.g. moderated comments from M4) is not counted.
-- Spoiler masking (only showing watched buckets) happens in the client.
create function public.heatmap(p_video_id text)
returns table (bucket_start integer, comment_count integer, reaction_count integer)
language sql
stable
security invoker
set search_path = ''
as $$
  with c as (
    select floor(ts_seconds / 10)::integer as bucket, count(*)::integer as n
    from public.comments
    where video_id = p_video_id
    group by 1
  ),
  r as (
    select floor(ts_seconds / 10)::integer as bucket, count(*)::integer as n
    from public.reactions
    where video_id = p_video_id
    group by 1
  )
  select coalesce(c.bucket, r.bucket) * 10, coalesce(c.n, 0), coalesce(r.n, 0)
  from c
  full outer join r on r.bucket = c.bucket
  order by 1;
$$;

revoke all on function public.heatmap(text) from public;
grant execute on function public.heatmap(text) to anon, authenticated;
