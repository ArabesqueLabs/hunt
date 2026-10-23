// Pages that list a resource: the route, the resource, and its columns.

export const LISTS: Record<string, { resource: string; columns: [string, string][] }> = {
  applications: {
    resource: "applications",
    columns: [["source", "Source"], ["location", "Location"], ["work_mode", "Mode"], ["salary", "Salary"], ["created_at", "Added"]],
  },
  companies: { resource: "companies", columns: [["kind", "Kind"], ["website", "Website"]] },
  people: { resource: "people", columns: [["title", "Job title"], ["location", "Location"], ["email", "Email"], ["linkedin", "LinkedIn"]] },
  files: { resource: "documents", columns: [["kind", "Kind"], ["latest", "Latest version"], ["versions", "Versions"]] },
};

/** A line about a list, beside its title. */
export const LIST_LEDES: Record<string, string> = {
  contacts: "Who's hiring, and who you've met.",
  files: "Your resumes, cover letters and other documents, each with its versions and where it was sent.",
};

/** The page that lists a resource. */
export const routeOf = (resource: string | undefined) => Object.keys(LISTS).find((k) => LISTS[k].resource === resource);
