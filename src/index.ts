/**
 * The entrypoint for the action.
 */
// @ts-expect-error moduleResolution:nodenext issue 54523
import { run } from './main'

// eslint-disable-next-line @typescript-eslint/no-floating-promises
run()
