from rest_framework import serializers

from .models import Invoice, InvoiceLine


class InvoiceLineSerializer(serializers.ModelSerializer[InvoiceLine]):
    class Meta:
        model = InvoiceLine
        fields = (
            "id",
            "line_number",
            "description",
            "quantity",
            "unit_amount_minor",
            "amount_minor",
            "product_code",
            "plan_code",
            "price_code",
        )


class InvoiceSerializer(serializers.ModelSerializer[Invoice]):
    lines = InvoiceLineSerializer(many=True, read_only=True)

    class Meta:
        model = Invoice
        fields = (
            "id",
            "number",
            "subscription_id",
            "payment_id",
            "status",
            "currency",
            "currency_exponent",
            "subtotal_minor",
            "discount_minor",
            "tax_minor",
            "total_minor",
            "amount_paid_minor",
            "amount_refunded_minor",
            "period_started_at",
            "period_ends_at",
            "issued_at",
            "paid_at",
            "lines",
        )
