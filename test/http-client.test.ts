import { test, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { executeTool } from "../src/http-client.js";
import type { Config } from "../src/config.js";
import type { MealieTool } from "../src/tools.js";
import type { TokenProvider } from "../src/auth.js";

const dummyConfig: Config = {
  baseUrl: "https://api.example.com",
  useBundledSpec: false,
  readOnly: false,
  include: [],
  exclude: [],
  timeoutMs: 5000,
  toolNameMax: 50,
  debug: false,
  retries: 0,
};

const dummyAuth: TokenProvider = {
  authHeader: async (forceRefresh) => "Bearer dummy_token",
};

afterEach(() => {
  mock.restoreAll();
});

test("throws error if missing required path parameter", async () => {
  const tool: MealieTool = {
    name: "test_tool",
    description: "",
    inputSchema: { type: "object" },
    category: "test",
    method: "get",
    path: "/api/users/{userId}",
    pathParams: ["userId"],
    queryParams: [],
    deprecated: false,
  };

  await assert.rejects(
    executeTool(dummyConfig, tool, {}, dummyAuth),
    /Missing required path parameter: userId/
  );
});

test("builds correct URL with path and query parameters", async () => {
  const tool: MealieTool = {
    name: "test_tool",
    description: "",
    inputSchema: { type: "object" },
    category: "test",
    method: "get",
    path: "/api/users/{userId}/posts",
    pathParams: ["userId"],
    queryParams: [{ name: "tags", isArray: true }, { name: "limit", isArray: false }],
    deprecated: false,
  };

  const args = { userId: "123", tags: ["a", "b"], limit: 10, ignored: "yes" };

  let capturedUrl: string | undefined;
  mock.method(globalThis, "fetch", async (url: string | URL | Request, init: RequestInit | undefined) => {
    capturedUrl = url.toString();
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  });

  await executeTool(dummyConfig, tool, args, dummyAuth);

  assert.equal(capturedUrl, "https://api.example.com/api/users/123/posts?tags=a&tags=b&limit=10");
});

test("sends JSON body correctly", async () => {
  const tool: MealieTool = {
    name: "test_tool",
    description: "",
    inputSchema: { type: "object" },
    category: "test",
    method: "post",
    path: "/api/recipes",
    pathParams: [],
    queryParams: [],
    body: { kind: "json", required: true, fileFields: [] },
    deprecated: false,
  };

  let capturedInit: RequestInit | undefined;
  mock.method(globalThis, "fetch", async (url: string | URL | Request, init: RequestInit | undefined) => {
    capturedInit = init;
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  });

  await executeTool(dummyConfig, tool, { body: { name: "Cake", tags: ["sweet"] } }, dummyAuth);

  assert.equal(capturedInit?.method, "POST");
  assert.equal((capturedInit?.headers as Record<string, string>)["Content-Type"], "application/json");
  assert.equal(capturedInit?.body, JSON.stringify({ name: "Cake", tags: ["sweet"] }));
});

test("sends urlencoded body correctly", async () => {
  const tool: MealieTool = {
    name: "test_tool",
    description: "",
    inputSchema: { type: "object" },
    category: "test",
    method: "post",
    path: "/api/login",
    pathParams: [],
    queryParams: [],
    body: { kind: "urlencoded", required: true, fileFields: [] },
    deprecated: false,
  };

  let capturedBody: any;
  mock.method(globalThis, "fetch", async (url: string | URL | Request, init: RequestInit | undefined) => {
    capturedBody = init?.body;
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  });

  await executeTool(dummyConfig, tool, { body: { username: "user", password: "pwd" } }, dummyAuth);

  assert.ok(capturedBody instanceof URLSearchParams);
  assert.equal(capturedBody.toString(), "username=user&password=pwd");
});

test("sends multipart body and reads local files", async () => {
  const tool: MealieTool = {
    name: "test_tool",
    description: "",
    inputSchema: { type: "object" },
    category: "test",
    method: "put",
    path: "/api/recipes/upload",
    pathParams: [],
    queryParams: [],
    body: { kind: "multipart", required: true, fileFields: ["image"] },
    deprecated: false,
  };

  let capturedBody: any;
  mock.method(globalThis, "fetch", async (url: string | URL | Request, init: RequestInit | undefined) => {
    capturedBody = init?.body;
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  });

  // Use a real file that exists in the repo to avoid ESM named-import mocking issues
  await executeTool(dummyConfig, tool, { body: { title: "My Recipe", image: "package.json" } }, dummyAuth);

  assert.ok(capturedBody instanceof FormData);
  assert.equal(capturedBody.get("title"), "My Recipe");
  const blob = capturedBody.get("image") as Blob;
  assert.ok(blob instanceof Blob);
  const text = await blob.text();
  assert.ok(text.includes('"name": "mealie-mcp"'));
});

test("handles 204 No Content response", async () => {
  const tool: MealieTool = {
    name: "test_tool",
    description: "",
    inputSchema: { type: "object" },
    category: "test",
    method: "delete",
    path: "/api/recipes/1",
    pathParams: [],
    queryParams: [],
    deprecated: false,
  };

  mock.method(globalThis, "fetch", async () => {
    return new Response(null, { status: 204 });
  });

  const res = await executeTool(dummyConfig, tool, {}, dummyAuth);
  assert.equal(res.content[0].type, "text");
  assert.match((res.content[0] as {text: string}).text, /Success/);
});

test("handles image response", async () => {
  const tool: MealieTool = {
    name: "test_tool",
    description: "",
    inputSchema: { type: "object" },
    category: "test",
    method: "get",
    path: "/api/image",
    pathParams: [],
    queryParams: [],
    deprecated: false,
  };

  mock.method(globalThis, "fetch", async () => {
    return new Response(Buffer.from("image_data"), {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  });

  const res = await executeTool(dummyConfig, tool, {}, dummyAuth);
  assert.equal(res.content[0].type, "image");
  const imgBlock = res.content[0] as { type: "image"; data: string; mimeType: string };
  assert.equal(imgBlock.mimeType, "image/png");
  assert.equal(imgBlock.data, Buffer.from("image_data").toString("base64"));
});

test("formats and truncates JSON response", async () => {
  const tool: MealieTool = {
    name: "test_tool",
    description: "",
    inputSchema: { type: "object" },
    category: "test",
    method: "get",
    path: "/api/data",
    pathParams: [],
    queryParams: [],
    deprecated: false,
  };

  const payload = { a: 1, b: "x".repeat(100_000) };

  mock.method(globalThis, "fetch", async () => {
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const res = await executeTool(dummyConfig, tool, {}, dummyAuth);
  assert.equal(res.content[0].type, "text");
  const txt = (res.content[0] as {text: string}).text;
  assert.ok(txt.includes(`"a": 1`));
  assert.ok(txt.includes("[truncated"));
});

test("handles non-JSON text/yaml response", async () => {
  const tool: MealieTool = {
    name: "test_tool",
    description: "",
    inputSchema: { type: "object" },
    category: "test",
    method: "get",
    path: "/api/config",
    pathParams: [],
    queryParams: [],
    deprecated: false,
  };

  mock.method(globalThis, "fetch", async () => {
    return new Response("key: value", {
      status: 200,
      headers: { "content-type": "application/x-yaml" },
    });
  });

  const res = await executeTool(dummyConfig, tool, {}, dummyAuth);
  assert.equal(res.content[0].type, "text");
  const txt = (res.content[0] as {text: string}).text;
  assert.equal(txt, "key: value");
});

test("handles arbitrary binary response", async () => {
  const tool: MealieTool = {
    name: "test_tool",
    description: "",
    inputSchema: { type: "object" },
    category: "test",
    method: "get",
    path: "/api/download",
    pathParams: [],
    queryParams: [],
    deprecated: false,
  };

  mock.method(globalThis, "fetch", async () => {
    return new Response(Buffer.from([0, 1, 2, 3]), {
      status: 200,
      headers: { "content-type": "application/pdf" },
    });
  });

  const res = await executeTool(dummyConfig, tool, {}, dummyAuth);
  assert.equal(res.content[0].type, "text");
  const txt = (res.content[0] as {text: string}).text;
  assert.ok(txt.includes("Received 4 bytes of binary data"));
});

test("handles network error", async () => {
  const tool: MealieTool = {
    name: "test_tool",
    description: "",
    inputSchema: { type: "object" },
    category: "test",
    method: "get",
    path: "/api/test",
    pathParams: [],
    queryParams: [],
    deprecated: false,
  };

  mock.method(globalThis, "fetch", async () => {
    throw new Error("Network offline");
  });

  const res = await executeTool(dummyConfig, tool, {}, dummyAuth);
  assert.equal(res.isError, true);
  assert.match((res.content[0] as {text: string}).text, /Network offline/);
});

test("handles HTTP errors gracefully", async () => {
  const tool: MealieTool = {
    name: "test_tool",
    description: "",
    inputSchema: { type: "object" },
    category: "test",
    method: "get",
    path: "/api/not-found",
    pathParams: [],
    queryParams: [],
    deprecated: false,
  };

  mock.method(globalThis, "fetch", async () => {
    return new Response("Not found page text", {
      status: 404,
      statusText: "Not Found",
      headers: { "content-type": "text/plain" },
    });
  });

  const res = await executeTool(dummyConfig, tool, {}, dummyAuth);
  assert.equal(res.isError, true);
  assert.match((res.content[0] as {text: string}).text, /HTTP 404 Not Found from GET \/api\/not-found/);
  assert.match((res.content[0] as {text: string}).text, /Not found page text/);
});

test("retries on 401 if token is refreshable", async () => {
  const tool: MealieTool = {
    name: "test_tool",
    description: "",
    inputSchema: { type: "object" },
    category: "test",
    method: "get",
    path: "/api/protected",
    pathParams: [],
    queryParams: [],
    deprecated: false,
  };

  let callCount = 0;
  mock.method(globalThis, "fetch", async (url: string | URL | Request, init: RequestInit | undefined) => {
    callCount++;
    if (callCount === 1) {
      return new Response("Unauthorized", { status: 401, headers: { "content-type": "text/plain" } });
    }
    return new Response("Success", { status: 200, headers: { "content-type": "text/plain" } });
  });

  let refreshCalled = false;
  const refreshableAuth: TokenProvider = {
    authHeader: async (forceRefresh) => {
      if (forceRefresh) refreshCalled = true;
      return "Bearer fresh_token";
    },
  };

  const refreshableConfig: Config = { ...dummyConfig, oauth: { tokenUrl: "http://idp", clientId: "1", clientSecret: "2" } };

  const res = await executeTool(refreshableConfig, tool, {}, refreshableAuth);
  assert.equal(res.isError, undefined);
  assert.equal(callCount, 2);
  assert.equal(refreshCalled, true);
  assert.match((res.content[0] as {text: string}).text, /Success/);
});

const getTool: MealieTool = {
  name: "test_tool",
  description: "",
  inputSchema: { type: "object" },
  category: "test",
  method: "get",
  path: "/api/data",
  pathParams: [],
  queryParams: [],
  deprecated: false,
};

test("retries idempotent GET on a 503 then succeeds", async () => {
  let callCount = 0;
  mock.method(globalThis, "fetch", async () => {
    callCount++;
    if (callCount < 3) {
      return new Response("Service Unavailable", { status: 503, headers: { "content-type": "text/plain" } });
    }
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  });

  const res = await executeTool({ ...dummyConfig, retries: 2 }, getTool, {}, dummyAuth);
  assert.equal(res.isError, undefined);
  assert.equal(callCount, 3);
});

test("gives up after exhausting retries and returns the last error", async () => {
  let callCount = 0;
  mock.method(globalThis, "fetch", async () => {
    callCount++;
    return new Response("Bad Gateway", { status: 502, statusText: "Bad Gateway", headers: { "content-type": "text/plain" } });
  });

  const res = await executeTool({ ...dummyConfig, retries: 1 }, getTool, {}, dummyAuth);
  assert.equal(res.isError, true);
  assert.equal(callCount, 2); // 1 initial + 1 retry
  assert.match((res.content[0] as { text: string }).text, /HTTP 502/);
});

test("does not retry a non-idempotent POST on 503", async () => {
  const postTool: MealieTool = { ...getTool, method: "post", path: "/api/data" };
  let callCount = 0;
  mock.method(globalThis, "fetch", async () => {
    callCount++;
    return new Response("Service Unavailable", { status: 503, statusText: "Service Unavailable", headers: { "content-type": "text/plain" } });
  });

  const res = await executeTool({ ...dummyConfig, retries: 3 }, postTool, {}, dummyAuth);
  assert.equal(res.isError, true);
  assert.equal(callCount, 1);
});

test("retries GET on a network error then succeeds", async () => {
  let callCount = 0;
  mock.method(globalThis, "fetch", async () => {
    callCount++;
    if (callCount === 1) throw new Error("Network offline");
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  });

  const res = await executeTool({ ...dummyConfig, retries: 2 }, getTool, {}, dummyAuth);
  assert.equal(res.isError, undefined);
  assert.equal(callCount, 2);
});

test("empty error body does not report Success", async () => {
  mock.method(globalThis, "fetch", async () => {
    return new Response(null, { status: 404, statusText: "Not Found", headers: { "content-length": "0" } });
  });

  const res = await executeTool(dummyConfig, getTool, {}, dummyAuth);
  assert.equal(res.isError, true);
  const txt = (res.content[0] as { text: string }).text;
  assert.doesNotMatch(txt, /Success/);
  assert.match(txt, /HTTP 404 Not Found/);
});