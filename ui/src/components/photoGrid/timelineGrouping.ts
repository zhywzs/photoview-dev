/**
 * Adaptive date grouping for the timeline.
 *
 * The granularity follows the gallery zoom level:
 *  - small tiles  -> group by calendar month (sparse months merge, capped at ~a quarter)
 *  - medium tiles -> greedily merge days so each group fills a good part of the screen
 *  - large tiles  -> every distinct day gets its own group
 */

export type Granularity = 'month' | 'fill' | 'day'

export type DatedItem = {
  /** ISO timestamp, e.g. "2026-09-14T10:30:00Z" */
  date: string
}

export type DateGroup<T> = {
  key: string
  /** yyyy-mm-dd of the oldest item in the group */
  start: string
  /** yyyy-mm-dd of the newest item in the group */
  end: string
  /** how the group should be titled: a calendar month (or month range) or an explicit date range */
  unit: 'month' | 'range'
  items: T[]
}

/** Column counts at or above this level use month grouping. */
export const MONTH_GROUPING_COLUMNS = 15

export function granularityForColumns(columns: number): Granularity {
  return columns >= MONTH_GROUPING_COLUMNS ? 'month' : 'fill'
}

/**
 * Target row count for a fill-mode group at the given column count.
 * Fewer columns (bigger photos) produce smaller, finer groups.
 */
export function targetRowsForColumns(columns: number): number {
  return columns <= 3 ? 2 : 3
}

function monthIndexOf(month: string): number {
  const [year, monthNumber] = month.split('-').map(Number)
  return year * 12 + (monthNumber - 1)
}

type DayBucket<T> = { day: string; items: T[] }

function bucketByDay<T extends DatedItem>(items: T[]): DayBucket<T>[] {
  const days: DayBucket<T>[] = []
  for (const item of items) {
    const day = item.date.slice(0, 10)
    if (days.length == 0 || days[days.length - 1].day != day) {
      days.push({ day, items: [] })
    }
    days[days.length - 1].items.push(item)
  }
  return days
}

/**
 * Group timeline items (newest first) into sections.
 *
 * @param columns number of photo columns, used to estimate row counts
 * @param targetRows desired rows per group in fill mode
 */
export function groupTimeline<T extends DatedItem>(
  items: T[],
  granularity: Granularity,
  columns: number,
  targetRows: number
): DateGroup<T>[] {
  const days = bucketByDay(items)

  if (granularity === 'day') {
    return days.map(d => ({
      key: `d:${d.day}`,
      start: d.day,
      end: d.day,
      unit: 'range',
      items: d.items,
    }))
  }

  if (granularity === 'month') {
    // strict calendar month buckets first
    const buckets: { newest: string; oldest: string; items: T[] }[] = []
    for (const d of days) {
      const month = d.day.slice(0, 7)
      const prev = buckets[buckets.length - 1]
      if (prev && prev.oldest == month) {
        prev.items.push(...d.items)
      } else {
        buckets.push({ newest: month, oldest: month, items: [...d.items] })
      }
    }

    // then merge adjacent months that don't fill a row on their own,
    // but never span more than ~a quarter in one group
    const months: typeof buckets = []
    for (const bucket of buckets) {
      const prev = months[months.length - 1]
      const prevSparse = prev != null && prev.items.length < columns
      const currentSparse = bucket.items.length < columns

      if (
        prev &&
        (prevSparse || currentSparse) &&
        monthIndexOf(prev.newest) - monthIndexOf(bucket.oldest) < 3
      ) {
        prev.items.push(...bucket.items)
        prev.oldest = bucket.oldest
      } else {
        months.push({ ...bucket, items: [...bucket.items] })
      }
    }

    return months.map((m, i) => ({
      key: `m:${i}:${m.oldest}`,
      start: m.items[m.items.length - 1].date.slice(0, 10),
      end: m.items[0].date.slice(0, 10),
      unit: 'month',
      items: m.items,
    }))
  }

  // fill mode: greedily merge days until the group fills the target rows.
  // groups prefer to close at month boundaries once they are at least half full.
  const groups: DateGroup<T>[] = []
  let current: { newest: string; oldest: string; items: T[] } | null = null

  const rowsOf = (count: number) => Math.ceil(count / Math.max(1, columns))

  const closeCurrent = () => {
    if (current == null) return
    groups.push({
      key: `f:${current.oldest}:${current.newest}`,
      start: current.oldest,
      end: current.newest,
      unit: 'range',
      items: current.items,
    })
    current = null
  }

  for (const d of days) {
    if (current != null) {
      const currentRows = rowsOf(current.items.length)
      const crossesMonth = d.day.slice(0, 7) != current.oldest.slice(0, 7)

      if (
        currentRows >= targetRows ||
        (crossesMonth && currentRows >= Math.ceil(targetRows / 2))
      ) {
        closeCurrent()
      }
    }

    if (current == null) {
      current = { newest: d.day, oldest: d.day, items: [...d.items] }
    } else {
      current.oldest = d.day
      current.items.push(...d.items)
    }
  }
  closeCurrent()

  return groups
}
