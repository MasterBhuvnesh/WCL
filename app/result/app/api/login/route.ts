import { findResult, parseDob } from "@/lib/results";

/**
 * Candidate login. Accepts an employee ID and a date of birth in dd/mm/yyyy
 * form, and returns that candidate's full scorecard. The lookup hits the exam
 * database server-side (lib/results.ts) so neither the roster nor the answer
 * key is exposed to the browser before results are published.
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

  const lookup = await findResult(employeeId, dobIso);

  switch (lookup.status) {
    case "ok":
      return Response.json({ result: lookup.result });
    case "unpublished":
      // Deliberately indistinguishable from "graded but embargoed": until an
      // admin publishes, the portal reveals nothing about the candidate's exam.
      return Response.json(
        {
          error:
            "Results have not been published yet. Please check back after the announcement.",
        },
        { status: 403 },
      );
    case "no-result":
      return Response.json(
        {
          error:
            "No graded result was found for your session. Please contact the examination helpdesk.",
        },
        { status: 404 },
      );
    case "not-found":
      return Response.json(
        { error: "No result found for those details. Please check and try again." },
        { status: 401 },
      );
  }
}
