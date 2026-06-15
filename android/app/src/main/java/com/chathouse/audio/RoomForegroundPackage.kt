package com.chathouse.audio

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * Registers [RoomForegroundModule] with React Native. A legacy ReactPackage is
 * still bridged under the New Architecture, so this works without a TurboModule
 * spec. Added to PackageList in MainApplication.getPackages().
 */
class RoomForegroundPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(RoomForegroundModule(reactContext))

  override fun createViewManagers(
    reactContext: ReactApplicationContext,
  ): List<ViewManager<*, *>> = emptyList()
}
