const imageHost = 'https://images.evetech.net'

function imageSize(cssPx: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, 2 ** Math.ceil(Math.log2(cssPx * 2))))
}

export const portraitUrl = (charId: number, cssPx: number) =>
  `${imageHost}/characters/${charId}/portrait?size=${imageSize(cssPx, 64, 128)}`

export const typeIconUrl = (typeId: number, cssPx: number) =>
  `${imageHost}/types/${typeId}/icon?size=${imageSize(cssPx, 32, 64)}`

export const typeRenderUrl = (typeId: number, cssPx: number) =>
  `${imageHost}/types/${typeId}/render?size=${imageSize(cssPx, 64, 512)}`

export const allianceLogoUrl = (id: number, cssPx = 20) =>
  `${imageHost}/alliances/${id}/logo?size=${imageSize(cssPx, 32, 128)}`

export const corpLogoUrl = (id: number, cssPx = 20) =>
  `${imageHost}/corporations/${id}/logo?size=${imageSize(cssPx, 32, 128)}`
