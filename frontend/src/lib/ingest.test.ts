// Ingestion is the only route to a two hundred item queue, so its failure
// behaviour is the part worth pinning: every problem reported at once, and
// nothing ingested until there are none.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ingestLabels, revokeItemUrls } from './ingest'

const HEADER =
  'image,application_reference,brand_name,class_type,alcohol_content,net_contents,' +
  'bottler_info,beverage_class,is_import,country_of_origin'

function row(overrides: Partial<Record<string, string>> = {}): string {
  const cells: Record<string, string> = {
    image: 'bourbon.png',
    application_reference: 'TTB-2026-9001',
    brand_name: 'Copper Kettle',
    class_type: 'Kentucky Straight Bourbon Whiskey',
    alcohol_content: '45% Alc./Vol.',
    net_contents: '750 mL',
    bottler_info: 'Bottled by Copper Kettle Distillery, Bardstown, KY',
    beverage_class: 'distilled_spirits',
    is_import: 'false',
    country_of_origin: '',
    ...overrides,
  }
  return HEADER.split(',')
    .map((column) => {
      const value = cells[column] ?? ''
      return value.includes(',') ? `"${value}"` : value
    })
    .join(',')
}

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join('\n') + '\n'
}

function image(name = 'bourbon.png', type = 'image/png'): File {
  return new File([new Uint8Array(16)], name, { type })
}

let created = 0

