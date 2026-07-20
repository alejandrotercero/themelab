"use client"

import colorLib from "color"
import { PipetteIcon } from "lucide-react"
import { Slider } from "radix-ui"
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { ComponentProps, HTMLAttributes } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

interface ColorPickerContextValue {
  hue: number
  saturation: number
  lightness: number
  alpha: number
  mode: string
  setHue: (hue: number) => void
  setSaturation: (saturation: number) => void
  setLightness: (lightness: number) => void
  setAlpha: (alpha: number) => void
  setMode: (mode: string) => void
}

const ColorPickerContext = createContext<ColorPickerContextValue | undefined>(
  undefined
)

export const useColorPicker = () => {
  const context = useContext(ColorPickerContext)

  if (!context) {
    throw new Error("useColorPicker must be used within a ColorPickerProvider")
  }

  return context
}

export type ColorPickerProps = HTMLAttributes<HTMLDivElement> & {
  value?: Parameters<typeof colorLib>[0]
  defaultValue?: Parameters<typeof colorLib>[0]
  onChange?: (value: Parameters<typeof colorLib.rgb>[0]) => void
}

export const ColorPicker = ({
  value,
  defaultValue = "#000000",
  onChange,
  className,
  ...props
}: ColorPickerProps) => {
  const selectedColor = colorLib(value)
  const defaultColor = colorLib(defaultValue)

  const [hue, setHue] = useState(selectedColor.hue() || defaultColor.hue() || 0)
  const [saturation, setSaturation] = useState(
    selectedColor.saturationl() || defaultColor.saturationl() || 100
  )
  const [lightness, setLightness] = useState(
    selectedColor.lightness() || defaultColor.lightness() || 50
  )
  const [alpha, setAlpha] = useState(
    selectedColor.alpha() * 100 || defaultColor.alpha() * 100
  )
  const [mode, setMode] = useState("hex")

  // Read onChange through a ref so a parent passing a new closure each render
  // (e.g. an inline handler) can't retrigger the notify effect below. Without
  // this, the effect fires on every render — and a lossy round-trip in the
  // caller means the emitted color rarely equals the incoming value, so the
  // parent keeps updating and re-rendering: Maximum update depth exceeded.
  const onChangeRef = useRef(onChange)
  // eslint-disable-next-line react-hooks/refs -- intentional: update ref during render to avoid stale closure in notify effect, see apps/web/CLAUDE.md
  onChangeRef.current = onChange // oxlint-disable-line react-compiler -- same intentional ref-during-render pattern as the eslint-disable above

  // Update color when controlled value changes. Adjusted during render (React's
  // documented "adjusting state when a prop changes" pattern) instead of in an
  // effect, so the sync happens before paint and doesn't trigger react-compiler's
  // EffectSetState warning.
  const [prevValue, setPrevValue] = useState(value)
  if (value !== prevValue) {
    setPrevValue(value)
    if (value) {
      const color = colorLib.rgb(value).rgb().object()

      setHue(color.r)
      setSaturation(color.g)
      setLightness(color.b)
      setAlpha(color.a)
    }
  }

  // Notify parent only when the color itself changes (user interaction),
  // not when the parent hands us a fresh onChange identity.
  useEffect(() => {
    const color = colorLib.hsl(hue, saturation, lightness).alpha(alpha / 100)
    const rgba = color.rgb().array()

    onChangeRef.current?.([rgba[0], rgba[1], rgba[2], alpha / 100])
  }, [hue, saturation, lightness, alpha])

  const contextValue = useMemo(
    () => ({
      hue,
      saturation,
      lightness,
      alpha,
      mode,
      setHue,
      setSaturation,
      setLightness,
      setAlpha,
      setMode,
    }),
    [
      hue,
      saturation,
      lightness,
      alpha,
      mode,
      setHue,
      setSaturation,
      setLightness,
      setAlpha,
      setMode,
    ]
  )

  return (
    <ColorPickerContext.Provider value={contextValue}>
      <div
        className={cn("flex size-full flex-col gap-4", className)}
        {...props}
      />
    </ColorPickerContext.Provider>
  )
}

