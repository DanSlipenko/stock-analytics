import { z } from 'zod';
import { isValidObjectId } from 'mongoose';
import type { McpServer } from '@modelcontextprotocol/server';
import dbConnect from '@/lib/mongodb';
import CampaignModel from '@/models/Campaign';
import PriceAlert from '@/models/PriceAlert';
import WatchlistItem from '@/models/WatchlistItem';
import { calculateCampaignStats } from '@/lib/campaignStats';
import { getQuote, getQuotes } from '@/lib/quotes';
import { sharesForPercent } from '@/lib/shares';
import {
  getRemainingShares,
  isSoldOut,
  getRealizedPnL,
  resolveAssetLocation,
  institutionOf,
  normalizeName,
} from '@/lib/assets';
import type { Campaign, CampaignStock } from '@/types';

/** Mongoose lean docs carry Dates and ObjectIds; the app's types expect strings. */
function serialize<T>(doc: unknown): T {
  return JSON.parse(JSON.stringify(doc)) as T;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

function jsonResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

async function loadCampaigns(): Promise<Campaign[]> {
  await dbConnect();
  return serialize<Campaign[]>(await CampaignModel.find({}).sort({ startDate: -1 }).lean());
}

/** Accepts a campaign _id or a name (exact match first, then unique substring). */
function resolveCampaign(campaigns: Campaign[], ref: string): Campaign | { error: string } {
  const byId = campaigns.find((c) => c._id === ref);
  if (byId) return byId;

  const norm = normalizeName(ref);
  const exact = campaigns.filter((c) => normalizeName(c.name) === norm);
  if (exact.length === 1) return exact[0];

  const partial = campaigns.filter((c) => normalizeName(c.name).includes(norm));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    return { error: `"${ref}" matches several campaigns: ${partial.map((c) => c.name).join(', ')}. Use the campaign id.` };
  }

  return { error: `No campaign matches "${ref}". Known campaigns: ${campaigns.map((c) => c.name).join(', ') || '(none)'}` };
}

/** Accepts a holding _id or a symbol that is unambiguous within the campaign. */
function resolveHolding(campaign: Campaign, ref: string): CampaignStock | { error: string } {
  const byId = campaign.stocks.find((s) => s._id === ref);
  if (byId) return byId;

  const matches = campaign.stocks.filter((s) => s.symbol.toLowerCase() === ref.toLowerCase());
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    return {
      error: `${campaign.name} holds ${ref} in ${matches.length} separate lots. Pass holdingId instead — ids: ${matches
        .map((s) => `${s._id} (${getRemainingShares(s)} shares @ $${s.buyPrice})`)
        .join(', ')}`,
    };
  }

  return { error: `${campaign.name} has no holding matching "${ref}".` };
}

function describeHolding(stock: CampaignStock, campaign: Campaign, currentPrice?: number) {
  const remaining = getRemainingShares(stock);
  const location = campaign.moneyLocations.find((l) => l._id === stock.locationId);
  const price = currentPrice ?? stock.buyPrice;

  return {
    holdingId: stock._id,
    symbol: stock.symbol,
    sharesBought: stock.shares,
    sharesRemaining: remaining,
    buyPrice: stock.buyPrice,
    buyDate: stock.buyDate,
    asset: location ? institutionOf(location) : null,
    currentPrice: currentPrice ?? null,
    marketValue: currentPrice != null ? round2(remaining * currentPrice) : null,
    unrealizedPnL: round2(remaining * (price - stock.buyPrice)),
    realizedPnL: round2(getRealizedPnL(stock)),
    soldOut: remaining <= 0,
    isStarred: Boolean(stock.isStarred),
    prepareToSell: Boolean(stock.prepareToSell),
    transactions: stock.transactions.map((t) => ({
      date: t.date,
      shares: t.shares,
      price: t.price,
      percentSold: t.percentSold,
    })),
    priceAlerts: (stock.notifications || []).map((n) => ({
      direction: n.type,
      targetPrice: n.targetPrice ?? null,
      targetPercent: n.targetPercent ?? null,
      referencePrice: n.referencePrice,
    })),
  };
}

