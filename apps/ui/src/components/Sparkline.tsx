import { useId } from 'react'
import { useI18n } from '../i18n/context'
import type { MessageKey } from '../i18n/types'
import type { TrafficPoint, TrafficRange } from '../types'

const WIDTH = 640
const HEIGHT = 176
const PAD_LEFT = 64
const PAD_RIGHT = 8
const PAD_TOP = 14
const PAD_BOTTOM = 22

function niceMax(value: number): number {
  if (value <= 2) return 2
  if (value <= 4) return 4
  if (value <= 6) return 6
  if (value <= 8) return 8
  return Math.ceil(value / 2) * 2
}

/**
 * Fritsch-Carlson monotone cubic tangents for a series of (x, y) samples.
 * Tangents are clamped so the resulting Hermite spline never overshoots
 * beyond the value range of its two neighboring points (no fake bumps).
 */
function monotoneTangents(xs: number[], ys: number[]): number[] {
  const n = xs.length
  const tangents = new Array(n).fill(0)
  if (n < 2) return tangents

  const secants: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const h = xs[i + 1] - xs[i]
    secants.push(h !== 0 ? (ys[i + 1] - ys[i]) / h : 0)
  }

  if (n === 2) {
    tangents[0] = secants[0]
    tangents[1] = secants[0]
    return tangents
  }

  tangents[0] = secants[0]
  tangents[n - 1] = secants[n - 2]
  for (let i = 1; i < n - 1; i++) {
    tangents[i] = secants[i - 1] * secants[i] <= 0 ? 0 : (secants[i - 1] + secants[i]) / 2
  }

  // Limit tangents (Fritsch-Carlson) so the curve stays within the local min/max.
  for (let i = 0; i < n - 1; i++) {
    const s = secants[i]
    if (s === 0) {
      tangents[i] = 0
      tangents[i + 1] = 0
      continue
    }
    const a = tangents[i] / s
    const b = tangents[i + 1] / s
    const magnitude = a * a + b * b
    if (magnitude > 9) {
      const scale = 3 / Math.sqrt(magnitude)
      tangents[i] = scale * a * s
      tangents[i + 1] = scale * b * s
    }
  }

  return tangents
}

