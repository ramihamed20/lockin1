import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useIntegritySignals } from "./useIntegritySignals";

const recordActivity = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("./api", () => ({ recordActivity }));

function Harness({ attemptId, active }: { attemptId?: string; active: boolean }) {
  useIntegritySignals(attemptId, active);
  return null;
}

describe("informational integrity signals", () => {
  it("records lifecycle, visibility, and connection signals without enforcement", async () => {
    recordActivity.mockClear();
    recordActivity.mockRejectedValueOnce(new Error("offline"));
    const view = render(<Harness attemptId="attempt-1" active />);
    await waitFor(() => expect(recordActivity).toHaveBeenCalledWith("attempt-1", "workspace_entered", {}));

    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
    await waitFor(() => expect(recordActivity).toHaveBeenCalledWith("attempt-1", "page_hidden", {}));
    expect(recordActivity).toHaveBeenCalledWith("attempt-1", "connection_lost", { connection: "offline" });
    expect(recordActivity).toHaveBeenCalledWith("attempt-1", "connection_restored", { connection: "online" });

    view.unmount();
    expect(recordActivity).toHaveBeenCalledWith("attempt-1", "workspace_exited", {});
  });

  it("does nothing when no active attempt exists", () => {
    recordActivity.mockClear();
    render(<Harness active={false} />);
    expect(recordActivity).not.toHaveBeenCalled();
  });
});
