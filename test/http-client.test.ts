import { test, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeTool, safeUrl } from "../src/http-client.js";
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
  allowedUploadDirs: [],
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

test("formats array query parameters into repeated key pairs even if schema isArray is false", async () => {
  const tool: MealieTool = {
    name: "test_tool",
    description: "",
    inputSchema: { type: "object" },
    category: "test",
    method: "get",
    path: "/api/search",
    pathParams: [],
    queryParams: [{ name: "filters", isArray: false }],
    deprecated: false,
  };

  const args = { filters: ["vegan", "gluten-free"] };

  let capturedUrl: string | undefined;
  mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    capturedUrl = url.toString();
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  });

  await executeTool(dummyConfig, tool, args, dummyAuth);

  assert.equal(capturedUrl, "https://api.example.com/api/search?filters=vegan&filters=gluten-free");
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
  await executeTool({ ...dummyConfig, allowedUploadDirs: [process.cwd()] }, tool, { body: { title: "My Recipe", image: "package.json" } }, dummyAuth);

  assert.ok(capturedBody instanceof FormData);
  assert.equal(capturedBody.get("title"), "My Recipe");
  // Not `instanceof Blob`: on Node < 19.8 there is no `openAsBlob`, so the part
  // is the stream-backed stand-in, which undici wraps as its own `FileLike`
  // rather than a real Blob. Assert the properties an upload part is actually
  // required to have — they hold on both paths.
  const blob = capturedBody.get("image") as File;
  assert.equal(blob.name, "package.json");
  assert.equal(blob.type, "application/json");
  const text = await blob.text();
  assert.ok(text.includes('"name": "mealie-mcp"'));
});

