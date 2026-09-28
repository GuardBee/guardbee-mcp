export type UnboundedConsumptionCategory =
  | "missing-token-limit"
  | "missing-timeout"
  | "unbounded-loop"
  | "disabled-safety-limit"
  | "missing-rate-limit";

export interface UnboundedConsumptionPattern {
  id: string;
  name: string;
  category: UnboundedConsumptionCategory;
  pattern: RegExp;
  severity: "critical" | "high" | "medium";
  recommendation: string;
}

/**
 * Only the two "disabled-safety-limit" patterns are flat regexes — both were
 * verified against real framework source before being written, not guessed:
 * LangChain's AgentExecutor defaults max_iterations to 15 and its own
 * _should_continue() only enforces that cap when the value isn't None
 * (`if self.max_iterations is not None and iterations >= self.max_iterations`,
 * langchain_classic/agents/agent.py) — so `max_iterations=None` genuinely
 * removes the loop-count safety net, it isn't a false alarm. openai-agents-python's
 * Runner.run/run_sync has a bounded max_turns by default, and its own docs/issue
 * tracker (#551) state plainly "you can pass max_turns=None to disable this turn
 * limit". LangGraph's recursion_limit has no equivalent None-disables-it mechanism
 * (it requires a concrete number), so no pattern for it is shipped here — an
 * unverified pattern would just be guessing. The other five checks need call-span
 * or loop-body context a flat regex can't express and live in scanner.ts instead.
 */
export const UNBOUNDED_CONSUMPTION_PATTERNS: UnboundedConsumptionPattern[] = [
  {
    id: "langchain_max_iterations_disabled",
    name: "LangChain AgentExecutor max_iterations explicitly disabled",
    category: "disabled-safety-limit",
    pattern: /\bmax_iterations\s*[:=]\s*None\b/g,
    severity: "high",
    recommendation: "LangChain's AgentExecutor defaults max_iterations to 15 — its own _should_continue() only enforces the cap when the value is not None, so setting it to None removes the loop-count safety net entirely and an agent stuck in a reasoning/tool-call cycle can run indefinitely. Set an explicit, small integer instead (and consider max_execution_time as a second, time-based bound).",
  },
  {
    id: "openai_agents_max_turns_disabled",
    name: "openai-agents-python Runner max_turns explicitly disabled",
    category: "disabled-safety-limit",
    pattern: /\bmax_turns\s*[:=]\s*None\b/g,
    severity: "high",
    recommendation: "Runner.run/run_sync has a bounded max_turns by default specifically to stop a runaway agent loop; passing max_turns=None disables that turn limit outright (documented in the SDK's own issue tracker). Keep an explicit, small integer bound unless you have another hard stop (a budget/cost circuit breaker) in place.",
  },
];
