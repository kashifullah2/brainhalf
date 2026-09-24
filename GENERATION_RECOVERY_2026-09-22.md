# Generation recovery fix

## Confirmed failure

A real production test submitted a prompt and refreshed the page while generation was running. After reconnect, the browser displayed “No response received” and the same empty-reply explanation reported by the user. It received 947 stream frames and a completion event but ignored them because its local `isGenerating` flag had reset. The model had not failed.

The reported project was `proj-dd78d2a0-1be6-4ee8-b843-7a7decf4daea`. Its contents were not accessed or changed. Reproduction and live validation use separate private audit projects.

## Fix

- The project Durable Object retains a bounded snapshot of its active generation: request ID, model, prompt, visible response, start time, and file-change status. It sends that snapshot only after authorizing a reconnecting socket.
- The browser restores the pending conversation and generating state before awaiting workspace hydration, so incoming chunks cannot be dropped during that wait.
- Recovery does not resend the prompt or rewrite saved server history with an unfinished local placeholder.
- Before session history arrives, empty local placeholders display “Restoring your conversation…” instead of falsely declaring that the model finished.
- Network disconnects no longer count as model failures. Actual provider errors and genuinely empty completed replies retain their error handling.
- Stopped, superseded, and finished generations no longer expose an active snapshot. Visible response buffering is capped at 128,000 characters. Longer replies use a reconnect summary; completed replies remain persisted in the conversation.

The snapshot is ephemeral while the generation request is executing; completed conversation history is persisted in SQLite. This restores ordinary page refreshes and network reconnects. It does not make an in-flight provider request survive a Worker process crash or deployment restart.

## Validation

- Regression tests cover refresh before the first token and during streaming, continued reply rendering, one prompt submission, and no placeholder history rewrite.
- Server tests verify active output replay through an authorized connection, denial to an unauthenticated connection, persisted completion, and snapshot cleanup.
- Genuine empty-response recovery and retry behavior remains tested.
- Release and live verification results are recorded after deployment below.
