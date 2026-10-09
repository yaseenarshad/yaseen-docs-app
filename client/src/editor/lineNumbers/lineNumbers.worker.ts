import './workerDocument'
import { blockLines } from './blockLines'

self.onmessage = (event: MessageEvent<{ id: number; text: string }>) => {
  self.postMessage({ id: event.data.id, ...blockLines(event.data.text) })
}
