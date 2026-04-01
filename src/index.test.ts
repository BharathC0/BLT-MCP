/**
 * BLT-MCP Test Suite
 *
 * Tests for the validation logic, resource routing, and tool behaviour
 * of the BLT-MCP server. API calls are mocked via globalThis.fetch so
 * no real network access is required.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Helpers that mirror the logic in src/index.ts so we can unit-test them
// without spinning up a full MCP server.
// ---------------------------------------------------------------------------

interface ApiRequestBody {
  [key: string]: unknown;
}

const BLT_API_BASE = "https://blt.owasp.org/api";

async function makeApiRequest(
  endpoint: string,
  method: string = "GET",
  body?: ApiRequestBody
): Promise<Record<string, unknown>> {
  const headers: HeadersInit = { "Content-Type": "application/json" };
  const options: RequestInit = { method, headers };
  if (body && method !== "GET") options.body = JSON.stringify(body);

  const response = await fetch(`${BLT_API_BASE}${endpoint}`, options);
  if (!response.ok)
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  return response.json();
}

// ---------------------------------------------------------------------------
// Validation helpers mirrored from the tool handler
// ---------------------------------------------------------------------------

function validateSubmitIssue(args: Record<string, unknown>) {
  if (typeof args.title !== "string" || (args.title as string).trim().length === 0)
    throw new Error("Invalid input: 'title' must be a non-empty string");
  if (typeof args.description !== "string" || (args.description as string).trim().length === 0)
    throw new Error("Invalid input: 'description' must be a non-empty string");
  if ((args.title as string).trim().length > 255)
    throw new Error("Invalid input: 'title' must be 255 characters or fewer");
}

function validateAwardBacon(args: Record<string, unknown>) {
  if (typeof args.contributor_id !== "string" || (args.contributor_id as string).trim().length === 0)
    throw new Error("Invalid input: 'contributor_id' must be a non-empty string");
  if (typeof args.points !== "number" || (args.points as number) <= 0)
    throw new Error("Invalid input: 'points' must be a positive number");
  if (typeof args.reason !== "string" || (args.reason as string).trim().length === 0)
    throw new Error("Invalid input: 'reason' must be a non-empty string");
}

function validateUpdateIssueStatus(args: Record<string, unknown>) {
  if (typeof args.issue_id !== "string" || (args.issue_id as string).trim().length === 0)
    throw new Error("Invalid input: 'issue_id' must be a non-empty string");
  const validStatuses = ["open", "in_progress", "resolved", "closed", "wont_fix"];
  if (typeof args.status !== "string" || !validStatuses.includes(args.status as string))
    throw new Error(`Invalid input: 'status' must be one of: ${validStatuses.join(", ")}`);
}

function validateAddComment(args: Record<string, unknown>) {
  if (typeof args.issue_id !== "string" || (args.issue_id as string).trim().length === 0)
    throw new Error("Invalid input: 'issue_id' must be a non-empty string");
  if (typeof args.comment !== "string" || (args.comment as string).trim().length === 0)
    throw new Error("Invalid input: 'comment' must be a non-empty string");
}

function resolveResourceEndpoint(resourceType: string, resourceId?: string): string {
  switch (resourceType) {
    case "issues":
    case "repos":
    case "contributors":
    case "workflows":
      if (resourceId && !/^[A-Za-z0-9_-]+$/.test(resourceId))
        throw new Error(`Invalid resource id for ${resourceType}: ${resourceId}`);
      return resourceId
        ? `/${resourceType}/${encodeURIComponent(resourceId)}`
        : `/${resourceType}`;

    case "leaderboards":
      if (resourceId)
        throw new Error("leaderboards resource does not support individual lookup by ID");
      return "/leaderboards";

    case "rewards":
      if (resourceId)
        throw new Error("rewards resource does not support individual lookup by ID");
      return "/rewards";

    default:
      throw new Error(`Unknown resource type: ${resourceType}`);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("makeApiRequest", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls the correct URL", async () => {
    await makeApiRequest("/issues");
    expect(fetch).toHaveBeenCalledWith(
      "https://blt.owasp.org/api/issues",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("sends body for POST requests", async () => {
    await makeApiRequest("/issues", "POST", { title: "Test" });
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].body).toBe(JSON.stringify({ title: "Test" }));
  });

  it("throws on non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: "Not Found" })
    );
    await expect(makeApiRequest("/missing")).rejects.toThrow("API request failed: 404 Not Found");
  });
});

// ---------------------------------------------------------------------------
describe("Resource routing — resolveResourceEndpoint", () => {
  it("returns /leaderboards for leaderboards resource", () => {
    expect(resolveResourceEndpoint("leaderboards")).toBe("/leaderboards");
  });

  it("returns /rewards for rewards resource", () => {
    expect(resolveResourceEndpoint("rewards")).toBe("/rewards");
  });

  it("throws when leaderboards is called with an ID", () => {
    expect(() => resolveResourceEndpoint("leaderboards", "123")).toThrow(
      "leaderboards resource does not support individual lookup by ID"
    );
  });

  it("throws when rewards is called with an ID", () => {
    expect(() => resolveResourceEndpoint("rewards", "123")).toThrow(
      "rewards resource does not support individual lookup by ID"
    );
  });

  it("builds collection endpoint for issues", () => {
    expect(resolveResourceEndpoint("issues")).toBe("/issues");
  });

  it("builds item endpoint for issues with valid ID", () => {
    expect(resolveResourceEndpoint("issues", "42")).toBe("/issues/42");
  });

  it("throws for invalid resource ID characters", () => {
    expect(() => resolveResourceEndpoint("issues", "abc/../../etc")).toThrow(
      "Invalid resource id for issues"
    );
  });

  it("throws for unknown resource type", () => {
    expect(() => resolveResourceEndpoint("unknown")).toThrow("Unknown resource type: unknown");
  });
});

// ---------------------------------------------------------------------------
describe("Tool validation — submit_issue", () => {
  it("passes with valid args", () => {
    expect(() =>
      validateSubmitIssue({ title: "Bug found", description: "Details here" })
    ).not.toThrow();
  });

  it("throws when title is empty", () => {
    expect(() =>
      validateSubmitIssue({ title: "   ", description: "Details" })
    ).toThrow("'title' must be a non-empty string");
  });

  it("throws when title is missing", () => {
    expect(() =>
      validateSubmitIssue({ description: "Details" })
    ).toThrow("'title' must be a non-empty string");
  });

  it("throws when description is empty", () => {
    expect(() =>
      validateSubmitIssue({ title: "Bug", description: "" })
    ).toThrow("'description' must be a non-empty string");
  });

  it("throws when title exceeds 255 characters", () => {
    expect(() =>
      validateSubmitIssue({ title: "a".repeat(256), description: "Details" })
    ).toThrow("'title' must be 255 characters or fewer");
  });
});

// ---------------------------------------------------------------------------
describe("Tool validation — award_bacon", () => {
  it("passes with valid args", () => {
    expect(() =>
      validateAwardBacon({ contributor_id: "user-1", points: 10, reason: "Great fix" })
    ).not.toThrow();
  });

  it("throws when contributor_id is empty", () => {
    expect(() =>
      validateAwardBacon({ contributor_id: "", points: 10, reason: "Good" })
    ).toThrow("'contributor_id' must be a non-empty string");
  });

  it("throws when points is zero", () => {
    expect(() =>
      validateAwardBacon({ contributor_id: "user-1", points: 0, reason: "Good" })
    ).toThrow("'points' must be a positive number");
  });

  it("throws when points is negative", () => {
    expect(() =>
      validateAwardBacon({ contributor_id: "user-1", points: -5, reason: "Good" })
    ).toThrow("'points' must be a positive number");
  });

  it("throws when reason is missing", () => {
    expect(() =>
      validateAwardBacon({ contributor_id: "user-1", points: 5 })
    ).toThrow("'reason' must be a non-empty string");
  });
});

// ---------------------------------------------------------------------------
describe("Tool validation — update_issue_status", () => {
  it("passes with valid status", () => {
    expect(() =>
      validateUpdateIssueStatus({ issue_id: "42", status: "resolved" })
    ).not.toThrow();
  });

  it("throws for invalid status value", () => {
    expect(() =>
      validateUpdateIssueStatus({ issue_id: "42", status: "deleted" })
    ).toThrow("'status' must be one of");
  });

  it("throws when issue_id is empty", () => {
    expect(() =>
      validateUpdateIssueStatus({ issue_id: "", status: "open" })
    ).toThrow("'issue_id' must be a non-empty string");
  });

  it("accepts all valid status values", () => {
    const statuses = ["open", "in_progress", "resolved", "closed", "wont_fix"];
    for (const status of statuses) {
      expect(() =>
        validateUpdateIssueStatus({ issue_id: "1", status })
      ).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
describe("Tool validation — add_comment", () => {
  it("passes with valid args", () => {
    expect(() =>
      validateAddComment({ issue_id: "42", comment: "Looks good!" })
    ).not.toThrow();
  });

  it("throws when comment is empty", () => {
    expect(() =>
      validateAddComment({ issue_id: "42", comment: "  " })
    ).toThrow("'comment' must be a non-empty string");
  });

  it("throws when issue_id is empty", () => {
    expect(() =>
      validateAddComment({ issue_id: "", comment: "Hello" })
    ).toThrow("'issue_id' must be a non-empty string");
  });
});
