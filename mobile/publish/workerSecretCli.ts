import { main } from './workerSecret'

process.exitCode = main(process.argv.slice(2))