export type ColorPickerSelectionProps = HTMLAttributes<HTMLDivElement>

export const ColorPickerSelection = memo(
  ({ className, ...props }: ColorPickerSelectionProps) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const [isDragging, setIsDragging] = useState(false)
    const { hue, saturation, lightness, setSaturation, setLightness } =
      useColorPicker()

    // Derive the thumb position from the live saturation/lightness every render so
    // it tracks ANY change to the color — drag, eyedropper, or a typed hex — not
    // just the initial mount. (Replaces Kibo's mount-only placement hack.)
    const x = saturation / 100
    const topLightness = x < 0.01 ? 100 : 50 + 50 * (1 - x)
    const yRaw = topLightness === 0 ? 0 : 1 - lightness / topLightness
    const positionX = Math.min(1, Math.max(0, x))
    const positionY = Math.min(1, Math.max(0, yRaw))

    const backgroundGradient = useMemo(
      () =>
        `linear-gradient(0deg, rgba(0,0,0,1), rgba(0,0,0,0)),
            linear-gradient(90deg, rgba(255,255,255,1), rgba(255,255,255,0)),
            hsl(${hue}, 100%, 50%)`,
      [hue]
    )

    const handlePointerMove = useCallback(
      (event: PointerEvent) => {
        if (!(isDragging && containerRef.current)) {
          return
        }
        const rect = containerRef.current.getBoundingClientRect()
        const pointerX = Math.max(
          0,
          Math.min(1, (event.clientX - rect.left) / rect.width)
        )
        const pointerY = Math.max(
          0,
          Math.min(1, (event.clientY - rect.top) / rect.height)
        )
        setSaturation(pointerX * 100)
        const pointerTopLightness =
          pointerX < 0.01 ? 100 : 50 + 50 * (1 - pointerX)
        const pointerLightness = pointerTopLightness * (1 - pointerY)

        setLightness(pointerLightness)
      },
      [isDragging, setSaturation, setLightness]
    )

    useEffect(() => {
      const handlePointerUp = () => setIsDragging(false)

      if (isDragging) {
        window.addEventListener("pointermove", handlePointerMove)
        window.addEventListener("pointerup", handlePointerUp)
      }

      return () => {
        window.removeEventListener("pointermove", handlePointerMove)
        window.removeEventListener("pointerup", handlePointerUp)
      }
    }, [isDragging, handlePointerMove])

    return (
      <div
        className={cn("relative size-full cursor-crosshair rounded", className)}
        onPointerDown={(e) => {
          e.preventDefault()
          setIsDragging(true)
          handlePointerMove(e.nativeEvent)
        }}
        ref={containerRef}
        style={{
          background: backgroundGradient,
        }}
        {...props}
      >
        <div
          className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white"
          style={{
            left: `${positionX * 100}%`,
            top: `${positionY * 100}%`,
            boxShadow: "0 0 0 1px rgba(0,0,0,0.5)",
          }}
        />
      </div>
    )
  }
)

ColorPickerSelection.displayName = "ColorPickerSelection"

export type ColorPickerHueProps = ComponentProps<typeof Slider.Root>

export const ColorPickerHue = ({
  className,
  ...props
}: ColorPickerHueProps) => {
  const { hue, setHue } = useColorPicker()

  return (
    <Slider.Root
      className={cn("relative flex h-4 w-full touch-none", className)}
      max={360}
      onValueChange={([nextHue]) => setHue(nextHue)}
      step={1}
      value={[hue]}
      {...props}
    >
      <Slider.Track className="relative my-0.5 h-3 w-full grow rounded-full bg-[linear-gradient(90deg,#FF0000,#FFFF00,#00FF00,#00FFFF,#0000FF,#FF00FF,#FF0000)]">
        <Slider.Range className="absolute h-full" />
      </Slider.Track>
      <Slider.Thumb className="block h-4 w-4 rounded-full border border-primary/50 bg-background shadow transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50" />
    </Slider.Root>
  )
}

export type ColorPickerAlphaProps = ComponentProps<typeof Slider.Root>

