import {
  computeLayout,
  indexAtY,
  itemTop,
  thumbSourceFor,
  tileSizeForColumns,
  visibleRowRange,
  captureZoomAnchor,
  scrollForZoomAnchor,
  flattenSections,
  groupForIndex,
  isDenseLevel,
  GRID_GAP,
} from './gridLayout'

describe('isDenseLevel', () => {
  test('levels above the header threshold are dense', () => {
    expect(isDenseLevel(3)).toBe(false)
    expect(isDenseLevel(5)).toBe(false)
    expect(isDenseLevel(15)).toBe(true)
    expect(isDenseLevel(30)).toBe(true)
  })
})

describe('dense seamless layout (gap 0)', () => {
  test('tiles butt together with no gaps', () => {
    const layout = computeLayout(
      [{ key: 'a', items: new Array(31).fill({}) }],
      390,
      15,
      { gap: 0 }
    )

    expect(layout.tileSize).toBe(Math.floor(390 / 15)) // 26
    // 31 items / 15 cols = 3 rows: 3 * 26 = 78, no gaps added
    expect(layout.sections[0].height).toBe(3 * layout.tileSize)
  })

  test('flattened sections form one continuous block', () => {
    const sections = [
      { key: 'm1', title: 'Jan', items: new Array(10).fill({}) },
      { key: 'm2', title: 'Feb', items: new Array(20).fill({}) },
    ]
    const { items, groups } = flattenSections(sections)

    expect(items).toHaveLength(30)
    expect(groups).toEqual([
      { firstIndex: 0, title: 'Jan' },
      { firstIndex: 10, title: 'Feb' },
    ])

    // one flat section, rows run across the former group boundary
    const layout = computeLayout(
      [{ key: '__dense__', items }],
      390,
      30,
      { gap: 0 }
    )
    expect(layout.sections).toHaveLength(1)
    expect(layout.sections[0].rows).toBe(1) // 30 items / 30 cols

    // group lookup maps flat indexes back to their month
    expect(groupForIndex(groups, 0)?.title).toBe('Jan')
    expect(groupForIndex(groups, 9)?.title).toBe('Jan')
    expect(groupForIndex(groups, 10)?.title).toBe('Feb')
    expect(groupForIndex(groups, 29)?.title).toBe('Feb')
  })
})

describe('tileSizeForColumns', () => {
  test('tiles fill the container edge to edge', () => {
    expect(tileSizeForColumns(1000, 5)).toBe(Math.floor((1000 - 16) / 5))
    expect(tileSizeForColumns(390, 15)).toBe(Math.floor((390 - 56) / 15))
  })

  test('never goes below a minimum size', () => {
    expect(tileSizeForColumns(30, 30)).toBeGreaterThanOrEqual(16)
  })
})

describe('computeLayout', () => {
  const sections = [
    { key: '2025-01-01', title: 'Jan 1', items: new Array(10).fill({}) },
    { key: '2025-01-02', items: new Array(3).fill({}) },
  ]

  test('derives tile size and header offsets from the column count', () => {
    const layout = computeLayout(sections, 1000, 5)

    const tile = tileSizeForColumns(1000, 5)
    expect(layout.tileSize).toBe(tile)
    expect(layout.columns).toBe(5)
    expect(layout.itemCount).toBe(13)

    const first = layout.sections[0]
    expect(first.hasHeader).toBe(true)
    expect(first.rows).toBe(2) // 10 items / 5 columns
    expect(first.height).toBe(layout.headerHeight + 2 * tile + GRID_GAP)
    expect(first.firstIndex).toBe(0)

    const second = layout.sections[1]
    expect(second.hasHeader).toBe(false) // no title -> no header
    expect(second.rows).toBe(1)
    expect(second.firstIndex).toBe(10)
    expect(second.offset).toBeGreaterThan(first.offset + first.height)
  })

  test('renderHeaders=false reserves no header space (floating mode)', () => {
    const layout = computeLayout(sections, 1000, 15, { renderHeaders: false })

    const tile = tileSizeForColumns(1000, 15)
    expect(layout.sections[0].hasHeader).toBe(false)
    expect(layout.sections[0].height).toBe(1 * tile) // 10 items / 15 cols = 1 row
  })
})

