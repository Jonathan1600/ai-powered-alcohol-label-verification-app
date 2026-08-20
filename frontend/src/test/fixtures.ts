// Builders shared by the unit and component tests. Every test needs a queue
// item or a verification result, and hand-rolling them per file is how the
// wire shape quietly drifts between the tests that assert on it.

import type {
  FieldName,
  FieldResult,
  FieldVerdict,
  QueueItem,
  VerdictStatus,
  VerificationResult,
  VerifyResponse,
} from '../lib/contracts'
import type { ItemCheck } from '../lib/session'

export function seedItem(id: string, overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    source: 'seed',
    id,
    application_reference: `TTB-2026-${id}`,
    brand_name: `Brand ${id}`,
    imageUrl: `http://localhost:8000/api/seed/images/${id}.png`,
    thumbnailUrl: `http://localhost:8000/api/seed/thumbnails/${id}.jpg`,
    application: {
      brand_name: `Brand ${id}`,
      class_type: 'Vodka',
      alcohol_content: '40% alc/vol',
      net_contents: '750 mL',
      bottler_info: 'Bottled by Example Co, Portland, OR',
      beverage_class: 'distilled_spirits',
      is_import: false,
    },
    ...overrides,
  }
}

/**
 * An item the agent added from their own machine: same shape, but carrying its
 * bytes and pointing at an object URL rather than the server.
 */
export function addedItem(id: string, overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    ...seedItem(id),
    source: 'added',
    imageUrl: `blob:http://localhost/${id}`,
    thumbnailUrl: `blob:http://localhost/${id}-thumb`,
    file: new File(['png-bytes'], `${id}.png`, { type: 'image/png' }),
    ...overrides,
  }
}

export function fieldResult(
  field: FieldName,
  verdict: FieldVerdict,
  overrides: Partial<FieldResult> = {},
): FieldResult {
  return {
    field,
    claimed: 'what the application says',
    extracted: 'what the label shows',
    verdict,
    reason: `The ${field} reason sentence.`,
    ...overrides,
  }
}

export function verificationResult(
  status: VerdictStatus,
  overrides: Partial<VerificationResult> = {},
): VerificationResult {
  return {
    status,
    fields: [],
    unreadable_reason: null,
    ...overrides,
  }
}

export function verifyResponse(
  status: VerdictStatus,
  fields: FieldResult[] = [],
  overrides: Partial<VerifyResponse> = {},
): VerifyResponse {
  return {
    result: verificationResult(status, { fields }),
    timings: { read_ms: 1, model_ms: 5000, matching_ms: 2, server_total_ms: 5003 },
    model: 'gpt-5.6-luna',
    prompt_version: '2026-08-18.2',
    image_bytes: 95000,
    ...overrides,
  }
}

export function doneCheck(status: VerdictStatus, fields: FieldResult[] = []): ItemCheck {
  return { phase: 'done', response: verifyResponse(status, fields) }
}
