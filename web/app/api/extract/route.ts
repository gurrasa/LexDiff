import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { rateLimited } from '@/lib/rate-limit'
import { escrowTermsSchema } from '@/lib/terms'

// AI extraction runs here, outside the CRE workflow: LLM output is not deterministic enough for
// DON consensus. The result is a draft that counsel reviews before its hash is registered on-chain.

// Created on first use so a build without ANTHROPIC_API_KEY (e.g. on a host) never fails.
let client: Anthropic | null = null

const SYSTEM = `You extract the operative terms of an escrow agreement into structured data for a tool that compares the agreement with the smart contract meant to enforce it.

Rules:
- Extract only what the agreement states. Never invent wallet addresses or token contract addresses: use "" when the text does not give one.
- payment.amount is a plain decimal string without thousands separators (e.g. "1000"). payment.decimals is the token's decimals: 6 for USDC/USDT, 18 for ETH/DAI, otherwise 18 unless stated.
- deadlines are in days, converting weeks or hours if needed.
- refund.onMissedDeadline is true only if the agreement gives the depositor a refund when the delivery deadline is missed.
- adminPowers lists only powers the agreement explicitly grants to a party, platform or administrator over the escrowed funds or the contract (withdraw-funds, pause, upgrade, modify-terms, destroy, other). If the agreement grants none, or prohibits them, return an empty list.
- sourceClauses: for each extracted term, quote the exact sentence it came from, verbatim, so a lawyer can verify the extraction.
- schema is always "lexdiff/escrow-terms@1".`

export async function POST(request: Request) {
  if (rateLimited(request, 10, 60 * 60 * 1000)) {
    return Response.json({ error: 'Too many extractions from this address. Try again in an hour.' }, { status: 429 })
  }
  const { text } = (await request.json()) as { text?: string }
  if (!text?.trim()) return Response.json({ error: 'Agreement text is required' }, { status: 400 })
  if (text.length > 100_000) return Response.json({ error: 'The agreement is too long for this demo (100,000 characters max).' }, { status: 413 })

  try {
    client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY?.trim() })
    const response = await client.beta.messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'high', format: betaZodOutputFormat(escrowTermsSchema) },
      system: SYSTEM,
      messages: [{ role: 'user', content: `<agreement>\n${text}\n</agreement>` }],
    })

    if (response.stop_reason === 'refusal') {
      return Response.json({ error: 'The model declined to process this document.' }, { status: 422 })
    }
    if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
      return Response.json({ error: 'Extraction did not complete. Try a shorter document.' }, { status: 502 })
    }
    return Response.json({ terms: response.parsed_output, model: response.model })
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return Response.json({ error: 'ANTHROPIC_API_KEY is missing or invalid.' }, { status: 500 })
    }
    if (error instanceof Anthropic.RateLimitError) {
      return Response.json({ error: 'Rate limited by the Claude API, try again shortly.' }, { status: 429 })
    }
    if (error instanceof Anthropic.APIError) {
      return Response.json({ error: `Claude API error: ${error.message}` }, { status: 502 })
    }
    // No key configured: the SDK throws a plain Error before any request is made.
    if (!process.env.ANTHROPIC_API_KEY?.trim()) {
      return Response.json({ error: 'ANTHROPIC_API_KEY is not set on the server.' }, { status: 500 })
    }
    console.error('extract failed', error)
    return Response.json({ error: `Extraction failed: ${(error as Error).message}` }, { status: 500 })
  }
}
