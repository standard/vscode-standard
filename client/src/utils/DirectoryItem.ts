import * as Is from './Is'

export interface DirectoryItem {
  directory: string
  changeProcessCWD?: boolean
}

export function is (item: any): item is DirectoryItem {
  const candidate = item as DirectoryItem
  return (
    candidate != null &&
    Is.string(candidate.directory) &&
    (Is.boolean(candidate.changeProcessCWD) ||
      candidate.changeProcessCWD === undefined)
  )
}
