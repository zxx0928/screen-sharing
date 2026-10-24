import assert from "node:assert/strict";
import test from "node:test";
import { parseConnectInput } from "./connect-input";

test("parses a spaced or hyphenated device code", () => {
  assert.deepEqual(parseConnectInput("123 456 789"), { code: "123456789" });
  assert.deepEqual(parseConnectInput("123-456-789"), { code: "123456789" });
  assert.deepEqual(parseConnectInput("123456789"), { code: "123456789" });
});

test("reads a secure code after a space or slash", () => {
  assert.deepEqual(parseConnectInput("123 456 789 secret"), {
    code: "123456789",
    password: "secret",
  });
  assert.deepEqual(parseConnectInput("123456789/secret"), {
    code: "123456789",
    password: "secret",
  });
  assert.deepEqual(parseConnectInput("123456789 / ab cd"), {
    code: "123456789",
    password: "ab cd",
  });
});

test("rejects values that are not a device code", () => {
  assert.equal(parseConnectInput(""), null);
  assert.equal(parseConnectInput("hello"), null);
  assert.equal(parseConnectInput("12345"), null);
  assert.equal(parseConnectInput("1234567890"), null);
});
