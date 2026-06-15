package com.chathouse.audio

import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * JS bridge for [RoomForegroundService]. The JS audio layer
 * (`src/features/rooms/services/foregroundAudio.ts`) calls `start()` when a
 * LiveKit room becomes active and `stop()` when it leaves, so Android keeps the
 * process alive (and audio flowing) while the app is backgrounded.
 *
 * Registered via [RoomForegroundPackage] in MainApplication.getPackages(). The
 * service + its FOREGROUND_SERVICE_MEDIA_PLAYBACK / POST_NOTIFICATIONS
 * permissions are declared in AndroidManifest.xml.
 */
class RoomForegroundModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  /** Promote the service to the foreground with the ongoing "Audio room active" notification. */
  @ReactMethod
  fun start(promise: Promise) {
    try {
      val intent =
        Intent(reactContext, RoomForegroundService::class.java).apply {
          action = RoomForegroundService.ACTION_START
        }
      // Android O+ forbids plain startService for a background-started service;
      // startForegroundService requires the service to call startForeground()
      // promptly (RoomForegroundService does so in onStartCommand).
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        reactContext.startForegroundService(intent)
      } else {
        reactContext.startService(intent)
      }
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("E_FGS_START", e)
    }
  }

  /**
   * Tear the service down. stopService destroys it (removing the foreground
   * notification automatically) and prevents the START_STICKY auto-restart —
   * and, unlike a startService(ACTION_STOP), it isn't subject to the Android 8+
   * background-start restriction.
   */
  @ReactMethod
  fun stop(promise: Promise) {
    try {
      val intent = Intent(reactContext, RoomForegroundService::class.java)
      reactContext.stopService(intent)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("E_FGS_STOP", e)
    }
  }

  companion object {
    const val NAME = "RoomForeground"
  }
}
