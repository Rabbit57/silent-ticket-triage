const sampleTickets = [
  {
    id: "TCK-1048",
    customer: "Northstar Logistics",
    plan: "Enterprise",
    mrr: 4200,
    ageHours: 6,
    subject: "Shipment dashboard is down for our entire warehouse team",
    body:
      "Nobody can load the shipment dashboard. Our night shift is blocked and we have two facilities waiting. Please escalate this immediately.",
  },
  {
    id: "TCK-1049",
    customer: "Atlas Design Co",
    plan: "Growth",
    mrr: 780,
    ageHours: 20,
    subject: "Need to cancel unless invoicing bug is fixed",
    body:
      "This is the third month where our invoice exports have duplicated tax rows. If this is not fixed today we need to cancel before renewal.",
  },
  {
    id: "TCK-1050",
    customer: "Mori Health",
    plan: "Enterprise",
    mrr: 5100,
    ageHours: 3,
    subject: "SSO login fails after Okta certificate rotation",
    body:
      "After rotating the Okta certificate, SSO returns invalid signature. Password login is disabled for our admins so we need a workaround.",
  },
  {
    id: "TCK-1051",
    customer: "Blue Pine Retail",
    plan: "Starter",
    mrr: 89,
    ageHours: 16,
    subject: "Question about adding two more users",
    body:
      "Can we add two more users to the Starter plan, or do we need to move to Growth? No rush, just planning for next week.",
  },
  {
    id: "TCK-1052",
    customer: "Fable Finance",
    plan: "Growth",
    mrr: 1320,
    ageHours: 9,
    subject: "API webhook retries creating duplicate records",
    body:
      "The invoice.paid webhook is retrying even after a 200 response. We now have duplicate records in production and need guidance on dedupe.",
  },
  {
    id: "TCK-1053",
    customer: "Urban Grove",
    plan: "Starter",
    mrr: 59,
    ageHours: 36,
    subject: "Refund request for unused seats",
    body:
      "We accidentally added annual seats for contractors who left. Please refund the unused seats and remove them before the next billing cycle.",
  },
  {
    id: "TCK-1054",
    customer: "Ridgeway Labs",
    plan: "Growth",
    mrr: 940,
    ageHours: 4,
    subject: "Import keeps timing out on 90k rows",
    body:
      "Our CSV import reaches 71 percent and then times out. We can split the file if needed, but we need the migration finished by Friday.",
  },
];

const toneCopy = {
  direct: {
    opener: "Thanks for the clear details.",
    close: "I will keep this focused and update you when the next action is complete.",
  },
  warm: {
    opener: "Thanks for flagging this, and sorry for the disruption.",
    close: "I will stay on this and send the next update as soon as there is movement.",
  },
  formal: {
    opener: "Thank you for the information.",
    close: "We will proceed with the next step and provide an update when it is complete.",
  },
};

const intentRules = [
  { intent: "incident", owner: "Engineering", match: ["down", "blocked", "fails", "disabled", "timeout"] },
  { intent: "billing", owner: "Billing", match: ["invoice", "refund", "billing", "tax", "seats"] },
  { intent: "churn", owner: "Customer Success", match: ["cancel", "renewal", "third month", "not fixed"] },
  { intent: "integration", owner: "Platform", match: ["api", "webhook", "okta", "sso", "certificate"] },
  { intent: "account", owner: "Support", match: ["users", "plan", "starter", "growth"] },
];

let state = {
  filter: "all",
  threshold: 82,
  tone: "direct",
  selectedId: "TCK-1050",
  analyzed: [],
};

function normalize(value) {
  return value.toLowerCase();
}

function hasAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function scoreTicket(ticket) {
  const text = normalize(`${ticket.subject} ${ticket.body}`);
  let score = 28;
  const signals = [];

  if (hasAny(text, ["down", "blocked", "fails", "disabled", "production"])) {
    score += 28;
    signals.push("service disruption");
  }

  if (hasAny(text, ["cancel", "renewal", "third month", "refund"])) {
    score += 22;
    signals.push("revenue risk");
  }

  if (hasAny(text, ["sso", "okta", "api", "webhook", "certificate"])) {
    score += 16;
    signals.push("technical escalation");
  }

  if (ticket.plan === "Enterprise") {
    score += 14;
    signals.push("enterprise account");
  }

  if (ticket.ageHours > 24) {
    score += 10;
    signals.push("aging ticket");
  } else if (ticket.ageHours > 12) {
    score += 5;
    signals.push("approaching SLA");
  }

  if (ticket.mrr >= 1000) {
    score += 8;
    signals.push("high account value");
  }

  const matchedRule =
    intentRules.find((rule) => hasAny(text, rule.match)) || {
      intent: "general",
      owner: "Support",
    };

  const priority =
    score >= 82 ? "critical" : score >= 68 ? "high" : score >= 48 ? "medium" : "low";
  const confidence = Math.min(96, Math.max(63, score + (signals.length * 3) - 5));
  const slaHoursRemaining = Math.max(0, 24 - ticket.ageHours);

  return {
    ...ticket,
    score: Math.min(score, 99),
    priority,
    confidence,
    intent: matchedRule.intent,
    owner: matchedRule.owner,
    signals,
    slaHoursRemaining,
  };
}

function actionFor(ticket) {
  if (ticket.priority === "critical") return "Escalate now";
  if (ticket.intent === "incident") return "Escalate incident";
  if (ticket.intent === "billing") return "Resolve billing path";
  if (ticket.intent === "churn") return "Save renewal";
  if (ticket.intent === "integration") return "Route to platform";
  return "Answer from macro";
}

function nextStepFor(ticket) {
  if (ticket.intent === "incident") {
    return "Collect incident scope, attach account context, and assign to on-call engineering.";
  }
  if (ticket.intent === "billing") {
    return "Verify account billing history, prepare adjustment options, and route to Billing.";
  }
  if (ticket.intent === "churn") {
    return "Flag renewal risk, summarize failure history, and route to Customer Success.";
  }
  if (ticket.intent === "integration") {
    return "Ask for logs, event IDs, and recent configuration changes before platform escalation.";
  }
  return "Send the prepared answer and mark for low-touch follow-up.";
}

function buildReply(ticket) {
  const copy = toneCopy[state.tone];
  const accountContext = `${ticket.customer} is on ${ticket.plan} at $${ticket.mrr.toLocaleString()} MRR.`;
  const nextStep = nextStepFor(ticket);

  return `${copy.opener}

I reviewed the ticket and classified it as ${ticket.priority.toUpperCase()} because of ${ticket.signals.join(", ") || "the request context"}. ${accountContext}

Next step: ${nextStep}

${copy.close}`;
}

function analyzeTickets() {
  state.analyzed = sampleTickets
    .map(scoreTicket)
    .sort((a, b) => b.score - a.score || b.mrr - a.mrr);
}

function visibleTickets() {
  if (state.filter === "all") return state.analyzed;
  if (state.filter === "billing") return state.analyzed.filter((ticket) => ticket.intent === "billing");
  if (state.filter === "churn") {
    return state.analyzed.filter((ticket) => ticket.intent === "churn" || ticket.signals.includes("revenue risk"));
  }
  return state.analyzed.filter((ticket) => ticket.priority === state.filter);
}

function priorityLabel(priority) {
  return priority.charAt(0).toUpperCase() + priority.slice(1);
}

function renderMetrics() {
  const highRisk = state.analyzed.filter((ticket) =>
    ["critical", "high"].includes(ticket.priority)
  ).length;
  const autosend = state.analyzed.filter((ticket) => ticket.confidence >= state.threshold).length;
  const hoursSaved = Math.round(state.analyzed.length * 0.33 * 10) / 10;

  document.querySelector("#metricTickets").textContent = state.analyzed.length;
  document.querySelector("#metricCritical").textContent = highRisk;
  document.querySelector("#metricAutosend").textContent = autosend;
  document.querySelector("#metricHours").textContent = `${hoursSaved}h`;
}

