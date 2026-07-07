import { redirect } from "next/navigation";

/** Everything lives under the /admin dashboard now (results included). */
export default function Home() {
  redirect("/admin");
}
