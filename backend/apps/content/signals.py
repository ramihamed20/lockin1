"""Keep Catalog branches in step with the two events that can change them.

``apps.content`` already depends on ``apps.education``; the reverse would be a
cycle. Listening to education's models from here is what lets the projection run
at the moment the hierarchy changes without education having to know the Catalog
exists.

Only two events matter:

* a subject node is created or renamed -- it needs a branch, or its branch needs
  the new name;
* a cohort's content roots change -- everything beneath the new root becomes
  that cohort's, which is the case migration ``content.0006`` could not cover
  because it ran once, before any later configuration.

Both handlers run after the surrounding transaction commits. A projection is a
consequence of a change, never a condition of it: a Catalog branch that cannot
be written must not roll back the hierarchy edit that prompted it.
"""

from __future__ import annotations

import logging
from typing import Any

from django.db import transaction
from django.db.models.signals import m2m_changed, post_save
from django.dispatch import receiver

from apps.education.models import EducationNode, StudentCohort

from .catalog_subjects import project_cohort, project_subject_node

logger = logging.getLogger("lockin.catalog")


def _safely(action: Any, *, stage: str) -> None:
    try:
        action()
    except Exception:  # noqa: BLE001 - a projection must never break the write it follows.
        logger.exception("Catalog branch projection failed", extra={"stage": stage})


@receiver(post_save, sender=EducationNode, dispatch_uid="content.project_subject_node")
def project_node_branch(sender: type, instance: EducationNode, **kwargs: Any) -> None:
    del sender, kwargs
    if instance.kind != EducationNode.Kind.SUBJECT:
        return
    node_id = instance.id
    transaction.on_commit(
        lambda: _safely(
            lambda: project_subject_node(EducationNode.objects.get(id=node_id)),
            stage="education-node",
        )
    )


@receiver(
    m2m_changed,
    sender=StudentCohort.content_nodes.through,
    dispatch_uid="content.project_cohort_branches",
)
def project_cohort_branches(
    sender: type, instance: Any, action: str, pk_set: set[Any] | None = None, **kwargs: Any
) -> None:
    del sender, kwargs
    # post_remove is deliberately not handled: this module never retires a
    # branch, so the only interesting direction is content becoming available.
    if action not in {"post_add", "post_clear"}:
        return
    if not isinstance(instance, StudentCohort):
        # The reverse direction (node.authorized_cohorts.add(...)) carries the
        # node as the instance and the cohort ids in pk_set.
        cohort_ids = list(pk_set or [])
        transaction.on_commit(
            lambda: _safely(
                lambda: [
                    project_cohort(cohort)
                    for cohort in StudentCohort.objects.filter(id__in=cohort_ids)
                ],
                stage="cohort-content-nodes-reverse",
            )
        )
        return
    cohort_id = instance.id
    transaction.on_commit(
        lambda: _safely(
            lambda: project_cohort(StudentCohort.objects.get(id=cohort_id)),
            stage="cohort-content-nodes",
        )
    )
