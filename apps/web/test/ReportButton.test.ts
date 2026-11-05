import { act, createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReportButton } from "../app/l/[code]/ReportButton";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BASE = "http://api.test";

interface Sent {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: unknown;
}

let sent: Sent[];
let reply: { status: number; body: unknown };
let original: typeof globalThis.fetch;

beforeEach(() => {
  sent = [];
  reply = { status: 201, body: { id: "r1" } };
  original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({
      url: String(input),
      method: init?.method,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
    });
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = original;
  cleanup();
});

function mount() {
  render(createElement(ReportButton, { code: "ABCD2345", baseUrl: BASE }));
}

async function send() {
  await act(async () => {
    fireEvent.click(screen.getByTestId("report-send"));
  });
}

describe("ReportButton", () => {
  it("shows only a quiet link until it is opened", () => {
    mount();
    expect(screen.getByTestId("report-open")).not.toBeNull();
    expect(screen.queryByTestId("report-form")).toBeNull();
  });

  it("sends the code and the chosen reason, with no token", async () => {
    mount();
    fireEvent.click(screen.getByTestId("report-open"));
    fireEvent.change(screen.getByTestId("report-reason"), { target: { value: "abuse" } });
    await send();

    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(`${BASE}/reports`);
    expect(sent[0]!.method).toBe("POST");
    expect(sent[0]!.headers.authorization).toBeUndefined();
    expect(sent[0]!.body).toEqual({ code: "ABCD2345", reason: "abuse" });
  });

  it("includes the note when one was written, trimmed", async () => {
    mount();
    fireEvent.click(screen.getByTestId("report-open"));
    fireEvent.change(screen.getByTestId("report-note"), { target: { value: "  slurs in the title  " } });
    await send();
    expect(sent[0]!.body).toEqual({
      code: "ABCD2345",
      reason: "other",
      note: "slurs in the title",
    });
  });

  it("limits the note to what the server accepts", () => {
    mount();
    fireEvent.click(screen.getByTestId("report-open"));
    expect(screen.getByTestId<HTMLTextAreaElement>("report-note").maxLength).toBe(500);
  });

  it("thanks the reader once it is sent, and closes the form", async () => {
    mount();
    fireEvent.click(screen.getByTestId("report-open"));
    await send();
    expect(screen.getByTestId("report-thanks")).not.toBeNull();
    expect(screen.queryByTestId("report-form")).toBeNull();
  });

  it("cannot be sent twice while the first is in flight", async () => {
    mount();
    fireEvent.click(screen.getByTestId("report-open"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("report-send"));
      fireEvent.click(screen.getByTestId("report-send"));
    });
    expect(sent).toHaveLength(1);
  });

  it("says when the server refused it, and keeps the form so it can be retried", async () => {
    reply = { status: 429, body: { error: "too many requests" } };
    mount();
    fireEvent.click(screen.getByTestId("report-open"));
    await send();

    expect(screen.getByTestId("report-error").textContent).toContain("too many requests");
    expect(screen.getByTestId("report-form")).not.toBeNull();
    expect(screen.queryByTestId("report-thanks")).toBeNull();
  });

  it("closes without sending", () => {
    mount();
    fireEvent.click(screen.getByTestId("report-open"));
    fireEvent.click(screen.getByTestId("report-cancel"));
    expect(screen.queryByTestId("report-form")).toBeNull();
    expect(sent).toHaveLength(0);
  });
});
