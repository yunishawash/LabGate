import { redirect } from "next/navigation";

/**
 * "/" is a router, not a page. Once auth lands (step 0.5) the proxy sends the
 * signed-in user to the landing page their role calls for; until then this
 * placeholder keeps the route honest.
 */
export default function HomePage() {
  redirect("/login");
}
