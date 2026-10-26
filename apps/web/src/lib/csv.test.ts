import { describe, expect, it } from "vitest";
import { csvToPosts, parseCsv } from "./csv";

describe("parseCsv", () => {
  it("handles quotes, commas, escaped quotes and embedded newlines", () => {
    expect(parseCsv('a,b\n"x, y","say ""hi""\nbye"\n')).toEqual([["a", "b"], ["x, y", 'say "hi"\nbye']]);
  });
  it("handles CRLF and a BOM", () => {
    expect(parseCsv("﻿a,b\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("csvToPosts", () => {
  it("maps loosely named Metricool-style columns and metrics", () => {
    const csv = 'Network,Published,Caption,Likes,Comments,Post ID\nInstagram,2026-01-05 10:00,"Hello, world",12,3,abc\nX,2026-01-06,Second,,,\n,,,,,\n';
    const { posts, skipped } = csvToPosts(csv, "instagram");
    expect(posts).toHaveLength(2);
    expect(posts[0]).toMatchObject({ platform: "instagram", text: "Hello, world", external_id: "abc", metrics: { likes: 12, comments: 3 } });
    expect(posts[1]).toMatchObject({ platform: "x", external_id: null, metrics: {} });
    expect(skipped).toBe(0);
  });
  it("explains a missing caption column", () => {
    expect(csvToPosts("a,b\n1,2", "x").error).toMatch(/No caption column/);
  });
});