test("sanitizes the filename sent in a multipart body", async () => {
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

  const dir = await fs.mkdtemp(join(tmpdir(), "mealie-mcp-sanitize-test-"));
  const filePath = join(dir, "test<script>.txt");
  await fs.writeFile(filePath, "dummy content");

  try {
    await executeTool({ ...dummyConfig, allowedUploadDirs: [dir] }, tool, { body: { image: filePath } }, dummyAuth);

    assert.ok(capturedBody instanceof FormData);

    // FormData exposes the part's filename only on the File it holds, and Node
    // rebuilds that lazily — serialising through a Request is the reliable way
    // to see the Content-Disposition line that actually goes on the wire.
    const req = new Request("http://localhost", { method: "POST", body: capturedBody });
    const textBody = await req.text();

    assert.ok(textBody.includes('filename="test_script_.txt"'));
    assert.ok(!textBody.includes("test<script>"));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("falls back to a placeholder when a filename sanitizes to nothing", async () => {
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

  let capturedBody: unknown;
  mock.method(globalThis, "fetch", async (_url: string | URL | Request, init: RequestInit | undefined) => {
    capturedBody = init?.body;
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  });

  const dir = await fs.mkdtemp(join(tmpdir(), "mealie-mcp-sanitize-test-"));
  // `basename()` of a path ending in "..." is "...", which is all dots and so
  // sanitizes away entirely.
  const filePath = join(dir, "...");
  await fs.writeFile(filePath, "dummy content");

  try {
    await executeTool({ ...dummyConfig, allowedUploadDirs: [dir] }, tool, { body: { image: filePath } }, dummyAuth);

    const req = new Request("http://localhost", { method: "POST", body: capturedBody as FormData });
    const textBody = await req.text();

    assert.ok(textBody.includes('filename="upload.bin"'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

const uploadTool: MealieTool = {
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

function captureFormData(): () => FormData {
  let captured: unknown;
  mock.method(globalThis, "fetch", async (_url: string | URL | Request, init: RequestInit | undefined) => {
    captured = init?.body;
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  });
  return () => {
    assert.ok(captured instanceof FormData);
    return captured;
  };
}

async function withTempFile<T>(name: string, contents: string, fn: (path: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(join(tmpdir(), "mealie-mcp-test-"));
  const filePath = join(dir, name);
  await fs.writeFile(filePath, contents);
  try {
    return await fn(filePath);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("labels upload parts with a MIME type derived from the extension", async () => {
  const form = captureFormData();

  await withTempFile("photo.png", "not really a png", async (filePath) => {
    await executeTool({ ...dummyConfig, allowedUploadDirs: [tmpdir()] }, uploadTool, { body: { image: filePath } }, dummyAuth);
  });

  const part = form().get("image") as File;
  assert.equal(part.type, "image/png");
  assert.equal(part.name, "photo.png");
});

test("falls back to octet-stream for unknown extensions", async () => {
  const form = captureFormData();

  await withTempFile("backup.sqlite", "data", async (filePath) => {
    await executeTool({ ...dummyConfig, allowedUploadDirs: [tmpdir()] }, uploadTool, { body: { image: filePath } }, dummyAuth);
  });

  assert.equal((form().get("image") as File).type, "application/octet-stream");
});

test("uploads every file when a file field holds an array of paths", async () => {
  const tool: MealieTool = { ...uploadTool, body: { kind: "multipart", required: true, fileFields: ["images"] } };
  const form = captureFormData();

  // The parts are inspected inside the temp-file scope on purpose: an
  // `openAsBlob` part streams off disk when the request is sent, so its
  // contents only resolve while the backing file still exists.
  await withTempFile("a.jpg", "first", async (first) =>
    withTempFile("b.webp", "second", async (second) => {
      await executeTool({ ...dummyConfig, allowedUploadDirs: [tmpdir()] }, tool, { body: { images: [first, second] } }, dummyAuth);

      const parts = form().getAll("images") as File[];
      assert.deepEqual(
        parts.map((p) => [p.name, p.type]),
        [
          ["a.jpg", "image/jpeg"],
          ["b.webp", "image/webp"],
        ],
      );
      assert.deepEqual(await Promise.all(parts.map((p) => p.text())), ["first", "second"]);
    }),
  );
});

test("reports an unreadable upload path instead of a bare filesystem error", async () => {
  await assert.rejects(
    () => executeTool(dummyConfig, uploadTool, { body: { image: "/definitely/not/here.png" } }, dummyAuth),
    /Upload failed: cannot read \/definitely\/not\/here\.png/,
  );
});

test("rejects an upload path that is not a regular file", async () => {
  await assert.rejects(
    () => executeTool({ ...dummyConfig, allowedUploadDirs: [tmpdir()] }, uploadTool, { body: { image: tmpdir() } }, dummyAuth),
    /is not a regular file/,
  );
});

test("rejects an upload that exceeds the maximum file size", async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), "mealie-mcp-test-"));
  const bigFile = join(dir, "big.txt");

  // Create a >50MB sparse file
  const fh = await fs.open(bigFile, "w");
  await fh.truncate(50 * 1024 * 1024 + 1);
  await fh.close();

  try {
    await assert.rejects(
      () => executeTool({ ...dummyConfig, allowedUploadDirs: [dir] }, uploadTool, { body: { image: bigFile } }, dummyAuth),
      /exceeds the maximum allowed size of 50MB/,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// MEALIE_ALLOWED_UPLOAD_DIRS — opt-in allowlist for multipart uploads.

/** Builds `<root>/inside/ok.png` plus an out-of-bounds `<root>/outside/secret.png`. */
async function withUploadSandbox(
  fn: (paths: { allowed: string; inside: string; outside: string }) => Promise<void>,
): Promise<void> {
  // realpath the root: on macOS os.tmpdir() is itself a symlink (/var -> /private/var),
  // so a test asserting on real paths has to start from the resolved one.
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "mealie-mcp-sandbox-")));
  const allowed = join(root, "inside");
  await fs.mkdir(allowed);
  await fs.mkdir(join(root, "outside"));
  const inside = join(allowed, "ok.png");
  const outside = join(root, "outside", "secret.png");
  await fs.writeFile(inside, "allowed bytes");
  await fs.writeFile(outside, "SENSITIVE");
  try {
    await fn({ allowed, inside, outside });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("an empty allowlist refuses uploads (fails closed)", async () => {
  await withUploadSandbox(async ({ outside }) => {
    // dummyConfig has allowedUploadDirs: []
    await assert.rejects(
      () => executeTool(dummyConfig, uploadTool, { body: { image: outside } }, dummyAuth),
      /outside MEALIE_ALLOWED_UPLOAD_DIRS/,
    );
  });
});

test("allows an upload inside an allowed directory", async () => {
  const form = captureFormData();
  await withUploadSandbox(async ({ allowed, inside }) => {
    const config = { ...dummyConfig, allowedUploadDirs: [allowed] };
    await executeTool(config, uploadTool, { body: { image: inside } }, dummyAuth);
    assert.equal(await (form().get("image") as File).text(), "allowed bytes");
  });
});

test("refuses an upload outside every allowed directory", async () => {
  await withUploadSandbox(async ({ allowed, outside }) => {
    const config = { ...dummyConfig, allowedUploadDirs: [allowed] };
    await assert.rejects(
      () => executeTool(config, uploadTool, { body: { image: outside } }, dummyAuth),
      /outside MEALIE_ALLOWED_UPLOAD_DIRS/,
    );
  });
});

test("refuses a symlink that escapes an allowed directory", async () => {
  // The bypass a lexical resolve() misses: the link sits inside the allowlist,
  // so the path passes a string check, but stat/read follow it straight out.
  await withUploadSandbox(async ({ allowed, outside }) => {
    const link = join(allowed, "innocent.png");
    await fs.symlink(outside, link);
    const config = { ...dummyConfig, allowedUploadDirs: [allowed] };
    const realOutside = await fs.realpath(outside);
    await assert.rejects(
      () => executeTool(config, uploadTool, { body: { image: link } }, dummyAuth),
      new Error(`Upload failed: ${link} resolves to ${realOutside}, which is outside MEALIE_ALLOWED_UPLOAD_DIRS.`),
    );
  });
});

test("does not treat a sibling directory sharing a name prefix as allowed", async () => {
  await withUploadSandbox(async ({ allowed }) => {
    const sibling = `${allowed}-evil`;
    await fs.mkdir(sibling);
    const sneaky = join(sibling, "x.png");
    await fs.writeFile(sneaky, "nope");
    const config = { ...dummyConfig, allowedUploadDirs: [allowed] };
    await assert.rejects(
      () => executeTool(config, uploadTool, { body: { image: sneaky } }, dummyAuth),
      /outside MEALIE_ALLOWED_UPLOAD_DIRS/,
    );
  });
});

test("refuses everything when no configured allowed directory resolves", async () => {
  // A typo'd allowlist must fail closed, never fall back to unrestricted.
  await withUploadSandbox(async ({ inside }) => {
    const config = { ...dummyConfig, allowedUploadDirs: ["/definitely/not/a/real/dir"] };
    await assert.rejects(
      () => executeTool(config, uploadTool, { body: { image: inside } }, dummyAuth),
      /outside MEALIE_ALLOWED_UPLOAD_DIRS/,
    );
  });
});

test("follows a symlinked allowed directory to its real location", async () => {
  // The mirror case: the allowlist entry itself is a symlink. Resolving only
  // the file and not the allowlist would refuse a legitimate upload.
  const form = captureFormData();
  await withUploadSandbox(async ({ allowed, inside }) => {
    const linkedDir = `${allowed}-link`;
    await fs.symlink(allowed, linkedDir);
    const config = { ...dummyConfig, allowedUploadDirs: [linkedDir] };
    await executeTool(config, uploadTool, { body: { image: inside } }, dummyAuth);
    assert.equal(await (form().get("image") as File).text(), "allowed bytes");
  });
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

test("skips JSON parse for excessively large JSON responses", async () => {
  const tool: MealieTool = {
    name: "test_tool",
    description: "",
    inputSchema: { type: "object" },
    category: "test",
    method: "get",
    path: "/api/huge-json",
    pathParams: [],
    queryParams: [],
    deprecated: false,
  };

  const hugeString = "x".repeat(100_000 * 5 + 1);

  mock.method(globalThis, "fetch", async () => {
    return new Response(hugeString, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const originalParse = JSON.parse;
  const parseMock = mock.method(JSON, "parse", function (this: any, text: string) {
    return originalParse.apply(this, arguments as any);
  });

  const res = await executeTool(dummyConfig, tool, {}, dummyAuth);

  assert.equal(res.content[0].type, "text");
  const txt = (res.content[0] as { text: string }).text;

  assert.ok(txt.includes("[truncated"));

  let hugeStringParsed = false;
  for (const call of parseMock.mock.calls) {
    if (call.arguments[0] === hugeString) {
      hugeStringParsed = true;
    }
  }
  assert.equal(hugeStringParsed, false, "JSON.parse should not be called with huge string");
});

test("handles invalid JSON response gracefully", async () => {
  const tool: MealieTool = {
    name: "test_tool",
    description: "",
    inputSchema: { type: "object" },
    category: "test",
    method: "get",
    path: "/api/invalid-json",
    pathParams: [],
    queryParams: [],
    deprecated: false,
  };

  mock.method(globalThis, "fetch", async () => {
    return new Response("{ invalid json }", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const res = await executeTool(dummyConfig, tool, {}, dummyAuth);
  assert.equal(res.content[0].type, "text");
  const txt = (res.content[0] as {text: string}).text;
  assert.equal(txt, "{ invalid json }");
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
    queryParams: [{ name: "secret", isArray: false }],
    deprecated: false,
  };

  mock.method(globalThis, "fetch", async () => {
    throw new Error("Network offline");
  });

  const res = await executeTool(dummyConfig, tool, { secret: "xyz123" }, dummyAuth);
  assert.equal(res.isError, true);
  assert.match((res.content[0] as {text: string}).text, /Request to GET https:\/\/api.example.com\/api\/test failed: Network offline/);
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

test("gives up after exhausting retries on network error", async () => {
  let callCount = 0;
  mock.method(globalThis, "fetch", async () => {
    callCount++;
    throw new Error("Network offline");
  });

  const res = await executeTool({ ...dummyConfig, retries: 2 }, getTool, {}, dummyAuth);
  assert.equal(res.isError, true);
  assert.equal(callCount, 3); // 1 initial + 2 retries
  const txt = (res.content[0] as { text: string }).text;
  assert.match(txt, /failed: Network offline/);
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
test("refuses to execute if path spoofing changes the URL origin (SSRF)", async () => {
  const tool: MealieTool = {
    name: "test_tool",
    description: "",
    inputSchema: { type: "object" },
    category: "test",
    method: "get",
    path: "https://evil.com/api/data",
    pathParams: [],
    queryParams: [],
    body: undefined,
    deprecated: false,
  };

  mock.method(globalThis, "fetch", async () => {
    throw new Error("Should not be called");
  });

  await assert.rejects(
    executeTool(dummyConfig, tool, {}, dummyAuth),
    /SSRF attack detected: URL origin mismatch/
  );

  tool.path = "http://evil.com/api/data";
  await assert.rejects(
    executeTool(dummyConfig, tool, {}, dummyAuth),
    /SSRF attack detected: URL origin mismatch/
  );
});

test("refuses to execute if malicious path parameter causes SSRF", async () => {
  const tool: MealieTool = {
    name: "test_tool",
    description: "",
    inputSchema: { type: "object" },
    category: "test",
    method: "get",
    path: "https://{test}",
    pathParams: ["test"],
    queryParams: [],
    body: undefined,
    deprecated: false,
  };

  mock.method(globalThis, "fetch", async () => {
    throw new Error("Should not be called");
  });

  await assert.rejects(
    executeTool(dummyConfig, tool, { test: "evil.com" }, dummyAuth),
    /SSRF attack detected: URL origin mismatch/
  );
});

test("securely constructs URLs to prevent host-spoofing", async () => {
  const tool: MealieTool = {
    name: "test_tool",
    description: "",
    inputSchema: { type: "object" },
    category: "test",
    method: "get",
    path: "@evil.com/api/data",
    pathParams: [],
    queryParams: [],
    body: undefined,
    deprecated: false,
  };

  let capturedUrl = "";
  mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    capturedUrl = url.toString();
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  });

  await executeTool(dummyConfig, tool, {}, dummyAuth);

  assert.equal(capturedUrl, "https://api.example.com/@evil.com/api/data");
});

test("preserves config.baseUrl subpaths when constructing URLs", async () => {
  const subpathConfig: Config = { ...dummyConfig, baseUrl: "https://api.example.com/mealie-subpath" };
  const tool: MealieTool = {
    name: "test_tool",
    description: "",
    inputSchema: { type: "object" },
    category: "test",
    method: "get",
    path: "/api/data",
    pathParams: [],
    queryParams: [],
    body: undefined,
    deprecated: false,
  };

  let capturedUrl = "";
  mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    capturedUrl = url.toString();
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  });

  await executeTool(subpathConfig, tool, {}, dummyAuth);

  assert.equal(capturedUrl, "https://api.example.com/mealie-subpath/api/data");
});

test("safeUrl securely strips credentials from valid URLs", () => {
  const url = "https://user:pass@example.com/api/data?query=123#hash";
  const safe = safeUrl(url);
  assert.equal(safe, "https://example.com/api/data");
});

test("safeUrl returns <invalid url> for unparseable strings", () => {
  const invalidStrs = [
    "not-a-url",
    "http://",
    "",
    "   ",
  ];
  for (const str of invalidStrs) {
    const safe = safeUrl(str);
    assert.equal(safe, "<invalid url>");
  }
});
