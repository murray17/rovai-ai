---
document_type: contract
name: Camp Open Projection
version: v7
status: accepted
source_version: v1.29
last_updated: 2026-08-26
---

# Camp Open Projection v7

v7 replaces [v6](camp-open-projection-v6.md). Existing bounded collections, complete non-terminal Evidence,
attachment projection state, coverage, pagination and read transaction remain.

`CampSnapshot.schemaVersion` becomes `33`; `CampOpenProjection.schemaVersion` becomes `4`. Both add required
`camp.membershipGeneration: number` and `membershipReconciliations: CampMembershipReconciliationView[]`.
The latter contains only active `reconciling` rows defined by [Camp Membership v1](camp-membership-v1.md); completed
history remains in domain events/audit, not this live collection. Existing `members` continue to carry exact
`membershipStatus` and `version`.

## References

- [Camp Open Projection v6](camp-open-projection-v6.md)
- [Camp Membership v1](camp-membership-v1.md)
- [Camp Open Read Path](../architecture/camp-open-read-path.md)
