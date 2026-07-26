import { useEffect } from "react";

export function usePageTitle(title) {
  useEffect(() => {
    const suffix = "Dentify";
    document.title = title ? `${title} — ${suffix}` : suffix;
    return () => { document.title = suffix; };
  }, [title]);
}
