from rest_framework import status
from rest_framework.exceptions import APIException, PermissionDenied
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User

from .serializers import MyGroupPreferenceWriteSerializer
from .services import MyGroupRuleError, PracticalChoice, my_group_payload, save_preferences


class MyGroupRejected(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "my_group_rejected"


def _user(request: Request) -> User:
    if not isinstance(request.user, User):
        raise PermissionDenied()
    return request.user


class MyGroupView(APIView):
    """The signed-in student's own group choice and resolved weekly timetable."""

    def get(self, request: Request) -> Response:
        return Response(my_group_payload(_user(request)))

    def put(self, request: Request) -> Response:
        user = _user(request)
        serializer = MyGroupPreferenceWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            save_preferences(
                user=user,
                theory_group=data["theory_group"],
                default_practical_group=data["default_practical_group"],
                overrides={
                    subject: PracticalChoice(choice["schedule_set"], choice["practical_group"])
                    for subject, choice in data["practical_overrides"].items()
                },
            )
        except MyGroupRuleError as error:
            raise MyGroupRejected(str(error)) from error
        return Response(my_group_payload(user))
