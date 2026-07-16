import { findCandidate, parseDob } from "@/lib/candidates";

/**
 * Candidate login. Accepts an employee ID and a date of birth in dd/mm/yyyy
 * form, and returns the matching candidate record. The lookup hits the exam
 * database server-side (lib/candidates.ts) so the roster is never exposed to
 * the browser.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { employeeId, dob } =
    (body as { employeeId?: unknown; dob?: unknown }) ?? {};

  if (typeof employeeId !== "string" || typeof dob !== "string") {
    return Response.json(
      { error: "Employee ID and date of birth are required." },
      { status: 400 },
    );
  }

  const dobIso = parseDob(dob);
  if (!dobIso) {
    return Response.json(
      { error: "Enter your date of birth as dd/mm/yyyy." },
      { status: 400 },
    );
  }

  const candidate = await findCandidate(employeeId, dobIso);
  if (!candidate) {
    return Response.json(
      { error: "No hall ticket found for those details. Please check and try again." },
      { status: 401 },
    );
  }

  return Response.json({ candidate });
}
