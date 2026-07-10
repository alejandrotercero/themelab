export function downloadTextFile(
  content: string,
  filename: string,
  type = "text/plain"
) {
  const url = URL.createObjectURL(
    new Blob([content], { type: `${type};charset=utf-8` })
  )
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
