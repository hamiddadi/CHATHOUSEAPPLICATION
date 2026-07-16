package com.chathouse.app

import android.app.Application

import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.chathouse.audio.RoomForegroundPackage
import com.livekit.reactnative.LiveKitReactNative
import com.livekit.reactnative.audio.AudioType

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Bridges the audio-room foreground service. Every other package is
          // discovered by React Native autolinking.
          add(RoomForegroundPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    // Initialize LiveKit's native Audio Device Module BEFORE any RN init
    // (loadReactNative below). Without this, @livekit/react-native's
    // configureAudio throws "Audio device module is not initialized! Did you
    // remember to call LiveKitReactNative.setup in your Application.onCreate?"
    // and audio never starts. CommunicationAudioType = we both publish + play.
    LiveKitReactNative.setup(this, AudioType.CommunicationAudioType())
    loadReactNative(this)
  }
}
