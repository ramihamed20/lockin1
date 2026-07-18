export type XpSummary = {
  total_points: number;
  ranking_points: number;
  transaction_count: number;
  level: number;
  level_progress: number;
  level_target: number;
  last_awarded_at: string | null;
};

export type StreakSummary = {
  current_days: number;
  longest_days: number;
  last_qualified_on: string | null;
  freeze_tokens_available: number;
  policy: {
    title: string;
    version: number;
    qualifying_activity_types: string[];
    grace_days: number;
    freeze_tokens_enabled: boolean;
  };
};

export type Achievement = {
  code: string;
  category: string;
  icon_key: string;
  title: string;
  description: string;
  current_value: number;
  target_value: number;
  earned_at: string | null;
};

export type RankingEntry = {
  position: number;
  score: number;
  evidence_count: number;
  display_name: string;
  is_me: boolean;
};

export type Ranking = {
  definition: null | {
    code: string;
    title: string;
    rules: Record<string, unknown>;
    period: string;
    tie_strategy: string;
  };
  snapshot: null | {
    id: string;
    generated_at: string;
    participant_count: number;
    checksum: string;
  };
  entries: RankingEntry[];
  own_entry: RankingEntry | null;
};

export type RankingProfile = {
  included: boolean;
  display_mode: "full_name" | "initials" | "anonymous";
  updated_at: string;
};

export type NotificationItem = {
  id: string;
  category: string;
  template_key: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  actor_name: string | null;
  target_type: string;
  has_target: boolean;
  read_at: string | null;
  created_at: string;
};

export type NotificationPage = {
  next: string | null;
  previous: string | null;
  results: NotificationItem[];
};

export type NotificationPreference = {
  category: string;
  channel: "in_app" | "email" | "push";
  enabled: boolean;
  required: boolean;
  available: boolean;
};
