// macOS real-process acceptance wrapper. Run an isolated product smoke under
// this observer; any newly registered ZCode GUI App fails the acceptance.
// Example: swift scripts/smoke-zcode-launch.swift /absolute/node scripts/smoke-zcode-runtime.mjs
import AppKit
import Foundation

let arguments = Array(CommandLine.arguments.dropFirst())
guard let executable = arguments.first, executable.hasPrefix("/") else {
    fputs("Expected an absolute executable followed by its arguments\n", stderr)
    exit(2)
}
let workspace = NSWorkspace.shared
let baseline = Set(workspace.runningApplications.filter { $0.bundleIdentifier == "dev.zcode.app" }.map(\.processIdentifier))
var observed = Set<pid_t>()
let observer = workspace.notificationCenter.addObserver(forName: NSWorkspace.didLaunchApplicationNotification, object: nil, queue: .main) { notification in
    if let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
       app.bundleIdentifier == "dev.zcode.app", !baseline.contains(app.processIdentifier) {
        observed.insert(app.processIdentifier)
    }
}
defer { workspace.notificationCenter.removeObserver(observer) }
let task = Process()
task.executableURL = URL(fileURLWithPath: executable)
task.arguments = Array(arguments.dropFirst())
task.environment = ProcessInfo.processInfo.environment
try task.run()
while task.isRunning {
    for app in workspace.runningApplications where app.bundleIdentifier == "dev.zcode.app" && !baseline.contains(app.processIdentifier) {
        observed.insert(app.processIdentifier)
    }
    RunLoop.current.run(until: Date().addingTimeInterval(0.02))
}
task.waitUntilExit()
let result: [String:Any] = ["zcodeGuiLaunchCount":observed.count,"childExitCode":task.terminationStatus,"ok":observed.isEmpty && task.terminationStatus == 0]
print(String(data:try JSONSerialization.data(withJSONObject: result, options: .sortedKeys),encoding:.utf8)!)
exit(observed.isEmpty ? task.terminationStatus : 1)