describe('indexAtY / itemTop roundtrip', () => {
  const sections = [
    { key: 'a', title: 'A', items: new Array(20).fill({}) },
    { key: 'b', title: 'B', items: new Array(20).fill({}) },
  ]

  test('the item at a Y position stays at its viewport anchor', () => {
    const layout = computeLayout(sections, 800, 5)

    const y = 600
    const index = indexAtY(layout, y)
    const top = itemTop(layout, index)

    // the item's row top should be within one row of the queried y
    expect(Math.abs(top - y)).toBeLessThan(layout.tileSize)
  })
})

describe('visibleRowRange', () => {
  test('returns intersecting rows only', () => {
    const layout = computeLayout(
      [{ key: 'a', title: 'A', items: new Array(50).fill({}) }],
      1000,
      5
    )
    const section = layout.sections[0]

    expect(visibleRowRange(section, layout, -100, -1)).toBeNull()
    expect(visibleRowRange(section, layout, 50000, 60000)).toBeNull()

    const range = visibleRowRange(section, layout, 0, 300)
    expect(range).not.toBeNull()
    expect(range![0]).toBe(0)
    expect(range![1]).toBeGreaterThanOrEqual(1)
  })
})

describe('zoom anchor', () => {
  const build = (columns: number, count = 100) =>
    computeLayout(
      [{ key: 'a', title: 'A', items: new Array(count).fill({}) }],
      1000,
      columns
    )

  test('the anchored content point stays at its viewport position', () => {
    const oldLayout = build(5)
    // anchor point 1000px into the content, shown at viewport y 50
    const anchor = captureZoomAnchor(oldLayout, 1000, 50)

    for (const newColumns of [3, 15, 30]) {
      const newLayout = build(newColumns)
      const scroll = scrollForZoomAnchor(anchor, newLayout)

      // the anchor row's scaled point must sit exactly at viewportY
      // (parameters chosen so the scroll target is never clamped)
      const rowTop = itemTop(newLayout, anchor.index)
      const scaled = anchor.offset * (newLayout.tileSize / anchor.tile)
      expect(scroll + anchor.viewportY).toBeCloseTo(rowTop + scaled)
      expect(scroll).toBeGreaterThanOrEqual(0)
    }
  })

  test('the anchor point still lands inside the anchor row after zooming', () => {
    const oldLayout = build(3, 100)
    const anchor = captureZoomAnchor(oldLayout, 800, 30)

    const newLayout = build(30, 100)
    const scroll = scrollForZoomAnchor(anchor, newLayout)

    const rowTop = itemTop(newLayout, anchor.index)
    const anchorContentY = scroll + anchor.viewportY
    expect(anchorContentY).toBeGreaterThanOrEqual(rowTop)
    expect(anchorContentY).toBeLessThanOrEqual(rowTop + newLayout.tileSize)
  })

  test('clamps to the top when the anchor would scroll above the start', () => {
    const oldLayout = build(5)
    // first row shown at viewport y 200; zooming out pulls the target above 0
    const anchor = captureZoomAnchor(oldLayout, 200, 200)

    const newLayout = build(30)
    expect(scrollForZoomAnchor(anchor, newLayout)).toBe(0)
  })
})

describe('thumbSourceFor', () => {
  const media = {
    thumbnailTiny: { url: '/tiny.jpg' },
    thumbnailSmall: { url: '/small.jpg' },
    thumbnail: { url: '/thumb.jpg' },
  }

  test('picks the smallest sufficient rendition', () => {
    expect(thumbSourceFor(40, media, 2)).toBe('/tiny.jpg') // 80 <= 150
    expect(thumbSourceFor(100, media, 1)).toBe('/tiny.jpg') // 100 <= 150
    expect(thumbSourceFor(100, media, 2)).toBe('/small.jpg') // 200 > 150
    expect(thumbSourceFor(200, media, 2)).toBe('/thumb.jpg') // 400 > 300
  })

  test('falls back when smaller renditions are missing', () => {
    expect(thumbSourceFor(40, { thumbnail: { url: '/thumb.jpg' } }, 3)).toBe(
      '/thumb.jpg'
    )
    expect(
      thumbSourceFor(40, { thumbnailSmall: { url: '/small.jpg' } }, 1)
    ).toBe('/small.jpg')
  })
})
