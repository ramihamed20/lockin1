import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n/I18nProvider";
import { PeoplePage } from "./PeoplePage";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("../../api/client", () => ({ apiRequest }));

const user = { id: "u1", email: "student@example.com", full_name: "Student Name", preferred_language: "en", status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-07-15T00:00:00Z" };

describe("role administration", () => {
  beforeEach(() => { localStorage.setItem("lockin.locale", "en"); apiRequest.mockReset(); });

  it("loads real users and assigns additive managed roles", async () => {
    apiRequest.mockImplementation((path: string) => path === "/admin/users" ? Promise.resolve({ count: 1, results: [user] }) : Promise.resolve({ roles: ["student", "creator"] }));
    render(<I18nProvider><PeoplePage /></I18nProvider>);
    const person = (await screen.findByText("Student Name")).closest("li") as HTMLLIElement;
    fireEvent.click(within(person).getByLabelText("Creator"));
    fireEvent.click(within(person).getByRole("button", { name: "Update roles" }));

    expect(await within(person).findByText("Roles updated.")).toBeVisible();
    expect(apiRequest).toHaveBeenLastCalledWith("/admin/users/u1/roles", { method: "PATCH", body: { roles: ["creator"] } });
  });

  it("offers retry after a loading failure", async () => {
    apiRequest.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ count: 0, results: [] });
    render(<I18nProvider><PeoplePage /></I18nProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "No accounts are available yet." })).toBeVisible());
  });
});
