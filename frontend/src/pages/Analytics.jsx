import { ErrorPanel, Page } from "../components/ui/index.jsx";

export default function Analytics() {
  return (
    <Page title="Analytics" subtitle="Personal operational analytics are not exposed by the current Django API.">
      <ErrorPanel message="This screen is not available from the current Django API integration. Your real XP, streak, achievement, and ranking data are available in their dedicated sections." />
    </Page>
  );
}
