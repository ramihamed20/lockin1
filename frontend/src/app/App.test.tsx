import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

const { getApiHealth } = vi.hoisted(() => ({ getApiHealth: vi.fn() }));

vi.mock("../api/client", () => ({ getApiHealth }));
vi.mock("../pwa/update", () => ({
  applyPwaUpdate: vi.fn(),
  usePwaStatus: () => ({ offlineReady: false, updateAvailable: false })
}));

describe("foundation app", () => {
  beforeEach(() => {
    getApiHealth.mockResolvedValue({ status: "ok", service: "lockin-api" });
  });

  it("renders a semantic Lock-in foundation and reports API availability", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { level: 1, name: /built for the hours/i })).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: /foundation status/i })).toBeVisible();
    expect(await screen.findByText("Available")).toBeVisible();
    expect(screen.getByText(/never stored in the shared pwa cache/i)).toBeVisible();
  });

  it("shows a recoverable unavailable state when the API cannot be reached", async () => {
    getApiHealth.mockRejectedValue(new Error("offline"));

    render(<App />);

    expect(await screen.findByText("Unavailable")).toBeVisible();
  });
});
