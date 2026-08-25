# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are non-technical people and small operational teams who want to automate repetitive content/marketing work using AI agents, working from inside their IDE (Claude Code, Cursor, VS Code+Copilot, Codex, Antigravity, Gemini CLI, and others). Named segments: content creators (social/blog/newsletter), agencies and freelancers building reusable pipelines for multiple clients, marketing teams needing consistent output with human approval, HR teams (resume screening, internal comms, onboarding), and management teams (reports, presentations, dashboards from raw data). A large share of the audience comes from Comunidade Sem Codar, an AI school of 25k+ students focused on teaching non-technical people to use AI at work.

## Product Purpose

opensquad is a multi-agent orchestration framework: describe a workflow in natural language and it assembles a "squad" of specialized AI agents (e.g. Researcher, Strategist, Writer, Designer, Reviewer) that run as a pipeline with checkpoints, pausing for human approval before continuing. Success means a non-technical user can turn a plain-language request into a repeatable, reviewable automation for content, research, or operational work without writing code.

## Positioning

Distinct from single-prompt AI tools: opensquad's mechanism is a designed, reusable multi-agent pipeline (the "squad") with an Architect agent that interviews the user and assembles the team/pipeline, plus in-pipeline checkpoints for human approval before each stage proceeds. It runs directly inside the user's existing IDE rather than a separate hosted app.

## Operating Context

- Runs as a CLI installed via `npx opensquad init` inside a project directory, then driven through IDE slash commands (`/opensquad ...`).
- Squads execute as pipelines with checkpoints; enforcement of checkpoint pauses depends on the host IDE, not the framework itself.
- Sherlock investigator agent can browse reference profiles (Instagram, YouTube, Twitter/X, LinkedIn) via a persistent Playwright browser profile to extract real content patterns; first login per platform is manual, with optional persistent session cookies stored locally and never committed to git.
- The "Escritório Virtual" / Virtual Office is a generated 2D dashboard (web, Phaser-based) that visualizes agents working in real time; served locally (`npx serve squads/<name>/dashboard`) and opened in a browser.
- content-central-app is a separate web surface in this repo (content/reference management UI), distinct from the generated per-squad dashboard.
- Multiple IDE integrations are supported as distribution targets (Claude Code, Cursor, VS Code+Copilot, Codex, OpenCode, Antigravity, Gemini CLI, Qwen Code, Trae).

## Capabilities and Constraints

- Squad creation, running, listing, editing, and skill install/uninstall are all driven through the `/opensquad` command family.
- Token cost is usage-dependent and can be zero-cost on free/local stacks (Antigravity free tier, OpenCode + local LLMs) or paid on stacks like Claude Code/OpenAI API; Sherlock investigations and image generation are the most token-intensive operations.
- Open source, MIT licensed; free to use, study, and modify.

## Brand Commitments

- Product name "opensquad" and its core terminology (Squad, Agent, Checkpoint, Architect, Sherlock, Escritório Virtual / Virtual Office) are fixed and must be preserved in any surface copy or design work.
- Created and maintained by Renato Asse, founder of Comunidade Sem Codar; this affiliation is a stated fact of the project's origin.
- No logo, color palette, or visual identity is fixed yet — visual direction remains open for future design work.

## Evidence on Hand

- README.md (PT and EN) is the canonical description of the product, audience, and command set — treat it as source of truth for copy/terminology, not as a design reference.
- Existing generated dashboard and content-central-app are incumbent visual implementations; treat as evidence of current visual maturity, not as an approved design system.

## Product Principles

- Non-technical users must be able to go from a plain-language request to a working automation without touching code.
- Human approval stays in the loop: checkpoints between pipeline stages are a durable product commitment, not an incidental feature.
- The tool lives inside the user's own IDE and existing project — it is not a separate hosted destination.
- Free/local usage must remain genuinely viable; token cost and paid-stack dependency are always disclosed, never hidden.
- Terminology (Squad, Agent, Checkpoint, Architect, Sherlock, Escritório Virtual) is part of the product's identity and should stay consistent across every surface.
