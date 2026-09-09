# Migration and rollback contract

Every release starts with a checked custom-format PostgreSQL dump and records the previous image digest and migration tip. The venture's `ops/predeploy-dump.sh` and `ops/RELEASE.md` are the executable runbook. Startup migrations are serialized and fail closed.

Use expand/contract: add compatible nullable columns/tables/indexes first, ship code supporting both schema versions, backfill and verify separately. Remove or narrow old structures in a later release only after the rollback window closes. Review both the previous and next image's reads/writes; an additive schema alone does not guarantee semantic compatibility.

Image rollback does not roll back the database. For compatible expansion use the retained image; otherwise freeze writes, take an incident dump, restore the matching pre-release dump into a NEW database with `pg_restore --exit-on-error --single-transaction`, verify the previous image with matching encryption read keys, then switch the database mapping and image. Reconcile writes after the snapshot and repeat completed erasures before reopening traffic. Preserve the old database for reconciliation. Never run invented destructive down migrations.

0014 deliberately restricts workspace owner deletion, makes post/media creators nullable, removes unused identity-provider tokens and installs deletion tombstones. Creator-cascade assumptions in earlier code are incompatible with the new semantics. Auth.js here needs no Google tokens. Old images must not be used to restore the S01 scope leak. Treat rollback beyond this security boundary as incident recovery, not routine operation.
