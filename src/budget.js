// budget.js — DEPRECATED in favor of ./allowance.js.
//
// The original session-budget prototype used raw SPL Approve. That has a fatal flaw:
// only ONE delegate per token account, so an agent budget and any subscription on the
// same USDC balance overwrite each other. Solana's Foundation shipped an audited,
// mainnet program (De1eg…avR44, June 2026) that fixes exactly this. Use ./allowance.js,
// which builds on it. This file is kept only so older imports don't break.
export { USDC_MAINNET } from './allowance.js';
export { createSessionBudget, sessionAdapter, buildDelegateProbe } from './budget-legacy.js';
