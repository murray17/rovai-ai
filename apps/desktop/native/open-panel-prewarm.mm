#import <AppKit/AppKit.h>

#include <chrono>
#include <node_api.h>

namespace {

NSOpenPanel* warm_panel = nil;

napi_value Prewarm(napi_env env, napi_callback_info) {
  if (![NSThread isMainThread]) {
    napi_throw_error(env, nullptr, "NSOpenPanel prewarming must run on the main thread");
    return nullptr;
  }

  const auto started_at = std::chrono::steady_clock::now();
  @autoreleasepool {
    if (warm_panel == nil) {
      warm_panel = [NSOpenPanel openPanel];
      [warm_panel setCanChooseDirectories:YES];
      [warm_panel setCanChooseFiles:NO];
      [warm_panel setAllowsMultipleSelection:NO];
      [warm_panel setResolvesAliases:YES];

      NSView* content_view = [warm_panel contentView];
      [content_view layoutSubtreeIfNeeded];
    }
  }

  const auto elapsed = std::chrono::duration<double, std::milli>(
    std::chrono::steady_clock::now() - started_at
  ).count();
  napi_value result;
  napi_create_double(env, elapsed, &result);
  return result;
}

}  // namespace

NAPI_MODULE_INIT() {
  napi_property_descriptor descriptor = {
    "prewarm",
    nullptr,
    Prewarm,
    nullptr,
    nullptr,
    nullptr,
    napi_default,
    nullptr
  };
  napi_define_properties(env, exports, 1, &descriptor);
  return exports;
}
