import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../api/client";
import { I18nProvider } from "../../i18n/I18nProvider";
import { AuditPage } from "./AuditPage";
import { ConfigurationPage } from "./ConfigurationPage";
import { ContentOperationsPage } from "./ContentOperationsPage";
import { OperationsLayout } from "./OperationsLayout";
import { OperationsOverviewPage } from "./OperationsOverviewPage";
import { ReportsPage } from "./ReportsPage";
import { SupportOperationsPage } from "./SupportOperationsPage";
import { UserOperationsPage } from "./UserOperationsPage";
import { Metric, MetricStrip, StatusList } from "./components";
import { formatDateTime } from "./format";
import { useOperationalAccess } from "./useOperationalAccess";

const session = {
  roles: ["platform_administrator"],
  capabilities: [
    "overview.view", "content.view", "content.manage", "assessments.manage", "users.view",
    "users.manage", "operational_actions.execute", "operational_roles.manage", "audit.view",
    "reports.export", "configuration.view", "configuration.manage", "system_health.view"
  ],
  dashboards: ["overview", "content", "support"],
  timezone: "UTC"
} as const;

const api = vi.hoisted(() => ({
  operationsApi: {
    session: vi.fn(), overview: vi.fn(), content: vi.fn(), support: vi.fn(), health: vi.fn(),
    users: vi.fn(), audit: vi.fn(), configuration: vi.fn(), updateConfiguration: vi.fn(),
    reports: vi.fn(), previewReport: vi.fn(), executeReport: vi.fn(), previewUserStatus: vi.fn(),
    executeAction: vi.fn(), updateRoles: vi.fn()
  }
}));

vi.mock("./api", () => api);
vi.mock("./useOperationsSession", () => ({ useOperationsSession: () => session }));

function renderPage(page: React.ReactNode) {
  return render(<MemoryRouter><I18nProvider>{page}</I18nProvider></MemoryRouter>);
}