export const ColorPickerAlpha = ({
  className,
  ...props
}: ColorPickerAlphaProps) => {
  const { alpha, setAlpha } = useColorPicker()

  return (
    <Slider.Root
      className={cn("relative flex h-4 w-full touch-none", className)}
      max={100}
      onValueChange={([nextAlpha]) => setAlpha(nextAlpha)}
      step={1}
      value={[alpha]}
      {...props}
    >
      <Slider.Track className="relative my-0.5 h-3 w-full grow rounded-full bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYGAQYcAP3uCTZhw1gGGYhAGBZIA/nYDCgBDAm9BGDWAAJyRCgLaBCAAgXwixzAS0pgAAAABJRU5ErkJggg==')] bg-center bg-repeat-x dark:bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAALklEQVR4nGP8+vWrCAMewM3N/QafPBM+SWLAqAGDwQBGQgoIpZOB98KoAVQwAADxzQcSVIRCfQAAAABJRU5ErkJggg==')]">
        <div className="absolute inset-0 rounded-full bg-gradient-to-r from-transparent to-black/50 dark:to-white/50" />
        <Slider.Range className="absolute h-full rounded-full bg-transparent" />
      </Slider.Track>
      <Slider.Thumb className="block h-4 w-4 rounded-full border border-primary/50 bg-background shadow transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50" />
    </Slider.Root>
  )
}

export type ColorPickerEyeDropperProps = ComponentProps<typeof Button>

export const ColorPickerEyeDropper = ({
  className,
  ...props
}: ColorPickerEyeDropperProps) => {
  const { setHue, setSaturation, setLightness, setAlpha } = useColorPicker()

  const handleEyeDropper = async () => {
    try {
      // @ts-expect-error - EyeDropper API is experimental
      const eyeDropper = new EyeDropper()
      const result = await eyeDropper.open()
      const color = colorLib(result.sRGBHex)
      const [h, s, l] = color.hsl().array()

      setHue(h)
      setSaturation(s)
      setLightness(l)
      setAlpha(100)
    } catch (error) {
      console.error("EyeDropper failed:", error)
    }
  }

  return (
    <Button
      className={cn("shrink-0 text-muted-foreground", className)}
      onClick={handleEyeDropper}
      size="icon"
      type="button"
      variant="outline"
      {...props}
    >
      <PipetteIcon size={16} />
    </Button>
  )
}

export type ColorPickerOutputProps = ComponentProps<typeof SelectTrigger>

const formats = ["hex", "rgb", "css", "hsl"]

