package com.chathouse.audio

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.chathouse.app.R

/**
 * Foreground service that keeps the process alive while a Chathouse audio room
 * (LiveKit) is active in the background, so Android does not kill live audio.
 *
 * Declared in AndroidManifest.xml with
 * `foregroundServiceType="mediaPlayback|microphone"` (and `stopWithTask="true"`).
 * The `microphone` type is required on Android 14+ so a speaker publishing audio
 * via LiveKit keeps the mic open while backgrounded; the actual type is narrowed
 * to what RECORD_AUDIO allows at runtime (see resolveServiceType).
 *
 * Lifecycle: started with ACTION_START when a room becomes active and stopped
 * with ACTION_STOP (or automatically when the task is removed). It is driven
 * from JS via RoomForegroundModule (foregroundAudio.ts → roomAudioService.ts),
 * which starts it whenever a room is joined.
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
        .setContentTitle(getString(R.string.app_name))
        .setContentText(getString(R.string.audio_room_active))
        .setSmallIcon(R.drawable.ic_stat_audio)
        .setOngoing(true)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .build()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, resolveServiceType())
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  /**
   * The room is a Clubhouse-style live audio space: speakers capture the mic via
   * LiveKit/WebRTC and the service exists to keep that audio alive in the
   * background. On Android 14+ background mic capture REQUIRES the `microphone`
   * FGS type, otherwise the OS mutes the speaker once backgrounded.
   *
   * We always keep `mediaPlayback` (covers listeners) and add `microphone` only
   * when RECORD_AUDIO is actually granted — declaring `microphone` without the
   * permission makes startForeground throw a SecurityException on Android 14+,
   * which would crash listeners (who never grant the mic).
   */
  private fun resolveServiceType(): Int {
    var type = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
    val micGranted =
      ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
        PackageManager.PERMISSION_GRANTED
    if (micGranted) {
      type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
    }
    return type
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
          NotificationChannel(
            CHANNEL_ID,
            getString(R.string.audio_channel_name),
            NotificationManager.IMPORTANCE_LOW,
          )
        channel.description = getString(R.string.audio_channel_desc)
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
