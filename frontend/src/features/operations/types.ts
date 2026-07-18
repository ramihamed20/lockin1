export type OperationsSession = {
  roles: string[];
  capabilities: string[];
  dashboards: Array<"overview" | "content" | "support">;
  timezone: "UTC";
};

export type OperationalResource = {
  code: string;
  label: string;
  path: string;
};

export type OverviewDashboard = {
  generated_at: string;
  period: { from: string; to: string; timezone: "UTC" };
  analytics_freshness: string | null;
  metrics: Record<string, number>;
  subscriptions: Record<string, number>;
  queues: { moderation: number; failed_payments: number; failed_notifications: number };
  resources: OperationalResource[];
};

export type ContentDashboard = {
  generated_at: string;
  education: Record<string, number>;
  learning_objects: Record<string, number>;
  questions: Record<string, number>;
  quizzes: Record<string, number>;
  achievement_definitions: number;
  quality: { open_question_reports: number };
};

export type SupportDashboard = {
  generated_at: string;
  accounts: { total: number; suspended: number; unverified: number };
  moderation: Record<string, number>;
  payments: Record<string, number>;
  subscriptions: Record<string, number>;
  notifications: { total: number; failed_deliveries: number };
  community: { discussions: number; comments: number };
};

export type HealthComponent = {
  code: string;
  status: string;
  freshness?: string | null;
};

export type SystemHealth = {
  status: "ok" | "degraded";
  checked_at: string;
  components: HealthComponent[];
};

export type OperationalUser = {
  id: string;
  email: string;
  full_name: string;
  status: "active" | "suspended" | "deleted";
  email_verified: boolean;
  product_roles: string[];
  operational_roles: string[];
  date_joined: string;
};

export type Paginated<T> = {
  count: number;
  next?: string | null;
  previous?: string | null;
  results: T[];
};

export type AuditRecord = {
  id: string;
  actor_id: string | null;
  actor_name: string;
  action: string;
  domain: string;
  target_type: string;
  target_id: string;
  reason: string;
  source: string;
  previous_state: Record<string, unknown>;
  new_state: Record<string, unknown>;
  occurred_at: string;
};

export type ConfigurationEntry = {
  key: string;
  name: string;
  description: string;
  value_type: "integer" | "boolean" | "string";
  value: string | number | boolean;
  version: number;
  minimum: number | null;
  maximum: number | null;
  updated_at: string | null;
};

export type ReportDefinition = {
  code: string;
  name: string;
  description: string;
  schedule_ready: boolean;
};

export type ReportPreview = {
  id: string;
  report_code: string;
  status: "previewed";
  filters: Record<string, unknown>;
  estimated_rows: number;
  truncated: boolean;
  expires_at: string;
  confirmation_token: string;
};

export type ActionPreview = {
  id: string;
  action_code: "users.set_status";
  reason: string;
  status: "previewed";
  preview: {
    target_count: number;
    changes: Array<{
      user_id: string;
      full_name: string;
      from_status: string;
      to_status: string;
      will_change: boolean;
    }>;
  };
  confirmation_token: string;
};

export type ActionResult = Omit<ActionPreview, "confirmation_token"> & {
  status: "completed" | "partial" | "failed";
  result_summary: {
    requested: number;
    succeeded: number;
    failed: number;
    failures: Array<{ user_id: string; error: string }>;
  };
};
