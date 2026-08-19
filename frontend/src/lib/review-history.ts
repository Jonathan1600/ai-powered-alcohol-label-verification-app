export interface QueueHistoryState {
  screen: 'queue'
}

export interface ReviewHistoryState {
  screen: 'review'
  reviewId: string
  order: string[]
}

export function dashboardUrl(): string {
  const url = new URL(window.location.href)
  url.searchParams.delete('review')
  return `${url.pathname}${url.search}${url.hash}`
}

export function reviewUrl(reviewId: string): string {
  const url = new URL(window.location.href)
  url.searchParams.set('review', reviewId)
  return `${url.pathname}${url.search}${url.hash}`
}

export function reviewIdFromLocation(): string | null {
  return new URL(window.location.href).searchParams.get('review')
}

export function queueHistoryState(): QueueHistoryState {
  return { screen: 'queue' }
}

export function reviewHistoryState(reviewId: string, order: string[]): ReviewHistoryState {
  return { screen: 'review', reviewId, order }
}

export function isReviewHistoryState(value: unknown): value is ReviewHistoryState {
  if (!value || typeof value !== 'object') return false
  const state = value as Partial<ReviewHistoryState>
  return (
    state.screen === 'review' &&
    typeof state.reviewId === 'string' &&
    Array.isArray(state.order) &&
    state.order.every((id) => typeof id === 'string')
  )
}
