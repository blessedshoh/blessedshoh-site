// Plain-English names for the tools and the usage events each one counts. Events are read
// per tool: "priced" is a priced options position in one and a priced bond in the other.

const TOOL_NAMES: Record<string, string> = { options: "Options tool", bonds: "Fixed income lab" };

const SHARED: Record<string, string> = {
  view: "Page views",
  shared: "Links copied",
  link_opened: "Shared links opened",
  work: "Show your work opened",
};

const EVENT_LABELS: Record<string, Record<string, string>> = {
  options: {
    priced: "Positions priced",
    risk: "Risk view used",
    tree: "Binomial tree used",
    chain: "Chain or arbitrage used",
    sketch: "Payoff sketcher used",
    compare: "Compare used",
    event: "Earnings lab used",
  },
  bonds: {
    curve_date: "Past curve dates viewed",
    priced: "Bonds priced",
    hedged: "Hedges calculated",
    basics: "Coursework models run",
  },
};

export const toolName = (tool: string) => TOOL_NAMES[tool] ?? tool;
export const eventLabel = (tool: string, event: string) => EVENT_LABELS[tool]?.[event] ?? SHARED[event] ?? event;
