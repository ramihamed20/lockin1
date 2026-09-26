from rest_framework.exceptions import PermissionDenied
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User

from .serializers import MyGroupPreferenceWriteSerializer
from .services import PracticalChoice, my_group_payload, preference_for, save_preferences


def _user(request: Request) -> User:
    if not isinstance(request.user, User):
        raise PermissionDenied()
    return request.user


class MyGroupView(APIView):
    """The signed-in student's own group choice and resolved weekly timetable."""

    def get(self, request: Request) -> Response:
        return Response(my_group_payload(preference_for(_user(request))))

    def put(self, request: Request) -> Response:
        user = _user(request)
        serializer = MyGroupPreferenceWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        save_preferences(
            user=user,
            theory_group=data["theory_group"],
            default_practical_group=data["default_practical_group"],
            overrides={
                subject: PracticalChoice(choice["schedule_set"], choice["practical_group"])
                for subject, choice in data["practical_overrides"].items()
            },
        )
        return Response(my_group_payload(preference_for(user)))
