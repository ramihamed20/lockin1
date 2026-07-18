import { apiDownload, apiRequest } from "../../api/client";
import type {
  ActionPreview,
  ActionResult,
  AuditRecord,
  ConfigurationEntry,
  ContentDashboard,
  OperationalUser,
  OperationsSession,
  OverviewDashboard,
  Paginated,
  ReportDefinition,
  ReportPreview,
  SupportDashboard,
  SystemHealth
} from "./types";

export const operationsApi = {
  session: (signal?: AbortSignal) =>
    apiRequest<OperationsSession>("/operations/session", signal ? { signal } : {}),
  overview: (signal?: AbortSignal) =>
    apiRequest<OverviewDashboard>("/operations/dashboards/overview", signal ? { signal } : {}),
  content: (signal?: AbortSignal) =>
    apiRequest<ContentDashboard>("/operations/dashboards/content", signal ? { signal } : {}),
  support: (signal?: AbortSignal) =>
    apiRequest<SupportDashboard>("/operations/dashboards/support", signal ? { signal } : {}),
  health: (signal?: AbortSignal) =>
    apiRequest<SystemHealth>("/operations/system-health", signal ? { signal } : {}),
  users: (query = "", signal?: AbortSignal) =>
    apiRequest<Paginated<OperationalUser>>(
      `/operations/users${query ? `?q=${encodeURIComponent(query)}` : ""}`,
      signal ? { signal } : {}
    ),
  audit: (domain = "", signal?: AbortSignal) =>
    apiRequest<Paginated<AuditRecord>>(
      `/operations/audit${domain ? `?domain=${encodeURIComponent(domain)}` : ""}`,
      signal ? { signal } : {}
    ),
  configuration: (signal?: AbortSignal) =>
    apiRequest<{ results: ConfigurationEntry[] }>(
      "/operations/configuration",
      signal ? { signal } : {}
    ),
  updateConfiguration: (entry: ConfigurationEntry, value: string | number | boolean, reason: string) =>
    apiRequest<ConfigurationEntry>(`/operations/configuration/${encodeURIComponent(entry.key)}`, {
      method: "PATCH",
      body: { value, expected_version: entry.version, reason }
    }),
  reports: (signal?: AbortSignal) =>
    apiRequest<{ results: ReportDefinition[] }>("/operations/reports", signal ? { signal } : {}),
  previewReport: (reportCode: string, filters: Record<string, unknown> = {}) =>
    apiRequest<ReportPreview>("/operations/reports/previews", {
      method: "POST",
      body: { report_code: reportCode, filters }
    }),
  executeReport: (preview: ReportPreview) =>
    apiDownload(`/operations/reports/${preview.id}/execute`, {
      method: "POST",
      body: { confirmation_token: preview.confirmation_token }
    }),
  previewUserStatus: (userId: string, status: "active" | "suspended", reason: string) =>
    apiRequest<ActionPreview>("/operations/actions/previews", {
      method: "POST",
      body: {
        action_code: "users.set_status",
        payload: { user_ids: [userId], status },
        reason,
        idempotency_key: crypto.randomUUID()
      }
    }),
  executeAction: (preview: ActionPreview) =>
    apiRequest<ActionResult>(`/operations/actions/${preview.id}/execute`, {
      method: "POST",
      body: { confirmation_token: preview.confirmation_token }
    }),
  updateRoles: (userId: string, roles: string[], reason: string) =>
    apiRequest<{ roles: string[] }>(`/operations/users/${userId}/roles`, {
      method: "PATCH",
      body: { roles, reason }
    })
};
