# Cocktail Cabinet — Claude Code instructions

Read `WAVE1_REQUIREMENTS.md` and `WAVE2_REQUIREMENTS.md` in the repository root before doing development. These are snapshots of the Canvas assignments; newer instructor instructions take precedence when supplied.

Build the Cocktail Cabinet as a static HTML/CSS/JavaScript website. Do not add a custom application backend, place secrets in browser code, or create Anthropic API keys. Netlify will eventually deploy the integrated `main` branch on a domain the student owns.

## Parallel development boundaries

Other cloud sessions may work on this repository at the same time. Work on your own generated feature branch, not `main`, and do not merge or modify another workstream's branch.

- Wave 1 core agent: shared cabinet UI and six non-Imitation games.
- Imitation agent: isolated prototype in `prototypes/imitation/`.
- Wave 2 original-game agent: isolated prototype in `prototypes/wave2-original/`.

Keep shared files and other workstreams' directories untouched unless the student explicitly authorizes integration. Document how a prototype should be integrated rather than editing another agent's code. Prepare a pull request for later student review.

## External actions and approvals

**Do not send or publish any Slack messages, instructor DMs, emails, peer reviews, or Canvas submissions. Do not submit assignments or represent the student in course communications.** You may write suggested drafts for the student to inspect and post personally. Do not purchase a domain or services, change billing, enable paid credits, create credentials, deploy publicly, or change account/security settings without explicit student approval. Do not bypass permission controls.

## Working style and verification

Proceed autonomously with authorized code changes, testing, and documentation. Prefer small, testable milestones and useful commits to long speculative exploration. Avoid repeated whole-repository scans, unnecessary dependencies, and endless fix loops. If you fail on the same blocker repeatedly, preserve progress, document the issue and continue with independent tasks.

Run relevant automated tests and browser checks where available. Do not claim manual playtesting by the student, prior submissions, Slack reviews, working multiplayer, or Claude-in-browser AI integration unless actually verified. An agent-written test is not automatically proof that gameplay is fair or fun.

Do not pretend to know the remaining Claude plan quota; account limits may stop a cloud session. Do not enable paid usage. Report actual work completed, tests executed/results, commit/branch details, missing requirements, and any human checks needed.
