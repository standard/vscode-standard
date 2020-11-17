import * as Is from './Is'

export interface ValidateItem {
  language: string
  autoFix?: boolean
}

export type ValidateArray = Array<ValidateItem | string>

export function is (item: any): item is ValidateItem {
  const candidate = item as ValidateItem
  return (
    candidate != null &&
    Is.string(candidate.language) &&
    (Is.boolean(candidate.autoFix) || candidate.autoFix === undefined)
  )
}
