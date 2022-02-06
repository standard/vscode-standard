import { runMocha } from '../runMocha'

export async function run (): Promise<void> {
  return await runMocha('legacy')
}
