# Agent performance controls

Generation settings under Project console → Project settings → Advanced generation settings are read when each prompt is sent, including after changing settings without reloading the workspace. Settings are saved in this browser per account and project.

Recommended defaults are 16,384 output tokens per provider call, six tool rounds, and a ten-minute generation deadline. The selected provider's output ceiling and the account allowance still apply. Existing saved settings are preserved; use **Restore recommended limits** to replace earlier small limits such as 1,400 tokens. A shorter timeout stops unfinished work; it does not make a provider faster.

**Fast mode**, enabled by default for new settings, reduces the initial source context from 64,000 to 24,000 characters and older conversation from 28,000 to 12,000 characters. The current request is preserved, relevant source remains ranked, and additional files can be read through tools. Fast mode keeps the selected model and output limit. Smaller context may require additional reads for large changes. For DeepSeek V4 Pro and GLM 5.3 Flash, fast mode disables the documented optional reasoning during tool turns and final responses. Turning fast mode off enables it. This preserves the selected model; live latency still depends on the provider.

The Cloudflare tool loop batches up to four consecutive local read-only operations. Writes, attachment imports, and remote MCP tools remain ordered barriers. Partial streamed arguments never execute. Both provider paths enforce the configured tool-round limit and allow one final response without tools. Native SDK retries are disabled so provider outages return promptly; existing explicit model-profile and token-limit compatibility handling remains bounded.

Outcome analytics are written to the durable outbox and a retry schedule is registered before delivery runs through `waitUntil`. Analytics network latency does not block generation or completion. AI allowance checks and lease cleanup remain required.

Project console → AI usage shows first-response latency and provider calls for new completed generations. First response is measured from server generation start to the first text or tool activity; it excludes earlier browser connection and hosting checks. Provider calls count attempts, including explicit retries. Historical rows display missing measurements rather than estimates.

Regression coverage uses controlled provider streams and real in-memory SQLite to exercise completion, deadlines, cancellation, read/write ordering, token limits, latency migration, and durable analytics recovery. These checks do not establish a live-provider speedup; compare first-response and total duration on representative projects after deployment.

Browser-stage timing is available under Project settings → Generation timing. It separates sending, server acceptance, model invocation and first useful activity. These local records contain no prompts or source. Preview timing is an activity indicator, not proof of functional correctness.
