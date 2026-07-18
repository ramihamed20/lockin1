export type SubscriptionTransition = {
  id: string;
  from_status: string;
  to_status: string;
  source: string;
  reason_code: string;
  effective_at: string;
};

export type Subscription = {
  id: string;
  product_code: string;
  plan_code: string;
  plan_title: string;
  status: "pending" | "trialing" | "active" | "grace" | "expired" | "cancelled" | "suspended" | "refunded";
  trial_started_at: string | null;
  trial_ends_at: string | null;
  current_period_started_at: string | null;
  current_period_ends_at: string | null;
  grace_ends_at: string | null;
  cancel_at_period_end: boolean;
  cancellation_requested_at: string | null;
  ended_at: string | null;
  status_reason: string;
  revision: number;
  transitions: SubscriptionTransition[];
};

export type Entitlement = {
  id: string;
  code: string;
  title: string;
  description: string;
  source_type: string;
  starts_at: string;
  ends_at: string | null;
  quantity_limit: number | null;
  configuration: Record<string, unknown>;
};

export type Price = {
  id: string;
  code: string;
  amount_minor: number;
  currency: string;
  currency_exponent: number;
  region_code: string;
  interval: "day" | "month" | "year";
  interval_count: number;
  tax_behavior: "unspecified" | "inclusive" | "exclusive";
  valid_until: string | null;
};

export type Plan = {
  id: string;
  code: string;
  current_version: {
    id: string;
    version: number;
    title: string;
    description: string;
    audience: string;
    trial_days: number;
    grace_days: number;
    prices: Price[];
  };
};

export type Product = {
  id: string;
  code: string;
  title: string;
  description: string;
  plans: Plan[];
};

export type Payment = {
  id: string;
  subscription_id: string;
  amount_minor: number;
  currency: string;
  currency_exponent: number;
  refunded_amount_minor: number;
  status: string;
  price_snapshot: Record<string, unknown>;
  failure_code: string;
  initiated_at: string;
  succeeded_at: string | null;
  failed_at: string | null;
  created_at: string;
};

export type InvoiceLine = {
  id: string;
  line_number: number;
  description: string;
  quantity: number;
  unit_amount_minor: number;
  amount_minor: number;
  product_code: string;
  plan_code: string;
  price_code: string;
};

export type Invoice = {
  id: string;
  number: string;
  subscription_id: string;
  payment_id: string;
  status: string;
  currency: string;
  currency_exponent: number;
  subtotal_minor: number;
  discount_minor: number;
  tax_minor: number;
  total_minor: number;
  amount_paid_minor: number;
  amount_refunded_minor: number;
  period_started_at: string | null;
  period_ends_at: string | null;
  issued_at: string;
  paid_at: string | null;
  lines: InvoiceLine[];
};

export type Refund = {
  id: string;
  payment_id: string;
  amount_minor: number;
  currency: string;
  currency_exponent: number;
  status: string;
  reason: string;
  failure_code: string;
  requested_at: string;
  succeeded_at: string | null;
  failed_at: string | null;
  revision: number;
};

export type Page<T> = {
  next: string | null;
  previous: string | null;
  results: T[];
};

export type BillingState = {
  subscription: Subscription | null;
  entitlements: Entitlement[];
  products: Product[];
  checkoutAvailable: boolean;
  payments: Payment[];
  invoices: Invoice[];
  refunds: Refund[];
};
