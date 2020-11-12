export function is<T> (value: any): value is Thenable<T> {
  const candidate: Thenable<T> = value
  return candidate != null && typeof candidate.then === 'function'
}
