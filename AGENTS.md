# Dhee Desktop agent guidance

Desktop is the primary product workspace. Reuse Dhee Core's engine, MCP and existing creative/authoring guides; change Core only for a necessary shared capability or fix.

For Dhee production tasks, read `.agents/skills/dhee-production/SKILL.md`. It maps existing Core guidance to the current MCP interface without assuming embedded agent tools are MCP tools. The resolver reads the companion Core checkout (or `dhee_CORE_PATH` / `dhee_INK_PATH`) rather than duplicating guide content.

Run `npm run audit:core-integration` to inspect live local MCP discovery, guidance inventory and packaging declarations. This is read-only; its known gaps and untested areas are not passes. Run `npm run test:core-guides` after changing the resolver. Existing Desktop test instructions remain in `.claude/skills/test-loop/SKILL.md`.

Follow the session's local-verification and push permissions. A successful single scene is not full-film acceptance. Preserve approved source audio, exact selected targets and all three creative approvals.
