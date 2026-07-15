export type Role = "student" | "moderator" | "creator" | "administrator";

export type User = {
  id: string;
  email: string;
  full_name: string;
  preferred_language: "en" | "ar";
  status: "active" | "suspended" | "deleted";
  is_email_verified: boolean;
  roles: Role[];
  date_joined: string;
};

export type SessionResponse = { user: User };
