from apps.accounts.models import User

from .models import RankingDefinition, RankingEntry, RankingProfile, RankingSnapshot


def _display_name(*, viewer: User, entry: RankingEntry) -> str:
    if entry.user_id == viewer.id:
        return entry.user.full_name
    profile = getattr(entry.user, "ranking_profile", None)
    mode = profile.display_mode if profile else RankingProfile.DisplayMode.INITIALS
    if mode == RankingProfile.DisplayMode.FULL_NAME:
        return entry.user.full_name
    if mode == RankingProfile.DisplayMode.ANONYMOUS:
        return f"Learner {str(entry.user_id).replace('-', '')[-4:].upper()}"
    words = [word for word in entry.user.full_name.split() if word]
    return " ".join(f"{word[0].upper()}." for word in words[:3]) or "Learner"


def current_ranking(*, viewer: User, code: str = "learning_all_time") -> dict[str, object]:
    definition = RankingDefinition.objects.filter(code=code, is_active=True).first()
    if definition is None:
        return {"definition": None, "snapshot": None, "entries": [], "own_entry": None}
    snapshot = (
        RankingSnapshot.objects.filter(
            definition=definition, status=RankingSnapshot.Status.PUBLISHED
        )
        .order_by("-generated_at", "-id")
        .first()
    )
    if snapshot is None:
        return {
            "definition": {
                "code": definition.code,
                "title": definition.title_ar
                if viewer.preferred_language == "ar"
                else definition.title_en,
                "rules": definition.rules,
                "period": definition.period,
                "tie_strategy": definition.tie_strategy,
            },
            "snapshot": None,
            "entries": [],
            "own_entry": None,
        }
    queryset = RankingEntry.objects.filter(snapshot=snapshot).select_related(
        "user", "user__ranking_profile"
    )
    top_entries = list(queryset.order_by("position", "user_id")[:100])
    own = next((entry for entry in top_entries if entry.user_id == viewer.id), None)
    if own is None:
        own = queryset.filter(user=viewer).first()

    def serialize(entry: RankingEntry) -> dict[str, object]:
        return {
            "position": entry.position,
            "score": entry.score,
            "evidence_count": entry.evidence_count,
            "display_name": _display_name(viewer=viewer, entry=entry),
            "is_me": entry.user_id == viewer.id,
        }

    return {
        "definition": {
            "code": definition.code,
            "title": definition.title_ar
            if viewer.preferred_language == "ar"
            else definition.title_en,
            "rules": snapshot.rules_snapshot,
            "period": definition.period,
            "tie_strategy": definition.tie_strategy,
        },
        "snapshot": {
            "id": snapshot.id,
            "generated_at": snapshot.generated_at,
            "participant_count": snapshot.participant_count,
            "checksum": snapshot.checksum,
        },
        "entries": [serialize(entry) for entry in top_entries],
        "own_entry": serialize(own) if own else None,
    }
