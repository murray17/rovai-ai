export async function requestNormalApplicationQuit({
  platform = process.platform,
  app,
  runProcess,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
}) {
  if (platform === 'win32') {
    try {
      await Promise.race([
        app.cdp.send('Browser.close'),
        wait(1_000)
      ])
    } catch (error) {
      if (!isExpectedCdpClose(error)) throw error
    }
    return
  }

  if (platform === 'darwin') {
    const script = [
      'ObjC.import("AppKit")',
      `const target = $.NSRunningApplication.runningApplicationWithProcessIdentifier(${app.child.pid})`,
      'if (!target.js) throw new Error("Isolated packaged App is not running")',
      'if (!target.terminate) throw new Error("macOS rejected the normal termination request")'
    ].join('; ')
    await runProcess('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script])
    return
  }

  throw new Error(`Planned shutdown App quit is unsupported on ${platform}`)
}

function isExpectedCdpClose(error) {
  return /(?:CDP|WebSocket|connection|socket).*closed|closed.*(?:CDP|WebSocket|connection|socket)/i
    .test(error instanceof Error ? error.message : String(error))
}
