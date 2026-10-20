import { redirect } from "next/navigation";

// The proxy sends a signed-out visitor to the sign-in page before this runs, so
// anyone who gets here has at least a cookie; the dashboard checks the session.
export default function Home() {
  redirect("/dashboard");
}
