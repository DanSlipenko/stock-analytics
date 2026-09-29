'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from 'antd';
import { ChartNoAxesCombined } from 'lucide-react';
import MetaLine from '@/components/shared/MetaLine';
import { useStockQuotes } from '@/hooks/useStockQuote';
import { calculateTax } from '@/lib/tax/calculate';
import { isLongTerm, type TaxHolding, type TaxPortfolio } from '@/lib/tax/portfolio';
import type { TaxPlan } from '@/lib/tax/schema';
import { formatShares } from '@/lib/shares';
import { cn } from '@/lib/utils';
import {
  Capsule,
  Empty,
  Field,
  MoneyField,
  Section,
  Summary,
  percent,
  shortDate,
  signedUsd,
  tone,
  usd,
} from './controls';

const DAY = 86_400_000;

function SaleSimulator({
  plan,
  portfolio,
  holding,
  quote,
  onHolding,
}: {
  plan: TaxPlan;
  portfolio: TaxPortfolio;
  holding: TaxHolding | undefined;
  quote: (symbol: string) => number | undefined;
  onHolding: (holding: TaxHolding | undefined) => void;
}) {
  const [shares, setShares] = useState(holding?.shares ?? 0);
  const [price, setPrice] = useState(holding ? (quote(holding.symbol) ?? 0) : 0);
  const [fee, setFee] = useState(0);
  const [date, setDate] = useState(`${plan.year}-12-31`);
  const taxable = portfolio.holdings.filter((h) => !h.excluded);

  const valid =
    holding &&
    shares > 0 &&
    shares <= holding.shares + 1e-9 &&
    price > 0 &&
    date >= holding.bought.slice(0, 10) &&
    date.startsWith(String(plan.year)) &&
    Number.isFinite(new Date(date).getTime());
  const gain = valid ? shares * (price - holding.costPerShare) - fee : 0;
  const long = !!valid && isLongTerm(holding.bought, date);
  const before = calculateTax(plan, portfolio);
  const after = valid
    ? calculateTax(plan, portfolio, long ? { extraLongTerm: gain } : { extraShortTerm: gain })
    : before;
  const added = after.federalTax - before.federalTax;

  if (!taxable.length) {
    return <p className="campaigns-section-footnote">Add holdings to a taxable account to try a sale.</p>;
  }
  return (
    <div className="campaigns-panel tax-panel">
      <div className="tax-form-grid tax-form-grid-three">
        <Field label="Holding">
          <select
            value={holding?.id ?? ''}
            // The parent keys this form by holding, so choosing one starts fresh with its shares and price.
            onChange={(e) => onHolding(portfolio.holdings.find((h) => h.id === e.target.value))}
          >
            <option value="">Choose a holding</option>
            {taxable.map((h) => (
              <option key={h.id} value={h.id}>
                {h.symbol} · {h.account} · bought {shortDate(h.bought)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Shares to Sell" hint={holding ? `${formatShares(holding.shares)} available` : undefined}>
          <input
            type="number"
            min={0}
            max={holding?.shares}
            step="any"
            value={shares}
            onChange={(e) => setShares(Number(e.target.value))}
          />
        </Field>
        <MoneyField label="Sale Price per Share" value={price} onChange={(n) => setPrice(n ?? 0)} />
        <Field label="Sale Date">
          <input
            type="date"
            value={date}
            min={`${plan.year}-01-01`}
            max={`${plan.year}-12-31`}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <MoneyField label="Sale Fee" value={fee} onChange={(n) => setFee(n ?? 0)} />
      </div>
      {valid ? (
        <dl className="tax-rows tax-result">
          <div>
            <dt>{long ? 'Long-term' : 'Short-term'} gain</dt>
            <dd className={cn(tone(gain) && `tax-${tone(gain)}`)}>{signedUsd(gain)}</dd>
          </div>
          <div>
            <dt>Added federal tax</dt>
            <dd>
              {signedUsd(added)}
              {gain > 0 && <small> · {percent(added / gain)} of the gain</small>}
            </dd>
          </div>
          <div className="tax-total-row">
            <dt>Cash after tax</dt>
            <dd>{usd(shares * price - fee - added)}</dd>
          </div>
        </dl>
      ) : (
        holding && (
          <p className="tax-notice">
            Enter a price, up to {formatShares(holding.shares)} shares, and a {plan.year} date after the purchase.
          </p>
        )
      )}
      <p className="tax-footnote">
        A what-if only: nothing is sold or saved. Uses your full-year forecast; state tax and wash sales aren’t
        included.
      </p>
    </div>
  );
}

export default function Investments({ plan, portfolio }: { plan: TaxPlan; portfolio: TaxPortfolio }) {
  const symbols = useMemo(() => [...new Set(portfolio.holdings.map((h) => h.symbol))], [portfolio.holdings]);
  const { quotes, loading } = useStockQuotes(symbols);
  const [simulated, setSimulated] = useState<TaxHolding>();
  const simulatorRef = useRef<HTMLDivElement>(null);
  const quote = (symbol: string) => quotes[symbol]?.currentPrice || undefined;

  const today = new Date().toISOString().slice(0, 10);
  // "Sold today" only lands in this plan's year when the plan is for the current year.
  const planIsThisYear = today.startsWith(String(plan.year));

  const holdings = useMemo(() => {
    const base = calculateTax(plan, portfolio).federalTax;
    const taxOn = (gain: number, long: boolean) =>
      calculateTax(plan, portfolio, long ? { extraLongTerm: gain } : { extraShortTerm: gain }).federalTax - base;
    return portfolio.holdings
      .map((h) => {
        const price = quotes[h.symbol]?.currentPrice || undefined;
        const gain = price === undefined ? undefined : h.shares * (price - h.costPerShare);
        const long = today >= h.longTermFrom;
        const taxToday = gain !== undefined && planIsThisYear && !h.excluded ? taxOn(gain, long) : undefined;
        // Waiting only helps inside the same tax year; after Dec 31 the sale lands in another plan.
        const waitSaving =
          taxToday !== undefined && !long && gain! > 0 && h.longTermFrom.startsWith(String(plan.year))
            ? taxToday - taxOn(gain!, true)
            : undefined;
        return {
          ...h,
          gain,
          long,
          taxToday,
          waitSaving,
          daysToLong: long ? 0 : Math.ceil((Date.parse(h.longTermFrom) - Date.parse(today)) / DAY),
        };
      })
      .sort((a, b) => Number(a.excluded) - Number(b.excluded) || a.symbol.localeCompare(b.symbol));
  }, [plan, portfolio, quotes, today, planIsThisYear]);

  const taxable = holdings.filter((h) => !h.excluded);
  const priced = taxable.filter((h) => h.gain !== undefined);
  const unrealized = priced.reduce((sum, h) => sum + h.gain!, 0);
  const linked = plan.profile.stockSource === 'portfolio';

  const simulate = (holding: TaxHolding) => {
    setSimulated(holding);
    simulatorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <>
      <Summary
        className="tax-summary-4"
        hero={{
          label: `Realized in ${plan.year}`,
          value: signedUsd(portfolio.shortTerm + portfolio.longTerm),
          tone: tone(portfolio.shortTerm + portfolio.longTerm),
          detail: linked ? 'Counted in your estimate' : 'Not counted: reported 1099-B totals are used instead',
        }}
        cells={[
          { label: 'Short-Term', value: signedUsd(portfolio.shortTerm), detail: 'Ordinary income rates' },
          { label: 'Long-Term', value: signedUsd(portfolio.longTerm), detail: 'Held more than a year' },
          {
            label: 'Unrealized',
            value:
              loading && !priced.length && taxable.length
                ? '…'
                : priced.length || !taxable.length
                  ? signedUsd(unrealized)
                  : '—',
            detail:
              priced.length < taxable.length
                ? `${taxable.length - priced.length} without a live price`
                : 'Open positions, not taxed until sold',
          },
        ]}
      />

      <Section
        id="tax-open-title"
        title="Open Positions"
        count={holdings.length}
        footnote={
          planIsThisYear
            ? 'Tax if sold today is the added federal tax on top of your forecast, at today’s price.'
            : `Holding periods as of today. Tax-if-sold figures appear when you plan the current year.`
        }
      >
        <div className="campaigns-panel">
          {holdings.length ? (
            <ul className="tax-list">
              {holdings.map((h) => (
                <li key={h.id} className={cn('tax-list-row', h.excluded && 'tax-list-row-muted')}>
                  <div className="tax-list-main">
                    <div className="tax-list-title">
                      <Link href={`/campaigns/${h.campaignId}`} className="tax-symbol">
                        {h.symbol}
                      </Link>
                      {h.excluded ? (
                        <Capsule>Not taxable</Capsule>
                      ) : (
                        <Capsule>{h.long ? 'Long-term' : 'Short-term'}</Capsule>
                      )}
                    </div>
                    <MetaLine
                      className="tax-list-meta"
                      parts={[
                        h.account,
                        `${formatShares(h.shares)} shares`,
                        `bought ${shortDate(h.bought)}`,
                        ...(!h.long && !h.excluded
                          ? [
                              `long-term ${shortDate(h.longTermFrom)} · ${h.daysToLong} ${h.daysToLong === 1 ? 'day' : 'days'}`,
                            ]
                          : []),
                      ]}
                    />
                    {h.waitSaving !== undefined && h.waitSaving >= 1 && (
                      <p className="tax-list-hint">
                        Waiting until {shortDate(h.longTermFrom)} would save about {usd(h.waitSaving)}.
                      </p>
                    )}
                  </div>
                  <div className="tax-list-figures">
                    <span
                      className={cn('tax-list-value', h.gain !== undefined && tone(h.gain) && `tax-${tone(h.gain)}`)}
                    >
                      {h.gain === undefined ? (loading ? '…' : 'No price') : signedUsd(h.gain)}
                    </span>
                    {h.taxToday !== undefined && <small>{usd(h.taxToday)} tax if sold today</small>}
                  </div>
                  <div className="tax-row-actions">
                    {!h.excluded && (
                      <Button type="text" onClick={() => simulate(h)}>
                        Try a Sale
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={<ChartNoAxesCombined size={28} strokeWidth={1.6} />} title="No Open Positions">
              Stocks you still hold in your campaigns appear here.
            </Empty>
          )}
        </div>
      </Section>

      <Section
        id="tax-sales-title"
        title={`Sold in ${plan.year}`}
        count={portfolio.sales.length}
        footnote="Buy and sale fees are part of each gain. Check against your broker’s 1099-B: wash-sale adjustments aren’t applied."
      >
        <div className="campaigns-panel">
          {portfolio.sales.length ? (
            <ul className="tax-list">
              {portfolio.sales.map((s) => (
                <li key={`${s.holdingId}-${s.id}`} className={cn('tax-list-row', s.excluded && 'tax-list-row-muted')}>
                  <div className="tax-list-main">
                    <div className="tax-list-title">
                      <Link href={`/campaigns/${s.campaignId}`} className="tax-symbol">
                        {s.symbol}
                      </Link>
                      {s.excluded ? (
                        <Capsule>Not taxable</Capsule>
                      ) : (
                        <Capsule>{s.term === 'long' ? 'Long-term' : 'Short-term'}</Capsule>
                      )}
                    </div>
                    <MetaLine
                      className="tax-list-meta"
                      parts={[
                        s.account,
                        `sold ${shortDate(s.date)}`,
                        `${formatShares(s.shares)} shares`,
                        `${usd(s.proceeds, 2)} proceeds`,
                        `${usd(s.basis, 2)} basis`,
                      ]}
                    />
                  </div>
                  <div className="tax-list-figures">
                    <span className={cn('tax-list-value', tone(s.gain) && `tax-${tone(s.gain)}`)}>
                      {signedUsd(s.gain, 2)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={<ChartNoAxesCombined size={28} strokeWidth={1.6} />} title={`No Sales in ${plan.year}`}>
              Sales you record in your campaigns appear here automatically.
            </Empty>
          )}
        </div>
      </Section>

      <div ref={simulatorRef} className="tax-scroll-target">
        <Section
          id="tax-simulator-title"
          title="Before You Sell"
          footnote="See what selling part of a position would add to your tax."
        >
          <SaleSimulator
            key={simulated?.id ?? 'none'}
            plan={plan}
            portfolio={portfolio}
            holding={simulated}
            quote={quote}
            onHolding={setSimulated}
          />
        </Section>
      </div>
    </>
  );
}
