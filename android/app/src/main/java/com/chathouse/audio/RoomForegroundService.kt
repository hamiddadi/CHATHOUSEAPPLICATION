package com.chathouse.audio

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Foreground service that keeps the process alive while a Chathouse audio room
 * (LiveKit) is active in the background, so Android does not kill live audio.
 *
 * Declared in AndroidManifest.xml with `foregroundServiceType="mediaPlayback"`
 * (and `stopWithTask="true"`). The manifest entry + the FOREGROUND_SERVICE /
 * FOREGROUND_SERVICE_MEDIA_PLAYBACK / POST_NOTIFICATIONS permissions are injected
 * by the `with-audio-background` Expo config plugin, but the plugin only patches
 * the manifest -- the service had NO implementation. This class is authored as
 * part of committing the bare `android/` project to git (de-Expo migration): a
 * manifest <service> with no backing class is a latent ClassNotFoundException the
 * moment anything tries to start it.
 *
 * Lifecycle: started with ACTION_START when a room becomes active and stopped
 * with ACTION_STOP (or automatically when the task is removed). Wiring a JS
 * bridge to start/stop it is part of the audio-module migration; until then the
 * class is dormant (nothing starts it) and runtime behaviour is unchanged.
 */
class RoomForegroundService : Service() {

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        stopForegroundCompat()
        stopSelf()
      }
      else -> startForegroundWithNotification()
    }
    // Restart if killed while a room is active; the JS layer re-issues START.
    return START_STICKY
  }

  private fun startForegroundWithNotification() {
    createChannel()
    val notification: Notification =
      NotificationCompat.Builder(this, CHANNEL_ID)
        .setContentTitle("Chathouse")
        .setContentText("Audio room active")
        .setSmallIcon(applicationInfo.icon)
        .setOngoing(true)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .build()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun stopForegroundCompat() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (manager.getNotificationChannel(CHANNEL_ID) == null) {
        val channel =
          NotificationChannel(CHANNEL_ID, "Audio rooms", NotificationManager.IMPORTANCE_LOW)
        channel.setShowBadge(false)
        manager.createNotificationChannel(channel)
      }
    }
  }

  companion object {
    const val ACTION_START = "com.chathouse.audio.action.START"
    const val ACTION_STOP = "com.chathouse.audio.action.STOP"
    private const val CHANNEL_ID = "chathouse_audio_room"
    private const val NOTIFICATION_ID = 4242
  }
}
