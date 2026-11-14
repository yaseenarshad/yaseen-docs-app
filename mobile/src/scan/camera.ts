import { ScanError, type ScanSession, type Scanner } from './scanner'

/** The longest side of a frame given to the reader: enough for a code on a Mac screen, and quick on a phone. */
const FRAME_SIDE = 720
/** Time between two reads. */
const READ_EVERY_MS = 150

/**
 * The real scanner: the back camera through `getUserMedia`, a frame each `READ_EVERY_MS` drawn into a canvas, then the
 * reader (`qrDecode.ts`, loaded with `import()` the first time, so it is not in the first load). Not covered by tests
 * (no camera in a test); the screen is tested with a fake `Scanner`.
 */
export function cameraScanner(load: () => Promise<typeof import('./qrDecode')> = () => import('./qrDecode')): Scanner {
  return {
    async start(video, onText) {
      const media = globalThis.navigator?.mediaDevices
      if (typeof media?.getUserMedia !== 'function') throw new ScanError('no-camera')
      const reader = load().catch(() => {
        throw new ScanError('reader-failed')
      })
      // The reader loads while the person answers the camera prompt; a camera failure must not leave it unhandled.
      reader.catch(() => undefined)
      let stream: MediaStream
      try {
        stream = await media.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      } catch (error) {
        const name = (error as { name?: string } | null)?.name
        throw new ScanError(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'no-camera')
      }
      const stopTracks = () => stream.getTracks().forEach((track) => track.stop())
      let readQr: (typeof import('./qrDecode'))['readQr']
      try {
        readQr = (await reader).readQr
      } catch (error) {
        stopTracks()
        throw error
      }
      video.srcObject = stream
      video.setAttribute('playsinline', '')
      video.muted = true
      await video.play().catch(() => undefined)

      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d', { willReadFrequently: true })
      let stopped = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const tick = () => {
        if (stopped) return
        if (context !== null && video.videoWidth > 0) {
          const scale = Math.min(1, FRAME_SIDE / Math.max(video.videoWidth, video.videoHeight))
          canvas.width = Math.round(video.videoWidth * scale)
          canvas.height = Math.round(video.videoHeight * scale)
          context.drawImage(video, 0, 0, canvas.width, canvas.height)
          const text = readQr(context.getImageData(0, 0, canvas.width, canvas.height))
          if (text !== null && !stopped) onText(text)
        }
        if (!stopped) timer = setTimeout(tick, READ_EVERY_MS)
      }
      tick()
      const session: ScanSession = {
        stop() {
          if (stopped) return
          stopped = true
          clearTimeout(timer)
          stopTracks()
          video.srcObject = null
        },
      }
      return session
    },
  }
}
