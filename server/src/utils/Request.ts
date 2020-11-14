import { CancellationToken } from 'vscode-languageserver'

export interface Request<P, R> {
  method: string
  params: P
  documentVersion: number | undefined
  resolve: (value: R | Thenable<R>) => void
  reject: (error: any) => void
  token: CancellationToken | undefined
}

export function is (value: any): value is Request<any, any> {
  const candidate: Request<any, any> = value
  return (
    candidate?.token != null &&
    candidate?.resolve != null &&
    candidate?.reject != null
  )
}
