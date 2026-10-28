package com.rulz.codingagent.android;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;

/**
 * Keeps the app's process (and so its connection to the computer) alive while the app is in the
 * background, so it can tell the owner when a task finishes or needs them. Android requires the
 * small ongoing notification this shows.
 */
public class ConnectionService extends Service {

    static final String CHANNEL = "connection";
    static final int NOTIFICATION_ID = 7420;
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_TEXT = "text";
    /** A task can't keep the phone awake longer than this. */
    private static final long MAX_BUSY_MS = 3 * 60 * 60 * 1000L;

    private static ConnectionService running;
    private static boolean busy;
    private PowerManager.WakeLock wakeLock;

    static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Connection to your computer", NotificationManager.IMPORTANCE_MIN);
        channel.setDescription("Shown while RulZ Agent stays connected in the background");
        channel.setShowBadge(false);
        context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String title = intent != null && intent.hasExtra(EXTRA_TITLE) ? intent.getStringExtra(EXTRA_TITLE) : "Connected";
        String text = intent != null && intent.hasExtra(EXTRA_TEXT) ? intent.getStringExtra(EXTRA_TEXT) : "";
        createChannel(this);

        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification notification = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_rulz)
            .setColor(0xFFED000D)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(tap)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        running = this;
        applyBusy();
        return START_NOT_STICKY;
    }

    /** While a task runs on the computer, the phone stays awake so its messages arrive right away. */
    static synchronized void setBusy(boolean value) {
        busy = value;
        if (running != null) running.applyBusy();
    }

    private synchronized void applyBusy() {
        if (busy) {
            if (wakeLock == null) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "RulZAgent:task");
                wakeLock.setReferenceCounted(false);
            }
            wakeLock.acquire(MAX_BUSY_MS);
        } else if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
    }

    @Override
    public void onDestroy() {
        running = null;
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