/** Builds a smooth monotone-cubic path (`M` + `C` segments) through pixel-space points. */
function monotonePath(xs: number[], ys: number[]): string {
  const n = xs.length
  if (n < 2) return ''
  const tangents = monotoneTangents(xs, ys)
  let path = `M${xs[0].toFixed(1)},${ys[0].toFixed(1)}`
  for (let i = 0; i < n - 1; i++) {
    const h = xs[i + 1] - xs[i]
    const cp1x = xs[i] + h / 3
    const cp1y = ys[i] + (tangents[i] * h) / 3
    const cp2x = xs[i + 1] - h / 3
    const cp2y = ys[i + 1] - (tangents[i + 1] * h) / 3
    path += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${xs[i + 1].toFixed(1)},${ys[i + 1].toFixed(1)}`
  }
  return path
}

interface TrafficChartProps {
  points: TrafficPoint[]
  /** Currently selected time range, used for the aria-label's range phrase.
   * The x-axis tick unit itself is derived from the actual point span below,
   * not from this — so it always matches what's drawn even if `range` and
   * `points` are briefly out of sync mid-fetch. */
  range?: TrafficRange
}

/** i18n key for each range's label, e.g. for the chart's aria-label. */
const RANGE_LABEL_KEY: Record<TrafficRange, MessageKey> = {
  '15m': 'overview.traffic.range.15m',
  '1h': 'overview.traffic.range.1h',
  '7d': 'overview.traffic.range.7d',
  '30d': 'overview.traffic.range.30d',
}

/** Thresholds (in seconds) for switching the x-axis tick unit as the
 * selected window grows — minutes stay readable up to a few hours, hours up
 * to a few days, days beyond that. */
const TICK_UNIT_HOURS_THRESHOLD_SECS = 3 * 3600
const TICK_UNIT_DAYS_THRESHOLD_SECS = 3 * 86400

/**
 * Traffic area chart: one shared scale (`x`, `y`, `maxValue`) drives marks,
 * gridlines and labels, so every printed number is a value the chart
 * actually reaches. Series lines/areas are rendered as monotone cubic
 * splines (Fritsch-Carlson) over that same scale, so the smoothing never
 * overshoots past the data's local min/max.
 */
export function TrafficChart({ points, range = '15m' }: TrafficChartProps) {
  const { t, fmt } = useI18n()
  const uid = useId()
  const innerW = WIDTH - PAD_LEFT - PAD_RIGHT
  const innerH = HEIGHT - PAD_TOP - PAD_BOTTOM
  const hasPoints = points.length > 0
  const minT = hasPoints ? points[0].t : 0
  const maxT = hasPoints ? points[points.length - 1].t : 1
  const rangeT = maxT - minT
  const tickUnit: 'minutes' | 'hours' | 'days' =
    rangeT <= TICK_UNIT_HOURS_THRESHOLD_SECS ? 'minutes' : rangeT <= TICK_UNIT_DAYS_THRESHOLD_SECS ? 'hours' : 'days'
  // Avoid dividing by zero when there's a single point (minT === maxT) or no points at all.
  const safeRangeT = rangeT > 0 ? rangeT : 1
  const maxValue = niceMax(Math.max(1, ...points.map((p) => Math.max(p.proxied, p.direct))))

  const x = (t: number) => PAD_LEFT + ((t - minT) / safeRangeT) * innerW
  const y = (v: number) => PAD_TOP + innerH - (v / maxValue) * innerH

  const linePath = (key: 'proxied' | 'direct') => {
    const xs = points.map((p) => x(p.t))
    const ys = points.map((p) => y(p[key]))
    return monotonePath(xs, ys)
  }

  const areaPath = (key: 'proxied' | 'direct') => {
    if (points.length < 2) return ''
    const xs = points.map((p) => x(p.t))
    const ys = points.map((p) => y(p[key]))
    const line = monotonePath(xs, ys)
    const baseline = y(0)
    return `${line} L${xs[xs.length - 1].toFixed(1)},${baseline.toFixed(1)} L${xs[0].toFixed(1)},${baseline.toFixed(1)} Z`
  }

  const yTicks = [0, maxValue / 2, maxValue]
  const xTickCount = 4
  const xTicks = !hasPoints
    ? []
    : rangeT > 0
      ? Array.from({ length: xTickCount + 1 }, (_, i) => minT + (rangeT / xTickCount) * i)
      : [maxT]

  const last = points[points.length - 1]
  const proxiedNow = fmt.rate(last?.proxied ?? 0)
  const directNow = fmt.rate(last?.direct ?? 0)
  const rangeLabel = t(RANGE_LABEL_KEY[range])

  return (
    <div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={t('chart.traffic.aria', { range: rangeLabel, proxied: proxiedNow, direct: directNow })}
        className="w-full"
      >
        <defs>
          <linearGradient id={`${uid}-grad-direct`} gradientUnits="userSpaceOnUse" x1="0" y1={PAD_TOP} x2="0" y2={HEIGHT - PAD_BOTTOM}>
            <stop offset="0%" stopColor="var(--rx-route-direct)" stopOpacity="0.2" />
            <stop offset="100%" stopColor="var(--rx-route-direct)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${uid}-grad-proxied`} gradientUnits="userSpaceOnUse" x1="0" y1={PAD_TOP} x2="0" y2={HEIGHT - PAD_BOTTOM}>
            <stop offset="0%" stopColor="var(--rx-accent)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--rx-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {yTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD_LEFT}
              x2={WIDTH - PAD_RIGHT}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--rx-line)"
              strokeWidth="1"
              strokeDasharray="2 3"
              opacity={0.6}
            />
            <text x={PAD_LEFT - 6} y={y(tick)} textAnchor="end" dominantBaseline="middle" fontSize="11" fill="var(--rx-muted)">
              {fmt.rate(tick)}
            </text>
          </g>
        ))}

        {xTicks.map((tick) => {
          const secondsAgo = maxT - tick
          let label: string
          if (secondsAgo === 0) {
            label = t('chart.tick.now')
          } else if (tickUnit === 'minutes') {
            label = t('chart.tick.minutesAgo', { minutes: Math.round(secondsAgo / 60) })
          } else if (tickUnit === 'hours') {
            label = t('chart.tick.hoursAgo', { hours: Math.round(secondsAgo / 3600) })
          } else {
            label = t('chart.tick.daysAgo', { days: Math.round(secondsAgo / 86400) })
          }
          return (
            <text
              key={tick}
              x={x(tick)}
              y={HEIGHT - 4}
              textAnchor={tick === minT ? 'start' : tick === maxT ? 'end' : 'middle'}
              fontSize="11"
              fill="var(--rx-muted)"
            >
              {label}
            </text>
          )
        })}

        <path d={areaPath('direct')} fill={`url(#${uid}-grad-direct)`} stroke="none" />
        <path d={linePath('direct')} fill="none" stroke="var(--rx-route-direct)" strokeWidth="2" />

        <path d={areaPath('proxied')} fill={`url(#${uid}-grad-proxied)`} stroke="none" />
        <path d={linePath('proxied')} fill="none" stroke="var(--rx-accent)" strokeWidth="2" />

        {last ? (
          <>
            <circle cx={x(last.t)} cy={y(last.direct)} r="6" fill="var(--rx-route-direct)" opacity="0.18" stroke="none" />
            <circle cx={x(last.t)} cy={y(last.direct)} r="3" fill="var(--rx-route-direct)" stroke="var(--rx-surface)" strokeWidth="1.5" />
            <circle cx={x(last.t)} cy={y(last.proxied)} r="6" fill="var(--rx-accent)" opacity="0.18" stroke="none" />
            <circle cx={x(last.t)} cy={y(last.proxied)} r="3" fill="var(--rx-accent)" stroke="var(--rx-surface)" strokeWidth="1.5" />
          </>
        ) : null}
      </svg>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-12 text-muted">
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ background: 'var(--rx-accent)' }} />
          {t('chart.legend.proxied', { value: proxiedNow })}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ background: 'var(--rx-route-direct)' }} />
          {t('chart.legend.direct', { value: directNow })}
        </span>
      </div>
    </div>
  )
}
