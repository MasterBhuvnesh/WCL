import { useExam } from '@renderer/context/ExamProvider'

/** Escape XML special characters so the username is safe inside the SVG tile. */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Full-screen tiled watermark with the candidate name and exam ID, rendered
 * over the exam content. Deters photographing or screenshotting the paper by
 * tying every capture to the candidate. Non-interactive; mid-gray at low
 * opacity so it reads on both the light and dark themes.
 */
export function Watermark(): React.JSX.Element | null {
  const { username, exam } = useExam()
  if (!username) return null

  const label = escapeXml(exam ? `${username} · ${exam.examId}` : username)
  const tile =
    `<svg xmlns='http://www.w3.org/2000/svg' width='340' height='200'>` +
    `<text x='170' y='100' text-anchor='middle' transform='rotate(-30 170 100)'` +
    ` font-family='Inter, sans-serif' font-size='15' fill='#808080' fill-opacity='0.09'>` +
    label +
    `</text></svg>`

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-40"
      style={{ backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(tile)}")` }}
    />
  )
}
