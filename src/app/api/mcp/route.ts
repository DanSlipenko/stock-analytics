import { createHash, timingSafeEqual } from 'crypto';
import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { registerPortfolioTools } from './tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

const sha256 = (value: string) => createHash('sha256').update(value).digest();

function isValidToken(candidate: string) {
  if (!MCP_AUTH_TOKEN) return false;
  return timingSafeEqual(sha256(candidate), sha256(MCP_AUTH_TOKEN));
}

const mcpHandler = createMcpHandler(registerPortfolioTools, {
  serverInfo: { name: 'stock-analytics', version: '1.1.0' },
  instructions:
    'Portfolio tools for this Stock Analytics app. Campaigns group holdings; each holding tracks shares bought, ' +
    'cost basis and sell transactions, so "remaining shares" is shares bought minus everything sold. ' +
    'Fees (e.g. Kraken, PayPal) are stored in dollars: a buy fee is added to cost basis and a sale fee is deducted ' +
    'from realized P&L; use set_fee to add or correct a fee on an existing buy or sale. ' +
    'Call list_campaigns first to get campaign ids, then get_campaign for holding ids. ' +
    'Write tools mutate the live portfolio database — confirm with the user before recording a purchase or sale. ' +
    'Tax planning: get_tax_plan returns income, business expenses, projections, property/deduction scenarios, a revision ' +
    'and a month-by-month breakdown (income, business expenses, QBI deduction, net, estimated tax, after-tax). The QBI deduction ' +
    'is estimated from 1099 profit unless a reviewed amount is set in the profile. Each income or expense entry ' +
    'is a full-year total (month 0) or one month (1–12), and holds one amount marked "projected" or "actual". ' +
    'Use update_tax_plan for requested changes with that revision; preview_tax_plan estimates without saving. ' +
    'Read the returned calculation assumptions. Unsold gains are excluded, and 2027 uses provisional 2026 parameters.',
});

// The tools write to the live portfolio database, so an unset token fails closed
// rather than serving an open read/write endpoint.
const handler = MCP_AUTH_TOKEN
  ? withMcpAuth(
      mcpHandler,
      (_req, bearerToken) =>
        bearerToken && isValidToken(bearerToken)
          ? { token: bearerToken, clientId: 'stock-analytics-mcp', scopes: ['portfolio'] }
          : undefined,
      { required: true }
    )
  : async () =>
      Response.json(
        { error: 'MCP endpoint disabled: set MCP_AUTH_TOKEN in the environment to enable it.' },
        { status: 503 }
      );

export { handler as GET, handler as POST, handler as DELETE };
