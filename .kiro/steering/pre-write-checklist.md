# Pre-Write Checklist — Apply Before Generating Code

This checklist captures recurring gap categories found across Sprints 1–2.
Every item here was caught in review at least once. Apply these checks
*during design/first-draft*, not as a post-write review pass.

## For any new Postgres function (RPC):

- [ ] `SECURITY DEFINER` — needed if the function writes columns the caller's RLS wouldn't normally allow
- [ ] `SET search_path = public` (or `auth, public`) — bare SECURITY DEFINER without locked search_path is a privilege-escalation hole
- [ ] `GRANT EXECUTE ON FUNCTION ... TO authenticated` — without this, RLS policies or RPC calls referencing the function fail closed (permission denied, not empty result)
- [ ] `GRANT EXECUTE ... TO service_role` — if Edge Functions call it directly
- [ ] Co-maintenance comment (`⚠️ CO-MAINTENANCE: matched by <file>`) on any `RAISE EXCEPTION` whose message string is pattern-matched by an Edge Function

## For any multi-step write from an Edge Function:

- [ ] **Can the operation leave a worse-than-either-side state if it partially fails?** If yes → wrap in a Postgres function (single transaction), not multiple round-trips
- [ ] If wrapping isn't feasible → implement compensating action (like T2's delete-on-failure) + write to `audit_log` on compensating-action failure
- [ ] Document the atomicity decision in DECISIONS.md (AD-N)

## For any DELETE operation:

- [ ] **Check FK references TO the target table** — `grep "REFERENCES <table>" supabase/migrations/*.sql`
- [ ] If child rows might exist → either block the delete (guard), cascade explicitly, or soft-delete
- [ ] If child rows don't exist yet (future sprint) → document as a Pending dependency in DECISIONS.md so it's addressed before that sprint ships

## For any new RLS helper function:

- [ ] Mark as `STABLE` (optimizer can cache per-statement)
- [ ] Mark as `SECURITY DEFINER` + `SET search_path` (to bypass RLS on the inner query without escalation risk)
- [ ] `GRANT EXECUTE TO authenticated, service_role`
- [ ] Verify no recursive RLS (the helper must NOT be called by a policy on the same table it queries)

## For any sensitive data handling:

- [ ] Encryption: real algorithm (AES-256-GCM), not just encoding
- [ ] Hash: keyed (HMAC-SHA256), not plain SHA-256, for low-entropy inputs (mobile numbers, short codes)
- [ ] Key source: environment secret, never in code/config
- [ ] Key rotation story: documented as "not solved for MVP" or "solved by X"
- [ ] Decryption path: only via Edge Function (never raw SQL)

## For any service-role (admin client) query:

- [ ] Is this genuinely needed (caller's RLS correctly denies access that the endpoint legitimately needs)?
- [ ] Scoping is explicit in code (WHERE clauses), not relying on "bypass = show everything"
- [ ] A negative test exists asserting the scoping is correct (the T8 workload pattern)
- [ ] Only expose the minimum fields needed (not `SELECT *`)

## For any endpoint response:

- [ ] No forbidden keys in customer-facing responses (Part 7 list)
- [ ] Response matches the envelope shape (`{data, errors}` / `{data, pagination}`)
- [ ] Error codes are distinct (not generic 500 for all failures)

## For any propose→approve/reject workflow (state machine with separate actors):

- [ ] **Self-approval guard** — can the same user who proposed/created a row also approve it?
  - RLS role-gating alone doesn't prevent this (a user with both DESIGNER and ADMIN roles, or a single test account)
  - Check the spec (Part 4, Part 9) for whether self-approval is explicitly disallowed
  - If disallowed: enforce at the DB/RPC layer (`proposed_by != approver_id`), not just UI
  - If allowed (e.g., Admin direct-creates a SKU without a proposal): document as an explicit decision
  - Document as AD-N either way — the decision matters more than the answer
- [ ] **State machine completeness** — every status must have documented transitions (from → to), and the endpoint must reject undocumented transitions with a distinct error code
- [ ] **Creator editability** — can the creator edit after submission? If yes, only in specific statuses (e.g., DRAFT, REJECTED)? Enforce at RLS layer, not just endpoint

## General:

- [ ] New AD entry in DECISIONS.md for any non-trivial design choice
- [ ] Cross-check new AD against existing ADs for interactions (especially AD-2/AD-3 asymmetry, AD-8/AD-11 helper coupling)
- [ ] End-of-sprint DECISIONS.md re-read before merge
