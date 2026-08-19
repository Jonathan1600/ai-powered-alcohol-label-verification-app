// Builders shared by the unit and component tests. Every test needs a queue
// item or a verification result, and hand-rolling them per file is how the
// wire shape quietly drifts between the tests that assert on it.

import type {
  FieldName,
  FieldResult,
  FieldVerdict,
  SeedQueueItem,
  VerdictStatus,
  VerificationResult,
} from '../lib/contracts'
import type { ItemCheck } from '../lib/session'

export function seedItem(id: string, overrides: Partial<SeedQueueItem> = {}): SeedQueueItem {
  return {
    id,
    application_reference: `TTB-2026-${id}`,
    brand_name: `Brand ${id}`,
    status: 'not_yet_checked',
    image_url: `/api/seed/images/${id}.png`,
    thumbnail_url: `/api/seed/thumbnails/${id}.jpg`,
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

export function doneCheck(status: VerdictStatus, fields: FieldResult[] = []): ItemCheck {
  return { phase: 'done', result: verificationResult(status, { fields }) }
}