beforeEach(() => {
  created = 0
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => `blob:test/${created++}`),
    revokeObjectURL: vi.fn(),
  })
  // Already inside the thumbnail bound, so downscale passes the file through
  // and no canvas is needed. Thumbnail *pixels* are covered in downscale.test.
  vi.stubGlobal('createImageBitmap', () =>
    Promise.resolve({ width: 300, height: 400, close: vi.fn() }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function messages(problems: { message: string }[]): string[] {
  return problems.map((problem) => problem.message)
}

describe('ingestLabels', () => {
  it('pairs a row with its image and builds the application record', async () => {
    const { items, problems } = await ingestLabels([image()], csv(row()))

    expect(problems).toEqual([])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      source: 'added',
      application_reference: 'TTB-2026-9001',
      brand_name: 'Copper Kettle',
      application: {
        class_type: 'Kentucky Straight Bourbon Whiskey',
        net_contents: '750 mL',
        beverage_class: 'distilled_spirits',
        is_import: false,
        country_of_origin: null,
      },
    })
    expect(items[0].file).toBeInstanceOf(File)
  })

  it('matches filenames without caring about case', async () => {
    const { items, problems } = await ingestLabels(
      [image('Bourbon.PNG')],
      csv(row({ image: 'bourbon.png' })),
    )
    expect(problems).toEqual([])
    expect(items).toHaveLength(1)
  })

  it.each([
    ['true', true],
    ['TRUE', true],
    ['yes', true],
    ['1', true],
    ['false', false],
    ['no', false],
    ['', false],
  ])('reads is_import %j as %s', async (raw, expected) => {
    const { items, problems } = await ingestLabels(
      [image()],
      csv(row({ is_import: raw, country_of_origin: expected ? 'France' : '' })),
    )
    expect(problems).toEqual([])
    expect(items[0].application.is_import).toBe(expected)
  })

  it('reports every problem in one pass rather than stopping at the first', async () => {
    const { items, problems } = await ingestLabels(
      [image('a.png'), image('orphan.png')],
      csv(
        row({ image: 'a.png', beverage_class: 'cider', brand_name: '' }),
        row({ image: 'missing.png', application_reference: 'TTB-2026-9002' }),
      ),
    )

    expect(items).toEqual([])
    expect(messages(problems)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('No brand name'),
        expect.stringContaining('cider is not one of'),
        expect.stringContaining('No selected image is named missing.png'),
        expect.stringContaining('orphan.png has no row in the CSV'),
      ]),
    )
  })

  it('ingests nothing at all when any row fails', async () => {
    const { items } = await ingestLabels(
      [image('a.png'), image('b.png')],
      csv(
        row({ image: 'a.png' }),
        row({ image: 'b.png', application_reference: '', brand_name: 'Second' }),
      ),
    )
    expect(items).toEqual([])
  })

  it('does not also call an image orphaned when its own row failed for another reason', async () => {
    const { problems } = await ingestLabels([image('a.png')], csv(row({ image: 'a.png', net_contents: '' })))
    expect(messages(problems)).toEqual([expect.stringContaining('No net contents')])
  })

  it('requires a country of origin on an import, because the engine only checks it there', async () => {
    const { problems } = await ingestLabels(
      [image()],
      csv(row({ is_import: 'true', country_of_origin: '' })),
    )
    expect(messages(problems)).toEqual([expect.stringContaining('needs a country of origin')])
  })

  it('names the missing columns rather than failing row by row', async () => {
    const { problems } = await ingestLabels([image()], 'image,brand_name\nbourbon.png,X\n')
    expect(problems).toHaveLength(1)
    expect(problems[0].message).toContain('application_reference')
    expect(problems[0].message).toContain('beverage_class')
  })

  it('refuses a duplicate application reference inside the file', async () => {
    const { problems } = await ingestLabels(
      [image('a.png'), image('b.png')],
      csv(row({ image: 'a.png' }), row({ image: 'b.png' })),
    )
    expect(messages(problems)).toEqual([
      expect.stringContaining('TTB-2026-9001 is already in the queue'),
    ])
  })

  it('refuses a reference that is already in the queue from an earlier ingestion', async () => {
    const { problems } = await ingestLabels([image()], csv(row()), ['TTB-2026-9001'])
    expect(messages(problems)).toEqual([
      expect.stringContaining('TTB-2026-9001 is already in the queue'),
    ])
  })

  it('refuses a file type the backend would reject anyway', async () => {
    const { problems } = await ingestLabels(
      [image('bourbon.png', 'application/pdf')],
      csv(row()),
    )
    expect(messages(problems)).toEqual([expect.stringContaining('Send PNG, JPEG, or WebP')])
  })

  it('reports a ragged row against its own line number', async () => {
    const { problems } = await ingestLabels([image()], `${HEADER}\nbourbon.png,TTB-2026-9001\n`)
    expect(problems[0].line).toBe(2)
    expect(problems[0].message).toContain('2 values but the header has 10')
  })

  it('explains an unterminated quote instead of throwing at the screen', async () => {
    const { problems } = await ingestLabels([image()], `${HEADER}\n"bourbon.png,TTB\n`)
    expect(problems).toHaveLength(1)
    expect(problems[0].message).toContain('quoted value')
  })

  it('says so when the file is only a header', async () => {
    const { problems } = await ingestLabels([], `${HEADER}\n`)
    expect(messages(problems)).toEqual([expect.stringContaining('no application rows')])
  })

  it('decodes nothing when the ingestion is rejected', async () => {
    await ingestLabels([image()], csv(row({ brand_name: '' })))
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('reports progress as it prepares the images', async () => {
    const onProgress = vi.fn()
    await ingestLabels(
      [image('a.png'), image('b.png')],
      csv(row({ image: 'a.png' }), row({ image: 'b.png', application_reference: 'TTB-2026-9002' })),
      [],
      onProgress,
    )
    expect(onProgress.mock.calls).toEqual([
      [1, 2],
      [2, 2],
    ])
  })
})

describe('revokeItemUrls', () => {
  it('releases each URL once, and leaves seeded items alone', async () => {
    const { items } = await ingestLabels([image()], csv(row()))
    revokeItemUrls(items)

    // The stub returns a file already small enough to be its own thumbnail, so
    // both fields carry the same URL and it must not be revoked twice.
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
  })
})
