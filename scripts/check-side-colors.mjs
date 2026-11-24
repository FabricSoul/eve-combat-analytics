import { readFileSync } from 'node:fs'

// Machado, Oliveira and Fernandes (2009), severity 1.0, applied to linear sRGB.
// https://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html
const simulations = {
  normal: null,
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.011820, 0.042940, 0.968881],
  ],
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.303900],
  ],
}

const css = readFileSync(new URL('../src/app/styles/tokens.css', import.meta.url), 'utf8')
const themes = { light: /:root\s*\{([^}]+)\}/, dark: /\[data-appearance="dark"\]\s*\{([^}]+)\}/ }
const names = ['blue', 'red', 'magenta']
const pairs = [[0, 1], [0, 2], [1, 2]]
const dot = (row, vector) => row.reduce((sum, coefficient, index) => sum + coefficient * vector[index], 0)

function linearRgb(hex) {
  return hex.match(/../g).map((byte) => {
    const channel = Number.parseInt(byte, 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
}

function lab(rgb, simulation) {
  // Clip simulated colors to the display gamut before converting to XYZ and Lab (D65).
  const display = simulation ? simulation.map((row) => Math.max(0, Math.min(1, dot(row, rgb)))) : rgb
  const xyz = [
    dot([0.4123908, 0.35758434, 0.18048079], display) / 0.95045593,
    dot([0.21263901, 0.71516868, 0.07219232], display),
    dot([0.01933082, 0.11919478, 0.95053215], display) / 1.08905775,
  ]
  const [x, y, z] = xyz.map((value) => value > (6 / 29) ** 3 ? Math.cbrt(value) : value / (3 * (6 / 29) ** 2) + 4 / 29)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}

const radians = (degrees) => degrees * Math.PI / 180
const cosine = (degrees) => Math.cos(radians(degrees))
const hue = (b, a) => (Math.atan2(b, a) * 180 / Math.PI + 360) % 360
const chromaFactor = (chroma) => Math.sqrt(chroma ** 7 / (chroma ** 7 + 25 ** 7))

// CIEDE2000, with unit parametric factors. Sharma, Wu and Dalal (2005).
// https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/
function deltaE([l1, a1, b1], [l2, a2, b2]) {
  const g = (1 - chromaFactor((Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2)) / 2
  const a1Prime = (1 + g) * a1
  const a2Prime = (1 + g) * a2
  const c1 = Math.hypot(a1Prime, b1)
  const c2 = Math.hypot(a2Prime, b2)
  const h1 = hue(b1, a1Prime)
  const h2 = hue(b2, a2Prime)
  const hueSum = h1 + h2
  const hueDiff = h2 - h1
  const deltaHue = c1 * c2 === 0 ? 0 : hueDiff > 180 ? hueDiff - 360 : hueDiff < -180 ? hueDiff + 360 : hueDiff
  const meanHue = c1 * c2 === 0 ? hueSum : Math.abs(hueDiff) <= 180 ? hueSum / 2 : (hueSum + (hueSum < 360 ? 360 : -360)) / 2
  const meanChroma = (c1 + c2) / 2
  const meanLight = (l1 + l2) / 2
  const hueWeight = 1 - 0.17 * cosine(meanHue - 30) + 0.24 * cosine(2 * meanHue)
    + 0.32 * cosine(3 * meanHue + 6) - 0.20 * cosine(4 * meanHue - 63)
  const lightOffset = (meanLight - 50) ** 2
  const lightness = (l2 - l1) / (1 + 0.015 * lightOffset / Math.sqrt(20 + lightOffset))
  const chroma = (c2 - c1) / (1 + 0.045 * meanChroma)
  const hueDistance = 2 * Math.sqrt(c1 * c2) * Math.sin(radians(deltaHue / 2)) / (1 + 0.015 * meanChroma * hueWeight)
  const rotation = -2 * chromaFactor(meanChroma) * Math.sin(radians(60 * Math.exp(-(((meanHue - 275) / 25) ** 2))))
  return Math.sqrt(lightness ** 2 + chroma ** 2 + hueDistance ** 2 + rotation * chroma * hueDistance)
}

console.log('Pairwise CIEDE2000 ΔE · Machado et al. (2009), severity 1.0')
for (const [theme, selector] of Object.entries(themes)) {
  const declaration = css.match(selector)?.[1] ?? ''
  const hexes = names.map((name, index) => {
    const hex = declaration.match(new RegExp(`--color-side-${index}:\\s*#([0-9a-f]{6})\\s*;`, 'i'))?.[1]
    if (!hex) throw new Error(`Missing ${name} (--color-side-${index}) in the ${theme} theme`)
    return hex
  })
  const colors = hexes.map(linearRgb)
  console.log(`\n${theme}: ${hexes.map((hex, index) => `${names[index]}=#${hex}`).join('  ')}`)
  console.log('vision          blue/red  blue/magenta  red/magenta')
  for (const [vision, simulation] of Object.entries(simulations)) {
    const samples = colors.map((color) => lab(color, simulation))
    const distances = pairs.map(([a, b]) => deltaE(samples[a], samples[b]).toFixed(2))
    console.log(vision.padEnd(16) + distances[0].padStart(8) + distances[1].padStart(14) + distances[2].padStart(13))
  }
}
