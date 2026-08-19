// TypeScript mirror of the backend wire contracts. Field names and
// nullability track backend/app/matching/contracts.py, seed/models.py, and
// verify/models.py; when the Pydantic models change, this file changes with
// them.

export type BeverageClass = 'wine' | 'distilled_spirits' | 'malt_beverage'

export interface ApplicationRecord {
  brand_name: string
  class_type: string
  alcohol_content: string
  net_contents: string
  bottler_info: string
  country_of_origin?: string | null
  beverage_class: BeverageClass
  is_import: boolean
}

export interface SeedQueueItem {
  id: string
  application_reference: string
  brand_name: string
  status: 'not_yet_checked'
  // Server-relative paths ("/api/seed/thumbnails/x.jpg"); prefix API_BASE_URL.
  image_url: string
  thumbnail_url: string
  application: ApplicationRecord
}

export interface SeedQueueResponse {
  count: number
  items: SeedQueueItem[]
}

/**
 * One row of the queue as the client holds it.
 *
 * Two things end up in the queue: the seeded fixtures the server serves, and
 * labels the agent added from their own machine (see `lib/ingest.ts`). They
 * differ in exactly one respect, where the image bytes live, so this is one
 * shape with a discriminant rather than a union every component would have to
 * narrow before reading a brand name.
 *
 * The naming split is deliberate and load-bearing. snake_case fields arrived
 * from the wire unchanged; camelCase fields the client resolved for itself.
 * `imageUrl` is absolute and ready for a `src`, which `SeedQueueItem.image_url`
 * is not, and forgetting that difference is exactly the bug this convention is
 * meant to make visible.
 */
export interface QueueItem {
  source: 'seed' | 'added'
  id: string
  application_reference: string
  brand_name: string
  application: ApplicationRecord
  imageUrl: string
  thumbnailUrl: string
  /**
   * The bytes, for added items. Seeded items leave this undefined and are
   * downloaded from `imageUrl` instead.
   */
  file?: File
}

export type VerdictStatus =
  | 'looks_correct'
  | 'needs_review'
  | 'problem_found'
  | 'unreadable'

export type FieldVerdict = 'match' | 'needs_review' | 'mismatch'

export type FieldName =
  | 'brand_name'
  | 'class_type'
  | 'alcohol_content'
  | 'net_contents'
  | 'bottler_info'
  | 'country_of_origin'
  | 'government_warning'

export type UnreadableReason = 'glare' | 'angle' | 'blur' | 'resolution'

// difflib's opcode vocabulary, passed through unchanged by the backend's
// `word_diff`. `equal` runs travel too: the review view marks the edits inside
// the statutory text, so it needs the words between them.
export type DiffOpKind = 'equal' | 'replace' | 'delete' | 'insert'

export interface DiffOp {
  op: DiffOpKind
  expected: string
  actual: string
}

export interface FieldResult {
  field: FieldName
  claimed: string | null
  extracted: string | null
  verdict: FieldVerdict
  reason: string
  diff?: DiffOp[] | null
}

export interface VerificationResult {
  status: VerdictStatus
  fields: FieldResult[]
  unreadable_reason: UnreadableReason | null
}

export interface StageTimings {
  read_ms: number
  model_ms: number
  matching_ms: number
  server_total_ms: number
}

export interface VerifyResponse {
  result: VerificationResult
  timings: StageTimings
  model: string
  prompt_version: string
  image_bytes: number
}
