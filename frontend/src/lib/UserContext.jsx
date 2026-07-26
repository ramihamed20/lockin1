import { createContext, useContext } from "react";

const UserContext = createContext(null);

export function UserProvider({ value, children }) {
  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser() {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useUser must be used within a UserProvider");
  return ctx;
}