export const ColorPickerOutput = ({
  className,
  ...props
}: ColorPickerOutputProps) => {
  const { mode, setMode } = useColorPicker()

  return (
    <Select onValueChange={(value) => value && setMode(value)} value={mode}>
      <SelectTrigger
        className={cn("h-8 w-20 shrink-0 text-xs", className)}
        {...props}
      >
        <SelectValue placeholder="Mode" />
      </SelectTrigger>
      <SelectContent>
        {formats.map((format) => (
          <SelectItem className="text-xs" key={format} value={format}>
            {format.toUpperCase()}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// Editable hex field: type a #rrggbb (or #rgb) and it drives the picker. Kibo's
// original field is readOnly; this lets users paste/enter exact colors. While the
// field is focused we show the raw text so partial input isn't clobbered; on blur
// we fall back to the live color (any valid keystroke is applied immediately).
const HexInput = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => {
  const { hue, saturation, lightness, setHue, setSaturation, setLightness } =
    useColorPicker()
  const live = colorLib.hsl(hue, saturation, lightness).hex()
  const [text, setText] = useState(live)
  const [editing, setEditing] = useState(false)

  const apply = (raw: string) => {
    const norm = `#${raw.trim().replace(/^#/, "")}`
    if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(norm)) {
      const [h, s, l] = colorLib(norm).hsl().array()
      setHue(h || 0)
      setSaturation(s)
      setLightness(l)
    }
  }

  return (
    <div className={cn("w-full", className)} {...props}>
      <Input
        autoComplete="off"
        className="h-8 w-full bg-secondary px-2 text-xs shadow-none"
        onBlur={() => setEditing(false)}
        onChange={(event) => {
          setText(event.target.value)
          apply(event.target.value)
        }}
        onFocus={() => {
          setEditing(true)
          setText(live)
        }}
        spellCheck={false}
        type="text"
        value={editing ? text : live}
      />
    </div>
  )
}

// One editable numeric channel (R/G/B or H/S/L). Keeps raw text while focused so
// partial input isn't clobbered; commits clamped to [0, max] on each keystroke.
const ChannelInput = ({
  value,
  max,
  onCommit,
  first,
  last,
}: {
  value: number
  max: number
  onCommit: (n: number) => void
  first?: boolean
  last?: boolean
}) => {
  const [text, setText] = useState(String(value))
  const [editing, setEditing] = useState(false)

  return (
    <Input
      className={cn(
        "h-8 min-w-0 flex-1 bg-secondary px-1.5 text-center text-xs shadow-none",
        !first && "rounded-l-none",
        !last && "rounded-r-none"
      )}
      inputMode="numeric"
      onBlur={() => setEditing(false)}
      onChange={(event) => {
        setText(event.target.value)
        const n = Number(event.target.value)
        if (event.target.value.trim() !== "" && Number.isFinite(n)) {
          onCommit(Math.min(max, Math.max(0, n)))
        }
      }}
      onFocus={() => {
        setEditing(true)
        setText(String(value))
      }}
      type="text"
      value={editing ? text : String(value)}
    />
  )
}

export type ColorPickerFormatProps = HTMLAttributes<HTMLDivElement>

export const ColorPickerFormat = ({
  className,
  ...props
}: ColorPickerFormatProps) => {
  const {
    hue,
    saturation,
    lightness,
    alpha,
    mode,
    setHue,
    setSaturation,
    setLightness,
  } = useColorPicker()
  const color = colorLib.hsl(hue, saturation, lightness, alpha / 100)

  if (mode === "hex") {
    return <HexInput className={className} {...props} />
  }

  if (mode === "rgb") {
    const rgb = color
      .rgb()
      .array()
      .slice(0, 3)
      .map((value) => Math.round(value))
    const setChannel = (index: number, n: number) => {
      const next = [...rgb]
      next[index] = n
      const [h, s, l] = colorLib.rgb(next).hsl().array()
      setHue(h || 0)
      setSaturation(s)
      setLightness(l)
    }

    return (
      <div
        className={cn(
          "flex w-full items-center -space-x-px rounded-md shadow-sm",
          className
        )}
        {...props}
      >
        {rgb.map((value, index) => (
          <ChannelInput
            first={index === 0}
            key={index}
            last={index === rgb.length - 1}
            max={255}
            onCommit={(n) => setChannel(index, n)}
            value={value}
          />
        ))}
      </div>
    )
  }

  if (mode === "css") {
    const rgb = color
      .rgb()
      .array()
      .slice(0, 3)
      .map((value) => Math.round(value))

    return (
      <div className={cn("w-full rounded-md shadow-sm", className)} {...props}>
        <Input
          className="h-8 w-full bg-secondary px-2 text-xs shadow-none"
          readOnly
          type="text"
          value={`rgb(${rgb.join(", ")})`}
        />
      </div>
    )
  }

  if (mode === "hsl") {
    const hsl = color
      .hsl()
      .array()
      .slice(0, 3)
      .map((value) => Math.round(value))
    const maxes = [360, 100, 100]
    const setChannel = (index: number, n: number) => {
      if (index === 0) {
        setHue(n)
      } else if (index === 1) {
        setSaturation(n)
      } else {
        setLightness(n)
      }
    }

    return (
      <div
        className={cn(
          "flex w-full items-center -space-x-px rounded-md shadow-sm",
          className
        )}
        {...props}
      >
        {hsl.map((value, index) => (
          <ChannelInput
            first={index === 0}
            key={index}
            last={index === hsl.length - 1}
            max={maxes[index]}
            onCommit={(n) => setChannel(index, n)}
            value={value}
          />
        ))}
      </div>
    )
  }

  return null
}
