import { schemas, validateOptionalRequest, validateRequest } from "@/lib/validation";

class MockResponse {
  private payload: string;
  status: number;

  constructor(body: string, init?: { status?: number }) {
    this.payload = body;
    this.status = init?.status ?? 200;
  }

  async json() {
    return JSON.parse(this.payload);
  }
}

(global as any).Response = MockResponse;

function reqWithJson(value: unknown): Request {
  return {
    json: async () => value,
  } as unknown as Request;
}

function reqWithBadJson(): Request {
  return {
    json: async () => {
      throw new Error("bad json");
    },
  } as unknown as Request;
}

function reqWithText(value: string): Request {
  return {
    text: async () => value,
  } as unknown as Request;
}

describe("validation helpers", () => {
  it("validateRequest returns INVALID_JSON for malformed body", async () => {
    const result = await validateRequest(schemas.authLogin)(reqWithBadJson());
    expect(result.success).toBe(false);
    if (!result.success) {
      const payload = await result.response.json();
      expect(payload.error).toBe("INVALID_JSON");
    }
  });

  it("validateOptionalRequest accepts empty body and applies defaults", async () => {
    const result = await validateOptionalRequest(schemas.ticketVerifyPending)(reqWithText(""));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.take).toBe(25);
    }
  });

  it("validateOptionalRequest rejects invalid value", async () => {
    const result = await validateOptionalRequest(schemas.ticketVerifyPending)(
      reqWithText(JSON.stringify({ take: 9999 }))
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const payload = await result.response.json();
      expect(payload.error).toBe("VALIDATION_ERROR");
    }
  });

  it("validateRequest accepts valid payload", async () => {
    const result = await validateRequest(schemas.authLogin)(
      reqWithJson({ emailOrPhone: "a@b.com", password: "x" })
    );
    expect(result.success).toBe(true);
  });
});
