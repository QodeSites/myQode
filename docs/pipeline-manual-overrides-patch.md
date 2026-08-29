# Pipeline patch — stop the Nuvama scrape resetting family mappings

**Server:** `sanket@101.53.133.109`
**File:** `/var/www/data-pipeline.qodeinvest.com/nuvama-data-updation/app/nuvama/nuvama_client_master.py`
**Migration:** `database/migrations/007_manual_overrides.sql`

## Why

`nuvama_client_master.py` loads `pms_clients_master` by **DELETE + INSERT**. Its
own comment says so:

```python
# Save existing passwords before DELETE+INSERT wipes them
```

It preserves `password`, and later propagates `password_set_at` and
`onboarding_status` by PAN. **Nothing else survives.** `head_of_family` and
`groupid` are taken straight from the Nuvama file, so any value the ops team
sets by hand is overwritten on the next run.

That is why the Chanchlani household has no head of family even though the
group is named after Devesh — and why setting one in the back office would
silently revert.

## Step 1 — create the override table

Run `007_manual_overrides.sql` against the **portfolios** database (the one
`PG_DATABASE` points at, the same one the pipeline writes to). It creates
`pms_clients_manual_overrides`, seeds the four Chanchlani rows, and applies
them immediately so the fix does not wait for the next scrape.

## Step 2 — patch the pipeline

Back up first:

```bash
cd /var/www/data-pipeline.qodeinvest.com/nuvama-data-updation
cp app/nuvama/nuvama_client_master.py \
   app/nuvama/nuvama_client_master.py.bak-$(date +%Y%m%d-%H%M%S)
```

Open `app/nuvama/nuvama_client_master.py` and find this line (around **line 408**):

```python
                logger.info(f"✅ Restored passwords for {len(password_map)} existing clients")
```

Insert the block below **immediately after it**, before the comment that begins
`# Propagate user-set passwords across clientcodes of the same investor (PAN).`

Indentation is **12 spaces** for `with`, matching the surrounding `try` block.

```python
            # Reapply manual overrides that the DELETE+INSERT above wiped.
            #
            # head_of_family and groupid are set by the ops team, not by
            # Nuvama, so every scrape would otherwise reset them — a family
            # head assigned in the back office would silently revert on the
            # next run. pms_clients_manual_overrides records those decisions;
            # this reapplies them.
            #
            # COALESCE, not a straight assignment: an override row may pin the
            # family without forcing a head, or the reverse. A NULL column
            # means "leave whatever the scrape produced".
            #
            # Single bulk UPDATE for the same reason the password restore uses
            # one — a per-row loop that raises midway would leave some rows
            # overridden and others not.
            with db.db.cursor() as cur:
                cur.execute("""
                    UPDATE public.pms_clients_master t
                       SET groupid        = COALESCE(o.groupid, t.groupid),
                           groupname      = COALESCE(o.groupname, t.groupname),
                           head_of_family = COALESCE(o.head_of_family, t.head_of_family),
                           updated_at     = now()
                      FROM public.pms_clients_manual_overrides o
                     WHERE t.clientcode = o.clientcode
                """)
                overridden = cur.rowcount
            db.db.commit()
            if overridden:
                logger.info(f"✅ Reapplied {overridden} manual overrides (family mapping, head of family)")
```

## Step 3 — verify

Check the syntax parses before the next scheduled run:

```bash
cd /var/www/data-pipeline.qodeinvest.com/nuvama-data-updation
python -m py_compile app/nuvama/nuvama_client_master.py && echo "syntax OK"
```

Then confirm the data:

```sql
SELECT clientname, clientcode, groupid, head_of_family
  FROM public.pms_clients_master
 WHERE clientname ILIKE '%chanchlani%'
 ORDER BY clientcode;
```

Expect four rows in group `14410381`, with `QAW00093` the only `head_of_family = true`.

And confirm no family ended up with two heads:

```sql
SELECT groupid, count(*) FILTER (WHERE head_of_family) AS heads
  FROM public.pms_clients_master
 WHERE groupid IS NOT NULL
 GROUP BY groupid
HAVING count(*) FILTER (WHERE head_of_family) > 1;
```

Expect **no rows**.

## Step 4 — confirm it survives a scrape

The real test is the next pipeline run. Afterwards, re-run the first query
above. If `QAW00093` is still head, the fix holds. If it reverted, the patch is
not being reached — check the pipeline log for the
`✅ Reapplied N manual overrides` line.

## Rolling back

```bash
cd /var/www/data-pipeline.qodeinvest.com/nuvama-data-updation
cp app/nuvama/nuvama_client_master.py.bak-<timestamp> \
   app/nuvama/nuvama_client_master.py
```

The table can stay — it is inert without the patch.

## After this

Setting a head of family from `/admin/families` currently writes only to
`pms_clients_master`, so it would still be wiped on the next scrape. To make
the back office durable, `setHeadOfFamily` in `lib/adminClientMutations.ts`
should also upsert into `pms_clients_manual_overrides`. Worth doing before the
team works through the **181 families that have no head** — otherwise that work
is lost on the next run.
