import { useOutletContext } from "react-router-dom";

import type { OperationsSession } from "./types";

export function useOperationsSession(): OperationsSession {
  return useOutletContext<OperationsSession>();
}