async function saveStocks(campaignId: string, stocks: CampaignStock[]) {
  await CampaignModel.findByIdAndUpdate(campaignId, { $set: { stocks } }, { new: true, runValidators: true });
}

export function registerPortfolioTools(server: McpServer) {
  // ---- Read ----

  server.registerTool(
    'list_campaigns',
    {
      title: 'List campaigns',
      description:
        'List every investment campaign with live P&L: invested capital, current market value, realized and unrealized gains. Start here to find a campaign id.',
      inputSchema: z.object({
        includeClosed: z.boolean().optional().describe('Include campaigns marked as closed. Defaults to false.'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ includeClosed }) => {
      const all = await loadCampaigns();
      const campaigns = includeClosed ? all : all.filter((c) => !c.closed);
      const quotes = await getQuotes(campaigns.flatMap((c) => c.stocks.map((s) => s.symbol)));

      return jsonResult(
        campaigns.map((campaign) => {
          const stats = calculateCampaignStats(campaign, quotes);
          return {
            campaignId: campaign._id,
            name: campaign.name,
            startDate: campaign.startDate,
            closed: Boolean(campaign.closed),
            holdings: campaign.stocks.length,
            openHoldings: campaign.stocks.filter((s) => getRemainingShares(s) > 0).length,
            invested: round2(stats.invested),
            currentValue: round2(stats.currentValue),
            realizedPnL: round2(stats.realized),
            totalPnL: round2(stats.pnl),
            totalPnLPercent: round2(stats.pnlPercent),
          };
        })
      );
    }
  );

  server.registerTool(
    'get_campaign',
    {
      title: 'Get campaign detail',
      description:
        'Full detail for one campaign: every holding with remaining shares, cost basis, live price, realized/unrealized P&L, sale history and price alerts.',
      inputSchema: z.object({
        campaign: z.string().describe('Campaign id or name.'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ campaign: ref }) => {
      const campaigns = await loadCampaigns();
      const campaign = resolveCampaign(campaigns, ref);
      if ('error' in campaign) return errorResult(campaign.error);

      const quotes = await getQuotes(campaign.stocks.map((s) => s.symbol));
      const stats = calculateCampaignStats(campaign, quotes);

      return jsonResult({
        campaignId: campaign._id,
        name: campaign.name,
        startDate: campaign.startDate,
        closed: Boolean(campaign.closed),
        invested: round2(stats.invested),
        currentValue: round2(stats.currentValue),
        realizedPnL: round2(stats.realized),
        totalPnL: round2(stats.pnl),
        totalPnLPercent: round2(stats.pnlPercent),
        assets: campaign.moneyLocations.map((l) => institutionOf(l)),
        holdings: campaign.stocks.map((s) => describeHolding(s, campaign, quotes[s.symbol]?.currentPrice)),
      });
    }
  );

  server.registerTool(
    'get_portfolio_summary',
    {
      title: 'Get portfolio summary',
      description:
        'Portfolio-wide totals across all campaigns, plus a per-symbol breakdown aggregating the same symbol held in different campaigns.',
      inputSchema: z.object({
        includeClosed: z.boolean().optional().describe('Include campaigns marked as closed. Defaults to false.'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ includeClosed }) => {
      const all = await loadCampaigns();
      const campaigns = includeClosed ? all : all.filter((c) => !c.closed);
      const quotes = await getQuotes(campaigns.flatMap((c) => c.stocks.map((s) => s.symbol)));

      const totals = campaigns.reduce(
        (sum, campaign) => {
          const stats = calculateCampaignStats(campaign, quotes);
          return {
            invested: sum.invested + stats.invested,
            currentValue: sum.currentValue + stats.currentValue,
            realized: sum.realized + stats.realized,
            costBasis: sum.costBasis + stats.costBasis,
            pnl: sum.pnl + stats.pnl,
          };
        },
        { invested: 0, currentValue: 0, realized: 0, costBasis: 0, pnl: 0 }
      );

      const bySymbol = new Map<string, { shares: number; cost: number; value: number; realized: number }>();
      for (const campaign of campaigns) {
        for (const stock of campaign.stocks) {
          const remaining = getRemainingShares(stock);
          const price = quotes[stock.symbol]?.currentPrice ?? stock.buyPrice;
          const entry = bySymbol.get(stock.symbol) ?? { shares: 0, cost: 0, value: 0, realized: 0 };
          entry.shares += remaining;
          entry.cost += remaining * stock.buyPrice;
          entry.value += remaining * price;
          entry.realized += getRealizedPnL(stock);
          bySymbol.set(stock.symbol, entry);
        }
      }

      return jsonResult({
        campaigns: campaigns.length,
        invested: round2(totals.invested),
        currentValue: round2(totals.currentValue),
        realizedPnL: round2(totals.realized),
        unrealizedPnL: round2(totals.currentValue - totals.invested),
        totalPnL: round2(totals.pnl),
        totalPnLPercent: totals.costBasis > 0 ? round2((totals.pnl / totals.costBasis) * 100) : 0,
        positions: Array.from(bySymbol.entries())
          .map(([symbol, entry]) => ({
            symbol,
            sharesRemaining: round2(entry.shares),
            costBasis: round2(entry.cost),
            marketValue: round2(entry.value),
            unrealizedPnL: round2(entry.value - entry.cost),
            realizedPnL: round2(entry.realized),
            currentPrice: quotes[symbol]?.currentPrice ?? null,
          }))
          .sort((a, b) => b.marketValue - a.marketValue),
      });
    }
  );

  server.registerTool(
    'get_quote',
    {
      title: 'Get live quote',
      description:
        'Live market quote for a symbol. Use a plain ticker for stocks (AAPL) and the BINANCE: form for crypto (BINANCE:BTCUSDT).',
      inputSchema: z.object({
        symbol: z.string().describe('Ticker, e.g. AAPL or BINANCE:ZECUSDT.'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ symbol }) => {
      const quote = await getQuote(symbol);
      if (!quote) return errorResult(`No quote available for "${symbol}".`);
      return jsonResult({ symbol, ...quote });
    }
  );

  server.registerTool(
    'list_alerts',
    {
      title: 'List price alerts',
      description: 'List standalone price alerts (the ones shown in the app\'s Alerts page and notification bell).',
      inputSchema: z.object({
        includeTriggered: z.boolean().optional().describe('Include alerts that have already fired. Defaults to false.'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ includeTriggered }) => {
      await dbConnect();
      const filter = includeTriggered ? {} : { triggered: false };
      const alerts = serialize<Array<Record<string, unknown>>>(
        await PriceAlert.find(filter).sort({ createdAt: -1 }).lean()
      );

      return jsonResult(
        alerts.map((a) => ({
          alertId: a._id,
          symbol: a.symbol,
          direction: a.type,
          targetPrice: a.targetPrice ?? null,
          targetPercent: a.targetPercent ?? null,
          referencePrice: a.referencePrice,
          triggered: a.triggered,
          createdAt: a.createdAt,
        }))
      );
    }
  );

  server.registerTool(
    'list_watchlist',
    {
      title: 'List watchlist',
      description: 'Symbols on the watchlist with their target buy prices, notes, and current price.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      await dbConnect();
      const items = serialize<Array<Record<string, unknown>>>(
        await WatchlistItem.find({}).sort({ createdAt: -1 }).lean()
      );
      const quotes = await getQuotes(items.map((i) => String(i.symbol)));

      return jsonResult(
        items.map((i) => ({
          itemId: i._id,
          symbol: i.symbol,
          targetBuyPrice: i.targetBuyPrice,
          notes: i.notes,
          currentPrice: quotes[String(i.symbol)]?.currentPrice ?? null,
        }))
      );
    }
  );

  // ---- Write ----

  server.registerTool(
    'add_holding',
    {
      title: 'Add a holding',
      description:
        'Record a purchase: adds a new holding to a campaign. Creates the asset/account on the campaign if it does not exist yet.',
      inputSchema: z.object({
        campaign: z.string().describe('Campaign id or name.'),
        symbol: z.string().describe('Ticker, e.g. AAPL or BINANCE:ZECUSDT.'),
        shares: z.number().positive().describe('Number of shares/units bought.'),
        buyPrice: z.number().positive().describe('Price paid per share/unit.'),
        asset: z.string().describe('Account holding this position, e.g. "Fidelity Dan".'),
        buyDate: z.string().optional().describe('ISO date of the purchase. Defaults to now.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ campaign: ref, symbol, shares, buyPrice, asset, buyDate }) => {
      const campaigns = await loadCampaigns();
      const campaign = resolveCampaign(campaigns, ref);
      if ('error' in campaign) return errorResult(campaign.error);

      const { locationId, moneyLocations } = resolveAssetLocation(campaign, asset);
      const newStock = {
        symbol: symbol.toUpperCase(),
        shares,
        buyPrice,
        buyDate: buyDate ? new Date(buyDate).toISOString() : new Date().toISOString(),
        locationId,
        transactions: [],
      };

      await CampaignModel.findByIdAndUpdate(
        campaign._id,
        { $set: { stocks: [...campaign.stocks, newStock], moneyLocations } },
        { new: true, runValidators: true }
      );

      return jsonResult({
        added: true,
        campaign: campaign.name,
        symbol: newStock.symbol,
        shares,
        buyPrice,
        asset,
        costBasis: round2(shares * buyPrice),
      });
    }
  );

  server.registerTool(
    'record_sale',
    {
      title: 'Record a sale',
      description:
        'Record a sell against an existing holding. Give either shares or percent (of the remaining position). Selling the position out clears its price alerts, matching the app.',
      inputSchema: z.object({
        campaign: z.string().describe('Campaign id or name.'),
        holding: z.string().describe('Holding id (from get_campaign) or ticker if the campaign holds only one lot of it.'),
        sellPrice: z.number().positive().describe('Price received per share/unit.'),
        shares: z.number().positive().optional().describe('Exact number of shares to sell.'),
        percent: z.number().min(0.01).max(100).optional().describe('Percent of the remaining position to sell. Ignored if shares is given.'),
        sellDate: z.string().optional().describe('ISO date of the sale. Defaults to now.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ campaign: ref, holding: holdingRef, sellPrice, shares, percent, sellDate }) => {
      if (shares == null && percent == null) {
        return errorResult('Give either shares or percent.');
      }

      const campaigns = await loadCampaigns();
      const campaign = resolveCampaign(campaigns, ref);
      if ('error' in campaign) return errorResult(campaign.error);

      const stock = resolveHolding(campaign, holdingRef);
      if ('error' in stock) return errorResult(stock.error);

      const remaining = getRemainingShares(stock);
      if (remaining <= 0) return errorResult(`${stock.symbol} in ${campaign.name} is already fully sold.`);

      const sharesToSell = shares != null ? shares : sharesForPercent(remaining, percent as number);

      if (sharesToSell > remaining + 1e-9) {
        return errorResult(`Cannot sell ${sharesToSell} shares — only ${remaining} remain in that lot.`);
      }

      const transaction = {
        type: 'sell' as const,
        shares: sharesToSell,
        price: sellPrice,
        date: sellDate ? new Date(sellDate).toISOString() : new Date().toISOString(),
        percentSold: Math.round((sharesToSell / remaining) * 100),
      };

      let clearedAlerts = 0;
      const updatedStocks = campaign.stocks.map((s) => {
        if (s._id !== stock._id) return s;

        const nextTransactions = [...s.transactions, transaction];
        const soldOut = isSoldOut({ ...s, transactions: nextTransactions });

        if (soldOut && (s.notifications?.length ?? 0) > 0) {
          clearedAlerts = s.notifications!.length;
          return { ...s, transactions: nextTransactions, notifications: [] };
        }
        return { ...s, transactions: nextTransactions };
      });

      await saveStocks(campaign._id!, updatedStocks);

      return jsonResult({
        recorded: true,
        campaign: campaign.name,
        symbol: stock.symbol,
        sharesSold: sharesToSell,
        sellPrice,
        proceeds: round2(sharesToSell * sellPrice),
        realizedPnL: round2(sharesToSell * (sellPrice - stock.buyPrice)),
        sharesRemaining: round2(remaining - sharesToSell),
        soldOut: remaining - sharesToSell <= 1e-9,
        clearedPriceAlerts: clearedAlerts,
      });
    }
  );

  server.registerTool(
    'create_alert',
    {
      title: 'Create a price alert',
      description:
        'Create a standalone price alert for a symbol. Give either targetPrice or targetPercent (percent move from the current price).',
      inputSchema: z.object({
        symbol: z.string().describe('Ticker, e.g. AAPL or BINANCE:ZECUSDT.'),
        direction: z.enum(['above', 'below']).describe('Fire when the price goes above or below the target.'),
        targetPrice: z.number().positive().optional().describe('Absolute price target.'),
        targetPercent: z.number().optional().describe('Percent move from the current price.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ symbol, direction, targetPrice, targetPercent }) => {
      if (targetPrice == null && targetPercent == null) {
        return errorResult('Give either targetPrice or targetPercent.');
      }

      const quote = await getQuote(symbol);
      if (!quote) return errorResult(`No quote available for "${symbol}", so the alert has no reference price.`);

      await dbConnect();
      const alert = await PriceAlert.create({
        symbol: symbol.toUpperCase(),
        type: direction,
        targetPrice,
        targetPercent,
        referencePrice: quote.currentPrice,
        triggered: false,
      });

      return jsonResult({
        created: true,
        alertId: String(alert._id),
        symbol: alert.symbol,
        direction,
        targetPrice: targetPrice ?? null,
        targetPercent: targetPercent ?? null,
        referencePrice: quote.currentPrice,
      });
    }
  );

  server.registerTool(
    'delete_alert',
    {
      title: 'Delete a price alert',
      description: 'Permanently delete a standalone price alert. Get the id from list_alerts.',
      inputSchema: z.object({
        alertId: z.string().describe('Alert id from list_alerts.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ alertId }) => {
      if (!isValidObjectId(alertId)) return errorResult(`"${alertId}" is not a valid alert id. Get ids from list_alerts.`);
      await dbConnect();
      const deleted = await PriceAlert.findByIdAndDelete(alertId);
      if (!deleted) return errorResult(`No alert with id "${alertId}".`);
      return jsonResult({ deleted: true, alertId, symbol: deleted.symbol });
    }
  );

  server.registerTool(
    'add_watchlist_item',
    {
      title: 'Add to watchlist',
      description: 'Add a symbol to the watchlist with a target buy price.',
      inputSchema: z.object({
        symbol: z.string().describe('Ticker, e.g. AAPL or BINANCE:ZECUSDT.'),
        targetBuyPrice: z.number().positive().describe('Price you would buy at.'),
        notes: z.string().optional().describe('Free-form note.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ symbol, targetBuyPrice, notes }) => {
      await dbConnect();
      const item = await WatchlistItem.create({
        symbol: symbol.toUpperCase(),
        targetBuyPrice,
        notes: notes ?? '',
      });

      return jsonResult({
        added: true,
        itemId: String(item._id),
        symbol: item.symbol,
        targetBuyPrice,
        notes: item.notes,
      });
    }
  );

  server.registerTool(
    'remove_watchlist_item',
    {
      title: 'Remove from watchlist',
      description: 'Remove a symbol from the watchlist. Get the id from list_watchlist.',
      inputSchema: z.object({
        itemId: z.string().describe('Watchlist item id from list_watchlist.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ itemId }) => {
      if (!isValidObjectId(itemId)) return errorResult(`"${itemId}" is not a valid watchlist id. Get ids from list_watchlist.`);
      await dbConnect();
      const deleted = await WatchlistItem.findByIdAndDelete(itemId);
      if (!deleted) return errorResult(`No watchlist item with id "${itemId}".`);
      return jsonResult({ removed: true, itemId, symbol: deleted.symbol });
    }
  );
}
