import { describe, it, expect } from "vitest";
import { classifyToolName } from "../capabilities.js";

describe("classifyToolName", () => {
  it("kod çalıştırma araçlarını yakalar", () => {
    expect(classifyToolName("python_repl_tool")?.category).toBe("code-execution");
    expect(classifyToolName("code_execution_config")?.category).toBe("code-execution");
  });

  it("shell/process araçlarını yakalar", () => {
    expect(classifyToolName("shell_tool")?.category).toBe("process-execution");
    expect(classifyToolName("subprocess_runner")?.category).toBe("process-execution");
  });

  it("her iki sırada da file-write araçlarını yakalar (write_file ve file_write)", () => {
    expect(classifyToolName("write_file_tool")?.category).toBe("filesystem-write");
    expect(classifyToolName("file_write_tool")?.category).toBe("filesystem-write");
  });

  it("network araçlarını yakalar", () => {
    expect(classifyToolName("requests_tool")?.category).toBe("network");
    expect(classifyToolName("web_browser")?.category).toBe("network");
  });

  it("credential araçlarını yakalar", () => {
    expect(classifyToolName("aws_tool")?.category).toBe("credentials-access");
  });

  it("zararsız bir isim için null döner", () => {
    expect(classifyToolName("search_tool")).toBeNull();
    expect(classifyToolName("weather_tool")).toBeNull();
  });
});
