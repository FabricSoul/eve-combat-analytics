import type { Affiliation, TeamMember } from '../contract'
import { sideOf } from '../br/normalize'

/** Index into `teams` for a character's affiliation, or -1 when it matches no team. */
export function sideForCharacter(aff: Affiliation, teams: TeamMember[][]): number {
  return sideOf(aff, teams)
}
