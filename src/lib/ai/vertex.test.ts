import assert from "node:assert/strict";
import test from "node:test";
import {
  parseVertexServiceAccount,
  buildVertexClientOptions,
  buildVertexUsage,
  vertexCredentialLabel,
  VertexCredentialError,
  VERTEX_CAPACITY_HEADER,
  VERTEX_CAPACITY_REQUEST_TYPE,
  VERTEX_DEFAULT_MODEL,
  VERTEX_DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
  VERTEX_LOCATION,
} from "./vertex";

const credential = JSON.stringify({
  type: "service_account",
  project_id: "example-project",
  client_email: "vertex@example-project.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\ntest-only\n-----END PRIVATE KEY-----\n",
});

test("Vertex connection is pinned to the Singapore model and shared PayGo", () => {
  assert.equal(VERTEX_LOCATION, "asia-southeast1");
  assert.equal(VERTEX_DEFAULT_MODEL, "gemini-3.5-flash");
  assert.equal(VERTEX_DEFAULT_MODEL_MAX_OUTPUT_TOKENS, 65_536);
  assert.equal(VERTEX_CAPACITY_HEADER, "X-Vertex-AI-LLM-Request-Type");
  assert.equal(VERTEX_CAPACITY_REQUEST_TYPE, "shared");

  const options = buildVertexClientOptions(credential, 15_000);
  assert.equal(options.vertexai, true);
  assert.equal(options.project, "example-project");
  assert.equal(options.location, "asia-southeast1");
  assert.equal(options.httpOptions?.apiVersion, "v1");
  assert.equal(options.httpOptions?.timeout, 15_000);
  assert.equal(options.httpOptions?.headers?.[VERTEX_CAPACITY_HEADER], "shared");
});

test("service-account JSON is parsed without exposing its private key in the label", () => {
  const parsed = parseVertexServiceAccount(credential);
  assert.equal(parsed.project_id, "example-project");
  assert.equal(
    vertexCredentialLabel(credential),
    "vertex@example-project.iam.gserviceaccount.com · asia-southeast1"
  );
  assert.equal(vertexCredentialLabel(credential).includes("PRIVATE KEY"), false);
});

test("malformed and incomplete credentials are rejected", () => {
  assert.throws(() => parseVertexServiceAccount("not-json"), VertexCredentialError);
  assert.throws(
    () => parseVertexServiceAccount(JSON.stringify({ type: "service_account" })),
    VertexCredentialError
  );
});

test("Vertex usage counts response and reasoning tokens as billable output", () => {
  assert.deepEqual(
    buildVertexUsage(
      {
        promptTokenCount: 100,
        toolUsePromptTokenCount: 5,
        candidatesTokenCount: 20,
        thoughtsTokenCount: 30,
        totalTokenCount: 155,
      },
      "gemini-3.5-flash",
      "gemini-3.5-flash-001",
    ),
    {
      promptTokens: 105,
      completionTokens: 50,
      thoughtsTokens: 30,
      totalTokens: 155,
      model: "gemini-3.5-flash",
      modelVersion: "gemini-3.5-flash-001",
    },
  );
});
