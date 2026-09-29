import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { getTaxContext, saveTaxMutation, TaxPlanConflict } from '@/lib/tax/service';
import { errorMessage, taxYearSchema, writeSchema } from '@/lib/tax/schema';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ year: string }> };
const headers = { 'Cache-Control': 'private, no-store' };
function failure(error: unknown) {
  if (error instanceof ZodError)
    return NextResponse.json({ error: errorMessage(error, 'Invalid tax plan.') }, { status: 400, headers });
  if (error instanceof SyntaxError) return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400, headers });
  if (error instanceof TaxPlanConflict) return NextResponse.json({ error: error.message }, { status: 409, headers });
  console.error('Tax plan request failed:', error instanceof Error ? error.name : 'unknown');
  return NextResponse.json({ error: 'Could not access the tax plan. Try again.' }, { status: 500, headers });
}
export async function GET(_request: NextRequest, context: Context) {
  try {
    return NextResponse.json(await getTaxContext(taxYearSchema.parse(Number((await context.params).year))), {
      headers,
    });
  } catch (error) {
    return failure(error);
  }
}
export async function PATCH(request: NextRequest, context: Context) {
  try {
    if (Number(request.headers.get('content-length') || 0) > 1_000_000)
      return NextResponse.json({ error: 'Request too large.' }, { status: 413, headers });
    const text = await request.text();
    if (text.length > 1_000_000) return NextResponse.json({ error: 'Request too large.' }, { status: 413, headers });
    const year = taxYearSchema.parse(Number((await context.params).year));
    const { revision, mutation } = writeSchema.parse(JSON.parse(text));
    const plan = await saveTaxMutation(year, revision, mutation);
    return NextResponse.json(plan, { headers });
  } catch (error) {
    return failure(error);
  }
}
