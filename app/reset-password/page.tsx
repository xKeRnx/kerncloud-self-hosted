import { PasswordRecovery } from "@/components/password-recovery";
export const metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default function Page() {
  return <PasswordRecovery reset />;
}
