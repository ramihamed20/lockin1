from django.db import migrations


def backfill_assessment_mistakes(apps, schema_editor):
    ReviewItem = apps.get_model("review", "ReviewItem")
    MistakeEvent = apps.get_model("review", "MistakeEvent")
    QuestionReviewLog = apps.get_model("progress", "QuestionReviewLog")
    AttemptQuestion = apps.get_model("assessments", "AttemptQuestion")
    AttemptAnswer = apps.get_model("assessments", "AttemptAnswer")
    EducationNode = apps.get_model("education", "EducationNode")

    node_cache = {}

    def subject_for(node_id):
        current_id = node_id
        visited = set()
        while current_id and current_id not in visited:
            visited.add(current_id)
            node = node_cache.get(current_id)
            if node is None:
                node = EducationNode.objects.filter(id=current_id).first()
                node_cache[current_id] = node
            if node is None or node.kind == "subject" or node.parent_id is None:
                return node
            current_id = node.parent_id
        return None

    mode_sources = {"quiz": "quiz", "practice": "practice", "mastery": "mix"}
    logs = QuestionReviewLog.objects.filter(was_correct=False).order_by("reviewed_at", "id")
    for log in logs.iterator(chunk_size=250):
        snapshot = (
            AttemptQuestion.objects.filter(id=log.attempt_question_id)
            .select_related("attempt__quiz_version", "question_version")
            .first()
        )
        if snapshot is None:
            continue
        version = snapshot.attempt.quiz_version
        subject = subject_for(snapshot.question_version.academic_node_id)
        subject_key = f"node:{subject.id}" if subject else "other:historical"
        subject_label = subject.title if subject else "Other"
        source_type = mode_sources.get(version.mode, "other")
        source_id = str(snapshot.attempt.quiz_id)
        source_label = version.title
        canonical_key = f"question:{log.question_id}"
        defaults = {
            "question_id": log.question_id,
            "last_question_version_id": log.question_version_id,
            "subject_id": subject.id if subject else None,
            "subject_key": subject_key,
            "subject_label_snapshot": subject_label,
            "source_type": source_type,
            "source_id": source_id,
            "source_label_snapshot": source_label,
            "source_question_index": snapshot.position,
            "prompt_snapshot": snapshot.prompt,
            "explanation_snapshot": snapshot.explanation,
            "options_snapshot": snapshot.option_snapshot,
            "correct_option_ids_snapshot": snapshot.correct_option_ids,
            "state": "active_review",
            "mastery_level": 0,
            "mistake_count": 0,
            "review_correct_count": 0,
            "review_incorrect_count": 0,
            "relearning_count": 0,
            "first_mistake_at": log.reviewed_at,
            "last_mistake_at": log.reviewed_at,
            "next_review_at": log.reviewed_at,
        }
        item, created = ReviewItem.objects.get_or_create(
            user_id=log.user_id,
            canonical_key=canonical_key,
            defaults=defaults,
        )
        item.question_id = log.question_id
        item.last_question_version_id = log.question_version_id
        item.subject_id = subject.id if subject else None
        item.subject_key = subject_key
        item.subject_label_snapshot = subject_label
        item.source_type = source_type
        item.source_id = source_id
        item.source_label_snapshot = source_label
        item.source_question_index = snapshot.position
        item.prompt_snapshot = snapshot.prompt
        item.explanation_snapshot = snapshot.explanation
        item.options_snapshot = snapshot.option_snapshot
        item.correct_option_ids_snapshot = snapshot.correct_option_ids
        item.state = "active_review"
        item.mastery_level = 0
        item.mistake_count = item.mistake_count + 1
        item.last_mistake_at = log.reviewed_at
        item.next_review_at = log.reviewed_at
        if created:
            item.first_mistake_at = log.reviewed_at
        item.save()

        answer = AttemptAnswer.objects.filter(attempt_question_id=snapshot.id).first()
        selected_ids = list(answer.selected_option_ids) if answer else []
        by_id = {
            str(option.get("id", "")): str(option.get("text", ""))
            for option in snapshot.option_snapshot
        }
        selected_text = [by_id[value] for value in selected_ids if value in by_id]
        correct_text = [
            by_id[value] for value in snapshot.correct_option_ids if value in by_id
        ]
        MistakeEvent.objects.get_or_create(
            user_id=log.user_id,
            event_key=f"assessment-result:{log.result_id}:question:{log.question_id}",
            defaults={
                "review_item_id": item.id,
                "source_type": source_type,
                "source_id": source_id,
                "source_label_snapshot": source_label,
                "source_question_index": snapshot.position,
                "prompt_snapshot": snapshot.prompt,
                "selected_answer_snapshot": selected_text or ["No answer"],
                "correct_answer_snapshot": correct_text or ["Answer unavailable"],
                "answered_at": log.reviewed_at,
            },
        )


class Migration(migrations.Migration):
    dependencies = [
        ("assessments", "0002_alter_questionissuereport_category"),
        ("progress", "0002_questionreview_questionreviewlog"),
        ("review", "0001_initial"),
    ]

    operations = [migrations.RunPython(backfill_assessment_mistakes, migrations.RunPython.noop)]
