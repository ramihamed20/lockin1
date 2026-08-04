from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any, cast
from uuid import UUID

from django.db import transaction
from rest_framework import status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.administration.catalog import Capability
from apps.administration.permissions import HasOperationalCapability, has_operational_capability
from apps.administration.services import OperationalRoleError, replace_operational_capabilities
from apps.entitlements.models import EntitlementGrant
from apps.payments.models import Payment
from apps.product_catalog.models import Plan, Product
from apps.provider_integrations.services import create_refund_request
from apps.refunds.services import request_refund
from apps.subscriptions.models import Subscription
from platform_core.api.exceptions import RequestRejected
from platform_core.api.pagination import LockinPagination

from .models import AdminInternalNote, NotificationCampaign, PaymentStatusCorrection
from .selectors import (
    admin_purchases,
    admin_subscriptions,
    campaigns,
    operational_analytics,
    serialize_purchase,
    serialize_subscription,
    serialize_user_detail,
)
from .serializers import (
    AddNoteSerializer,
    AdminRefundSerializer,
    AdminInternalNoteSerializer,
    CampaignDispatchSerializer,
    EntitlementOverrideSerializer,
    EntitlementRevokeSerializer,
    NotificationCampaignCreateSerializer,
    NotificationCampaignSerializer,
    OperationalCapabilityUpdateSerializer,
    PlanActionSerializer,
    PlanVersionCreateSerializer,
    PaymentCorrectionRequestSerializer,
    PaymentCorrectionReviewSerializer,
    PaymentStatusCorrectionSerializer,
    SubscriptionActionSerializer,
    SubscriptionAdminEventSerializer,
    UserActionSerializer,
)
from .services import (
    AdminControlError,
    add_internal_note,
    change_user_status,
    change_plan_lifecycle,
    create_admin_plan_version,
    create_notification_campaign,
    dispatch_notification_campaign,
    entitlement_inspection,
    force_user_logout,
    grant_access_override,
    manage_subscription,
    revoke_access_override,
    request_payment_status_correction,
    review_payment_status_correction,
    set_product_roles,
    set_user_verification,
    serialize_plan,
    trigger_password_reset,
)


def _user(request: Request) -> User:
    return cast(User, request.user)


def _request_context(request: Request) -> tuple[UUID | None, str]:
    raw_request_id = request.META.get("LOCKIN_REQUEST_ID")
    try:
        correlation_id = UUID(str(raw_request_id)) if raw_request_id else None
    except ValueError:
        correlation_id = None
    return correlation_id, str(request.META.get("REMOTE_ADDR", ""))[:64]


def _idempotency_key(request: Request) -> str:
    return request.headers.get("Idempotency-Key", "")[:180]


def _raise(error: Exception, *, code: str) -> None:
    raise RequestRejected(str(error), code=code) from error


_NOTE_CAPABILITIES = {
    "accounts.user": (Capability.USERS_VIEW, Capability.USERS_MANAGE),
    "payments.payment": (Capability.PAYMENTS_VIEW, Capability.PAYMENTS_MANAGE),
    "subscriptions.subscription": (Capability.SUBSCRIPTIONS_VIEW, Capability.SUBSCRIPTIONS_MANAGE),
    "product_catalog.plan": (Capability.SUBSCRIPTIONS_VIEW, Capability.SUBSCRIPTIONS_MANAGE),
    "education.content": (Capability.CONTENT_VIEW, Capability.CONTENT_MANAGE),
}


def _note_capabilities(target_type: str) -> tuple[str, str]:
    try:
        return _NOTE_CAPABILITIES[target_type]
    except KeyError as error:
        raise RequestRejected("This target type does not support administrative notes.", code="invalid_note_target") from error


class AdminPurchaseListView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.PAYMENTS_VIEW

    def get(self, request: Request) -> Response:
        status_filter = request.query_params.get("status", "")[:24]
        if status_filter and status_filter not in Payment.Status.values:
            raise RequestRejected("The payment status filter is invalid.", code="invalid_payment_status")
        records = admin_purchases(
            query=request.query_params.get("q", "")[:100], status=status_filter
        )
        paginator = LockinPagination()
        page = paginator.paginate_queryset(records, request, view=self)
        return paginator.get_paginated_response([serialize_purchase(item) for item in (page or [])])


