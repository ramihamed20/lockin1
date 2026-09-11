# Cohort content authorization rollout

`StudentCohort.content_nodes` is the authoritative database mapping from an
enrolment cohort to one or more `EducationNode` subtree roots. It is never
derived from titles, slugs, URLs, frontend catalogues, or ordering.

1. Apply the schema migration while `COHORT_CONTENT_ENFORCEMENT=false`.
2. An administrator assigns every intended content root in Django admin (or
   the controlled management API) and runs `audit_cohort_content_mappings`.
   The command is read-only and reports every cohort mapping and every published
   learning object with no assigned cohort root.
3. Correct all reported published objects, re-run the command, then set
   `COHORT_CONTENT_ENFORCEMENT=true` in the server configuration and deploy.

When strict mode is true, an ordinary learner must have an active current
cohort whose assigned root is an ancestor of the published object's academic
node. Missing mappings deny access. Content administrators retain their
intentional cross-cohort operational access. The compatibility switch is only
for the migration window; it must not remain enabled in a completed rollout.
