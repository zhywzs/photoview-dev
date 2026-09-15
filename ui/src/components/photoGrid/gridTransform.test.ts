import {
  levelTiles,
  commitLevelForVisualTile,
  clampFollowScale,
  residualAt,
  applyFollowTransform,
  clearZoomTransform,
  settleZoomTransform,
  PINCH_HYSTERESIS,
  MAX_OVERSCALE,
  MIN_OVERSCALE,
  RESIDUAL_ABSORB_MS,
} from './gridTransform'

// realistic tile sizes for a 390px wide phone
const WIDTH = 390

describe('levelTiles', () => {
  test('tiles shrink with more columns, dense levels are gapless', () => {
    const tiles = levelTiles(WIDTH)

    expect(tiles).toHaveLength(4)
    // strictly decreasing
    for (let i = 1; i < tiles.length; i++) {
      expect(tiles[i]).toBeLessThan(tiles[i - 1])
    }
    // 3 columns with gap 4: floor((390 - 8) / 3)
    expect(tiles[0]).toBe(127)
    // 15 columns with gap 0: floor(390 / 15)
    expect(tiles[2]).toBe(26)
  })
})

describe('commitLevelForVisualTile', () => {
  const tiles = levelTiles(WIDTH)

  test('zoom-in commits above the geometric midpoint with hysteresis', () => {
    const midpoint = Math.sqrt(tiles[1] * tiles[0])

    // just below the hysteresis band -> keep following
    expect(commitLevelForVisualTile(1, midpoint * 1.02, tiles)).toBeNull()
    // past it -> commit to the bigger level
    expect(commitLevelForVisualTile(1, midpoint * PINCH_HYSTERESIS, tiles)).toBe(0)
    expect(commitLevelForVisualTile(1, tiles[0] * 2, tiles)).toBe(0)
  })

  test('zoom-out commits below the geometric midpoint with hysteresis', () => {
    const midpoint = Math.sqrt(tiles[1] * tiles[2])

    expect(commitLevelForVisualTile(1, midpoint / 1.02, tiles)).toBeNull()
    expect(commitLevelForVisualTile(1, midpoint / PINCH_HYSTERESIS, tiles)).toBe(2)
    expect(commitLevelForVisualTile(1, tiles[2] * 0.5, tiles)).toBe(2)
  })

  test('no commits past the extreme levels', () => {
    // already at the biggest photos
    expect(commitLevelForVisualTile(0, tiles[0] * 3, tiles)).toBeNull()
    // already at the smallest photos
    expect(commitLevelForVisualTile(3, tiles[3] * 0.2, tiles)).toBeNull()
  })

  test('hysteresis band is free of commits in both directions', () => {
    const midpoint = Math.sqrt(tiles[2] * tiles[1])

    // inside the band around the midpoint: neither direction commits
    const inBand = midpoint // exactly at the midpoint
    expect(commitLevelForVisualTile(1, inBand, tiles)).toBeNull()
    expect(commitLevelForVisualTile(2, inBand, tiles)).toBeNull()
  })
})

describe('clampFollowScale', () => {
  test('clamps only at the extreme levels', () => {
    expect(clampFollowScale(2.5, 0, 3)).toBe(MAX_OVERSCALE)
    expect(clampFollowScale(0.5, 3, 3)).toBe(MIN_OVERSCALE)
    expect(clampFollowScale(2.5, 1, 3)).toBe(2.5)
    expect(clampFollowScale(0.5, 2, 3)).toBe(0.5)
  })
})

describe('residualAt', () => {
  test('starts at the commit residual and ends at identity', () => {
    expect(residualAt(2.3, 0)).toBe(2.3)
    expect(residualAt(0.4, 0)).toBe(0.4)
    expect(residualAt(2.3, RESIDUAL_ABSORB_MS)).toBe(1)
    expect(residualAt(0.4, RESIDUAL_ABSORB_MS * 10)).toBe(1)
  })

  test('monotonically absorbs towards 1 over time', () => {
    let prev = residualAt(2.3, 0)
    for (let t = 20; t <= RESIDUAL_ABSORB_MS; t += 20) {
      const current = residualAt(2.3, t)
      expect(current).toBeLessThan(prev)
      expect(current).toBeGreaterThanOrEqual(1)
      prev = current
    }

    prev = residualAt(0.4, 0)
    for (let t = 20; t <= RESIDUAL_ABSORB_MS; t += 20) {
      const current = residualAt(0.4, t)
      expect(current).toBeGreaterThan(prev)
      expect(current).toBeLessThanOrEqual(1)
      prev = current
    }
  })

  test('identity residual stays identity', () => {
    expect(residualAt(1, 0)).toBe(1)
    expect(residualAt(1, 100)).toBe(1)
  })
})

describe('host transform helpers', () => {
  function makeHost(): HTMLDivElement {
    const host = document.createElement('div')
    document.body.appendChild(host)
    return host
  }

  test('applyFollowTransform writes transform, origin and will-change', () => {
    const host = makeHost()
    applyFollowTransform(host, 1.42, 100, 200)

    expect(host.style.transform).toBe('scale(1.42)')
    expect(host.style.transformOrigin).toBe('100px 200px')
    expect(host.style.willChange).toBe('transform')
    expect(host.style.transition).toBe('none')

    clearZoomTransform(host)
    expect(host.style.transform).toBe('')
    expect(host.style.transformOrigin).toBe('')
    expect(host.style.willChange).toBe('')
    host.remove()
  })

  test('settleZoomTransform animates to identity and clears afterwards', async () => {
    const host = makeHost()
    applyFollowTransform(host, 1.6, 10, 10)

    settleZoomTransform(host, 40)
    expect(host.style.transition).toContain('transform')
    expect(host.style.transform).toBe('scale(1)')

    // after duration + grace the transform is fully cleared
    await new Promise(resolve => setTimeout(resolve, 140))
    expect(host.style.transform).toBe('')
    host.remove()
  })

  test('settleZoomTransform cancel freezes the transition', async () => {
    const host = makeHost()
    applyFollowTransform(host, 1.6, 10, 10)

    const cancel = settleZoomTransform(host, 40)
    cancel()
    expect(host.style.transition).toBe('none')
    // transform target is still scale(1) but no timer will clear it
    expect(host.style.transform).toBe('scale(1)')

    await new Promise(resolve => setTimeout(resolve, 140))
    expect(host.style.transform).toBe('scale(1)')
    host.remove()
  })

  test('settleZoomTransform with zero duration snaps instantly', () => {
    const host = makeHost()
    applyFollowTransform(host, 1.6, 10, 10)

    settleZoomTransform(host, 0)
    expect(host.style.transform).toBe('')
    host.remove()
  })
})