class AdminPurchaseDetailView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.PAYMENTS_VIEW

    def get(self, request: Request, payment_id: UUID) -> Response:
        try:
            payment = admin_purchases().get(id=payment_id)
        except Payment.DoesNotExist as error:
            raise NotFound("Purchase not found.") from error
        data = serialize_purchase(payment, detailed=True)
        data["notes"] = AdminInternalNoteSerializer(data["notes"], many=True).data
        data["status_corrections"] = PaymentStatusCorrectionSerializer(
            data["status_corrections"], many=True
        ).data
        return Response(data)


class AdminPurchaseRefundView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.PAYMENTS_MANAGE

    def post(self, request: Request, payment_id: UUID) -> Response:
        serializer = AdminRefundSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        amount = int(serializer.validated_data["amount_minor"])
        reason = str(serializer.validated_data["reason"])
        key = _idempotency_key(request)
        if len(key) < 12:
            raise ValidationError({"idempotency_key": ["A stable idempotency key is required."]})
        actor = _user(request)
        correlation_id, ip_address = _request_context(request)
        try:
            with transaction.atomic():
                refund, created = request_refund(
                    payment_id=payment_id,
                    actor=actor,
                    amount_minor=amount,
                    reason=reason.strip(),
                    idempotency_key=key,
                )
                if created:
                    create_refund_request(refund=refund)
                    from apps.audit.services import record_audit

                    record_audit(
                        actor=actor,
                        action="administration.purchase.refund_requested",
                        domain="payments",
                        target_type="payments.payment",
                        target_id=str(payment_id),
                        reason=reason.strip(),
                        source="admin_control.api",
                        correlation_id=correlation_id,
                        ip_address=ip_address,
                        new_state={"refund_id": str(refund.id), "amount_minor": amount, "created": True},
                    )
        except (Payment.DoesNotExist, ValueError) as error:
            _raise(error, code="refund_request_rejected")
        return Response(
            {
                "id": refund.id,
                "payment_id": refund.payment_id,
                "amount_minor": refund.amount_minor,
                "currency": refund.currency,
                "status": refund.status,
                "reason": refund.reason,
            },
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class AdminPurchaseCorrectionRequestView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.PAYMENTS_MANAGE

    def post(self, request: Request, payment_id: UUID) -> Response:
        serializer = PaymentCorrectionRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        correlation_id, ip_address = _request_context(request)
        try:
            correction = request_payment_status_correction(
                payment_id=payment_id,
                requested_status=str(serializer.validated_data["requested_status"]),
                provider_reference=str(serializer.validated_data["provider_reference"]),
                actor=_user(request),
                reason=str(serializer.validated_data["reason"]),
                idempotency_key=_idempotency_key(request),
                source="admin_control.api",
                correlation_id=correlation_id,
                ip_address=ip_address,
            )
        except (Payment.DoesNotExist, AdminControlError, ValueError) as error:
            _raise(error, code="payment_correction_request_rejected")
        return Response(PaymentStatusCorrectionSerializer(correction).data, status=status.HTTP_201_CREATED)


class AdminPurchaseCorrectionReviewView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.PAYMENTS_MANAGE

    def post(self, request: Request, correction_id: UUID) -> Response:
        serializer = PaymentCorrectionReviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        correlation_id, ip_address = _request_context(request)
        try:
            correction = review_payment_status_correction(
                correction_id=correction_id,
                decision=str(serializer.validated_data["decision"]),
                actor=_user(request),
                reason=str(serializer.validated_data["reason"]),
                idempotency_key=_idempotency_key(request),
                source="admin_control.api",
                correlation_id=correlation_id,
                ip_address=ip_address,
            )
        except (PaymentStatusCorrection.DoesNotExist, AdminControlError, ValueError) as error:
            _raise(error, code="payment_correction_review_rejected")
        return Response(PaymentStatusCorrectionSerializer(correction).data)


class AdminSubscriptionListView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.SUBSCRIPTIONS_VIEW

    def get(self, request: Request) -> Response:
        status_filter = request.query_params.get("status", "")[:16]
        missing_only = request.query_params.get("without_subscription") == "true"
        if status_filter and status_filter not in Subscription.Status.values:
            raise RequestRejected("The subscription status filter is invalid.", code="invalid_subscription_status")
        records = admin_subscriptions(
            query=request.query_params.get("q", "")[:100],
            status=status_filter,
            missing_only=missing_only,
        )
        paginator = LockinPagination()
        page = paginator.paginate_queryset(records, request, view=self)
        if missing_only:
            return paginator.get_paginated_response(
                [
                    {"user": {"id": item.id, "email": item.email, "full_name": item.full_name}, "subscription": None}
                    for item in (page or [])
                ]
            )
        return paginator.get_paginated_response([serialize_subscription(item) for item in (page or [])])


class AdminSubscriptionDetailView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.SUBSCRIPTIONS_VIEW

    def get(self, request: Request, subscription_id: UUID) -> Response:
        try:
            subscription = admin_subscriptions().get(id=subscription_id)
        except Subscription.DoesNotExist as error:
            raise NotFound("Subscription not found.") from error
        data = serialize_subscription(subscription, detailed=True)
        data["admin_events"] = SubscriptionAdminEventSerializer(data["admin_events"], many=True).data
        data["notes"] = AdminInternalNoteSerializer(data["notes"], many=True).data
        return Response(data)


class AdminSubscriptionActionView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.SUBSCRIPTIONS_MANAGE

    def post(self, request: Request, subscription_id: UUID) -> Response:
        serializer = SubscriptionActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = cast(dict[str, Any], serializer.validated_data)
        correlation_id, ip_address = _request_context(request)
        try:
            subscription = manage_subscription(
                subscription_id=subscription_id,
                action=str(data["action"]),
                actor=_user(request),
                reason=str(data["reason"]),
                idempotency_key=_idempotency_key(request),
                note=str(data.get("note", "")),
                period_ends_at=data.get("period_ends_at"),
                plan_version_id=data.get("plan_version_id"),
                source="admin_control.api",
                correlation_id=correlation_id,
                ip_address=ip_address,
            )
        except (Subscription.DoesNotExist, AdminControlError, ValueError) as error:
            _raise(error, code="subscription_action_rejected")
        result = serialize_subscription(subscription, detailed=True)
        result["admin_events"] = SubscriptionAdminEventSerializer(
            result["admin_events"], many=True
        ).data
        result["notes"] = AdminInternalNoteSerializer(result["notes"], many=True).data
        return Response(result)


class AdminUserDetailView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.USERS_VIEW

    def get(self, request: Request, user_id: UUID) -> Response:
        try:
            target = User.objects.prefetch_related("groups", "operational_role_assignments__role").get(id=user_id)
        except User.DoesNotExist as error:
            raise NotFound("User not found.") from error
        data = serialize_user_detail(target)
        data["notes"] = AdminInternalNoteSerializer(data["notes"], many=True).data
        return Response(data)


class AdminUserActionView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.USERS_MANAGE

    def post(self, request: Request, user_id: UUID) -> Response:
        serializer = UserActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = cast(dict[str, Any], serializer.validated_data)
        try:
            target = User.objects.get(id=user_id)
        except User.DoesNotExist as error:
            raise NotFound("User not found.") from error
        action = str(data["action"])
        actor = _user(request)
        correlation_id, ip_address = _request_context(request)
        try:
            if action == "suspend":
                change_user_status(target=target, status=User.Status.SUSPENDED, actor=actor, reason=str(data["reason"]), source="admin_control.api", correlation_id=correlation_id, ip_address=ip_address)
            elif action == "reactivate":
                change_user_status(target=target, status=User.Status.ACTIVE, actor=actor, reason=str(data["reason"]), source="admin_control.api", correlation_id=correlation_id, ip_address=ip_address)
            elif action == "soft_delete":
                change_user_status(target=target, status=User.Status.DELETED, actor=actor, reason=str(data["reason"]), source="admin_control.api", correlation_id=correlation_id, ip_address=ip_address)
            elif action == "verify_email":
                set_user_verification(target=target, verified=True, actor=actor, reason=str(data["reason"]), source="admin_control.api", correlation_id=correlation_id, ip_address=ip_address)
            elif action == "unverify_email":
                set_user_verification(target=target, verified=False, actor=actor, reason=str(data["reason"]), source="admin_control.api", correlation_id=correlation_id, ip_address=ip_address)
            elif action == "logout_all":
                force_user_logout(target=target, actor=actor, reason=str(data["reason"]), source="admin_control.api", correlation_id=correlation_id, ip_address=ip_address)
            elif action == "logout_session":
                force_user_logout(target=target, actor=actor, session_id=data["session_id"], reason=str(data["reason"]), source="admin_control.api", correlation_id=correlation_id, ip_address=ip_address)
            elif action == "password_reset":
                trigger_password_reset(target=target, actor=actor, reason=str(data["reason"]), source="admin_control.api", correlation_id=correlation_id, ip_address=ip_address)
            elif action == "replace_product_roles":
                if not has_operational_capability(actor, Capability.ROLES_MANAGE):
                    raise PermissionDenied("The required operational permission is not assigned.")
                set_product_roles(target=target, role_codes=data["roles"], actor=actor, reason=str(data["reason"]), source="admin_control.api", correlation_id=correlation_id, ip_address=ip_address)
            else:
                raise AdminControlError("The requested user action is not supported.")
        except (AdminControlError, ValueError) as error:
            _raise(error, code="user_action_rejected")
        target.refresh_from_db()
        return Response({"id": target.id, "status": target.status, "email_verified": target.is_email_verified})


class AdminUserCapabilitiesView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.ROLES_MANAGE

    def get(self, request: Request, user_id: UUID) -> Response:
        try:
            target = User.objects.get(id=user_id)
        except User.DoesNotExist as error:
            raise NotFound("User not found.") from error
        from apps.administration.catalog import CAPABILITIES
        from apps.administration.models import OperationalCapabilityAssignment

        assignments = OperationalCapabilityAssignment.objects.filter(user=target).select_related("capability")
        return Response(
            {
                "catalog": [
                    {"code": item.code, "name": item.name, "description": item.description}
                    for item in CAPABILITIES
                ],
                "direct_capabilities": [
                    {"code": item.capability_id, "reason": item.reason, "created_at": item.created_at}
                    for item in assignments
                ],
            }
        )

    def patch(self, request: Request, user_id: UUID) -> Response:
        serializer = OperationalCapabilityUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            target = User.objects.get(id=user_id)
        except User.DoesNotExist as error:
            raise NotFound("User not found.") from error
        try:
            capabilities = replace_operational_capabilities(
                target=target,
                actor=_user(request),
                capability_codes=serializer.validated_data["capabilities"],
                reason=str(serializer.validated_data["reason"]),
                source="admin_control.api",
            )
        except OperationalRoleError as error:
            _raise(error, code="operational_capability_change_rejected")
        return Response({"capabilities": capabilities})


class AdminRoleCatalogView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.ROLES_MANAGE

    def get(self, request: Request) -> Response:
        from apps.accounts.roles import Role
        from apps.administration.catalog import ROLE_CAPABILITIES, ROLE_NAMES

        return Response(
            {
                "operational_roles": [
                    {
                        "code": code,
                        "name": ROLE_NAMES[code],
                        "capabilities": sorted(ROLE_CAPABILITIES[code]),
                    }
                    for code in sorted(ROLE_NAMES)
                ],
                "product_roles": [role.value for role in Role],
            }
        )


class AdminTargetNoteView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.OVERVIEW_VIEW

    def initial(self, request: Request, *args: Any, **kwargs: Any) -> None:
        self.required_capability = _note_capabilities(str(kwargs.get("target_type", "")))[0]
        super().initial(request, *args, **kwargs)

    def get(self, request: Request, target_type: str, target_id: str) -> Response:
        notes = AdminInternalNote.objects.filter(
            target_type=target_type[:80], target_id=target_id[:100]
        ).select_related("author")
        paginator = LockinPagination()
        page = paginator.paginate_queryset(notes, request, view=self)
        return paginator.get_paginated_response(AdminInternalNoteSerializer(page or [], many=True).data)

    def post(self, request: Request, target_type: str, target_id: str) -> Response:
        _, manage_capability = _note_capabilities(target_type)
        if not has_operational_capability(_user(request), manage_capability):
            raise PermissionDenied("The required operational permission is not assigned.")
        serializer = AddNoteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = cast(dict[str, Any], serializer.validated_data)
        correlation_id, ip_address = _request_context(request)
        try:
            note = add_internal_note(
                actor=_user(request),
                target_type=target_type,
                target_id=target_id,
                body=str(data["body"]),
                reason=str(data["reason"]),
                source="admin_control.api",
                correlation_id=correlation_id,
                ip_address=ip_address,
            )
        except AdminControlError as error:
            _raise(error, code="note_create_rejected")
        return Response(AdminInternalNoteSerializer(note).data, status=status.HTTP_201_CREATED)


class AdminEntitlementInspectionView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.SUBSCRIPTIONS_VIEW

    def get(self, request: Request, user_id: UUID) -> Response:
        try:
            user = User.objects.get(id=user_id)
        except User.DoesNotExist as error:
            raise NotFound("User not found.") from error
        from apps.entitlements.serializers import EntitlementGrantSerializer

        result = entitlement_inspection(user=user)
        return Response(
            {
                "user": {"id": user.id, "email": user.email, "full_name": user.full_name},
                "grants": EntitlementGrantSerializer(result["grants"], many=True).data,
                "effective_permissions": result["effective_permissions"],
            }
        )


class AdminEntitlementGrantView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.SUBSCRIPTIONS_MANAGE

    def post(self, request: Request, user_id: UUID) -> Response:
        serializer = EntitlementOverrideSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = cast(dict[str, Any], serializer.validated_data)
        try:
            user = User.objects.get(id=user_id)
        except User.DoesNotExist as error:
            raise NotFound("User not found.") from error
        correlation_id, ip_address = _request_context(request)
        try:
            grant = grant_access_override(
                user=user,
                entitlement_code=str(data["entitlement_code"]),
                starts_at=data.get("starts_at"),
                ends_at=data.get("ends_at"),
                actor=_user(request),
                reason=str(data["reason"]),
                source="admin_control.api",
                correlation_id=correlation_id,
                ip_address=ip_address,
            )
        except (AdminControlError, ValueError, EntitlementGrant.DoesNotExist) as error:
            _raise(error, code="entitlement_grant_rejected")
        from apps.entitlements.serializers import EntitlementGrantSerializer

        return Response(EntitlementGrantSerializer(grant).data, status=status.HTTP_201_CREATED)


class AdminEntitlementRevokeView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.SUBSCRIPTIONS_MANAGE

    def post(self, request: Request, grant_id: UUID) -> Response:
        serializer = EntitlementRevokeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        correlation_id, ip_address = _request_context(request)
        try:
            grant = revoke_access_override(
                grant_id=grant_id,
                actor=_user(request),
                reason=str(serializer.validated_data["reason"]),
                source="admin_control.api",
                correlation_id=correlation_id,
                ip_address=ip_address,
            )
        except (AdminControlError, ValueError, EntitlementGrant.DoesNotExist) as error:
            _raise(error, code="entitlement_revoke_rejected")
        from apps.entitlements.serializers import EntitlementGrantSerializer

        return Response(EntitlementGrantSerializer(grant).data)


class AdminAnalyticsDashboardView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.ANALYTICS_VIEW

    def get(self, request: Request) -> Response:
        try:
            today = datetime.now(UTC).date()
            start = datetime.strptime(request.query_params.get("from", ""), "%Y-%m-%d").date() if request.query_params.get("from") else today - timedelta(days=29)
            end = datetime.strptime(request.query_params.get("to", ""), "%Y-%m-%d").date() if request.query_params.get("to") else today
        except ValueError as error:
            _raise(error, code="analytics_period_invalid")
        if end < start or (end - start) > timedelta(days=366):
            raise RequestRejected("Analytics periods must cover between 1 and 367 days.", code="analytics_period_invalid")
        return Response(operational_analytics(start=start, end=end))


class AdminNotificationCampaignListView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.NOTIFICATIONS_VIEW

    def get(self, request: Request) -> Response:
        paginator = LockinPagination()
        page = paginator.paginate_queryset(campaigns(), request, view=self)
        return paginator.get_paginated_response(NotificationCampaignSerializer(page or [], many=True).data)

    def post(self, request: Request) -> Response:
        if not has_operational_capability(_user(request), Capability.NOTIFICATIONS_MANAGE):
            raise PermissionDenied("The required operational permission is not assigned.")
        serializer = NotificationCampaignCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = cast(dict[str, Any], serializer.validated_data)
        correlation_id, ip_address = _request_context(request)
        try:
            campaign = create_notification_campaign(
                actor=_user(request),
                audience=str(data["audience"]),
                audience_filter=cast(dict[str, object], data["audience_filter"]),
                title=str(data["title"]),
                body=str(data["body"]),
                send_in_app=bool(data["send_in_app"]),
                send_email=bool(data["send_email"]),
                scheduled_for=data.get("scheduled_for"),
                reason=str(data["reason"]),
                source="admin_control.api",
                correlation_id=correlation_id,
                ip_address=ip_address,
            )
        except AdminControlError as error:
            _raise(error, code="notification_campaign_rejected")
        return Response(NotificationCampaignSerializer(campaign).data, status=status.HTTP_201_CREATED)


class AdminNotificationCampaignDispatchView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.NOTIFICATIONS_MANAGE

    def post(self, request: Request, campaign_id: UUID) -> Response:
        serializer = CampaignDispatchSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        correlation_id, ip_address = _request_context(request)
        try:
            campaign = dispatch_notification_campaign(
                campaign_id=campaign_id,
                actor=_user(request),
                reason=str(serializer.validated_data["reason"]),
                source="admin_control.api",
                correlation_id=correlation_id,
                ip_address=ip_address,
            )
        except (AdminControlError, NotificationCampaign.DoesNotExist) as error:
            _raise(error, code="notification_campaign_dispatch_rejected")
        return Response(NotificationCampaignSerializer(campaign).data)


class AdminPlanListView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.SUBSCRIPTIONS_VIEW

    def get(self, request: Request) -> Response:
        plans = (
            Plan.objects.select_related("product", "current_version")
            .prefetch_related("versions__prices", "versions__entitlement_rules__entitlement")
            .all()
        )
        return Response(
            {
                "products": list(
                    Product.objects.values("id", "code", "title", "description", "status").order_by("code")
                ),
                "results": [serialize_plan(plan) for plan in plans],
            }
        )

    def post(self, request: Request) -> Response:
        if not has_operational_capability(_user(request), Capability.SUBSCRIPTIONS_MANAGE):
            raise PermissionDenied("The required operational permission is not assigned.")
        serializer = PlanVersionCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        correlation_id, ip_address = _request_context(request)
        try:
            plan = create_admin_plan_version(
                actor=_user(request),
                payload=cast(dict[str, Any], serializer.validated_data),
                source="admin_control.api",
                correlation_id=correlation_id,
                ip_address=ip_address,
            )
        except (AdminControlError, ValueError, Product.DoesNotExist) as error:
            _raise(error, code="plan_version_create_rejected")
        plan = (
            Plan.objects.select_related("product", "current_version")
            .prefetch_related("versions__prices", "versions__entitlement_rules__entitlement")
            .get(id=plan.id)
        )
        return Response(serialize_plan(plan), status=status.HTTP_201_CREATED)


class AdminPlanActionView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.SUBSCRIPTIONS_MANAGE

    def post(self, request: Request, plan_id: UUID) -> Response:
        serializer = PlanActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        correlation_id, ip_address = _request_context(request)
        try:
            plan = change_plan_lifecycle(
                plan_id=plan_id,
                action=str(serializer.validated_data["action"]),
                actor=_user(request),
                reason=str(serializer.validated_data["reason"]),
                source="admin_control.api",
                correlation_id=correlation_id,
                ip_address=ip_address,
            )
        except (AdminControlError, Plan.DoesNotExist, ValueError) as error:
            _raise(error, code="plan_lifecycle_rejected")
        plan = (
            Plan.objects.select_related("product", "current_version")
            .prefetch_related("versions__prices", "versions__entitlement_rules__entitlement")
            .get(id=plan.id)
        )
        return Response(serialize_plan(plan))