describe("operations workspace", () => {
  beforeEach(() => {
    localStorage.setItem("lockin.locale", "en");
    vi.clearAllMocks();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    api.operationsApi.session.mockResolvedValue(session);
    api.operationsApi.overview.mockResolvedValue({
      generated_at: "2026-07-18T12:00:00Z",
      period: { from: "2026-07-05", to: "2026-07-18", timezone: "UTC" },
      analytics_freshness: "2026-07-18T11:55:00Z",
      metrics: { daily_active_learners: 42, lesson_completions: 90, quiz_submissions: 31, focus_minutes: 840, subscriptions_started: 5 },
      subscriptions: { active: 20, trialing: 6 },
      queues: { moderation: 3, failed_payments: 2, failed_notifications: 1 },
      resources: [{ code: "users", label: "User management", path: "/operations/users" }]
    });
    api.operationsApi.health.mockResolvedValue({
      status: "ok", checked_at: "2026-07-18T12:00:00Z",
      components: [{ code: "database", status: "ok" }, { code: "metrics_provider", status: "not_configured" }]
    });
    api.operationsApi.content.mockResolvedValue({
      generated_at: "2026-07-18T12:00:00Z", education: { published: 8 }, learning_objects: { published: 12 },
      questions: { published: 40 }, quizzes: { draft: 2, published: 4 }, achievement_definitions: 9,
      quality: { open_question_reports: 3 }
    });
    api.operationsApi.support.mockResolvedValue({
      generated_at: "2026-07-18T12:00:00Z", accounts: { total: 100, suspended: 2, unverified: 4 },
      moderation: { open: 3 }, payments: { failed: 2 }, subscriptions: { active: 20 },
      notifications: { total: 80, failed_deliveries: 1 }, community: { discussions: 14, comments: 70 }
    });
  });

  it("loads the authorized shell and keeps dashboards separate", async () => {
    render(
      <MemoryRouter initialEntries={["/operations"]}>
        <I18nProvider>
          <Routes><Route path="operations" element={<OperationsLayout />}><Route index element={<div>Overview child</div>} /></Route></Routes>
        </I18nProvider>
      </MemoryRouter>
    );
    expect(await screen.findByRole("heading", { name: "Platform operations" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Platform operations" })).toBeInTheDocument();
    expect(screen.getByText("Overview child")).toBeInTheDocument();
  });

  it("offers a retry when the operational session is temporarily unavailable", async () => {
    api.operationsApi.session.mockRejectedValueOnce(new Error("offline"));
    render(
      <MemoryRouter initialEntries={["/operations"]}>
        <I18nProvider>
          <Routes><Route path="operations" element={<OperationsLayout />}><Route index element={<div>Recovered child</div>} /></Route></Routes>
        </I18nProvider>
      </MemoryRouter>
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Something interrupted");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Recovered child")).toBeInTheDocument();
  });

  it("redirects an authenticated user who lacks operational access", async () => {
    api.operationsApi.session.mockRejectedValueOnce(
      new ApiError(403, { error: { message: "Forbidden" } }),
    );
    render(
      <MemoryRouter initialEntries={["/operations"]}>
        <I18nProvider>
          <Routes>
            <Route path="/" element={<div>Learning home</div>} />
            <Route path="operations" element={<OperationsLayout />} />
          </Routes>
        </I18nProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText("Learning home")).toBeInTheDocument();
  });

  it("exposes operational access as a tri-state asynchronous capability", async () => {
    function AccessProbe() {
      const allowed = useOperationalAccess();
      return <span>{allowed === null ? "pending" : String(allowed)}</span>;
    }

    const allowed = renderPage(<AccessProbe />);
    expect(screen.getByText("pending")).toBeInTheDocument();
    expect(await screen.findByText("true")).toBeInTheDocument();
    allowed.unmount();

    api.operationsApi.session.mockRejectedValueOnce(new Error("offline"));
    renderPage(<AccessProbe />);
    expect(await screen.findByText("false")).toBeInTheDocument();
  });

  it("renders projected learning signals and redacted provider health", async () => {
    renderPage(<OperationsOverviewPage />);
    expect(await screen.findByRole("heading", { name: "Learning activity" })).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("not configured")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open workspace" })).toHaveAttribute("href", "/operations/users");
  });

  it("retries the overview without restarting the operations workspace", async () => {
    api.operationsApi.overview.mockRejectedValueOnce(new Error("offline"));
    renderPage(<OperationsOverviewPage />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Learning activity" })).toBeInTheDocument();
  });

  it("renders purpose-specific content and support dashboards", async () => {
    const { unmount } = renderPage(<ContentOperationsPage />);
    expect(await screen.findByRole("heading", { name: "Content inventory" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage content" })).toBeInTheDocument();
    unmount();
    renderPage(<SupportOperationsPage />);
    expect(await screen.findByRole("heading", { name: "Account signals" })).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("lets content and support operators retry independent dashboard failures", async () => {
    api.operationsApi.content.mockRejectedValueOnce(new Error("offline"));
    const content = renderPage(<ContentOperationsPage />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Content inventory" })).toBeInTheDocument();
    content.unmount();

    api.operationsApi.support.mockRejectedValueOnce(new Error("offline"));
    renderPage(<SupportOperationsPage />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Account signals" })).toBeInTheDocument();
  });

  it("previews and confirms an auditable account action inline", async () => {
    const user = {
      id: "11111111-1111-4111-8111-111111111111", email: "student@example.com", full_name: "Student Name",
      status: "active", email_verified: true, product_roles: ["student"], operational_roles: [], date_joined: "2026-07-01T00:00:00Z"
    };
    api.operationsApi.users.mockResolvedValue({ count: 1, results: [user] });
    api.operationsApi.previewUserStatus.mockResolvedValue({
      id: "run-1", action_code: "users.set_status", reason: "Safety investigation", status: "previewed",
      preview: { target_count: 1, changes: [{ user_id: user.id, full_name: user.full_name, from_status: "active", to_status: "suspended", will_change: true }] },
      confirmation_token: "token"
    });
    api.operationsApi.executeAction.mockResolvedValue({ status: "completed", result_summary: { requested: 1, succeeded: 1, failed: 0, failures: [] } });
    renderPage(<UserOperationsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Student Name/ }));
    fireEvent.change(screen.getByLabelText(/Reason for this action/), { target: { value: "Safety investigation" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview action" }));
    expect(await screen.findByRole("heading", { name: "Review before applying" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm action" }));
    await waitFor(() => expect(api.operationsApi.executeAction).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("The operational action completed.")).toBeInTheDocument();
  });

  it("searches users server-side and saves least-privilege operational roles", async () => {
    const user = {
      id: "11111111-1111-4111-8111-111111111111", email: "operator@example.com", full_name: "New Operator",
      status: "active", email_verified: false, product_roles: ["student"], operational_roles: [], date_joined: "2026-07-01T00:00:00Z"
    };
    api.operationsApi.users.mockResolvedValue({ count: 1, results: [user] });
    api.operationsApi.updateRoles.mockResolvedValue({ roles: ["support"] });
    renderPage(<UserOperationsPage />);
    fireEvent.change(await screen.findByLabelText("Search users"), { target: { value: "New" } });
    await waitFor(() => expect(api.operationsApi.users).toHaveBeenLastCalledWith("New", expect.any(AbortSignal)));
    fireEvent.click(await screen.findByRole("button", { name: /New Operator/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Support" }));
    fireEvent.change(screen.getByLabelText("Reason for role change"), { target: { value: "Cover support queue" } });
    fireEvent.click(screen.getByRole("button", { name: "Save operational roles" }));
    await waitFor(() => expect(api.operationsApi.updateRoles).toHaveBeenCalledWith(user.id, ["support"], "Cover support queue"));
    expect(await screen.findByText("Roles updated.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close details" }));
    expect(
      screen.queryByRole("button", { name: "Close details" }),
    ).not.toBeInTheDocument();
  });

  it("keeps a failed action preview editable", async () => {
    const user = {
      id: "11111111-1111-4111-8111-111111111111", email: "student@example.com", full_name: "Student Name",
      status: "active", email_verified: true, product_roles: ["student"], operational_roles: [], date_joined: "2026-07-01T00:00:00Z"
    };
    api.operationsApi.users.mockResolvedValue({ count: 1, results: [user] });
    api.operationsApi.previewUserStatus.mockRejectedValueOnce(new Error("offline"));
    renderPage(<UserOperationsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Student Name/ }));
    fireEvent.change(screen.getByLabelText(/Reason for this action/), { target: { value: "Safety investigation" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview action" }));
    expect(await screen.findByText("Something interrupted that request. Please try again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview action" })).toBeEnabled();
  });

  it("recovers an unavailable user directory and renders its empty state", async () => {
    api.operationsApi.users
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ count: 0, results: [] });
    renderPage(<UserOperationsPage />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "No users match this search." })).toBeInTheDocument();
  });

  it("keeps an action preview available when execution is rejected", async () => {
    const user = {
      id: "11111111-1111-4111-8111-111111111111", email: "student@example.com", full_name: "Student Name",
      status: "active", email_verified: true, product_roles: ["student"], operational_roles: [], date_joined: "2026-07-01T00:00:00Z"
    };
    api.operationsApi.users.mockResolvedValue({ count: 1, results: [user] });
    api.operationsApi.previewUserStatus.mockResolvedValue({
      id: "run-2", action_code: "users.set_status", reason: "Safety investigation", status: "previewed",
      preview: { target_count: 1, changes: [{ user_id: user.id, full_name: user.full_name, from_status: "active", to_status: "suspended", will_change: true }] },
      confirmation_token: "token"
    });
    api.operationsApi.executeAction.mockRejectedValueOnce(
      new ApiError(409, { error: { message: "The account state changed." } }),
    );
    renderPage(<UserOperationsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Student Name/ }));
    fireEvent.change(screen.getByLabelText(/Reason for this action/), { target: { value: "Safety investigation" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview action" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm action" }));
    expect(await screen.findByText("The account state changed.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel preview" }));
    expect(screen.queryByRole("button", { name: "Confirm action" })).not.toBeInTheDocument();
  });

  it("shows immutable audit state without interpreting it as markup", async () => {
    api.operationsApi.audit.mockResolvedValue({ count: 1, results: [{
      id: "audit-1", actor_id: "admin-1", actor_name: "Admin", action: "users.status.changed",
      domain: "operational_actions", target_type: "accounts.user", target_id: "user-1", reason: "Safety review",
      source: "operations.api", previous_state: { status: "active" }, new_state: { status: "suspended" },
      occurred_at: "2026-07-18T12:00:00Z"
    }] });
    renderPage(<AuditPage />);
    expect(await screen.findByText("users.status.changed")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Previous state / New state"));
    expect(screen.getByText(/"suspended"/)).toBeInTheDocument();
  });

  it("filters audit history and retries a failed filter request", async () => {
    api.operationsApi.audit.mockResolvedValue({ count: 0, results: [] });
    renderPage(<AuditPage />);
    expect(await screen.findByRole("heading", { name: "No audit records match this filter." })).toBeInTheDocument();
    api.operationsApi.audit.mockRejectedValueOnce(new Error("offline"));
    fireEvent.change(screen.getByLabelText("Filter by domain"), { target: { value: "reporting" } });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(api.operationsApi.audit).toHaveBeenLastCalledWith("reporting", expect.any(AbortSignal)));
  });

  it("previews bounded reports before downloading", async () => {
    api.operationsApi.reports.mockResolvedValue({ results: [{ code: "analytics_daily", name: "Daily learning analytics", description: "Projected facts", schedule_ready: true }] });
    api.operationsApi.previewReport.mockResolvedValue({ id: "report-1", report_code: "analytics_daily", status: "previewed", filters: {}, estimated_rows: 12, truncated: false, expires_at: "2026-07-18T12:15:00Z", confirmation_token: "token" });
    api.operationsApi.executeReport.mockResolvedValue({ blob: new Blob(["csv"]), filename: "report.csv" });
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:test") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    renderPage(<ReportsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Preview report" }));
    expect(await screen.findByRole("heading", { name: "Export preview" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Generate CSV" }));
    await waitFor(() => expect(api.operationsApi.executeReport).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("The report was generated and downloaded.")).toBeInTheDocument();
  });

  it("keeps report generation recoverable after a preview error", async () => {
    api.operationsApi.reports.mockResolvedValue({ results: [{ code: "analytics_daily", name: "Daily learning analytics", description: "Projected facts", schedule_ready: false }] });
    api.operationsApi.previewReport.mockRejectedValueOnce(new Error("offline"));
    api.operationsApi.previewReport.mockResolvedValueOnce({ id: "report-2", report_code: "analytics_daily", status: "previewed", filters: {}, estimated_rows: 5000, truncated: true, expires_at: "2026-07-18T12:15:00Z", confirmation_token: "token" });
    renderPage(<ReportsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Preview report" }));
    expect(await screen.findByText("Something interrupted that request. Please try again.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preview report" }));
    expect(await screen.findByText("The export will stop at the configured row limit.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel preview" }));
    expect(screen.queryByRole("heading", { name: "Export preview" })).not.toBeInTheDocument();
  });

  it("retries an unavailable report catalog and shows the bounded empty state", async () => {
    api.operationsApi.reports
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ results: [] });
    renderPage(<ReportsPage />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "No operational data is available yet." })).toBeInTheDocument();
  });

  it("keeps a report preview when CSV generation is rejected", async () => {
    api.operationsApi.reports.mockResolvedValue({ results: [{ code: "analytics_daily", name: "Daily learning analytics", description: "Projected facts", schedule_ready: false }] });
    api.operationsApi.previewReport.mockResolvedValue({ id: "report-3", report_code: "analytics_daily", status: "previewed", filters: {}, estimated_rows: 12, truncated: false, expires_at: "2026-07-18T12:15:00Z", confirmation_token: "token" });
    api.operationsApi.executeReport.mockRejectedValueOnce(
      new ApiError(409, { error: { message: "This preview expired." } }),
    );
    renderPage(<ReportsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Preview report" }));
    fireEvent.click(await screen.findByRole("button", { name: "Generate CSV" }));
    expect(await screen.findByText("This preview expired.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Export preview" })).toBeInTheDocument();
  });

  it("updates configuration with an expected version and reason", async () => {
    const entry = { key: "analytics.default_window_days", name: "Default analytics window", description: "UTC days", value_type: "integer", value: 14, version: 1, minimum: 1, maximum: 90, updated_at: null };
    api.operationsApi.configuration.mockResolvedValue({ results: [entry] });
    api.operationsApi.updateConfiguration.mockResolvedValue({ ...entry, value: 21, version: 2 });
    renderPage(<ConfigurationPage />);
    fireEvent.change(await screen.findByLabelText("Default analytics window"), { target: { value: "21" } });
    fireEvent.change(screen.getByLabelText("Reason for configuration change"), { target: { value: "Use three week view" } });
    fireEvent.click(screen.getByRole("button", { name: "Save setting" }));
    await waitFor(() => expect(api.operationsApi.updateConfiguration).toHaveBeenCalledWith(entry, 21, "Use three week view"));
    expect(await screen.findByText("Configuration updated.")).toBeInTheDocument();
  });

  it("shows configuration update errors without losing the current version", async () => {
    const entry = { key: "reporting.max_export_rows", name: "Maximum export rows", description: "Bounded rows", value_type: "integer", value: 5000, version: 2, minimum: 100, maximum: 10000, updated_at: null };
    api.operationsApi.configuration.mockResolvedValue({ results: [entry] });
    api.operationsApi.updateConfiguration.mockRejectedValueOnce(
      new ApiError(409, { error: { message: "The setting was updated elsewhere." } }),
    );
    renderPage(<ConfigurationPage />);
    fireEvent.change(await screen.findByLabelText("Reason for configuration change"), { target: { value: "Adjust export volume" } });
    fireEvent.click(screen.getByRole("button", { name: "Save setting" }));
    expect(await screen.findByText("The setting was updated elsewhere.")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("retries an unavailable configuration catalog", async () => {
    api.operationsApi.configuration
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ results: [] });
    renderPage(<ConfigurationPage />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "No operational data is available yet." })).toBeInTheDocument();
  });

  it("covers empty status and optional metric/date details", () => {
    renderPage(<><MetricStrip><Metric label="With detail" value={3} detail="UTC" /></MetricStrip><StatusList values={{}} /><span>{formatDateTime(null, "en")}</span></>);
    expect(screen.getByText("UTC")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No operational data is available yet." })).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
