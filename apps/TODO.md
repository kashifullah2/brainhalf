# Studio app TODO

> Scoped to `apps/` — the AI coding studio. Nothing here refers to the
> document-extraction platform at the repository root. Moved out of the root,
> where it was titled "BrainHalf Code Fixes TODO" and read like a task list for
> the whole repository.

## Critical Errors (Breaking Bugs)

- [ ] 1. Fix TypeScript syntax error in auth.ts - invalid object syntax
- [ ] 2. Fix type annotation error in ai.ts - Record<string, string>
- [ ] 3. Remove unused Link import in AgentChat.tsx

## Logic & Runtime Errors

- [ ] 4. Fix parent folder resolution in agent-runner.ts - use path not just name
- [ ] 5. Fix WebContainer boot promise timing
- [ ] 6. Fix credit deduction race condition with transaction
- [ ] 7. Fix tool call delta ID mismatch in streaming.ts
- [ ] 8. Fix silent error swallowing

## Security Issues

- [ ] 9. Remove localStorage API key storage or encrypt it
- [ ] 10. Use unique salt per encryption

## Error Handling

- [ ] 11. Add null check for response body stream
- [ ] 12. Add React error boundaries
- [ ] 13. Add loading states for file operations
- [ ] 14. Add validation for tool arguments (path traversal check)

## Performance Issues

- [ ] 15. Memoize bubbleStyle object in MessageBubble
- [ ] 16. Cleanup WebContainer on unmount
- [ ] 17. Deduplicate npm install calls

## API & Data Issues

- [ ] 18. Remove duplicate user fetch in ai.ts
- [ ] 19. Add indexes on foreign keys in schema.ts
- [ ] 20. Add limit to message history

## Code Quality

- [ ] 21. Replace magic strings with constants
- [ ] 22. Replace @ts-ignore with proper import
- [ ] 23. Set up proper logging
- [ ] 24. Standardize error handling
- [ ] 25. Implement fetch_asset tool properly
