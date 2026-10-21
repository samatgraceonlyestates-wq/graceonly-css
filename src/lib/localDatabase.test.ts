import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NotLocalDatabaseError, assertLocalDatabaseUrl } from "./localDatabase.ts";

const refuses = (url: string | undefined) => assert.throws(() => assertLocalDatabaseUrl(url), NotLocalDatabaseError);

describe("assertLocalDatabaseUrl", () => {
  it("accepts localhost, 127.0.0.1 and ::1", () => {
    assertLocalDatabaseUrl("postgresql://u:p@localhost:5432/css_dev");
    assertLocalDatabaseUrl("postgresql://u:p@127.0.0.1:5432/css_dev");
    assertLocalDatabaseUrl("postgres://u:p@[::1]:5432/css_dev");
    assertLocalDatabaseUrl("postgresql://u:p@LOCALHOST/css_dev");
  });

  it("refuses a remote host", () => {
    refuses("postgresql://u:p@db.example.com:5432/css");
    refuses("postgresql://u:p@203.0.113.7:5432/css");
  });

  it("refuses look-alikes of localhost", () => {
    refuses("postgresql://u:p@localhost.example.com/css");
    refuses("postgresql://localhost:5432@evil.example.com/css");
    refuses("postgresql://u:p@127.0.0.1.example.com/css");
  });

  it("refuses a host smuggled in through the query string", () => {
    refuses("postgresql://u:p@localhost/css?host=db.example.com");
    refuses("postgresql://u:p@localhost/css?hostaddr=203.0.113.7");
  });

  it("refuses a missing, empty, unreadable or non-PostgreSQL value", () => {
    refuses(undefined);
    refuses("");
    refuses("not a url");
    refuses("mysql://u:p@localhost/css");
  });

  it("never puts the URL or its password in the message", () => {
    try {
      assertLocalDatabaseUrl("postgresql://someone:hunter2secret@db.example.com/css");
      assert.fail("should have thrown");
    } catch (error) {
      const text = String((error as Error).message);
      assert.ok(!text.includes("hunter2secret") && !text.includes("db.example.com") && !text.includes("someone"));
    }
  });
});