function renderTicketList() {
  const tickets = visibleTickets();
  const list = document.querySelector("#ticketList");
  document.querySelector("#queueCount").textContent = `${tickets.length} tickets`;

  if (!tickets.some((ticket) => ticket.id === state.selectedId) && tickets.length > 0) {
    state.selectedId = tickets[0].id;
  }

  list.innerHTML = tickets
    .map(
      (ticket) => `
        <button class="ticket-card ${ticket.id === state.selectedId ? "selected" : ""}" data-id="${ticket.id}" type="button">
          <div class="ticket-card-header">
            <span class="ticket-id">${ticket.id}</span>
            <span class="priority ${ticket.priority}">${priorityLabel(ticket.priority)}</span>
          </div>
          <h4>${ticket.subject}</h4>
          <p>${ticket.customer} - ${ticket.owner}</p>
          <div class="ticket-meta">
            <span>${ticket.intent}</span>
            <span>$${ticket.mrr.toLocaleString()} MRR</span>
            <span>${ticket.ageHours}h old</span>
          </div>
        </button>
      `
    )
    .join("");

  list.querySelectorAll(".ticket-card").forEach((card) => {
    card.addEventListener("click", () => {
      state.selectedId = card.dataset.id;
      render();
    });
  });
}

function renderDetail() {
  const selected = state.analyzed.find((ticket) => ticket.id === state.selectedId) || state.analyzed[0];
  const detail = document.querySelector("#ticketDetail");

  if (!selected) {
    detail.innerHTML = "<p>No tickets match this filter.</p>";
    return;
  }

  const reply = buildReply(selected);
  const readiness = selected.confidence >= state.threshold ? "Ready for auto-send" : "Needs human review";

  detail.innerHTML = `
    <div class="detail-header">
      <div>
        <span class="ticket-id">${selected.id}</span>
        <h3>${selected.subject}</h3>
        <p>${selected.customer} - ${selected.plan}</p>
      </div>
      <span class="priority ${selected.priority}">${priorityLabel(selected.priority)}</span>
    </div>

    <div class="decision-row">
      <div>
        <strong>${selected.score}</strong>
        <span>Risk score</span>
      </div>
      <div>
        <strong>${selected.confidence}%</strong>
        <span>Confidence</span>
      </div>
      <div>
        <strong>${selected.slaHoursRemaining}h</strong>
        <span>SLA remaining</span>
      </div>
    </div>

    <section class="analysis-block">
      <div class="section-heading">
        <h4>${actionFor(selected)}</h4>
        <span>${readiness}</span>
      </div>
      <p>${selected.body}</p>
      <div class="signal-list">
        ${selected.signals.map((signal) => `<span>${signal}</span>`).join("")}
      </div>
    </section>

    <section class="analysis-block">
      <div class="section-heading">
        <h4>Suggested reply</h4>
        <button id="copyReply" class="ghost-button" type="button">Copy</button>
      </div>
      <textarea id="replyDraft" spellcheck="false">${reply}</textarea>
    </section>

    <section class="routing-strip">
      <div>
        <span>Owner</span>
        <strong>${selected.owner}</strong>
      </div>
      <div>
        <span>Intent</span>
        <strong>${selected.intent}</strong>
      </div>
      <div>
        <span>Automation</span>
        <strong>${readiness}</strong>
      </div>
    </section>
  `;

  document.querySelector("#copyReply").addEventListener("click", async () => {
    const textarea = document.querySelector("#replyDraft");
    textarea.select();
    try {
      await navigator.clipboard.writeText(textarea.value);
    } catch {
      document.execCommand("copy");
    }
  });
}

function renderFilters() {
  document.querySelectorAll(".filter-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === state.filter);
  });
}

function render() {
  renderMetrics();
  renderFilters();
  renderTicketList();
  renderDetail();
}

function exportCsv() {
  const headers = [
    "id",
    "customer",
    "priority",
    "score",
    "confidence",
    "intent",
    "owner",
    "action",
  ];
  const rows = state.analyzed.map((ticket) => [
    ticket.id,
    ticket.customer,
    ticket.priority,
    ticket.score,
    `${ticket.confidence}%`,
    ticket.intent,
    ticket.owner,
    actionFor(ticket),
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "silent-ticket-triage.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function bindEvents() {
  document.querySelector("#confidence").addEventListener("input", (event) => {
    state.threshold = Number(event.target.value);
    document.querySelector("#confidenceValue").textContent = `${state.threshold}%`;
    render();
  });

  document.querySelector("#tone").addEventListener("change", (event) => {
    state.tone = event.target.value;
    renderDetail();
  });

  document.querySelector("#exportCsv").addEventListener("click", exportCsv);

  document.querySelectorAll(".filter-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      render();
    });
  });
}

analyzeTickets();
bindEvents();
render();
