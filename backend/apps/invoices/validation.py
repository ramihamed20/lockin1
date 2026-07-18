def validate_invoice_totals(
    *, subtotal_minor: int, discount_minor: int, tax_minor: int, total_minor: int
) -> None:
    if min(subtotal_minor, discount_minor, tax_minor, total_minor) < 0:
        raise ValueError("Invoice amounts cannot be negative.")
    if total_minor <= 0:
        raise ValueError("Invoice total must be positive.")
    if subtotal_minor - discount_minor + tax_minor != total_minor:
        raise ValueError("Invoice components do not equal the total.")
