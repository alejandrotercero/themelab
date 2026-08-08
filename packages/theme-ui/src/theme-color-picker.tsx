import colorLib from "color"
import { PipetteIcon } from "lucide-react"
import { Slider } from "radix-ui"
import { useCallback, useEffect, useRef, useState } from "react"

export interface ThemeColorPickerProps {
  /** A parseable CSS color. The picker emits a normalized #rrggbb hex value. */
  defaultValue: string
  onChange: (hex: string) => void
}

/**
 * Portable version of the Web app's Kibo picker surface. It deliberately owns
 * only color interaction; each product owns its popover positioning and tokens.
 */
export function ThemeColorPicker({ defaultValue, onChange }: ThemeColorPickerProps) {
  const initial = colorLib(defaultValue)
  const [hue, setHue] = useState(initial.hue() || 0)
  const [saturation, setSaturation] = useState(initial.saturationl() || 100)
  const [lightness, setLightness] = useState(initial.lightness() || 50)
  const [mode, setMode] = useState<"hex" | "rgb" | "css" | "hsl">("hex")
  const [text, setText] = useState(initial.hex().toUpperCase())
  const [editing, setEditing] = useState(false)
  const selectionRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const current = useCallback(() => colorLib.hsl(hue, saturation, lightness), [hue, saturation, lightness])
  const emit = useCallback((nextHue: number, nextSaturation: number, nextLightness: number) => {
    const next = colorLib.hsl(nextHue, nextSaturation, nextLightness)
    setHue(nextHue)
    setSaturation(nextSaturation)
    setLightness(nextLightness)
    setText(next.hex().toUpperCase())
    onChange(next.hex())
  }, [onChange])

  const updateSelection = useCallback((event: PointerEvent) => {
    if (!selectionRef.current) return
    const rect = selectionRef.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
    const topLightness = x < 0.01 ? 100 : 50 + 50 * (1 - x)
    emit(hue, x * 100, topLightness * (1 - y))
  }, [emit, hue])

  useEffect(() => {
    const move = (event: PointerEvent) => { if (dragging.current) updateSelection(event) }
    const up = () => { dragging.current = false }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up) }
  }, [updateSelection])

  const liveHex = current().hex().toUpperCase()
  const selectionX = saturation
  const topLightness = selectionX < 1 ? 100 : 50 + 50 * (1 - selectionX / 100)
  const selectionY = Math.max(0, Math.min(100, (1 - lightness / topLightness) * 100))
  const setHex = (raw: string) => {
    setText(raw)
    const normalized = raw.trim().startsWith("#") ? raw.trim() : `#${raw.trim()}`
    if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(normalized)) return
    const next = colorLib(normalized)
    emit(next.hue() || 0, next.saturationl(), next.lightness())
  }
  const eyedropper = async () => {
    const EyeDropperCtor = (window as typeof window & { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper
    if (!EyeDropperCtor) return
    try {
      setHex((await new EyeDropperCtor().open()).sRGBHex)
    } catch {
      // Browser cancellation is an expected interaction, not an error state.
    }
  }

  return <div className="web-picker">
    <div className="web-picker-selection" onPointerDown={(event) => { event.preventDefault(); dragging.current = true; updateSelection(event.nativeEvent) }} ref={selectionRef} style={{ background: `linear-gradient(0deg, rgba(0,0,0,1), rgba(0,0,0,0)), linear-gradient(90deg, rgba(255,255,255,1), rgba(255,255,255,0)), hsl(${hue}, 100%, 50%)` }}>
      <i style={{ left: `${selectionX}%`, top: `${selectionY}%` }} />
    </div>
    <div className="web-picker-hue-row">
      <button aria-label="Pick color from screen" className="web-picker-eyedropper" onClick={() => void eyedropper()} type="button"><PipetteIcon size={17} /></button>
      <Slider.Root className="web-picker-hue" max={360} onValueChange={([next]) => emit(next, saturation, lightness)} step={1} value={[hue]}>
        <Slider.Track><Slider.Range /></Slider.Track>
        <Slider.Thumb aria-label="Hue" />
      </Slider.Root>
    </div>
    <div className="web-picker-output">
      <select aria-label="Color format" onChange={(event) => setMode(event.target.value as typeof mode)} value={mode}><option value="hex">hex</option><option value="rgb">rgb</option><option value="css">css</option><option value="hsl">hsl</option></select>
      <input aria-label="Color value" onBlur={() => setEditing(false)} onChange={(event) => setHex(event.target.value)} onFocus={() => { setEditing(true); setText(liveHex) }} value={editing ? text : mode === "hex" ? liveHex : mode === "rgb" ? current().rgb().string() : mode === "hsl" ? current().hsl().string() : current().string()} />
    </div>
  </div>
}
