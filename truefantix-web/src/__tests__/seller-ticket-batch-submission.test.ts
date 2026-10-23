import fs from "fs";
import path from "path";

describe("seller multi-ticket submission", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/app/account/tickets/selling/page.tsx"),
    "utf8"
  );

  it("submits ticket creation in bounded concurrent waves", () => {
    expect(source).toContain("const waveSize = 5");
    expect(source).toContain("await Promise.all(");
    expect(source).toContain("submissionIndexes.slice(start, start + waveSize).map(createOne)");
  });

  it("still reports every failed ticket position", () => {
    expect(source).toContain("failures.push({ position: result.position, message: result.message })");
    expect(source).toContain("retry only the failed ticket numbers");
  });
});
