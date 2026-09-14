import {
  granularityForColumns,
  groupTimeline,
  targetRowsForColumns,
} from './timelineGrouping'

const item = (date: string) => ({ date, id: date })

describe('granularityForColumns', () => {
  test('dense levels group by month, sparse levels fill', () => {
    expect(granularityForColumns(3)).toBe('fill')
    expect(granularityForColumns(5)).toBe('fill')
    expect(granularityForColumns(15)).toBe('month')
    expect(granularityForColumns(30)).toBe('month')
  })
})

describe('targetRowsForColumns', () => {
  test('fewer columns produce smaller groups', () => {
    expect(targetRowsForColumns(3)).toBe(2)
    expect(targetRowsForColumns(5)).toBe(3)
  })
})

describe('groupTimeline', () => {
  test('day mode: every distinct day is its own group', () => {
    const items = [
      item('2026-01-03T10:00:00Z'),
      item('2026-01-02T09:00:00Z'),
      item('2026-01-02T08:00:00Z'),
      item('2025-12-31T23:00:00Z'),
    ]

    const groups = groupTimeline(items, 'day', 4, 3)

    expect(groups).toHaveLength(3)
    expect(groups[0]).toMatchObject({ start: '2026-01-03', end: '2026-01-03' })
    expect(groups[1]).toMatchObject({ start: '2026-01-02', end: '2026-01-02' })
    expect(groups[2]).toMatchObject({ start: '2025-12-31', end: '2025-12-31' })
    // all items preserved
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(4)
  })

  test('month mode: buckets by calendar month', () => {
    const items = [
      item('2026-03-05T10:00:00Z'),
      item('2026-03-01T09:00:00Z'),
      item('2026-02-20T08:00:00Z'),
      item('2026-01-02T08:00:00Z'),
    ]

    const groups = groupTimeline(items, 'month', 1, 3)

    expect(groups).toHaveLength(3)
    expect(groups[0].unit).toBe('month')
    expect(groups[0]).toMatchObject({ start: '2026-03-01', end: '2026-03-05' })
    expect(groups[2]).toMatchObject({ start: '2026-01-02', end: '2026-01-02' })
  })

  test('month mode: sparse months merge, capped at a quarter', () => {
    // one photo per month, 2 columns so every month is "sparse"
    const items = [
      item('2026-06-01T10:00:00Z'),
      item('2026-05-01T10:00:00Z'),
      item('2026-04-01T10:00:00Z'),
      item('2026-03-01T10:00:00Z'),
      item('2026-02-01T10:00:00Z'),
      item('2026-01-01T10:00:00Z'),
      item('2025-12-01T10:00:00Z'),
    ]

    const groups = groupTimeline(items, 'month', 2, 3)

    // groups span at most 3 months: [Jun..Apr], [Mar..Jan], [Dec]
    expect(groups).toHaveLength(3)
    expect(groups[0]).toMatchObject({ start: '2026-04-01', end: '2026-06-01' })
    expect(groups[1]).toMatchObject({ start: '2026-01-01', end: '2026-03-01' })
    expect(groups[2]).toMatchObject({ start: '2025-12-01', end: '2025-12-01' })
  })

  test('fill mode: merges days until the target rows are reached', () => {
    // 4 columns, target 2 rows (8 photos per group)
    const items = [
      item('2026-01-05T10:00:00Z'),
      item('2026-01-05T11:00:00Z'),
      item('2026-01-04T10:00:00Z'),
      item('2026-01-03T10:00:00Z'),
      item('2026-01-03T11:00:00Z'),
      item('2026-01-02T10:00:00Z'),
      item('2026-01-01T10:00:00Z'),
      item('2026-01-01T11:00:00Z'),
    ]

    const groups = groupTimeline(items, 'fill', 4, 2)

    // after 01-05 + 01-04 + 01-03 (5 photos = 2 rows) the target is met,
    // so the group closes before 01-02 joins; the rest forms a second group
    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({ start: '2026-01-03', end: '2026-01-05' })
    expect(groups[0].items).toHaveLength(5)
    expect(groups[1]).toMatchObject({ start: '2026-01-01', end: '2026-01-02' })
    expect(groups[1].items).toHaveLength(3)
  })

  test('fill mode: closes at month boundary when half full', () => {
    // 2 columns, target 6 rows (12 photos)
    const january = [
      item('2026-01-31T10:00:00Z'),
      item('2026-01-30T10:00:00Z'),
      item('2026-01-29T10:00:00Z'),
      item('2026-01-28T10:00:00Z'),
      item('2026-01-27T10:00:00Z'),
      item('2026-01-26T10:00:00Z'),
      item('2026-01-25T10:00:00Z'),
      item('2026-01-24T10:00:00Z'),
    ] // 8 photos = 4 rows >= ceil(6/2) = 3 -> close at month boundary
    const february = [item('2026-02-02T10:00:00Z')]

    const groups = groupTimeline([...january, ...february], 'fill', 2, 6)

    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({ start: '2026-01-24', end: '2026-01-31' })
    expect(groups[1]).toMatchObject({ start: '2026-02-02', end: '2026-02-02' })
  })

  test('fill mode: a day with many photos stays on its own', () => {
    // 2 columns, target 2 rows (4 photos)
    const items = [
      item('2026-01-05T10:00:00Z'),
      item('2026-01-05T11:00:00Z'),
      item('2026-01-05T12:00:00Z'),
      item('2026-01-05T13:00:00Z'),
      item('2026-01-05T14:00:00Z'),
      item('2026-01-04T10:00:00Z'),
    ]

    const groups = groupTimeline(items, 'fill', 2, 2)

    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({ start: '2026-01-05', end: '2026-01-05' })
    expect(groups[1]).toMatchObject({ start: '2026-01-04', end: '2026-01-04' })
  })
})
